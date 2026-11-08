// Opens the real page in a real, invisible Chrome and clicks through it.
//
//   node tools/smoke.mjs                   # must end "Smoke test passed"
//   node tools/smoke.mjs --keep            # keep Chrome's profile and log afterwards
//   node tools/smoke.mjs --require-chrome  # no Chrome is an error (exit 2), not a skip
//   CHROME=/path/to/chrome node tools/smoke.mjs
//
// Why this exists: tools/check.mjs runs js/app.js against a fake page. It
// cannot see a page broken by the stylesheet, a module that fails to load, the
// real fetch, the phone Filters sheet (<dialog>), or a button that something
// else is lying on top of. Any of those would pass check.mjs and still leave
// students with a blank or unusable site (audit L08). This script loads
// index.html from tools/serve.mjs at four widths — 390 (phone), 1024 (bar and
// inline details), 1280 and 1920 (side pane) — and checks that the page loads
// every programme, that search and filters narrow the list, that a programme
// opens with its official link, that a saved list can be compared and shared
// (390 and 1280), and that the browser logged no errors. It then
// blocks data/programmes.csv to prove the saved copy (data/fallback.json) still
// works, and blocks both to prove the "could not load" message appears.
//
// Clicks are real mouse events at the middle of the element, after checking
// that the element is what is actually under that point. A button covered by
// the sticky bar or the sheet's scrim fails here, where a script click would
// not.
//
// What it never does: use your own Chrome profile (it makes a throwaway one in
// the system temp folder and deletes it), use fixed ports (it asks the system
// for free ones, so two runs never collide), or change any file in the project.
// It waits for things to happen rather than sleeping for fixed times, so a slow
// computer makes it slower, not flaky. It stops Chrome and the server even
// when it fails or you press Ctrl-C.
//
// If js/config.js ever gets Google Sheet URLs, the page reads those instead of
// data/*.csv and "count = rows in programmes.csv" no longer holds. The Fetch
// domain used for the fallback test can answer the Sheet URLs with the local
// CSVs (Fetch.fulfillRequest); that is the change to make then.
//
// No dependencies, like everything else in tools/.

import { spawn } from 'node:child_process';
import { createWriteStream, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvToObjects } from '../js/csv.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const KEEP = args.has('--keep');
const REQUIRE_CHROME = args.has('--require-chrome');
const WIDTHS = [[390, 844], [1024, 768], [1280, 900], [1920, 1080]];
const WATCHDOG_MS = 120_000;

let step = 'starting';
let server = null;
let chrome = null;
let cdp = null;
let workDir = null;

// --- What the page should show, worked out from the files -------------------

// The total comes from the CSV itself, never a number written here, so adding
// a row does not break the test — but a row the page drops does.
async function expectations() {
  const read = (name) => readFile(join(root, 'data', name), 'utf8');
  const programmes = csvToObjects(await read('programmes.csv'), 'programmes.csv').rows.filter((r) => r.programme_id);
  const universities = new Map(csvToObjects(await read('universities.csv'), 'universities.csv').rows.map((u) => [u.university_id, u]));
  const fallbackTotal = JSON.parse(await read('fallback.json')).programmes.length;
  // Cities and countries come from the joined data, like js/data.js: a blank
  // programme city means the university's city (over a thousand rows are
  // blank), "?" means unknown and never inherits, the country is always the
  // university's. Picking from programmes.csv alone would pick "" or "?".
  const cities = new Map();
  const countries = new Map();
  for (const row of programmes) {
    const uni = universities.get(row.university_id);
    if (!uni) continue;
    const city = row.city === '' ? uni.city : row.city;
    if (city && city !== '?') cities.set(city, (cities.get(city) || 0) + 1);
    if (uni.country) countries.set(uni.country, (countries.get(uni.country) || 0) + 1);
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { total: programmes.length, fallbackTotal, city: top(cities), country: top(countries) };
}

// --- Finding Chrome -----------------------------------------------------------

function findChrome() {
  if (process.env.CHROME) return isFile(process.env.CHROME) ? process.env.CHROME : null;
  const mac = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const path of mac) if (isFile(path)) return path;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      if (dir && isFile(join(dir, name))) return join(dir, name);
    }
  }
  return null;
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

// --- Starting and stopping the server and Chrome ------------------------------

function freePort() {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });
}

// Ready means this child printed its own address. A bare HTTP 200 is not
// enough: another program that grabbed the port in between could answer it.
// If the port was taken anyway, serve.mjs exits (EADDRINUSE); try one more.
async function startServer() {
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const child = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    server = child;
    let output = '';
    try {
      await new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error('the server did not start within 10 s')), 10_000);
        const done = (fn, value) => { clearTimeout(timer); fn(value); };
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes(`http://localhost:${port}`)) done(ok);
        });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.once('error', (err) => done(fail, err));
        child.once('exit', (code) => done(fail, new Error(`the server stopped (exit ${code}): ${output.trim().split('\n').pop()}`)));
      });
      return port;
    } catch (err) {
      await stop(child);
      server = null;
      if (attempt >= 2) throw err;
    }
  }
}

// The AI flags: on 2026 Chrome a page-content AI pass ran a ~1.5 s task on
// every load. "AIPageContentAgent" alone did not switch it off; this whole set
// did (plans/l09-implementation-report.md). If Chrome renames them the test only
// gets slower.
async function startChrome(path) {
  workDir = await mkdtemp(join(tmpdir(), 'ibuf-smoke-'));
  const log = createWriteStream(join(workDir, 'chrome.log'));
  const child = spawn(path, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(workDir, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update',
    // A fresh profile otherwise asks the macOS keychain for a password.
    '--use-mock-keychain', '--password-store=basic',
    '--hide-scrollbars', '--mute-audio',
    '--disable-field-trial-config',
    '--disable-features=AnnotatedPageContentExtraction,AnnotatedPageContent,AnnotatedPageContentRequest,PageContentAnnotations,AIPageContentAgent,Glic,OptimizationGuideModelExecution',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome = child;
  // Chrome's own chatter (GPU and display warnings on macOS) goes to the log
  // file, not the screen: it is not the page's console and not a failure.
  return new Promise((ok, fail) => {
    let text = '';
    let found = false;
    const timer = setTimeout(() => fail(new Error('Chrome did not start within 30 s')), 30_000);
    child.stderr.on('data', (chunk) => {
      log.write(chunk);
      if (found) return;
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { found = true; clearTimeout(timer); ok(match[1]); }
    });
    child.once('error', (err) => { clearTimeout(timer); fail(err); });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Chrome stopped (exit ${code}); see ${join(workDir, 'chrome.log')}`)); });
  });
}

// SIGTERM, then SIGKILL if it is still there after 3 s.
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((ok) => child.once('exit', ok));
  const within = (ms) => Promise.race([exited.then(() => true), new Promise((ok) => setTimeout(() => ok(false), ms))]);
  child.kill('SIGTERM');
  if (await within(3000)) return;
  child.kill('SIGKILL');
  await within(2000);
}

let cleaning = null;
function cleanup() {
  cleaning ||= (async () => {
    // Browser.close lets Chrome shut down tidily; it is only a courtesy, so a
    // hung connection gets 2 s and the signals below happen regardless.
    if (cdp) await cdp.send('Browser.close', {}, undefined, 2000).catch(() => {});
    cdp?.close();
    await Promise.all([stop(chrome), stop(server)]);
    if (workDir && !KEEP) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  })();
  return cleaning;
}

// --- Talking to Chrome (DevTools protocol) ------------------------------------

// Every command has a deadline, and every waiting command fails at once when
// the connection drops, so a dead Chrome can never hang the run.
function connect(url) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let seq = 0;
    let closed = false;
    const dropAll = (err) => {
      closed = true;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
      pending.clear();
    };
    ws.addEventListener('open', () => ok(api), { once: true });
    ws.addEventListener('error', () => { fail(new Error('could not connect to Chrome')); dropAll(new Error('lost the connection to Chrome')); });
    ws.addEventListener('close', () => dropAll(new Error('lost the connection to Chrome')));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg);
      }
    });
    const api = {
      send(method, params = {}, sessionId, ms = 20_000) {
        if (closed) return Promise.reject(new Error('lost the connection to Chrome'));
        return new Promise((resolve, reject) => {
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Chrome did not answer ${method} within ${ms / 1000} s`));
          }, ms);
          pending.set(id, { resolve, reject, timer, method });
          ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { try { ws.close(); } catch { /* already closed */ } },
    };
  });
}

// A fresh tab per scenario, so nothing (the address bar's filters, an open
// sheet) leaks from one width to the next.
async function openPage(base, width, height, { block = [] } = {}) {
  // Each scenario gets its own storage; ordinary tabs share saved filters.
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params, ms) => cdp.send(method, params, sessionId, ms);
  const errors = [];
  const exceptions = [];
  const off = cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === 'Runtime.exceptionThrown') {
      const text = `uncaught: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`;
      errors.push({ text, url: p.exceptionDetails.url || '' });
      exceptions.push(text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
      errors.push({ text: `console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`, url: '' });
    } else if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') {
      errors.push({ text: `${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`, url: p.entry.url || '' });
    } else if (msg.method === 'Fetch.requestPaused') {
      send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' }).catch(() => {});
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  if (block.length) await send('Fetch.enable', { patterns: block.map((urlPattern) => ({ urlPattern })) });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // Headless tabs are never "focused", which would leave focus-dependent code
  // (the sheet moving focus to its heading) untested.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: base });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Polls an expression that returns { ok, why }. Never a fixed sleep: the
  // search box waits 150 ms before it filters, the list then fills in slices,
  // and the sheet slides in after it opens — all of which take longer on a
  // busy computer. While the page is navigating an evaluation can fail; that
  // just counts as "not yet".
  const waitFor = async (expression, ms, what) => {
    const until = Date.now() + ms;
    let last = { why: 'never checked' };
    while (Date.now() < until) {
      try { last = await ev(expression); } catch (err) { last = { why: err.message }; }
      if (last?.ok) return last;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error(`${what} not seen within ${ms / 1000} s (${last?.why ?? JSON.stringify(last)})`);
  };

  // Where to click: the middle of the element, once it has stopped moving
  // (scrolling, the sheet's slide) and only if it is what is actually under
  // that point.
  const click = async (elementJs, what) => {
    const spot = await waitFor(`(() => {
      const el = ${elementJs};
      if (!el) return { why: 'not in the page' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return { why: 'has no size (hidden?)' };
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== el && !el.contains(hit))) {
        return { why: 'covered by ' + (hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.trim().split(/\\s+/).join('.') : '') : 'nothing') };
      }
      const at = [x, y, r.width, r.height].map(Math.round).join();
      const stable = at === window.__smokeAt;
      window.__smokeAt = at;
      return { ok: stable, x, y, why: 'still moving' };
    })()`, 5000, `${what} ready to click`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    }
    await ev('window.__smokeAt = undefined');
  };

  // Chrome activates a focused button on Enter from the key's character
  // ("\r"), not from a bare rawKeyDown, so a key that types text must say so.
  // Without it, Enter on a real <button> did nothing here but works by hand.
  const key = async (keyName, code, keyCode, commands = [], text) => {
    await send('Input.dispatchKeyEvent', text
      ? { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text, commands }
      : { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, commands });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode });
  };
  const type = (text) => send('Input.insertText', { text });
  // Select everything in the focused field and delete it, as a person would.
  const clearField = async () => {
    await key('a', 'KeyA', 65, ['selectAll']);
    await key('Backspace', 'Backspace', 8, ['deleteBackward']);
  };

  const close = async () => {
    off();
    await cdp.send('Target.closeTarget', { targetId }, undefined, 5000).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }, undefined, 5000).catch(() => {});
  };
  const screenshot = async (path) => {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.min(6000, cssContentSize.height), scale: 1 } });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  return { ev, waitFor, click, key, type, clearField, errors, exceptions, close, screenshot, send };
}

// --- Reporting ----------------------------------------------------------------

const results = [];
let anyBooted = false;
function report(status, where, id, name, why = '') {
  results.push({ status, where, id, name });
  console.log(`${status} ${String(where).padEnd(8)} ${id} ${name}${why ? `: ${why}` : ''}`);
}

async function check(where, id, name, fn) {
  step = `${where} ${id} ${name}`;
  try {
    await fn();
    report('PASS', where, id, name);
    return true;
  } catch (err) {
    report('FAIL', where, id, name, err.message);
    return false;
  }
}

const assert = (ok, why) => { if (!ok) throw new Error(why); };

// --- Page expressions shared by several checks --------------------------------

// The count line's lead: "1240 programmes" or "52 of 1240 programmes". The
// points summary that may follow sits outside the <b>.
const COUNT = `(document.querySelector('#result-count .count-lead')?.textContent ?? '').replace(/[,\\u00a0\\u202f]/g,'')`;
const countIs = (text) => `(() => { const t = ${COUNT}; return { ok: t === ${JSON.stringify(text)}, why: 'count reads "' + t + '"' }; })()`;
const narrowed = (total) => `(() => {
  const t = ${COUNT};
  const m = t.match(/^(\\d+) of ${total} programmes?$/);
  const n = m ? Number(m[1]) : -1;
  return { ok: n > 0 && n < ${total}, n, why: 'count reads "' + t + '"' };
})()`;
const visible = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { why: ${JSON.stringify(`${selector} is not in the page`)} };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (s.display === 'none' || s.visibility === 'hidden' || !r.width || !r.height) return { why: ${JSON.stringify(`${selector} is not visible`)} };
  return { ok: true };
})()`;

// --- The checks for one width ---------------------------------------------------

async function runWidth(base, width, height, want) {
  const page = await openPage(`${base}?ui=en`, width, height);
  const at = width;
  const T = want.total;

  const booted = await check(at, 'A1', 'page boots', async () => {
    await page.waitFor(`(() => {
      const loading = document.querySelector('#loading');
      const results = document.querySelector('#results');
      if (!location.href.startsWith(${JSON.stringify(base)}) || !loading) return { why: 'page not loaded' };
      if (!loading.hidden) return { why: 'still showing the loading skeleton' };
      if (results?.hasAttribute('aria-busy')) return { why: '#results still aria-busy' };
      return { ok: true };
    })()`, 15_000, 'the list');
  });
  if (booted) anyBooted = true;
  if (await page.ev(`Boolean(document.querySelector('#onboarding[open]'))`)) await page.click(`document.querySelector('#onboarding .skipwrap button')`, 'Skip setup');

  await check(at, 'A2', 'data comes from the CSVs, not the saved copy or samples', async () => {
    const why = await page.ev(`(() => {
      const banner = document.querySelector('#source-banner');
      if (!banner) return 'no #source-banner';
      // The paragraphs only: the banner's "i" mark is text too.
      const said = () => [...banner.querySelectorAll('p')].map((p) => p.textContent.trim()).join(' ').replace(/\\s+/g, ' ').slice(0, 160);
      if (banner.querySelector('[role=alert]')) return 'the page says: ' + said();
      if (!banner.hidden && banner.querySelector('.bn-saved, .bn-sample')) return 'banner: ' + said();
      const text = document.body.innerText;
      if (/saved copy/i.test(text)) return 'the page mentions a saved copy';
      if (/made up/i.test(text)) return 'the page mentions made-up rows';
      return '';
    })()`);
    assert(!why, why);
  });

  await check(at, 'A3', 'no spreadsheet rows dropped', async () => {
    const why = await page.ev(`(() => {
      const issues = document.querySelector('#issues');
      return issues && !issues.hidden ? (document.querySelector('#issues-summary')?.textContent || 'problems listed') + ': ' + document.querySelector('#issues-list')?.textContent.slice(0, 200) : '';
    })()`);
    assert(!why, why);
  });

  const counted = await check(at, 'A4', `count shows all ${T} rows of programmes.csv`, async () => {
    const text = await page.ev(COUNT);
    assert(text === `${T} programmes`, `count reads "${text}", expected "${T} programmes"`);
  });

  if (booted && counted) {
    await interactions(page, at, want);
  } else {
    for (const id of ['A5', 'A6', 'A7', 'A8', 'A9', ...(at === 390 ? ['A10'] : []), ...(at === 1280 ? ['A11'] : []), ...(at >= 600 ? ['A13'] : []), ...(at === 1280 || at === 390 ? ['A14'] : [])]) {
      report('SKIP', at, id, 'not run', 'the page did not load its programmes');
    }
  }

  await check(at, 'A12', 'no errors in the browser console', async () => {
    assert(page.errors.length === 0, page.errors.map((e) => e.text).join(' | '));
    assert(await page.ev(`document.querySelector('.hd').getBoundingClientRect().width===innerWidth`),'white header does not span the viewport');
  });
  await page.close();
}

async function interactions(page, at, want) {
  const T = want.total;
  const phone = at < 600;

  await check(at, 'A5', 'every row is drawn', async () => {
    const first = await page.ev(`document.querySelectorAll('#results > li.item').length`);
    assert(first > 0, 'no rows when the loading skeleton went away');
    // The list fills in slices after the first paint (L09). Drawn = all of
    // them, and still all of them 300 ms later.
    const full = `(() => { const n = document.querySelectorAll('#results > li.item').length; return { ok: n === ${T}, why: n + ' rows drawn' }; })()`;
    await page.waitFor(full, 10_000, `${T} rows`);
    const start = Date.now();
    while (Date.now() - start < 300) await page.waitFor(full, 1000, `${T} rows (staying)`);
  });

  await check(at, 'A6', `searching "${want.city}" narrows the list`, async () => {
    await page.click(`document.querySelector('#f-search')`, 'the search box');
    await page.type(want.city);
    const { n } = await page.waitFor(narrowed(T), 10_000, 'a narrowed count');
    const bad = await page.ev(`[...document.querySelectorAll('#results > li.item')].slice(0, 20)
      .map((li) => li.querySelector('.uc')?.textContent ?? '')
      .filter((t) => !t.toLowerCase().includes(${JSON.stringify(want.city.toLowerCase())}))`);
    assert(bad.length === 0, `${n} found, but some rows are not in ${want.city}: ${bad.slice(0, 3).join(' | ')}`);
    await page.clearField();
    await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after clearing');
  });

  await check(at, 'A7', 'points filter narrows the list', async () => {
    if (phone) await page.click(`document.querySelector('#f-more')`, 'Filters for points');
    await page.click(`document.querySelector('#f-points')`, 'the points box');
    await page.type('24');
    await page.waitFor(narrowed(T), 10_000, 'a narrowed count');
    const error = await page.ev(`document.querySelector('#f-points-error').textContent`);
    assert(error === '', `the points box says "${error}"`);
    await page.clearField();
    await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after clearing');
  });

  if (phone) await page.click(`document.querySelector('#sheet-done')`, 'Done after points');

  // Max yearly cost and My living costs (js/cost.js). In the bar from 600 px;
  // on a phone they sit in the sheet, which A10 already proves opens. A budget
  // of €1 leaves only rows whose cost is unknown, each saying so; My living
  // costs 0 then brings back the rows with no fee (fee + 12 × 0 ≤ 1).
  if (!phone) {
    await check(at, 'A13', 'Max yearly cost keeps unknowns, My living costs replaces the estimate', async () => {
      await page.click(`document.querySelector('#dd-budget summary')`, 'the Budget panel');
      await page.click(`document.querySelector('#f-budget')`, 'the Max yearly cost box');
      await page.type('1');
      const { n: unknownOnly } = await page.waitFor(narrowed(T), 10_000, 'a narrowed count');
      const unlabelled = await page.ev(`[...document.querySelectorAll('#results > li.item')].slice(0, 20)
        .filter((li) => li.querySelector('.c-fee .verd')?.textContent !== 'Yearly cost unknown').length`);
      assert(unlabelled === 0, `${unlabelled} of the first rows do not say "Yearly cost unknown"`);
      await page.click(`document.querySelector('#f-living')`, 'the My living costs box');
      await page.type('0');
      await page.waitFor(`(() => { const r = ${narrowed(T)}; return { ok: r.ok && r.n > ${unknownOnly}, why: r.why }; })()`, 10_000, 'more rows with My living costs 0');
      const mine = await page.ev(`document.querySelector('#results .c-fee .liv')?.textContent ?? ''`);
      assert(mine === 'Living: your €0/mo', `the first row's living line reads "${mine}"`);
      await page.key('Escape', 'Escape', 27);
      assert(await page.ev(`!document.querySelector('#dd-budget').open`), 'Budget must close before the status actions');
      await page.click(`document.querySelector('#f-clear')`, 'Clear all');
      await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after Clear all');
    });
  }

  // On a phone the Country list lives in the Filters sheet, so the sheet opens
  // first (A10) and A8 runs inside it.
  let sheetOpen = false;
  if (phone) {
    // 2026-11-06: list-item rows that content-visibility had never drawn made
    // showModal() stall ~500 ms (4x CPU) before the sheet moved. Rows are
    // block and still list items to assistive tech; the sheet takes 240 ms up
    // and 200 ms down, and none at all with reduced motion.
    await check(at, 'A10', 'rows are display:block list items; the sheet takes 200 ms to close, none with reduced motion', async () => {
      const row = await page.ev(`getComputedStyle(document.querySelector('#results>li.item')).display`);
      assert(row === 'block', `a result row is display:${row}, expected block`);
      const { result } = await page.send('Runtime.evaluate', { expression: `document.querySelector('#results>li.item')` });
      const { nodes } = await page.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
      assert(nodes[0]?.role?.value === 'listitem', `a result row's role is ${nodes[0]?.role?.value}, expected listitem`);
      const times = `(() => { const s = document.querySelector('#filter-sheet'); return getComputedStyle(s).transitionDuration + ' / ' + getComputedStyle(s, '::backdrop').transitionDuration; })()`;
      const closed = await page.ev(times);
      assert(closed === '0.2s, 0.2s, 0.2s / 0.16s, 0.2s, 0.2s', `closed sheet transitions ${closed}`);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        const still = await page.ev(times);
        assert(still === '0s / 0s', `reduced motion: sheet transitions ${still}, expected none`);
      } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
    });
    sheetOpen = await check(at, 'A10', 'Filters sheet opens on a phone', async () => {
      await page.waitFor(visible('#f-more'), 5000, 'the Filters button');
      await page.click(`document.querySelector('#f-more')`, 'the Filters button');
      await page.waitFor(`(() => {
        const sheet = document.querySelector('#filter-sheet');
        if (!sheet.open) return { why: 'sheet not open' };
        if (document.querySelector('#f-more').getAttribute('aria-expanded') !== 'true') return { why: 'Filters button not aria-expanded' };
        if (!document.querySelector('.sheet-b').contains(document.querySelector('#dd-countries'))) return { why: 'Country list is not in the sheet' };
        return ${visible('#filter-sheet')};
      })()`, 5000, 'the open sheet');
      const opening = await page.ev(`getComputedStyle(document.querySelector('#filter-sheet')).transitionDuration + ' / ' + getComputedStyle(document.querySelector('#filter-sheet'), '::backdrop').transitionDuration`);
      assert(opening === '0.24s, 0.24s, 0.24s / 0.2s, 0.24s, 0.24s', `open sheet transitions ${opening}`);
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        const still = await page.ev(`getComputedStyle(document.querySelector('#filter-sheet')).transitionDuration + ' / ' + getComputedStyle(document.querySelector('#filter-sheet'), '::backdrop').transitionDuration`);
        assert(still === '0s / 0s', `reduced motion: open sheet transitions ${still}, expected none`);
      } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
    });
    // A sheet that opened but cannot be seen still makes the page behind it
    // inert, which would fail every later check for the same reason.
    if (!sheetOpen) await page.ev(`document.querySelector('#filter-sheet')?.close()`).catch(() => {});
  }

  const country = JSON.stringify(want.country);
  let filtered = 0;
  if (!phone || sheetOpen) {
    await check(at, 'A8', `ticking ${want.country} narrows the list`, async () => {
      await page.click(`document.querySelector('#dd-countries summary')`, 'the Country list');
      await page.waitFor(`({ ok: document.querySelector('#dd-countries').open, why: 'list did not open' })`, 5000, 'the open Country list');
      await page.click(`document.querySelector('#f-countries input[value=' + JSON.stringify(${country}) + ']')?.closest('label')`, `the ${want.country} option`);
      ({ n: filtered } = await page.waitFor(narrowed(T), 10_000, 'a narrowed count'));
      const ticked = await page.ev(`document.querySelector('#dd-countries-count-number').textContent`);
      assert(ticked === '1', `the Country button says ${ticked || 'nothing'} selected, expected 1`);
      await page.click(`document.querySelector('#dd-countries summary')`, 'the Country list (to close it)');
      if (phone) return; // Clear all sits in the sheet's footer: A10 below.
      await page.click(`document.querySelector('#f-clear')`, 'Clear all');
      await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after Clear all');
    });
  } else {
    report('SKIP', at, 'A8', 'not run', 'the Filters sheet did not open');
  }

  if (phone && sheetOpen) {
    await check(at, 'A10', 'sheet shows the count, clears and closes', async () => {
      const show = await page.ev(`document.querySelector('#sheet-show').textContent`);
      assert(/^Show \d+ programmes?$/.test(show) && show.includes(` ${filtered} `), `the button says "${show}", expected "Show ${filtered} programmes"`);
      await page.click(`document.querySelector('#f-clear')`, 'Clear all');
      await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after Clear all');
      await page.click(`document.querySelector('#sheet-done')`, 'Done');
      await page.waitFor(`({ ok: !document.querySelector('#filter-sheet').open && document.querySelector('#f-more').getAttribute('aria-expanded') === 'false', why: 'sheet still open after Done' })`, 5000, 'the sheet closing');
      await page.click(`document.querySelector('#f-more')`, 'the Filters button again');
      await page.waitFor(`({ ok: document.querySelector('#filter-sheet').open, why: 'sheet did not reopen' })`, 5000, 'the sheet reopening');
      await page.key('Escape', 'Escape', 27);
      await page.waitFor(`({ ok: !document.querySelector('#filter-sheet').open && document.querySelector('#f-more').getAttribute('aria-expanded') === 'false', why: 'sheet still open after Escape' })`, 5000, 'Escape closing the sheet');
    });
  }

  await check(at, 'A9', 'a programme opens with its official link', async () => {
    const id = await page.ev(`document.querySelector('#results li.item')?.dataset.id`);
    assert(id, 'no programme in the list');
    const item = `document.querySelector('#results li.item[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']')`;
    await page.click(`${item}.querySelector('button.open')`, 'the first programme');
    // Wide: the side pane must show this programme, and be on screen — a
    // link that exists inside a display:none pane would help nobody.
    // Narrower: the row opens in place.
    const linkInfo = `(el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { href: el.href, target: el.target, shown: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' };
    }`;
    const details = at >= 1200
      ? `(() => {
          const pane = document.querySelector('#pane');
          const title = pane?.querySelector('.pane-body .d-title');
          if (!title || title.id !== 'p-' + ${JSON.stringify(id)}) return { why: 'the pane does not show the clicked programme' };
          const p = ${visible('#pane')}; if (!p.ok) return p;
          return { ok: true, a: (${linkInfo})(pane.querySelector('.pane-body .d-foot a.btn-p')) };
        })()`
      : `(() => {
          const li = ${item};
          if (!li.classList.contains('is-open')) return { why: 'the row did not open' };
          if (li.querySelector('button.open').getAttribute('aria-expanded') !== 'true') return { why: 'its button is not aria-expanded' };
          const slot = li.querySelector('.expand[data-state=open]');
          if (!slot) return { why: 'no open details under the row' };
          const r = slot.getBoundingClientRect();
          if (!r.width || r.height < 20) return { why: 'the details are not visible' };
          return { ok: true, a: (${linkInfo})(slot.querySelector('.d-foot a.btn-p')) };
        })()`;
    const { a } = await page.waitFor(details, 5000, 'the details');
    assert(a, 'no "Official admissions page" link in the details');
    assert(/^https?:\/\//.test(a.href), `the official link is "${a.href}"`);
    assert(a.target === '_blank', 'the official link does not open in a new tab');
    assert(a.shown, 'the official link is not visible');
  });

  // My list (2026-11-03): real clicks on the row stars, the list view,
  // Compare and a share link opened in the same tab. Phone and desktop.
  if (at === 1280 || at === 390) {
    await check(at, 'A14', 'save two stars, open my list, compare two programmes, and open the share link', async () => {
      const rowId = (i) => page.ev(`document.querySelectorAll('#results > li.item')[${i}].dataset.id`);
      const star = (id) => `document.querySelector('#results li.item[data-id=' + JSON.stringify(${JSON.stringify(id)}) + '] button.star')`;
      const [a, b] = [await rowId(0), await rowId(1)];
      // Every width shares one throwaway profile, so saves left by an earlier
      // width would start these stars pressed.
      assert(await page.ev(`!localStorage.getItem('ib-university-finder:shortlist:v1')`), 'saves left over from an earlier check');
      const openRows = `document.querySelectorAll('#results li.item.is-open').length`;
      const openBefore = await page.ev(openRows);
      try {
      for (const id of [a, b]) {
        await page.click(star(id), `the star on ${id}`);
        await page.waitFor(`({ ok: ${star(id)}.getAttribute('aria-pressed') === 'true', why: 'star not pressed' })`, 5000, 'a pressed star');
      }
      await page.waitFor(`({ ok: document.querySelector('#shortlist-count-text').textContent === '2 saved · 2 shown', why: document.querySelector('#shortlist-count-text').textContent })`, 5000, '"2 saved · 2 shown"');
      assert(await page.ev(openRows) === openBefore, 'a star click opened or closed a row');
      await page.click(`document.querySelector('#header-list')`, 'Open my list');
      await page.waitFor(`(() => { const n = document.querySelectorAll('#results > li.item').length; return { ok: n === 2, why: n + ' rows in the list' }; })()`, 10_000, 'two saved rows');
      // Batch 3 · A: Compare is its own set, added with each row's scale toggle
      // and opened from the header (desktop) or the bottom tray (phones).
      const scale = (id) => `document.querySelector('#results li.item[data-id=' + JSON.stringify(${JSON.stringify('')} + ${JSON.stringify(id)}) + '] button.cmpi')`;
      for (const id of [a, b]) {
        await page.click(scale(id), `the compare toggle on ${id}`);
        await page.waitFor(`({ ok: ${scale(id)}.getAttribute('aria-pressed') === 'true', why: 'compare toggle not pressed' })`, 5000, 'a pressed compare toggle');
      }
      await page.click(at < 600 ? `document.querySelector('#cmp-tray-open')` : `document.querySelector('#header-compare')`, 'Open compare');
      await page.waitFor(`(() => {
        const heads = [...document.querySelectorAll('#cmp-body th[scope=col]')];
        if (heads.length !== 2) return { why: heads.length + ' columns' };
        if (!document.querySelector('.split').hidden) return { why: 'the list is still showing' };
        const wide = document.documentElement.scrollWidth;
        if (wide > innerWidth) return { why: 'the page is ' + wide + ' px wide' };
        const r = heads[1].getBoundingClientRect();
        return { ok: r.right <= innerWidth + 1 && r.width > 0, why: 'the second programme is off screen' };
      })()`, 5000, 'a two-column compare table');
      await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
      // Phones keep Share behind My list's More (2026-11-06).
      if (at < 600) await page.click(`document.querySelector('#ml-more')`, 'More');
      await page.click(`document.querySelector('#ml-share summary')`, 'Share');
      // The link is filled on the panel's toggle event, just after the click.
      const { url } = await page.waitFor(`({ ok: document.querySelector('#ml-share-url').value !== '', url: document.querySelector('#ml-share-url').value, why: 'no link yet' })`, 5000, 'the share link');
      assert(new URL(url).search === '?list=' + [a, b].join(','), 'the share link is ' + url);
      await page.ev(`location.href = ${JSON.stringify(url)}`);
      await page.waitFor(`(() => {
        if (!document.querySelector('#loading')?.hidden) return { why: 'loading' };
        // Share links carry no ui=, so the shared view opens in the default language.
        if (!['Shared list', 'Zdieľaný zoznam'].includes(document.querySelector('#ml-title')?.textContent)) return { why: 'no shared view' };
        const n = document.querySelectorAll('#results > li.item').length;
        return { ok: n === 2 && location.search.startsWith('?list='), why: n + ' rows, address ' + location.search };
      })()`, 15_000, 'the shared view');
      await page.click(`document.querySelector('#f-shortlist-only')`, 'Close shared list');
      await page.waitFor(`({ ok: !location.search.includes('list=') && document.querySelectorAll('#results > li.item').length > 2, why: location.search })`, 10_000, 'the full list again');
      } finally {
        // Each width starts with no saves.
        await page.ev(`localStorage.clear()`);
      }
    });
  }

  if (at === 1280) {
    await check(at, 'A11', 'no Filters sheet on a desktop', async () => {
      const why = await page.ev(`(() => {
        const more = document.querySelector('#f-more');
        if (more && getComputedStyle(more).display !== 'none') return 'the Filters button is showing';
        if (document.querySelector('#filter-sheet').contains(document.querySelector('#dd-countries'))) return 'the Country list is inside the sheet';
        return '';
      })()`);
      assert(!why, why);
    });
  }
}

// --- When the data cannot be fetched -------------------------------------------

async function runFallback(base, want) {
  // English UI: these checks read the English banner and count wording.
  const page = await openPage(`${base}?ui=en`, 1280, 900, { block: ['*/data/programmes.csv*'] });
  await check('fallback', 'F1', `programmes.csv blocked: saved copy shows all ${want.fallbackTotal} rows`, async () => {
    await page.waitFor(`({ ok: !!document.querySelector('#loading')?.hidden && location.href.startsWith(${JSON.stringify(base)}), why: 'still loading' })`, 15_000, 'the list');
    const banner = await page.ev(`document.querySelector('#source-banner .bn-saved')?.textContent ?? ''`);
    assert(/saved copy from/.test(banner), `no "saved copy from" banner (banner: "${banner.trim().slice(0, 100)}")`);
    await page.waitFor(countIs(`${want.fallbackTotal} programmes`), 5000, `"${want.fallbackTotal} programmes"`);
    await page.waitFor(`(() => { const n = document.querySelectorAll('#results > li.item').length; return { ok: n === ${want.fallbackTotal}, why: n + ' rows drawn' }; })()`, 10_000, 'every row');
    // The blocked request itself is logged as an error; anything else is not expected.
    const other = page.errors.filter((e) => !/\/data\/programmes\.csv/.test(e.url));
    assert(other.length === 0, other.map((e) => e.text).join(' | '));
  });
  await page.close();

  const both = await openPage(`${base}?ui=en`, 1280, 900, { block: ['*/data/programmes.csv*', '*/data/fallback.json*'] });
  await check('fallback', 'F2', 'nothing loads: the page says so', async () => {
    await both.waitFor(`(() => {
      if (!location.href.startsWith(${JSON.stringify(base)})) return { why: 'page not loaded' };
      const alert = document.querySelector('#source-banner [role=alert]');
      if (!alert) return { why: 'no failure message' };
      return { ok: !!document.querySelector('#loading')?.hidden, why: 'loading skeleton still showing' };
    })()`, 15_000, 'the "could not load" message');
    assert(both.exceptions.length === 0, both.exceptions.join(' | '));
  });
  await both.close();
}

// Exercise a real translated admission value and its English original, plus
// both directions of the switch at desktop and phone.
async function runI18n(base) {
  await mkdir('/tmp/ib-i18n-v2', { recursive: true });
  for (const width of [1280, 390]) {
    const page = await openPage(`${base}?ui=en&q=computer+science+delft`, width, 1000);
    try {
      await check(width, 'I18N', 'EN ↔ SK keeps the view and reveals English data originals', async () => {
        await page.waitFor(`({ ok: !!document.querySelector('#loading')?.hidden && !!document.querySelector('[data-id="tud-cse"] .open'), why: 'waiting for Delft' })`, 15000, 'programme');
        await page.click(`document.querySelector('[data-id="tud-cse"] .open')`, 'programme details');
        const detail = width >= 1200 ? '#pane' : '[data-id="tud-cse"] .expand';
        await page.waitFor(`({ ok: !!document.querySelector('${detail} .kv dd'), why: 'waiting for detail' })`, 5000, 'detail');
        const before = await page.ev(`({ search: document.querySelector('#f-search').value, ids: [...document.querySelectorAll('#results > li')].map(n => n.dataset.id) })`);
        await page.screenshot(`/tmp/ib-i18n-v2/${width}-en.png`);
        await page.click(`document.querySelector('[data-language="sk"]')`, 'Slovak');
        assert(await page.ev(`document.documentElement.lang === 'sk'`), 'HTML language did not switch');
        const after = await page.ev(`({ search: document.querySelector('#f-search').value, ids: [...document.querySelectorAll('#results > li')].map(n => n.dataset.id) })`);
        assert(JSON.stringify(before) === JSON.stringify(after), 'switch changed search or results');
        const button = `${detail} .detail-originals`;
        const status = `(() => {
          const detail = document.querySelector('${detail}');
          const originals = [...detail.querySelectorAll('.data-original')];
          // The label flips with the state; "pressed" here means "originals shown".
          const toggle = detail.querySelector('.detail-originals');
          const label = toggle?.textContent;
          const pressed = toggle?.hasAttribute('aria-pressed') ? 'aria-pressed present'
            : label === 'Skryť originál' ? 'true' : label === 'Zobraziť originál v angličtine' ? 'false' : 'label: ' + label;
          return { count: originals.length, pressed, allOn: originals.every(n => !n.hidden && n.lang === 'en'), allOff: originals.every(n => n.hidden) };
        })()`;
        assert(await page.ev(`![...document.querySelectorAll('#results .row')].some(n => n.querySelector('.data-en, .data-original, .detail-originals'))`), 'rows contain EN markers');
        let result = await page.ev(status);
        assert(result.count >= 2 && result.pressed === 'false' && result.allOff, 'originals should start hidden');
        assert(await page.ev(`[...document.querySelectorAll('${detail} .d-sec')].every(s => s.querySelectorAll('.english-note').length === (s.querySelector('[data-untranslated]') ? 1 : 0))`), 'section notes are missing or repeated');
        assert(await page.ev(`[...document.querySelectorAll('.deg .data-value')].filter(n => n.textContent === 'BSc').every(n => !n.querySelector('[data-english], [data-untranslated], button'))`), 'equal degree has markers');
        await page.screenshot(`/tmp/ib-i18n-v2/${width}-sk-off.png`);
        await page.ev(`document.querySelector('${button}').click()`);
        result = await page.ev(status);
        assert(result.pressed === 'true' && result.allOn, 'toggle did not reveal every original');
        // A redraw that keeps the language must keep the originals shown. This
        // step tapped SK while SK was already on, which did nothing once a tap
        // came to flip the language (Leon, 2026-11-06), so it re-rendered
        // nothing. Changing the sort redraws the list and the detail; the old
        // toggle is marked so a detail that was never rebuilt fails.
        await page.ev(`document.querySelector('${button}').dataset.before = '1'`);
        const sort = await page.ev(`document.querySelector('#f-sort').value`);
        await page.ev(`(s=>{s.value=[...s.options].find(o=>o.value!==s.value).value;s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('#f-sort'))`);
        await page.waitFor(`({ok:!!document.querySelector('${button}') && !document.querySelector('${button}').dataset.before && document.documentElement.lang==='sk',why:'detail not redrawn'})`, 5000, 'detail redrawn');
        result = await page.ev(status);
        assert(result.pressed === 'true' && result.allOn, 're-render lost original state');
        await page.ev(`(s=>{s.value=${JSON.stringify(sort)};s.dispatchEvent(new Event('change',{bubbles:true}))})(document.querySelector('#f-sort'))`);
        await page.waitFor(`({ok:document.querySelector('#f-sort').value===${JSON.stringify(sort)} && !!document.querySelector('${button}'),why:'sort not back'})`, 5000, 'sort back');
        await page.screenshot(`/tmp/ib-i18n-v2/${width}-sk-on.png`);
        await page.ev(`document.querySelector('${button}').click()`);
        result = await page.ev(status);
        assert(result.pressed === 'false' && result.allOff, 'toggle did not hide every original after re-render');
        await page.ev(`document.querySelector('${button}').click()`);
        await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language="en"]'))`);
        assert(await page.ev(`document.documentElement.lang === 'en' && !!document.querySelector('${detail} .kv dd') && !document.querySelector('${detail} .detail-originals, ${detail} .data-original, ${detail} .english-note')`), 'EN switch lost detail or retained Slovak controls');
        await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language="sk"]'))`);
        result = await page.ev(status);
        assert(result.pressed === 'false' && result.allOff, 'language change did not reset originals');
        assert(page.errors.length === 0, page.errors.map((error) => error.text).join(' | '));
      });
    } finally { await page.close(); }
  }
}

async function runRound2(base) {
  for (const width of [1280, 390]) {
    const page = await openPage(`${base}?ui=en&sort=deadline`, width, width === 390 ? 844 : 900);
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'navigation or loading pending'})`;
    const navigate = async (query = '?ui=en') => {
      await page.ev(`window.__oldPage=true;location.href=${JSON.stringify(base)}+${JSON.stringify(query)}`);
      await page.waitFor(ready, 15000, 'the reloaded page');
    };
    const edit = async () => {
      if (width < 600) {
        await page.click(`document.querySelector('#f-more')`, 'Filters to edit answers');
        await page.click(`document.querySelector('.sheet-edit')`, 'Edit my answers');
      } else await page.click(`document.querySelector('.status [data-edit]')`, 'Edit my answers');
      await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup not open'})`,5000,'setup');
    };
    // Batch 3 C1: step 5's primary is Finish, which opens the done screen; its
    // primary, "Show my programmes", then closes setup as step 5's used to.
    const next = async () => {
      await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'the next onboarding step');
      if (await page.ev(`Boolean(document.querySelector('#onboarding[open] .ob-done'))`)) await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Show my programmes');
    };
    try {
      await page.waitFor(ready,15000,'round 2 boot');
      await check(width,'R2A','first visit, quarter progress, draft Skip/Escape and dismissal',async()=>{
        await page.ev('localStorage.clear()'); await navigate();
        assert(await page.ev(`document.querySelector('#onboarding').open && document.querySelector('.ob-bar').hidden && document.activeElement.id==='ob-title'`),'welcome or initial focus/progress incorrect');
        assert(await page.ev(`getComputedStyle(document.querySelector('.ob-foot>.btn-p')).fontFamily.includes('IBM Plex Sans') && getComputedStyle(document.querySelector('#f-search')).fontFamily.includes('IBM Plex Sans')`),'controls do not use Plex');
        await next();
        assert(await page.ev(`document.querySelector('#ob-points').value==='' && document.querySelector('.ob-bar i').style.transform==='scaleX(0.25)'`),'points not blank or progress not 25%');
        await page.click(`document.querySelector('#ob-points')`,'draft points'); await page.type('36');
        assert(await page.ev(`document.querySelector('#f-points').value===''`),'draft changed the live filter');
        await page.ev(`document.querySelector('#dd-budget').open=true`);
        await page.key('Escape','Escape',27);
        assert(await page.ev(`!document.querySelector('#onboarding').open && document.querySelector('#f-points').value==='' && localStorage.getItem('ibuf.onboarding.v1')==='dismissed' && !localStorage.getItem('ibuf.filters.v1')`),'Escape applied or stored draft');
        await navigate();
        assert(await page.ev(`!document.querySelector('#onboarding').open`),'dismissed setup reopened');
      });
      // Leon, 2026-11-05: the stepper sat left on wide screens, and Skip setup
      // sat above Back/Next and right of its "Discards" hint (button padding).
      // On phones Next has its own full-width row (alignment audit), so Skip
      // shares Back's centre line there.
      await check(width,'R2J','setup stepper is centred; Skip text shares the Back/Next centre line and the hint edge',async()=>{
        await edit(); await next();
        const m=await page.ev(`(()=>{const box=(n)=>n.getBoundingClientRect(),text=(n)=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect()};
          const step=box(document.querySelector('.ob-step.on')),btns=[...document.querySelectorAll('.big-pts>*')].map(box),skip=text(document.querySelector('.skipwrap button')),hint=text(document.querySelector('.skipwrap small')),next=box(document.querySelector(${JSON.stringify(width < 600 ? '.ob-foot>.btn:not(.btn-p)' : '.ob-foot>.btn-p')}));
          return {offCentre:(btns[0].left+btns.at(-1).right)/2-(step.left+step.right)/2,lift:(next.top+next.height/2)-(skip.top+skip.height/2),indent:skip.left-hint.left};})()`);
        assert(Math.abs(m.offCentre)<=1 && Math.abs(m.lift)<=1 && Math.abs(m.indent)<=1,`setup layout off: ${JSON.stringify(m)}`);
        await page.ev(`document.querySelector('#onboarding').dispatchEvent(new Event('cancel',{cancelable:true}))`);
      });
      // Batch 3 C1: the FAQ link moved from step 1 to the done screen, and the
      // answers are applied before it opens the FAQ.
      await check(width,'R2M','the done screen\'s FAQ button applies the answers and lands on the FAQ below the sticky bar',async()=>{
        await page.ev(`window.scrollTo(0,0)`);
        await edit();
        assert(await page.ev(`!document.querySelector('#onboarding .ob-faq') && !document.querySelector('#onboarding .ob-step a')`),'step 1 still has a FAQ link');
        await page.click(`document.querySelector('.ob-foot>.btn-p')`,'Start');
        await page.click(`document.querySelector('#ob-points')`,'predicted points'); await page.type('39');
        for(let i=0;i<3;i++)await page.click(`document.querySelector('.ob-foot>.btn-p')`,'the next onboarding step');
        await page.click(`document.querySelector('.ob-foot>.btn-p')`,'Finish');
        assert(await page.ev(`document.querySelector('#onboarding').open && Boolean(document.querySelector('.ob-done')) && document.querySelector('#f-points').value==='39' && localStorage.getItem('ibuf.onboarding.v1')==='completed'`),'Finish did not apply and show the done screen');
        await page.click(`[...document.querySelectorAll('#onboarding .ob-foot .btn')].find(b=>b.textContent==='Read the FAQ')`,'Read the FAQ');
        assert(await page.ev(`!document.querySelector('#onboarding').open && document.querySelector('#f-points').value==='39'`),'FAQ button left setup open or lost the answers');
        assert(await page.ev(`document.activeElement===document.querySelector('#faq summary')`),'focus is not on the first FAQ question');
        await page.waitFor(`(()=>{const top=document.querySelector('#faq').getBoundingClientRect().top,bar=${width<600?"document.querySelector('.status').getBoundingClientRect().bottom":"document.querySelector('.hd').getBoundingClientRect().bottom"};return {ok:top>=bar-1 && top<innerHeight-40,why:JSON.stringify({top,bar})}})()`,5000,'the FAQ in view');
        // Leave no answers behind for R2B, which starts from blank fields.
        await page.ev(`document.querySelector('#f-clear').click();window.scrollTo(0,0)`);
        assert(await page.ev(`document.querySelector('#f-points').value===''`),'Clear all left the points');
      });
      await check(width,'R2B','answers apply once, typed budget exceeds slider, saved filters restore, URL wins without overwriting',async()=>{
        await edit(); await next();
        await page.click(`document.querySelector('#ob-points')`,'predicted points'); await page.type('38'); await next();
        assert(await page.ev(`document.querySelector('.ob-bar i').style.transform==='scaleX(0.5)'`),'step 3 not 50%');
        await page.ev(`document.querySelector('.ob-body').scrollTop=100000`);
        await next();
        assert(await page.ev(`document.querySelector('.ob-body').scrollTop===0 && document.activeElement.id==='ob-title'`),'new step heading scrolled out of view');
        assert(await page.ev(`document.querySelector('.ob-bar i').style.transform==='scaleX(0.75)' && document.querySelectorAll('#onboarding .flag').length===11`),'countries or progress incorrect');
        await page.click(`[...document.querySelectorAll('#onboarding .chip')].find(n=>n.textContent==='Ireland')`,'Ireland');
        await next();
        assert(await page.ev(`document.querySelector('#ob-budget').value==='' && document.querySelector('.ob-bar i').style.transform==='scaleX(1)'`),'budget not blank or progress not 100%');
        await page.click(`document.querySelector('#ob-budget')`,'yearly budget'); await page.type('50000');
        assert(await page.ev(`document.querySelector('#ob-budget').value==='50000' && document.querySelector('#ob-range').value==='40000'`),'slider capped typed amount');
        await next();
        assert(await page.ev(`!document.querySelector('#onboarding').open && document.querySelector('#f-points').value==='38' && document.querySelector('#f-budget').value==='50000' && localStorage.getItem('ibuf.onboarding.v1')==='completed' && document.activeElement.getAttribute('aria-labelledby')==='results-h'`),'answers not applied or focus wrong');
        await page.waitFor(`({ok:JSON.parse(localStorage.getItem('ibuf.filters.v1'))?.filters.myIbPoints===38,why:'answers not persisted'})`,5000,'debounced answers');
        await navigate();
        assert(await page.ev(`document.querySelector('#f-points').value==='38' && document.querySelector('#f-budget').value==='50000' && document.querySelector('#f-countries input[value=Ireland]').checked`),'saved filters did not restore');
        await navigate('?ui=en&points=24');
        assert(await page.ev(`document.querySelector('#f-points').value==='24' && document.querySelector('#f-budget').value==='' && JSON.parse(localStorage.getItem('ibuf.filters.v1')).filters.myIbPoints===38`),'URL merged with or overwrote saved filters');
        await page.ev(`document.querySelector('#f-points').value='37';document.querySelector('#f-points').dispatchEvent(new Event('input',{bubbles:true}))`);
        await page.waitFor(`({ok:JSON.parse(localStorage.getItem('ibuf.filters.v1')).filters.myIbPoints===37,why:'explicit edit not saved'})`,5000,'saved explicit edit');
        await page.ev(`document.querySelector('#f-clear').click()`);
        assert(await page.ev(`!localStorage.getItem('ibuf.filters.v1') && localStorage.getItem('ibuf.onboarding.v1')==='completed'`),'Clear all removed onboarding state or retained filters');
      });
      await check(width,'R2C','help, inner Escape, focus return, custom zero budget and no overflow',async()=>{
        if(width<600){
          await page.click(`document.querySelector('#f-more')`,'phone Filters');
          assert(await page.ev(`getComputedStyle(document.querySelector('#f-mymaths')).display!=='none' && document.querySelector('.mark').getBoundingClientRect().height>=44 && document.querySelector('.mark').getBoundingClientRect().width>=44`),'phone maths select or header touch target missing');
          assert(await page.ev(`getComputedStyle(document.querySelector('#results .c-pts .lab')).display!=='none'`),'unknown points lost their phone metric label');
        }
        await page.click(`document.querySelector('.info[aria-controls="f-maths-help"]')`,'HL Maths help');
        await page.ev(`document.querySelector('#dd-budget').open=true`);
        await page.key('Escape','Escape',27);
        assert(await page.ev(`!document.querySelector('#dd-budget').open && document.querySelector('.info[aria-controls="f-maths-help"]').getAttribute('aria-expanded')==='true'`),'Escape closed help along with panel');
        await page.key('Escape','Escape',27);
        assert(await page.ev(`document.querySelector('.info[aria-controls="f-maths-help"]').getAttribute('aria-expanded')==='false' && document.activeElement.classList.contains('info')`),'help did not close/return focus');
        if(width<600){
          assert(await page.ev(`document.querySelector('#filter-sheet').open`),'inner Escape closed sheet');
          await page.key('Escape','Escape',27);
          assert(await page.ev(`!document.querySelector('#filter-sheet').open && document.activeElement.id==='f-more'`),'sheet Escape/focus failed');
        }
        assert(await page.ev(`document.documentElement.scrollWidth===innerWidth`),'horizontal overflow');
        assert(page.errors.length===0,page.errors.map(e=>e.text).join(' | '));
      });
      // Leon, 2026-11-05: phone help and the sheet's filter rows jumped open and
      // shut; the desktop help bubble was a fixed 260 px at 13.5 px.
      if(width<600)await check(width,'R2K','sheet help and filter rows animate open and closed, settle after re-toggling, and are instant with reduced motion',async()=>{
        await page.click(`document.querySelector('#f-more')`,'phone Filters');
        await page.waitFor(`({ok:document.querySelector('#filter-sheet').getAnimations({subtree:true}).length===0,why:'sheet still sliding'})`,3000,'settled sheet');
        try {
        const tip=`document.getElementById('f-points-help')`,info=`document.querySelector('.sheet-b .info[aria-controls="f-points-help"]')`,below=`document.querySelector('.sheet-b .f-hl').getBoundingClientRect().top`;
        const props=`${tip}.getAnimations().map(a=>a.transitionProperty).sort().join()`;
        const top=await page.ev(below);
        await page.ev(`${info}.click()`);
        const opening=await page.ev(props);
        assert(['height','opacity','transform'].every(n=>opening.includes(n)),`help opens without its motion: ${opening}`);
        await page.waitFor(`({ok:${tip}.getAnimations().length===0,why:'still opening'})`,3000,'help open');
        await page.ev(`${info}.click()`);
        const closing=await page.ev(`({p:${props},d:getComputedStyle(${tip}).display})`);
        assert(closing.p.includes('height') && closing.p.includes('opacity') && closing.d==='block',`help closes in one frame: ${JSON.stringify(closing)}`);
        for(let i=0;i<3;i++)await page.ev(`${info}.click()`);
        await page.waitFor(`({ok:${tip}.getAnimations().length===0,why:'still moving'})`,3000,'re-toggled help');
        assert(await page.ev(`${tip}.classList.contains('is-open') && ${info}.getAttribute('aria-expanded')==='true' && Math.abs(${tip}.getBoundingClientRect().height-${tip}.scrollHeight)<1`),'re-toggled help left stale state');
        await page.ev(`${info}.click()`);
        await page.waitFor(`({ok:getComputedStyle(${tip}).display==='none' && Math.abs(${below}-${top})<1,why:'row below at '+${below}+', not '+${top}})`,3000,'help closed, rows back');
        // A ::details-content transition is not listed by getAnimations(), so read its computed style.
        const content=`(()=>{const c=getComputedStyle(document.querySelector('#dd-budget'),'::details-content');return CSS.supports('interpolate-size','allow-keywords') && c.transitionProperty.split(', ')[0]==='height' && c.transitionDuration.split(', ')[0]==='0.26s'})()`;
        await page.ev(`document.querySelector('#dd-budget summary').click()`);
        assert(await page.ev(content),'Budget row opens without its height motion');
        await page.ev(`document.querySelector('#dd-budget summary').click()`);
        // 2026-11-06: this read the height as 0px at once, which only held when
        // no frame ran between the two clicks; otherwise the close reverses from
        // part-way open (the 146da9d baseline showed 120-225 px too). Check the
        // closing motion is set, then that it ends at 0.
        assert(await page.ev(content),'Budget row closes without its height motion');
        await page.waitFor(`({ok:getComputedStyle(document.querySelector('#dd-budget'),'::details-content').height==='0px',why:'Budget row height '+getComputedStyle(document.querySelector('#dd-budget'),'::details-content').height})`,3000,'the Budget row closed');
        await page.ev(`document.querySelector('#dd-budget summary').click()`);
        await page.waitFor(`({ok:document.getAnimations().length===0,why:'still moving'})`,3000,'re-toggled Budget');
        assert(await page.ev(`document.querySelector('#dd-budget').open && document.querySelector('#dd-budget summary').getAttribute('aria-expanded')==='true'`),'re-toggled Budget left stale state');
        await page.ev(`document.querySelector('#dd-budget').open=false`);
        await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        try {
          await page.ev(`${info}.click()`);
          assert(await page.ev(`${tip}.getAnimations().length===0 && getComputedStyle(${tip}).opacity==='1'`),'reduced motion still animates help');
          await page.ev(`${info}.click()`);
          assert(await page.ev(`getComputedStyle(${tip}).display==='none'`),'reduced motion help did not close at once');
        } finally { await page.send('Emulation.setEmulatedMedia',{features:[]}); }
        } finally { await page.ev(`document.querySelector('#filter-sheet').close()`); }
      });
      if(width>=600)await check(width,'R2L','the help bubble is sized to its text in small UI type',async()=>{
        await page.ev(`window.scrollTo(0,0)`);
        await page.click(`document.querySelector('.info[aria-controls="f-maths-help"]')`,'HL Maths help');
        const m=await page.ev(`(()=>{const t=document.getElementById('f-maths-help'),c=getComputedStyle(t),r=document.createRange();r.selectNodeContents(t);return {w:t.getBoundingClientRect().width,text:r.getBoundingClientRect().width,fs:c.fontSize,pad:c.paddingLeft}})()`);
        assert(m.w<=260 && m.w-m.text<=24 && m.fs==='12px',`help bubble too big: ${JSON.stringify(m)}`);
        await page.key('Escape','Escape',27);
      });
      if(width>=600)await check(width,'R2F','every open facet and Budget panel stays within the viewport',async()=>{
        await page.ev(`window.scrollTo(0,0)`);
        for(const id of ['dd-subjects','dd-countries','dd-languages','dd-cities','dd-degrees','dd-deadline','dd-exam','dd-budget']){
          await page.click(`document.querySelector('#${id} summary')`,id);
          await page.waitFor(`(()=>{const panel=document.querySelector('#${id} .dropdown-panel'),r=panel.getBoundingClientRect();return {ok:document.querySelector('#${id}').open && !panel.getAnimations().some(a=>a.playState==='running') && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight,why:JSON.stringify({left:r.left,right:r.right,bottom:r.bottom})};})()`,5000,`${id} settled inside viewport`);
          await page.key('Escape','Escape',27);
        }
      });
      await check(width,'R2G','reduced motion is instant; invalid answers block Next; Skip discards both points and budget',async()=>{
        await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        try {
          await edit();
          assert(await page.ev(`getComputedStyle(document.querySelector('#onboarding')).transitionDuration==='0s' && getComputedStyle(document.querySelector('.ob-step')).animationName==='none'`),'setup still animates');
          await next();
          await page.ev(`{const input=document.querySelector('#ob-points');input.value='23';input.dispatchEvent(new Event('input',{bubbles:true}))}`);
          assert(await page.ev(`document.querySelector('.ob-foot>.btn-p').disabled && document.querySelector('#ob-points').getAttribute('aria-invalid')==='true'`),'invalid points accepted');
          await page.click(`document.querySelector('.skipwrap button')`,'Skip invalid points');
          await edit(); for(let i=0;i<4;i++)await next();
          await page.ev(`{const input=document.querySelector('#ob-budget');input.value='-1';input.dispatchEvent(new Event('input',{bubbles:true}))}`);
          assert(await page.ev(`document.querySelector('.ob-foot>.btn-p').disabled`),'negative budget accepted');
          await page.ev(`{const slider=document.querySelector('#ob-range');slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}))}`);
          assert(await page.ev(`!document.querySelector('.ob-foot>.btn-p').disabled && document.querySelector('#ob-budget').value==='0' && document.querySelector('#ob-range').classList.contains('set')`),'zero slider budget refused');
          await page.click(`document.querySelector('.skipwrap button')`,'Skip draft zero budget');
          assert(await page.ev(`document.querySelector('#f-points').value==='' && document.querySelector('#f-budget').value==='' && !localStorage.getItem('ibuf.filters.v1')`),'Skip committed draft');
        } finally {
          await page.ev(`if(document.querySelector('#onboarding').open)document.querySelector('#onboarding').dispatchEvent(new Event('cancel',{cancelable:true}))`);
          await page.send('Emulation.setEmulatedMedia',{features:[]});
        }
      });
      await check(width,'R2H','blocked localStorage is caught for preference and onboarding access',async()=>{
        assert(await page.ev(`(async()=>{const mod=await import('./js/onboarding.js'),descriptor=Object.getOwnPropertyDescriptor(window,'localStorage');try{Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new Error('storage blocked')}});return mod.readSaved()===null && mod.readDismissed()===false && mod.writeSaved(null)===undefined && mod.writeSaved({version:1,filters:{}})===undefined;}finally{Object.defineProperty(window,'localStorage',descriptor)}})()`),'storage exception escaped');
      });
      if(width>=600)await check(width,'R2I','200% layout keeps long SK controls and facet panels inside the viewport; non-scrolling lists have no fade',async()=>{
        await page.send('Emulation.setDeviceMetricsOverride',{width:640,height:450,deviceScaleFactor:1,mobile:false});
        try {
          await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=sk]'));window.scrollTo(0,0)`);
          await page.waitFor(`(()=>{const w=innerWidth,sw=document.documentElement.scrollWidth,display=getComputedStyle(document.querySelector('#f-mymaths')).display;return {ok:w===640 && sw===w && display!=='none',why:JSON.stringify({w,sw,display,dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id)})}})()`,5000,'zoomed controls');
          await page.click(`document.querySelector('#dd-languages summary')`,'zoomed language panel');
          await page.waitFor(`(()=>{const box=document.querySelector('#f-languages');return {ok:box.classList.contains('at-end')===(box.scrollTop+box.clientHeight>=box.scrollHeight-4),why:'fade cue disagrees with scroll extent'}})()`,5000,'fade cue');
          // Settled, as R2F: the height cap is set by the toggle event, which comes after the click.
          await page.waitFor(`(()=>{const panel=document.querySelector('#dd-languages .dropdown-panel'),r=panel.getBoundingClientRect();return {ok:document.querySelector('#dd-languages').open && !panel.getAnimations().some(a=>a.playState==='running') && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight,why:'zoomed facet escapes viewport: '+JSON.stringify({left:r.left,right:r.right,bottom:r.bottom})};})()`,5000,'zoomed facet inside viewport');
          await page.key('Escape','Escape',27);
        } finally {
          await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
          await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=en]'))`);
        }
      });
      if(width>=600)await check(width,'R2D','compact header keeps its slot, focused controls stay still and short viewports do not stick',async()=>{
        await page.ev(`document.activeElement.blur();window.scrollTo(0,700)`);
        await page.waitFor(`({ok:document.body.classList.contains('compact'),why:'header not compact'})`,5000,'compact header');
        const size=await page.ev(`({h:document.querySelector('.hd').offsetHeight,x:document.querySelector('#f-search').getBoundingClientRect().left})`);
        assert(size.h===56,'compact header changed layout height');
        assert(await page.ev(`getComputedStyle(document.querySelector('.hd')).transform==='none' && getComputedStyle(document.querySelector('.hd-in')).transform==='none' && getComputedStyle(document.body).getPropertyValue('--header-visible')==='56px' && document.querySelector('.hd').getBoundingClientRect().bottom===56`),'compact header translated or offset shrank');
        await page.ev(`window.scrollTo(0,0)`); await page.waitFor(`({ok:!document.body.classList.contains('compact'),why:'not expanded at top'})`,5000,'expanded header');
        assert(await page.ev(`document.querySelector('#f-search').getBoundingClientRect().left===${size.x}`),'search moved sideways');
        await page.ev(`document.querySelector('#f-search').focus();window.scrollTo(0,700)`);
        assert(await page.ev(`!document.body.classList.contains('compact')`),'focused header control moved');
        await page.ev(`document.activeElement.blur();window.scrollTo(0,0)`);
        await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:500,deviceScaleFactor:1,mobile:false});
        assert(await page.ev(`getComputedStyle(document.querySelector('.hd')).position!=='sticky'`),'short viewport header sticks');
        await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      });
      if(width>=600)await check(width,'R2E','full-dataset country widening and narrowing settle before another change',async()=>{
        await page.ev(`document.querySelector('#f-clear').click();document.activeElement.blur();window.scrollTo(0,0)`);
        const settled = (count) => `({ok:document.querySelectorAll('#results>li.item').length===${count} && !document.querySelector('.results[aria-hidden=true]'),why:'rows or retired list still pending'})`;
        await page.waitFor(settled(2915),10000,'all rows before country change');
        const ireland = `[...document.querySelectorAll('#f-countries input')].find(n=>n.value==='Ireland')`;
        for(let i=0;i<2;i++){
          await page.ev(`${ireland}.click()`);
          await page.waitFor(`({ok:document.querySelectorAll('#results>li.item').length>0 && document.querySelectorAll('#results>li.item').length===Number(document.querySelector('#result-count b').textContent.replace(/[^0-9]/g,'')) && document.querySelectorAll('#results>li.item').length<2915 && !document.querySelector('.results[aria-hidden=true]'),why:'narrowed rows still pending'})`,10000,'settled Ireland rows');
          await page.ev(`${ireland}.click()`);
          await page.waitFor(settled(2915),10000,'settled full catalogue');
        }
        // L09 timing is a separate paired run: AC power, quiet machine, 4x CPU.
      });
    } finally { await page.ev('localStorage.clear()').catch(()=>{}); await page.close(); }
  }
}

// Design round 2, review round 2: what only a real layout can show.
async function runReview2(base) {
  const open = async (query, width, height) => {
    const page = await openPage(`${base}${query}`, width, height);
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'navigation or loading pending'})`;
    await page.waitFor(ready, 15000, 'the page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'the reloaded page');
    return page;
  };
  const box = (selector) => `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()`;
  let page = await open('?ui=sk&country=Ireland&points=36', 1280, 900);
  try {
    await check(1280, 'R3A', 'a real mouse click puts focus in the facet search, every time', async () => {
      for (const id of ['dd-subjects', 'dd-subjects', 'dd-cities']) {
        await page.ev(`document.querySelector('#${id}').open=false;document.activeElement.blur()`);
        await page.click(`document.querySelector('#${id} summary')`, id);
        await page.waitFor(`({ok:document.querySelector('#${id}').contains(document.activeElement) && document.activeElement.type==='search',why:String(document.activeElement.tagName)})`, 3000, `${id} search focus`);
      }
      await page.key('Escape', 'Escape', 27);
    });
    await check(1280, 'R3B', 'Deadline and Entrance exam are 40 px radios that drive their hidden select', async () => {
      for (const [id, select, value, any] of [['dd-deadline', 'f-deadline', '30', 'any'], ['dd-exam', 'f-exam', 'none', '']]) {
        await page.click(`document.querySelector('#${id} summary')`, id);
        assert(await page.ev(`(()=>{const rows=[...document.querySelectorAll('#${id} .options .option')];return rows.length>2 && rows.every(n=>n.offsetHeight>=40) && rows.every(n=>n.querySelector('input[type=radio]')) && getComputedStyle(document.querySelector('#${select}')).display==='none'})()`), `${id} radio rows`);
        await page.click(`document.querySelector('#${id} input[value="${value}"]')`, `${id} radio`);
        await page.waitFor(`({ok:document.querySelector('#${select}').value===${JSON.stringify(value)} && document.querySelector('#${id}').classList.contains('is-set'),why:'select not driven'})`, 3000, `${select} value`);
        await page.click(`document.querySelector('#${id} .pop-f .btn')`, `${id} clear`);
        await page.waitFor(`({ok:document.querySelector('#${select}').value===${JSON.stringify(any)} && document.querySelector('#${id} input[value="${any}"]').checked && !document.querySelector('#${id}').classList.contains('is-set'),why:'radio not repainted from the select'})`, 3000, `${select} cleared`);
        await page.key('Escape', 'Escape', 27);
      }
    });
    await check(1280, 'R3C', 'headings sit over the values; the status row is 36 px and Edit is semibold', async () => {
      await page.ev(`window.scrollTo(0,0)`);
      const m = await page.ev(`(()=>{const left=(s)=>${"document.querySelector(s).getBoundingClientRect().left"},right=(s)=>document.querySelector(s).getBoundingClientRect().right;return {hp:left('.cols [data-sort=points] span'),vp:left('.row .v-fit .fig'),hd:left('.cols [data-sort=deadline] span'),vd:left('.row .c-ddl:not(.v-unk) .fig'),hf:right('.cols [data-sort=tuition] span'),vf:right('.row .c-fee:not(.v-unk) .fig'),copy:document.querySelector('#f-copy').getBoundingClientRect().height,weight:getComputedStyle(document.querySelector('.status .edit-answers')).fontWeight}})()`);
      assert(Math.abs(m.hp - m.vp) < 2 && Math.abs(m.hd - m.vd) < 2 && Math.abs(m.hf - m.vf) < 2, `headings off: ${JSON.stringify(m)}`);
      assert(m.copy === 36 && m.weight === '600', `status row: ${JSON.stringify(m)}`);
    });
    await check(1280, 'R3D', 'the pane title keeps its space and its × covers nothing, in Slovak', async () => {
      await page.click(`document.querySelectorAll('#results .row .open')[1]`, 'a row');
      await page.waitFor(`({ok:!!document.querySelector('.pane .detail-originals') && !document.querySelector('#pane-close').hidden,why:'no translated pick'})`, 5000, 'the picked pane');
      const m = await page.ev(`(()=>{const a=${box('.pane .detail-originals')},b=${box('#pane-close')},title=document.querySelector('.pane .d-title'),range=document.createRange();range.selectNodeContents(title);const degree=title.querySelector('.deg,.unk-t').getBoundingClientRect(),first=range.getClientRects()[0];return {text:title.textContent,overlap:a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom,space:degree.top>first.bottom-2||degree.left-first.right}})()`);
      assert(!m.overlap, '× overlaps the originals button');
      assert(/, \S/.test(m.text), `title text ${m.text}`);
      assert(m.space === true || m.space >= 3, `no visible space before the degree: ${m.space}`);
      await page.click(`document.querySelector('#pane-close')`, 'pane close');
    });
    await check(1280, 'R3E', 'a points error is a popover: it moves nothing and is on top', async () => {
      const before = await page.ev(`${box('#dd-subjects')}.top`);
      await page.ev(`{const p=document.querySelector('#f-points');p.value='99';p.dispatchEvent(new Event('input',{bubbles:true}))}`);
      await page.waitFor(`({ok:document.querySelector('.chipbox .err').textContent!=='',why:'no error'})`, 3000, 'the points error');
      const m = await page.ev(`(()=>{const e=document.querySelector('.chipbox .err'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {top:${box('#dd-subjects')}.top,position:s.position,shadow:s.boxShadow,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
      assert(m.top === before && m.position === 'absolute' && m.shadow !== 'none' && m.hit, JSON.stringify(m));
    });
  } finally { await page.close(); }
  for (const [lang, query] of [['sk', '&country=Ireland&points=36'], ['en', '&country=Ireland&points=36'], ['en', ''], ['sk', '']]) {
    page = await open(`?ui=${lang}${query}`, 320, 640);
    try {
      await check(320, 'R3F', `${lang}${query ? ' filtered' : ''}: no cell overflows or breaks inside a word, and the search placeholder fits`, async () => {
        const m = await page.ev(`(()=>{const bad=[];for(const row of [...document.querySelectorAll('#results .row')].slice(0,40)){const rr=row.getBoundingClientRect();for(const cell of row.querySelectorAll('.cell')){const r=cell.getBoundingClientRect();const fig=cell.querySelector('.fig,.verd')?.getBoundingClientRect();if(r.left<rr.left-1||r.right>rr.right+1||cell.scrollWidth>cell.clientWidth+1||(fig&&(fig.left<r.left-1||fig.right>r.right+1)))bad.push(cell.className+':'+cell.textContent);if(getComputedStyle(cell).overflowWrap!=='normal')bad.push('wrap:'+cell.className)}}
          const input=document.querySelector('#f-search'),s=getComputedStyle(input),ctx=document.createElement('canvas').getContext('2d');ctx.font=s.font;return {bad:bad.slice(0,5),sw:document.documentElement.scrollWidth,need:ctx.measureText(input.placeholder).width,room:input.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)}})()`);
        assert(m.sw === 320, `page is ${m.sw} wide`);
        assert(m.bad.length === 0, m.bad.join(' | '));
        assert(m.need <= m.room, `placeholder needs ${m.need}, has ${m.room}`);
      });
    } finally { await page.close(); }
  }
  // A touch screen at any width: 44 px, measured rather than read from the CSS.
  for (const [width, height] of [[1280, 900], [800, 1000], [390, 844]]) {
    page = await open('?ui=sk&country=Ireland&points=36', width, height);
    try {
      await check(width, 'R3G', 'on a touch screen controls, onboarding and the pane close are at least 44 px', async () => {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        assert(await page.ev(`matchMedia('(pointer:coarse)').matches`), 'touch emulation did not give pointer:coarse');
        // offsetHeight, the layout size: panels and the dialog scale in, which a rect would measure.
        const small = (selector) => page.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n=>n.offsetWidth&&n.offsetHeight<44).map(n=>(n.id||n.className)+':'+n.offsetHeight)`);
        if (width < 600) await page.ev(`document.querySelector('#f-more').click()`);
        const bar = await small('.chipbox,.seg button,.dropdown>summary,.info,.step,.maths-control>select,.hd .btn,.hd .lang button,.search .inp');
        assert(bar.length === 0, `filter controls: ${bar}`);
        await page.ev(`document.querySelector('#dd-budget').open=true`);
        const budget = await small('.budget .inp,.budget input[type=range],.pop-f .btn');
        assert(budget.length === 0, `budget: ${budget}`);
        await page.ev(`document.querySelector('#dd-budget').open=false`);
        if (width >= 1200) {
          await page.ev(`document.querySelectorAll('#results .row .open')[1].click()`);
          await page.waitFor(`({ok:!document.querySelector('#pane-close').hidden,why:'no pick'})`, 5000, 'the pick');
          assert(await page.ev(`(()=>{const r=${box('#pane-close')};return r.width>=44&&r.height>=44})()`), 'pane close under 44 px');
          await page.ev(`document.querySelector('#pane-close').click()`);
        }
        await page.ev(`document.querySelector('[data-edit]:not(.sheet-edit)')?.offsetParent ? document.querySelector('[data-edit]:not(.sheet-edit)').click() : document.querySelector('.sheet-edit').click()`);
        await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup not open'})`, 5000, 'setup');
        for (let i = 0; i < 5; i++) {
          const ob = await small('#onboarding .ob-step.on .chip,#onboarding .ob-foot .btn,#onboarding .ob-step.on .big-pts .btn,#onboarding .ob-step.on .rng-top .inp,#onboarding .ob-step.on input[type=range],#onboarding .ob-step.on .ob-faq');
          assert(ob.length === 0, `onboarding step ${i + 1}: ${ob}`);
          if (i < 4) await page.ev(`document.querySelector('.ob-foot>.btn-p').click()`);
        }
        assert(await page.ev(`document.documentElement.scrollWidth===innerWidth`), 'horizontal overflow');
      });
    } finally { await page.close(); }
  }
  // Leon, 2026-11-05: on a phone My list wrapped its buttons unevenly, left
  // Clear my list alone on a row and its Sort by box detached below.
  for (const [ui, n] of [['sk', 1], ['sk', 3], ['en', 3]]) {
    const phone = await open(`?ui=${ui}`, 390, 844);
    try {
      await check(390, 'R3H', `My list on a phone is one even toolbar (${ui.toUpperCase()}, ${n} saved)`, async () => {
        await phone.ev(`(()=>{const ids=[...document.querySelectorAll('#results>li.item')].slice(0,${n}).map(li=>li.dataset.id);localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify(ids));window.__oldPage=true;location.reload()})()`);
        await phone.waitFor(`({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'reload pending'})`, 15000, 'the reloaded page');
        await phone.click(`document.querySelector('#header-list')`, 'My list');
        await phone.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list') && !document.querySelector('#ml-tools').hidden,why:'list view not open'})`, 5000, 'the list view');
        // The tools wait behind More since 2026-11-06 (runPhoneMyListCompare).
        await phone.click(`document.querySelector('#ml-more')`, 'More');
        // Batch 3 B2 (Leon, 2026-11-05) edited this: Clear my list is now an
        // outlined button in the even grid, not quiet text that may sit alone
        // (it looked like an empty cell). The Compare picker, while it still
        // exists (workstream A removes it), takes its own full row.
        const m = await phone.ev(`(()=>{const box=(n)=>n.getBoundingClientRect();
          const all=[...document.querySelectorAll('#ml-tools>.btn,#ml-tools>.ml-pop>summary')].filter(n=>n.offsetParent);
          const tools=all.filter(n=>!n.closest('#ml-compare'));
          const rows=new Map();for(const n of tools){const r=box(n),k=Math.round(r.top);rows.set(k,[...(rows.get(k)||[]),n])}
          const plain=tools.map(n=>Math.round(box(n).width));
          const g=box(document.querySelector('#ml-group')),s=box(document.querySelector('#dd-sort>summary'));
          return {lone:[...rows.values()].filter(r=>r.length===1).map(r=>r[0].textContent.trim()),widths:[...new Set(plain)],short:all.filter(n=>box(n).height<44).map(n=>n.textContent.trim()),
            selects:[g.left-s.left,g.right-s.right],gap:box(document.querySelector('.listp')).top-box(document.querySelector('#shortlist-bar')).bottom,sw:document.documentElement.scrollWidth-innerWidth}})()`);
        assert(m.lone.length === 0 && m.widths.length === 1 && m.short.length === 0, `uneven actions: ${JSON.stringify(m)}`);
        assert(m.selects.every((d) => Math.abs(d) <= 1), `Group by and Sort by do not line up: ${JSON.stringify(m)}`);
        assert(Math.abs(m.gap) <= 1 && m.sw === 0, `list panel detached or overflowing: ${JSON.stringify(m)}`);
      });
    } finally { await phone.close(); }
  }
}

// Batch 2 workstreams (plans/design-round2/batch2-plan.md); each fills only its own.
async function runBatch2A(base) {
  // The watchdog is one limit for the whole run and the checks before this already
  // take most of it. A fresh 120 s here still catches a hang in this section.
  watchdog.refresh();
  const open = async (query, width, height) => {
    const page = await openPage(`${base}${query}`, width, height);
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'navigation or loading pending'})`;
    await page.waitFor(ready, 15000, 'the page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'the reloaded page');
    return page;
  };
  const settle = (page) => page.ev(`new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(done)))`);
  const resize = async (page, width, height, mobile = false) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await page.waitFor(`({ok:innerWidth===${width},why:'width '+innerWidth})`, 3000, `width ${width}`);
    await settle(page);
  };
  const language = async (page, lang) => {
    await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=${lang}]'))`);
    await page.waitFor(`({ok:document.documentElement.lang==='${lang}',why:document.documentElement.lang})`, 3000, `language ${lang}`);
    await settle(page);
  };
  const clickAt = async (page, x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const hits = 'const hits=(a,b)=>!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);';
  // What a screen reader gets, from the browser's own accessibility tree.
  const axNode = async (page, selector) => {
    const { result } = await page.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    const { nodes } = await page.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
    return nodes[0];
  };

  let page = await open('?ui=sk', 320, 640);
  try {
    for (const lang of ['sk', 'en']) {
      await language(page, lang);
      for (const width of [320, 390, 599]) {
        await resize(page, width, 800);
        await check(width, 'R4A', `logo (${lang}): a 44 px tile, as tall as Search, in a 44 px hit area that stays off Search`, async () => {
          const m = await page.ev(`(()=>{${hits}const box=(s)=>document.querySelector(s).getBoundingClientRect(),t=box('.mono'),k=box('.mark'),q=box('#f-search');
            return {tile:[t.width,t.height],mark:[k.width,k.height],left:k.left,over:hits(k,q),off:Math.abs((t.left+t.right)-(k.left+k.right))/2,offY:Math.abs((t.top+t.bottom)-(k.top+k.bottom))/2,sw:document.documentElement.scrollWidth,w:innerWidth,search:q.width}})()`);
          assert(m.tile[0] === 44 && m.tile[1] === 44, `tile ${m.tile}`);
          assert(m.mark[0] >= 44 && m.mark[1] >= 44 && m.left >= 0, `hit area ${m.mark} at ${m.left}`);
          assert(m.off <= 1 && m.offY <= 1, `tile not centred: ${m.off}, ${m.offY}`);
          assert(!m.over, 'the logo overlaps Search');
          assert(m.sw === m.w, `page is ${m.sw} wide at ${m.w}`);
          assert(m.search >= 80, `Search is only ${m.search} wide`);
        });
      }
    }
  } finally { await page.close(); }

  page = await open('?ui=sk', 700, 800);
  try {
    for (const lang of ['sk', 'en']) {
      await language(page, lang);
      for (const width of [600, 650, 700]) {
        await check(width, 'R4A', `logo on a touch screen (${lang}): keeps off Search, same header height, a visible focus ring`, async () => {
          await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
          await resize(page, width, 800);
          const fine = await page.ev(`({h:document.querySelector('.hd').offsetHeight,tile:document.querySelector('.mono').offsetWidth,coarse:matchMedia('(pointer:coarse)').matches})`);
          assert(!fine.coarse && fine.tile === 36, `fine pointer tile: ${JSON.stringify(fine)}`);
          await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
          await resize(page, width, 800, true);
          assert(await page.ev(`matchMedia('(pointer:coarse)').matches`), 'touch emulation did not give pointer:coarse');
          await page.ev(`document.querySelector('.skip-link').focus()`);
          await page.key('Tab', 'Tab', 9);
          // An outline is not hit-tested, so elementFromPoint can only test the
          // box; the ring's outer edge is checked against Search by geometry.
          const m = await page.ev(`(()=>{${hits}const mark=document.querySelector('.mark'),k=mark.getBoundingClientRect(),q=document.querySelector('#f-search').getBoundingClientRect(),s=getComputedStyle(mark),grow=parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset),ring={left:k.left-grow,right:k.right+grow,top:k.top-grow,bottom:k.bottom+grow};
            const corners=[[k.left+1,k.top+1],[k.right-1,k.top+1],[k.left+1,k.bottom-1],[k.right-1,k.bottom-1]].map(([x,y])=>document.elementFromPoint(x,y));
            return {focused:document.activeElement===mark&&mark.matches(':focus-visible'),style:s.outlineStyle,grow,over:hits(k,q),ringOver:hits(ring,q),inside:ring.left>=0&&ring.top>=0&&ring.right<=innerWidth&&ring.bottom<=innerHeight,covered:corners.filter(n=>!mark.contains(n)).map(n=>n&&(n.id||n.className)),mark:[k.width,k.height],tile:document.querySelector('.mono').offsetWidth,h:document.querySelector('.hd').offsetHeight,sw:document.documentElement.scrollWidth,w:innerWidth}})()`);
          await page.ev(`document.activeElement.blur()`);
          await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
          await resize(page, width, 800);
          assert(m.focused && m.style !== 'none' && m.grow > 0, `no focus ring: ${JSON.stringify(m)}`);
          assert(!m.over && !m.ringOver && m.inside, `ring or hit area collides: ${JSON.stringify(m)}`);
          assert(m.covered.length === 0, `covered by ${m.covered}`);
          assert(m.mark[0] >= 44 && m.mark[1] >= 44 && m.tile === 44, `sizes ${JSON.stringify(m)}`);
          assert(m.h === fine.h, `header ${m.h}, fine pointer ${fine.h}`);
          assert(m.sw === m.w, `page is ${m.sw} wide at ${m.w}`);
        });
      }
    }
  } finally { await page.close(); }

  page = await open('?ui=en&country=Ireland&points=36', 1280, 900);
  try {
    await page.send('Accessibility.enable');
    const before = await page.ev(`location.search`);
    const scrollAndClick = async (y, atBottom) => {
      await page.ev(`document.activeElement.blur();window.scrollTo({top:${y},behavior:'instant'})`);
      await settle(page);
      assert(await page.ev(`scrollY===${y} && !document.body.classList.contains('compact')`), 'not at the scroll position, or compact');
      const r = await page.ev(`(()=>{const r=document.querySelector('.mark').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,bottom:r.bottom}})()`);
      await clickAt(page, r.x, atBottom ? r.bottom - 3 : r.y);
    };
    const landed = () => page.ev(`({search:location.search,hash:location.hash,mark:document.activeElement===document.querySelector('.mark'),stayed:window.__stayed===true,list:document.querySelectorAll('#results .row').length})`);
    const expectLanded = async () => {
      await page.waitFor(`({ok:scrollY===0,why:'scrollY '+scrollY+' active '+document.activeElement.className})`, 5000, 'the top of the page');
      const m = await landed();
      assert(m.search === before && m.hash === '' && m.mark && m.stayed && m.list > 0, JSON.stringify(m));
    };
    await page.ev(`window.__stayed=true`);
    await check(1280, 'R4B', 'logo click scrolls to the top; filters, address and focus stay', async () => {
      await scrollAndClick(120, false);
      await expectLanded();
    });
    await check(1280, 'R4B', 'Enter on the logo does the same; reduced motion is instant', async () => {
      await page.ev(`window.scrollTo({top:120,behavior:'instant'});document.querySelector('.mark').focus()`);
      await settle(page);
      // Batch 2 A review: the Enter case once failed on timing. Start only from a known position.
      await page.waitFor(`({ok:scrollY===120&&!document.body.classList.contains('compact')&&document.activeElement===document.querySelector('.mark'),why:'y '+scrollY})`, 2000, 'start position');
      await page.key('Enter', 'Enter', 13, [], '\r');
      await expectLanded();
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      try {
        await scrollAndClick(120, false);
        assert(await page.ev(`scrollY`) === 0, 'reduced motion: the scroll was not instant');
        await expectLanded();
      } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
    });
    await resize(page, 390, 844);
    await check(390, 'R4B', 'logo click on a phone scrolls to the top; filters, address and focus stay', async () => {
      await scrollAndClick(40, true);
      await expectLanded();
    });
    for (const [width, lang] of [[320, 'sk'], [390, 'en'], [650, 'sk'], [650, 'en'], [1280, 'sk'], [1280, 'en']]) {
      await language(page, lang);
      await resize(page, width, 844);
      await check(width, 'R4B', `the logo is named and the page keeps its h1 (${lang})`, async () => {
        const link = await axNode(page, '.mark'), heading = await axNode(page, '.mark h1');
        // Batch 3 C2: the logo now goes home, so its name says so.
        const name = lang === 'sk' ? 'University Finder, všetky programy' : 'University Finder, all programmes';
        assert(link.role?.value === 'link' && link.name?.value === name, `link: ${link.role?.value} "${link.name?.value}"`);
        assert(!heading.ignored && heading.role?.value === 'heading' && heading.name?.value === 'University Finder', `heading: ${JSON.stringify([heading.ignored, heading.role?.value, heading.name?.value])}`);
        const m = await page.ev(`(()=>{const h=document.querySelector('.mark h1'),r=h.getBoundingClientRect(),s=getComputedStyle(h);return {w:r.width,h:r.height,display:s.display,clip:s.clipPath,text:h.textContent,sw:document.documentElement.scrollWidth,iw:innerWidth}})()`);
        assert(m.display !== 'none' && m.text === 'University Finder', JSON.stringify(m));
        if (width <= 700) assert(m.w <= 1 && m.h <= 1 && m.clip === 'inset(50%)', `the wordmark is painted: ${JSON.stringify(m)}`);
        else assert(m.w > 50 && m.h > 10 && m.clip === 'none', `the wordmark is not visible: ${JSON.stringify(m)}`);
        assert(m.sw === m.iw, `page is ${m.sw} wide at ${m.iw}`);
      });
    }
  } finally { await page.close(); }

  // Only the visible direct children of a row, and nothing inside compound controls
  // or closed panels: those have their own gaps and do not wrap as whole controls.
  const rowsNow = `(()=>{const shown=(n)=>!n.hidden&&getComputedStyle(n).display!=='none',box=(n)=>n.getBoundingClientRect(),bad=[];
    const kids=[...document.querySelectorAll('.fbar .more-filters>.frow')].flatMap((row)=>[...row.children].filter(shown));
    const lines=[];for(const n of kids){const r=box(n),line=lines.find((l)=>Math.abs(l.top-r.top)<=2);if(line)line.items.push(n);else lines.push({top:r.top,items:[n]})}
    for(const n of kids){const r=box(n);if(r.left<0||r.right>innerWidth)bad.push('outside: '+n.id+' '+Math.round(r.left)+'-'+Math.round(r.right))}
    lines.forEach((line,i)=>{line.items.sort((a,b)=>box(a).left-box(b).left);
      line.items.forEach((n,k)=>{if(k){const gap=box(n).left-box(line.items[k-1]).right;if(Math.abs(gap-8)>1)bad.push('gap '+gap.toFixed(1)+' before '+(n.id||n.className))}});
      if(i){const before=Math.max(...lines[i-1].items.map((n)=>box(n).bottom)),gap=line.top-before;if(Math.abs(gap-8)>1)bad.push('line gap '+gap.toFixed(1)+' above '+(line.items[0].id||line.items[0].className))}});
    for(const n of kids.flatMap((k)=>[...k.querySelectorAll('summary,label,button')]).filter((n)=>shown(n)&&!n.closest('.dropdown-panel')&&n.offsetWidth)){
      if(n.scrollWidth>n.clientWidth+1)bad.push('clipped: '+n.textContent.trim().slice(0,30));
      if(getComputedStyle(n).textOverflow==='ellipsis')bad.push('ellipsis: '+n.textContent.trim().slice(0,30))}
    return {bad,lines:lines.length,budgetLast:document.querySelector('.facets-row').lastElementChild.id==='dd-budget',sw:document.documentElement.scrollWidth,w:innerWidth}})()`;
  // Panels open one at a time, after the toggle event has placed them, with their
  // opening animation finished so the scale is not measured.
  const panelsNow = `(async()=>{const frame=()=>new Promise((done)=>requestAnimationFrame(()=>setTimeout(done))),bad=[];window.scrollTo({top:0,behavior:'instant'});
    for(const d of document.querySelectorAll('.fbar .frow>.dropdown')){d.open=true;await frame();await frame();const panel=d.querySelector('.dropdown-panel');
      for(const a of panel.getAnimations())a.finish();const r=panel.getBoundingClientRect();
      if(r.left<0||r.right>innerWidth||r.bottom>innerHeight)bad.push(d.id+' panel at '+[r.left,r.right,r.bottom].map(Math.round));
      if(panel.scrollWidth>panel.clientWidth+1)bad.push(d.id+' panel overflows sideways');
      for(const n of panel.querySelectorAll('.option,.pop-f'))if(n.offsetWidth&&n.scrollWidth>n.clientWidth+1)bad.push(d.id+' clipped: '+n.textContent.trim().slice(0,30));
      for(const n of panel.querySelectorAll('.option *,.pop-f *,.fld *')){const b=n.getBoundingClientRect();if(b.width&&(b.right>r.right-1||b.left<r.left+1))bad.push(d.id+' outside its panel: '+n.textContent.trim().slice(0,30))}
      d.open=false;await frame()}
    return bad})()`;
  const placeholderNow = `(()=>{const n=document.querySelector('#f-points'),s=getComputedStyle(n),p=getComputedStyle(n,'::placeholder'),c=document.createElement('canvas').getContext('2d');c.font=p.font;
    return {text:n.placeholder,need:c.measureText(n.placeholder).width,room:n.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)}})()`;
  const long = 'subject=Law&subject=Psychology&subject=Economics&country=Ireland&country=Germany&country=Netherlands&fee=12000&living=900&deadline=60';
  for (const [state, query] of [['no filters', ''], ['long selections', `&${long}`]]) {
    page = await open(`?ui=en${query}`, 1280, 900);
    try {
      if (query) assert(await page.ev(`document.querySelector('#dd-subjects-count-number').textContent==='3' && document.querySelector('#dd-countries-count-number').textContent==='3' && document.querySelector('#budget-value').textContent==='· 2' && document.querySelector('#dd-deadline .scalar-count').textContent==='· 1'`), 'the long selections did not apply');
      for (const lang of ['en', 'sk']) {
        await language(page, lang);
        for (const [width, height] of [[600, 900], [640, 450], [700, 900], [800, 900], [1023, 900], [1024, 900], [1100, 900], [1199, 900], [1200, 900], [1280, 900], [1440, 900]]) {
          await resize(page, width, height);
          await check(width, 'R4C', `filter rows (${lang}, ${state}): whole controls, even gaps, nothing clipped`, async () => {
            // A closed panel stays drawn for its 250 ms exit, so the last one measured at
            // the previous width can widen the page for a moment; a real overflow stays.
            await page.waitFor(`({ok:document.documentElement.scrollWidth===innerWidth,why:'page is '+document.documentElement.scrollWidth+' wide at '+innerWidth})`, 1000, 'no sideways scroll');
            const m = await page.ev(rowsNow);
            assert(m.bad.length === 0, m.bad.join(' | '));
            assert(m.budgetLast, 'Budget is not the last facet in the second row');
            if (lang === 'en' && !query && width >= 1024) assert(m.lines === 2, `${m.lines} rows`);
            if (width === 1024 || width === 1100) {
              const p = await page.ev(placeholderNow);
              assert(p.need <= p.room, `"${p.text}" needs ${p.need.toFixed(1)}, has ${p.room}`);
            }
            const panels = await page.ev(panelsNow);
            assert(panels.length === 0, panels.join(' | '));
          });
        }
      }
    } finally { await page.close(); }
  }
  const noteNow = `(()=>{const note=document.querySelector('#f-deadline-open-note'),r=note.getBoundingClientRect(),s=getComputedStyle(note),label=document.querySelector('#dd-deadline input[value=open]').closest('.option'),text=label.querySelector('span').getBoundingClientRect(),panel=document.querySelector('#dd-deadline .dropdown-panel').getBoundingClientRect(),range=document.createRange(),sheet=document.querySelector('#filter-sheet .sheet-b');range.selectNodeContents(note);
    const tops=new Set([...range.getClientRects()].map((b)=>Math.round(b.top)));
    return {text:note.textContent,visible:r.height>0&&s.display!=='none'&&s.visibility!=='hidden',below:r.top>=label.getBoundingClientRect().bottom-1,indent:Math.abs(range.getBoundingClientRect().left-text.left),fits:r.left>=panel.left&&r.right<=panel.right,lines:tops.size,
      rows:[...document.querySelectorAll('#dd-deadline .option')].map((n)=>n.offsetHeight),described:[...document.querySelectorAll('#dd-deadline input[aria-describedby],#dd-exam input[aria-describedby]')].map((n)=>n.value),sw:document.documentElement.scrollWidth,w:innerWidth,sheet:sheet&&sheet.scrollWidth-sheet.clientWidth}})()`;
  page = await open('?ui=en', 1280, 900);
  try {
    await page.send('Accessibility.enable');
    for (const lang of ['en', 'sk']) {
      await language(page, lang);
      for (const width of [1024, 1200, 1280, 1440]) {
        await resize(page, width, 900);
        await check(width, 'R4C', `Budget panel by keyboard (${lang}): opens inside the right edge, reaches its fields, Escape returns`, async () => {
          await page.ev(`window.scrollTo({top:0,behavior:'instant'});document.querySelector('#dd-exam summary').focus()`);
          await page.key('Tab', 'Tab', 9);
          assert(await page.ev(`document.activeElement===document.querySelector('#dd-budget summary')`), 'Tab did not reach the Budget summary');
          await page.key('Enter', 'Enter', 13, [], '\r');
          await page.waitFor(`(()=>{const d=document.querySelector('#dd-budget'),p=d.querySelector('.dropdown-panel'),r=p.getBoundingClientRect();return {ok:d.open&&!p.getAnimations().some((a)=>a.playState==='running')&&r.left>=0&&r.right<=innerWidth,why:JSON.stringify([d.open,r.left,r.right,innerWidth])}})()`, 5000, 'the Budget panel inside the viewport');
          const reached = [];
          for (let i = 0; i < 6 && !reached.includes('f-living'); i++) {
            await page.key('Tab', 'Tab', 9);
            reached.push(await page.ev(`document.activeElement.id`));
          }
          assert(reached.includes('f-tuition') && reached.includes('f-living'), `Tab reached ${reached}`);
          await page.key('Escape', 'Escape', 27);
          assert(await page.ev(`!document.querySelector('#dd-budget').open && document.activeElement===document.querySelector('#dd-budget summary')`), 'Escape did not close Budget and return to its summary');
          await page.ev(`document.activeElement.blur()`);
        });
      }
    }
    await resize(page, 390, 844);
    await check(390, 'R4C', 'Budget is the last facet in the phone sheet', async () => {
      await page.click(`document.querySelector('#f-more')`, 'Filters');
      await page.waitFor(`({ok:document.querySelector('#filter-sheet').open,why:'sheet closed'})`, 5000, 'the sheet');
      assert(await page.ev(`(()=>{const f=[...document.querySelectorAll('#filter-sheet .frow>.dropdown')],tops=f.map((n)=>n.getBoundingClientRect().top);return f.at(-1).id==='dd-budget' && tops.every((t,i)=>!i||t>tops[i-1])})()`), 'sheet order');
      await page.key('Escape', 'Escape', 27);
    });
    await page.waitFor(`({ok:!document.querySelector('#filter-sheet').open,why:'sheet open'})`, 5000, 'the sheet to close');
    // Text boxes, so this proves a shared centre line and not a baseline; the
    // baseline is looked at on a screenshot of the same row.
    for (const lang of ['en', 'sk']) {
      await language(page, lang);
      for (const width of [600, 800, 1280]) {
        await resize(page, width, 900);
        await check(width, 'R4D', `status line (${lang}): the count and Edit my answers read as one line at one size`, async () => {
          const m = await page.ev(`(()=>{const rect=(n)=>{const r=document.createRange();r.selectNodeContents(n);return [...r.getClientRects()].at(-1)},lead=document.querySelector('.status .count-lead'),edit=document.querySelector('.status .edit-answers'),a=rect(lead.lastChild),b=rect(edit.firstChild);
            return {centre:Math.abs((a.top+a.bottom)-(b.top+b.bottom))/2,bottom:Math.abs(a.bottom-b.bottom),lead:getComputedStyle(lead).fontSize,edit:getComputedStyle(edit).fontSize,weight:getComputedStyle(edit).fontWeight}})()`);
          assert(m.centre <= 1 && m.bottom <= 1, JSON.stringify(m));
          assert(m.lead === '15px' && m.edit === '15px' && m.weight === '600', JSON.stringify(m));
        });
      }
    }
    await resize(page, 1280, 900);
    await language(page, 'en');
    await check(1280, 'R4E', 'the Deadline note sits under "Not passed yet" and describes only that radio', async () => {
      await page.click(`document.querySelector('#dd-deadline summary')`, 'Deadline');
      await page.waitFor(`(()=>{const p=document.querySelector('#dd-deadline .dropdown-panel'),r=p.getBoundingClientRect();return {ok:document.querySelector('#dd-deadline').open&&!p.getAnimations().some((a)=>a.playState==='running')&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,why:JSON.stringify([r.left,r.right,r.bottom])}})()`, 5000, 'the Deadline panel inside the viewport');
      const m = await page.ev(noteNow);
      assert(m.visible && m.below && m.indent <= 1 && m.fits, JSON.stringify(m));
      assert(m.rows.every((h) => h >= 40), `radio rows ${m.rows}`);
      assert(m.described.join() === 'open', `described: ${m.described}`);
      const radio = await axNode(page, '#dd-deadline input[value=open]');
      assert(radio.description?.value === m.text && radio.name?.value === 'Not passed yet', `radio reads "${radio.name?.value}" / "${radio.description?.value}"`);
      await page.key('Escape', 'Escape', 27);
    });
    for (const lang of ['en', 'sk']) {
      await language(page, lang);
      await resize(page, 390, 844);
      await check(390, 'R4E', `the Deadline note in the phone sheet (${lang}) wraps with no sideways scroll`, async () => {
        await page.click(`document.querySelector('#f-more')`, 'Filters');
        await page.waitFor(`({ok:document.querySelector('#filter-sheet').open,why:'sheet closed'})`, 5000, 'the sheet');
        await page.click(`document.querySelector('#dd-deadline summary')`, 'Deadline');
        await page.waitFor(`({ok:document.querySelector('#dd-deadline').open && document.querySelector('#f-deadline-open-note').getBoundingClientRect().height>0,why:'not open'})`, 5000, 'the Deadline rows');
        // The sheet's rows open with a height animation; measure the settled layout.
        await page.waitFor(`({ok:!document.querySelector('#dd-deadline').getAnimations({subtree:true}).some((a)=>a.playState==='running'),why:'still opening'})`, 5000, 'the rows to settle');
        const m = await page.ev(noteNow);
        assert(m.visible && m.below && m.indent <= 1 && m.fits, JSON.stringify(m));
        assert(m.rows.every((h) => h >= 44), `radio rows ${m.rows}`);
        assert(m.lines >= 2, `the note is on ${m.lines} line(s)`);
        assert(m.sw === m.w && m.sheet === 0, `sideways: ${JSON.stringify(m)}`);
        await page.ev(`document.querySelector('#dd-deadline').open=false`);
        await page.key('Escape', 'Escape', 27);
        await page.waitFor(`({ok:!document.querySelector('#filter-sheet').open,why:'sheet open'})`, 5000, 'the sheet to close');
      });
    }
  } finally { await page.close(); }
}
async function runBatch2B(base) {
  watchdog.refresh();
  const { UI } = await import('../js/i18n.js');
  const shots = '/tmp/ib-batch2-b';
  await mkdir(shots, { recursive: true });
  // Measure every ancestor too: a visible child in a display:none bar is unusable.
  const rendered = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return {why:'missing element'};
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return {why:'hidden ancestor '+n.className};
    }
    const r = el.getBoundingClientRect();
    return {ok:r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight,why:JSON.stringify(r)};
  })()`;
  for (const width of [390, 600, 1280, 1400]) for (const ui of ['en', 'sk']) {
    const page = await openPage(`${base}?ui=${ui}&country=Ireland&points=36`, width, width < 600 ? 844 : 1000);
    const text = UI[ui];
    const el = (id) => `document.querySelector('#${id}')`;
    const shot = async (name) => {
      if (width !== 390 && width !== 1400) return;
      await page.waitFor(`({ok:document.getAnimations().every(a=>a.playState==='finished'),why:'motion still running'})`,5000,'settled screenshot');
      const {data} = await page.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      await writeFile(`${shots}/${width}-${ui}-${name}.png`, Buffer.from(data, 'base64'));
    };
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page not ready'})`;
    const navigate = async (query) => {
      await page.ev(`window.__oldPage=true;location.href=${JSON.stringify(base + query)}`);
      await page.waitFor(ready, 15000, 'B navigation');
    };
    try {
      await page.waitFor(ready,15000,'B boot');
      const info = await page.send('Target.getTargetInfo');
      await cdp.send('Browser.grantPermissions', {origin:new URL(base).origin, browserContextId:info.targetInfo.browserContextId, permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
      if (await page.ev(`document.querySelector('#onboarding').open`)) await page.click(`document.querySelector('#onboarding .skipwrap button')`,'Skip setup');
      await check(`${width}/${ui}`, 'R4F', 'Copy link reports the captured filters and points once, in the sheet on phones', async () => {
        if (width < 600) await page.click(el('f-more'),'Filters');
        const initial = await page.ev(`${el('f-copy')}.textContent`);
        await page.ev(`window.__copyEvents=[];new MutationObserver(records=>{for(const r of records)window.__copyEvents.push({added:[...r.addedNodes].map(n=>n.textContent),removed:[...r.removedNodes].map(n=>n.textContent)})}).observe(document.querySelector('${width < 600 ? '#f-copy-status' : '#toasts'}'),{childList:true,subtree:true});`);
        const result = width < 600 ? '#f-copy-status' : '#toasts .toast';
        for (let i=0;i<2;i++) {
          await page.click(el('f-copy'),'Copy link');
          await page.waitFor(`({ok:document.querySelector('${result}')?.textContent===${JSON.stringify(text.r2_copied_filters_points)} && window.__copyEvents.filter(e=>e.added.includes(${JSON.stringify(text.r2_copied_filters_points)})).length===${i+1},why:'copy result missing'})`,5000,'copy feedback');
          const m = await page.ev(`(async()=>({url:await navigator.clipboard.readText(),want:location.href.split('#')[0],label:${el('f-copy')}.textContent,toasts:document.querySelectorAll('#toasts .toast').length,events:window.__copyEvents}))()`);
          assert(m.url===m.want && m.label===initial, `address or label mismatch ${JSON.stringify(m)}`);
          assert(m.toasts === (width < 600 ? 0 : 1), 'duplicate toast or toast behind modal');
          if (i===1) assert(m.events.filter(e=>e.added.some(t=>t===text.r2_copied_filters_points)).length===2 && m.events.some(e=>e.removed.includes(text.r2_copied_filters_points)), `repeat not announced ${JSON.stringify(m.events)}`);
        }
        await page.waitFor(rendered(result),5000,'visible feedback');
        const labels = await page.ev(`(()=>{const b=${el('f-copy')},long=b.querySelector('.copy-long'),short=b.querySelector('.copy-short');return {name:b.getAttribute('aria-label'),visible:getComputedStyle(long).display==='none'?short.textContent:long.textContent,height:b.getBoundingClientRect().height,help:getComputedStyle(${el('f-copy-help')}).clipPath}})()`);
        assert(labels.name.includes(labels.visible), 'accessible name misses visible label');
        if (width>=1024) assert(labels.visible===text.r2_copy_filters_link && labels.height===36,'desktop label or height changed');
        else if (width>=600) assert(labels.visible===text.copy_link,'tablet label is not short');
        else {
          await page.waitFor(rendered('#f-copy-help'),5000,'sheet copy help');
          assert(labels.visible===text.r2_copy_filters_link && labels.help==='none','sheet label/help hidden');
        }
        await shot('copy-feedback');
        if (width < 600) {
          await page.key('Escape','Escape',27);
          await page.waitFor(`({ok:!${el('filter-sheet')}.open && ${el('f-copy-status')}.textContent==='',why:'Escape left status'})`,5000,'Escape clears');
          await page.click(el('f-more'),'Filters again'); await page.click(el('f-copy'),'Copy in sheet');
          await page.waitFor(`({ok:!!${el('f-copy-status')}.textContent,why:'status empty'})`,5000,'copy status');
          // The sheet is bottom-aligned; this point lies on its real backdrop.
          for (const type of ['mousePressed','mouseReleased']) await page.send('Input.dispatchMouseEvent',{type,x:4,y:4,button:'left',clickCount:1});
          await page.waitFor(`({ok:!${el('filter-sheet')}.open && ${el('f-copy-status')}.textContent==='',why:'backdrop left status'})`,5000,'backdrop clears');
          await page.click(el('f-more'),'Filters before widening'); await page.click(el('f-copy'),'Copy before widening');
          await page.waitFor(`({ok:!!${el('f-copy-status')}.textContent,why:'status empty'})`,5000,'copy before widening');
          await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
          await page.waitFor(`({ok:!${el('filter-sheet')}.open && ${el('f-copy-status')}.textContent==='' && ${el('f-copy')}.parentElement.classList.contains('status'),why:'widening left sheet status'})`,5000,'widening clears');
          await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
        }
      });
      // Batch 3 · A: the Compare hint, the Compare (n) button and the picker are
      // gone (Compare is its own set); the saves and Share below still run here.
      await check(`${width}/${ui}`, 'R4G', 'saves leave the empty bar hidden, then My list and Share copy the list', async () => {
        await page.ev(`localStorage.removeItem('ib-university-finder:shortlist:v1');localStorage.removeItem('ibuf.filters.v1')`);
        await navigate(`?ui=${ui}&sort=deadline`);
        await page.ev('window.scrollTo(0,0)');
        const bar = await page.ev(`({display:getComputedStyle(${el('shortlist-bar')}).display,note:${el('ml-note')}.hidden})`);
        assert(bar.display==='none' && bar.note,'empty list bar visible');
        for (const i of [0, 1, 2]) await page.click(`document.querySelectorAll('#results button.star')[${i}]`,`save ${i + 1}`);
        await page.ev('window.scrollTo(0,0)');
        await page.waitFor(`({ok:${el('header-list-count')}.textContent==='3',why:'header count '+${el('header-list-count')}.textContent})`,5000,'three saves');
        if (width===600) return;
        await page.click(el('header-list'),'Open My list');
        // Phones keep Share behind My list's More (2026-11-06).
        if (width < 600) await page.click(el('ml-more'),'More');
        await page.click(`document.querySelector('#ml-share > summary')`,'Share panel');
        await page.waitFor(rendered('#ml-share-help'),5000,'share help');
        assert(await page.ev(`${el('ml-share-help')}.textContent===${JSON.stringify(text.r2_share_help)}`),'wrong share help');
        await shot('share-panel');
        await page.click(el('ml-share-copy'),'Copy share link');
        const plural = text.r2_list_copied.few.replace('{count}','3');
        await page.waitFor(`({ok:document.querySelector('#toasts .toast')?.textContent===${JSON.stringify(plural)},why:'share result missing'})`,5000,'share result');
        assert(await page.ev(`(async()=>{const u=await navigator.clipboard.readText();return /[?]list=/.test(u)&&!/[?&](q|country|ui|points)=/.test(u)})()`),'share link includes private state');
        assert(await page.ev('document.documentElement.scrollWidth===innerWidth'),'My list overflows');
      });
      if (width===1280 && ui==='en') await check(width,'R4F recipient','bare copied link preserves the recipient’s stored filters', async () => {
        // A second page gets its own browser storage, like a different recipient.
        await page.ev("localStorage.setItem('ibuf.onboarding.v1','dismissed')");
        await navigate('');
        await page.click(el('f-copy'),'Copy a link without filters');
        await page.waitFor(`({ok:document.querySelector('#toasts .toast')?.textContent===${JSON.stringify(UI.en.r2_copied_none)},why:'no-filter result missing'})`,5000,'no-filter feedback');
        const copied=await page.ev('navigator.clipboard.readText()');
        assert(copied===base,'the no-filter copy is not bare');
        const recipient=await openPage(`${base}?sort=deadline`,1280,900);
        try {
          await recipient.waitFor(ready,15000,'recipient boot');
          await recipient.ev(`localStorage.setItem('ibuf.filters.v1',JSON.stringify({version:1,filters:{countries:['Ireland']}}));window.__oldPage=true;location.href=${JSON.stringify(copied)}`);
          await recipient.waitFor(ready,15000,'recipient bare URL');
          assert(await recipient.ev(`document.querySelector('#f-countries input[value=Ireland]').checked && new URLSearchParams(location.search).get('country')==='Ireland'`),'bare URL did not restore recipient filters');
        } finally {await recipient.close();}
      });
    } finally { await page.close(); }
  }
  // The narrowest accepted layout and the long/short label boundary.
  for (const [width,ui] of [[320,'sk'],[800,'en'],[800,'sk'],[1024,'en'],[1024,'sk']]) {
    const page=await openPage(`${base}?ui=${ui}&sort=deadline`,width,900);
    try {
      await check(`${width}/${ui}`,'R4F layout','copy label fits and nothing scrolls sideways with three saves',async()=>{
        await page.waitFor(`({ok:document.querySelector('#loading')?.hidden,why:'loading'})`,15000,'layout boot');
        await page.ev(`localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify([...document.querySelectorAll('#results>li.item')].slice(0,3).map(n=>n.dataset.id)));window.__oldPage=true;location.reload()`);
        await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reload'})`,15000,'layout saves');
        assert(await page.ev('document.documentElement.scrollWidth===innerWidth'),'page overflows');
        // Batch 3 B1: a phone's main view has no My list box.
        if(width<600) assert(await page.ev(`getComputedStyle(document.querySelector('#shortlist-bar')).display==='none'`),'phone main bar shows');
        if(width>=600) assert(await page.ev(`(getComputedStyle(document.querySelector('.copy-long')).display==='none')===${width<1024}`),'wrong long-label breakpoint');
      });
    }finally{await page.close();}
  }
  // Pre-existing at the base commit: left-aligned Share overflowed at 600px.
  // One save hides Compare, so exercise both toolbar arrangements in both locales.
  for (const width of [600,800]) for (const ui of ['en','sk']) {
    const page = await openPage(`${base}?ui=${ui}&sort=deadline`,width,1000);
    try {
      await check(`${width}/${ui}`,'R4F Share gutter','Share stays within the 16 px gutter with 1 and 3 saves',async()=>{
        for (const count of [1,3]) {
          await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'loading'})`,15000,'Share gutter boot');
          await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify([...document.querySelectorAll('#results>li.item')].slice(0,${count}).map(n=>n.dataset.id)));window.__oldPage=true;location.reload()`);
          await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reload'})`,15000,'Share gutter saves');
          // Batch 3 · A: the main view no longer shows the My list bar (its Compare
          // hint and button are gone), so My list opens from the header.
          await page.click(`document.querySelector('#header-list')`,'My list for Share gutter');
          await page.click(`document.querySelector('#ml-share>summary')`,'Share for gutter check');
          await page.waitFor(`(()=>{const panel=document.querySelector('#ml-share>.ml-panel'),summary=document.querySelector('#ml-share>summary'),r=panel.getBoundingClientRect(),s=summary.getBoundingClientRect();return {ok:r.width>0&&r.left>=16&&r.right<=innerWidth-16&&r.top>=s.bottom&&document.documentElement.scrollWidth===innerWidth,why:JSON.stringify({panel:r.toJSON(),summary:s.toJSON(),viewport:innerWidth})}})()`,5000,'Share within its gutters');
        }
      });
    }finally{await page.close();}
  }

}
async function runBatch2C(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-batch2-c-detail';
  await mkdir(shots, { recursive: true });
  console.log('Phase C Chrome version: ' + (await cdp.send('Browser.getVersion')).product);
  const open = async (query, width) => {
    const page = await openPage(base + query, width, 1000);
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
    await page.waitFor(ready, 15000, 'Phase C page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'Phase C reload');
    return page;
  };
  const screenshot = async (page, path, selector) => {
    // A slot can still be growing after its buttons exist; capture its settled position.
    await page.ev(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await page.ev(`Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    await page.ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await page.ev(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert(await page.ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()`), 'capture target outside viewport');
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  const actionsPage = await open('?ui=en', 390);
  try {
    for (const width of [390, 600, 800, 1024, 1199, 1200, 1280, 1400, 1440]) {
      for (const ui of ['en', 'sk']) {
        const page = actionsPage;
        await page.key('Escape', 'Escape', 27);
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await page.waitFor(`({ok:innerWidth===${width},why:'viewport changing'})`, 3000, 'viewport');
        await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language="${ui}"]'));window.scrollTo(0,0)`);
        const detail = width >= 1200 ? '#pane .pane-body' : '#results>li.item .expand';
        // Batch 3 · A (Leon's Q3): the official link takes the first row; Save and
        // Compare are an equal pair under it, the pane included. Since the
        // alignment fixes the pair stacks when its labels do not fit side by side.
        await check(width, 'R4H', 'detail: official link full width, then Save and Compare as an equal pair, side by side or stacked (' + ui + ')', async () => {
          await page.click(`document.querySelector('#results>li.item button.open')`, 'first programme');
          await page.waitFor(`({ok:!!document.querySelector('${detail} .d-actions'),why:'detail not open'})`, 5000, 'detail actions');
          const m = await page.ev(`(()=>{
            const group=document.querySelector('${detail} .d-actions'), outer=group.getBoundingClientRect();
            const buttons=[...group.children], [link,a,b]=buttons.map(n=>n.getBoundingClientRect());
            const side=Math.abs(a.top-b.top)<1;
            // Alignment fixes: a detail too narrow for both labels stacks the pair, full width.
            const stacked=Math.abs(a.left-b.left)<1&&Math.abs(a.width-outer.width)<=1&&b.top>=a.bottom;
            return {full:Math.abs(link.width-outer.width),below:a.top-link.bottom,widths:Math.abs(a.width-b.width),heights:Math.abs(a.height-b.height),side,stacked,vgap:b.top-a.bottom,
              gap:b.left-a.right,minHeight:Math.min(link.height,a.height,b.height),overflow:buttons.some(n=>n.scrollWidth>n.clientWidth+1),
              order:buttons.length===3&&buttons[0].matches('a.btn-p')&&buttons[1].matches('button.save')&&buttons[2].matches('button.cmpb'),
              separate:!group.querySelector('.lnk,.ok,.tag'),
              pageOverflow:document.documentElement.scrollWidth>innerWidth};
          })()`);
          assert(m.order && m.separate && m.full <= 1 && m.widths <= 1 && m.minHeight >= 44 && !m.overflow && !m.pageOverflow, JSON.stringify(m));
          assert(m.heights <= 1 && (m.side ? m.gap >= 8 && m.gap <= 12 : m.stacked && m.vgap >= 8 && m.vgap <= 12) && m.below >= 8 && m.below <= 12, JSON.stringify(m));
          if ([390, 800, 1400].includes(width)) {
            await screenshot(page, shots + '/actions-' + width + '-' + ui + '.png', detail + ' .d-actions');
          }
        });
        if ([1024, 1199, 1200, 1280].includes(width)) {
          await check(width, 'R4I', 'second activation focuses pane or closes inline (' + ui + ')', async () => {
            const before = await page.ev('location.href');
            const tabs = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').length;
            await page.click(`document.querySelector('#results>li.item button.open')`, 'same programme again');
            if (width >= 1200) {
              assert(await page.ev(`document.activeElement.id==='pane'`), 'pane not focused');
              await page.key('Escape', 'Escape', 27);
              assert(await page.ev(`document.activeElement===document.querySelector('#results>li.item button.open') && !document.querySelector('#results>li.is-sel')`), 'Escape did not restore row focus');
            } else {
              await page.waitFor(`({ok:!document.querySelector('#results>li.item .expand'),why:'inline still open'})`, 5000, 'inline close');
            }
            assert(await page.ev('location.href') === before, 'address changed');
            assert((await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').length === tabs, 'tab opened');
          });
        }
        assert(!page.errors.length && !page.exceptions.length, JSON.stringify([...page.errors, ...page.exceptions]));
      }
    }
  } finally { await actionsPage.close(); }
  for (const ui of ['en', 'sk']) {
    const page = await open('?ui=' + ui + '&country=Czechia&lang=Czech', 1280);
    try {
      await check(1280, 'R4J', 'Czech note is in matching Language detail, absent from filter (' + ui + ')', async () => {
        await page.click(`document.querySelector('#results>li.item button.open')`, 'Czech programme');
        const note = ui === 'sk' ? 'Za štúdium v češtine' : 'Taught in Czech at a public university';
        assert(await page.ev(`(()=>{
          const n=document.querySelector('#pane .dd-note');
          return n?.textContent.startsWith(${JSON.stringify(note)}) && n.closest('dd') &&
            !document.querySelector('#dd-languages .dd-help,#f-languages-help') &&
            !document.querySelector('#dd-languages .dropdown-panel').hasAttribute('aria-describedby');
        })()`), 'Czech note missing or Language help remains');
        await screenshot(page, shots + '/czech-free-' + ui + '.png', '#pane .dd-note');
      });
    } finally { await page.close(); }
  }
  // Real paid and non-Czech examples, without changing the dataset.
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  for (const [name, row] of [
    ['paid-czech', data.find(r => r.country === 'Czechia' && r.tuitionEu > 0)],
    ['non-czech', data.find(r => r.country !== 'Czechia')],
  ]) {
    const page = await open('?ui=en&q=' + encodeURIComponent(row.programme), 1280);
    try {
      await check(1280, 'R4J', 'no Czech note on ' + name, async () => {
        await page.waitFor(`({ok:!!document.querySelector('li[data-id="${row.id}"] button.open'),why:'programme not rendered'})`, 5000, 'programme');
        await page.click(`document.querySelector('li[data-id="${row.id}"] button.open')`, name);
        assert(await page.ev(`!!document.querySelector('#pane .d-foot') && !document.querySelector('#pane .dd-note')`), 'unexpected Czech note');
        await screenshot(page, shots + '/' + name + '-en.png', '#pane .d-foot');
      });
    } finally { await page.close(); }
  }
}

// --- Batch 2 follow-up ----------------------------------------------------------
// F1: at 600–700 px the compact Filters button was wider than the logo slot, so
// Search covered it ("Fil…", right part unclickable). F2: the Slovak living-costs
// placeholder was clipped in its 112 px field.
async function runBatch2Followup(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-batch2-followup';
  await mkdir(shots, { recursive: true });
  const open = async (query, width, height) => {
    const page = await openPage(base + query, width, height);
    const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
    await page.waitFor(ready, 15000, 'follow-up page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'follow-up reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))))`);
  const hits = 'const hits=(a,b)=>!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);';

  // Two filters set, so the count badge shows: the widest the button gets.
  let page = await open('?ui=sk&country=Ireland&points=36', 700, 800);
  try {
    await page.send('Accessibility.enable');
    for (const lang of ['sk', 'en']) {
      await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=${lang}]'))`);
      await page.waitFor(`({ok:document.documentElement.lang==='${lang}',why:document.documentElement.lang})`, 3000, `language ${lang}`);
      for (const coarse of [false, true]) {
        for (const width of [600, 650, 700]) {
          const pointer = coarse ? 'touch' : 'mouse';
          await check(width, 'F1', `compact Filters (${lang}, ${pointer}): icon button fills the slot, fully clickable, Search does not move`, async () => {
            await page.send('Emulation.setTouchEmulationEnabled', { enabled: coarse });
            await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: coarse });
            await page.waitFor(`({ok:innerWidth===${width}&&matchMedia('(pointer:coarse)').matches===${coarse},why:innerWidth})`, 3000, `width ${width}`);
            const searchBox = `(()=>{const q=document.querySelector('#f-search').getBoundingClientRect();return [q.left,q.width]})()`;
            await page.ev(`document.activeElement.blur();scrollTo({top:0,behavior:'instant'})`);
            await page.waitFor(`({ok:!document.body.classList.contains('compact'),why:'still compact'})`, 3000, 'not compact');
            await settle(page);
            const before = await page.ev(searchBox);
            await page.ev(`scrollTo({top:1400,behavior:'instant'})`);
            await page.waitFor(`({ok:document.body.classList.contains('compact'),why:'not compact'})`, 3000, 'compact');
            await settle(page);
            const m = await page.ev(`(()=>{${hits}const b=document.querySelector('#compact-filters'),k=b.getBoundingClientRect(),badge=document.querySelector('#compact-count'),g=badge.getBoundingClientRect(),q=document.querySelector('#f-search').getBoundingClientRect(),label=b.querySelector('[data-i18n=filters_2]').getBoundingClientRect(),icon=b.querySelector('svg').getBoundingClientRect();
              const d=Math.ceil(parseFloat(getComputedStyle(b).borderTopLeftRadius)*(1-Math.SQRT1_2))+1;
              const corners=[[k.left+d,k.top+d],[k.right-d,k.top+d],[k.left+d,k.bottom-d],[k.right-d,k.bottom-d],[(k.left+k.right)/2,(k.top+k.bottom)/2]].map(([x,y])=>document.elementFromPoint(x,y));
              return {btn:[k.left,k.width,k.height],slot:document.querySelector('.slot').getBoundingClientRect().width,over:hits(k,q),badgeOver:hits(g,q),badgeShown:!badge.hidden&&g.width>0,badgeInside:g.top>=0&&g.left>=0,badgeText:badge.textContent,
                missed:corners.filter(n=>!b.contains(n)).map(n=>n&&(n.id||n.className)),label:[label.width,label.height],iconCut:icon.width<16||icon.left<k.left||icon.right>k.right||icon.top<k.top||icon.bottom>k.bottom,search:[q.left,q.width],h:document.querySelector('.hd').offsetHeight,sw:document.documentElement.scrollWidth,w:innerWidth}})()`);
            // Corners are probed just inside the rounded border: Chrome hit-tests the
            // rounded shape, so 1 px in from an 8 px radius corner is outside the button.
            const { result } = await page.send('Runtime.evaluate', { expression: `document.querySelector('#compact-filters')` });
            const { nodes } = await page.send('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
            const name = nodes[0]?.name?.value || '';
            if (width !== 650) {
              // The clip is in page coordinates, and the sticky header is at scrollY.
              const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: await page.ev('scrollY'), width, height: 72, scale: 2 } });
              await writeFile(`${shots}/compact-${width}-${lang}-${pointer}.png`, Buffer.from(data, 'base64'));
            }
            assert(!m.over && !m.badgeOver, `Filters collides with Search: ${JSON.stringify(m)}`);
            assert(m.missed.length === 0, `Filters covered at a corner by ${m.missed}`);
            // Batch 3 C2: the logo tile stays beside it, so the slot is 44 + 6 + 44 = 94 px
            // in both states and the button is 44 px wide (it filled a 36/44 px slot).
            assert(Math.abs(m.slot - 94) <= 0.5 && Math.abs(m.btn[1] - 44) <= 0.5 && m.btn[2] >= (coarse ? 44 : 36), `button ${m.btn} in a ${m.slot} slot`);
            assert(m.badgeShown && m.badgeInside && m.badgeText === '2', `count badge: ${JSON.stringify(m)}`);
            // The label is hidden on purpose, not cut: it stays the button's name.
            // (The badge sticks out over the corner by design, so scrollWidth is no test.)
            assert(m.label[0] <= 1 && m.label[1] <= 1 && !m.iconCut, `label shows or icon cut: ${JSON.stringify(m)}`);
            assert(name.includes(lang === 'sk' ? 'Filtre' : 'Filters') && name.includes('2'), `accessible name "${name}"`);
            assert(Math.abs(m.search[0] - before[0]) < 0.5 && Math.abs(m.search[1] - before[1]) < 0.5, `Search moved: ${before} → ${m.search}`);
            // Batch 3 C2: the 94 px slot (tile + Filters) costs Search 58 px at 600 px;
            // the batch 3 plan sets 160 px as the floor (it was 200).
            assert(m.search[1] >= 160, `Search only ${m.search[1]} wide`);
            assert(m.h === 56, `header ${m.h}`);
            assert(m.sw === m.w, `page is ${m.sw} wide at ${m.w}`);
          });
        }
      }
    }
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  } finally { await page.close(); }

  // The placeholder lives in the input's shadow tree, so its overflow is read
  // there: the old "Podľa univerzity" needed 93 px of the 83 px it gets.
  for (const width of [1280, 700]) {
    page = await open('?ui=sk', width, 900);
    try {
      await check(width, 'F2', 'Slovak living-costs placeholder "Podľa školy" fits its 112 px field', async () => {
        await page.ev(`document.querySelector('#dd-budget').open=true`);
        await settle(page);
        const field = await page.ev(`(()=>{const i=document.querySelector('#f-living');return {ph:i.placeholder,w:i.getBoundingClientRect().width}})()`);
        const { root } = await page.send('DOM.getDocument', { depth: -1, pierce: true });
        const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#f-living' });
        const { node } = await page.send('DOM.describeNode', { nodeId, depth: -1, pierce: true });
        const find = (n) => {
          const a = n.attributes || [];
          for (let i = 0; i < a.length; i += 2) if (a[i] === 'pseudo' && a[i + 1] === '-webkit-input-placeholder') return n.backendNodeId;
          for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) { const id = find(c); if (id) return id; }
          return null;
        };
        const backendNodeId = find(node);
        assert(backendNodeId, 'placeholder node not found');
        const { object } = await page.send('DOM.resolveNode', { backendNodeId });
        const { result } = await page.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
          functionDeclaration: 'function(){return {sw:this.scrollWidth,cw:this.clientWidth,text:this.textContent}}' });
        const p = result.value;
        if (width === 1280) {
          const r = await page.ev(`(()=>{const r=document.querySelector('#dd-budget .dropdown-panel').getBoundingClientRect();return {x:r.left-8,y:r.top-8,width:r.width+16,height:r.height+16}})()`);
          const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
          await writeFile(`${shots}/budget-sk.png`, Buffer.from(data, 'base64'));
        }
        assert(field.ph === 'Podľa školy' && p.text === 'Podľa školy', `placeholder ${JSON.stringify([field, p])}`);
        assert(Math.round(field.w) === 112, `field is ${field.w} wide`);
        assert(p.cw > 0 && p.sw <= p.cw, `placeholder clipped: ${p.sw} > ${p.cw}`);
      });
    } finally { await page.close(); }
  }
}

// --- Main -----------------------------------------------------------------------

// --- Batch 3 -------------------------------------------------------------------
// One function per workstream (plans/design-round2/batch3-plan.md); each starts
// with watchdog.refresh() because the whole run shares one 120 s watchdog.
// A: Compare as its own set (Leon, 2026-11-05): the toggle on every row, the
// header button and the phone tray, the view at 0 to 4, and the phone cue for
// columns off to the side. Screenshots go to /tmp/ib-batch3-a.
async function runBatch3A(base) {
  watchdog.refresh();
  const { UI } = await import('../js/i18n.js');
  const shots = '/tmp/ib-batch3-a';
  await mkdir(shots, { recursive: true });
  console.log('Batch 3 A Chrome version: ' + (await cdp.send('Browser.getVersion')).product);
  const KEY = 'ib-university-finder:compare:v1';
  const say = (ui, key, vars = {}) => {
    let value = UI[ui][key];
    if (typeof value === 'object') value = value[vars.count === 1 ? 'one' : vars.count >= 2 && vars.count <= 4 ? 'few' : 'other'] || value.other;
    return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
  };
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  // Each page is a fresh browser profile: its own saves and compare set.
  const open = async (query, width, height, compare = []) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'batch 3 A page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(compare))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'batch 3 A reload');
    return page;
  };
  const resize = async (page, width, height) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`({ok:innerWidth===${width}&&innerHeight===${height},why:'viewport '+innerWidth+'x'+innerHeight})`, 3000, 'viewport');
  };
  const frames = (page) => page.ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const shot = async (page, name) => {
    await frames(page);
    await page.ev(`Promise.all(document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  const shown = (selector) => `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;for(let e=n;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return false}const r=n.getBoundingClientRect();return r.width>0&&r.height>0})()`;
  const noOverflow = 'document.documentElement.scrollWidth<=innerWidth';
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const longest = [...data].sort((a, b) => b.programme.length - a.programme.length || b.university.length - a.university.length)[0];
  const four = [...data].sort((a, b) => b.programme.length - a.programme.length).slice(0, 4).map((r) => r.id);
  const rowOf = (id) => `document.querySelector('#results li.item[data-id="${id}"]')`;

  // 1. The row toggle beside the star, on the longest title in the data.
  for (const [width, height] of [[1280, 900], [390, 844], [320, 640]]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}&q=${encodeURIComponent(longest.programme)}`, width, height);
    try {
      await check(`${width}/${ui}`, 'B3A row toggle', 'compare and save are separate 44 px targets beside the title; a click adds without opening the row', async () => {
        await page.waitFor(`({ok:!!${rowOf(longest.id)},why:'row missing'})`, 10000, 'the longest row');
        const m = await page.ev(`(()=>{
          const li=${rowOf(longest.id)}; li.scrollIntoView({block:'center'});
          const c=li.querySelector('button.cmpi'), s=li.querySelector('button.star'), t=li.querySelector('.r-t');
          const rc=c.getBoundingClientRect(), rs=s.getBoundingClientRect(), rt=t.getBoundingClientRect();
          const hit=(b,r)=>{const h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return h===b||b.contains(h)};
          const overlap=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
          return {c:[rc.width,rc.height],s:[rs.width,rs.height],hitC:hit(c,rc),hitS:hit(s,rs),cs:overlap(rc,rs),tc:overlap(rt,rc),ts:overlap(rt,rs),
            order:rc.right<=rs.left+0.5,overflow:document.documentElement.scrollWidth-innerWidth,name:c.textContent};
        })()`);
        const min = 44;
        assert([...m.c, ...m.s].every((n) => n >= min - 0.5) && m.hitC && m.hitS && !m.cs && !m.tc && !m.ts && m.order && m.overflow <= 0, JSON.stringify(m));
        assert(m.name === say(ui, 'r3_cmp_add_label', { programme: longest.programme, university: longest.university }), 'name: ' + m.name);
        if (width !== 320) await shot(page, `row-toggle-${width}-${ui}`);
        await page.click(`${rowOf(longest.id)}.querySelector('button.cmpi')`, 'the compare toggle');
        await page.waitFor(`({ok:${rowOf(longest.id)}.querySelector('button.cmpi').getAttribute('aria-pressed')==='true' && JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).includes(${JSON.stringify(longest.id)}),why:'not added'})`, 5000, 'added to compare');
        assert(await page.ev(`!${rowOf(longest.id)}.querySelector('.expand') && !document.querySelector('#results li.is-sel') && ${rowOf(longest.id)}.querySelector('button.cmpi use').getAttribute('href')==='#i-compare-on'`), 'the click opened or selected the row');
        if (width !== 320) await shot(page, `row-toggle-on-${width}-${ui}`);
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 2. The header button: from 600 px, tall enough for the sticky header.
  for (const width of [600, 700, 1023, 1024, 1280]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, 900, four.slice(0, 2));
    try {
      await check(`${width}/${ui}`, 'B3A header compare', 'beside My list, clear of Search and the language switch, compact and not; the only compare entry', async () => {
        for (const compact of [false, true]) {
          await page.ev(`window.scrollTo(0,${compact ? 2000 : 0})`);
          await page.waitFor(`({ok:document.body.classList.contains('compact')===${compact},why:'compact '+document.body.classList.contains('compact')})`, 5000, 'header state');
          await frames(page);
          const m = await page.ev(`(()=>{
            const r=(s)=>document.querySelector(s).getBoundingClientRect();
            const hc=r('#header-compare'), hl=r('#header-list'), q=r('.hd .search'), lang=r('.hd .lang'), badge=r('#header-compare-count');
            const overlap=(a,b)=>a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5;
            return {pairs:[overlap(hc,hl),overlap(hc,q),overlap(hc,lang),overlap(hl,q),overlap(hl,lang)],search:q.width,
              badge:badge.left>=hc.left-0.5&&badge.right<=hc.right+0.5&&badge.top>=hc.top-0.5&&badge.bottom<=hc.bottom+0.5&&badge.right<=innerWidth,
              header:${shown('#header-compare')},tray:${shown('#cmp-tray')},overflow:document.documentElement.scrollWidth-innerWidth,count:document.querySelector('#header-compare-count').textContent};
          })()`);
          assert(!m.pairs.some(Boolean) && m.search >= 160 && m.badge && m.header && !m.tray && m.overflow <= 0 && m.count === '2', JSON.stringify(m));
        }
        const { root: doc } = await page.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#header-compare' });
        const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        const name = nodes[0]?.name?.value ?? '';
        assert(name.includes(ui === 'sk' ? 'Porovnať' : 'Compare') && name.includes('2'), 'accessible name: ' + name);
        if (width === 1280 || width === 700) { await page.ev('window.scrollTo(0,0)'); await shot(page, `header-${width}-${ui}`); }
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 3. The tray: phones and short windows only, from one programme.
  for (const [width, height, uis] of [[320, 640, ['en', 'sk']], [390, 844, ['en', 'sk']], [599, 900, ['en', 'sk']], [844, 390, ['en', 'sk']], [1280, 500, ['en']]]) for (const ui of uis) {
    const page = await open(`?ui=${ui}`, width, height);
    try {
      await check(`${width}x${height}/${ui}`, 'B3A tray', 'none at 0; from 1 to 4 it shows its count and a 44 px Open inside the window, and is the only compare entry', async () => {
        assert(await page.ev(`!${shown('#cmp-tray')} && !${shown('#header-compare')} && !document.body.classList.contains('has-tray')`), 'an entry shows at 0');
        for (let n = 1; n <= 4; n++) {
          await page.click(`document.querySelectorAll('#results button.cmpi')[${n - 1}]`, `compare toggle ${n}`);
          const want = say(ui, 'r3_tray_text', { count: n });
          await page.waitFor(`({ok:document.querySelector('#cmp-tray-text').textContent===${JSON.stringify(want)} && ${shown('#cmp-tray')},why:document.querySelector('#cmp-tray-text').textContent})`, 5000, `tray ${n}`);
          // The tray slides up (Leon, 2026-11-06): measure it once it has landed.
          await page.waitFor(`({ok:document.querySelector('#cmp-tray').getAnimations().every((a)=>a.playState!=='running'),why:'tray sliding'})`, 3000, 'tray settled');
          await frames(page);
          const m = await page.ev(`(()=>{
            const t=document.querySelector('#cmp-tray-text'), b=document.querySelector('#cmp-tray-open'), tray=document.querySelector('#cmp-tray');
            const rt=t.getBoundingClientRect(), rb=b.getBoundingClientRect(), r=tray.getBoundingClientRect();
            const inside=(x)=>x.left>=0&&x.right<=innerWidth&&x.top>=0&&x.bottom<=innerHeight+0.5;
            return {inside:inside(rt)&&inside(rb),button:rb.height,clipped:t.scrollWidth>t.clientWidth+1,header:${shown('#header-compare')},
              pad:parseFloat(getComputedStyle(document.body).paddingBottom),tray:r.height,overflow:document.documentElement.scrollWidth-innerWidth};
          })()`);
          assert(m.inside && m.button >= 44 && !m.clipped && !m.header && Math.abs(m.pad - m.tray - 24) <= 1 && m.overflow <= 0, JSON.stringify(m));
        }
        await shot(page, `tray-${width}x${height}-${ui}`);
        if (width === 1280) {
          // Wide and short: the tray and the pane, whose end stays above it.
          await page.click(`document.querySelector('#results button.open')`, 'a programme for the pane');
          // Scrolled, so the pane sticks; at the top it runs on below the window anyway.
          await page.ev('window.scrollTo(0,1500)');
          await frames(page);
          const p = await page.ev(`({pane:document.querySelector('#pane').getBoundingClientRect().bottom,tray:document.querySelector('#cmp-tray').getBoundingClientRect().top})`);
          assert(p.pane <= p.tray + 0.5, 'the pane ends under the tray ' + JSON.stringify(p));
        }
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 4. The tray never hides focus, a toast or the end of the page; typing and
  // print hide it; crossing 600 wide or 500 tall keeps focus where it is.
  for (const [width, height, ui] of [[390, 844, 'en'], [320, 568, 'sk']]) {
    const short = data.filter((r) => r.country === longest.country).slice(0, 1)[0];
    const page = await open(`?ui=${ui}&q=${encodeURIComponent(longest.programme)}`, width, height, four.slice(0, 3));
    try {
      await check(`${width}x${height}/${ui}`, 'B3A tray focus', 'Tab through the last card keeps every focus above the tray, the toast sits above it and the footer clears it', async () => {
        await page.waitFor(`({ok:${shown('#cmp-tray')},why:'no tray'})`, 5000, 'tray with three');
        await page.click(`document.querySelector('#results li.item:last-child button.star')`, 'save for a toast');
        await page.waitFor(`({ok:!!document.querySelector('#toasts .toast'),why:'no toast'})`, 5000, 'toast');
        await frames(page);
        const toast = await page.ev(`({toast:document.querySelector('#toasts .toast').getBoundingClientRect().bottom,tray:document.querySelector('#cmp-tray').getBoundingClientRect().top})`);
        assert(toast.toast <= toast.tray + 0.5, 'toast under the tray ' + JSON.stringify(toast));
        await page.ev(`document.querySelector('#results li.item:last-child button.open').focus()`);
        const seen = [];
        for (let i = 0; i < 6; i++) {
          await page.key('Tab', 'Tab', 9);
          await frames(page);
          const f = await page.ev(`(()=>{const a=document.activeElement,r=a.getBoundingClientRect(),t=document.querySelector('#cmp-tray');
            return {what:a.tagName+'.'+a.className+'#'+a.id,inTray:t.contains(a),bottom:r.bottom,height:r.height,top:t.hidden?Infinity:t.getBoundingClientRect().top}})()`);
          seen.push(f.what);
          if (f.inTray || !f.height) continue;
          assert(f.bottom <= f.top + 0.5, `focus on ${f.what} is under the tray: ${JSON.stringify(f)}`);
        }
        await page.ev('window.scrollTo(0,document.documentElement.scrollHeight)');
        await frames(page);
        const end = await page.ev(`({card:document.querySelector('#results li.item:last-child').getBoundingClientRect().bottom,foot:document.querySelector('.foot').getBoundingClientRect().bottom,tray:document.querySelector('#cmp-tray').getBoundingClientRect().top})`);
        assert(end.card <= end.tray + 0.5 && end.foot <= end.tray + 0.5, 'the end of the page is under the tray ' + JSON.stringify(end));
        await shot(page, `tray-end-${width}-${ui}`);
      });
      await check(`${width}x${height}/${ui}`, 'B3A tray typing', 'focusing Search hides the tray and its space; leaving it brings both back', async () => {
        await page.ev(`window.scrollTo(0,0);document.querySelector('#f-search').focus()`);
        await page.waitFor(`({ok:!${shown('#cmp-tray')} && !document.body.classList.contains('has-tray') && getComputedStyle(document.body).paddingBottom==='0px',why:'tray still there'})`, 3000, 'tray hidden while typing');
        await page.ev('document.activeElement.blur()');
        await page.waitFor(`({ok:${shown('#cmp-tray')} && document.body.classList.contains('has-tray'),why:'tray not back'})`, 3000, 'tray back');
      });
      if (width === 390) await check(`${width}/${ui}`, 'B3A tray crossings', 'across 599/600 wide and 500/501 tall the entry swaps between tray and header and focus stays put', async () => {
        await page.ev(`document.querySelector('#results button.cmpi').focus()`);
        for (const [w, h, tray] of [[599, 900, true], [600, 900, false], [600, 500, true], [600, 501, false], [390, 844, true]]) {
          await resize(page, w, h);
          await page.waitFor(`({ok:${shown('#cmp-tray')}===${tray} && ${shown('#header-compare')}===${!tray} && document.activeElement===document.querySelector('#results button.cmpi'),why:JSON.stringify({tray:${shown('#cmp-tray')},header:${shown('#header-compare')},focus:document.activeElement.className})})`, 3000, `${w}x${h}`);
        }
      });
      if (width === 390) await check(`${width}/${ui}`, 'B3A tray print', 'in print there is no tray and no space for it; an open comparison prints its facts and official links', async () => {
        await page.ev(`document.querySelector('#cmp-tray-open').click()`);
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare closed'})`, 3000, 'compare open');
        await page.ev(`document.querySelector('#cmp-close').click()`);
        await page.send('Emulation.setEmulatedMedia', { media: 'print' });
        try {
          const m = await page.ev(`({tray:getComputedStyle(document.querySelector('#cmp-tray')).display,pad:getComputedStyle(document.body).paddingBottom,scroll:getComputedStyle(document.documentElement).scrollPaddingBottom})`);
          assert(m.tray === 'none' && m.pad === '0px' && (m.scroll === '0px' || m.scroll === 'auto'), JSON.stringify(m));
        } finally { await page.send('Emulation.setEmulatedMedia', { media: '' }); }
        await page.ev(`document.querySelector('#cmp-tray-open').click()`);
        await page.send('Emulation.setEmulatedMedia', { media: 'print' });
        try {
          const m = await page.ev(`(()=>{const link=document.querySelector('#cmp-body a.lnk');
            return {compare:getComputedStyle(document.querySelector('#compare')).display,list:getComputedStyle(document.querySelector('.split')).display,
              link:getComputedStyle(link).display,after:getComputedStyle(link,'::after').content,facts:document.querySelectorAll('#cmp-body tr[data-fact]').length,
              tray:getComputedStyle(document.querySelector('#cmp-tray')).display,pad:getComputedStyle(document.body).paddingBottom}})()`);
          assert(m.compare !== 'none' && m.list === 'none' && m.link !== 'none' && m.after.includes('http') && m.facts >= 9 && m.tray === 'none' && m.pad === '0px', JSON.stringify(m));
        } finally { await page.send('Emulation.setEmulatedMedia', { media: '' }); }
        await page.ev(`document.querySelector('#cmp-close').click()`);
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 5. The view at 0, 1, 2 and 3 on desktop, the fifth add, and a focused Undo
  // toast that survives a second toast (keyboard only).
  {
    const page = await open('?ui=en', 1280, 900);
    try {
      await check(1280, 'B3A view counts', 'the header opens an empty state at 0 and one column with a prompt at 1; Close returns focus to the header button', async () => {
        await page.click(`document.querySelector('#header-compare')`, 'Compare (0)');
        await page.waitFor(`({ok:${shown('#cmp-empty')} && document.activeElement.id==='cmp-h' && !${shown('.split')},why:'no empty state'})`, 5000, 'empty compare');
        await shot(page, 'compare-0-1280-en');
        await page.click(`document.querySelector('#cmp-browse')`, 'Browse programmes');
        await page.waitFor(`({ok:document.querySelector('#compare').hidden && document.activeElement.id==='header-compare',why:document.activeElement.id})`, 5000, 'back to the list');
        await page.click(`document.querySelector('#results button.cmpi')`, 'add one');
        await page.waitFor(`({ok:document.querySelector('#toasts .toast')?.textContent.startsWith(${JSON.stringify(say('en', 'r3_cmp_added', { count: 1 }))}),why:'no add toast'})`, 5000, 'the add toast');
        await page.click(`document.querySelector('#header-compare')`, 'Compare (1)');
        await page.waitFor(`({ok:${shown('#cmp-one')} && document.querySelectorAll('#cmp-body th[scope=col]').length===1 && !${shown('#cmp-diff-label')},why:'not one column'})`, 5000, 'one column');
        const { root: axDoc } = await page.send('DOM.getDocument', { depth: 0 });
        const { nodeId: headerId } = await page.send('DOM.querySelector', { nodeId: axDoc.nodeId, selector: 'th.cmp-p' });
        const { nodes: axNodes } = await page.send('Accessibility.getPartialAXTree', { nodeId: headerId, fetchRelatives: false });
        const expectedName = await page.ev(`[...document.querySelectorAll('th.cmp-p .cmp-n, th.cmp-p .cmp-u')].map(n=>n.textContent).join(' ')`);
        assert(axNodes[0]?.name?.value === expectedName, 'column header includes action labels: ' + axNodes[0]?.name?.value);
        await shot(page, 'compare-1-1280-en');
        await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
        await page.waitFor(`({ok:document.querySelector('#compare').hidden && document.activeElement.id==='header-compare',why:document.activeElement.id})`, 5000, 'focus back on the header');
      });
      await check(1280, 'B3A fifth', 'a fifth add is refused, never disabled; the toast\'s Open compare opens four columns', async () => {
        for (let i = 1; i < 5; i++) await page.click(`document.querySelectorAll('#results button.cmpi')[${i}]`, `compare toggle ${i + 1}`);
        const fifth = `document.querySelectorAll('#results button.cmpi')[4]`;
        await page.waitFor(`({ok:document.querySelector('#toasts .toast')?.textContent.startsWith(${JSON.stringify(say('en', 'r3_cmp_full'))}),why:document.querySelector('#toasts')?.textContent})`, 5000, 'the limit toast');
        assert(await page.ev(`${fifth}.getAttribute('aria-pressed')==='false' && !${fifth}.disabled && !${fifth}.hasAttribute('aria-disabled') && JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).length===4`), 'the fifth was added or disabled');
        await page.click(`document.querySelector('#toasts .toast button')`, 'Open compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden && document.querySelectorAll('#cmp-body th[scope=col]').length===4,why:'not four columns'})`, 5000, 'four columns');
        await shot(page, 'compare-4-1280-en');
      });
      await check(1280, 'B3A keyboard undo', 'Enter on an "x" moves focus to the next column\'s "x"; a second toast leaves the focused Undo in place, and that Undo restores its own programme', async () => {
        const ids = await page.ev(`[...document.querySelectorAll('#cmp-body th[scope=col]')].map(th=>th.dataset.id)`);
        await page.ev(`document.querySelector('#cmp-body [data-compare-remove="${ids[1]}"]').focus()`);
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`({ok:document.activeElement===document.querySelector('#cmp-body [data-compare-remove="${ids[2]}"]'),why:document.activeElement.outerHTML.slice(0,80)})`, 5000, 'focus on the next x');
        await page.ev(`document.querySelector('#toasts .toast button').focus()`);
        await page.ev(`document.querySelector('#cmp-body [data-compare-remove="${ids[0]}"]').click()`);
        await page.waitFor(`({ok:document.querySelectorAll('#toasts .toast').length===2,why:document.querySelectorAll('#toasts .toast').length+' toasts'})`, 5000, 'two toasts');
        assert(await page.ev(`document.activeElement===document.querySelector('#toasts .toast button')`), 'the focused Undo lost focus');
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`({ok:[...document.querySelectorAll('#cmp-body th[scope=col]')].map(th=>th.dataset.id).join()===${JSON.stringify([ids[1], ids[2], ids[3]].join())} && document.activeElement===document.querySelector('#cmp-body [data-compare-remove="${ids[1]}"]'),why:[...document.querySelectorAll('#cmp-body th[scope=col]')].map(th=>th.dataset.id).join()+' / '+document.activeElement.outerHTML.slice(0,60)})`, 5000, 'its own programme back, focused');
      });
      await check(1280, 'B3A redraw focus', 'saving in a column keeps its focus; another tab dropping the focused column moves focus to the next "x"; a language switch keeps both and the sideways scroll', async () => {
        const save = `document.querySelector('#cmp-body th [data-save-id]')`;
        await page.ev(`${save}.focus()`);
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`({ok:${save}.getAttribute('aria-pressed')==='true' && document.activeElement===${save} && document.querySelector('#shortlist-bar').hidden,why:'save lost focus or bar shown'})`, 5000, 'saved in place');
        const ids = await page.ev(`[...document.querySelectorAll('#cmp-body th[scope=col]')].map(th=>th.dataset.id)`);
        await page.ev(`document.querySelector('#cmp-body [data-compare-remove="${ids[0]}"]').focus();localStorage.setItem(${JSON.stringify(KEY)},${JSON.stringify(JSON.stringify(ids.slice(1)))});dispatchEvent(new StorageEvent('storage',{key:${JSON.stringify(KEY)}}))`);
        await page.waitFor(`({ok:document.activeElement===document.querySelector('#cmp-body [data-compare-remove="${ids[1]}"]'),why:document.activeElement.outerHTML.slice(0,60)})`, 5000, 'focus on the next x');
        await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language="sk"]'))`);
        await page.waitFor(`({ok:document.activeElement===document.querySelector('#cmp-body [data-compare-remove="${ids[1]}"]') && document.querySelector('#cmp-h').textContent===${JSON.stringify(say('sk', 'r3_cmp_heading', { count: ids.length - 1 }))},why:document.activeElement.outerHTML.slice(0,60)})`, 5000, 'focus kept in Slovak');
        await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language="en"]'))`);
        assert(!page.errors.length && !page.exceptions.length, JSON.stringify([...page.errors, ...page.exceptions]));
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 6. Phones with 3 and 4: Close at the top right, the range, the arrows,
  // the fade, a real swipe and Tab into the hidden columns.
  for (const width of [320, 390]) for (const ui of ['en', 'sk']) for (const n of [3, 4]) {
    const page = await open(`?ui=${ui}`, width, 844, four.slice(0, n));
    try {
      await check(`${width}/${ui}/${n}`, 'B3A phone compare', 'Close at the top right; "1–2 of n", arrows and a fade that stop at each end; a swipe and Tab move through the columns', async () => {
        await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden && document.querySelectorAll('#cmp-body th[scope=col]').length===${n},why:'compare not open'})`, 5000, 'compare open');
        await frames(page);
        const head = await page.ev(`(()=>{const h=document.querySelector('.cmp-head'),c=document.querySelector('#cmp-close').getBoundingClientRect(),t=document.querySelector('#cmp-h').getBoundingClientRect(),r=h.getBoundingClientRect(),pad=parseFloat(getComputedStyle(h).paddingRight);
          return {right:Math.abs(c.right-(r.right-pad)),row:c.top<t.bottom&&t.top<c.bottom,size:[c.width,c.height],overflow:document.documentElement.scrollWidth-innerWidth}})()`);
        assert(head.right <= 2 && head.row && head.size.every((s) => s >= 44) && head.overflow <= 0, JSON.stringify(head));
        const range = (from, to) => say(ui, n === 4 ? 'r3_cmp_range_zo' : 'r3_cmp_range', { from, to, total: n });
        const state = `(()=>{const f=document.querySelector('.cmp-frame'),b=document.querySelector('.cmp-scroll');return {range:document.querySelector('.cmp-range').textContent,prev:document.querySelector('.cmp-prev').disabled,next:document.querySelector('.cmp-next').disabled,fade:getComputedStyle(f,'::after').display!=='none',end:f.classList.contains('at-end'),scroll:[b.scrollLeft,b.clientWidth,b.scrollWidth]}})()`;
        let m = await page.ev(state);
        assert(m.range === range(1, 2) && m.prev && !m.next && m.fade, 'start ' + JSON.stringify(m));
        if (width === 390 && n === 3) await shot(page, `compare-3-phone-${ui}`);
        for (let to = 3; to <= n; to++) {
          await page.click(`document.querySelector('.cmp-next')`, 'Next programme');
          await page.waitFor(`({ok:${state}.range===${JSON.stringify(range(to - 1, to))},why:${state}.range})`, 5000, `range ${to - 1}–${to}`);
        }
        // The arrows scroll smoothly; the end state lands once the scroll settles.
        await page.waitFor(`(()=>{const m=${state};return {ok:m.next && !m.prev && !m.fade && m.end,why:JSON.stringify(m)}})()`, 5000, 'the end state');
        if (width === 390 && n === 3) await shot(page, `compare-3-phone-end-${ui}`);
        await page.ev(`document.querySelector('.cmp-scroll').scrollLeft=0`);
        await page.waitFor(`({ok:${state}.range===${JSON.stringify(range(1, 2))},why:${state}.range})`, 5000, 'back at the start');
        // A finger dragged right to left across the table, inside the window.
        const box = await page.ev(`(()=>{const r=document.querySelector('.cmp-scroll').getBoundingClientRect();return {x:Math.round(Math.min(r.right,innerWidth)-30),y:Math.round(Math.min(Math.max(r.top+80,10),innerHeight-10))}})()`);
        await page.send('Input.synthesizeScrollGesture', { x: box.x, y: box.y, xDistance: -150, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
        await page.waitFor(`({ok:${state}.range!==${JSON.stringify(range(1, 2))},why:${state}.range})`, 5000, 'a swipe moves the range');
        await page.ev(`document.querySelector('.cmp-scroll').scrollLeft=0`);
        await frames(page);
        const third = await page.ev(`document.querySelectorAll('#cmp-body th[scope=col]')[2].dataset.id`);
        await page.ev(`document.querySelectorAll('#cmp-body th[scope=col]')[1].querySelector('.cmp-x').focus()`);
        for (const [what, selector] of [['save', `th[data-id="${third}"] [data-save-id]`], ['x', `th[data-id="${third}"] .cmp-x`]]) {
          await page.key('Tab', 'Tab', 9);
          await page.waitFor(`(()=>{const a=document.activeElement,box=document.querySelector('.cmp-scroll').getBoundingClientRect(),fact=document.querySelector('.cmp-c').getBoundingClientRect(),r=a.getBoundingClientRect();
            return {ok:a===document.querySelector('#cmp-body ${selector}') && r.left>=fact.right-0.5 && r.right<=box.right+0.5,why:a.outerHTML.slice(0,60)+' '+JSON.stringify([r.left,r.right,fact.right,box.right])}})()`, 5000, `Tab to the third column's ${what}`);
        }
        assert(await page.ev(noOverflow), 'the page scrolls sideways');
      });
    } finally { await page.close(); }
    watchdog.refresh();
  }

  // 7. Screenshots for Leon: the phone view at 0 (after the last x) and 1.
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, 390, 844, four.slice(0, 1));
    try {
      await check(`390/${ui}`, 'B3A phone one and none', 'one column asks for another; the last "x" leaves the empty state with focus on Browse', async () => {
        await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
        await page.waitFor(`({ok:${shown('#cmp-one')},why:'no one-column prompt'})`, 5000, 'one column');
        await shot(page, `compare-1-phone-${ui}`);
        await page.click(`document.querySelector('#cmp-body .cmp-x')`, 'x');
        await page.waitFor(`({ok:${shown('#cmp-empty')} && document.activeElement.id==='cmp-browse',why:document.activeElement.id})`, 5000, 'empty state');
        await shot(page, `compare-0-phone-${ui}`);
        await page.click(`document.querySelector('#cmp-browse')`, 'Browse');
        await page.waitFor(`({ok:document.querySelector('#compare').hidden && ${shown('.split')},why:'still open'})`, 5000, 'closed');
      });
    } finally { await page.close(); }
  }
}

async function runBatch3B(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-batch3-b';
  await mkdir(shots, { recursive: true });
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'B3B page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'B3B reload');
    return page;
  };
  // Saves the first n programmes of the main list, then reloads.
  const seed = async (page, n) => {
    await page.ev(`(()=>{const ids=[...document.querySelectorAll('#results>li.item')].slice(0,${n}).map(li=>li.dataset.id);localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify(ids));window.__oldPage=true;location.reload()})()`);
    await page.waitFor(ready, 15000, 'B3B seeded reload');
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))))`);

  // B1 (Leon, Q2): the phone main view had a half-empty My list box above the
  // cards. Below the status row the list comes first now.
  for (const width of [320, 390]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, 844);
    try {
      await check(`${width}/${ui}`, 'B3B main top', 'with 3 saved, no My list box: the list follows the status row', async () => {
        await seed(page, 3);
        await page.ev(`scrollTo({top:0,behavior:'instant'})`);
        await settle(page);
        const m = await page.ev(`(()=>{const status=document.querySelector('.stream>.status');const after=[];let on=false;
          for(const n of document.querySelector('.stream').children){if(n===status){on=true;continue}if(!on)continue;
            const s=getComputedStyle(n),r=n.getBoundingClientRect();if(s.display!=='none'&&r.height>0)after.push(n.id||n.className)}
          return {after,bar:getComputedStyle(document.querySelector('#shortlist-bar')).display,saved:document.querySelector('#header-list-count').textContent,sw:document.documentElement.scrollWidth-innerWidth}})()`);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(`${shots}/main-top-${width}-${ui}.png`, Buffer.from(data, 'base64'));
        assert(m.saved === '3', `header count ${m.saved}`);
        assert(m.bar === 'none', `My list box shows: ${m.bar}`);
        // The count summary is the status row's own second line (aria-hidden copy).
        const first = m.after.filter((n) => n !== 'count-summary' && n !== 'count count-summary')[0];
        assert(first === 'split', `first after the status row: ${JSON.stringify(m.after)}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
      });
      await check(`${width}/${ui}`, 'B3B save failure', 'a failed save keeps the phone main-view warning visible', async () => {
        await page.ev(`window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='ib-university-finder:shortlist:v1')throw new Error('blocked');return window.__setItem.call(this,k,v)}`);
        try {
          await page.click(`document.querySelector('#results button.star')`, 'unsave with storage blocked');
          assert(await page.ev(`(()=>{const b=document.querySelector('#shortlist-bar'),n=document.querySelector('#ml-note');return getComputedStyle(b).display!=='none'&&!n.hidden&&n.getBoundingClientRect().height>0})()`), 'save failure warning is hidden');
        } finally { await page.ev(`Storage.prototype.setItem=window.__setItem;delete window.__setItem`); }
      });
    } finally { await page.close(); }
  }

  // B2 (Leon, 2026-11-05): on a phone "Back to all programmes" was misaligned
  // and "Clear my list" looked like an empty grid cell.
  const resize = async (page, width, height = 844) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`({ok:innerWidth===${width},why:'width '+innerWidth})`, 3000, `width ${width}`);
    await settle(page);
  };
  for (const ui of ['en', 'sk']) for (const n of [1, 3]) {
    const page = await open(`?ui=${ui}`, 390, 844);
    try {
      await seed(page, n);
      await page.click(`document.querySelector('#header-list')`, 'header My list');
      await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list') && !document.querySelector('#ml-tools').hidden,why:'list view not open'})`, 5000, 'the list view');
      // Since 2026-11-06 the phone tools wait behind More (runPhoneMyListCompare);
      // opened once here, they stay open through the widths below.
      await page.click(`document.querySelector('#ml-more')`, 'More');
      for (const width of [320, 390, 599]) {
        await check(`${width}/${ui}`, 'B3B list toolbar', `${n} saved: back top-left, an even 2 x 2 grid, Clear outlined, 44 px, no overflow`, async () => {
          await resize(page, width);
          await page.ev(`scrollTo({top:0,behavior:'instant'})`);
          await settle(page);
          const m = await page.ev(`(()=>{const box=(n)=>n.getBoundingClientRect();
            const bar=document.querySelector('#shortlist-bar'),bs=getComputedStyle(bar),b=box(bar);
            const contentLeft=b.left+parseFloat(bs.borderLeftWidth)+parseFloat(bs.paddingLeft);
            const back=document.querySelector('#f-shortlist-only'),k=box(back),h=box(document.querySelector('#ml-h'));
            const icon=back.querySelector('svg'),ir=box(icon);
            const four=['#ml-share>summary','#export-csv','#print-shortlist','#clear-shortlist'].map(s=>document.querySelector(s));
            const r4=four.map(box);
            const labels=[back,...four].filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.id||n.textContent.trim());
            return {backLeft:k.left-contentLeft,backFirst:k.bottom<=h.top+1,backH:k.height,iconShown:ir.width>0,iconTurn:getComputedStyle(icon).transform,
              widths:r4.map(r=>Math.round(r.width)),heights:r4.map(r=>Math.round(r.height)),
              cols:[...new Set(r4.map(r=>Math.round(r.left)))].length,rows:[...new Set(r4.map(r=>Math.round(r.top)))].length,
              order:[r4[0].top===r4[1].top,r4[2].top===r4[3].top,r4[0].left===r4[2].left],
              clearBorder:parseFloat(getComputedStyle(four[3]).borderTopWidth),clearIcon:box(four[3].querySelector('svg')).width,
              labels,sw:document.documentElement.scrollWidth-innerWidth}})()`);
          if (width !== 599) {
            const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
            await writeFile(`${shots}/list-${n}saved-${width}-${ui}.png`, Buffer.from(data, 'base64'));
          }
          assert(Math.abs(m.backLeft) <= 1 && m.backFirst && m.backH >= 44, `back button: ${JSON.stringify(m)}`);
          assert(m.iconShown && m.iconTurn !== 'none', `back chevron missing or not turned: ${JSON.stringify(m)}`);
          assert(Math.max(...m.widths) - Math.min(...m.widths) <= 1 && m.heights.every((x) => x >= 44)
            && Math.abs(m.heights[0] - m.heights[1]) <= 1 && Math.abs(m.heights[2] - m.heights[3]) <= 1, `uneven tools: ${JSON.stringify(m)}`);
          assert(m.cols === 2 && m.rows === 2 && m.order.every(Boolean), `not a 2 x 2 grid: ${JSON.stringify(m)}`);
          // Under 360 px the tool icons go, so every label fits on one line (alignment audit).
          assert(m.clearBorder >= 1 && (width < 360 ? m.clearIcon === 0 : m.clearIcon > 0), `Clear my list not a bordered button: ${JSON.stringify(m)}`);
          assert(m.labels.length === 0, `labels overflow: ${m.labels}`);
          assert(m.sw === 0, `page overflows by ${m.sw}`);
        });
      }
      // Desktop gains the chevron: shown in the list, never in the main view.
      // Clear my list is a small outlined button there too, without the phone's
      // trash icon (alignment audit, 2026-11-05).
      await check(`1280/${ui}`, 'B3B list toolbar', `${n} saved: desktop back button gains only the chevron; Clear is outlined, no icon`, async () => {
        await resize(page, 1280, 900);
        const list = await page.ev(`(()=>{const i=document.querySelector('#f-shortlist-only svg'),c=document.querySelector('#clear-shortlist');return {chev:i.getBoundingClientRect().width,clearIcon:c.querySelector('svg').getBoundingClientRect().width,clearBorder:getComputedStyle(c).borderTopColor,clearWidth:getComputedStyle(c).borderTopWidth,edge:getComputedStyle(document.querySelector('#export-csv')).borderTopColor}})()`);
        await page.click(`document.querySelector('#f-shortlist-only')`, 'Back to all programmes');
        await page.waitFor(`({ok:!document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'still the list view'})`, 5000, 'the main view');
        const main = await page.ev(`document.querySelector('#f-shortlist-only svg').getBoundingClientRect().width`);
        assert(list.chev > 0 && main === 0, `chevron list ${list.chev}, main ${main}`);
        assert(list.clearIcon === 0 && list.clearWidth === '1px' && list.clearBorder === list.edge, `desktop Clear not an outlined button like Export: ${JSON.stringify(list)}`);
      });
    } finally { await page.close(); }
  }

  // B3 (Leon, 2026-11-05): an empty My list did nothing when clicked.
  for (const width of [390, 1280]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, width < 600 ? 844 : 900);
    try {
      await check(`${width}/${ui}`, 'B3B empty list', 'a real click on My list (0) shows the empty state; its button goes back', async () => {
        const { UI } = await import('../js/i18n.js');
        assert(await page.ev(`document.querySelector('#header-list-count').textContent==='0'`), 'not 0 saved');
        await page.click(`document.querySelector('#header-list')`, 'My list (0)');
        await page.waitFor(`({ok:!document.querySelector('#empty-state').hidden && document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'no empty list view'})`, 5000, 'the empty list view');
        await settle(page);
        const m = await page.ev(`(()=>{const v=(s)=>{const n=document.querySelector(s);return n&&getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().height>0};
          return {title:document.querySelector('#empty-title').textContent,hint:document.querySelector('#empty-hint').textContent,back:v('#empty-back'),tools:v('#ml-tools'),tips:v('#empty-tips'),clear:v('#empty-clear'),
            pressed:document.querySelector('#header-list').getAttribute('aria-pressed'),sw:document.documentElement.scrollWidth-innerWidth}})()`);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(`${shots}/empty-list-${width}-${ui}.png`, Buffer.from(data, 'base64'));
        assert(m.title === UI[ui].your_list_is_empty && m.hint === UI[ui].r3_list_empty_hint, `texts: ${JSON.stringify(m)}`);
        assert(m.back && !m.tools && !m.tips && !m.clear && m.pressed === 'true', `empty view: ${JSON.stringify(m)}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
        // A navigation button has no action on paper; keep the empty-list copy.
        await page.send('Emulation.setEmulatedMedia', { media: 'print' });
        try {
          assert(await page.ev(`getComputedStyle(document.querySelector('#empty-back')).display==='none' && getComputedStyle(document.querySelector('#empty-state')).display!=='none'`), 'empty-list back button prints');
        } finally { await page.send('Emulation.setEmulatedMedia', { media: '' }); }
        // Keep the real mouse hit test, then re-enter for keyboard activation.
        await page.click(`document.querySelector('#empty-back')`, 'Back to all programmes');
        assert(await page.ev(`!document.querySelector('#shortlist-bar').classList.contains('is-list') && document.activeElement===document.querySelector('#header-list')`), 'mouse exit lost focus');
        await page.click(`document.querySelector('#header-list')`, 'Reopen empty My list');
        await page.ev(`document.querySelector('#empty-back').focus()`);
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`({ok:!document.querySelector('#shortlist-bar').classList.contains('is-list') && document.querySelector('#empty-state').hidden && document.activeElement===document.querySelector('#header-list'),why:'not back, or focus on '+(document.activeElement?.id||document.activeElement?.tagName)})`, 5000, 'the main list with focus on My list');
      });
    } finally { await page.close(); }
  }

  // Screenshots for review: 320, 375, 768 and 1280 px, EN and SK; the main
  // view with 3 saved, My list with 1 saved, and the empty My list.
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, 375, 844);
    try {
      const snap = async (name, width) => {
        await page.ev(`scrollTo({top:0,behavior:'instant'})`);
        await settle(page);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(`${shots}/review-${width}-${ui}-${name}.png`, Buffer.from(data, 'base64'));
        return page.ev('document.documentElement.scrollWidth-innerWidth');
      };
      await check(ui, 'B3B shots', 'review screenshots at 320, 375, 768 and 1280 px with no page overflow', async () => {
        const over = [];
        const view = async (list) => {
          const on = await page.ev(`document.querySelector('#shortlist-bar').classList.contains('is-list')`);
          if (on !== list) await page.ev(`document.querySelector('#header-list').click()`);
          await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list')===${list},why:'view'})`, 5000, 'the view');
        };
        const each = async (name, list) => {
          for (const width of [320, 375, 768, 1280]) {
            await resize(page, width, width < 600 ? 844 : 900);
            await view(list);
            const sw = await snap(name, width);
            if (sw) over.push(`${name} ${width}: ${sw}`);
          }
        };
        await each('empty-list', true);
        await view(false);
        await seed(page, 1);
        await each('list-1saved', true);
        await view(false);
        await seed(page, 3);
        await each('main-3saved', false);
        assert(over.length === 0, over.join(' | '));
      });
    } finally { await page.close(); }
  }
}

async function runBatch3C(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-batch3-c';
  await mkdir(shots, { recursive: true });
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'navigation or loading pending'})`;
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))))`);
  const shoot = async (page, name) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };

  // C1: setup ends on a done screen. 568 px is the shortest phone we design for.
  for (const width of [320, 390, 1280]) {
    const page = await openPage(`${base}?ui=en`, width, 568);
    try {
      await page.waitFor(ready, 15000, 'done screen page');
      for (const lang of ['en', 'sk']) {
        for (const reduced of [false, true]) {
          await check(width, 'B3C done screen', `(${lang}${reduced ? ', reduced motion' : ''}): both buttons in view at 568 px, 44 px, primary on top on phones, no overflow`, async () => {
            watchdog.refresh();
            if (reduced) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
            try {
              // A first visit opens setup by itself.
              await page.ev(`localStorage.clear();localStorage.setItem('ib-university-finder:language','${lang}');window.__oldPage=true;location.href=${JSON.stringify(base)}+'?ui=${lang}'`);
              await page.waitFor(ready, 15000, 'reloaded page');
              await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup not open'})`, 5000, 'setup');
              for (let i = 0; i < 4; i++) await page.click(`document.querySelector('.ob-foot>.btn-p')`, `step ${i + 1}`);
              await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Finish');
              if (reduced) assert(await page.ev(`getComputedStyle(document.querySelector('.ob-done')).animationName==='none'`), 'the done screen still slides in with reduced motion');
              await settle(page);
              const m = await page.ev(`(()=>{const d=document.querySelector('#onboarding'),r=d.getBoundingClientRect(),body=d.querySelector('.ob-body'),btns=[...d.querySelectorAll('.ob-foot .btn')],box=(n)=>n.getBoundingClientRect();
                return {heading:d.querySelector('.ob-done h2').textContent,focused:document.activeElement===d.querySelector('#ob-title'),step:!!d.querySelector('.ob-n'),bar:d.querySelector('.ob-bar i').style.transform,
                  dialog:[r.top,r.bottom],btns:btns.map(b=>{const k=box(b);return {text:b.textContent,primary:b.classList.contains('btn-p'),top:k.top,bottom:k.bottom,left:k.left,right:k.right,w:k.width,h:k.height,clipped:b.scrollWidth>b.clientWidth+1}}),
                  foot:(()=>{const f=box(d.querySelector('.ob-foot')),s=getComputedStyle(d.querySelector('.ob-foot'));return {left:f.left+parseFloat(s.paddingLeft),right:f.right-parseFloat(s.paddingRight)}})(),
                  bodyOver:body.scrollWidth>body.clientWidth,sw:document.documentElement.scrollWidth,w:innerWidth,h:innerHeight}})()`);
              await shoot(page, `done-${width}-${lang}${reduced ? '-reduced' : ''}`);
              assert(m.heading === (lang === 'sk' ? 'V nastavení nie sú žiadne odpovede.' : "You haven't added any setup answers.") && m.focused && !m.step && m.bar === 'scaleX(1)', `screen ${JSON.stringify(m)}`);
              assert(m.btns.length === 2 && m.btns[0].primary, `buttons ${JSON.stringify(m.btns)}`);
              for (const b of m.btns) {
                assert(b.h >= 44 && b.w >= 44 && !b.clipped, `button ${JSON.stringify(b)}`);
                assert(b.top >= m.dialog[0] && b.bottom <= m.dialog[1] && b.bottom <= m.h && b.left >= 0 && b.right <= m.w, `button out of view: ${JSON.stringify(b)} dialog ${m.dialog}`);
              }
              const [primary, faq] = m.btns;
              if (width < 600) {
                assert(primary.bottom <= faq.top, `primary not on top: ${JSON.stringify(m.btns)}`);
                assert(m.btns.every(b => Math.abs(b.left - m.foot.left) <= 1 && Math.abs(b.right - m.foot.right) <= 1), `not full width: ${JSON.stringify(m)}`);
              } else {
                assert(Math.abs(primary.top - faq.top) <= 1 && primary.left > faq.right && Math.abs(primary.right - m.foot.right) <= 1, `primary not right of the FAQ: ${JSON.stringify(m)}`);
              }
              assert(!m.bodyOver && m.sw === m.w, `overflow ${JSON.stringify(m)}`);
              await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Show my programmes');
              assert(await page.ev(`!document.querySelector('#onboarding').open && document.activeElement.getAttribute('aria-labelledby')==='results-h' && localStorage.getItem('ibuf.onboarding.v1')==='completed'`), 'Show my programmes did not close to the results');
              assert(await page.ev(`!document.querySelector('#toasts .toast')`), 'a toast appeared after setup');
              assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
            } finally {
              if (reduced) await page.send('Emulation.setEmulatedMedia', { features: [] });
            }
          });
        }
      }
      // With an answer: the heading says so and the count says how many are
      // shown, then splits them by points as the count line does (review of
      // PR 1, 2026-11-07: "zodpovedá" counted rows outside the points).
      await check(width, 'B3C done screen', 'with an answer (sk): "Tvoje odpovede sú teraz filtre" and the shown count with its points parts', async () => {
        await page.ev(`localStorage.clear();localStorage.setItem('ib-university-finder:language','sk');window.__oldPage=true;location.href=${JSON.stringify(base)}+'?ui=sk'`);
        await page.waitFor(ready, 15000, 'reloaded page');
        await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup not open'})`, 5000, 'setup');
        await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Start');
        await page.click(`document.querySelector('#ob-points')`, 'points'); await page.type('36');
        for (let i = 0; i < 3; i++) await page.click(`document.querySelector('.ob-foot>.btn-p')`, `step ${i + 2}`);
        await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Dokončiť');
        await settle(page);
        const m = await page.ev(`({h:document.querySelector('.ob-done h2').textContent,count:document.querySelector('.ob-count').textContent,shown:document.querySelectorAll('#results>li.item').length,total:document.querySelector('#result-count b')?.textContent})`);
        await shoot(page, `done-${width}-sk-answers`);
        assert(m.h === 'Tvoje odpovede sú teraz filtre' && /^[\d\s\u00a0]+ zobrazen(ý|é|ých) program(y|ov)? · [\d\s\u00a0]+ v rámci tvojich IB bodov/.test(m.count), JSON.stringify(m));
        assert(m.count.split(' zobrazen')[0].replace(/\D/g, '') === String(m.total).replace(/\D/g, ''), `count ${m.count} vs shown ${m.total}`);
        await page.key('Escape', 'Escape', 27);
        assert(await page.ev(`!document.querySelector('#onboarding').open && document.querySelector('#f-points').value==='36' && localStorage.getItem('ibuf.onboarding.v1')==='completed'`), 'Esc on the done screen lost the answers');
      });
    } finally { await page.close(); }
  }
  // C2: the logo goes home from anywhere, keeps the filters, and can be reached
  // while scrolled: in the compact header from 600 px, in the stuck count row on
  // phones.
  const hits = 'const hits=(a,b)=>!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);';
  const clickAt = async (page, x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  };
  const centre = (sel) => `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`;
  const openHome = async (query, width, height) => {
    const page = await openPage(`${base}${query}`, width, height);
    await page.waitFor(ready, 15000, 'home page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'home page reloaded');
    return page;
  };
  const landedHome = (page, filters) => page.waitFor(`(()=>{const q=location.search;return {ok:scrollY===0&&document.querySelector('#header-list').getAttribute('aria-pressed')==='false'&&!q.includes('list=')&&${JSON.stringify(filters)}.every(f=>q.includes(f))&&location.hash===''&&document.activeElement===document.querySelector('.hd .mark'),
    why:JSON.stringify({y:scrollY,q,hash:location.hash,list:document.querySelector('#header-list').getAttribute('aria-pressed'),active:document.activeElement.className})}})()`, 8000, 'home');

  for (const width of [1280, 390]) {
    const page = await openHome('?ui=en&country=Ireland&points=36', width, width < 600 ? 844 : 900);
    try {
      const ids = await page.ev(`[...document.querySelectorAll('#results>li.item')].slice(0,2).map(n=>n.dataset.id)`);
      await check(width, 'R4B logo click', 'from My list: the main list at the top, filters kept', async () => {
        await page.ev(`localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify(${JSON.stringify(ids)}));window.__oldPage=true;location.reload()`);
        await page.waitFor(ready, 15000, 'reloaded with saves');
        await page.click(`document.querySelector('#header-list')`, 'My list');
        await page.waitFor(`({ok:document.querySelector('#header-list').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('#results>li.item').length===2,why:'not in My list'})`, 5000, 'My list');
        await page.click(`document.querySelector('.hd .mark')`, 'the logo');
        await landedHome(page, ['country=Ireland', 'points=36']);
        assert(await page.ev(`document.querySelectorAll('#results>li.item').length>2 && JSON.parse(localStorage.getItem('ib-university-finder:shortlist:v1')).length===2`), 'main list not back or saves lost');
      });
      await check(width, 'R4B logo click', 'from a shared ?list= link: the main list, list= dropped, filters kept', async () => {
        await page.ev(`window.__oldPage=true;location.href=${JSON.stringify(base)}+'?ui=en&country=Ireland&points=36&list=${ids.join(',')}'`);
        await page.waitFor(ready, 15000, 'shared list');
        await page.waitFor(`({ok:location.search.includes('list=')&&document.querySelector('#header-list').getAttribute('aria-pressed')==='true',why:location.search})`, 5000, 'shared view');
        await page.click(`document.querySelector('.hd .mark')`, 'the logo');
        await landedHome(page, ['country=Ireland', 'points=36']);
      });
    } finally { await page.close(); }
  }

  // Wide: scrolled until compact, the tile sits beside Filters, Search does not
  // move, and a real click on the tile goes home.
  for (const [width, coarse] of [[1280, false], [768, false], [768, true]]) {
    const page = await openHome('?ui=en&country=Ireland&points=36', width, 900);
    try {
      for (const lang of ['en', 'sk']) {
        await check(width, 'R4B logo click', `compact (${lang}, ${coarse ? 'touch' : 'mouse'}): the tile shows beside Filters, Search stays put, a real click goes home`, async () => {
          watchdog.refresh();
          await page.send('Emulation.setTouchEmulationEnabled', { enabled: coarse });
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: coarse });
          await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=${lang}]'))`);
          await page.waitFor(`({ok:document.documentElement.lang==='${lang}'&&innerWidth===${width}&&matchMedia('(pointer:coarse)').matches===${coarse},why:innerWidth})`, 3000, 'language and width');
          await page.ev(`document.activeElement.blur();scrollTo({top:0,behavior:'instant'})`);
          await page.waitFor(`({ok:!document.body.classList.contains('compact'),why:'compact at top'})`, 3000, 'expanded');
          await settle(page);
          const before = await page.ev(`(()=>{const q=document.querySelector('#f-search').getBoundingClientRect(),s=document.querySelector('.slot').getBoundingClientRect();return {search:q.left,slot:s.width}})()`);
          await page.ev(`scrollTo({top:2400,behavior:'instant'})`);
          await page.waitFor(`({ok:document.body.classList.contains('compact'),why:'not compact'})`, 3000, 'compact');
          await settle(page);
          const m = await page.ev(`(()=>{${hits}const box=(s)=>document.querySelector(s).getBoundingClientRect(),t=box('.hd .mono'),k=box('.hd .mark'),f=box('#compact-filters'),q=box('#f-search'),s=box('.slot'),c=${centre('.hd .mono')};
            const hit=document.elementFromPoint(c.x,c.y);return {tile:[t.left,t.width],mark:[k.left,k.right,k.width,k.height],opacity:getComputedStyle(document.querySelector('.hd .mark')).opacity,h1:getComputedStyle(document.querySelector('.mark h1')).opacity,
            filters:[f.left,f.right],midline:Math.abs((t.top+t.bottom)/2-(f.top+f.bottom)/2),over:hits(k,f),fOver:hits(f,q),inSlot:f.right<=s.right+0.5,search:q.left,slot:s.width,hit:document.querySelector('.hd .mark').contains(hit),sw:document.documentElement.scrollWidth,w:innerWidth}})()`);
          const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: await page.ev('scrollY'), width, height: 140, scale: 2 } });
          await writeFile(`${shots}/header-compact-${width}-${lang}${coarse ? '-touch' : ''}.png`, Buffer.from(data, 'base64'));
          assert(m.opacity === '1' && m.h1 === '0' && m.tile[1] >= 30 && m.hit, `tile not visible or not hit: ${JSON.stringify(m)}`);
          assert(m.midline <= 1, `tile and Filters off one centre line: ${JSON.stringify(m)}`);
          assert(!m.over && !m.fOver && m.inSlot && m.filters[0] > m.tile[0] + m.tile[1], `Filters overlaps: ${JSON.stringify(m)}`);
          assert(Math.abs(m.search - before.search) <= 0.5 && Math.abs(m.slot - before.slot) <= 0.5, `Search moved: ${JSON.stringify([before, m])}`);
          if (coarse) assert(m.mark[2] >= 44 && m.mark[3] >= 44, `touch target ${m.mark}`);
          assert(m.sw === m.w, `page is ${m.sw} wide at ${m.w}`);
          const c = await page.ev(centre('.hd .mono'));
          await clickAt(page, c.x, c.y);
          await landedHome(page, ['country=Ireland', 'points=36']);
          await page.waitFor(`({ok:!document.body.classList.contains('compact'),why:'still compact at the top'})`, 3000, 'header expanded at the top');
          await page.ev(`document.activeElement.blur()`);
        });
      }
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    } finally { await page.close(); }
  }

  // Phones: the header scrolls away, so the stuck count row carries the tile.
  for (const [width, lang] of [[390, 'en'], [375, 'en'], [375, 'sk'], [320, 'sk'], [320, 'en']]) {
    const page = await openHome(`?ui=${lang}&country=Ireland&points=36`, width, 844);
    try {
      const stick = async () => {
        await page.ev(`document.activeElement.blur();scrollTo({top:2400,behavior:'instant'})`);
        await page.waitFor(`({ok:document.querySelector('.status').classList.contains('is-stuck'),why:'not stuck'})`, 3000, 'stuck row');
        await settle(page);
      };
      await check(width, 'R4B logo click', `phone (${lang}): the stuck row shows [IB][count][Filters], 44 px, hit-testable, nothing overlaps`, async () => {
        await stick();
        const m = await page.ev(`(()=>{${hits}const box=(s)=>document.querySelector(s).getBoundingClientRect(),t=box('.home-tile'),n=box('.status .cshort'),f=box('#f-more'),c=${centre('.home-tile')};
          return {tile:[t.left,t.top,t.width,t.height],hit:document.querySelector('.home-tile').contains(document.elementFromPoint(c.x,c.y)),overlaps:[hits(t,n),hits(n,f),hits(t,f)],order:t.right<=n.left&&n.right<=f.left,inside:t.left>=0&&f.right<=innerWidth,sw:document.documentElement.scrollWidth,w:innerWidth,row:box('.status').height}})()`);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: await page.ev('scrollY'), width, height: 120, scale: 2 } });
        await writeFile(`${shots}/stuck-row-${width}-${lang}.png`, Buffer.from(data, 'base64'));
        assert(m.tile[2] >= 44 && m.tile[3] >= 44 && m.hit, `tile ${JSON.stringify(m)}`);
        assert(!m.overlaps.some(Boolean) && m.order && m.inside, `overlap ${JSON.stringify(m)}`);
        assert(m.sw === m.w, `page is ${m.sw} wide at ${m.w}`);
      });
      if (width === 390 || width === 320) await check(width, 'R4B logo click', `phone (${lang}): a real tap on the stuck tile goes to the top with focus on the logo, in view`, async () => {
        await stick();
        const c = await page.ev(centre('.home-tile'));
        await clickAt(page, c.x, c.y);
        await landedHome(page, ['country=Ireland', 'points=36']);
        assert(await page.ev(`(()=>{const r=document.querySelector('.hd .mark').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.width>=44})()`), 'the logo is not in view');
      });
      if (width === 390) await check(width, 'R4B logo click', 'phone keyboard: Enter on the stuck tile, then a visible focus ring on the logo; reduced motion is instant', async () => {
        for (const reduced of [false, true]) {
          if (reduced) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
          try {
            await stick();
            await page.ev(`document.querySelector('.home-tile').focus()`);
            await page.key('Enter', 'Enter', 13, [], '\r');
            if (reduced) assert(await page.ev(`scrollY`) === 0, 'reduced motion: the scroll was not instant');
            await landedHome(page, ['country=Ireland', 'points=36']);
            assert(await page.ev(`document.querySelector('.hd .mark').matches(':focus-visible') && getComputedStyle(document.querySelector('.hd .mark')).outlineStyle!=='none'`), 'no visible focus on the logo');
          } finally { if (reduced) await page.send('Emulation.setEmulatedMedia', { features: [] }); }
        }
      });
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }
}

// --- Alignment fixes: list, detail, Compare ---------------------------------------
// The 2026-11-05 alignment audit (list-detail and compare findings), measured in
// Chrome: the long Slovak degree, the detail's Save/Compare labels, row labels and
// toggles, the Compare header (Save on one line, "x" room, names that only break
// when a word is wider than its column), heights, toasts and the printed link.
async function runAlignListCompare(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-align-fix-a/smoke';
  await mkdir(shots, { recursive: true });
  console.log('Alignment (list, detail, Compare) Chrome version: ' + (await cdp.send('Browser.getVersion')).product);
  const COMPARE = 'ib-university-finder:compare:v1';
  const SAVES = 'ib-university-finder:shortlist:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height, { compare = [], saves = [], touch = false } = {}) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'alignment page');
    if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});localStorage.setItem(${JSON.stringify(SAVES)},${JSON.stringify(JSON.stringify(saves))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'alignment reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(q=>setTimeout(q,1500))]))))`);
  const shot = async (page, name) => {
    await settle(page);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  // Lines of an element's own text (visually hidden parts left out), and the
  // places where a word continues on the next line: "porovnani|a". A break after
  // a hyphen or slash is a real break opportunity, not a split word.
  const TEXT = `window.__lines=(el)=>{const tops=new Set();const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(n.parentElement.closest('.visually-hidden'))continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects())if(b.width>0.5)tops.add(Math.round(b.top))}return tops.size};
    window.__splits=(el)=>{const out=[];const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(n.parentElement.closest('.visually-hidden'))continue;const s=n.textContent;let prev=null;for(let i=0;i<s.length;i++){if(/[\\s\\u2060]/.test(s[i])){prev=null;continue}const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getClientRects()[0];if(!b)continue;if(prev!==null&&b.top>prev+2&&!/[-\\/–]/.test(s[i-1])){let a=i,z=i;while(a>0&&!/\\s/.test(s[a-1]))a--;while(z<s.length&&!/\\s/.test(s[z]))z++;out.push({word:s.slice(a,z),at:i-a,node:n,el})}prev=b.top}}return out};
    window.__wordWidth=(el,word)=>{const c=document.createElement('span');const s=getComputedStyle(el);c.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font:'+s.font+';letter-spacing:'+s.letterSpacing;c.textContent=word;document.body.append(c);const w=c.getBoundingClientRect().width;c.remove();return w};true`;
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const longCycle = data.filter((r) => r.degreeType === 'Long-cycle master');
  const byLength = [...data].sort((a, b) => b.programme.length - a.programme.length || a.id.localeCompare(b.id));
  // Four very different name lengths: the longest, two in between and a short one.
  const mix = [byLength[0], byLength[Math.floor(byLength.length * 0.3)], byLength[Math.floor(byLength.length * 0.6)], byLength.find((r) => r.programme.length >= 7 && r.programme.length <= 9 && !r.programme.includes(' '))].map((r) => r.id);
  const noOverflow = 'document.documentElement.scrollWidth<=innerWidth';

  // 1. The long-cycle degree (findings L1, L5): it wraps inside the pane and the
  // row instead of stretching or running off them.
  assert(longCycle.length > 0, 'no long-cycle programmes in the data');
  for (const [width, height] of [[1200, 900], [1280, 900], [1440, 900], [1920, 1080]]) {
    const page = await open(`?ui=sk&q=${encodeURIComponent(longCycle[0].programme)}`, width, height);
    try {
      await check(`${width}/sk`, 'AL degree pane', 'a long Slovak degree wraps inside the pane; the pane never scrolls sideways', async () => {
        await page.click(`document.querySelector('#results li[data-id="${longCycle[0].id}"] button.open')`, 'the long-cycle row');
        await page.waitFor(`({ok:!!document.querySelector('#pane .d-title .deg'),why:'pane not open'})`, 5000, 'pane');
        const m = await page.ev(`(()=>{const p=document.querySelector('#pane'),d=p.querySelector('.d-title .deg'),r=d.getBoundingClientRect(),pr=p.getBoundingClientRect();return {sw:p.scrollWidth-p.clientWidth,right:r.right-pr.right,text:d.textContent}})()`);
        assert(m.sw <= 0 && m.right <= 0 && m.text.length > 30, JSON.stringify(m));
        if (width === 1280) await shot(page, 'degree-pane-1280-sk');
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();
  for (const ui of ['sk', 'en']) {
    const page = await open(`?ui=${ui}&q=Masaryk`, 320, 640);
    try {
      await check(`320/${ui}`, 'AL degree row', 'every long-cycle degree stays left of the row toggles and inside the card', async () => {
        const m = await page.ev(`[...document.querySelectorAll('#results li.item')].filter(li=>${JSON.stringify(longCycle.map((r) => r.id))}.includes(li.dataset.id)).map(li=>{li.style.contentVisibility='visible';const d=li.querySelector('.deg').getBoundingClientRect(),c=li.querySelector('button.cmpi').getBoundingClientRect(),row=li.querySelector('.row').getBoundingClientRect();return {id:li.dataset.id,ok:d.right<=c.left+0.5&&d.right<=row.right}})`);
        assert(m.length >= 2 && m.every((x) => x.ok), JSON.stringify(m));
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // Verification of PR 1: at 320 px Slovak, the fee label "Školné pre EÚ /
  // rok" hung left out of its narrow tile into "Termín" on entrance-exam rows
  // and on rows with a green points box. No tile or label in a row may touch
  // another tile's or label's box on the same line (4 px gap at least).
  for (const query of ['q=anthropology%20masaryk', 'q=computer%20science%20ucd&points=30']) {
    const page = await open(`?ui=sk&${query}`, 320, 640);
    try {
      await check('320/sk', 'V2 labels', `${query}: column labels and tiles never touch`, async () => {
        const m = await page.ev(`[...document.querySelectorAll('#results .row')].slice(0,12).map(r=>{const b=[...r.querySelectorAll('.cell')].flatMap(c=>[c,c.querySelector('.lab')].filter(Boolean).map(e=>({k:c.className,r:e.getBoundingClientRect()})));let bad=0;for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const x=b[i],y=b[j];if(x.k===y.k)continue;const v=Math.min(x.r.bottom,y.r.bottom)-Math.max(x.r.top,y.r.top),g=Math.max(x.r.left,y.r.left)-Math.min(x.r.right,y.r.right);if(v>0&&g<4)bad++}return bad})`);
        assert(m.length >= 1 && m.every((n) => n === 0), JSON.stringify(m));
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // Faculty labels share the flex row with the country badge. Their min-content
  // width must be a whole word, not one character inherited from anywhere.
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}&q=Charles`, 320, 844);
    try {
      for (const width of [320, 390, 600, 700, 1024, 1280, 1440]) {
        await check(`${width}/${ui}`, 'AL faculty', 'Charles faculty words stay whole without overflowing the row', async () => {
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
          await settle(page);
          await page.ev(TEXT);
          const m = await page.ev(`(()=>{const els=[...document.querySelectorAll('#results .identity')];return {count:els.length,issues:els.flatMap(e=>{e.closest('li.item').style.contentVisibility='visible';const box=e.closest('.r-main').getBoundingClientRect(),r=e.getBoundingClientRect();return __splits(e).length||r.right>box.right+1?[e.textContent]:[]}),page:${noOverflow}}})()`);
          assert(m.count > 0 && !m.issues.length && m.page, JSON.stringify(m));
        });
      }
    } finally { await page.close(); }
  }

  // 2. The detail's Save and Compare (L2, L3, L9): each label on one line,
  // never split inside a word, side by side when both fit, otherwise stacked;
  // in both states; the two icons the same size.
  const target = data.find((r) => r.officialUrl && r.programme.length > 30 && r.country === 'Netherlands') ?? data.find((r) => r.officialUrl);
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}&q=${encodeURIComponent(target.programme)}`, 390, 900);
    try {
      for (const width of [320, 360, 390, 430, 600, 1024, 1199, 1200, 1280, 1440, 1920]) {
        await check(`${width}/${ui}`, 'AL detail pair', 'Save and Compare: one line each, no split words, side by side or stacked, both states, equal icons', async () => {
          watchdog.refresh();
          await page.key('Escape', 'Escape', 27);
          await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
          await page.waitFor(`({ok:innerWidth===${width}&&!document.querySelector('#results .expand:not([inert])')&&!document.querySelector('#pane .pane-body .d-actions'),why:'viewport or an open detail'})`, 5000, 'closed at this width');
          const detail = width >= 1200 ? '#pane .pane-body' : `#results li[data-id="${target.id}"] .expand:not([inert])`;
          await page.click(`document.querySelector('#results li[data-id="${target.id}"] button.open')`, 'the programme');
          await page.waitFor(`({ok:!!document.querySelector('${detail} .d-actions button.cmpb'),why:'detail not open'})`, 5000, 'detail');
          await settle(page);
          for (const on of [false, true]) {
            const pressed = await page.ev(`document.querySelector('${detail} button.save').getAttribute('aria-pressed')==='true'`);
            if (pressed !== on) {
              await page.click(`document.querySelector('${detail} button.save')`, 'Save');
              await page.click(`document.querySelector('${detail} button.cmpb')`, 'Compare');
              await page.waitFor(`({ok:document.querySelector('${detail} button.save').getAttribute('aria-pressed')==='${on}'&&document.querySelector('${detail} button.cmpb').getAttribute('aria-pressed')==='${on}',why:'state'})`, 5000, 'toggled');
            }
            await page.ev(TEXT);
            const m = await page.ev(`(()=>{const g=document.querySelector('${detail} .d-actions'),[l,a,b]=[...g.children],o=g.getBoundingClientRect(),ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(),ia=a.querySelector('.ic').getBoundingClientRect(),ib=b.querySelector('.ic').getBoundingClientRect();
              return {lines:[__lines(a.querySelector('.save-t')),__lines(b.querySelector('.cmpb-w'))],splits:[l,a,b].flatMap(x=>__splits(x).map(s=>s.word)),
                side:Math.abs(ra.top-rb.top)<1&&Math.abs(ra.width-rb.width)<=1,stacked:Math.abs(ra.left-rb.left)<1&&Math.abs(ra.width-o.width)<=1&&Math.abs(rb.width-o.width)<=1&&rb.top>=ra.bottom,
                clip:[a,b].some(x=>x.scrollWidth>x.clientWidth+1),icons:[ia.width,ia.height,ib.width,ib.height],page:${noOverflow}}})()`);
            assert(m.lines.every((n) => n === 1) && !m.splits.length && (m.side || m.stacked) && !m.clip && m.icons.every((n) => n === m.icons[0]) && m.page, `${on ? 'on' : 'off'} ${JSON.stringify(m)}`);
          }
          if ([320, 390, 1280, 1440].includes(width)) await shot(page, `detail-pair-${width}-${ui}`);
        });
      }
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 3. Rows (L6, L10, L12, L13, L8): labels start where their values start,
  // the toggles centre on the title's first line, the last open row keeps the
  // card's corners, a sort heading's hover is its label, and a tap leaves no
  // hover box on touch.
  for (const [width, height] of [[320, 700], [390, 844], [700, 900], [1280, 900]]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}&country=Ireland`, width, height);
    try {
      await check(`${width}/${ui}`, 'AL row labels and toggles', 'labels line up with their values (left, fee right); Compare and Save centre on the title\'s first line', async () => {
        const m = await page.ev(`(()=>{const tr=(e)=>{const r=document.createRange();r.selectNodeContents(e);return r.getBoundingClientRect()};const out={labels:[],toggles:[]};
          for(const li of [...document.querySelectorAll('#results li.item')].slice(0,40)){li.style.contentVisibility='visible';
            for(const c of li.querySelectorAll('.row .cell')){const l=c.querySelector(':scope>.lab'),v=c.querySelector(':scope>.fig')||c.querySelector(':scope>.verd');if(!l||!v||getComputedStyle(l).display==='none'||l.getClientRects().length===0)continue;const a=tr(l),b=tr(v);if(!a.width)continue;out.labels.push(c.classList.contains('c-fee')?Math.round((a.right-b.right)*10)/10:Math.round((a.left-b.left)*10)/10)}
            const t=li.querySelector('.r-t .open'),r=document.createRange();r.selectNodeContents(t);const first=r.getClientRects()[0];const mid=first.top+first.height/2;
            for(const b of li.querySelectorAll('.r-main>:is(.cmpi,.star)')){const x=b.getBoundingClientRect();out.toggles.push(Math.round((x.top+x.height/2-mid)*10)/10)}}
          return out})()`);
        assert(m.toggles.length >= 20 && m.toggles.every((d) => Math.abs(d) <= 1.5), 'toggles ' + JSON.stringify(m.toggles));
        if (width < 800) assert(m.labels.length >= 30 && m.labels.every((d) => Math.abs(d) <= 1), 'labels ' + JSON.stringify(m.labels));
        if (width === 390 || width === 700) await shot(page, `rows-${width}-${ui}`);
      });
      if (width === 1280) await check(`${width}/${ui}`, 'AL sort heading', 'a sort heading\'s hover area is its label and mark, not the whole column', async () => {
        const m = await page.ev(`[...document.querySelectorAll('.cols>button')].map(b=>{const kids=[...b.children].filter(k=>k.getClientRects().length&&!k.classList.contains('visually-hidden'));const s=getComputedStyle(b);const inner=kids.reduce((w,k)=>w+k.getBoundingClientRect().width,0)+parseFloat(s.columnGap||0)*(kids.length-1)+parseFloat(s.paddingLeft)+parseFloat(s.paddingRight);return Math.round(b.getBoundingClientRect().width-inner)})`);
        assert(m.length === 3 && m.every((d) => d <= 2), JSON.stringify(m));
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
    watchdog.refresh();
  }
  {
    const page = await open('?ui=en&q=Nanobiology', 390, 844);
    try {
      await check(390, 'AL last row corners', 'the last row, open, keeps the card\'s rounded bottom corners', async () => {
        await page.waitFor(`({ok:document.querySelectorAll('#results li.item').length>=1&&document.querySelectorAll('#results li.item').length<=8,why:document.querySelectorAll('#results li.item').length+' rows'})`, 5000, 'a short list');
        await page.click(`[...document.querySelectorAll('#results li.item')].at(-1).querySelector('button.open')`, 'the last row');
        await page.waitFor(`({ok:!!document.querySelector('#results>li.item:last-child>.expand>.expand-inner'),why:'not open'})`, 5000, 'open');
        await settle(page);
        const m = await page.ev(`(()=>{const s=getComputedStyle(document.querySelector('#results>li.item:last-child>.expand>.expand-inner'));return {r:[s.borderBottomLeftRadius,s.borderBottomRightRadius],o:s.overflow}})()`);
        assert(m.r.every((r) => parseFloat(r) >= 10) && m.o === 'hidden', JSON.stringify(m));
        await page.ev(`document.querySelector('#results>li.item:last-child').scrollIntoView({block:'end'})`);
        await shot(page, 'last-row-open-390');
      });
    } finally { await page.close(); }
  }
  {
    const page = await open('?ui=en', 390, 844, { touch: true });
    try {
      await check('390/touch', 'AL touch hover', 'after a tap, Compare and Save keep no white hover box; pressed stays blue', async () => {
        assert(await page.ev(`matchMedia('(pointer:coarse)').matches`), 'touch emulation did not give pointer:coarse');
        for (const sel of ['button.cmpi', 'button.star']) {
          await page.click(`document.querySelector('#results li.item ${sel}')`, sel);
          await page.waitFor(`({ok:document.querySelector('#results li.item ${sel}').getAttribute('aria-pressed')==='true',why:'not pressed'})`, 5000, 'pressed');
          await settle(page);
          const m = await page.ev(`(()=>{const b=document.querySelector('#results li.item ${sel}'),s=getComputedStyle(b);return {hover:b.matches(':hover'),bg:s.backgroundColor,color:s.color,accent:getComputedStyle(document.querySelector('.cmpi[aria-pressed=true],.star[aria-pressed=true]')).color}})()`);
          assert(m.bg === 'rgba(0, 0, 0, 0)' && m.color === m.accent, JSON.stringify(m));
        }
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 4. Compare (C1–C5, C9, C10–C14): Saves on one line at the foot of the
  // header, one width for Save and Saved, room for the last "x"'s focus ring, a
  // name split only when a word is wider than its column, the fact names 6.5rem
  // below 1024 px, one button height, a shared first baseline, and the link's
  // icon beside its last word.
  for (const [width, height] of [[320, 844], [360, 800], [390, 844], [600, 900], [700, 900], [844, 390], [1024, 900], [1280, 900], [1440, 900]]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, height, { compare: mix, touch: width < 600 || height <= 500 });
    try {
      await check(`${width}x${height}/${ui}`, 'AL compare header', 'Saves share one line and one width, in both states; names split only words wider than the column; "x" has 4 px of room; 44 px buttons; link icon on its last word', async () => {
        watchdog.refresh();
        await page.ev(`(getComputedStyle(document.querySelector('#header-compare')).display!=='none'?document.querySelector('#header-compare'):document.querySelector('#cmp-tray-open')).click()`);
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden&&document.querySelectorAll('th.cmp-p').length===4,why:'compare not open'})`, 5000, 'compare');
        await settle(page);
        await page.ev(TEXT);
        const measure = `(()=>{const box=document.querySelector('.cmp-scroll'),bx=box.getBoundingClientRect();const ths=[...document.querySelectorAll('th.cmp-p')];
          const cols=ths.map(th=>{const t=th.getBoundingClientRect(),s=th.querySelector('.cmp-save'),r=s.getBoundingClientRect(),x=th.querySelector('.cmp-x .ic').getBoundingClientRect(),cs=getComputedStyle(th);
            const content=th.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
            const needless=[...__splits(th.querySelector('.cmp-n')),...__splits(th.querySelector('.cmp-u'))].filter(p=>__wordWidth(p.el,p.word)<=content-0.5).map(p=>p.word);
            const textRects=[th.querySelector('.cmp-n'),th.querySelector('.cmp-u')].flatMap(e=>{const g=document.createRange();g.selectNodeContents(e);return [...g.getClientRects()]});
            const xOverText=textRects.some(q=>q.left<x.right&&x.left<q.right&&q.top<x.bottom&&x.top<q.bottom);
            return {nameGap:Math.round(r.top-th.querySelector('.cmp-u').getBoundingClientRect().bottom),rad:[getComputedStyle(s).borderTopLeftRadius,getComputedStyle(th.querySelector('.cmp-x')).borderTopLeftRadius],top:Math.round(r.top*2)/2,below:Math.round(t.bottom-r.bottom),w:Math.round(r.width*10)/10,inside:r.left>=t.left-0.5&&r.right<=t.right+0.5,clip:s.scrollWidth>s.clientWidth+1,h:r.height,needless,xOverText}});
          const last=document.querySelectorAll('.cmp-x');const lx=last[last.length-1].getBoundingClientRect();
          const links=[...document.querySelectorAll('.cmp-t a.lnk')].map(a=>{const ic=a.querySelector('svg').getBoundingClientRect();const r=document.createRange();r.selectNodeContents(a.querySelector('.lnk-end').firstChild);const rs=[...r.getClientRects()];const lastLine=rs[rs.length-1];return Math.abs((ic.top+ic.height/2)-(lastLine.top+lastLine.height/2))<=6&&ic.left>=lastLine.right-0.5&&ic.left-lastLine.right<=8});
          const th=document.querySelector('.cmp-t tbody th'),td=th.nextElementSibling.querySelector('p');const a=document.createRange();a.selectNodeContents(th);const b=document.createRange();b.selectNodeContents(td);
          const linkRow=document.querySelector('.cmp-t tr[data-fact=link]');const lt=document.createRange();lt.selectNodeContents(linkRow.querySelector('th'));const ll=document.createRange();ll.selectNodeContents(linkRow.querySelector('a.lnk').firstChild);
          return {cols,label:th.getBoundingClientRect().width,base:Math.abs(a.getClientRects()[0].bottom-b.getClientRects()[0].bottom),linkBase:Math.abs(lt.getClientRects()[0].bottom-ll.getClientRects()[0].bottom),links,
            room:{right:bx.right-lx.right,top:lx.top-bx.top},heights:[...document.querySelectorAll('#cmp-close,.cmp-save')].map(e=>e.getBoundingClientRect().height),page:${noOverflow}}})()`;
        await page.ev(`(()=>{const b=document.querySelector('.cmp-scroll');b.scrollLeft=b.scrollWidth})()`);
        await settle(page);
        // Dictionary hyphenation ("Überset-zen") is a real break; with it off,
        // a word that still splits was split by the layout, which is only
        // allowed when the word is wider than its column.
        const m = await page.ev(`(()=>{const s=document.createElement('style');s.id='al-nohyph';s.textContent='.cmp-t th.cmp-p :is(.cmp-n,.cmp-u){hyphens:manual!important}';document.head.append(s);try{return ${measure}}finally{s.remove()}})()`);
        const tops = new Set(m.cols.map((c) => c.top)), belows = new Set(m.cols.map((c) => c.below)), widths = new Set(m.cols.map((c) => c.w));
        // Every Save stays on one line at the foot of the header (Leon, 2026-11-07:
        // per-name placement looked worse when names wrap), and the tallest name
        // in the row sits 12 px above it, so no column has less room than that.
        assert(tops.size === 1 && belows.size === 1 && Math.min(...m.cols.map((c) => c.nameGap)) === 12, 'Save row ' + JSON.stringify(m.cols.map((c) => [c.top, c.below, c.nameGap])));
        assert(m.cols.every((c) => c.inside && !c.clip && c.h >= 44), 'Save inside ' + JSON.stringify(m.cols));
        assert(m.cols.every((c) => c.rad.every((v) => v === '8px')), 'Save and x corners ' + JSON.stringify(m.cols.map((c) => c.rad)));
        assert(m.cols.every((c) => !c.needless.length && !c.xOverText), 'names ' + JSON.stringify(m.cols.map((c) => [c.needless, c.xOverText])));
        assert(m.room.right >= 4 && m.room.top >= 4, 'x room ' + JSON.stringify(m.room));
        assert(m.heights.every((h) => h === 44), 'heights ' + JSON.stringify(m.heights));
        // Below 600 px the fact names are a line above the values (2026-11-06,
        // runPhoneMyListCompare), so a shared baseline applies from 600 px only.
        assert((width < 600 || (m.base <= 1.5 && m.linkBase <= 1.5)) && m.links.every(Boolean), 'baselines/link ' + JSON.stringify([m.base, m.linkBase, m.links]));
        if (width < 1024) assert(m.label <= 6.5 * 16 + 20 + 0.5, 'label column ' + m.label);
        assert(m.page, 'the page scrolls sideways');
        // Saving changes the word, never the width.
        await page.ev(`document.querySelector('.cmp-scroll').scrollLeft=0`);
        const before = await page.ev(`Math.round(document.querySelector('th.cmp-p .cmp-save').getBoundingClientRect().width*10)/10`);
        await page.click(`document.querySelector('th.cmp-p .cmp-save')`, 'the first Save');
        await page.waitFor(`({ok:document.querySelector('th.cmp-p .cmp-save').getAttribute('aria-pressed')==='true',why:'not saved'})`, 5000, 'saved');
        await settle(page);
        const after = await page.ev(`(()=>{const s=document.querySelector('th.cmp-p .cmp-save');return {w:Math.round(s.getBoundingClientRect().width*10)/10,clip:s.scrollWidth>s.clientWidth+1}})()`);
        assert(widths.size === 1 && after.w === before && !after.clip, `Save ${[...widths]} → Saved ${JSON.stringify(after)}`);
        if ([320, 390, 700, 1280].includes(width)) { await page.ev(`document.querySelector('.cmp-scroll').scrollLeft=0`); await shot(page, `compare-${width}-${ui}`); }
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();
  for (const [width, ui] of [[1280, 'en'], [1440, 'sk'], [700, 'en']]) {
    const page = await open(`?ui=${ui}`, width, 900, { compare: mix.slice(0, 1) });
    try {
      await check(`${width}/${ui}`, 'AL compare one', 'one programme: the column is as wide as its facts, so the "x" stays within 60 px of the name; 44 px buttons', async () => {
        await page.click(`document.querySelector('#header-compare')`, 'Compare');
        await page.waitFor(`({ok:document.querySelectorAll('th.cmp-p').length===1,why:'not open'})`, 5000, 'compare');
        await settle(page);
        const m = await page.ev(`(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('th.cmp-p .cmp-n'));const right=Math.max(...[...r.getClientRects()].map(q=>q.right));const x=document.querySelector('th.cmp-p .cmp-x .ic').getBoundingClientRect();return {gap:Math.round(x.left-right),close:document.querySelector('#cmp-close').getBoundingClientRect().height}})()`);
        assert(m.gap <= 60 && m.close === 44, JSON.stringify(m));
      });
      await check(`${width}/${ui}`, 'AL compare empty', 'Browse programmes is 44 px, like Close', async () => {
        await page.click(`document.querySelector('#cmp-body .cmp-x')`, 'x');
        await page.waitFor(`({ok:!document.querySelector('#cmp-empty').hidden,why:'not empty'})`, 5000, 'empty');
        assert(await page.ev(`document.querySelector('#cmp-browse').getBoundingClientRect().height===44&&document.querySelector('#cmp-close').getBoundingClientRect().height===44`), 'heights');
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 5. Toasts (C6, C7), the count while comparing (C15) and where Compare
  // lands when it opens (C14).
  for (const [width, height] of [[320, 640], [390, 844], [844, 390]]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, height, { compare: mix, saves: mix.slice(0, 2), touch: true });
    try {
      await check(`${width}x${height}/${ui}`, 'AL toasts', 'toast actions stay on one line and are at least 44 x 44 ("Open compare", "Vrátiť späť")', async () => {
        await page.click(`[...document.querySelectorAll('#results li.item')].find(li=>!${JSON.stringify(mix)}.includes(li.dataset.id)).querySelector('button.cmpi')`, 'a fifth programme');
        await page.waitFor(`({ok:!!document.querySelector('#toasts .toast button'),why:'no toast'})`, 5000, 'the limit toast');
        await settle(page);
        await page.ev(TEXT);
        const full = await page.ev(`(()=>{const b=document.querySelector('#toasts .toast button'),r=b.getBoundingClientRect();return {w:r.width,h:r.height,lines:__lines(b)}})()`);
        assert(full.w >= 44 && full.h >= 44 && full.lines === 1, 'full ' + JSON.stringify(full));
        await page.click(`document.querySelector('#toasts .toast button')`, 'Open compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare closed'})`, 5000, 'compare');
        await page.click(`document.querySelector('#cmp-body .cmp-x')`, 'x');
        await page.waitFor(`({ok:document.querySelector('#toasts .toast button')?.textContent===${JSON.stringify(ui === 'sk' ? 'Vrátiť späť' : 'Undo')},why:'no undo'})`, 5000, 'undo toast');
        await settle(page);
        const undo = await page.ev(`(()=>{const r=document.querySelector('#toasts .toast button').getBoundingClientRect();return {w:r.width,h:r.height}})()`);
        assert(undo.w >= 44 && undo.h >= 44, 'undo ' + JSON.stringify(undo));
        if (width === 390) await shot(page, `toast-undo-390-${ui}`);
      });
      if (height > 500) await check(`${width}/${ui}`, 'AL count while comparing', 'Compare opened from My list hides the list\'s count line; closing shows it again', async () => {
        await page.ev(`!document.querySelector('#compare').hidden&&document.querySelector('#cmp-close').click()`);
        await page.click(`document.querySelector('#header-list')`, 'My list');
        await page.waitFor(`({ok:!!document.querySelector('.mylist.is-list'),why:'not in My list'})`, 5000, 'My list');
        await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare closed'})`, 5000, 'compare');
        const shown = `(()=>{const c=document.querySelector('#result-count');return c.checkVisibility({visibilityProperty:true})})()`;
        assert(await page.ev(`!${shown} && /2/.test(document.querySelector('#result-count').textContent)`), 'the count still shows');
        await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
        await page.waitFor(`({ok:${shown},why:'count hidden after closing'})`, 5000, 'count back');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();
  for (const [width, height] of [[390, 844], [1280, 900]]) {
    const page = await open('?ui=en', width, height, { compare: mix, touch: width < 600 });
    try {
      await check(`${width}`, 'AL compare lands', 'opened from far down the list, Compare\'s rounded top edge is never under what sticks above it (8 px below it)', async () => {
        await page.ev('window.scrollTo(0, 4000)');
        await page.waitFor(`({ok:scrollY>3000,why:'scrollY '+scrollY})`, 5000, 'scrolled');
        await page.ev(`(getComputedStyle(document.querySelector('#header-compare')).display!=='none'?document.querySelector('#header-compare'):document.querySelector('#cmp-tray-open')).click()`);
        await page.waitFor(`(()=>{const a=document.querySelector('#compare').getBoundingClientRect().top;const s=window.__lastTop;window.__lastTop=a;return {ok:s===a,why:'moving'}})()`, 5000, 'scroll settled');
        const m = await page.ev(`(()=>{const c=document.querySelector('#compare').getBoundingClientRect();const st=document.querySelector('.status');const stuck=${width < 600 ? `st.getBoundingClientRect().bottom` : `document.querySelector('.hd').getBoundingClientRect().bottom`};const hit=document.elementFromPoint(c.left+14,c.top+2);return {gap:c.top-stuck,isStuck:st.classList.contains('is-stuck'),corner:!!hit&&document.querySelector('#compare').contains(hit)}})()`);
        // Phones: the count row sits above it in the flow (its 12 px margin, Leon 2026-11-06) or is stuck over the page (gap 8).
        assert(m.corner && (width < 600 ? (m.isStuck ? m.gap >= 7 && m.gap <= 9 : m.gap >= -0.5 && m.gap <= 13) : m.gap >= 7 && m.gap <= 9), JSON.stringify(m));
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 6. Print of an open Compare (setup-footer finding 3): the link's words are
  // never split; its address follows them.
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, 794, 1100, { compare: mix });
    try {
      await check(`print/${ui}`, 'AL print compare link', 'printed Compare: "Official admissions page" never splits inside a word and no space is kept for Save', async () => {
        await page.click(`document.querySelector('#header-compare')`, 'Compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'closed'})`, 5000, 'compare');
        await page.send('Emulation.setEmulatedMedia', { media: 'print' });
        try {
          await settle(page);
          await page.ev(TEXT);
          const m = await page.ev(`(()=>({splits:[...document.querySelectorAll('.cmp-t a.lnk')].flatMap(a=>{const s=__splits(a);return s.filter(p=>p.node===a.firstChild).map(p=>p.word)}),pad:getComputedStyle(document.querySelector('th.cmp-p')).paddingBottom,icon:[...document.querySelectorAll('.cmp-t a.lnk svg')].some(s=>s.getClientRects().length)}))()`);
          assert(!m.splits.length && m.pad === '10px' && !m.icon, JSON.stringify(m));
          const { cssContentSize } = await page.send('Page.getLayoutMetrics');
          const { data: png } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 794, height: Math.min(4000, cssContentSize.height), scale: 1 } });
          await writeFile(`${shots}/print-compare-${ui}.png`, Buffer.from(png, 'base64'));
        } finally { await page.send('Emulation.setEmulatedMedia', { media: '' }); }
      });
    } finally { await page.close(); }
  }
}

// Alignment audit fixes (2026-11-05, Leon: "all is aligned"): header, the
// phone Filters sheet, My list, setup and the FAQ. Each check measures the
// layout in Chrome at the widths and languages the audit named.
// Phone My list and Compare (Leon, iPhone 16, 393 x 852, 2026-11-06). My list's
// box took half the screen: it now keeps Back, More, the title and Group by,
// and More opens the other tools. Compare puts each fact's name above its
// values, Save and "x" on one line, and a quiet Close. Measured at 320, 375 and
// 393 px in EN and SK; screenshots go to /tmp/ib-phone-mlc/smoke.
async function runPhoneMyListCompare(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-phone-mlc/smoke';
  await mkdir(shots, { recursive: true });
  const COMPARE = 'ib-university-finder:compare:v1';
  const SAVES = 'ib-university-finder:shortlist:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height, { compare = [], saves = [] } = {}) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'phone page');
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});localStorage.setItem(${JSON.stringify(SAVES)},${JSON.stringify(JSON.stringify(saves))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'phone reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(q=>setTimeout(q,1500))]))))`);
  const shot = async (page, name) => {
    await page.ev(`scrollTo({top:0,behavior:'instant'})`);
    await settle(page);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const ids = data.slice(0, 6).map((r) => r.id);
  const visible = `(s)=>{const n=document.querySelector(s);return !!n&&getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().height>0}`;

  for (const [width, height] of [[320, 700], [375, 812], [393, 852]]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, height, { saves: ids });
    try {
      await check(`${width}x${height}/${ui}`, 'PM My list', 'the box is at most a quarter of an 852 px screen; Back and More share its first line; More shows and hides every tool', async () => {
        await page.click(`document.querySelector('#header-list')`, 'My list');
        await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'list view not open'})`, 5000, 'the list view');
        await settle(page);
        const tools = ['#ml-share>summary', '#export-csv', '#print-shortlist', '#clear-shortlist', '.ml-export-note', '#ml-origin'];
        const m = await page.ev(`(()=>{const v=${visible},r=(s)=>{const b=document.querySelector(s).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}};
          return {bar:Math.round(r('#shortlist-bar').height),back:r('#f-shortlist-only'),more:r('#ml-more'),title:r('#ml-h'),group:v('#ml-group'),
            shown:${JSON.stringify(tools)}.filter(v),expanded:document.querySelector('#ml-more').getAttribute('aria-expanded'),sw:document.documentElement.scrollWidth-innerWidth}})()`);
        await shot(page, `mylist-${width}-${ui}`);
        assert(m.bar <= 852 / 4, `My list box ${m.bar} px`);
        assert(Math.abs(m.back.top - m.more.top) <= 1 && m.more.height >= 44 && m.more.width >= 44 && m.back.right <= m.more.left && m.title.top >= m.more.bottom, `first line ${JSON.stringify(m)}`);
        assert(m.group && m.shown.length === 0 && m.expanded === 'false', `closed: ${JSON.stringify(m)}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
        await page.click(`document.querySelector('#ml-more')`, 'More');
        await settle(page);
        const o = await page.ev(`(()=>{const v=${visible};return {shown:${JSON.stringify(tools)}.filter(v),heights:['#ml-share>summary','#export-csv','#print-shortlist','#clear-shortlist'].map(s=>document.querySelector(s).getBoundingClientRect().height),expanded:document.querySelector('#ml-more').getAttribute('aria-expanded'),sw:document.documentElement.scrollWidth-innerWidth}})()`);
        await shot(page, `mylist-more-${width}-${ui}`);
        assert(o.shown.length === tools.length && o.heights.every((h) => h >= 44) && o.expanded === 'true' && o.sw === 0, `open: ${JSON.stringify(o)}`);
        await page.click(`document.querySelector('#ml-share>summary')`, 'Share');
        await page.click(`document.querySelector('#ml-more')`, 'More (close)');
        const c = await page.ev(`(()=>{const v=${visible};return {shown:${JSON.stringify(tools)}.filter(v),share:document.querySelector('#ml-share').open}})()`);
        assert(c.shown.length === 0 && !c.share, `closed again: ${JSON.stringify(c)}`);
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }

    for (const n of [1, 2, 4]) {
      const page = await open(`?ui=${ui}`, width, height, { compare: ids.slice(0, n), saves: ids.slice(0, 1) });
      try {
        await check(`${width}x${height}/${ui}/${n}`, 'PM Compare', 'fact names sit above their values; Save and "x" share a line under the name; Close is quiet; 44 px targets', async () => {
          await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
          await page.waitFor(`({ok:!document.querySelector('#compare').hidden&&document.querySelectorAll('th.cmp-p').length===${n},why:'compare not open'})`, 5000, 'compare');
          await settle(page);
          const m = await page.ev(`(()=>{const r=(n)=>n.getBoundingClientRect();
            const cols=[...document.querySelectorAll('th.cmp-p')].map(th=>{const s=r(th.querySelector('.cmp-save')),x=r(th.querySelector('.cmp-x')),t=r(th),u=r(th.querySelector('.cmp-u'));
              return {line:Math.abs((s.top+s.height/2)-(x.top+x.height/2))<=1,gap:Math.round(x.left-s.right),below:s.top>=u.bottom,inside:x.right<=t.right+0.5&&s.left>=t.left-0.5,h:[s.height,x.width,x.height]}});
            const facts=[...document.querySelectorAll('.cmp-t tbody tr[data-fact]')].map(tr=>{const cap=tr.previousElementSibling,span=cap.querySelector('span'),th=tr.querySelector('th'),td=tr.querySelector('td');
              return {cap:cap.classList.contains('cmp-lr')&&getComputedStyle(cap).display==='table-row'&&span.textContent===th.textContent,above:r(span).bottom<=r(td).top+0.5,th:r(th).width,left:Math.abs(r(span).left+parseFloat(getComputedStyle(span).paddingLeft)-(r(td).left+parseFloat(getComputedStyle(td).paddingLeft)))<=1}});
            const close=document.querySelector('#cmp-close'),cs=getComputedStyle(close);
            return {cols,facts,close:[r(close).width,r(close).height,cs.borderTopLeftRadius,cs.borderTopColor===getComputedStyle(document.querySelector('.cmp')).borderTopColor],
              foot:Math.round(r(document.querySelector('.foot h2')).top-r(document.querySelector('#compare')).bottom),one:${n === 1}?getComputedStyle(document.querySelector('#cmp-one')).borderBottomWidth:null,sw:document.documentElement.scrollWidth-innerWidth}})()`);
          await shot(page, `compare-${n}-${width}-${ui}`);
          assert(m.cols.every((c) => c.line && c.gap >= 0 && c.gap <= 12 && c.below && c.inside && c.h.every((h) => h >= 44)), 'columns ' + JSON.stringify(m.cols));
          assert(m.facts.length > 0 && m.facts.every((f) => f.cap && f.above && f.th <= 1 && f.left), 'facts ' + JSON.stringify(m.facts));
          assert(m.close[0] >= 44 && m.close[1] >= 44 && m.close[2] === '8px' && m.close[3], 'close ' + JSON.stringify(m.close));
          assert(m.foot >= 40 && m.foot <= 48, `footer heading ${m.foot} px under Compare (phone, as desktop)`);
          assert(n !== 1 || m.one === '1px', 'one-programme hint ' + m.one);
          assert(m.sw === 0, `page overflows by ${m.sw}`);
          await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
          await page.waitFor(`({ok:document.querySelector('#compare').hidden&&document.activeElement===document.querySelector('#cmp-tray-open'),why:document.activeElement?.id})`, 5000, 'closed with focus back on the tray');
        });
        assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
      } finally { await page.close(); }
    }
    watchdog.refresh();
  }
  // From 600 px nothing changes: no More, and the fact names keep their column.
  const page = await open('?ui=sk', 1280, 900, { compare: ids.slice(0, 2), saves: ids });
  try {
    await check('1280/sk', 'PM desktop', 'no More, every My list tool shown, no fact-name lines in Compare', async () => {
      await page.click(`document.querySelector('#header-list')`, 'My list');
      await settle(page);
      const m = await page.ev(`(()=>{const v=${visible};return {more:v('#ml-more'),tools:['#ml-share>summary','#export-csv','#print-shortlist','#clear-shortlist'].every(v)}})()`);
      assert(!m.more && m.tools, JSON.stringify(m));
      await page.click(`document.querySelector('#header-compare')`, 'Compare');
      await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
      assert(await page.ev(`[...document.querySelectorAll('tr.cmp-lr')].every(tr=>getComputedStyle(tr).display==='none')&&document.querySelector('.cmp-t tbody th').getBoundingClientRect().width>60`), 'desktop fact names');
    });
  } finally { await page.close(); }

  // Crossing 600 px must not drop keyboard focus in My list (code review,
  // 2026-11-07). Widening hides More, so focus goes to the first tool still
  // shown (Back); narrowing hides Share, Export and Print behind a closed
  // More, so More opens and the tool keeps focus.
  const crossTo = async (page, width, height) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`({ok:innerWidth===${width},why:'width '+innerWidth})`, 3000, `width ${width}`);
    await settle(page);
  };
  const openList = async (page) => {
    await page.click(`document.querySelector('#header-list')`, 'My list');
    await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'list view not open'})`, 5000, 'the list view');
    await settle(page);
  };
  {
    const page = await open('?ui=en', 390, 844, { saves: ids });
    try {
      await check('390-600/en', 'PM list focus widening', 'More has focus on a phone; widening past 600 px (More hidden) moves focus to Back, a shown tool, and narrowing again keeps it there', async () => {
        await openList(page);
        await page.ev(`document.querySelector('#ml-more').focus()`);
        assert(await page.ev(`document.activeElement.id`) === 'ml-more', 'More did not take focus');
        await crossTo(page, 600, 900);
        await page.waitFor(`({ok:document.activeElement.id==='f-shortlist-only'&&(${visible})('#f-shortlist-only'),why:'focus is on '+document.activeElement.tagName+'#'+document.activeElement.id})`, 3000, 'focus on Back after widening');
        await crossTo(page, 599, 844);
        assert(await page.ev(`document.activeElement.id`) === 'f-shortlist-only', 'focus lost narrowing again');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  for (const tool of ['#export-csv', '#print-shortlist', '#ml-share-copy']) {
    const page = await open('?ui=en', 1280, 900, { saves: ids });
    try {
      await check(`1280-599/en${tool}`, 'PM list focus narrowing', `${tool} has focus on desktop; narrowing below 600 px keeps More open and focus on the tool; widening keeps it too`, async () => {
        await openList(page);
        if (tool === '#ml-share-copy') await page.click(`document.querySelector('#ml-share>summary')`, 'Share');
        await page.ev(`document.querySelector(${JSON.stringify(tool)}).focus()`);
        assert(await page.ev(`document.activeElement===document.querySelector(${JSON.stringify(tool)})`), `${tool} did not take focus`);
        await crossTo(page, 599, 844);
        await page.waitFor(`({ok:document.activeElement===document.querySelector(${JSON.stringify(tool)})&&(${visible})(${JSON.stringify(tool)})&&document.querySelector('#ml-more').getAttribute('aria-expanded')==='true',why:'focus is on '+document.activeElement.tagName+'#'+document.activeElement.id+', More '+document.querySelector('#ml-more').getAttribute('aria-expanded')})`, 3000, 'focus kept narrowing');
        await crossTo(page, 1280, 900);
        assert(await page.ev(`document.activeElement===document.querySelector(${JSON.stringify(tool)})`), 'focus lost widening back');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
}

// Compare and header, round 2 (Leon, 2026-11-06). Phone Compare drops the
// empty count row. Screenshots go to /tmp/ib-compare-header-r2/smoke.
// Print fixes from the PR 1 review (2026-11-07). An open Setup or Filters
// dialog printed over the list: their [open] rules out-ranked the print hide.
// And with the header and footer hidden on paper, a printed list or comparison
// lost the site's name and the warning to check the official page. Both are
// measured on emulated print media; the dialogs stay open throughout.
async function runPrintFixes(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-print-fixes/smoke';
  await mkdir(shots, { recursive: true });
  const { UI } = await import('../js/i18n.js');
  const COMPARE = 'ib-university-finder:compare:v1';
  const SAVES = 'ib-university-finder:shortlist:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height, { compare = [], saves = [] } = {}) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'page');
    if (width < 600) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});localStorage.setItem(${JSON.stringify(SAVES)},${JSON.stringify(JSON.stringify(saves))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'reload');
    return page;
  };
  const printed = async (page, name, measure) => {
    await page.send('Emulation.setEmulatedMedia', { media: 'print' });
    try {
      await page.ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const m = await page.ev(measure);
      const { cssContentSize } = await page.send('Page.getLayoutMetrics');
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cssContentSize.width, height: Math.min(3000, cssContentSize.height), scale: 1 } });
      await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
      return m;
    } finally { await page.send('Emulation.setEmulatedMedia', { media: '' }); }
  };
  // Shown on paper: laid out, not clipped away, and the text is what it says.
  const head = `(()=>{const h=document.querySelector('.print-head'),r=h.getBoundingClientRect(),cs=getComputedStyle(h);
    return {display:cs.display,visibility:cs.visibility,w:r.width,h:r.height,top:r.top+scrollY,
      name:h.querySelector('.print-name').textContent.trim(),warn:h.querySelector('.print-name+p').textContent.trim()}})()`;
  const headOk = (m, ui, contentTop) => m.head.display === 'block' && m.head.visibility === 'visible' && m.head.w > 200 && m.head.h > 20
    && m.head.name === UI[ui].r2_wordmark && m.head.warn === UI[ui].r2_footer_p && m.head.top + m.head.h <= contentTop + 0.5;

  // 1. Setup (1280, opened from "Edit my answers") and the phone Filters sheet
  // (390): open, printed, neither box nor scrim shows while the list does, and
  // the dialog is still open after. (A hit test cannot tell: a modal dialog
  // makes the page under it inert, and inert nodes are never hit.)
  for (const [width, height, which] of [[1280, 900, 'setup'], [390, 844, 'sheet']]) for (const ui of ['sk', 'en']) {
    const page = await open(`?ui=${ui}&q=nanobiology`, width, height);
    try {
      await check(`${width}/${ui}`, 'PR print dialogs', `an open ${which === 'setup' ? 'Setup' : 'Filters sheet'} does not print over the list and stays open`, async () => {
        const dialog = which === 'setup' ? '#onboarding' : '#filter-sheet';
        if (which === 'setup') await page.click(`[...document.querySelectorAll('[data-edit]')].find(b=>b.getClientRects().length&&!b.closest('dialog'))`, 'Edit my answers');
        else await page.click(`document.querySelector('#f-more')`, 'Filters');
        await page.waitFor(`({ok:document.querySelector('${dialog}').open,why:'dialog closed'})`, 5000, 'dialog open');
        const m = await printed(page, `dialog-${which}-${width}-${ui}`, `(()=>{const d=document.querySelector('${dialog}'),row=document.querySelector('#results>.item .row');
          return {open:d.open,display:getComputedStyle(d).display,rects:d.getClientRects().length,scrim:getComputedStyle(d,'::backdrop').display,
            row:row.getBoundingClientRect().height,overflow:getComputedStyle(document.documentElement).overflow,
            head:${head},content:document.querySelector('#results').getBoundingClientRect().top+scrollY}})()`);
        assert(m.open && m.display === 'none' && m.rects === 0 && m.scrim === 'none' && m.row > 0 && m.overflow === 'visible', JSON.stringify(m));
        assert(headOk(m, ui, m.content), 'title and warning ' + JSON.stringify(m.head));
        assert(await page.ev(`document.querySelector('${dialog}').open && getComputedStyle(document.querySelector('${dialog}')).display !== 'none'`), 'the dialog is not back on screen after printing');
      });
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 2. My list and an open Compare print the site's name and the warning above
  // what they print (live main at a6fed60 printed both in its header).
  const { readSheets } = await import('../js/data.js');
  const ids = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes.slice(0, 2).map((r) => r.id);
  for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, 1440, 900, { compare: ids, saves: ids });
    try {
      await check(`1440/${ui}`, 'PR print head', 'printed My list and Compare start with the site name and the check-the-official-page warning', async () => {
        await page.click(`document.querySelector('#header-list')`, 'My list');
        await page.waitFor(`({ok:document.querySelectorAll('#results>.item').length===2,why:'list not shown'})`, 5000, 'My list');
        let m = await printed(page, `head-mylist-${ui}`, `({head:${head},content:document.querySelector('#results').getBoundingClientRect().top+scrollY})`);
        assert(headOk(m, ui, m.content), 'My list ' + JSON.stringify(m));
        await page.click(`document.querySelector('#header-compare')`, 'Compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare closed'})`, 5000, 'Compare');
        m = await printed(page, `head-compare-${ui}`, `({head:${head},content:document.querySelector('#compare').getBoundingClientRect().top+scrollY})`);
        assert(headOk(m, ui, m.content), 'Compare ' + JSON.stringify(m));
        // On screen the paper-only copy is not shown, and not read out.
        assert(await page.ev(`getComputedStyle(document.querySelector('.print-head')).display==='none'`), 'print head shows on screen');
      });
    } finally { await page.close(); }
  }
}

async function runCompareHeaderR2(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-compare-header-r2/smoke';
  await mkdir(shots, { recursive: true });
  const COMPARE = 'ib-university-finder:compare:v1';
  const SAVES = 'ib-university-finder:shortlist:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height, { compare = [], saves = [], touch = width < 600 || height <= 500 } = {}) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'page');
    if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});localStorage.setItem(${JSON.stringify(SAVES)},${JSON.stringify(JSON.stringify(saves))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(q=>setTimeout(q,1500))]))))`);
  const shot = async (page, name) => {
    await settle(page);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const ids = data.slice(0, 6).map((r) => r.id);

  // 1. Phone Compare: no count row above it; it starts 12 px from the top with
  // Close in view; closing brings the row back.
  for (const width of [320, 390]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, 844, { compare: ids.slice(0, 3), saves: ids.slice(0, 1) });
    try {
      await check(`${width}/${ui}`, 'CH1 phone Compare', 'no count row while Compare is open; Compare starts 12 px from the top with Close in view; Close brings the row back', async () => {
        await page.ev(`scrollTo({top:900,behavior:'instant'})`);
        await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
        await settle(page);
        const m = await page.ev(`(()=>{const r=(s)=>document.querySelector(s).getBoundingClientRect();return {status:getComputedStyle(document.querySelector('.status')).display,
          cmp:Math.round(r('#compare').top),hd:Math.round(r('.hd').bottom),close:[r('#cmp-close').top,r('#cmp-close').bottom],sw:document.documentElement.scrollWidth-innerWidth}})()`);
        await shot(page, `phone-compare-${width}-${ui}`);
        assert(m.status === 'none', `count row shown: ${m.status}`);
        assert(m.cmp === 12 && m.hd <= 0, `Compare top ${m.cmp}, header bottom ${m.hd}`);
        assert(m.close[0] >= 12 && m.close[1] <= 844, `Close at ${m.close}`);
        assert(await page.ev(`getComputedStyle(document.querySelector('#cmp-close')).borderTopLeftRadius==='8px'`), 'phone Close corners');
        assert(m.sw === 0, `page overflows by ${m.sw}`);
        await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
        await page.waitFor(`({ok:document.querySelector('#compare').hidden&&getComputedStyle(document.querySelector('.status')).display==='flex'&&document.activeElement===document.querySelector('#cmp-tray-open'),why:getComputedStyle(document.querySelector('.status')).display+' '+document.activeElement?.id})`, 5000, 'row back, focus on the tray');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 2. Desktop Compare: the footer heading sits at most 48 px under it (it
  // was 68), nothing is cut off, and the list keeps its 48 px footer gap.
  for (const [width, height] of [[1440, 900], [1280, 800]]) {
    const page = await open('?ui=sk', width, height, { compare: ids.slice(0, 3) });
    try {
      await check(`${width}x${height}/sk`, 'CH2 desktop Compare', 'the footer heading is 40 to 48 px under Compare, the last row is whole, the list keeps its 48 px gap; Close has 8 px corners', async () => {
        const list = await page.ev(`getComputedStyle(document.querySelector('.foot')).marginTop`);
        await page.click(`document.querySelector('#header-compare')`, 'Compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
        await settle(page);
        const m = await page.ev(`(()=>{const r=(s)=>document.querySelector(s).getBoundingClientRect();const rows=[...document.querySelectorAll('.cmp-t tbody tr')];
          return {gap:Math.round(r('.foot h2').top-r('#compare').bottom),last:Math.round(r('#compare').bottom-rows.at(-1).getBoundingClientRect().bottom),sw:document.documentElement.scrollWidth-innerWidth}})()`);
        await page.ev(`scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);
        await shot(page, `desktop-compare-bottom-${width}`);
        assert(list === '48px', `list footer gap ${list}`);
        assert(m.gap >= 40 && m.gap <= 48, `footer heading ${m.gap} px under Compare`);
        assert(m.last >= 0 && m.last <= 2, `last row cut or padded: ${m.last}`);
        // 3. Close comparison is rounded like the other outlined buttons, and
        // keeps its words and its 44 px height.
        const close = await page.ev(`(()=>{const c=document.querySelector('#cmp-close'),s=getComputedStyle(c),t=getComputedStyle(c.querySelector('.cmp-close-t'));return [s.borderTopLeftRadius,s.borderBottomRightRadius,c.getBoundingClientRect().height,t.position]})()`);
        assert(close[0] === '8px' && close[1] === '8px' && close[2] >= 44 && close[3] !== 'absolute', `close ${close}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 4. Phones: My list sits in the count row just before Filters, at the top
  // and stuck, with its saved count, 44 px targets and no overflow; the header
  // has no copy of it. From 600 px it is back in the header before Compare.
  for (const width of [320, 360, 390, 430]) for (const ui of ['en', 'sk']) {
    const page = await open(`?ui=${ui}`, width, 844, { saves: ids.slice(0, 2) });
    try {
      await check(`${width}/${ui}`, 'CH4 phone My list', 'in the count row before Filters, top and stuck: 44 px, count shown, nothing overlaps or overflows, not in the header', async () => {
        for (const y of [0, 1200]) {
          await page.ev(`scrollTo({top:${y},behavior:'instant'})`);
          await page.waitFor(`({ok:document.querySelector('.status').classList.contains('is-stuck')===${y > 0},why:'stuck '+document.querySelector('.status').className})`, 5000, 'row state');
          await settle(page);
          const m = await page.ev(`(()=>{const q=(s)=>document.querySelector(s),r=(s)=>q(s).getBoundingClientRect();const hl=r('#header-list'),b=r('#header-list .badge'),f=r('#f-more');
            const parts=['.status .home-tile','.status .cfull','.status .cshort'].map(s=>r(s)).filter(x=>x.width>1&&x.height>1);
            const overlap=(a,c)=>a.left<c.right-0.5&&c.left<a.right-0.5&&a.top<c.bottom-0.5&&c.top<a.bottom-0.5;
            return {inRow:q('#header-list').parentElement===q('.status')&&q('#header-list').nextElementSibling===q('#f-more'),inHeader:!!q('.hd #header-list'),
              size:[hl.width,hl.height,f.height],line:Math.abs((hl.top+hl.height/2)-(f.top+f.height/2))<=1,order:hl.right<=f.left,
              badge:getComputedStyle(q('#header-list .badge')).display!=='none'&&q('#header-list .badge').textContent==='2'&&b.left>=hl.left-0.5&&b.right<=hl.right+0.5&&b.top>=hl.top-0.5&&b.bottom<=hl.bottom+0.5,
              clear:!parts.some(p=>overlap(p,hl)||overlap(p,f)),inView:f.right<=innerWidth,sw:document.documentElement.scrollWidth-innerWidth}})()`);
          if (width === 390) await shot(page, `phone-mylist-row-${width}-${ui}-${y ? 'stuck' : 'top'}`);
          assert(m.inRow && !m.inHeader, `placement ${JSON.stringify(m)}`);
          assert(m.size.every((v) => v >= 44) && m.line && m.order, `size/line ${JSON.stringify(m)}`);
          assert(m.badge, 'saved count not shown inside the button');
          assert(m.clear && m.inView && m.sw === 0, `overlap/overflow ${JSON.stringify(m)}`);
        }
        const { root: doc } = await page.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#header-list' });
        const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        const name = nodes[0]?.name?.value ?? '';
        assert(name.includes(ui === 'sk' ? 'Môj zoznam' : 'My list') && name.includes('2'), 'accessible name: ' + name);
        // Focus survives a rotation across 600 px, and the button goes back.
        await page.ev(`document.querySelector('#header-list').focus()`);
        await page.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 844, deviceScaleFactor: 1, mobile: false });
        await page.waitFor(`({ok:document.querySelector('#header-list').nextElementSibling===document.querySelector('#header-compare')&&document.activeElement===document.querySelector('#header-list'),why:document.querySelector('#header-list').parentElement.className+' '+document.activeElement?.id})`, 5000, 'back in the header, focused');
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        await page.waitFor(`({ok:document.querySelector('#header-list').parentElement===document.querySelector('.status')&&document.activeElement===document.querySelector('#header-list'),why:document.activeElement?.id})`, 5000, 'back in the row, focused');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
}

// Review of PR 1 (2026-11-07). Setup with My list's "Show all saves" on kept
// showing (and counting) saves above the student's points; setup ending under
// an open Compare left the results hidden; a focused Compare arrow and "Back
// to all programmes" each dropped focus to the page.
async function runSetupCompareReview(base) {
  watchdog.refresh();
  const SAVES = 'ib-university-finder:shortlist:v1', COMPARE = 'ib-university-finder:compare:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (width, height, { compare = [], saves = [] } = {}) => {
    const page = await openPage(`${base}?ui=en`, width, height);
    await page.waitFor(ready, 15000, 'page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});localStorage.setItem(${JSON.stringify(SAVES)},${JSON.stringify(JSON.stringify(saves))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(q=>setTimeout(q,1500))]))))`);
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const high = data.find((r) => r.ibPointsMin >= 40 && r.pointsKind !== 'cutoff');
  const low = data.find((r) => r.ibPointsMin === 24 && r.pointsKind !== 'cutoff');
  const ids = data.slice(0, 3).map((r) => r.id);
  // Setup from "Edit my answers", keeping whatever points the filters hold
  // unless points is given, through to the done screen.
  const toDone = async (page, points) => {
    await page.ev(`document.querySelector('.edit-answers').click()`);
    await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup not open'})`, 5000, 'setup');
    await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Start');
    if (points) { await page.click(`document.querySelector('#ob-points')`, 'points'); await page.clearField(); await page.type(String(points)); }
    for (let i = 0; i < 4; i++) await page.click(`document.querySelector('.ob-foot>.btn-p')`, `step ${i + 2}`);
    await page.waitFor(`({ok:!!document.querySelector('.ob-done'),why:'no done screen'})`, 5000, 'done screen');
    await settle(page);
  };
  const run = async (where, id, name, page, fn) => {
    try { await check(where, id, name, () => fn(page)); assert(!page.errors.length, page.errors.map((e) => e.text).join(' | ')); }
    finally { await page.close(); }
  };

  await run('1440/en', 'PR1 setup list', 'setup with "Show all saves" on filters My list again: the done screen and the list leave out a save above the points', await open(1440, 900, { saves: [high.id, low.id] }), async (page) => {
    assert(high && low, 'no 40+ and 24-point rows in the data');
    await page.click(`document.querySelector('#header-list')`, 'My list');
    await page.click(`document.querySelector('#f-points')`, 'My IB points'); await page.type('24');
    await page.waitFor(`({ok:!document.querySelector('#ml-show-all').hidden,why:'Show all saves not offered'})`, 5000, 'Show all saves');
    await page.click(`document.querySelector('#ml-show-all')`, 'Show all saves');
    await page.waitFor(`({ok:document.querySelectorAll('#results>li.item').length===2,why:'rows '+document.querySelectorAll('#results>li.item').length})`, 5000, 'both saves shown');
    await toDone(page);
    const count = await page.ev(`document.querySelector('.ob-count').textContent`);
    assert(count === '1 programme shown · 1 within your IB points', `done screen count "${count}"`);
    await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Show my programmes');
    await page.waitFor(`({ok:[...document.querySelectorAll('#results>li.item')].map(x=>x.dataset.id).join()===${JSON.stringify(low.id)},why:'rows '+[...document.querySelectorAll('#results>li.item')].map(x=>x.dataset.id).join()})`, 5000, 'only the save within the points');
  });

  await run('1440/en', 'PR1 setup compare', '"Show my programmes" closes an open Compare, keeps its programme and focuses the results', await open(1440, 900, { compare: ids.slice(0, 1) }), async (page) => {
    await page.click(`document.querySelector('#header-compare')`, 'Compare');
    await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
    await toDone(page, 36);
    await page.click(`document.querySelector('.ob-foot>.btn-p')`, 'Show my programmes');
    await page.waitFor(`({ok:document.querySelector('#compare').hidden&&!document.querySelector('.split').hidden&&document.activeElement.getAttribute('aria-labelledby')==='results-h'&&document.querySelector('#header-compare-count').textContent==='1',
      why:JSON.stringify({compare:!document.querySelector('#compare').hidden,focus:document.activeElement.tagName+'#'+document.activeElement.id,n:document.querySelector('#header-compare-count').textContent})})`, 5000, 'the results, Compare closed');
  });

  await run('590-600/en', 'PR1 compare arrow focus', 'a focused "Next programme" arrow hands focus to the comparison when widening hides it', await open(590, 900, { compare: ids }), async (page) => {
    await page.click(`document.querySelector('#cmp-tray-open')`, 'Open compare');
    await page.waitFor(`({ok:!document.querySelector('#compare').hidden&&document.querySelectorAll('th.cmp-p').length===3,why:'compare not open'})`, 5000, 'compare');
    await settle(page);
    await page.ev(`document.querySelector('.cmp-next').focus()`);
    assert(await page.ev(`document.activeElement.matches('.cmp-next')`), 'the arrow did not take focus');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.waitFor(`({ok:innerWidth===600&&getComputedStyle(document.querySelector('.cmp-nav')).display==='none'&&document.activeElement.id==='cmp-scroll',why:'focus on '+document.activeElement.tagName+'#'+document.activeElement.id})`, 3000, 'focus on the comparison');
  });

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await run(`${width}/en`, 'PR1 list back focus', 'Enter on "Back to all programmes" leaves My list with focus on the My list button', await open(width, height, { saves: ids.slice(0, 2) }), async (page) => {
      await page.click(`document.querySelector('#header-list')`, 'My list');
      await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'list view not open'})`, 5000, 'the list view');
      await page.ev(`document.querySelector('#f-shortlist-only').focus()`);
      await page.key('Enter', 'Enter', 13, [], '\r');
      await page.waitFor(`({ok:!document.querySelector('#shortlist-bar').classList.contains('is-list')&&document.activeElement.id==='header-list'&&document.activeElement.getClientRects().length>0,why:'focus on '+document.activeElement.tagName+'#'+document.activeElement.id})`, 3000, 'focus on My list');
    });
  }
}

// Phone fixes from the PR 1 review.
async function runPhoneFixes(base) {
  watchdog.refresh();
  const ready = `({ok:document.querySelector('#loading')?.hidden,why:'page loading'})`;
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const ids = data.slice(0, 3).map((r) => r.id);

  // 1. Below 600 px Search is the filter form's only text field, so Enter
  // submitted the form: the page reloaded to ?q=…, in English, without the
  // shared list. Enter now does nothing, as it does from 600 px.
  for (const query of ['?ui=sk', `?ui=sk&list=${ids.join(',')}`]) {
    const page = await openPage(base + query, 390, 844);
    try {
      await check(`390/sk${query.includes('list') ? '/list' : ''}`, 'PHN enter', 'Enter in Search keeps the page, its address, the language and a shared list', async () => {
        await page.waitFor(ready, 15000, 'page');
        // The first-visit setup is modal; dismiss it the way a returning
        // student has, then mark this page so a reload would show.
        await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
        await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reloading'})`, 15000, 'reload');
        await page.ev('window.__alive=true');
        await page.ev(`document.querySelector('#f-search').focus()`);
        await page.type('a');
        await page.waitFor(`({ok:location.search.includes('q=a'),why:location.search})`, 5000, 'search in the address');
        const before = await page.ev('location.search');
        await page.key('Enter', 'Enter', 13, [], '\r');
        // A reload would take a moment to start; give it the chance.
        await page.ev('new Promise((r) => setTimeout(r, 800))');
        await page.waitFor(ready, 15000, 'page after Enter');
        const m = await page.ev(`({alive:window.__alive===true,search:location.search,lang:document.documentElement.lang,value:document.querySelector('#f-search').value})`);
        assert(m.alive, `the page reloaded: ${m.search}`);
        assert(m.search === before && m.lang === 'sk' && m.value === 'a', JSON.stringify(m));
        if (query.includes('list')) assert(m.search.includes('list='), `shared list dropped: ${m.search}`);
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  const open = async (width, height, compare = []) => {
    const page = await openPage(`${base}?ui=en`, width, height);
    await page.waitFor(ready, 15000, 'page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem('ib-university-finder:compare:v1',${JSON.stringify(JSON.stringify(compare))});window.__oldPage=true;location.reload()`);
    await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reloading'})`, 15000, 'reload');
    return page;
  };
  const tab = (page) => page.key('Tab', 'Tab', 9);

  // 3. The phone Compare tray is fixed to the bottom but came last in Tab
  // order, after every row (about 8,700 stops). It now follows the count row.
  {
    const page = await open(390, 844, ids.slice(0, 2));
    try {
      await check('390/en', 'PHN tray order', 'Tab from the top reaches the tray\'s Open within 15 stops, before any row; the tray stays at the bottom', async () => {
        await page.waitFor(`({ok:!document.querySelector('#cmp-tray').hidden,why:'no tray'})`, 5000, 'tray');
        await page.ev(`document.activeElement?.blur();scrollTo({top:0,behavior:'instant'})`);
        let stops = 0, row = false;
        while (stops < 15 && !(await page.ev(`document.activeElement?.id==='cmp-tray-open'`))) {
          await tab(page); stops++;
          if (await page.ev(`!!document.activeElement?.closest('#results')`)) row = true;
        }
        const m = await page.ev(`(()=>{const r=document.querySelector('#cmp-tray').getBoundingClientRect();return {open:document.activeElement?.id,bottom:Math.round(r.bottom),top:Math.round(r.top),pos:getComputedStyle(document.querySelector('#cmp-tray')).position,h:innerHeight}})()`);
        assert(m.open === 'cmp-tray-open' && !row, `after ${stops} stops focus is on ${m.open}${row ? ', having passed a row' : ''}`);
        assert(m.pos === 'fixed' && m.bottom <= m.h && m.bottom >= m.h - 24 && m.top > m.h / 2, `tray at ${JSON.stringify(m)}`);
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }

  // 4. "Added to compare (n of 4) · Open compare" stayed over the open
  // comparison until its timer ran out.
  {
    const page = await open(1280, 900);
    try {
      await check('1280/en', 'PHN compare toast', 'opening Compare from the header retires the "Open compare" toast at once', async () => {
        await page.click(`document.querySelector('#results>.item .cmpi')`, 'a row\'s Compare');
        await page.waitFor(`({ok:[...document.querySelectorAll('#toasts .toast')].some(n=>n.textContent.includes('Open compare')),why:document.querySelector('#toasts').textContent})`, 5000, 'the toast');
        await page.click(`document.querySelector('#header-compare')`, 'Compare in the header');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
        await page.waitFor(`({ok:![...document.querySelectorAll('#toasts .toast:not(.out)')].some(n=>n.textContent.includes('Open compare')),why:document.querySelector('#toasts').textContent})`, 1000, 'the toast gone');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }

  // 5. On phones each arrow key in Sort committed a sort and closed the list.
  {
    const page = await open(390, 844);
    try {
      await check('390/en', 'PHN sort keys', 'arrow keys sort and keep the list open on the chosen radio; Enter closes it on its button', async () => {
        const state = `({open:document.querySelector('#dd-sort').open,value:document.activeElement?.value??'',summary:document.activeElement===document.querySelector('#dd-sort>summary'),sort:document.querySelector('#f-sort').value})`;
        await page.ev(`document.querySelector('#dd-sort>summary').focus()`);
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`({ok:document.querySelector('#dd-sort').open,why:'not open'})`, 3000, 'the list');
        await tab(page);
        const start = await page.ev(state);
        for (let i = 1; i <= 2; i++) {
          await page.key('ArrowDown', 'ArrowDown', 40);
          const m = await page.waitFor(`(()=>{const m=${state};return {...m,ok:m.sort!==${JSON.stringify(start.sort)}&&m.value===m.sort&&m.open,why:JSON.stringify(m)}})()`, 3000, `arrow ${i}`);
          start.sort = m.sort;
        }
        await page.key('Enter', 'Enter', 13, [], '\r');
        await page.waitFor(`(()=>{const m=${state};return {ok:!m.open&&m.summary&&m.sort===${JSON.stringify(start.sort)},why:JSON.stringify(m)}})()`, 3000, 'closed on its button');
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
}

async function runAlignChromeSetup(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-align-fix-b/smoke';
  await mkdir(shots, { recursive: true });
  const { UI } = await import('../js/i18n.js');
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'navigation or loading pending'})`;
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))))`);
  const shoot = async (page, name) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  // A fresh page in one state: language, touch, saved programmes, setup seen.
  const open = async (width, height, lang, { touch = width < 600, saves = 0, onboarding = 'dismissed', query = '' } = {}) => {
    const page = await openPage(`${base}?ui=${lang}`, width, height);
    try {
      await page.waitFor(ready, 15000, 'page');
      if (touch) {
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      }
      const ids = await page.ev(`[...document.querySelectorAll('#results>li.item')].slice(0,${saves}).map(n=>n.dataset.id)`);
      await page.ev(`localStorage.clear();${onboarding ? `localStorage.setItem('ibuf.onboarding.v1','${onboarding}');` : ''}localStorage.setItem('ib-university-finder:language','${lang}');localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify(${JSON.stringify(ids)}));window.__oldPage=true;location.href=${JSON.stringify(base)}+'?ui=${lang}${query}'`);
      await page.waitFor(ready, 15000, 'reloaded page');
      page.ids = ids;
      return page;
    } catch (err) { await page.close(); throw err; }
  };
  // A text's own box (a Range), not its element's.
  const textBox = `(n)=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect()}`;

  // Header: the Search hint is never cut off. The long one shows exactly where
  // it fits whole, in both languages (re-measured after a language switch).
  for (const [width, touch] of [[600, false], [700, false], [850, false], [1024, false], [1280, false], [768, true]]) {
    const page = await open(width, 800, 'en', { touch });
    try {
      for (const lang of ['en', 'sk', 'en']) {
        await check(width, 'AL-H1 search hint', `(${lang}${touch ? ', touch' : ''}): the hint fits its field; the long one shows whenever it fits`, async () => {
          await page.ev(`(b=>b.getAttribute('aria-pressed')==='true'||b.click())(document.querySelector('[data-language=${lang}]'))`);
          await page.waitFor(`({ok:document.documentElement.lang==='${lang}',why:'language'})`, 3000, 'language');
          await settle(page);
          const m = await page.ev(`(()=>{const i=document.querySelector('#f-search'),s=getComputedStyle(i),w=(text)=>{const n=document.createElement('span');n.style.cssText='position:absolute;white-space:pre;font:'+s.fontWeight+' '+s.fontSize+' '+s.fontFamily;n.textContent=text;document.body.append(n);const x=n.getBoundingClientRect().width;n.remove();return x};
            return {ph:i.placeholder,room:i.offsetWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),shown:w(i.placeholder),long:w(${JSON.stringify(UI[lang].r2_searchph)}),over:s.textOverflow}})()`);
          if (lang === 'sk' || width === 600) {
            const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: 60, scale: 2 } });
            await writeFile(`${shots}/search-${width}-${lang}${touch ? '-touch' : ''}.png`, Buffer.from(data, 'base64'));
          }
          assert(m.shown <= m.room + 0.5, `hint cut off: ${JSON.stringify(m)}`);
          assert((m.long <= m.room) === (m.ph === UI[lang].r2_searchph) && [UI[lang].r2_searchph, UI[lang].search_2].includes(m.ph), `wrong hint: ${JSON.stringify(m)}`);
          assert(m.over === 'ellipsis', `no ellipsis safety net: ${m.over}`);
        });
      }
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }

  // Phones: one hairline under the header, and the Filters sheet's points field
  // and bottom actions.
  for (const [width, lang] of [[390, 'en'], [320, 'sk'], [320, 'en']]) {
    const page = await open(width, 844, lang);
    try {
      await check(width, 'AL-H2 header hairline', `(${lang}): between the header and the count row only white, no grey stripe`, async () => {
        const m = await page.ev(`(()=>{const hd=document.querySelector('.hd').getBoundingClientRect(),st=document.querySelector('.status').getBoundingClientRect(),panel=getComputedStyle(document.querySelector('.hd')).backgroundColor;
          const bg=(n)=>{for(;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c!=='rgba(0, 0, 0, 0)')return c}return 'none'};const bad=[];
          for(let y=Math.ceil(hd.bottom);y<Math.floor(st.top)+1;y++)for(const x of [1,innerWidth/2,innerWidth-1]){const c=bg(document.elementFromPoint(x,y+0.5));if(c!==panel)bad.push([x,y,c])}
          return {gap:st.top-hd.bottom,bad,fslot:getComputedStyle(document.querySelector('.fslot')).borderBottomWidth}})()`);
        assert(m.bad.length === 0 && m.fslot === '0px' && m.gap <= 2, `stripe under the header: ${JSON.stringify(m)}`);
      });
      await check(width, 'AL-H3 Filters sheet', `(${lang}): the points hint fits; Edit my answers first; its text, Copy link and the help share the left edge`, async () => {
        await page.click(`document.querySelector('#f-more')`, 'Filters');
        await page.waitFor(`({ok:document.querySelector('#filter-sheet').open,why:'sheet'})`, 3000, 'sheet');
        await settle(page);
        await shoot(page, `sheet-${width}-${lang}-top`);
        const m = await page.ev(`(()=>{const tb=${textBox},b=document.querySelector('.sheet-b'),bs=getComputedStyle(b),edge=b.getBoundingClientRect().left+parseFloat(bs.paddingLeft);
          const i=document.querySelector('#f-points'),s=getComputedStyle(i),n=document.createElement('span');n.style.cssText='position:absolute;white-space:pre;font:'+getComputedStyle(i,'::placeholder').fontWeight+' '+getComputedStyle(i,'::placeholder').fontSize+' '+s.fontFamily;n.textContent=i.placeholder;document.body.append(n);const ph=n.getBoundingClientRect().width;n.remove();
          const edit=document.querySelector('.sheet-b .sheet-edit'),copy=document.querySelector('.sheet-b #f-copy'),help=document.querySelector('.sheet-b #f-copy-help');
          const prev=[...b.querySelectorAll('.more-filters>*')].filter(x=>x.getBoundingClientRect().height>0).at(-1);
          const box=document.querySelector('.sheet-b .f-pts');
          return {edge,ph,room:i.offsetWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),first:b.querySelector('.more-filters>:not([hidden])')===edit,
            edit:tb(edit).left,copy:copy.getBoundingClientRect().left,help:tb(help).left,gap:copy.getBoundingClientRect().top-prev.getBoundingClientRect().bottom,
            boxOver:box.scrollWidth-box.clientWidth,boxH:box.getBoundingClientRect().height,sw:b.scrollWidth-b.clientWidth}})()`);
        await page.ev(`document.querySelector('.sheet-b').scrollTop=1e5`);
        await settle(page);
        await shoot(page, `sheet-${width}-${lang}-bottom`);
        assert(m.ph <= m.room + 0.5, `points hint cut off: ${JSON.stringify(m)}`);
        assert(m.first, 'Edit my answers is not first in the sheet');
        assert([m.edit, m.copy, m.help].every((x) => Math.abs(x - m.edge) <= 1), `left edges differ: ${JSON.stringify(m)}`);
        assert(m.gap <= 17, `gap above Copy link: ${m.gap}`);
        assert(m.boxOver <= 0 && m.sw <= 0, `overflow: ${JSON.stringify(m)}`);
      });
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }

  // Focus rings: the wordmark is not touched by the logo's ring; SK/EN keep
  // theirs inside the button, clear of the pill's border.
  for (const width of [1280, 390]) {
    const page = await open(width, 800, 'en');
    try {
      await check(width, 'AL-H4 focus rings', 'logo ring clear of "Finder"; language ring inside its button', async () => {
        await page.key('Shift', 'ShiftLeft', 16);
        if (width >= 701) {
          await page.ev(`document.querySelector('.hd .mark').focus()`);
          const m = await page.ev(`(()=>{const k=document.querySelector('.hd .mark'),h=(${textBox})(k.querySelector('h1'));return {vis:k.matches(':focus-visible'),gap:k.getBoundingClientRect().right-h.right}})()`);
          assert(m.vis && m.gap >= 4, `logo ring touches the wordmark: ${JSON.stringify(m)}`);
        }
        await page.ev(`document.querySelector('[data-language=sk]').focus()`);
        const l = await page.ev(`(()=>{const b=document.querySelector('[data-language=sk]'),s=getComputedStyle(b),r=b.getBoundingClientRect(),o=parseFloat(s.outlineOffset);return {vis:b.matches(':focus-visible'),offset:o,width:parseFloat(s.outlineWidth)}})()`);
        assert(l.vis && l.offset + l.width <= 0, `language ring outside its button: ${JSON.stringify(l)}`);
      });
    } finally { await page.close(); }
  }

  // My list toolbar. From 600 px the four tools are one row of equal buttons
  // (Clear at the right end, Group by above them below 1024 px), their labels
  // on one centre line; the CSV note is its own line under them.
  const openList = async (page) => {
    await page.click(`document.querySelector('#header-list')`, 'My list');
    await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'not in My list'})`, 5000, 'My list');
    await page.ev(`scrollTo({top:0,behavior:'instant'})`);
    await settle(page);
  };
  const tools = `(()=>{const tb=${textBox},box=(n)=>n.getBoundingClientRect(),sel=['#ml-share>summary','#export-csv','#print-shortlist','#clear-shortlist'];
    const b=sel.map(q=>{const n=document.querySelector(q),r=box(n),t=tb(n.querySelector('span')),s=getComputedStyle(n);return {q,top:r.top,bottom:r.bottom,left:r.left,right:r.right,h:r.height,mid:(t.top+t.bottom)/2,lines:(()=>{const g=document.createRange();g.selectNodeContents(n.querySelector('span'));return new Set([...g.getClientRects()].map(x=>Math.round(x.top))).size})(),
      fs:s.fontSize,border:s.borderTopStyle+' '+s.borderTopWidth,icon:(n.querySelector('svg')&&getComputedStyle(n.querySelector('svg')).display!=='none')||false}});
    const g=box(document.querySelector('.ml-group')),note=document.querySelector('.ml-export-note'),nr=box(note),card=box(document.querySelector('#ml-tools'));
    return {b,group:{left:g.left,bottom:g.bottom,top:g.top},note:{shown:getComputedStyle(note).display!=='none'&&nr.height>0,top:nr.top,left:nr.left},cardRight:card.right-parseFloat(getComputedStyle(document.querySelector('#ml-tools')).paddingRight),sw:document.documentElement.scrollWidth-innerWidth}})()`;
  for (const [width, lang] of [[1280, 'en'], [1280, 'sk'], [1024, 'sk'], [700, 'sk'], [700, 'en'], [600, 'en'], [600, 'sk']]) {
    const page = await open(width, 900, lang, { saves: 3 });
    try {
      await check(width, 'AL-M1 My list tools', `(${lang}): Share, Export, Print and Clear one row of equal buttons, Clear at the right end, labels on one line; the CSV note below`, async () => {
        await openList(page);
        const m = await page.ev(tools);
        await shoot(page, `mylist-${width}-${lang}`);
        const [share, , , clear] = m.b;
        assert(m.b.every((x) => Math.abs(x.top - share.top) <= 1 && Math.abs(x.h - share.h) <= 0.5 && Math.abs(x.mid - share.mid) <= 1 && x.fs === share.fs && x.lines === 1), `buttons differ: ${JSON.stringify(m.b)}`);
        assert(clear.border === '1px solid' || clear.border === 'solid 1px', `Clear has no border: ${clear.border}`);
        assert(Math.abs(clear.right - m.cardRight) <= 1, `Clear not at the right end: ${JSON.stringify([clear, m.cardRight])}`);
        if (width < 1024) assert(m.group.bottom <= share.top, `Group by not above the buttons: ${JSON.stringify(m)}`);
        assert(m.note.shown && m.note.top >= Math.max(...m.b.map((x) => x.bottom)) && Math.abs(m.note.left - m.group.left) <= 1, `CSV note not its own line: ${JSON.stringify(m.note)}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
        // Open Share: the note stays below and the page does not widen.
        await page.click(`document.querySelector('#ml-share>summary')`, 'Share');
        await settle(page);
        await shoot(page, `mylist-${width}-${lang}-share`);
        assert(await page.ev(`document.documentElement.scrollWidth===innerWidth`), 'Share widened the page');
      });
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }
  // Phones: the 2 x 2 grid. Every label on one line in both languages; under
  // 360 px no icons; equal 44 px buttons.
  for (const [width, lang] of [[390, 'sk'], [390, 'en'], [320, 'sk'], [320, 'en']]) {
    const page = await open(width, 844, lang, { saves: 3 });
    try {
      await check(width, 'AL-M3 phone tools', `(${lang}): four equal 44 px buttons, each label on one line${width < 360 ? ', no icons' : ''}`, async () => {
        await openList(page);
        // The tools wait behind More on phones since 2026-11-06.
        await page.click(`document.querySelector('#ml-more')`, 'More');
        const m = await page.ev(tools);
        await shoot(page, `mylist-${width}-${lang}`);
        assert(m.b.every((x) => x.lines === 1 && x.h >= 44 && Math.abs(x.h - m.b[0].h) <= 0.5), `labels wrap or heights differ: ${JSON.stringify(m.b)}`);
        if (width < 360) assert(m.b.every((x) => !x.icon), `icons at ${width}: ${JSON.stringify(m.b)}`);
        else assert(m.b.slice(1).every((x) => x.icon), `icons missing at ${width}`);
        assert(m.sw === 0, `page overflows by ${m.sw}`);
        const badge = await page.ev(`(()=>{const b=document.querySelector('#header-list').getBoundingClientRect(),c=document.querySelector('#header-list .badge').getBoundingClientRect();return c.left>=b.left&&c.right<=b.right&&c.top>=b.top&&c.bottom<=b.bottom})()`);
        assert(badge, 'the My list count overlaps its button\'s edge');
      });
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }
  // A shared list hides Export, so it hides the note about Export too.
  for (const width of [1280, 390]) {
    let page = await open(width, width < 600 ? 844 : 900, 'en', { saves: 3 });
    const ids = page.ids;
    await page.close();
    page = await open(width, width < 600 ? 844 : 900, 'en', { query: `&list=${ids.join(',')}` });
    try {
      await check(width, 'AL-M2 shared list', 'no CSV note without Export', async () => {
        await page.waitFor(`({ok:document.querySelector('#shortlist-bar').classList.contains('is-list')&&!document.querySelector('#ml-save-shared').hidden,why:'not the shared view'})`, 5000, 'shared view');
        await settle(page);
        await shoot(page, `mylist-shared-${width}`);
        assert(await page.ev(`getComputedStyle(document.querySelector('#export-csv')).display==='none' && getComputedStyle(document.querySelector('.ml-export-note')).display==='none'`), 'the CSV note shows on a shared list');
      });
    } finally { await page.close(); }
  }
  // An empty My list: one "Back to all programmes"; the card lines up with the
  // pane on wide screens and the bar keeps its rounded bottom on phones.
  for (const [width, lang] of [[1280, 'en'], [390, 'en'], [390, 'sk']]) {
    const page = await open(width, width < 600 ? 844 : 900, lang);
    try {
      await check(width, 'AL-M4 empty My list', `(${lang}): one way back; the card lines up${width < 600 ? ', the bar is a whole card' : ' with the pane'}`, async () => {
        await openList(page);
        const m = await page.ev(`(()=>{const v=(n)=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().height>0,back=${JSON.stringify(UI[lang].back_to_all_programmes)};
          const n=[...document.querySelectorAll('button')].filter(b=>v(b)&&b.textContent.trim()===back).length,bar=document.querySelector('#shortlist-bar'),bs=getComputedStyle(bar),e=document.querySelector('#empty-state').getBoundingClientRect(),p=document.querySelector('#pane');
          return {n,emptyTop:e.top,paneTop:p&&v(p)?p.getBoundingClientRect().top:null,radius:bs.borderBottomLeftRadius,border:bs.borderBottomWidth,gap:e.top-bar.getBoundingClientRect().bottom}})()`);
        await shoot(page, `mylist-empty-${width}-${lang}`);
        assert(m.n === 1, `${m.n} back buttons`);
        if (width >= 1200) assert(m.paneTop !== null && Math.abs(m.emptyTop - m.paneTop) <= 1, `card and pane tops differ: ${JSON.stringify(m)}`);
        else assert(m.radius !== '0px' && m.border !== '0px' && m.gap >= 8 && m.gap <= 13, `bar looks cut off: ${JSON.stringify(m)}`);
      });
    } finally { await page.close(); }
  }
  // Setup. Step 2 never scrolls sideways; on phones Next/Finish is full width
  // on its own row with Skip and Back together under it; every footer button
  // is 44 px; the done screen has no empty band; Skip's ring clears its hint.
  const next = (page, what) => page.click(`document.querySelector('.ob-foot>.btn-p')`, what);
  const foot = `(()=>{const d=document.querySelector('#onboarding'),box=(n)=>n.getBoundingClientRect(),f=d.querySelector('.ob-foot'),fs=getComputedStyle(f),fr=box(f),body=d.querySelector('.ob-body');
    const vis=[...f.querySelectorAll('.btn')].filter(n=>n.offsetParent);const p=f.querySelector('.btn-p'),skip=f.querySelector('.skipwrap .btn'),back=vis.find(n=>n!==p&&n!==skip);
    const r=(n)=>n&&(({top,bottom,left,right,height})=>({top,bottom,left,right,height}))(box(n));
    return {primary:r(p),skip:r(skip),back:r(back),heights:vis.map(n=>box(n).height),edge:[fr.left+parseFloat(fs.paddingLeft),fr.right-parseFloat(fs.paddingRight)],over:body.scrollWidth-body.clientWidth,step:d.querySelector('.ob-n')?.textContent}})()`;
  for (const [width, lang] of [[320, 'sk'], [320, 'en'], [390, 'sk'], [390, 'en']]) {
    const page = await open(width, 844, lang, { onboarding: null });
    try {
      await check(width, 'AL-S1 setup footer', `(${lang}): no sideways scroll; Next full width on top, Skip and Back on one row, 44 px, on every step`, async () => {
        await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup'})`, 5000, 'setup');
        for (let step = 1; step <= 5; step++) {
          await settle(page);
          const m = await page.ev(foot);
          if (step === 2 || step === 5) await shoot(page, `setup-${width}-${lang}-s${step}`);
          assert(m.over <= 0, `step ${step} scrolls sideways by ${m.over}`);
          assert(Math.abs(m.primary.left - m.edge[0]) <= 1 && Math.abs(m.primary.right - m.edge[1]) <= 1, `step ${step}: primary not full width ${JSON.stringify(m)}`);
          assert(m.primary.bottom <= m.skip.top, `step ${step}: primary not on top ${JSON.stringify(m)}`);
          if (step > 1) assert(m.back && Math.abs(m.back.top - m.skip.top) <= 1 && Math.abs(m.back.right - m.edge[1]) <= 1, `step ${step}: Skip and Back not one row ${JSON.stringify(m)}`);
          assert(m.heights.every((h) => h >= 44), `step ${step}: heights ${m.heights}`);
          // Tab order must follow the primary row, then Skip and Back below.
          await page.ev(`document.querySelector('.ob-foot>.btn-p').focus()`);
          await page.key('Tab', 'Tab', 9);
          assert(await page.ev(`document.activeElement === document.querySelector('.skipwrap button')`), `step ${step}: Tab from Next did not reach Skip`);
          if (step > 1) {
            await page.key('Tab', 'Tab', 9);
            assert(await page.ev(`document.activeElement === document.querySelector('.ob-foot>.btn:not(.btn-p)')`), `step ${step}: Tab from Skip did not reach Back`);
          }
          if (step === 2 && width === 390 && lang === 'en') {
            await page.ev(`document.querySelector('.ob-foot>.btn-p').focus()`);
            for (const w of [700, 390]) {
              await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }); await settle(page);
              assert(await page.ev(`(()=>{const f=document.querySelector('.ob-foot'),p=f.querySelector('.btn-p');return document.activeElement===p && (${w}<600 ? f.firstElementChild===p : f.lastElementChild===p)})()`), `at ${w}: footer order or focus lost at the breakpoint`);
            }
          }
          if (step < 5) await next(page, `step ${step + 1}`);
        }
      });
      assert(page.errors.length === 0, page.errors.map(e => e.text).join(' | '));
    } finally { await page.close(); }
  }
  for (const width of [1280, 600, 390]) {
    const page = await open(width, width < 600 ? 844 : 900, 'en', { onboarding: null });
    try {
      await check(width, 'AL-S2 setup buttons', 'one 44 px button height on the steps and the done screen; no empty band above the done buttons; Skip\'s ring clears its hint', async () => {
        await page.waitFor(`({ok:document.querySelector('#onboarding').open,why:'setup'})`, 5000, 'setup');
        await settle(page);
        await page.key('Shift', 'ShiftLeft', 16);
        await page.ev(`document.querySelector('.skipwrap .btn').focus()`);
        const ring = await page.ev(`(()=>{const b=document.querySelector('.skipwrap .btn'),s=getComputedStyle(b),r=document.createRange();r.selectNodeContents(document.querySelector('.skipwrap small'));return {vis:b.matches(':focus-visible'),clear:r.getBoundingClientRect().top-(b.getBoundingClientRect().bottom+parseFloat(s.outlineOffset)+parseFloat(s.outlineWidth))}})()`);
        assert(ring.vis && ring.clear >= 0, `Skip's ring touches the hint: ${JSON.stringify(ring)}`);
        const heights = [];
        for (let step = 1; step <= 5; step++) { await settle(page); heights.push(...(await page.ev(foot)).heights); await next(page, `step ${step + 1}`); }
        await page.waitFor(`({ok:!!document.querySelector('.ob-done'),why:'no done screen'})`, 5000, 'done screen');
        await settle(page);
        const done = await page.ev(`(()=>{const d=document.querySelector('#onboarding'),last=[...d.querySelectorAll('.ob-done>*')].at(-1).getBoundingClientRect(),f=d.querySelector('.ob-foot').getBoundingClientRect();return {gap:f.top-last.bottom,heights:[...d.querySelectorAll('.ob-foot .btn')].map(n=>n.getBoundingClientRect().height)}})()`);
        await shoot(page, `setup-done-${width}`);
        assert([...heights, ...done.heights].every((h) => Math.abs(h - 44) <= 0.5), `button heights differ: ${JSON.stringify([heights, done.heights])}`);
        assert(done.gap <= 24, `empty band above the done buttons: ${done.gap}`);
      });
    } finally { await page.close(); }
  }

  // FAQ: the "+" on the first line's centre; from 600 px the footer heading on
  // the first question's line.
  for (const [width, lang] of [[1280, 'en'], [600, 'sk'], [390, 'en']]) {
    const page = await open(width, width < 600 ? 844 : 900, lang);
    try {
      await check(width, 'AL-F1 FAQ', `(${lang}): "+" centred on the question's first line${width >= 600 ? '; heading on the first question\'s line' : ''}`, async () => {
        // Use the empty list so rows still filling in cannot move the footer
        // out of the screenshot after scrolling to it.
        await openList(page);
        await page.ev(`document.querySelector('.foot').scrollIntoView({block:'start',behavior:'instant'})`);
        await settle(page);
        const m = await page.ev(`(()=>{const first=(n)=>{const r=document.createRange();r.selectNodeContents(n);return r.getClientRects()[0]};
          const qs=[...document.querySelectorAll('.faq summary')].map(s=>{const t=first(s.querySelector('span')),i=s.querySelector('.ic').getBoundingClientRect();return (i.top+i.bottom)/2-(t.top+t.bottom)/2});
          const h=first(document.querySelector('.foot h2 span')),q=first(document.querySelector('.faq summary span'));return {qs,head:h.top-q.top,visible:q.top>=0&&q.bottom<=innerHeight}})()`);
        assert(m.visible, 'the FAQ is outside the screenshot');
        await shoot(page, `faq-${width}-${lang}`);
        assert(m.qs.every((d) => Math.abs(d) <= 1), `icons off the line centre: ${m.qs}`);
        if (width >= 600) assert(Math.abs(m.head) <= 1, `heading and first question differ by ${m.head}`);
      });
    } finally { await page.close(); }
  }
}

// Review of PR 1 (CSS and accessibility fixes, 2026-11-07): reduced motion
// on the pseudo-elements "*" misses, the sheet's clipped focus ring, the tray
// over a landscape pick-list, 42 px Compare links and the count's empty gap.
async function runCssA11yFixes(base) {
  watchdog.refresh();
  const shots = '/tmp/ib-css-a11y/smoke';
  await mkdir(shots, { recursive: true });
  const COMPARE = 'ib-university-finder:compare:v1';
  const ready = `({ok:document.querySelector('#loading')?.hidden && !window.__oldPage,why:'page loading'})`;
  const open = async (query, width, height, { compare = [], touch = width < 600 || height <= 500 } = {}) => {
    const page = await openPage(base + query, width, height);
    await page.waitFor(ready, 15000, 'page');
    if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');localStorage.setItem(${JSON.stringify(COMPARE)},${JSON.stringify(JSON.stringify(compare))});window.__oldPage=true;location.reload()`);
    await page.waitFor(ready, 15000, 'reload');
    return page;
  };
  const settle = (page) => page.ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(q=>setTimeout(q,1500))]))))`);
  const shot = async (page, name) => {
    await settle(page);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${shots}/${name}.png`, Buffer.from(data, 'base64'));
  };
  const openSheet = async (page) => {
    await page.click(`document.querySelector('#f-more')`, 'Filters');
    await page.waitFor(`({ok:document.querySelector('#filter-sheet').open,why:'sheet'})`, 5000, 'sheet');
    await settle(page);
  };
  const { readSheets } = await import('../js/data.js');
  const data = readSheets(await readFile(join(root, 'data/universities.csv'), 'utf8'),
    await readFile(join(root, 'data/programmes.csv'), 'utf8'), new Date()).programmes;
  const ids = data.slice(0, 3).map((r) => r.id);

  // 1. Reduced motion reaches ::details-content (the sheet's lists grew for
  // 260 ms) and the slider thumbs in their shadow root (160 ms scale).
  {
    const page = await open('?ui=sk', 390, 844);
    try {
      await check('390/sk', 'RF1 reduced motion', 'the sheet\'s lists open at full height at once and the slider thumbs have no transition', async () => {
        await openSheet(page);
        const lists = `getComputedStyle(document.querySelector('#dd-subjects'),'::details-content').transitionDuration`;
        const moving = await page.ev(lists);
        assert(moving !== '0s', `control: without reduced motion the list should move, got ${moving}`);
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        try {
          assert(await page.ev(lists) === '0s', `::details-content transition ${await page.ev(lists)}`);
          const grow = await page.ev(`(async()=>{const d=document.querySelector('#dd-subjects');d.open=true;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const a=d.getBoundingClientRect().height;await new Promise(r=>setTimeout(r,400));const b=d.getBoundingClientRect().height;d.open=false;return [a,b]})()`);
          assert(Math.abs(grow[0] - grow[1]) <= 0.5, `the list still grows: ${grow}`);
          await page.ev(`document.querySelector('#dd-budget').open=true`);
          await page.send('DOM.enable'); await page.send('CSS.enable');
          const { root: doc } = await page.send('DOM.getDocument', { depth: -1, pierce: true });
          const thumbs = [];
          (function walk(n) { if (n.attributes?.includes('thumb')) thumbs.push(n.nodeId); for (const k of ['children', 'shadowRoots']) for (const c of n[k] || []) walk(c); })(doc);
          const times = [];
          for (const nodeId of thumbs) times.push((await page.send('CSS.getComputedStyleForNode', { nodeId })).computedStyle.find((x) => x.name === 'transition-duration')?.value);
          assert(times.length >= 2 && times.every((t) => t === '0s'), `slider thumbs: ${times}`);
        } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 2. Edit my answers sits 1 px from the sheet's scrolling edge; its focus
  // ring is drawn inside it, so none of it is cut off, and it does not move.
  for (const ui of ['sk', 'en']) {
    const page = await open(`?ui=${ui}`, 320, 844);
    try {
      await check(`320/${ui}`, 'RF2 sheet focus ring', 'Edit my answers: its whole focus ring is inside the sheet\'s scrolling edge', async () => {
        await openSheet(page);
        await page.key('Shift', 'ShiftLeft', 16);
        await page.ev(`document.querySelector('.sheet-b .sheet-edit').focus()`);
        const m = await page.ev(`(()=>{const e=document.querySelector('.sheet-b .sheet-edit'),s=getComputedStyle(e),b=document.querySelector('.sheet-b'),r=e.getBoundingClientRect(),reach=parseFloat(s.outlineOffset)+parseFloat(s.outlineWidth);
          return {fv:e.matches(':focus-visible'),style:s.outlineStyle,ring:[r.left-reach,r.right+reach],clip:[b.getBoundingClientRect().left+b.clientLeft,b.getBoundingClientRect().left+b.clientLeft+b.clientWidth],text:r.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft),edge:b.getBoundingClientRect().left+parseFloat(getComputedStyle(b).paddingLeft)}})()`);
        await shot(page, `sheet-focus-320-${ui}`);
        assert(m.fv && m.style !== 'none', `no focus ring: ${JSON.stringify(m)}`);
        assert(m.ring[0] >= m.clip[0] && m.ring[1] <= m.clip[1], `ring cut off: ${JSON.stringify(m)}`);
        assert(Math.abs(m.text - m.edge) <= 1, `the text moved off the sheet's edge: ${JSON.stringify(m)}`);
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 3. A phone on its side: the tray went over Budget's first field and over
  // Sort's list. It hides while a pick-list floats open and comes back after.
  for (const ui of ['sk', 'en']) {
    const page = await open(`?ui=${ui}`, 844, 390, { compare: ids.slice(0, 1) });
    try {
      await check(`844x390/${ui}`, 'RF3 landscape tray', 'Budget and Sort open with nothing over their first field; the tray hides meanwhile and comes back', async () => {
        await page.waitFor(`({ok:!document.querySelector('#cmp-tray').hidden,why:'no tray'})`, 5000, 'tray');
        for (const id of ['dd-budget', 'dd-sort']) {
          await page.click(`document.querySelector('#${id} summary')`, id);
          await page.waitFor(`({ok:document.querySelector('#${id}').open,why:'closed'})`, 5000, `${id} open`);
          await settle(page);
          const m = await page.ev(`(()=>{const d=document.querySelector('#${id}'),f=d.querySelector('.dropdown-panel :is(input:not([type=hidden]),select,label)'),r=f.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,Math.min(r.top+r.height/2,innerHeight-1));
            return {tray:document.querySelector('#cmp-tray').checkVisibility({opacityProperty:true,visibilityProperty:true}),first:[r.top,r.bottom],hit:!!hit&&d.contains(hit),has:document.body.classList.contains('has-tray')}})()`);
          await shot(page, `landscape-${id}-844-${ui}`);
          assert(!m.tray && !m.has, `tray still shown over ${id}: ${JSON.stringify(m)}`);
          assert(m.hit, `${id}'s first field is covered: ${JSON.stringify(m)}`);
          await page.click(`document.querySelector('#${id} summary')`, `${id} again`);
          await page.waitFor(`({ok:!document.querySelector('#${id}').open&&!document.querySelector('#cmp-tray').hidden&&document.body.classList.contains('has-tray'),why:'tray not back'})`, 5000, 'tray back');
        }
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 4. Compare's official links: 44 px tall with a coarse pointer (they were
  // 42: inline padding never counts), text where it was, icon on the last word.
  for (const [width, height] of [[1280, 900], [390, 844], [320, 844]]) {
    const page = await open('?ui=sk', width, height, { compare: ids, touch: true });
    try {
      await check(`${width}/sk`, 'RF4 compare link target', 'with a coarse pointer every official link is at least 44 px tall and a tap reaches 44 px of it; the text starts on the fact name\'s line', async () => {
        await page.ev(`(document.querySelector('#header-compare').offsetParent?document.querySelector('#header-compare'):document.querySelector('#cmp-tray-open')).click()`);
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
        await page.ev(`document.querySelector('.cmp-t .lnk').scrollIntoView({block:'center',behavior:'instant'})`);
        await settle(page);
        const m = await page.ev(`(()=>{const links=[...document.querySelectorAll('.cmp-t .lnk')];return {coarse:matchMedia('(pointer:coarse)').matches,links:links.map(l=>{l.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=l.getBoundingClientRect(),t=document.createRange();t.selectNodeContents(l);const line=t.getClientRects()[0];const th=l.closest('tr').querySelector('th'),h=document.createRange();h.selectNodeContents(th);
          const end=document.createRange();end.selectNodeContents(l.querySelector('.lnk-end').firstChild);const word=[...end.getClientRects()].at(-1),icon=l.querySelector('.ic').getBoundingClientRect();
          let hits=0;for(let y=Math.ceil(r.top);y<r.bottom;y++){const e=document.elementFromPoint(r.left+4,y+0.5);if(e&&(e===l||l.contains(e)))hits++}
          return {h:r.height,hits,line:line.top,th:h.getClientRects()[0].top,icon:Math.abs((icon.top+icon.bottom)/2-(word.top+word.bottom)/2)<=6&&icon.left>=word.right-1}})}})()`);
        await shot(page, `compare-links-${width}-sk`);
        assert(m.coarse && m.links.length === 3, JSON.stringify(m));
        for (const l of m.links) {
          // On phones the fact name sits just above the value and keeps the
          // top few pixels, so what is counted is the height a tap reaches.
          assert(l.h >= 44 && l.hits >= 44, `link target ${JSON.stringify(l)}`);
          assert(l.icon, `icon left its last word: ${JSON.stringify(l)}`);
          if (width >= 600) assert(Math.abs(l.line - l.th) <= 1, `text moved off the fact name's line: ${JSON.stringify(l)}`);
        }
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
  watchdog.refresh();

  // 5. Desktop Compare: the hidden count kept its width, so "Edit my answers"
  // sat after an empty gap. It now starts at the row's left edge.
  for (const ui of ['sk', 'en']) {
    const page = await open(`?ui=${ui}`, 1440, 900, { compare: ids });
    try {
      await check(`1440/${ui}`, 'RF5 compare count gap', 'while Compare is open the count takes no room and Edit my answers starts at the row\'s edge; closing brings the count back first', async () => {
        const at = `(()=>{const s=document.querySelector('.status'),c=document.querySelector('#result-count'),e=document.querySelector('.status .edit-answers');return {edge:s.getBoundingClientRect().left+parseFloat(getComputedStyle(s).paddingLeft),count:c.getBoundingClientRect().width,shown:c.checkVisibility(),edit:e.getBoundingClientRect().left}})()`;
        await page.click(`document.querySelector('#header-compare')`, 'Compare');
        await page.waitFor(`({ok:!document.querySelector('#compare').hidden,why:'compare not open'})`, 5000, 'compare');
        await page.ev('scrollTo(0,0)');
        const m = await page.ev(at);
        await shot(page, `compare-count-1440-${ui}`);
        assert(!m.shown && m.count === 0 && Math.abs(m.edit - m.edge) <= 1, JSON.stringify(m));
        await page.click(`document.querySelector('#cmp-close')`, 'Close compare');
        await page.waitFor(`({ok:document.querySelector('#compare').hidden,why:'still open'})`, 5000, 'closed');
        const back = await page.ev(at);
        assert(back.shown && back.count > 0 && Math.abs(back.edit - back.edge) > back.count, JSON.stringify(back));
      });
      assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
    } finally { await page.close(); }
  }
}

// On an iPhone Leon "couldn't scroll down" in Compare (2026-11-08). The
// table's sideways scroll box was also a vertical one: the phone tap padding of
// the "Official page" links in the last row reaches 2 px below the table, and
// overflow-x:auto makes overflow-y auto, so the box could scroll 2 px down.
// Nearly the whole phone screen is that table, and a vertical swipe that
// starts over it went to the box (Chrome: the first one moved it 2 px and the
// page not at all), never the page. Each swipe here starts with the box back
// at its top, so it is the first swipe on a fresh table every time.
async function runCompareTouchScroll(base) {
  watchdog.refresh();
  const page = await openPage(`${base}?ui=en`, 390, 844);
  const phone = (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 3, mobile: true,
    screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  // A real tap (touchstart, touchend, then the click), on the element's
  // middle, once it has stopped moving (the sheet slides in) and nothing else
  // lies there.
  const tap = async (elementJs, what) => {
    const spot = await page.waitFor(`(() => {
      const el = ${elementJs};
      if (!el) return { why: 'not in the page' };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!r.width || (hit !== el && !el.contains(hit))) return { why: 'covered by ' + hit?.className };
      const at = [x, y].map(Math.round).join(), stable = at === window.__tapAt;
      window.__tapAt = at;
      return { ok: stable, x, y, why: 'still moving' };
    })()`, 5000, what);
    await page.ev('window.__tapAt = undefined');
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: spot.x, y: spot.y }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // One upward swipe of 300 px from each spot after scrolling the page to the
  // top. It must move the page itself, by at least 100 px.
  const swipes = async (label) => {
    const spots = await page.ev(`(() => {
      scrollTo({ top: 0, behavior: 'instant' });
      const box = document.querySelector('#compare .cmp-scroll');
      box.scrollTop = 0;
      const mid = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; };
      const cell = [...box.querySelectorAll('tbody td')].find((td) => { const [, y] = mid(td); return y > 320 && y < 640; });
      return { table: cell && mid(cell), header: mid(box.querySelector('thead th.cmp-p')), page: [8, 420] };
    })()`);
    for (const [where, spot] of Object.entries(spots)) {
      assert(spot, `${label}: no table cell in the middle of the screen`);
      await page.ev(`scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('#compare .cmp-scroll').scrollTop = 0`);
      await page.send('Input.synthesizeScrollGesture', { x: spot[0], y: spot[1], xDistance: 0, yDistance: -300, gestureSourceType: 'touch', speed: 1200 }, 30000);
      const m = await page.ev(`new Promise((r) => setTimeout(() => r({ y: Math.round(scrollY), box: document.querySelector('#compare .cmp-scroll').scrollTop,
        html: getComputedStyle(document.documentElement).overflowY, body: getComputedStyle(document.body).overflowY }), 300))`);
      assert(m.y >= 100, `${label}, swipe over the ${where}: the page moved ${m.y} px (scroll box ${m.box} px, html ${m.html}, body ${m.body})`);
    }
    // The columns still swipe sideways.
    await page.ev(`scrollTo({ top: 0, behavior: 'instant' })`);
    await page.send('Input.synthesizeScrollGesture', { x: spots.table[0], y: spots.table[1], xDistance: -200, yDistance: 0, gestureSourceType: 'touch', speed: 1200 }, 30000);
    const left = await page.ev(`new Promise((r) => setTimeout(() => r(document.querySelector('#compare .cmp-scroll').scrollLeft), 600))`);
    assert(left > 0, `${label}: a sideways swipe over the table did not move the columns`);
    await page.ev(`document.querySelector('#compare .cmp-scroll').scrollLeft = 0`);
  };
  const openCompare = async () => {
    await tap(`document.querySelector('#cmp-tray-open')`, "the tray's Open");
    await page.waitFor(`({ok:!document.querySelector('#compare').hidden&&!!document.querySelector('#compare .cmp-scroll'),why:'compare not open'})`, 5000, 'Compare');
  };
  try {
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await phone(390, 844);
    await page.waitFor(`({ok:document.querySelector('#loading')?.hidden,why:'page loading'})`, 15000, 'page');
    await page.ev(`localStorage.setItem('ibuf.onboarding.v1','dismissed');window.__oldPage=true;location.reload()`);
    await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reloading'})`, 15000, 'reload');
    await check('390/touch', 'CMP touch scroll', 'swipes up over the Compare table, its header and the page scroll the page: after the Filters sheet, opened again, after rotating', async () => {
      for (let i = 0; i < 3; i++) {
        await tap(`document.querySelectorAll('#results>.item .cmpi')[${i}]`, `row ${i + 1}'s Compare`);
        await page.waitFor(`({ok:document.querySelectorAll('#results .cmpi[aria-pressed=true]').length===${i + 1},why:'not added'})`, 3000, `row ${i + 1} in Compare`);
      }
      // The phone filter form, Filters with it, hides while Compare is open,
      // so the sheet opens and closes first.
      await tap(`document.querySelector('#f-more')`, 'Filters');
      await page.waitFor(`({ok:document.querySelector('#filter-sheet').open,why:'sheet closed'})`, 3000, 'the sheet');
      await tap(`document.querySelector('#sheet-done')`, "the sheet's close");
      await page.waitFor(`({ok:!document.querySelector('#filter-sheet').open&&!document.querySelector('#cmp-tray').hidden,why:'sheet open or no tray'})`, 3000, 'the sheet closed');
      await openCompare();
      await swipes('after the Filters sheet, opened from the tray');
      await tap(`document.querySelector('#cmp-close')`, "Compare's Close");
      await page.waitFor(`({ok:document.querySelector('#compare').hidden,why:'still open'})`, 3000, 'Compare closed');
      await openCompare();
      await swipes('closed and opened again');
      await phone(844, 390);
      await page.ev('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 200)))');
      await phone(390, 844);
      await page.waitFor(`({ok:!document.querySelector('#compare').hidden&&innerWidth===390,why:innerWidth})`, 3000, 'back to portrait');
      await swipes('after rotating');
    });
    assert(!page.errors.length, page.errors.map((e) => e.text).join(' | '));
  } finally { await page.close(); }
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('SKIP smoke: Chrome not found (set CHROME=/path/to/chrome)');
    return REQUIRE_CHROME ? 2 : 0;
  }
  const started = Date.now();
  step = 'reading the data files';
  const want = await expectations();
  step = 'starting the server';
  const port = await startServer();
  const base = `http://127.0.0.1:${port}/`;
  step = 'starting Chrome';
  cdp = await connect(await startChrome(chromePath));
  console.log(`Chrome: ${chromePath}`);
  console.log(`Page:   ${base} — expecting ${want.total} programmes; search "${want.city}", country ${want.country}`);

  for (const [width, height] of WIDTHS) await runWidth(base, width, height, want);
  // A page that never started at any width would only spend another 30 s
  // failing the same way here.
  if (anyBooted) { await runFallback(base, want); await runI18n(base); await runRound2(base); await runReview2(base);
    await runBatch2A(base);
    await runBatch2B(base);
    await runBatch2C(base);
    await runBatch2Followup(base);
    await runBatch3A(base);
    await runBatch3B(base);
    await runBatch3C(base);
    await runAlignListCompare(base);
    await runAlignChromeSetup(base);
    await runPhoneMyListCompare(base);
    await runCompareHeaderR2(base);
    await runPrintFixes(base);
    await runCssA11yFixes(base);
    await runSetupCompareReview(base);
    await runPhoneFixes(base);
    await runCompareTouchScroll(base); }
  else for (const id of ['F1', 'F2']) report('SKIP', 'fallback', id, 'not run', 'the page never loaded');

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const ran = results.length - skipped;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failed) console.log(`Smoke test FAILED (${failed} of ${ran} checks${skipped ? `, ${skipped} not run` : ''}) in ${seconds} s`);
  else console.log(`Smoke test passed (${ran} checks) in ${seconds} s`);
  return failed ? 1 : 0;
}

let finishing = false;
async function finish(code, message) {
  if (finishing) return;
  finishing = true;
  if (message) console.log(message);
  clearTimeout(watchdog);
  await cleanup();
  if (KEEP && workDir) console.log(`Kept Chrome's profile and log in ${workDir}`);
  process.exit(code);
}

const watchdog = setTimeout(() => finish(1, `FAIL smoke: timed out in ${step}`), WATCHDOG_MS);
process.on('SIGINT', () => finish(130, 'Stopped (Ctrl-C); cleaning up.'));
process.on('SIGTERM', () => finish(143, 'Stopped; cleaning up.'));
process.on('uncaughtException', (err) => finish(1, `FAIL smoke: ${err.message} (during ${step})`));
process.on('unhandledRejection', (err) => finish(1, `FAIL smoke: ${err?.message ?? err} (during ${step})`));

main().then((code) => finish(code), (err) => finish(1, `FAIL smoke: ${err.message} (during ${step})`));
