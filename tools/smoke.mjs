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
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
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
  };
  const screenshot = async (path) => {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Math.min(6000, cssContentSize.height), scale: 1 } });
    await writeFile(path, Buffer.from(data, 'base64'));
  };
  return { ev, waitFor, click, key, type, clearField, errors, exceptions, close, screenshot };
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
const COUNT = `document.querySelector('#result-count b')?.textContent ?? ''`;
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
    await page.click(`document.querySelector('#f-points')`, 'the points box');
    await page.type('24');
    await page.waitFor(narrowed(T), 10_000, 'a narrowed count');
    const error = await page.ev(`document.querySelector('#f-points-error').textContent`);
    assert(error === '', `the points box says "${error}"`);
    await page.clearField();
    await page.waitFor(countIs(`${T} programmes`), 10_000, 'the full count after clearing');
  });

  // Max yearly cost and My living costs (js/cost.js). In the bar from 600 px;
  // on a phone they sit in the sheet, which A10 already proves opens. A budget
  // of €1 leaves only rows whose cost is unknown, each saying so; My living
  // costs 0 then brings back the rows with no fee (fee + 12 × 0 ≤ 1).
  if (!phone) {
    await check(at, 'A13', 'Max yearly cost keeps unknowns, My living costs replaces the estimate', async () => {
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
      assert(await page.ev(`localStorage.length === 0`), 'saves left over from an earlier check');
      const openRows = `document.querySelectorAll('#results li.item.is-open').length`;
      const openBefore = await page.ev(openRows);
      try {
      for (const id of [a, b]) {
        await page.click(star(id), `the star on ${id}`);
        await page.waitFor(`({ ok: ${star(id)}.getAttribute('aria-pressed') === 'true', why: 'star not pressed' })`, 5000, 'a pressed star');
      }
      await page.waitFor(`({ ok: document.querySelector('#shortlist-count-text').textContent === '2 saved · 2 shown', why: document.querySelector('#shortlist-count-text').textContent })`, 5000, '"2 saved · 2 shown"');
      assert(await page.ev(openRows) === openBefore, 'a star click opened or closed a row');
      await page.click(`document.querySelector('#f-shortlist-only')`, 'Open my list');
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
        if (document.querySelector('#ml-title')?.textContent !== 'Shared list') return { why: 'no shared view' };
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
  const page = await openPage(base, 1280, 900, { block: ['*/data/programmes.csv*'] });
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

  const both = await openPage(base, 1280, 900, { block: ['*/data/programmes.csv*', '*/data/fallback.json*'] });
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

// The interface table is intentionally English fallback for now. The data
// CSV already has Slovak, so exercise a real translated admission value and
// its original, plus both directions of the switch at desktop and phone.
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
          const pressed = detail.querySelector('.detail-originals')?.getAttribute('aria-pressed');
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

// --- Main -----------------------------------------------------------------------

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
  if (anyBooted) { await runFallback(base, want); await runI18n(base); }
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
