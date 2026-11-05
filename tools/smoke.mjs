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
    await check(at, 'A14', 'save two stars, open my list, compare them, and open the share link', async () => {
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
      await page.click(`document.querySelector('#ml-compare summary')`, 'Compare');
      for (const id of [a, b]) await page.click(`document.querySelector('#ml-picks input[value=' + JSON.stringify(${JSON.stringify('')} + ${JSON.stringify(id)}) + ']').closest('label')`, `the pick ${id}`);
      await page.click(`document.querySelector('#ml-compare-go')`, 'Compare 2');
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
        // The same-language switch forces a real detail re-render.
        await page.ev(`document.querySelector('[data-language="sk"]').click()`);
        result = await page.ev(status);
        assert(result.pressed === 'true' && result.allOn, 're-render lost original state');
        await page.screenshot(`/tmp/ib-i18n-v2/${width}-sk-on.png`);
        await page.ev(`document.querySelector('${button}').click()`);
        result = await page.ev(status);
        assert(result.pressed === 'false' && result.allOff, 'toggle did not hide every original after re-render');
        await page.ev(`document.querySelector('${button}').click()`);
        await page.ev(`document.querySelector('[data-language="en"]').click()`);
        assert(await page.ev(`document.documentElement.lang === 'en' && !!document.querySelector('${detail} .kv dd') && !document.querySelector('${detail} .detail-originals, ${detail} .data-original, ${detail} .english-note')`), 'EN switch lost detail or retained Slovak controls');
        await page.ev(`document.querySelector('[data-language="sk"]').click()`);
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
    const next = () => page.click(`document.querySelector('.ob-foot>.btn-p')`, 'the next onboarding step');
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
      await check(width,'R2J','setup stepper is centred; Skip text shares the Back/Next centre line and the hint edge',async()=>{
        await edit(); await next();
        const m=await page.ev(`(()=>{const box=(n)=>n.getBoundingClientRect(),text=(n)=>{const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect()};
          const step=box(document.querySelector('.ob-step.on')),btns=[...document.querySelectorAll('.big-pts>*')].map(box),skip=text(document.querySelector('.skipwrap button')),hint=text(document.querySelector('.skipwrap small')),next=box(document.querySelector('.ob-foot>.btn-p'));
          return {offCentre:(btns[0].left+btns.at(-1).right)/2-(step.left+step.right)/2,lift:(next.top+next.height/2)-(skip.top+skip.height/2),indent:skip.left-hint.left};})()`);
        assert(Math.abs(m.offCentre)<=1 && Math.abs(m.lift)<=1 && Math.abs(m.indent)<=1,`setup layout off: ${JSON.stringify(m)}`);
        await page.ev(`document.querySelector('#onboarding').dispatchEvent(new Event('cancel',{cancelable:true}))`);
      });
      await check(width,'R2M','the setup FAQ link dismisses setup without applying answers and lands on the FAQ below the sticky bar',async()=>{
        await page.ev(`window.scrollTo(0,0)`);
        await edit();
        await page.click(`document.querySelector('#onboarding .ob-faq')`,'the FAQ link');
        assert(await page.ev(`!document.querySelector('#onboarding').open && localStorage.getItem('ibuf.onboarding.v1')==='dismissed' && document.querySelector('#f-points').value===''`),'FAQ link applied answers or left setup open');
        assert(await page.ev(`document.activeElement===document.querySelector('#faq summary')`),'focus is not on the first FAQ question');
        await page.waitFor(`(()=>{const top=document.querySelector('#faq').getBoundingClientRect().top,bar=${width<600?"document.querySelector('.status').getBoundingClientRect().bottom":"document.querySelector('.hd').getBoundingClientRect().bottom"};return {ok:top>=bar-1 && top<innerHeight-40,why:JSON.stringify({top,bar})}})()`,5000,'the FAQ in view');
        await page.ev(`window.scrollTo(0,0)`);
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
        assert(await page.ev(content) && await page.ev(`getComputedStyle(document.querySelector('#dd-budget'),'::details-content').height`)==='0px','Budget row closes without its height motion');
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
          await page.ev(`document.querySelector('[data-language=sk]').click();window.scrollTo(0,0)`);
          await page.waitFor(`(()=>{const w=innerWidth,sw=document.documentElement.scrollWidth,display=getComputedStyle(document.querySelector('#f-mymaths')).display;return {ok:w===640 && sw===w && display!=='none',why:JSON.stringify({w,sw,display,dialogs:[...document.querySelectorAll('dialog[open]')].map(n=>n.id)})}})()`,5000,'zoomed controls');
          await page.click(`document.querySelector('#dd-languages summary')`,'zoomed language panel');
          await page.waitFor(`(()=>{const box=document.querySelector('#f-languages');return {ok:box.classList.contains('at-end')===(box.scrollTop+box.clientHeight>=box.scrollHeight-4),why:'fade cue disagrees with scroll extent'}})()`,5000,'fade cue');
          // Settled, as R2F: the height cap is set by the toggle event, which comes after the click.
          await page.waitFor(`(()=>{const panel=document.querySelector('#dd-languages .dropdown-panel'),r=panel.getBoundingClientRect();return {ok:document.querySelector('#dd-languages').open && !panel.getAnimations().some(a=>a.playState==='running') && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight,why:'zoomed facet escapes viewport: '+JSON.stringify({left:r.left,right:r.right,bottom:r.bottom})};})()`,5000,'zoomed facet inside viewport');
          await page.key('Escape','Escape',27);
        } finally {
          await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
          await page.ev(`document.querySelector('[data-language=en]').click()`);
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
        // Batch 3 B2 (Leon, 2026-11-05) edited this: Clear my list is now an
        // outlined button in the even grid, not quiet text that may sit alone
        // (it looked like an empty cell). The Compare picker, while it still
        // exists (workstream A removes it), takes its own full row.
        const m = await phone.ev(`(()=>{const box=(n)=>n.getBoundingClientRect();
          const all=[...document.querySelectorAll('#ml-tools>.btn,#ml-tools>.ml-pop>summary')].filter(n=>n.offsetParent);
          const tools=all.filter(n=>!n.closest('#ml-compare'));
          const rows=new Map();for(const n of tools){const r=box(n),k=Math.round(r.top);rows.set(k,[...(rows.get(k)||[]),n])}
          const plain=tools.map(n=>Math.round(box(n).width));
          const g=box(document.querySelector('#ml-group')),s=box(document.querySelector('#f-sort'));
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
    await page.ev(`document.querySelector('[data-language=${lang}]').click()`);
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
        await check(width, 'R4A', `logo (${lang}): a 36 px tile in a 44 px hit area that stays off Search`, async () => {
          const m = await page.ev(`(()=>{${hits}const box=(s)=>document.querySelector(s).getBoundingClientRect(),t=box('.mono'),k=box('.mark'),q=box('#f-search');
            return {tile:[t.width,t.height],mark:[k.width,k.height],left:k.left,over:hits(k,q),off:Math.abs((t.left+t.right)-(k.left+k.right))/2,offY:Math.abs((t.top+t.bottom)-(k.top+k.bottom))/2,sw:document.documentElement.scrollWidth,w:innerWidth,search:q.width}})()`);
          assert(m.tile[0] === 36 && m.tile[1] === 36, `tile ${m.tile}`);
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
          assert(!fine.coarse && fine.tile === 30, `fine pointer tile: ${JSON.stringify(fine)}`);
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
          assert(m.mark[0] >= 44 && m.mark[1] >= 44 && m.tile === 36, `sizes ${JSON.stringify(m)}`);
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
        const name = lang === 'sk' ? 'University Finder, späť na začiatok' : 'University Finder, back to top';
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
      await check(`${width}/${ui}`, 'R4G', 'Compare hint and CTA render with no note, real click pre-ticks, table fits', async () => {
        await page.ev(`localStorage.removeItem('ib-university-finder:shortlist:v1');localStorage.removeItem('ibuf.filters.v1')`);
        await navigate(`?ui=${ui}&sort=deadline`);
        await page.ev('window.scrollTo(0,0)');
        const bar = await page.ev(`({display:getComputedStyle(${el('shortlist-bar')}).display,note:${el('ml-note')}.hidden})`);
        assert(bar.display==='none' && bar.note,'empty list bar visible');
        if (width < 600) {
          // Batch 3 B1 (Leon, Q2): on a phone the main view shows no My list box,
          // so the hint and the button there are gone; Compare is reached inside
          // My list through the header until workstream A replaces the picker.
          const hiddenBar = `getComputedStyle(${el('shortlist-bar')}).display==='none' && ${el('ml-note')}.hidden`;
          await page.click(`document.querySelector('#results button.star')`,'first save');
          await page.ev(`window.scrollTo(0,0)`);
          assert(await page.ev(hiddenBar),'phone main bar shows with one save');
          await shot('main-1saved');
          await page.click(`document.querySelectorAll('#results button.star')[1]`,'second save');
          await page.ev(`window.scrollTo(0,0)`);
          assert(await page.ev(hiddenBar),'phone main bar shows with two saves');
          await page.click(el('header-list'),'header My list');
          await page.waitFor(rendered('#ml-compare > summary'),5000,'picker in My list');
          await page.click(`document.querySelector('#ml-compare > summary')`,'Compare picker');
          await page.waitFor(`({ok:${el('ml-compare')}.open && document.querySelectorAll('#ml-picks input').length===2,why:'picker not open'})`,5000,'Compare picks');
          for (const i of [0,1]) await page.click(`document.querySelectorAll('#ml-picks label')[${i}]`,`pick ${i+1}`);
          await page.click(el('ml-compare-go'),'Compare 2');
          await page.waitFor(`({ok:!${el('compare')}.hidden && document.querySelectorAll('#cmp-body th[scope=col]').length===2,why:'two-column comparison missing'})`,5000,'Compare table');
          assert(await page.ev('document.documentElement.scrollWidth===innerWidth'),'comparison overflows page');
          await page.click(el('cmp-close'),'Close comparison');
          await page.click(el('f-shortlist-only'),'Back to all programmes');
          await page.click(`document.querySelectorAll('#results button.star')[2]`,'third save');
          await page.ev('window.scrollTo(0,0)');
          assert(await page.ev(hiddenBar),'phone main bar shows with three saves');
          await page.click(el('header-list'),'header My list again');
          await page.waitFor(rendered('#ml-compare > summary'),5000,'picker with three');
          assert(await page.ev(`document.querySelector('#ml-compare > summary span').textContent===${JSON.stringify(text.r2_compare_n.replace('{count}','3'))}`),'wrong Compare (3)');
          await shot('compare-3');
        } else {
        await page.click(`document.querySelector('#results button.star')`,'first save');
        await page.ev(`window.scrollTo(0,0)`);
        await page.waitFor(rendered('#ml-compare-hint'),5000,'Compare hint');
        assert(await page.ev(`${el('ml-compare-hint')}.textContent===${JSON.stringify(text.r2_compare_hint)} && ${el('ml-note')}.hidden && getComputedStyle(${el('shortlist-bar')}).display!=='none'`),'hint or parent hidden');
        await shot('compare-hint-1');
        await page.click(`document.querySelectorAll('#results button.star')[1]`,'second save');
        await page.ev(`window.scrollTo(0,0)`);
        await page.waitFor(rendered('#ml-compare-open'),5000,'Compare CTA');
        const cta = await page.ev(`(()=>{const b=${el('ml-compare-open')},r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {text:b.textContent,hit:hit===b||b.contains(hit),note:${el('ml-note')}.hidden}})()`);
        assert(cta.hit && cta.note && cta.text===text.r2_compare_n.replace('{count}','2'),'CTA covered or wrong count');
        await page.click(el('ml-compare-open'),'Compare (2)');
        await page.waitFor(`({ok:${el('ml-compare')}.open && document.querySelectorAll('#ml-picks input:checked').length===2 && document.activeElement===document.querySelector('#ml-picks input'),why:'picker not open, ticked or focused'})`,5000,'Compare picks');
        await page.click(el('ml-compare-go'),'Compare 2');
        await page.waitFor(`({ok:!${el('compare')}.hidden && document.querySelectorAll('#cmp-body th[scope=col]').length===2,why:'two-column comparison missing'})`,5000,'Compare table');
        assert(await page.ev('document.documentElement.scrollWidth===innerWidth'),'comparison overflows page');
        await page.click(el('cmp-close'),'Close comparison');
        await page.click(el('f-shortlist-only'),'Back to all programmes');
        await page.click(`document.querySelectorAll('#results button.star')[2]`,'third save');
        await page.ev('window.scrollTo(0,0)');
        await page.waitFor(rendered('#ml-compare-open'),5000,'Compare (3)');
        assert(await page.ev(`${el('ml-compare-open')}.textContent===${JSON.stringify(text.r2_compare_n.replace('{count}','3'))}`),'wrong Compare (3)');
        await shot('compare-3');
        if (width===600) return;
        await page.click(el('f-shortlist-only'),'Open My list');
        }
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
      await check(`${width}/${ui}`,'R4F layout','copy label and Compare toolbar fit without horizontal scrolling',async()=>{
        await page.waitFor(`({ok:document.querySelector('#loading')?.hidden,why:'loading'})`,15000,'layout boot');
        await page.ev(`localStorage.setItem('ib-university-finder:shortlist:v1',JSON.stringify([...document.querySelectorAll('#results>li.item')].slice(0,3).map(n=>n.dataset.id)));window.__oldPage=true;location.reload()`);
        await page.waitFor(`({ok:document.querySelector('#loading')?.hidden&&!window.__oldPage,why:'reload'})`,15000,'layout saves');
        assert(await page.ev('document.documentElement.scrollWidth===innerWidth'),'page overflows');
        // Batch 3 B1: a phone's main view has no My list box, so no CTA to wait for.
        if(width>=600) await page.waitFor(rendered('#ml-compare-open'),5000,'layout CTA');
        else assert(await page.ev(`getComputedStyle(document.querySelector('#shortlist-bar')).display==='none'`),'phone main bar shows');
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
          await page.click(`document.querySelector('#f-shortlist-only')`,'My list for Share gutter');
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
        await page.ev(`document.querySelector('[data-language="${ui}"]').click();window.scrollTo(0,0)`);
        const detail = width >= 1200 ? '#pane .pane-body' : '#results>li.item .expand';
        await check(width, 'R4H', 'detail actions have equal widths and even gaps (' + ui + ')', async () => {
          await page.click(`document.querySelector('#results>li.item button.open')`, 'first programme');
          await page.waitFor(`({ok:!!document.querySelector('${detail} .d-actions'),why:'detail not open'})`, 5000, 'detail actions');
          const m = await page.ev(`(()=>{
            const group=document.querySelector('${detail} .d-actions');
            const buttons=[...group.children], boxes=buttons.map(n=>n.getBoundingClientRect());
            const [a,b]=boxes, side=Math.abs(a.top-b.top)<1;
            return {widths:Math.abs(a.width-b.width),heights:Math.abs(a.height-b.height),side,
              gap:side?b.left-a.right:b.top-a.bottom,aligned:Math.abs(a.left-b.left),
              minHeight:Math.min(a.height,b.height),overflow:buttons.some(n=>n.scrollWidth>n.clientWidth+1),
              order:buttons[0].matches('a.btn-p')&&buttons[1].matches('button.save'),
              separate:!group.querySelector('.lnk,.ok,.tag'),
              pageOverflow:document.documentElement.scrollWidth>innerWidth};
          })()`);
          assert(m.order && m.separate && m.widths <= 1 && m.minHeight >= 44 && !m.overflow && !m.pageOverflow, JSON.stringify(m));
          assert(m.gap >= 8 && m.gap <= 12 && (m.side ? m.heights <= 1 : m.aligned <= 1), JSON.stringify(m));
          if (width >= 1200) assert(!m.side, 'pane actions must stack');
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
      await page.ev(`document.querySelector('[data-language=${lang}]').click()`);
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
            assert(Math.abs(m.btn[1] - m.slot) <= 0.5 && m.btn[1] >= (coarse ? 44 : 36) && m.btn[2] >= (coarse ? 44 : 36), `button ${m.btn} in a ${m.slot} slot`);
            assert(m.badgeShown && m.badgeInside && m.badgeText === '2', `count badge: ${JSON.stringify(m)}`);
            // The label is hidden on purpose, not cut: it stays the button's name.
            // (The badge sticks out over the corner by design, so scrollWidth is no test.)
            assert(m.label[0] <= 1 && m.label[1] <= 1 && !m.iconCut, `label shows or icon cut: ${JSON.stringify(m)}`);
            assert(name.includes(lang === 'sk' ? 'Filtre' : 'Filters') && name.includes('2'), `accessible name "${name}"`);
            assert(Math.abs(m.search[0] - before[0]) < 0.5 && Math.abs(m.search[1] - before[1]) < 0.5, `Search moved: ${before} → ${m.search}`);
            assert(m.search[1] >= 200, `Search only ${m.search[1]} wide`);
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
async function runBatch3A(base) {
  watchdog.refresh();
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
          assert(m.clearBorder >= 1 && m.clearIcon > 0, `Clear my list not a bordered button: ${JSON.stringify(m)}`);
          assert(m.labels.length === 0, `labels overflow: ${m.labels}`);
          assert(m.sw === 0, `page overflows by ${m.sw}`);
        });
      }
      // Desktop is unchanged apart from the chevron: shown in the list, never in the main view.
      await check(`1280/${ui}`, 'B3B list toolbar', `${n} saved: desktop back button gains only the chevron`, async () => {
        await resize(page, 1280, 900);
        const list = await page.ev(`(()=>{const i=document.querySelector('#f-shortlist-only svg'),c=document.querySelector('#clear-shortlist');return {chev:i.getBoundingClientRect().width,clearIcon:c.querySelector('svg').getBoundingClientRect().width,clearBorder:getComputedStyle(c).borderTopColor}})()`);
        await page.click(`document.querySelector('#f-shortlist-only')`, 'Back to all programmes');
        await page.waitFor(`({ok:!document.querySelector('#shortlist-bar').classList.contains('is-list'),why:'still the list view'})`, 5000, 'the main view');
        const main = await page.ev(`document.querySelector('#f-shortlist-only svg').getBoundingClientRect().width`);
        assert(list.chev > 0 && main === 0, `chevron list ${list.chev}, main ${main}`);
        assert(list.clearIcon === 0 && list.clearBorder === 'rgba(0, 0, 0, 0)', `desktop Clear changed: ${JSON.stringify(list)}`);
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
        await page.click(`document.querySelector('#empty-back')`, 'Back to all programmes');
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
    await runBatch3C(base); }
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
