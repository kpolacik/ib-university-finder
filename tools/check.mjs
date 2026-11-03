// Checks the parts of this site that are easy to break by accident.
//
//   node tools/check.mjs
//
// Run it after changing anything in js/, and after a big edit to the Sheet.
// It needs no libraries — just Node. Every check prints ok or FAIL, and the
// script exits non-zero if anything failed.

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const { parseCsv, csvToObjects } = await import(new URL('../js/csv.js', import.meta.url));
const i18n = await import('../js/i18n.js');
const { UI, t } = i18n;
i18n.initLanguage('', { getItem: () => 'en' });
// Older source assertions read an EN view of literal t() calls. The real
// modules and the app harness below still execute the untranslated source.
const englishSource = (source) => source.replace(/t\('([^']+)'\)/g, (call, key) =>
  typeof UI.en[key] === 'string' ? JSON.stringify(UI.en[key]).replace(/^"|"$/g, "'") : call);
const englishHtml = (source) => source.replace(/ data-active-label="[^"]*"/g, '').replace(/ data-i18n(?:-attr)?="[^"]*"/g, '');
const appSrcEarly = englishSource(readFileSync(join(root, 'js/app.js'), 'utf8'));
const { safeUrl, applyToday: applyTodayEarly } = await import(new URL('../js/data.js', import.meta.url));

let failures = 0;
const section = (name) => console.log(`\n${name}`);
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const equal = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`);

// A tiny stand-in for the DOM: only the operations js/render.js uses, so the
// renderers can run here with no browser or DOM package. Text nodes are plain
// strings (not counted by childElementCount), and appending a node that already
// has a parent moves it, as the real DOM does.
class ChromeNode {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.hidden = false; this.attributes = {};
    this.className = ''; this.parent = null; this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 300;
    this.listeners = {}; this.value = ''; this.validity = { badInput: false };
  }
  set textContent(text) { this.replaceChildren(String(text)); }
  get textContent() { return this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  get childElementCount() { return this.children.filter((c) => typeof c !== 'string').length; }
  get parentElement() { return this.parent; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  // A move takes the node out of its old parent first, as the real DOM does.
  // The harness can hook a move (a focused node loses focus when moved in Chrome).
  insertBefore(node, ref) {
    if (typeof node !== 'string') {
      if (node.parent) {
        stubDocument.moved?.(node);
        node.parent.children = node.parent.children.filter((c) => c !== node);
      }
      node.parent = this;
    }
    const at = ref ? this.children.indexOf(ref) : -1;
    if (ref && at < 0) throw new Error('insertBefore: reference is not a child');
    if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
    return node;
  }
  replaceChildren(...nodes) {
    for (const c of this.children) if (typeof c !== 'string') c.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) {
    if (name === 'class') this.className = String(value); else this.attributes[name] = String(value);
  }
  getAttribute(name) { return name === 'class' ? this.className : (this.attributes[name] ?? null); }
  removeAttribute(name) { delete this.attributes[name]; }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])); }
  contains(node) { return node === this || this.children.some((c) => typeof c !== 'string' && c.contains(node)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  // Compound selectors (tag, #id, every .class, every [attr]) joined by
  // descendant spaces, with comma lists. Enough for the selectors app.js uses.
  matches(selector) {
    const compound = (node, part) => {
      const tag = part.match(/^[a-z][a-z0-9-]*/)?.[0], id = part.match(/#([\w-]+)/)?.[1];
      const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const attrs = [...part.matchAll(/\[([\w-]+)(?:="?([^"\]]+)"?)?\]/g)];
      return (!tag || node.tagName === tag) && (!id || node.id === id) && classes.every((c) => node.classList.contains(c))
        && attrs.every((a) => node.getAttribute(a[1]) !== null && (!a[2] || node.getAttribute(a[1]) === a[2]));
    };
    return selector.split(',').some((one) => {
      const parts = one.trim().split(/\s+/);
      if (!compound(this, parts.at(-1))) return false;
      let i = parts.length - 2;
      for (let node = this.parent; node && i >= 0; node = node.parent) if (compound(node, parts[i])) i--;
      return i < 0;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  querySelectorAll(selector) { return [...nodesOf(this)].slice(1).filter((n) => n.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  // The harness may say what CSS has hidden; focusing a hidden node does nothing.
  focus(options) {
    if (stubDocument.canFocus && !stubDocument.canFocus(this)) return;
    stubDocument.activeElement = this; stubDocument.focusOptions = options;
    stubDocument.focusLog?.push({ node: this, options });
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatchEvent(event) { return dispatchStub(this, event); }
  getBoundingClientRect() { return this.rect ?? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  scrollIntoView(options) { (stubDocument.scrolls ??= []).push({ node: this, options, selected: this.classList.contains('is-sel') }); }
  // <dialog>: close() puts focus back on what had it before showModal() and
  // queues the close event, so it can run after a reopen.
  showModal() {
    if (this.open) throw new Error('InvalidStateError: the dialog is already open');
    this.open = true; this.returnTo = stubDocument.activeElement;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    const back = this.returnTo; this.returnTo = null;
    if (this.contains(stubDocument.activeElement) || stubDocument.activeElement === stubDocument.body) {
      stubDocument.activeElement = stubDocument.body; back?.focus();
    }
    stubDocument.queueTask?.(() => dispatchStub(this, { type: 'close', bubbles: false }));
  }
  get nextElementSibling() { const a = this.parent?.children.filter((c) => typeof c !== 'string') ?? []; return a[a.indexOf(this) + 1] ?? null; }
  get previousElementSibling() { const a = this.parent?.children.filter((c) => typeof c !== 'string') ?? []; return a[a.indexOf(this) - 1] ?? null; }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (...add) => { this.className = [...new Set([...names(), ...add])].join(' '); },
      contains: (name) => names().includes(name),
      remove: (...remove) => { this.className = names().filter((n) => !remove.includes(n)).join(' '); },
      toggle: (name, force = !names().includes(name)) => {
        this.className = (force ? [...new Set([...names(), name])] : names().filter((n) => n !== name)).join(' ');
        return force;
      },
    };
  }
}
// Bubbles from the target through its parents, then to the document.
function dispatchStub(target, init) {
  const event = { bubbles: true, defaultPrevented: false, ...init, target,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (let node = target; node; node = node.parent) {
    for (const fn of [...(node.listeners?.[event.type] ?? [])]) { event.currentTarget = node; fn(event); }
    if (event.stopped || !event.bubbles) return !event.defaultPrevented;
  }
  for (const fn of [...(stubDocument.listeners?.[event.type] ?? [])]) { event.currentTarget = stubDocument; fn(event); }
  return !event.defaultPrevented;
}
const stubDocument = {
  createElement: (tag) => new ChromeNode(tag),
  createElementNS: (ns, tag) => new ChromeNode(tag),
  createTextNode: (text) => String(text),
  addEventListener(type, fn) { ((this.listeners ??= {})[type] ??= []).push(fn); },
  removeEventListener(type, fn) { if (this.listeners?.[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn); },
};
// Installs the stand-in only while fn runs, then puts back whatever was there.
function withStubDocument(fn) {
  const original = globalThis.document;
  globalThis.document = stubDocument;
  try { return fn(); } finally {
    if (original === undefined) delete globalThis.document; else globalThis.document = original;
  }
}
const { renderDetail, renderRows, appendRows, renderSlot, renderCount, renderPane, renderCountShort, renderChips, renderAppliedChips, renderSortOptions, setSaved, renderCompare } = await import(new URL('../js/render.js', import.meta.url));
// My list (2026-11-03): the pure share, group and compare functions app.js
// imports, given to the harness below like the filter functions.
const shortlistMod = await import(new URL('../js/shortlist.js', import.meta.url));
const compareMod = await import(new URL('../js/compare.js', import.meta.url));
const { createFilterState: noFilters } = await import(new URL('../js/filters.js', import.meta.url));
const detailOf = (row, state = noFilters()) => withStubDocument(() => renderDetail(row, state));
function* nodesOf(node) {
  yield node;
  for (const c of node.children) if (typeof c !== 'string') yield* nodesOf(c);
}
const findAll = (root, test) => [...nodesOf(root)].filter(test);
const byClass = (root, name) => findAll(root, (n) => n.classList.contains(name));
const byTag = (root, tag) => findAll(root, (n) => n.tagName === tag);
// Every dt label with its dd, across both lists of a detail.
const kvOf = (article) => {
  const out = {};
  for (const dl of byClass(article, 'kv')) {
    for (let i = 0; i < dl.children.length; i += 2) out[dl.children[i].textContent] = dl.children[i + 1];
  }
  return out;
};

// Loads the data layer against whatever CSV text you give it. The stub fetch
// also serves a snapshot (the fallback path), and can leave chosen URLs
// unanswered: such a request settles only when its signal aborts, the way a
// real fetch does on a timeout, so a loader without a timeout never finishes.
//   snapshot        object served as data/fallback.json (none: a 404 HTML page)
//   snapshotStatus  HTTP status for the snapshot
//   hang            URL fragments that never answer
//   timeoutMs       passed to loadData, so a hang test takes milliseconds
async function load(universities, programmes, today = new Date('2026-08-14'),
  { snapshot = null, snapshotStatus = 200, hang = [], timeoutMs } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (hang.some((h) => u.includes(h))) {
      return new Promise((_, reject) => {
        if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')));
      });
    }
    if (u.includes('fallback.json')) {
      const ok = Boolean(snapshot) && snapshotStatus === 200;
      return {
        ok,
        status: snapshot ? snapshotStatus : 404,
        // A server's error page is HTML, so reading it as JSON gives a parse
        // error, which is what used to reach the banner.
        json: async () => { if (!ok) throw new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON'); return snapshot; },
      };
    }
    return { ok: true, status: 200, text: async () => (u.includes('universities') ? universities : programmes) };
  };
  // A fresh query string dodges the module cache between fixtures.
  const { loadData } = await import(new URL(`../js/data.js?t=${Math.random()}`, import.meta.url));
  return timeoutMs === undefined ? loadData(today) : loadData(today, { timeoutMs });
}

const sheetsModule = await import(new URL('../js/data.js', import.meta.url));
check('readSheets exposes the same validation as the browser loader', typeof sheetsModule.readSheets === 'function');

// ---------------------------------------------------------------- CSV parsing

section('CSV parsing');
equal('plain rows', parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
equal('comma inside quotes', parseCsv('a,b\n"x, y",2'), [['a', 'b'], ['x, y', '2']]);
equal('escaped quote', parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
equal('newline inside quotes', parseCsv('a,b\n"l1\nl2",2'), [['a', 'b'], ['l1\nl2', '2']]);
equal('CRLF line endings', parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
equal('leading byte order mark', parseCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]);
equal('empty field', parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
equal('trailing newline', parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
equal('blank line mid-file', parseCsv('a,b\n1,2\n\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);

const broken = csvToObjects('id,name,note\n1,Delft,fine\n2,"stray quote,oops\n', 'Test');
check('a malformed row is skipped, not guessed at', broken.rows.length === 1 && broken.issues.length === 1,
  JSON.stringify(broken));

// ---------------------------------------------------------------- links

section('Link safety (official_url is typed by hand into a public Sheet)');
check('https allowed', safeUrl('https://tudelft.nl') === 'https://tudelft.nl/');
check('javascript: rejected', safeUrl('javascript:alert(1)') === null);
check('mixed-case javascript: rejected', safeUrl('JaVaScRiPt:alert(1)') === null);
check('data: rejected', safeUrl('data:text/html,<script>') === null);
check('bare domain rejected', safeUrl('tudelft.nl') === null);
check('blank rejected', safeUrl('   ') === null);
// X01: the part before "@" is a user name, so this link goes to evil.example.
check('a link with a user name or password is rejected (https://www.ucd.ie@evil.example/)',
  [safeUrl('https://www.ucd.ie@evil.example/'), safeUrl('https://a@b.example/'), safeUrl('https://user:pw@example.org/')]
    .every((v) => v === null));

// ---------------------------------------------- inherit / override / unknown

section('University defaults, programme overrides, and "?"');
const uni = 'university_id,name,city,country,application_system,living_cost_monthly,tuition_eu_default,tuition_noneu_default,english_requirement_default,student_life_url,last_verified,verified_by\n'
  + 'u,Test University,Hometown,Testland,direct,800,2694,18000,IELTS 6.0,,2026-08-14,TT\n';
const head = 'programme_id,university_id,city,programme,degree_type,subject_area,language,ib_points_min,ib_subjects,other_requirements,tuition_eu,tuition_noneu,english_requirement,application_deadline,deadline_notes,official_url,last_verified,verified_by';
const prog = [
  head,
  'p-inherit,u,,Inherits,BSc,Engineering,English,,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT',
  'p-override,u,Faraway,Overrides,BSc,Engineering,English,,HL Maths,,5800,20000,IELTS 7.0,2027-05-01,,https://example.org,2026-08-14,TT',
  'p-unknown,u,,Unknown,BSc,Engineering,English,,HL Maths,,?,?,?,2027-05-01,,https://example.org,2026-08-14,TT',
  'p-none,u,,No subjects,BSc,Engineering,English,,none,,,,,2027-05-01,,https://example.org,2026-08-14,TT',
  'p-bullets,u,,Bulleted english,BSc,Engineering,English,,HL Maths,,,,IELTS 6.5 · or English B HL 6,2027-05-01,,https://example.org,2026-08-14,TT',
  'p-unknown-city,u,?,Unknown city,BSc,Engineering,English,,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';

const { programmes: over, meta: overMeta } = await load(uni, prog);
const row = (id) => over.find((p) => p.id === id);
check('fixture parses cleanly', overMeta.issues.length === 0, JSON.stringify(overMeta.issues));
check('blank city inherits the university city', row('p-inherit').city === 'Hometown');
check('blank tuition inherits the university fee', row('p-inherit').tuitionEu === 2694);
equal('blank english inherits the university default', row('p-inherit').englishRequirement, ['IELTS 6.0']);
check('own city wins', row('p-override').city === 'Faraway');
check('own tuition wins', row('p-override').tuitionEu === 5800);
check('"?" tuition does not inherit', row('p-unknown').tuitionEu === null);
check('"?" is never read as zero', row('p-unknown').tuitionEu !== 0);
equal('"?" english does not inherit', row('p-unknown').englishRequirement, []);
equal('a bulleted english requirement splits into parts',
  row('p-bullets').englishRequirement, ['IELTS 6.5', 'or English B HL 6']);
check('"?" city does not inherit either', row('p-unknown-city').city === '');
check('the old single living-cost column still reads as one figure',
  row('p-inherit').livingCostMin === 800 && row('p-inherit').livingCostMax === 800);

section('Living costs are a range with a source');
const rangeUni = 'university_id,name,city,country,application_system,living_cost_min,living_cost_max,living_cost_source,last_verified,verified_by\n'
  + 'r,Range U,Town,Testland,direct,900,1200,university\'s estimate,2026-08-14,TT\n'
  + 's,Single U,Town,Testland,direct,1000,,national estimate,2026-08-14,TT\n'
  + 'b,Backwards U,Town,Testland,direct,1200,900,,2026-08-14,TT\n'
  + 'n,No Cost U,Town,Testland,direct,,,,2026-08-14,TT\n';
const rangeProg = [head, ...['r', 's', 'b', 'n'].map((u) =>
  `p-${u},${u},,P,BSc,Engineering,English,,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT`)].join('\n') + '\n';
const { programmes: ranged, meta: rangedMeta } = await load(rangeUni, rangeProg);
const rr = (id) => ranged.find((p) => p.id === id);
check('a range keeps both ends', rr('p-r').livingCostMin === 900 && rr('p-r').livingCostMax === 1200);
check('the source travels with it', rr('p-r').livingCostSource === 'university\'s estimate');
check('a single figure is min = max', rr('p-s').livingCostMin === 1000 && rr('p-s').livingCostMax === 1000);
check('a backwards range is swapped and reported',
  rr('p-b').livingCostMin === 900 && rr('p-b').livingCostMax === 1200 && rangedMeta.issues.some((i) => /swapped/.test(i)));
check('blank stays unknown, never zero', rr('p-n').livingCostMin === null && rr('p-n').livingCostMax === null);
check('"none" means no subjects required', row('p-none').noSubjectsRequired === true);
check('blank subjects means NOT CHECKED, not none',
  row('p-inherit').noSubjectsRequired === false && row('p-unknown').noSubjectsRequired === false);

// ------------------------------------------------------------- admission

section('Admission: university default, own value, and "?"');
const uniA = [
  'university_id,name,city,country,admission_default,last_verified,verified_by',
  'a,Points University,Town,Testland,Places go by points,2026-08-14,TT',
].join('\n') + '\n';
const progA = [
  'programme_id,university_id,programme,admission,application_deadline,official_url,last_verified,verified_by',
  'a-inherit,a,Inherits,,,https://example.org,2026-08-14,TT',
  'a-own,a,Own,Entrance exam · Can be waived,,https://example.org,2026-08-14,TT',
  'a-unknown,a,Unknown,?,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: adm } = await load(uniA, progA);
const admOf = (id) => adm.find((p) => p.id === id).admission;
equal('blank admission inherits the university default', admOf('a-inherit'), ['Places go by points']);
equal('own admission wins and splits on the bullet', admOf('a-own'), ['Entrance exam', 'Can be waived']);
equal('"?" admission does not inherit', admOf('a-unknown'), []);
// R02: a "?" admission used to vanish from the card, so a route that exists but
// is unpublished read as "no route at all". The loader now says it is unknown.
const admUnknownOf = (id) => adm.find((p) => p.id === id).admissionUnknown;
check('"?" admission is flagged as unknown', admUnknownOf('a-unknown') === true);
check('blank and own admission are not flagged as unknown',
  admUnknownOf('a-inherit') === false && admUnknownOf('a-own') === false);
const renderSrc = englishSource(read('js/render.js'));
check('the card shows "Not published" for an unknown admission route',
  /nothingAtAll[\s\S]{0,400}!row\.admissionUnknown/.test(renderSrc)
    && /else if \(row\.admissionUnknown\)[\s\S]{0,400}'Not published'/.test(renderSrc));
{
  const dd = kvOf(detailOf(adm.find((p) => p.id === 'a-unknown'))).Admission;
  check('the detail\'s Admission row is a "Not published" tag for a "?" route',
    Boolean(dd) && dd.textContent === 'Not published' && byClass(dd, 'unk-t').length === 1);
}

// ------------------------------------------------------------ honest cards

section('Cards say what is unknown instead of leaving it out');
const uniH = [
  'university_id,name,city,country,english_requirement_default,baseline_requirement,last_verified,verified_by',
  'h,Card University,Town,Testland,,a recognised school diploma,2026-08-14,TT',
  'h2,Unsigned University,Town,Testland,,,2026-08-14,',
].join('\n') + '\n';
const progH = [
  'programme_id,university_id,city,programme,english_requirement,application_deadline,official_url,last_verified,verified_by',
  'h-blank,h,,Blank english,,,https://example.org,2026-08-14,TT',
  'h-q,h,,Unknown english,?,,https://example.org,2026-08-14,TT',
  'h-city,h,?,Unknown city,,,https://example.org,2026-08-14,TT',
  'h-nosign,h,,No signer,,,https://example.org,2026-08-14,',
  'h-draft,h,,Draft,,,https://example.org,2026-08-14,AI-DRAFT',
  'h-uni-blank,h2,,University unsigned,,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: hc, meta: hcMeta } = await load(uniH, progH);
const hcRow = (id) => hc.find((p) => p.id === id);
// R01: a blank language requirement used to drop the Language row entirely.
check('blank english (no default) is empty and not flagged unknown',
  hcRow('h-blank').englishRequirement.length === 0 && hcRow('h-blank').englishUnknown === false);
check('"?" english is flagged as unknown', hcRow('h-q').englishUnknown === true);
// Redesign stage 2: the row is "Language requirement" and the tag .unk-t, so
// this renders the two rows rather than matching the old source text.
equal('the detail always has an Language requirement row: "Not checked yet", or "Not published" for "?"',
  ['h-blank', 'h-q'].map((id) => {
    const dd = kvOf(detailOf(hcRow(id)))['Language requirement'];
    return dd && byClass(dd, 'unk-t').length === 1 ? dd.textContent : null;
  }), ['Not checked yet', 'Not published']);
// R04: a "?" city showed only the country.
check('"?" city is flagged as unknown, blank is not',
  hcRow('h-city').cityUnknown === true && hcRow('h-blank').cityUnknown === false);
check('the card says "City not published" for a "?" city',
  /row\.cityUnknown \? 'City not published'/.test(renderSrc));
equal('the detail\'s place line says "City not published" for a "?" city',
  byClass(detailOf(hcRow('h-city')), 'd-place')[0]?.textContent, 'Card University · City not published, Testland');
// R03: the university baseline only appeared inside nothingAtAll.
check('the baseline reaches every programme of its university',
  hcRow('h-blank').baselineRequirement === 'a recognised school diploma');
// The anchor must exist, or a missing one (index -1) would pass.
const kvAnchor = renderSrc.indexOf("const list = el('dl', 'kv')");
check('the card shows a General row outside nothingAtAll',
  kvAnchor >= 0 && renderSrc.indexOf("reqRow(list, 'General requirement'") > kvAnchor);
equal('the detail shows the baseline as General, first letter capitalised',
  kvOf(detailOf(hcRow('h-blank')))['General requirement']?.textContent, 'A recognised school diploma');
// T04: a blank signer read as "Checked <date>" with no name. T01 (Q14 = A,
// 2026-10-26): the programme's own signature is what counts, so a signed
// programme under an unsigned university is checked.
equal('a row is checked when its own signer is set and not AI-DRAFT',
  ['h-blank', 'h-nosign', 'h-draft', 'h-uni-blank'].map((id) => hcRow(id).isChecked), [true, false, false, true]);
check('a blank verified_by is reported, on either tab',
  hcMeta.issues.filter((i) => /verified_by is blank/.test(i)).length === 2
    && hcMeta.issues.some((i) => /^Universities row 3: verified_by is blank/.test(i))
    && hcMeta.issues.some((i) => /^Programmes row 5: verified_by is blank/.test(i)), JSON.stringify(hcMeta.issues));
check('an unsigned row keeps the research banner up (draftCount counts it)', hcMeta.draftCount === 2,
  `draftCount ${hcMeta.draftCount}`);
// T01: every university row is AI-DRAFT, so needing both signatures meant a
// programme sign-off never showed. The "Checked" line's date and name come
// from the programme row alone, so the university's AI-DRAFT and its older
// date cannot leak into it.
const uniT = [
  'university_id,name,city,country,last_verified,verified_by',
  't,Draft University,Town,Testland,2025-01-01,AI-DRAFT',
  's,Sample University,Town,Testland,2026-08-14,SAMPLE',
].join('\n') + '\n';
const progT = [
  'programme_id,university_id,programme,application_deadline,official_url,last_verified,verified_by',
  't-signed,t,Signed programme,,https://example.org,2026-08-14,JK',
  't-draft,t,Draft programme,,https://example.org,2026-08-14,AI-DRAFT',
  's-signed,s,Signed under a sample university,,https://example.org,2026-08-14,JK',
].join('\n') + '\n';
const { programmes: signRows } = await load(uniT, progT);
const tRow = (id) => signRows.find((p) => p.id === id);
check('a signed programme under an AI-DRAFT university is checked', tRow('t-signed').isChecked === true);
equal('its Checked line uses the programme\'s own signer and date',
  [tRow('t-signed').verifiedBy, tRow('t-signed').lastVerified && tRow('t-signed').lastVerified.toISOString().slice(0, 10)],
  ['JK', '2026-08-14']);
check('the university\'s older date does not make it look out of date',
  (applyTodayEarly(signRows, new Date('2026-09-01')), tRow('t-signed').isStale === false));
check('an AI-DRAFT programme stays unchecked, and a SAMPLE university still marks its rows as samples',
  tRow('t-draft').isChecked === false && tRow('s-signed').isSample === true && tRow('s-signed').isChecked === false);
// Verify Impl: the university's date no longer fills in, so a signed programme
// with no date of its own is checked but shows no line. It is reported instead.
const progNoDate = [
  'programme_id,university_id,programme,application_deadline,official_url,last_verified,verified_by',
  'n-signed,t,Signed without a date,,https://example.org,,JK',
  'n-draft,t,Draft without a date,,https://example.org,,AI-DRAFT',
  'n-dated,t,Signed with a date,,https://example.org,2026-08-14,JK',
].join('\n') + '\n';
const { programmes: noDateRows, meta: noDateMeta } = await load(uniT, progNoDate);
const noDateIssues = noDateMeta.issues.filter((i) => /last_verified is blank/.test(i));
check('a signed programme with no last_verified is reported; a draft or a dated one is not',
  noDateIssues.length === 1 && /^Programmes row 2: /.test(noDateIssues[0]), JSON.stringify(noDateMeta.issues));
check('the provenance line uses isChecked, not the old AI-DRAFT-only test',
  renderSrc.includes('row.isChecked && row.lastVerified') && !renderSrc.includes('needsHumanCheck'));
// A01: dimmed past-deadline cards fell below readable contrast. Redesign
// stage 2 moved it to the detail: no rule on a passed article or cell sets
// opacity, and a passed row's article and cell carry the classes and words.
const css = read('css/styles.css');
const renderDetailSrc = renderSrc.slice(renderSrc.indexOf('export function renderDetail'),
  renderSrc.indexOf('\nfunction pointsCell'));
const { programmes: pastRows } = await load(uniT, 'programme_id,university_id,programme,application_deadline,official_url,last_verified,verified_by\n'
  + 'p-past,t,Past programme,2026-03-31,https://example.org,2026-08-14,AI-DRAFT\n');
const pastDetail = detailOf(pastRows[0]);
const dimmingRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel, body]) => /is-past|v-past/.test(sel) && /opacity/.test(body)).map(([, sel]) => sel.trim());
check('past-deadline details are not dimmed',
  dimmingRules.length === 0 && renderDetailSrc.includes("classList.add('is-past')")
    && pastDetail.classList.contains('is-past') && byClass(pastDetail, 'c-ddl')[0]?.classList.contains('v-past')
    && byClass(pastDetail, 'c-ddl')[0]?.textContent.includes('Passed, check next cycle'), dimmingRules.join(', '));

// ------------------------------------------------------ application system

// Bocconi's World Bachelor applies through the Common App, not Bocconi's own
// portal, but "Apply via" used to come only from the university row (D01).
section('Application system: programme value, blank inherits, "?"');
const uniS = [
  'university_id,name,city,country,application_system,last_verified,verified_by',
  's,Portal University,Town,Testland,Own portal,2026-08-14,TT',
].join('\n') + '\n';
const progS = [
  'programme_id,university_id,programme,application_system,application_deadline,official_url,last_verified,verified_by',
  's-inherit,s,Inherits,,,https://example.org,2026-08-14,TT',
  's-own,s,Own,Common App,,https://example.org,2026-08-14,TT',
  's-unknown,s,Unknown,?,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: sys, meta: sysMeta } = await load(uniS, progS);
const sysOf = (id) => sys.find((p) => p.id === id).applicationSystem;
check('fixture parses cleanly', sysMeta.issues.length === 0, JSON.stringify(sysMeta.issues));
equal('blank application system inherits the university value', sysOf('s-inherit'), 'Own portal');
equal('own application system wins', sysOf('s-own'), 'Common App');
equal('"?" application system does not inherit', sysOf('s-unknown'), '');
// An old CSV, the snapshot or a Sheet without the column must still load.
const progNoCol = [
  'programme_id,university_id,programme,application_deadline,official_url,last_verified,verified_by',
  's-old,s,Old file,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: noCol } = await load(uniS, progNoCol);
equal('a programmes CSV with no application_system column still inherits',
  noCol[0] && noCol[0].applicationSystem, 'Own portal');

// ------------------------------------------------------------- maths filter

section('ib_maths: accepted courses, "none", unknown, and the filter');
const progM = [
  'programme_id,university_id,programme,ib_maths,application_deadline,official_url,last_verified,verified_by',
  'm-aa,a,AA HL only,AA HL,,https://example.org,2026-08-14,TT',
  'm-three,a,Three,AA HL · AA SL · AI HL,,https://example.org,2026-08-14,TT',
  'm-none,a,No maths,none,,https://example.org,2026-08-14,TT',
  'm-blank,a,Not checked,,,https://example.org,2026-08-14,TT',
  'm-q,a,Unknown,?,,https://example.org,2026-08-14,TT',
  'm-bad,a,Typo,AA Higher,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: mrows, meta: mmeta } = await load(uniA, progM);
const mOf = (id) => mrows.find((p) => p.id === id).mathsAccepted;
equal('a list splits on the bullet', mOf('m-three'), ['AA HL', 'AA SL', 'AI HL']);
equal('"none" accepts every course', mOf('m-none'), ['AA HL', 'AA SL', 'AI HL', 'AI SL']);
check('blank and "?" are unknown, never "none"', mOf('m-blank') === null && mOf('m-q') === null);
check('a misspelt course is reported and treated as unknown',
  mOf('m-bad') === null && mmeta.issues.some((i) => /AA Higher/.test(i)));
const { applyFilters: upApplyFilters, createFilterState: upCreateFilterState } = await import(new URL('../js/filters.js', import.meta.url));
const mstate = upCreateFilterState();
mstate.myMaths = 'AI SL';
equal('AI SL hides only what states it is not accepted',
  upApplyFilters(mrows, mstate, new Set()).map((p) => p.id), ['m-none', 'm-blank', 'm-q', 'm-bad']);
mstate.myMaths = 'AA HL';
check('AA HL keeps everything here', upApplyFilters(mrows, mstate, new Set()).length === mrows.length);

// ------------------------------------------------------------- exam filter

section('entrance_exam: yes, waivable, no, unknown, and the filter');
const progE = [
  'programme_id,university_id,programme,entrance_exam,application_deadline,official_url,last_verified,verified_by',
  'e-yes,a,Exam,yes,,https://example.org,2026-08-14,TT',
  'e-waive,a,Waivable,waivable,,https://example.org,2026-08-14,TT',
  'e-no,a,No exam,no,,https://example.org,2026-08-14,TT',
  'e-blank,a,Not checked,,,https://example.org,2026-08-14,TT',
  'e-q,a,Unknown,?,,https://example.org,2026-08-14,TT',
  'e-bad,a,Typo,maybe,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: erows, meta: emeta } = await load(uniA, progE);
const eOf = (id) => erows.find((p) => p.id === id).entranceExam;
check('the three states load as written', eOf('e-yes') === 'yes' && eOf('e-waive') === 'waivable' && eOf('e-no') === 'no');
check('blank and "?" are unknown, never "no"', eOf('e-blank') === null && eOf('e-q') === null);
check('an unexpected value is reported and treated as unknown',
  eOf('e-bad') === null && emeta.issues.some((i) => /"maybe"/.test(i)));
const estate = upCreateFilterState();
estate.exam = 'none';
equal('"No exam" hides exams, waivable or not, and keeps unknowns',
  upApplyFilters(erows, estate, new Set()).map((p) => p.id), ['e-no', 'e-blank', 'e-q', 'e-bad']);
estate.exam = 'skippable';
equal('"None or skippable" hides only compulsory exams',
  upApplyFilters(erows, estate, new Set()).map((p) => p.id), ['e-waive', 'e-no', 'e-blank', 'e-q', 'e-bad']);

// ---------------------------------------------------------------- bad input

section('Bad spreadsheet input is reported, never silently swallowed');
const badProg = [
  head,
  'q1,u,,Locale date,BSc,Engineering,English,,HL Maths,,,,,15/01/2027,,https://example.org,2026-08-14,TT',
  'q2,nope,,Orphan,BSc,Engineering,English,,HL Maths,,,,,2027-01-15,,https://example.org,2026-08-14,TT',
  'q3,u,,Impossible date,BSc,Engineering,English,,HL Maths,,,,,2026-02-31,,https://example.org,2026-08-14,TT',
  'q4,u,,Bad link,BSc,Engineering,English,,HL Maths,,,,,2027-01-15,,javascript:alert(1),2026-08-14,TT',
  'q5,u,,Bad number,BSc,Engineering,English,abc,HL Maths,,,,,2027-01-15,,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: badRows, meta: badMeta } = await load(uni, badProg);
const said = (re) => badMeta.issues.some((i) => re.test(i));
check('a locale-mangled date is read and flagged', said(/not YYYY-MM-DD/));
check('an unknown university_id drops the row', badRows.every((p) => p.id !== 'q2') && said(/is not on the Universities tab/));
check('an impossible date is refused', said(/2026-02-31/));
check('a javascript: link is refused', said(/not a usable link/));
check('a non-numeric points value is flagged', said(/is not a number/));

// ---------------------------------------------------------- loading guards

section('A broken, empty or slow file falls back to the saved copy (L01-L07)');
const snapFixture = {
  meta: { generated_at: '2026-08-01', note: 'fixture' },
  universities: [{ university_id: 'u', name: 'Saved University', city: 'Town', country: 'Testland', last_verified: '2026-08-14', verified_by: 'TT' }],
  programmes: [{ programme_id: 'snap-1', university_id: 'u', programme: 'Saved', application_deadline: '2027-01-15', official_url: 'https://example.org', last_verified: '2026-08-14', verified_by: 'TT' }],
};
const goodRow = 'g1,u,,Good,BSc,Engineering,English,,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT';
const usedSnapshot = (res) => res && res.meta && res.meta.source === 'snapshot'
  && res.programmes.map((p) => p.id).join() === 'snap-1';
const tryLoad = (u, p, opts) => load(u, p, undefined, { snapshot: snapFixture, ...opts }).catch((err) => ({ error: err }));
for (const [name, text, why] of [
  ['an empty programmes file', '', /empty|no data rows/],
  ['a header-only programmes file', `${head}\n`, /no data rows/],
  ['an HTML page instead of the CSV', '<!doctype html><html><body>Sign in</body></html>\n', /programme_id/],
]) {
  const res = await tryLoad(uni, text);
  check(`${name} loads the saved copy and says why`,
    usedSnapshot(res) && res.meta.issues.some((i) => /^Could not load the latest data/.test(i) && why.test(i)),
    JSON.stringify(res.error ? res.error.message : res.meta.issues));
}
const renamed = await tryLoad(uni, [head.replace('official_url', 'official_link'), goodRow].join('\n') + '\n');
check('a renamed official_url header loads the saved copy, and the problem names the column',
  usedSnapshot(renamed) && renamed.meta.issues.some((i) => i.includes('"official_url"')),
  JSON.stringify(renamed.error ? renamed.error.message : renamed.meta.issues));
const uniNoSigner = uni.replace(',verified_by\n', ',signed\n');
const noSignerCol = await tryLoad(uniNoSigner, [head, goodRow].join('\n') + '\n');
check('a universities file without verified_by loads the saved copy',
  usedSnapshot(noSignerCol) && noSignerCol.meta.issues.some((i) => i.includes('"verified_by"')),
  JSON.stringify(noSignerCol.error ? noSignerCol.error.message : noSignerCol.meta.issues));
const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve({ error: new Error('still waiting after 2 s') }), ms));
const hung = await Promise.race([tryLoad(uni, [head, goodRow].join('\n') + '\n', { hang: ['programmes'], timeoutMs: 20 }), sleep(2000)]);
check('a request that never answers times out and loads the saved copy',
  usedSnapshot(hung) && hung.meta.issues.some((i) => /did not answer/.test(i)),
  JSON.stringify(hung.error ? hung.error.message : hung.meta.issues));
const hungAll = await Promise.race([tryLoad(uni, '', { hang: ['programmes', 'fallback.json'], timeoutMs: 20 }), sleep(2000)]);
check('the saved copy has a timeout too', hungAll.error && Array.isArray(hungAll.error.reasons)
  && hungAll.error.reasons.some((r) => /fallback\.json did not answer/.test(r)),
  hungAll.error ? `${hungAll.error.message} ${JSON.stringify(hungAll.error.reasons)}` : 'loaded');
const noSnap = await tryLoad(uni, '', { snapshotStatus: 404 });
check('when the saved copy is missing too, the error is plain words, not a JSON parse message',
  noSnap.error && !/JSON|Unexpected token/.test(noSnap.error.message)
    && Array.isArray(noSnap.error.reasons) && noSnap.error.reasons.some((r) => /404/.test(r)),
  noSnap.error ? `${noSnap.error.message} ${JSON.stringify(noSnap.error.reasons)}` : 'loaded');
const emptySnap = await tryLoad(uni, '', { snapshot: { ...snapFixture, programmes: [] } });
check('an empty saved copy is a failure too, not an empty site', Boolean(emptySnap.error), 'loaded with 0 rows');

// L03: an unclosed quote at the end swallowed every row after it into one cell.
const cut = csvToObjects('id,name\n1,"unfinished\n2,normal\n', 'Test');
check('a file that ends inside a quoted field is reported, and the swallowed row is not shown',
  cut.rows.length === 0 && cut.issues.length === 1 && /ends inside a quoted field that starts on line 2/.test(cut.issues[0]),
  JSON.stringify(cut));
const cutLoad = await tryLoad(uni, [head, goodRow, 'g2,u,,"Cut off,BSc'].join('\n') + '\n');
check('a truncated programmes file keeps its good rows and says so (no fallback)',
  cutLoad.meta && cutLoad.meta.source === 'sample' && cutLoad.programmes.map((p) => p.id).join() === 'g1'
    && cutLoad.meta.issues.some((i) => /ends inside a quoted field/.test(i)),
  JSON.stringify(cutLoad.error ? cutLoad.error.message : [cutLoad.meta.source, cutLoad.meta.issues]));

// L04: "2771,00" became 277100 and any number passed as IB points.
section('Numbers are range-checked, and a comma is only a thousands separator (L04)');
const numProg = [
  head,
  'n-99,u,,Points 99,BSc,Engineering,English,99,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT',
  'n-frac,u,,Points 36.5,BSc,Engineering,English,36.5,HL Maths,,,,,2027-05-01,,https://example.org,2026-08-14,TT',
  'n-neg,u,,Fee -100,BSc,Engineering,English,,HL Maths,,-100,,,2027-05-01,,https://example.org,2026-08-14,TT',
  'n-comma,u,,Fee 2771 comma 00,BSc,Engineering,English,,HL Maths,,"2771,00",,,2027-05-01,,https://example.org,2026-08-14,TT',
  'n-thou,u,,Fee 12 thousand,BSc,Engineering,English,36,HL Maths,,"12,500",,,2027-05-01,,https://example.org,2026-08-14,TT',
  'n-nolink,u,,No link,BSc,Engineering,English,,HL Maths,,,,,2027-05-01,,,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: num, meta: numMeta } = await load(uni, numProg);
const numRow = (id) => num.find((p) => p.id === id);
const numSaid = (re) => numMeta.issues.some((i) => re.test(i));
check('IB points 99 and 36.5 are reported and treated as not published',
  numRow('n-99').ibPointsMin === null && numRow('n-frac').ibPointsMin === null
    && numSaid(/ib_points_min.*"99"/) && numSaid(/ib_points_min.*"36\.5"/), JSON.stringify(numMeta.issues));
check('a fee of -100 is reported and treated as not published',
  numRow('n-neg').tuitionEu === null && numSaid(/tuition_eu.*"-100"/), JSON.stringify(numMeta.issues));
check('"2771,00" is reported, not read as 277100', numRow('n-comma').tuitionEu === null && numSaid(/"2771,00"/),
  `${numRow('n-comma').tuitionEu}`);
check('"12,500" is still read as 12500, and 36 points as 36', numRow('n-thou').tuitionEu === 12500 && numRow('n-thou').ibPointsMin === 36);
// T04: a blank official_url was not reported; the card just said no link.
check('a blank official_url is reported', numSaid(/row 7, official_url is blank/), JSON.stringify(numMeta.issues));

section('The page says when there are problems, and a total failure reads plainly (L06, L07)');
check('the banner links to the problems list when there are any',
  renderSrc.includes("'#issues'") && /meta\.issues\.length/.test(renderSrc.slice(renderSrc.indexOf('export function renderSourceBanner'))));
check('following that link opens the problems list', appSrcEarly.includes('dom.issues.open = true'));
check('a total failure is an alert with a plain sentence and a Reload button, not the raw error',
  appSrcEarly.includes("setAttribute('role', 'alert')")
    && appSrcEarly.includes('Could not load the latest data. Check your connection and reload the page.')
    && appSrcEarly.includes("'Reload'") && !appSrcEarly.includes('${err.message}'));
check('a total failure hides the filters and lists the reasons in the problems panel',
  appSrcEarly.includes('dom.form.hidden = true') && appSrcEarly.includes('dom.pane.hidden = true') && /renderIssues\([^)]*err\.reasons/.test(appSrcEarly));


section('Stage 1 foundations: self-hosted fonts, colour policy and source chrome (L10, A05)');
const foundationHtml = englishHtml(read('index.html'));
check('no Google Fonts hosts or old font declarations',
  !/fonts\.(?:googleapis|gstatic)\.com/.test(foundationHtml)
    && !/DM Sans|Playfair Display/.test(css + foundationHtml));
const fontFaces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((m) => m[1]);
const subsetRanges = ["U+0000, U+000D, U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02", "U+0100-0101, U+0104-0130, U+0132-0151, U+0154-017F, U+018F, U+0192, U+01A0-01A1, U+01AF-01B0, U+01FA-01FF, U+0218-021B, U+0237, U+0259, U+1E80-1E85, U+1E9E, U+20A1, U+20A4, U+20A6, U+20A8-20AA, U+20AD-20AE, U+20B1-20B2, U+20B4-20B5, U+20B8-20BA, U+20BD, U+20BF", "U+0102-0103, U+01CD-01DC, U+1EA0-1EF9, U+20AB"];
check('exactly nine local Plex faces with matching weight, subset, normal style and swap',
  fontFaces.length === 9 && ['Regular', 'SemiBold', 'Bold'].every((name, i) => [1, 2, 3].every((subset) => {
    const file = `IBMPlexSans-${name}-Latin${subset}.woff2`;
    const faces = fontFaces.filter((f) => f.includes(`url('../fonts/${file}') format('woff2')`));
    return faces.length === 1 && faces[0].includes("font-family: 'IBM Plex Sans'")
      && faces[0].includes(`font-weight: ${[400, 600, 700][i]};`)
      && faces[0].includes('font-style: normal;') && faces[0].includes('font-display: swap;')
      && faces[0].includes(`unicode-range: ${subsetRanges[subset - 1]};`)
      && !faces[0].includes('local(')
      && readFileSync(join(root, 'fonts', file)).subarray(0, 4).toString() === 'wOF2';
  })));
check('the IBM licence is present and only Regular Latin1 is preloaded',
  /SIL OPEN FONT LICENSE Version 1.1/.test(read('fonts/OFL.txt'))
    && (foundationHtml.match(/<link[^>]*as="font"[^>]*>/g) ?? []).length === 1
    && /<link rel="preload" href="fonts\/IBMPlexSans-Regular-Latin1.woff2" as="font" type="font\/woff2" crossorigin>/.test(foundationHtml));
const { colourPolicyErrors } = await import('./check-contrast.mjs');
equal('canonical root, marked temporary tokens, no non-root colour literals or misplaced alarm', colourPolicyErrors(css), []);
const policyRejects = (rule) => colourPolicyErrors(css + rule).length > 0;
check('colour guard rejects hex/functions/print literals and misplaced old markers',
  ['.card{display:block;color:#fff}', '.card{display:block;color:var(--ink);background:#fff}', '.card{color:rgb(1 2 3)}', '.card{color:rgba(1,2,3,.5)}',
    '.card{color:hsl(0 0% 0%)}', '.card{color:hsla(0,0%,0%,.5)}',
    '@media print{.card{color:#fff; /* old: remove in stage 3 */}}'].every(policyRejects));
check('colour guard accepts ID selectors and URL fragments',
  !policyRejects('#abc{color:var(--ink);background:url(sprite.svg#fff)}'));
check('alarm guard accepts banners and rejects mixed selectors and root overrides',
  !policyRejects('.bn-sample{background:var(--alarm)} .bn-fail p{color:var(--alarm-ink)}')
    && policyRejects('.bn-fail, .card{border-color:var(--alarm)}')
    && policyRejects('.bn-fail, .card{color:var(--alarm-ink)}')
    && policyRejects('.bn-fail + .card{color:var(--alarm-ink)}')
    && policyRejects('.card{--ink:var(--alarm)}')
    && colourPolicyErrors(css.replace('--ink:#16202c;', '--ink:var(--ink-2);')).length > 0
    && colourPolicyErrors(css.replace('--ink:#16202c;', '--ink:#16202c;--ink:#16202c;')).length > 0
    && colourPolicyErrors(css.replace('--ink:#16202c;', '--ink:#16202c;--stray:1px;')).includes('Unapproved root token --stray'));
check('language buttons expose both available choices, with their own language names',
  /class="lang" role="group" aria-label="Site language"/.test(foundationHtml)
    && /data-language="en" lang="en"/.test(foundationHtml)
    && /data-language="sk" lang="sk"/.test(foundationHtml)
    && !/aria-disabled="true"|sk-later/.test(foundationHtml)
    && foundationHtml.includes('(English)') && foundationHtml.includes('(Slovak)'));
check('source line starts hidden without a live region and uses allRows after load and on a language switch',
  /<p class="src" id="source-line" hidden><\/p>/.test(foundationHtml)
    && appSrcEarly.includes('renderSourceLine(dom.sourceLine, allRows, meta)')
    && (appSrcEarly.match(/renderSourceLine\(/g) ?? []).length === 2);
check('failure hides source, filters and results bar and uses a scoped primary Reload',
  appSrcEarly.includes("alert.className = 'bn bn-fail'") && appSrcEarly.includes("reload.className = 'btn btn-p'")
    && appSrcEarly.includes('dom.sourceLine.hidden = true') && appSrcEarly.includes('dom.status.hidden = true') && appSrcEarly.includes('dom.listp.hidden = true')
    && appSrcEarly.includes("reload.addEventListener('click', () => location.reload())"));

// The banners render through the shared DOM stand-in (ChromeNode, near the top).
const originalDocument = globalThis.document;
globalThis.document = stubDocument;
try {
  const { renderSourceLine, renderSourceBanner } = await import('../js/render.js');
  const rows = [{ university: 'A', country: 'Ireland' }, { university: 'A', country: 'Ireland' }, { university: 'B', country: 'Czechia' }];
  const source = new ChromeNode('p');
  const banner = new ChromeNode('div');
  const base = { source: 'live', draftCount: 0, sampleCount: 0, total: 3, issues: [] };
  renderSourceLine(source, rows, { ...base, draftCount: 1 });
  check('source counts every loaded row, university and country with final punctuation',
    !source.hidden && source.children[0].textContent === '3 programmes · 2 universities · 2 countries.'
      && source.children[0].className === 'stat' && source.textContent.includes('not a source of truth.')
      && source.children[2].className === 'src-more'
      && source.children[2].textContent === 'Check requirements, EU fees and deadlines on the official admissions page before applying.');
  renderSourceLine(source, rows.slice(0, 1), { ...base, draftCount: 1 });
  equal('one unchecked programme keeps the research warning with singular source counts', source.textContent,
    '1 programme · 1 university · 1 country. This site is a starting point for research, not a source of truth. Check requirements, EU fees and deadlines on the official admissions page before applying.');
  renderSourceLine(source, rows, base);
  check('checked data hides and clears the source line', source.hidden && source.children.length === 0);
  for (const meta of [base, { ...base, draftCount: 3 }]) {
    renderSourceBanner(banner, meta);
    check(`live ${meta.draftCount ? 'draft' : 'checked'} data has no banner`, banner.hidden && banner.children.length === 0);
  }
  for (const date of [new Date('2026-10-26T00:00:00Z'), null]) {
    renderSourceBanner(banner, { ...base, source: 'snapshot', snapshotDate: date });
    const saved = banner.children[0];
    check(`saved-copy neutral status ${date ? 'with date' : 'without date'}`,
      !banner.hidden && saved.className === 'bn bn-saved' && saved.attributes.role === 'status'
        && saved.children[0].attributes['aria-hidden'] === 'true' && saved.children[1].tagName === 'p'
        && saved.textContent.includes(date ? '26 October 2026' : 'an unknown date')
        && saved.textContent.includes('Could not load the latest data. Showing a saved copy from ')
        && saved.textContent.includes('Requirements, EU fees and deadlines may have changed.'));
  }
  for (const count of [1, 2]) {
    renderSourceBanner(banner, { ...base, issues: Array(count).fill('problem') });
    const saved = banner.children[0];
    const link = saved.children[1].children.at(-1);
    check(`issues-only neutral status with ${count} ${count === 1 ? 'problem' : 'problems'}`,
      saved.className === 'bn bn-saved' && saved.attributes.role === 'status'
        && saved.textContent.includes(`${count} data ${count === 1 ? 'problem.' : 'problems.'}`)
        && saved.textContent.includes('Some entries may be missing or incomplete.')
        && link.href === '#issues' && link.textContent === 'View data problems.');
  }
  for (const count of [1, 3]) {
    renderSourceBanner(banner, { ...base, sampleCount: count });
    const sample = banner.children[0];
    equal(`sample-only ${count === 3 ? 'all' : 'mixed'} bold lead`, sample.children[0].children[0].textContent,
      `${count} of 3 programmes ${count === 1 ? 'is an invented sample row' : 'are invented sample rows'}.`);
    check('sample uses a separate red status with the original applications warning',
      sample.className === 'bn bn-sample' && sample.attributes.role === 'status'
        && sample.textContent.includes(`Do not use ${count === 1 ? 'it' : 'them'} for real applications.`));
  }
  renderSourceBanner(banner, { ...base, total: 1, sampleCount: 1 });
  equal('one sample programme has a singular warning and keeps the real-applications prohibition', banner.textContent,
    '1 of 1 programme is an invented sample row. Do not use it for real applications.');
  for (const samples of [0, 1]) {
    renderSourceBanner(banner, { ...base, source: 'snapshot', draftCount: 3, sampleCount: samples, issues: ['problem'] });
    check(`snapshot plus issues${samples ? ' plus samples' : ''} keeps one neutral status and its link`,
      banner.children.length === (samples ? 2 : 1) && banner.children[0].className === 'bn bn-saved'
        && banner.children[0].textContent.includes('saved copy') && banner.children[0].textContent.includes('View data problems.')
        && !banner.textContent.includes('starting point for research'));
  }
  renderSourceBanner(banner, base);
  check('rerender removes obsolete banner children and hides the container', banner.hidden && banner.children.length === 0);
} finally {
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}

// ------------------------------------------------------- sorting, on real data

section('Sorting (uses data/sample-*.csv, which has varied values on purpose)');
const { programmes: sample } = await load(read('data/sample-universities.csv'), read('data/sample-programmes.csv'));
const { sortRows } = await import(new URL('../js/filters.js', import.meta.url));
check('sample fixtures still load', sample.length > 20, `${sample.length} rows`);

const tuition = sortRows(sample, 'tuition').map((p) => p.tuitionEu);
const knownFees = tuition.filter((v) => v !== null);
check('cheapest first', knownFees.every((v, i) => i === 0 || knownFees[i - 1] <= v));
check('an unknown fee sorts last, not as free', tuition.indexOf(null) === knownFees.length);

const points = sortRows(sample, 'points').map((p) => p.ibPointsMin);
const knownPoints = points.filter((v) => v !== null);
check('lowest points first', knownPoints.every((v, i) => i === 0 || knownPoints[i - 1] <= v));

const rank = (p) => (p.deadline === null ? 2 : p.deadlinePassed ? 1 : 0);
const ranked = sortRows(sample, 'deadline').map(rank);
check('passed and missing deadlines sink to the bottom', ranked.every((v, i) => i === 0 || ranked[i - 1] <= v));

const before = sample.map((p) => p.id).join();
sortRows(sample, 'name');
check('sorting does not reorder the caller array', sample.map((p) => p.id).join() === before);

// ---------------------------------------------------------------- search

const filtersMod = await import(new URL('../js/filters.js', import.meta.url));

section('One subject vocabulary, without hiding unknowns (S02)');
const { SUBJECT_AREAS, SUBJECT_ALIASES, UNCLASSIFIED, subjectAreasOf } =
  await import(new URL('../js/subjects.js', import.meta.url));
const subjectDocs = read('MAINTENANCE.md').split('### Subject areas\n')[1].split('\n---')[0];
const documentedSubjects = subjectDocs.split('\n').filter((line) => line.includes('·'))
  .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
equal('the code vocabulary matches the maintainer list exactly', SUBJECT_AREAS, documentedSubjects);
check('all aliases have lower-case noncanonical keys and canonical targets',
  [...SUBJECT_ALIASES].every(([key, targets]) => key === key.toLowerCase()
    && !SUBJECT_AREAS.some((area) => area.toLowerCase() === key)
    && targets.every((area) => SUBJECT_AREAS.includes(area))));
const subjectIssues = [];
equal('Finance expands and deduplicates in first-seen order',
  subjectAreasOf('Economics; Finance', subjectIssues, 'subject fixture'), ['Economics', 'Business & Management']);
equal('known vague aliases add no subject beside a precise one',
  subjectAreasOf('Psychology; Cognitive Science; Interdisciplinary', subjectIssues, 'subject fixture'), ['Psychology']);
equal('canonical names ignore case and surrounding spaces',
  subjectAreasOf(' engineering ', subjectIssues, 'subject fixture'), ['Engineering']);
for (const raw of ['', 'Humanities', 'Interdisciplinary', 'Innovation']) {
  equal(`blank or vague subject ${JSON.stringify(raw)} becomes Unclassified`,
    subjectAreasOf(raw, subjectIssues, 'subject fixture'), [UNCLASSIFIED]);
}
equal('blank, canonical and known alias inputs raise no issues', subjectIssues, []);
equal('an unknown spelling becomes Unclassified',
  subjectAreasOf('Enginering', subjectIssues, 'subject fixture'), [UNCLASSIFIED]);
equal('the unknown issue names the value and row exactly once', subjectIssues,
  ['subject fixture: subject_area "Enginering" is not on the subject list — shown as Unclassified.']);
const mixedSubjectIssues = [];
equal('a valid subject never swallows an unknown spelling',
  subjectAreasOf('Engineering; Enginering', mixedSubjectIssues, 'mixed subject fixture'), ['Engineering', UNCLASSIFIED]);
check('mixed input reports the unknown spelling once', mixedSubjectIssues.length === 1
  && mixedSubjectIssues[0].includes('mixed subject fixture: subject_area "Enginering"'));
const { programmes: subjectRows, meta: subjectMeta } = await load(uni, [
  'programme_id,university_id,programme,subject_area,application_deadline,official_url,last_verified,verified_by',
  'subject-unknown,u,Unknown course,Enginering,,https://example.org,2026-08-14,TT',
  'subject-mixed,u,Mixed course,Engineering; Enginering,,https://example.org,2026-08-14,TT',
  'subject-known,u,Known course,Law,,https://example.org,2026-08-14,TT',
  'subject-alias,u,Alias course,Finance,,https://example.org,2026-08-14,TT',
].join('\n') + '\n');
check('load keeps misspelled rows and exposes their issues', subjectRows.length === 4
  && subjectMeta.issues.filter((issue) => /subject_area "Enginering"/.test(issue)).length === 2
  && subjectRows[0].subjectAreas.includes(UNCLASSIFIED));
const engineeringFilter = { ...filtersMod.createFilterState(), subjectAreas: new Set(['Engineering']) };
equal('unknown and mixed subjects pass Engineering while known nonmatches do not',
  filtersMod.applyFilters(subjectRows, engineeringFilter).map((row) => row.id), ['subject-unknown', 'subject-mixed']);
equal('unknown subjects are counted under the Unclassified chip',
  filtersMod.applyFilters(subjectRows, { ...engineeringFilter, subjectAreas: new Set([UNCLASSIFIED]) }).length, 2);
equal('Unclassified sorts after every known facet, including Sports Science',
  filtersMod.buildFacets([...subjectRows, { ...subjectRows[0], subjectAreas: ['Sports Science'] }]).subjectAreas,
  ['Business & Management', 'Economics', 'Engineering', 'Law', 'Sports Science', UNCLASSIFIED]);
check('search keeps an alias word and adds the mapped subjects',
  ['finance', 'economics', 'business management'].every((q) => filtersMod.matchesSearch(subjectRows[3].searchBlob, q)));
equal('obsolete Finance URL selection is quietly dropped',
  [...filtersMod.paramsToState('?subject=Finance', filtersMod.buildFacets(subjectRows)).subjectAreas], []);

section('Search: every word, any order; short words start a word (S01)');
// Stand-ins that always fail, so a missing export shows as FAIL lines, not a crash.
const missing = () => ({ value: undefined, valid: undefined });
const matchesSearch = filtersMod.matchesSearch || (() => false);
const parsePoints = filtersMod.parsePoints || missing;
const parseFee = filtersMod.parseFee || missing;
const applyToday = (await import(new URL('../js/data.js', import.meta.url))).applyToday || (() => {});
const uniF = [
  'university_id,name,city,country,last_verified,verified_by',
  'nl,Delft University of Technology,Delft,Netherlands,2026-08-14,TT',
  'cz,Technická univerzita v Košicích,Košice,Slovakia,2026-08-14,TT',
].join('\n') + '\n';
const progF = [
  'programme_id,university_id,programme,subject_area,application_deadline,official_url,last_verified,verified_by',
  'f-cs,nl,Computer Science and Engineering,Computer Science,2027-01-15,https://example.org,2026-08-14,TT',
  'f-phys,nl,Applied Physics,Physics,2027-01-15,https://example.org,2026-08-14,TT',
  'f-law,cz,Law,Law,2026-08-14,https://example.org,2026-08-14,TT',
  'f-med,cz,Všeobecné lékařství,Medicine & Health,2027-01-15,https://example.org,2026-08-14,TT',
  'f-socio,cz,Socio-economic Studies,Social Sciences,2027-01-15,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: sf } = await load(uniF, progF);
const sfRow = (id) => sf.find((p) => p.id === id);
const finds = (query, id) => matchesSearch(sfRow(id).searchBlob, query);
check('"computer science netherlands" finds a Dutch CS row', finds('computer science netherlands', 'f-cs'));
check('the same words in another order still find it', finds('netherlands computer science', 'f-cs'));
check('"cs" no longer matches "Physics"', !finds('cs', 'f-phys'));
check('"law" matches a Law row', finds('law', 'f-law'));
check('accent folding still works ("Kosice" finds Košice)', finds('Kosice', 'f-law'));
check('"medicine" finds a Medicine & Health row whose title lacks the word', finds('medicine', 'f-med'));
check('"eco" finds "Socio-economic" (a hyphen starts a word)', finds('eco', 'f-socio'));
check('a punctuation-only word such as "&" is ignored, not a reason to hide every row',
  finds('&', 'f-cs') && finds('computer & science', 'f-cs'));
check('an empty search matches everything', finds('   ', 'f-phys'));

section('My points and Max fee refuse what is not a whole number in range (P05)');
equal('parsePoints refuses 23, 46, 36.5, -3 and "abc"',
  ['23', '46', '36.5', '-3', 'abc'].map((v) => parsePoints(v).valid), [false, false, false, false, false]);
equal('parsePoints accepts 24 and 45, and an empty field is valid with no value',
  ['24', '45', ''].map((v) => parsePoints(v)), [{ value: 24, valid: true }, { value: 45, valid: true }, { value: null, valid: true }]);
equal('parseFee accepts 2771 and 0, refuses -100 and 12.5',
  ['2771', '0', '-100', '12.5'].map((v) => parseFee(v)),
  [{ value: 2771, valid: true }, { value: 0, valid: true }, { value: null, valid: false }, { value: null, valid: false }]);
check('an invalid number is never read as 0', parseFee('-100').value === null && parsePoints('abc').value === null);
check('parseFee refuses a number too long to be exact (a 400-digit entry is Infinity, not a fee limit)',
  parseFee('9'.repeat(400)).value === null && parseFee('9'.repeat(400)).valid === false && parseFee(String(Number.MAX_SAFE_INTEGER)).value === Number.MAX_SAFE_INTEGER);
const indexHtml = englishHtml(read('index.html'));
check('the fee field takes any whole euro amount (no step="500")',
  !indexHtml.includes('step="500"') && /id="f-tuition"[^>]*step="1"/.test(indexHtml));
check('both number fields point at a message element',
  /id="f-points"[^>]*aria-describedby="f-points-help f-points-error"/.test(indexHtml) && indexHtml.includes('id="f-points-error"')
    && /id="f-tuition"[^>]*aria-describedby="f-unknown-help f-tuition-error"/.test(indexHtml) && indexHtml.includes('id="f-tuition-error"'));
const appSrc = read('js/app.js');
check('app.js shows the message on validity.badInput too', appSrc.includes('input.validity.badInput'));
check('app.js reads My points and Max fee through parsePoints / parseFee, not a bare Number()',
  appSrc.includes('parsePoints') && appSrc.includes('parseFee') && !appSrc.includes('function wholeNumber'));

section('Typing during loading is kept, and nothing renders before the data (S04)');
const startBody = appSrc.slice(appSrc.indexOf('async function start()'));
check('wireInputs() runs before await loadData() in start()',
  startBody.indexOf('wireInputs();') > 0 && startBody.indexOf('wireInputs();') < startBody.indexOf('await loadData('));
check('the fields are read into the state after loading, before the first update()',
  /readFields\(\);\s*loaded = true;\s*update\(\);/.test(startBody));
check('update() returns early before the data has loaded', /function update\(\) \{\s*if \(!loaded\) return;/.test(appSrc));

section('Deadline state follows the date, not the load time (S06)');
const todayRow = sfRow('f-law');
check('a deadline of today is not passed', todayRow.deadlinePassed === false && todayRow.daysUntilDeadline === 0);
const sortRank = (rows, id) => sortRows(rows, 'deadline').findIndex((p) => p.id === id);
const rankToday = sortRank(sf, 'f-law');
applyToday(sf, new Date('2026-08-15'));
check('the next day it is passed, no longer urgent, and sorts below the live deadlines',
  todayRow.deadlinePassed === true && todayRow.isUrgent === false && todayRow.daysUntilDeadline === -1
    && rankToday === 0 && sortRank(sf, 'f-law') === sf.length - 1);
check('applyToday also re-works isStale', (applyToday(sf, new Date('2030-01-01')), todayRow.isStale === true));
check('app.js re-applies the date when the day changes and on visibilitychange',
  appSrc.includes('applyToday(allRows, now)') && appSrc.includes("'visibilitychange'"));

section('The empty state names the filters in use (S05)');
check('the empty state no longer mentions the Google Sheet or a fixed tuition/country hint',
  !appSrc.includes('Google Sheet') && !appSrc.includes('raising the tuition limit, or removing a country'));
check('the empty state has a working Clear all button',
  indexHtml.includes('id="empty-clear"') && appSrc.includes("dom.emptyClear.addEventListener('click', () => clearAllFrom(dom.emptyClear))"));

// S03: a reload threw every filter away, and a filtered view could not be
// shared. The state now lives in the address.
section('Filters are kept in the address (S03)');
const { stateToParams, paramsToState } = filtersMod;
const urlFacets = { subjectAreas: ['Law', 'Medicine & Health'], countries: ['Ireland', 'Italy'], languages: ['English', 'Czech'] };
const fullState = {
  ...filtersMod.createFilterState(),
  search: 'computer science', myIbPoints: 36, maxTuition: 3000,
  subjectAreas: new Set(['Law', 'Medicine & Health']), countries: new Set(['Ireland']),
  languages: new Set(['English']), sort: 'tuition',
};
const fullQuery = stateToParams(fullState);
const back = paramsToState(fullQuery, urlFacets);
equal('a full state survives the round trip',
  [back.search, back.myIbPoints, back.maxTuition, [...back.subjectAreas], [...back.countries], [...back.languages], back.sort],
  ['computer science', 36, 3000, ['Law', 'Medicine & Health'], ['Ireland'], ['English'], 'tuition']);
check('the short parameter names are used', /^q=computer\+science&points=36&fee=3000&subject=Law&subject=Medicine\+%26\+Health&country=Ireland&lang=English&sort=tuition$/.test(fullQuery), fullQuery);
const junk = paramsToState('points=46&fee=-5&subject=Astrology&country=Mars&lang=Klingon&sort=random&country=Italy', urlFacets);
equal('unknown values and invalid numbers are dropped',
  [junk.myIbPoints, junk.maxTuition, [...junk.subjectAreas], [...junk.countries], [...junk.languages], junk.sort],
  [null, null, [], ['Italy'], [], 'deadline']);
equal('an empty state gives an empty query string, and the default sort is left out',
  stateToParams(filtersMod.createFilterState()), '');
// The ported My maths and Entrance exam filters (Jakub's) travel in the address
// as `mymaths` and `exam`, apart from the HL Maths 4+ tick (`maths=1`). A bad
// value must come back as "no choice", never as a value that hides rows.
{
  const both = paramsToState('maths=1&mymaths=AI SL&exam=skippable');
  equal('maths=1&mymaths=AI SL&exam=skippable: the tick, the course and the exam choice are three separate settings',
    [both.hlMaths, both.myMaths, both.exam], [true, 'AI SL', 'skippable']);
  const written = stateToParams({ ...filtersMod.createFilterState(), hlMaths: true, myMaths: 'AI SL', exam: 'skippable' });
  equal('they are written as maths=1, mymaths and exam, and read back unchanged',
    [written, paramsToState(written).hlMaths, paramsToState(written).myMaths, paramsToState(written).exam],
    ['maths=1&mymaths=AI+SL&exam=skippable', true, 'AI SL', 'skippable']);
  equal('mymaths alone leaves the tick and the exam unset, and the other way round',
    [paramsToState('mymaths=AA HL').hlMaths, paramsToState('mymaths=AA HL').exam, paramsToState('exam=none').myMaths, paramsToState('exam=none').exam, paramsToState('exam=none').hlMaths],
    [false, null, null, 'none', false]);
  equal('every listed course and exam choice survives the round trip',
    Object.keys(filtersMod.EXAM_OPTIONS).map((e) => paramsToState(stateToParams({ ...filtersMod.createFilterState(), exam: e })).exam),
    ['none', 'skippable']);
  const dataMod = await import(new URL('../js/data.js', import.meta.url));
  equal('all four maths courses survive the round trip',
    dataMod.MATHS_COURSES.map((c) => paramsToState(stateToParams({ ...filtersMod.createFilterState(), myMaths: c })).myMaths),
    ['AA HL', 'AA SL', 'AI HL', 'AI SL']);
  equal('bad values are rejected to null: a wrong course name, a wrong case, and exam words that are not choices (or are Object.prototype names)',
    ['mymaths=AA Higher', 'mymaths=aa hl', 'mymaths=', 'exam=maybe', 'exam=yes', 'exam=', 'exam=__proto__', 'exam=hasOwnProperty', 'exam=toString', 'exam=constructor']
      .map((q) => { const s = paramsToState(q); return q.startsWith('mymaths') ? s.myMaths : s.exam; }),
    [null, null, null, null, null, null, null, null, null, null]);
  equal('the unset state writes neither parameter',
    [stateToParams(filtersMod.createFilterState()).includes('mymaths'), stateToParams(filtersMod.createFilterState()).includes('exam'),
      stateToParams({ ...filtersMod.createFilterState(), hlMaths: true })],
    [false, false, 'maths=1']);
  equal('My maths and Entrance exam each count as one active filter, and the tick is counted apart',
    [filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), myMaths: 'AA SL' }),
      filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), exam: 'none' }),
      filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), myMaths: 'AA SL', exam: 'none' }),
      filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), myMaths: 'AA SL', exam: 'none', hlMaths: true }),
      filtersMod.activeFilterCount(filtersMod.createFilterState())],
    [1, 1, 2, 3, 0]);
}
check('app.js writes the URL values into the fields before loading, and keeps the address up to date',
  startBody.indexOf('applyUrlFields(') > 0 && startBody.indexOf('applyUrlFields(') < startBody.indexOf('await loadData(')
    && appSrc.includes('history.replaceState('));

// The audits found these with a keyboard, a screen reader and a 320 px phone.
// There is no DOM here, so they are checked as text; the browser steps in
// the plan cover how they behave.
section('Keyboard, screen readers and narrow screens (A02-A07)');
check('one .visually-hidden utility is defined', /\.visually-hidden \{[^}]*clip/.test(css));
// Stage 5 retargets read the stylesheet with its media ancestry (cssTree,
// further down), never as one flattened string.
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleAt = (source, selector, query) => cssTree(source).filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)
  && (query === undefined ? r.media.length === 0 : r.media.length === 1 && r.media[0] === `@media ${query}`)).map((r) => r.body).join(';');
// A03: the text inputs and Sort replaced the outline with a 1.04:1 soft ring.
// Stage 5 renamed the controls (.inp, summary, .btn, .tick), so the old
// .field selectors would pass vacuously; any context is checked now.
const keepsFocusOutline = (source) => cssTree(source.replace(/\/\*[\s\S]*?\*\//g, '')).every((r) =>
  !(/(?:^|[\s,>+~(])(?:\.inp|select|summary|\.btn|\.tick\s+input)(?![\w-])/.test(r.selector)
    && /outline\s*:\s*(?:none|0)\s*(?:[;!}]|$)/.test(r.body)));
check('filter controls keep the global 2.5 px focus outline: no outline:none or 0 on .inp, select, summary, .btn or .tick input (A03)',
  /outline:\s*2\.5px solid var\(--accent\)/.test(ruleAt(cssText, ':focus-visible')) && keepsFocusOutline(css)
    && !keepsFocusOutline(css + '.inp:focus{outline:none}') && !keepsFocusOutline(css + '@media (min-width: 600px){.tick input:focus-visible{outline:0}}')
    && !keepsFocusOutline(css + '.fbar summary{outline: none}'));
// A05: the h1's decorative full stop was read out as part of the title.
check('the h1 is plain IB University Finder with no generated full stop',
  /<h1>IB University Finder<\/h1>/.test(englishHtml(read('index.html'))) && !/h1\s*::after/.test(css));
// A02: dropdown panels and the masthead stat pushed a 320 px page to 354 px.
// Stage 5: below 600 the panels are accordions in the sheet; in the bar every
// panel is clamped to the viewport and the last one opens leftward.
check('dropdown panels stay inside the viewport: every panel clamped, the last right-aligned, sheet panels static and full width (A02)',
  /max-width:calc\(100vw - 2 \* var\(--gut\)\)/.test(ruleAt(cssText, '.dropdown-panel'))
    && /left:auto;right:0/.test(ruleAt(cssText, '.dropdown:last-of-type .dropdown-panel'))
    && /left:auto;right:0/.test(ruleAt(cssText, '#dd-countries .dropdown-panel'))
    && /position:static;width:auto;max-width:none;max-height:none;overflow:visible/.test(ruleAt(cssText, '.sheet-b .dropdown-panel')));
check('the source line wraps normally and phone hides stat and advice',
  /\.src\{[^}]*white-space:normal/.test(css) && /\.stat,\.src-more\{display:none\}/.test(css)
    && /@media \(min-width: 600px\)[\s\S]*?\.tagline,\.stat,\.src-more\{display:inline\}/.test(css));
// A07: the sticky bar hid the skip-link target and filled a landscape phone.
// Spec §10: the header band (masthead and filters) is never sticky; only the
// column header from 600 and the count line below 600 stick.
check('the header band is never sticky; .cols sticks only from 600 px and .status only below 600 (A07); negative fixtures fail',
  stickyChromeOk(css) && !stickyChromeOk(css + '.fbar{position:sticky}')
    && !stickyChromeOk(css + '@media (min-width: 1024px){.fbar .affix{position:sticky;top:0}}')
    && !stickyChromeOk(css + '.mast-top{position:fixed}') && !stickyChromeOk(css + '.cols{position:sticky}')
    && !stickyChromeOk(css + '@media (min-width: 600px){.status{position:sticky}}'));
const marginRules = [...css.matchAll(/\/\*[^*]*measured[^*]*\*\/\s*#results,\s*#results :is\(li,\s*a,\s*button\)\s*\{\s*scroll-margin-top:\s*\d+px\s*;?\s*\}/g)];
check('#results and its rows, links and buttons clear the sticky chrome with a measured scroll-margin-top below and from 600; no 236 px (A07)',
  marginRules.length === 2 && /scroll-margin-top/.test(ruleAt(cssText, '#results')) && /scroll-margin-top/.test(ruleAt(cssText, '#results', '(min-width: 600px)'))
    && !/236px/.test(cssText) && /scroll-margin-bottom:8px/.test(ruleAt(cssText, '#results>.item')));
// A05, A04: names a screen reader reads out.
check('a hidden ", " separates the title from the degree',
  renderSrc.includes("el('span', 'visually-hidden', ', ')"));
check('a Czech-only title is marked lang="cs"', /title\.lang = 'cs'/.test(renderSrc));
// Redesign stage 2: the source check is on renderDetail; every live row is
// rendered and checked further down ("each detail is named by its title").
check('each detail is named by its title (aria-labelledby, id from programme_id)',
  renderDetailSrc.includes("article.setAttribute('aria-labelledby'") && /title\.id = `p-\$\{row\.id\}`/.test(renderDetailSrc));
check('the official link names its programme and says it opens a new tab',
  UI.en.opens_in_a_new_tab?.includes('(opens in a new tab)') && renderSrc.includes('value1: row.programme, value2: row.university'));
// A06: the pick-lists and the live result count.
check('a dropdown closes when focus leaves it (focusout)', appSrc.includes("addEventListener('focusout'"));
check('Escape returns focus to the summary only from inside the open dropdown',
  /open\.contains\(document\.activeElement\)/.test(appSrc));
check('the dropdown count reads "2 selected" (hidden text in its own span)',
  englishHtml(indexHtml).includes('<span class="visually-hidden"> selected</span>') && appSrc.includes("subjectsCountNumber"));
// Verify Impl: a hidden ", " in the box was read as "Country , 1 selected", because the
// browser already adds a space between the label and the count.
check('the dropdown count has no hidden comma (it read "Country , 1 selected")',
  !/dropdown-count[^>]*><span class="visually-hidden">,/.test(indexHtml));
check('the live result count is written only when its text changes',
  renderSrc.includes('if (node.textContent === text) return false;') && appSrc.includes('renderCount(dom.count, lead, currentSummary)'));

// ---------------------------------------------------------------- export

section('Shortlist CSV export');
const { toCsv } = await import(new URL('../js/shortlist.js', import.meta.url));
const messy = sample.filter((p) => p.ibSubjects.includes(',')).slice(0, 3);
const grid = parseCsv(toCsv(messy));
check('every exported row has the same column count',
  grid.every((r) => r.length === grid[0].length), JSON.stringify(grid.map((r) => r.length)));
check('commas inside a field survive the round trip',
  messy.length > 0 && grid[1][grid[0].indexOf('IB subjects')] === messy[0].ibSubjects);
// R05, X03: the export is switched off with the shortlist, but kept. It gave
// a bare points figure where the card adds a condition, and a cell typed as
// "=..." in the Sheet would run as a formula when the file is opened.
const base = sample[0];
const exportRows = [
  { ...base, ibPointsMin: 43, needsHlMaths: true, rankedWithHpat: false, pointsPlusTest: false, pointsKind: 'cutoff',
    cao: { year: 2026, test: false, rounds: [
      { round: 1, points: 610, aqa: false, notAll: false, ib: 43, bonusOnly: true },
      { round: 2, points: 590, aqa: false, notAll: false, ib: 43, bonusOnly: false }] } },
  { ...base, ibPointsMin: 32, needsHlMaths: false, rankedWithHpat: true, pointsPlusTest: false, pointsKind: 'minimum', cao: null },
  { ...base, ibPointsMin: null, needsHlMaths: false, rankedWithHpat: false, pointsPlusTest: true, pointsKind: null, cao: null },
  { ...base, ibPointsMin: 36, needsHlMaths: false, rankedWithHpat: false, pointsPlusTest: false, pointsKind: 'minimum', cao: null },
  { ...base, admission: [], admissionUnknown: true, city: '', cityUnknown: true,
    englishRequirement: [], englishUnknown: true },
  { ...base, programme: '=HYPERLINK("http://evil.example","x")', deadlineNotes: '+1 day', university: '@uni' },
];
const exported = parseCsv(toCsv(exportRows));
const cell = (r, heading) => exported[r + 1][exported[0].indexOf(heading)];
// Since points-honesty Phase 3 the export joins the card's own pointsLines, so
// it says "minimum" or which round's cutoff, as the card does.
equal('the export carries the card\'s points qualifiers, cutoff or minimum',
  [0, 1, 2, 3].map((r) => cell(r, 'IB points')),
  ['≈ 43 IB points, Round 1 cutoff, 2026, with HL Maths 4+; ≈ 43 IB points, Round 2 cutoff, 2026',
    '32 IB points, then ranked with the HPAT', 'Cutoff includes a test score', '36 IB points, minimum']);
equal('the export says "Not published" for a "?" admission, city and language',
  [cell(4, 'Admission'), cell(4, 'City'), cell(4, 'Language requirement')], ['Not published', 'Not published', 'Not published']);
const exportUncertainty = csvToObjects(toCsv([hcRow('h-blank'), hcRow('h-q'),
  { ...base, noSubjectsRequired: true, lastVerified: null }])).rows;
equal('export proficiency distinguishes blank without inheritance from ?; none and missing dates stay explicit',
  [exportUncertainty[0]['Language requirement'], exportUncertainty[1]['Language requirement'],
    exportUncertainty[0]['IB subjects'], exportUncertainty[2]['IB subjects'], exportUncertainty[2]['Last updated']],
  ['Not checked yet', 'Not published', 'Not checked yet', 'None required', 'Not recorded']);
equal('export names the award, EU fee, official page, record date and signer without claiming human verification',
  exported[0], ['University', 'Programme', 'Degree type', 'City', 'Country', 'Deadline', 'Deadline notes', 'Admission',
    'IB points', 'IB subjects', 'Other requirements', 'Language requirement', 'EU fee (EUR/year)',
    'Living costs (EUR/month)', 'Living costs source', 'Fee + 12 months living, lowest (EUR)',
    'Fee + 12 months living, highest (EUR)', 'Yearly estimate note', 'Apply via',
    'Official admissions page', 'Last updated', 'Signed by']);
equal('a cell that starts with = + - or @ is exported as text, not a formula',
  [cell(5, 'Programme'), cell(5, 'Deadline notes'), cell(5, 'University')],
  ['\'=HYPERLINK("http://evil.example","x")', '\'+1 day', '\'@uni']);

// M05, M06, M07: comments that said the wrong thing, a favicon 404 in the
// console on every load, and a converter nothing called that still had the
// old wrong "ABOVE the 625" wording.
section('Tidy-up (M05-M07)');
check('config.js no longer says the site runs on the sample files', !read('js/config.js').includes('sample files in /data'));
check('the CSS header no longer mentions a dark palette or a 1080px rail',
  !/dark palette/.test(css.slice(0, 600)) && !/1080px/.test(css.slice(0, 600)));
check('index.html declares an icon, so no favicon request 404s', /<link rel="icon" href="data:,">/.test(indexHtml));
check('the unused fromCutoff converter is gone', !read('tools/lib/ireland.mjs').includes('fromCutoff'));

// ---------------------------------------------------------------- maintainer lint

section('Data lint (T05) and id stability (M02)');
const { lintData, compareIds, formatReport } = await import(new URL('./lint-data.mjs', import.meta.url));
const lintToday = new Date(2026, 10, 2, 15);
const lintUniHeader = parseCsv(read('data/universities.csv'))[0];
const lintProgHeader = parseCsv(read('data/programmes.csv'))[0];
const lintUni = { university_id: 'test', name: 'Test University', country: 'Netherlands', verified_by: 'AI-DRAFT' };
const lintProg = { programme_id: 'test-maths', university_id: 'test', programme: 'Mathematics', official_url: 'https://test.nl/maths', verified_by: 'AI-DRAFT' };
const lintCsv = (header, rows) => [header, ...rows.map((row) => header.map((key) => row[key] ?? ''))]
  .map((row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n');
const lintSheets = (programmes = [lintProg], universities = [lintUni]) => ({
  programmes: lintCsv(lintProgHeader, programmes), universities: lintCsv(lintUniHeader, universities),
});
const lintFixture = ({ programmes, universities, progHeader = lintProgHeader, uniHeader = lintUniHeader } = {}) =>
  lintData({ programmesCsv: lintCsv(progHeader, programmes || [lintProg]),
    universitiesCsv: lintCsv(uniHeader, universities || [lintUni]), today: lintToday });
const lintRules = (findings) => findings.map((f) => `${f.severity}:${f.rule}`).sort();
const lintCases = [
  ['clean fixture', {}, []],
  ['TODO marker', { deadline_notes: 'TODO check this' }, ['error:marker']],
  ['question marker', { deadline_notes: 'Date ??' }, ['error:marker']],
  ['lapsed promise', { deadline_notes: 'We will publish dates by 1 November 2026.' }, ['error:promise']],
  ['today promise', { deadline_notes: 'We will confirm dates by 2 November 2026.' }, []],
  ['future promise', { deadline_notes: 'We will announce dates by 3 November 2026.' }, []],
  ['ordinary deadline text', { deadline_notes: 'Apply by 1 November 2026.' }, []],
  ['unknown subjects', { ib_subjects: ' ? ' }, ['error:unknown-misuse']],
  ['embedded question is prose', { deadline_notes: 'Check whether an interview is needed?' }, []],
  ['None is not none', { ib_subjects: 'None' }, ['error:none-spelling']],
  ['N/A is not none', { ib_subjects: 'n/a' }, ['error:none-spelling']],
  ['dash is not none', { ib_subjects: '-' }, ['error:none-spelling']],
  ['no requirements is not none', { ib_subjects: 'No requirements' }, ['error:none-spelling']],
  ['explicit none', { ib_subjects: 'none' }, []],
  ['bad signature', { verified_by: 'ai-draft', last_verified: '2026-11-01' }, ['error:signer']],
  ['human initials', { verified_by: 'JK', last_verified: '2026-11-01' }, []],
  ['accented human initials', { verified_by: 'ĽŠ', last_verified: '2026-11-01' }, []],
  ['sample is not a bad signature', { verified_by: 'SAMPLE' }, ['error:sample']],
  ['comparison page', { official_url: 'https://www.bachelorsportal.com/course' }, ['error:comparison-site']],
  ['not a comparison hostname', { official_url: 'https://bachelorsportal.com.example/course' }, []],
  ['broken encoding', { programme: 'MathÃ©matics' }, ['error:encoding']],
  ['future verification', { last_verified: '2026-11-03' }, ['error:future-verified']],
  ['today verification', { last_verified: '2026-11-02' }, []],
  ['past deadline', { application_deadline: '2026-11-01' }, ['warning:past-deadline']],
  ['today deadline', { application_deadline: '2026-11-02' }, []],
  ['far deadline', { application_deadline: '2207-01-01' }, ['warning:far-deadline']],
  ['18 month deadline', { application_deadline: '2028-05-02' }, []],
  ['over 18 months', { application_deadline: '2028-05-03' }, ['warning:far-deadline']],
  ['http link', { official_url: 'http://test.nl/maths' }, ['warning:http']],
  ['unknown text', { admission: 'not published' }, ['warning:unknown-text']],
  ['mixed question text', { admission: '? not published' }, ['warning:unknown-text']],
  ['bad bullet', { other_requirements: 'A·B' }, ['warning:bullet']],
  ['spaced bullet', { other_requirements: 'A · B' }, []],
  ['unknown subject uses loader only', { subject_area: 'Enginering' }, ['error:site']],
  ['subject alias', { subject_area: 'Finance' }, []],
];
for (const [name, changes, expected] of lintCases) {
  equal(`T05 ${name}`, lintRules(lintFixture({ programmes: [{ ...lintProg, ...changes }] })), expected);
}
for (const column of ['tuition_eu', 'tuition_noneu', 'english_requirement', 'admission', 'city', 'degree_type', 'application_system', 'entrance_exam', 'ib_maths']) {
  equal(`T05 ? is meaningful in ${column}`, lintRules(lintFixture({ programmes: [{ ...lintProg, [column]: '?' }] })), []);
}
equal('T05 ? is never a university unknown state', lintRules(lintFixture({ universities: [{ ...lintUni, city: '?' }] })), ['error:unknown-misuse']);
equal('T05 duplicate header', lintRules(lintFixture({ progHeader: [...lintProgHeader, 'city'] })), ['error:header-dup']);
equal('T05 unknown header', lintRules(lintFixture({ progHeader: [...lintProgHeader, 'offical_url'] })), ['warning:header-extra']);
equal('T05 missing optional header', lintRules(lintFixture({ progHeader: lintProgHeader.filter((c) => c !== 'admission') })), ['warning:header-missing']);
equal('T05 missing required header uses loader only', lintRules(lintFixture({ progHeader: lintProgHeader.filter((c) => c !== 'official_url') })), ['error:site']);
equal('T05 duplicated id uses loader', lintRules(lintFixture({ programmes: [lintProg, lintProg] })), ['error:site', 'warning:dup-row']);
equal('T05 duplicated programme under distinct ids', lintRules(lintFixture({ programmes: [lintProg, { ...lintProg, programme_id: 'test-copy' }] })), ['warning:dup-row']);
equal('T05 Czech points', lintRules(lintFixture({ programmes: [{ ...lintProg, ib_points_min: '28' }], universities: [{ ...lintUni, country: 'Czechia' }] })), ['warning:czech-points']);
const domainRows = ['a', 'b', 'c', 'd'].map((id, i) => ({ ...lintProg, programme_id: `test-${id}`, programme: id, official_url: `https://${i === 3 ? 'other.example' : 'test.nl'}/${id}` }));
equal('T05 minority domain', lintRules(lintFixture({ programmes: domainRows })), ['warning:off-domain']);

// ---- ib_maths "none" next to a named maths course (2026-11 contradiction pass)
// 43 UK science rows said "none" beside "Chemistry plus one of Biology,
// Physics or Maths at HL". The warning must fire on a named requirement and
// stay quiet on the legitimate "none" cases that pass kept.
const mathsNoneCases = [
  ['sole AA HL requirement', { ib_subjects: 'Maths AA HL 6' }, ['warning:maths-none']],
  ['maths one of several HL options', { ib_subjects: 'Chemistry plus one of Biology, Physics or Mathematics at Higher Level.' }, ['warning:maths-none']],
  ['HL grade in maths', { other_requirements: 'Physics BSc · 6 in HL Mathematics' }, ['warning:maths-none']],
  ['plain none', { ib_subjects: 'No subject required' }, []],
  ['recommended', { ib_subjects: 'No subject required (Maths AA SL/HL 4 or AI HL 4 highly recommended)' }, []],
  ['exam waiver', { admission: 'Scio test · Waived for predicted Maths AA HL 6 or SL 7' }, []],
  ['GCSE equivalence', { ib_subjects: 'GCSE Mathematics met via AA or AI SL/HL grade 2' }, []],
  ['sub-route', { ib_subjects: 'Some BA subjects need more: Pure Mathematics HL 6 in Maths' }, []],
  ['conditional course note', { ib_subjects: "Mathematics preferred. For Mathematics, the programme will accept either 'Analysis and Approaches' or 'Applications and Interpretation' at higher level" }, []],
  ['entrance test', { admission: 'Entrance exam: maths test' }, []],
  ['not a minimum', { ib_subjects: 'Competitive reference: Maths HL 5 or SL 6 (not a minimum)' }, []],
];
for (const [name, changes, expected] of mathsNoneCases) {
  equal(`maths-none ${name}`, lintRules(lintFixture({ programmes: [{ ...lintProg, ib_maths: 'none', ...changes }] })), expected);
}
equal('maths-none ignores a course list', lintRules(lintFixture({ programmes: [{ ...lintProg, ib_maths: 'AA HL', ib_subjects: 'Maths AA HL 6' }] })), []);
equal('maths-none ignores "?"', lintRules(lintFixture({ programmes: [{ ...lintProg, ib_maths: '?', ib_subjects: 'Chemistry plus one of Biology or Maths at HL' }] })), []);
equal('maths-none reads the row, not the university baseline', lintRules(lintFixture({
  programmes: [{ ...lintProg, ib_maths: 'none' }],
  universities: [{ ...lintUni, baseline_requirement: 'Computer Science needs 7 in HL Mathematics (AA only)' }] })), []);
// ---- end ib_maths "none" block
for (const [id, usual, extra] of [['vut', 'vut.cz', 'vutbr.cz'], ['eur', 'eur.nl', 'rsm.nl']]) {
  equal(`T05 ${id} allowed extra domain`, lintRules(lintFixture({
    universities: [{ ...lintUni, university_id: id }], programmes: domainRows.map((row, i) => ({ ...row, university_id: id,
      official_url: `https://${i === 3 ? extra : usual}/${i}` })),
  })), []);
}
const badCell = lintFixture({ programmes: [{ ...lintProg, deadline_notes: 'TODO' }] })[0];
check('T05 findings identify sheet row, id and column', badCell.where === 'Programmes row 2' && badCell.id === 'test-maths' && badCell.message.includes('deadline_notes'));
let emptySheetsRejected = false;
try { sheetsModule.readSheets(lintSheets().universities, lintCsv(lintProgHeader, []), lintToday); }
catch (err) { emptySheetsRejected = /no data rows/.test(err.message); }
check('T05 readSheets preserves the explicit empty-programme guard', emptySheetsRejected);
const parsedIssues = sheetsModule.readSheets(lintSheets().universities,
  lintSheets().programmes + '\nwrong,width\n' + lintCsv(lintProgHeader, [{ ...lintProg, programme_id: 'test-bad', ib_points_min: 'oops' }]).split('\n')[1], lintToday).issues;
check('T05 readSheets combines CSV and build issues', parsedIssues.length === 2 && parsedIssues.some((s) => s.includes('columns')) && parsedIssues.some((s) => s.includes('not a number')));
// data.js once built its required-column list with t('programme') at import, so a
// Slovak interface demanded a "program" column and every load failed. Re-import it
// fresh while Slovak is on and parse the same sheets.
{
  const before = i18n.getLanguage();
  i18n.initLanguage('?ui=sk', { getItem: () => null });
  const freshData = await import('../js/data.js?slovak-columns');
  let slovakLoads = true;
  try { freshData.readSheets(lintSheets().universities, lintSheets().programmes, lintToday); } catch { slovakLoads = false; }
  const slovakWord = i18n.t('programme');
  i18n.initLanguage('', { getItem: () => before });
  check('a Slovak interface never renames the required CSV columns', slovakLoads && slovakWord !== 'programme');
}

const idA = { ...lintProg, programme_id: 'test-maths', official_url: 'https://test.nl/a' };
const idB = { ...lintProg, programme_id: 'test-maths-2', official_url: 'https://test.nl/b' };
const idBase = lintSheets([idA, idB]);
const idCompare = (rows, base = idBase, universities) => compareIds({ base, work: lintSheets(rows, universities) });
equal('M02 unchanged ids', idCompare([idA, idB]), []);
equal('M02 same title with different URLs is fine', lintRules(lintFixture({ programmes: [idA, idB] })), []);
equal('M02 URL-only update', idCompare([{ ...idA, official_url: 'https://test.nl/new' }, idB]), []);
const swappedIds = idCompare([{ ...idA, official_url: idB.official_url }, { ...idB, official_url: idA.official_url }]);
equal('M02 reciprocal URL swap is two errors', lintRules(swappedIds), ['error:id-swap', 'error:id-swap']);
check('M02 swap names the other id', swappedIds.every((f) => f.message.includes(f.id === idA.programme_id ? idB.programme_id : idA.programme_id)));
equal('M02 one-sided collision warns once', lintRules(idCompare([{ ...idA, official_url: idB.official_url }, idB])), ['warning:id-collision']);
// An importer that meets a new row first shifts every later id by one (review
// of b7ceeff): new -3 gets -2's old row, -2 gets the first row's, and the
// first id points at the new course. That chain is an error.
const idShift = idCompare([{ ...idA, official_url: 'https://test.nl/new' }, { ...idB, official_url: idA.official_url },
  { ...idB, programme_id: 'test-maths-3', official_url: idB.official_url }]);
check('M02 importer shift is caught as an error naming both ids', idShift.some((f) => f.severity === 'error' && f.rule === 'id-shift'
  && f.id === 'test-maths-3' && f.message.includes('test-maths-2')), JSON.stringify(idShift));
equal('M02 one-step shift without a chain only warns', lintRules(idCompare([{ ...idA, official_url: 'https://test.nl/new' }, idB,
  { ...idA, programme_id: 'test-maths-3' }])), ['warning:id-shift']);
equal('M02 renamed id warns only once', lintRules(idCompare([{ ...idA, programme_id: 'test-renamed' }, idB])), ['warning:id-renamed']);
equal('M02 deleted id', lintRules(idCompare([idA])), ['warning:id-gone']);
equal('M02 title spelling fix', lintRules(idCompare([{ ...idA, programme: 'Mathematic' }, idB])), ['warning:id-retitled']);
equal('M02 moved university', lintRules(idCompare([{ ...idA, university_id: 'other' }, idB])), ['warning:id-moved']);
equal('M02 new bad id', lintRules(idCompare([idA, idB, { ...idA, programme_id: 'WRONG id', programme: 'New' } ])), ['warning:new-id-format']);
equal('M02 new wrong prefix', lintRules(idCompare([idA, idB, { ...idA, programme_id: 'other-new', programme: 'New' } ])), ['warning:new-id-format']);
equal('M02 historical odd ids stay unchanged', compareIds({ base: lintSheets([{ ...idA, programme_id: 'Old ID' }]), work: lintSheets([{ ...idA, programme_id: 'Old ID' }]) }), []);
equal('M02 null base does not invent new ids', idCompare([idA, idB], { programmes: null, universities: null }), []);
equal('M02 missing university', lintRules(idCompare([idA, idB], idBase, [])), ['warning:uni-gone']);
equal('M02 renamed university', lintRules(idCompare([idA, idB], idBase, [{ ...lintUni, university_id: 'renamed' }])), ['warning:uni-renamed']);

for (const column of ['programme', 'programme_id', 'university_id', 'official_url']) {
  let malformedComparison;
  try {
    malformedComparison = compareIds({ base: idBase, work: { ...idBase,
      programmes: lintCsv(lintProgHeader.filter((c) => c !== column), [idA, idB]) } });
  } catch { malformedComparison = 'crashed'; }
  equal(`M02 missing ${column} leaves the loader to report the bad header`, malformedComparison, []);
}
equal('M02 fully missing base', idCompare([idA, idB], null), []);
for (const marker of ['CONFIRM', 'TBD', 'FIXME', 'XXX']) {
  equal(`T05 ${marker} marker`, lintRules(lintFixture({ programmes: [{ ...lintProg, deadline_notes: marker }] })), ['error:marker']);
}
for (const damaged of ['â€', 'Â']) {
  equal(`T05 encoding ${damaged}`, lintRules(lintFixture({ universities: [{ ...lintUni, name: damaged }] })), ['error:encoding']);
}
equal('T05 past deadline becomes current the day before', lintRules(lintData({ programmesCsv: lintCsv(lintProgHeader, [{ ...lintProg, application_deadline: '2026-11-01' }]),
  universitiesCsv: lintSheets().universities, today: new Date(2026, 9, 31) })), []);

const reportRows = Array.from({ length: 12 }, (_, i) => ({ ...badCell, id: `test-${i}` }));
const cappedReport = formatReport(reportRows, ['Id comparison skipped: test.']);
check('T05 report groups, caps and counts errors', cappedReport.includes('marker (12)') && cappedReport.includes('2 more (add --all)') && cappedReport.endsWith('Result: 12 errors, 0 warnings. Fix the errors first.'));
check('T05 --all report shows every finding', !formatReport(reportRows, [], { all: true }).includes('more (add --all)'));
const lintScript = join(root, 'tools/lint-data.mjs');
const runLint = (args, options = {}) => spawnSync(process.execPath, [lintScript, ...args], { encoding: 'utf8', cwd: tmpdir(), ...options });
const cliGood = runLint(['--no-git', '--today', '2026-11-02']);
check('T05 CLI works away from root without git', cliGood.status === 0 && cliGood.stdout.trimEnd().endsWith('OK to commit.') && !cliGood.stderr, cliGood.stderr || cliGood.stdout);
for (const args of [['--bogus'], ['--against'], ['--today'], ['--against', '--all'], ['--today', '--all'], ['--today', '2026-02-31'], ['--today', '2026-13-01'], ['--today', 'tomorrow'], ['--today', '2026-2-1']]) {
  const result = runLint(args);
  check(`T05 CLI rejects ${args.join(' ')}`, result.status === 2 && /^Usage: [^\n]+\n$/.test(result.stdout) && !result.stderr, result.stdout + result.stderr);
}
{
  const typo = spawnSync(process.execPath, [lintScript, '--against', 'NO_SUCH_REF_X'], { encoding: 'utf8', cwd: tmpdir() });
  check('T05 a mistyped --against stops with exit 2, not "OK to commit"', typo.status === 2 && !typo.stdout.includes('OK to commit'), typo.stdout + typo.stderr);
  check('T05 git show has a buffer big enough for a growing CSV', /maxBuffer: 64 \* 1024 \* 1024/.test(read('tools/lint-data.mjs')));
}
const noGitDir = mkdtempSync(join(tmpdir(), 'ib-lint-no-git-'));
try {
  const result = runLint([], { env: { ...process.env, GIT_DIR: noGitDir } });
  check('T05 unavailable git is one note, not a failure', result.status === 0 && (result.stdout.match(/Id comparison skipped/g) || []).length === 1 && !result.stderr, result.stdout + result.stderr);
} finally { rmSync(noGitDir, { recursive: true }); }
const importOnly = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(new URL('./lint-data.mjs', import.meta.url).href)}`], { encoding: 'utf8', cwd: tmpdir() });
check('T05 importing the lint runs nothing', importOnly.status === 0 && !importOnly.stdout && !importOnly.stderr);
const lintImports = [...read('tools/lint-data.mjs').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
check('T05 lint uses only Node built-ins and browser helpers', lintImports.length > 0 && lintImports.every((path) => path.startsWith('node:') || path.startsWith('../js/')));
const realLint = lintData({ universitiesCsv: read('data/universities.csv'), programmesCsv: read('data/programmes.csv'), today: new Date() });
check('T05 real data has zero lint errors', !realLint.some((f) => f.severity === 'error'), formatReport(realLint));
console.log(`  ${realLint.filter((f) => f.severity === 'warning').length} lint warnings (node tools/lint-data.mjs shows them)`);

// ---------------------------------------------------------------- the real data

section('The real dataset');
const { programmes: live, meta: liveMeta } = await load(read('data/universities.csv'), read('data/programmes.csv'));
check('loads with no spreadsheet problems', liveMeta.issues.length === 0,
  liveMeta.issues.slice(0, 5).join('\n        '));
check('every programme has an official link', live.every((p) => p.officialUrl),
  live.filter((p) => !p.officialUrl).map((p) => p.id).join(', '));
check('every programme belongs to a university', live.every((p) => p.university));
// Czech universities default to a 0 fee because Czech-taught study is free.
// English-taught study never is, so it must never inherit that 0.
const freeEnglish = live.filter((p) => p.country === 'Czechia' && p.languages.includes('English') && p.tuitionEu === 0);
check('no English-taught Czech programme shows as free', freeEnglish.length === 0,
  freeEnglish.map((p) => p.id).join(', '));

const liveRow = (id) => live.find((p) => p.id === id);
check('every real subject is canonical or Unclassified',
  live.every((row) => row.subjectAreas.every((area) => SUBJECT_AREAS.includes(area) || area === UNCLASSIFIED)));
const liveSubjects = filtersMod.buildFacets(live).subjectAreas;
check('live facet stays within the closed vocabulary', liveSubjects.length <= SUBJECT_AREAS.length + 1);
equal('the current dataset has 23 subject facets', liveSubjects.length, 23);
check('no current programme becomes Unclassified', live.every((row) => !row.subjectAreas.includes(UNCLASSIFIED)));
check('bocconi-fin maps Finance to Business & Management', liveRow('bocconi-fin').subjectAreas.includes('Business & Management'));
equal('sdu-mech maps to Engineering', liveRow('sdu-mech').subjectAreas, ['Engineering']);
equal('au-cog maps to Psychology', liveRow('au-cog').subjectAreas, ['Psychology']);
// D01: WBB closes 1 Nov 2026 and goes through the Common App. The row used to
// say "2027/28 dates not out yet" and inherit Bocconi's own portal.
const wbb = liveRow('bocconi-wbb');
check('bocconi-wbb: deadline is 2026-11-01 and it applies via the Common App',
  wbb && wbb.deadline && wbb.deadline.toISOString().slice(0, 10) === '2026-11-01'
    && /common app/i.test(wbb.applicationSystem),
  wbb ? `${wbb.deadline && wbb.deadline.toISOString()} / ${wbb.applicationSystem}` : 'row missing');

// D02: graduate-entry routes need a first degree (UCC's GEM ranks on GAMSAT,
// whose 58 was converted into "24 IB points"). School-leavers can't apply.
// (?<!under): UL's "Undergraduate Entry Medicine" is open to school leavers.
const gradEntry = live.filter((p) => /(?<!under)graduate[- ]entry/i.test(p.programme));
check('no graduate-entry programme is listed', gradEntry.length === 0, gradEntry.map((p) => p.id).join(', '));

// D03: HPAT is for undergraduate Medicine only (ACER's list). It used to be
// guessed from titles and landed on Dental Science, Podiatric Medicine and
// Molecular Medicine. deadline_notes may say "such as the HPAT test", so only
// the requirement chips are scanned.
const hpatIds = live.filter((p) => p.otherRequirements.some((r) => /HPAT/.test(r))).map((p) => p.id).sort();
equal('HPAT appears on exactly the undergraduate Medicine rows', hpatIds,
  ['galway-bachelor-of-medicine-mb-of-surgery-bc', 'tcd-medicine', 'ucc-medicine', 'ucd-medicine',
    'ul-undergraduate-entry-medicine-bmbs']);

// D04: the Trinity–Columbia dual degree is a joint application with years
// 3–4 at Columbia, so Trinity's CAO route and fee must not be inherited.
const columbia = liveRow('tcd-columbia-dual-degree');
check('tcd-columbia-dual-degree has its own admission and an unknown fee',
  columbia && columbia.admission.length > 0 && columbia.tuitionEu === null,
  columbia ? JSON.stringify([columbia.admission, columbia.tuitionEu]) : 'row missing');

// D05: Groningen UCG says it is "not a numerus fixus programme"; the row said
// it was. Its note also said the February intake closes 1 January; rug.nl's
// 2027/28 deadline table says 1 November for a non-Dutch diploma.
// A 15 January date used to fail this check too, but upstream (e1a0317) added
// UCG's Early Bird deadline, and UCG's own page has it ("Early Bird Deadline:
// 15 January 2027", rug.nl/ucg/application/early-bird-deadline, read
// 2026-11-02). So 15 January is allowed only as the Early Bird date.
const ucg = liveRow('rug-ucg');
const ucgText = ucg ? [...ucg.otherRequirements, ...ucg.admission, ucg.deadlineNotes].join(' | ') : '';
check('rug-ucg is not called numerus fixus, and its February intake closes 1 November',
  ucg && !/(?<!not (a )?)numerus fixus/i.test(ucgText) && !/1 January/i.test(ucgText)
    && /February intake closes 1 November/.test(ucgText)
    && !/15 January/i.test(ucgText.replaceAll(/Early Bird deadline 15 January/gi, '')),
  ucgText || 'row missing');

// D09: notes are for students, not maintainer to-dos, and must not promise
// news by a date that has gone. Real deadlines ("by 15 January 2027") are fine;
// only "will confirm / announce / publish ... by <date>" is a promise.
const confirm = realLint.filter((f) => f.rule === 'marker');
check('no cell contains a maintainer to-do', confirm.length === 0, confirm.map((f) => f.id).join(', '));
const lapsed = realLint.filter((f) => f.rule === 'promise');
check('no note promises news by a date that has passed', lapsed.length === 0,
  lapsed.map((f) => `${f.where} (${f.id}): ${f.message}`).join('\n'));

// R02 on the real data: these three rows have a different admission route from
// their university. They used to say "?" and had to show "Not published".
// Upstream (e1a0317) then found and wrote each route, so the check is now that
// they show their own route and never fall back to the university's.
const ownAdmission = ['lei-archaeology', 'lei-luc', 'uu-ucr'].filter((id) => {
  const p = liveRow(id);
  return !(p && !p.admissionUnknown && p.admission.length > 0);
});
check('lei-archaeology, lei-luc and uu-ucr show their own admission route', ownAdmission.length === 0,
  ownAdmission.join(', '));
// R02 itself, on whatever rows still say "?": the card must say so.
const rawProgrammes = csvToObjects(read('data/programmes.csv'), 'Programmes').rows;
const questionAdmission = rawProgrammes.filter((r) => r.admission.trim() === '?')
  .filter((r) => !(liveRow(r.programme_id) && liveRow(r.programme_id).admissionUnknown));
check('every "?" admission row shows an unknown admission route', questionAdmission.length === 0,
  questionAdmission.map((r) => r.programme_id).join(', '));

// The merge kept entrance_exam=yes on Trinity Dental Science, Trinity
// Molecular Medicine and Galway Podiatry after the fork had removed their wrong
// "HPAT admission test" (ACER's HPAT list covers undergraduate Medicine only),
// and left UCD and UL Medicine blank though both name the HPAT. Jakub's rule
// for Irish rows (tools/add-entrance-exam-2026-10-27.mjs) is: yes only when a
// test or audition is named. So every Irish "yes" has to name one.
const irishUnis = new Set(csvToObjects(read('data/universities.csv'), 'Universities').rows
  .filter((u) => u.country === 'Ireland').map((u) => u.university_id));
const unnamedIrishExam = rawProgrammes
  .filter((r) => irishUnis.has(r.university_id) && r.entrance_exam.trim() === 'yes')
  .filter((r) => !/HPAT|GAMSAT|test|exam|audition|assessment/i.test(`${r.admission} ${r.other_requirements}`));
check('every Irish row with entrance_exam=yes names the test, exam or audition', unnamedIrishExam.length === 0,
  unnamedIrishExam.map((r) => r.programme_id).join(', '));

// D11: "Dentistry" matched no subject pattern and fell through to Liberal Arts.
check('ucc-dentistry is filed under Medicine & Health',
  liveRow('ucc-dentistry') && liveRow('ucc-dentistry').subjectAreas.includes('Medicine & Health'));

// D22: vu-las was Amsterdam University College, the same college as uva-auc,
// and inherited VU's own statutory fee (2,771) instead of AUC's 5,580. Fixed
// in d949351; then Leon (Q10, 2026-10-25) dropped the duplicate row, so the
// college is listed once, under the UvA entry, at AUC's own fee.
check('vu-las is dropped and uva-auc stays, at AUC\'s own fee',
  !liveRow('vu-las') && liveRow('uva-auc') && liveRow('uva-auc').tuitionEu === 5580,
  `vu-las ${liveRow('vu-las') ? 'still listed' : 'gone'}; uva-auc fee ${liveRow('uva-auc') && liveRow('uva-auc').tuitionEu}`);

// D23: Leiden's English-taught International Relations and Organisations track
// is numerus fixus (selection and placement), but the row said "?" and so
// showed no admission route at all.
const iro = liveRow('lei-iro');
check('lei-iro says numerus fixus in its admission route',
  iro && iro.admission.some((a) => /numerus fixus/i.test(a)),
  iro ? JSON.stringify(iro.admission) : 'row missing');

// Q11 (2026-10-25): Leiden Political Science is listed once. Its English-taught
// option is lei-iro; the other track (NIP) is Dutch-taught, so lei-polsci went.
check('lei-polsci is dropped and lei-iro stays numerus fixus',
  !liveRow('lei-polsci') && iro && iro.admission.some((a) => /numerus fixus/i.test(a)),
  `lei-polsci ${liveRow('lei-polsci') ? 'still listed' : 'gone'}`);

// D10 / Q6: UvA's open-entry rows used to headline 1 April, which is only the
// date for EU/EEA students with a non-Dutch diploma who want UvA housing. The
// headline is the general date (1 May); the housing date lives in the note, in
// one fixed sentence. The check compares the headline with the date the note
// names, so it needs no year and survives the next cycle.
// uva-anthro and uva-comm are left out on purpose: when this was fixed
// (2026-10-25) their pages still showed the 2026 dates (anthro) or an
// "advisory 1 April" with no year (comm), so their rows were not rewritten.
// Take them off this list the day their pages show the 2027 dates.
const UVA_NOT_YET_CONFIRMED = new Set(['uva-anthro', 'uva-comm']);
const uvaRows = live.filter((p) => p.id.startsWith('uva-') && !UVA_NOT_YET_CONFIRMED.has(p.id));
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const housingDate = (p) => {
  const m = p.deadlineNotes.match(/Want UvA housing\? Apply by (\d{1,2}) ([A-Za-z]+) (\d{4}) instead\./);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return month < 0 ? null : new Date(Date.UTC(+m[3], month, +m[1])).toISOString().slice(0, 10);
};
const headlineIsHousing = uvaRows.filter((p) => p.deadline && p.deadline.toISOString().slice(0, 10) === housingDate(p));
check('no UvA row headlines its housing date', headlineIsHousing.length === 0,
  headlineIsHousing.map((p) => p.id).join(', '));
const housingNoSentence = uvaRows.filter((p) => /housing/i.test(p.deadlineNotes) && housingDate(p) === null);
check('every UvA note that mentions housing uses the "Want UvA housing?" sentence', housingNoSentence.length === 0,
  housingNoSentence.map((p) => p.id).join(', '));
const yourDeadline = uvaRows.filter((p) => /YOUR deadline/.test(p.deadlineNotes));
check('no UvA note says "YOUR deadline"', yourDeadline.length === 0, yourDeadline.map((p) => p.id).join(', '));
const housingRows = uvaRows.filter((p) => housingDate(p) !== null);
check('the UvA housing sentence is on the open-entry rows (at least 15)', housingRows.length >= 15,
  `${housingRows.length} rows`);

// R03 on the real data: every university baseline reaches all its programmes.
const baselineOf = new Map(csvToObjects(read('data/universities.csv'), 'Universities').rows
  .map((u) => [u.name.trim(), (u.baseline_requirement || '').trim()]));
const lostBaseline = live.filter((p) => p.baselineRequirement !== baselineOf.get(p.university));
// The count guards against a whole column going blank. It was 29 on the fork;
// upstream filled baselines for the countries it added, so it is 144 since the
// merge (all 29 fork baselines survived unchanged).
check('every programme carries its university\'s baseline (144 universities have one)',
  lostBaseline.length === 0 && [...baselineOf.values()].filter(Boolean).length === 144,
  `${lostBaseline.length} rows differ; ${[...baselineOf.values()].filter(Boolean).length} baselines`);
check('the one "?" city on the real data is flagged', liveRow('cvut-aplikace-informatiky-v-prirodnich-vedac')?.cityUnknown === true);

// S01: "UvA", "TCD" or "ČVUT" found nothing, because only the English names were
// searched. The aliases column (universities tab) and the local city names fix it.
const uniOfRows = (query) => new Set(live.filter((p) => matchesSearch(p.searchBlob, query)).map((p) => p.university));
for (const [query, university] of [['uva', 'University of Amsterdam'], ['tu delft', 'Delft University of Technology'],
  ['tcd', 'Trinity College Dublin'], ['ucd', 'University College Dublin'],
  ['cvut', 'Czech Technical University in Prague'], ['praha', 'Charles University'],
  ['univerzita karlova', 'Charles University'], ['milano', 'Bocconi University']]) {
  const unis = uniOfRows(query);
  check(`"${query}" finds ${university}`, unis.has(university), JSON.stringify([...unis]));
}
check('"uva" finds only the University of Amsterdam', [...uniOfRows('uva')].join() === 'University of Amsterdam',
  JSON.stringify([...uniOfRows('uva')]));
const prahaOutside = live.filter((p) => matchesSearch(p.searchBlob, 'praha') && p.city !== 'Prague');
check('"praha" does not find Charles University rows taught in Plzeň or Hradec Králové',
  prahaOutside.every((p) => p.university !== 'Charles University'), prahaOutside.map((p) => p.id).join(', '));
const { meta: noAliasMeta, programmes: noAlias } = await load(uniF, progF);
check('a universities file without the aliases column still loads with no problems',
  noAliasMeta.issues.length === 0 && noAlias.length === 5 && !uniF.split('\n')[0].includes('aliases'),
  JSON.stringify(noAliasMeta.issues));

// L08: the saved copy is what students see when the CSVs cannot be read. It
// must hold exactly what the CSVs hold, field for field: a stale deadline
// under the right programme_id is the risk, so comparing ids is not enough.
const snapshotFile = JSON.parse(read('data/fallback.json'));
const csvRows = (p) => csvToObjects(read(p), p).rows.map(({ __row, ...rest }) => rest);
const parity = (name, file) => JSON.stringify(snapshotFile[name]) === JSON.stringify(csvRows(file));
check('data/fallback.json matches the CSVs exactly',
  parity('universities', 'data/universities.csv') && parity('programmes', 'data/programmes.csv'),
  'the saved copy is out of date: run  node tools/make-snapshot.mjs  and commit data/fallback.json with the CSVs');

console.log(`        ${live.length} programmes across ${new Set(live.map((p) => p.university)).size} universities`);

// ---------------------------------------------------------------- importers

section('Irish importer rules (so a rerun cannot bring the fixed rows back)');
const ie = await import(new URL('./lib/ireland.mjs', import.meta.url));
const cp = await import(new URL('./lib/cao-points.mjs', import.meta.url));
const pts = await import(new URL('../js/points.js', import.meta.url));
// The CAO sentence on a row, read back (js/points.js), and its latest round:
// Round 2 where the CAO published one. ib_points_min is converted from it.
const caoOf = (p) => pts.parseCaoSentence(p.deadlineNotes);
const latestOf = (p) => { const c = caoOf(p); return c && c.rounds.length ? c.rounds[c.rounds.length - 1] : null; };
check('SKIP_TITLE drops graduate-entry Medicine', ie.SKIP_TITLE.test('Medicine (Graduate Entry)'));
check('SKIP_TITLE drops graduate-entry Pharmacy', ie.SKIP_TITLE.test('Pharmacy - Graduate Entry to Pharmacy'));
check('SKIP_TITLE keeps undergraduate-entry Medicine (UL LM301)', !ie.SKIP_TITLE.test('Undergraduate Entry Medicine - BMBS'));
check('Trinity\'s own title filter drops graduate entry',
  /graduate\[- \]entry/.test(read('tools/import-tcd.mjs')));
equal('otherFor no longer invents an HPAT for Dental Science', ie.otherFor('Dental Science'), '');
equal('otherFor gives Veterinary Medicine the veterinary text', ie.otherFor('Veterinary Medicine'),
  'Restricted entry — additional assessment');
check('HPAT_CODES holds the undergraduate Medicine codes only',
  ['TR051', 'CK701', 'GY501', 'DN400', 'LM301'].every((c) => ie.HPAT_CODES.has(c))
    && !['TR052', 'TR060', 'GY504', 'CK702', 'CK791'].some((c) => ie.HPAT_CODES.has(c)));
// D24: UCD (DN400) and UL (LM301) undergraduate Medicine were missing. The UCD
// hub page has no IB block, so import-ucd.mjs skips it, and the two rows are
// hand-added. This fails if a merge from an importer run loses one of them.
// update-cao-points.mjs finds a row by the "(code XX000)" in its note and
// rewrites the sentence the first OLD_CAO_SENTENCES pattern matches, so both
// must hold.
const oldCao = cp.OLD_CAO_SENTENCES[0];
for (const code of ie.HPAT_CODES) {
  const rows = live.filter((p) => p.deadlineNotes.includes(`(code ${code})`));
  check(`HPAT code ${code} names a live Medicine row the CAO refresh can find`,
    rows.length === 1 && oldCao.test(rows[0].deadlineNotes),
    `${rows.length} rows carry (code ${code})`);
}
for (const f of ['tools/import-tcd.mjs', 'tools/import-ucd.mjs', 'tools/lib/irish-import.mjs']) {
  const src = read(f);
  const hpatAt = src.indexOf('HPAT_CODES.has(');
  const testAt = src.indexOf('hasCaoTest(entry) ?');
  check(`${f} checks HPAT_CODES before the CAO test marker`, hpatAt > 0 && hpatAt < testAt);
}
check('areasFor("Dentistry") includes Medicine & Health', ie.areasFor('Dentistry').includes('Medicine & Health'));

section('Importer subject fallbacks and keyword boundaries (S02, D30, D31)');
const czAreas = await import(new URL('./lib/czech-areas.mjs', import.meta.url));
equal('unmatched English and Czech titles stay blank, never guessed Liberal Arts',
  [ie.areasFor('Underwater Basket Weaving'), czAreas.areasForCz('Underwater Basket Weaving')], ['', '']);
for (const [name, patterns] of [['SUBJ', ie.SUBJ], ['CZ', czAreas.CZ]]) {
  check(`${name} uses only canonical subjects`, patterns.every(([, area]) => SUBJECT_AREAS.includes(area)));
}
// Read only the literal: importing this script would fetch pages and write rows.
const muniSource = read('tools/import-muni.mjs');
const muniCategories = runInNewContext(`(${muniSource.match(/const CATEGORIES = (\{[^]*?\n\});/)[1]})`);
check('Masaryk catalogue categories use only canonical subjects',
  Object.values(muniCategories).every((area) => SUBJECT_AREAS.includes(area)));
check('Masaryk falls back to its catalogue category only for an unmatched title',
  muniSource.includes('subject_area: areas || area,') && !muniSource.includes("=== 'Liberal Arts'"));
const { areasFor: muniAreasFor } = await import(new URL('./lib/czechia.mjs', import.meta.url));
for (const [name, areasFor] of [['Irish', ie.areasFor], ['Masaryk', muniAreasFor]]) {
  for (const title of ['Physical Education', 'Physical Education and Sport', 'Sports Studies and Physical Education']) {
    const areas = areasFor(title).split('; ');
    check(`${name}: ${title} is sport and education, never Physics (D30)`,
      areas.includes('Sports Science') && areas.includes('Education') && !areas.includes('Physics'));
  }
  check(`${name}: Physics and Physical Sciences still map to Physics`,
    ['Physics', 'Physical Sciences', 'Astrophysics'].every((title) => areasFor(title).includes('Physics')));
}
for (const title of ['Tělesná výchova a sport', 'Učitelství tělesné výchovy', 'Tělesná výchova se zaměřením na vzdělávání']) {
  const areas = czAreas.areasForCz(title).split('; ');
  check(`${title} maps to sport, never forestry (D31)`,
    areas.includes('Sports Science') && !areas.includes('Environmental Sciences'));
}
check('genuine forestry titles still map to Environmental Sciences',
  ['Lesnictví', 'Lesní inženýrství', 'Ekologie a lesnictví'].every((title) =>
    czAreas.areasForCz(title).includes('Environmental Sciences')));

// P02: a cutoff of 601-625 is NOT above the IB scale. 45 IB points convert to
// 600, so 602-625 is reachable with the 25 HL Maths bonus. The importers wrote
// "Above the 625-point IB maximum" for it. aboveIB() picks the true sentence,
// and all three writers share it so a rerun cannot bring the false one back.
// A 601-625 cutoff with the CAO test marker may include test or portfolio
// marks (UL Architecture), so it gets its own sentence and no figure.
const ABOVE_SCALE = 'Above the 625-point IB maximum, so no IB equivalent.';
const ABOVE_TEST_601 = 'Above the 600 points a 45 converts to, and the cutoff may include test or portfolio marks, so no IB figure is given.';
check('aboveIB: 602 and 625 without a test get the bonus-points sentence, not "above the maximum"',
  [602, 625].every((n) => typeof ie.aboveIB === 'function' && ie.aboveIB(n) !== ABOVE_SCALE && /HL Maths bonus/.test(ie.aboveIB(n))));
check('aboveIB: 602 and 625 with a test get the test-or-portfolio sentence',
  [602, 625].every((n) => ie.aboveIB(n, true) === ABOVE_TEST_601));
check('aboveIB: 626 and 741 keep the "above the maximum" sentence',
  typeof ie.aboveIB === 'function' && [626, 741].every((n) => ie.aboveIB(n) === ABOVE_SCALE));
const oldPatterns = cp.OLD_CAO_SENTENCES;
check('OLD_CAO_SENTENCES removes every aboveIB sentence before rebuilding',
  typeof ie.aboveIB === 'function'
    && [ie.aboveIB(610), ie.aboveIB(610, true), ie.aboveIB(700), ie.aboveIB(700, true), ie.HPAT_NOTE]
      .every((t) => typeof t === 'string' && oldPatterns.some((re) => re.test(t))));
const wronglyAbove = live.filter((p) => p.deadlineNotes.includes(ABOVE_SCALE)
  && latestOf(p)?.points <= 625);
check('no row calls a cutoff of 625 or less "above the 625-point IB maximum"', wronglyAbove.length === 0,
  wronglyAbove.map((p) => p.id).join(', '));

// P03 / Q13 (2026-10-25): the bonus figure used to depend on the course title,
// so UCC Dentistry (625) and DCU Global Business USA (602) showed no figure
// while Trinity Dental Science (625) showed 44. The CAO bonus applies to any
// course: every 601-625 cutoff without a test now gets lowestIB(cutoff - 25)
// and the BONUS_ONLY sentence, and the card says "needs HL Maths 4+".
const cc = (...a) => (typeof ie.convertCutoff === 'function' ? ie.convertCutoff(...a) : null);
equal('convertCutoff: 601 gives 42 with the bonus sentence', cc(601), { ib: 42, notes: [ie.BONUS_ONLY] });
equal('convertCutoff: 625 gives 44 with the bonus sentence', cc(625), { ib: 44, notes: [ie.BONUS_ONLY] });
equal('convertCutoff: 625 with a test gives no figure and no bonus sentence',
  cc(625, { test: true }), { ib: null, notes: [ABOVE_TEST_601] });
equal('convertCutoff: 626 gives no figure and the above-625 sentence', cc(626), { ib: null, notes: [ABOVE_SCALE] });
// D28 (2026-10-26): "HL Maths 4+ adds 25 bonus points." went on 126 rows by
// course title, though the bonus applies to any course. It is gone; the HL
// Maths 4+ tick says it once. convertCutoff no longer takes a title hint.
equal('convertCutoff: 600 gives 44 and no sentence, whatever the title (D28)',
  [cc(600), cc(600, { needsMaths: true })], [{ ib: 44, notes: [] }, { ib: 44, notes: [] }]);
check('BONUS_ONLY is the sentence the tools always wrote, and MATHS_BONUS is gone (D28)',
  ie.BONUS_ONLY === 'Only reachable with the 25 HL Maths bonus points.' && !('MATHS_BONUS' in ie));
const D28_SENTENCE = 'HL Maths 4+ adds 25 bonus points.';
const mathsLeft = live.filter((p) => p.deadlineNotes.includes(D28_SENTENCE));
check('no row says "HL Maths 4+ adds 25 bonus points." (D28)', mathsLeft.length === 0,
  mathsLeft.map((p) => p.id).join(', '));
for (const f of ['tools/lib/ireland.mjs', 'tools/lib/irish-import.mjs', 'tools/lib/cao-points.mjs',
  'tools/import-tcd.mjs', 'tools/import-ucd.mjs', 'tools/update-cao-points.mjs']) {
  check(`${f} has no title-based maths hint (needsMaths, MATHS_TITLE) (D28)`, !/needsMaths|MATHS_TITLE/.test(read(f)));
}
check('OLD_CAO_SENTENCES still strips the D28 sentence, so a refresh removes any left over',
  oldPatterns.some((re) => re.test(D28_SENTENCE)));
for (const f of ['tools/lib/irish-import.mjs', 'tools/import-tcd.mjs', 'tools/update-cao-points.mjs']) {
  const src = read(f);
  check(`${f} converts a cutoff with convertCutoff() and has no inline bonus maths`,
    src.includes('convertCutoff(') && !/points\s*[-−]\s*25/.test(src));
}
// T03: the CAO refresh stamped today's date on every Irish row it touched, as
// if the whole row had been re-checked. Only a person checking the row may.
check('T03 update-cao-points.mjs never writes last_verified or verified_by',
  !/col\.(last_verified|verified_by)\]\s*=(?!=)/.test(read('tools/update-cao-points.mjs')));
check('update-cao-points.mjs keeps UCD sentences by a list, not by matching Maths|625',
  !read('tools/update-cao-points.mjs').includes('Maths|625'));
const isIrish = (p) => /^(tcd|ucd|ucc|galway|dcu|ul|maynooth)-/.test(p.id);
const cutoffOf = (p) => latestOf(p)?.points ?? null;
const ucdConverted = live.filter((p) => p.id.startsWith('ucd-')
  && [ie.BONUS_ONLY, D28_SENTENCE, ie.aboveIB(610), ie.aboveIB(610, true), ie.aboveIB(700), ie.aboveIB(700, true)]
    .some((t) => p.deadlineNotes.includes(t)));
check('no UCD row carries a conversion sentence (UCD\'s figure is its own)', ucdConverted.length === 0,
  ucdConverted.map((p) => p.id).join(', '));
const CAO_TEST = 'Test, interview, portfolio or audition';
const shouldBonus = (p) => !p.id.startsWith('ucd-') && cutoffOf(p) > 600 && cutoffOf(p) <= 625
  && !p.otherRequirements.includes(ie.HPAT) && !p.otherRequirements.includes(CAO_TEST);
const bonusMismatch = live.filter(isIrish).filter((p) => shouldBonus(p) !== p.deadlineNotes.includes(ie.BONUS_ONLY));
check('every non-UCD Irish 601-625 cutoff without a test has the bonus sentence, and no other row does',
  bonusMismatch.length === 0, bonusMismatch.map((p) => p.id).join(', '));
const bonusRows = live.filter((p) => p.deadlineNotes.includes(ie.BONUS_ONLY));
const bonusWrongFigure = bonusRows.filter((p) => p.ibPointsMin !== ie.lowestIB(cutoffOf(p) - 25));
check('every row with the bonus sentence shows lowestIB(cutoff - 25)', bonusWrongFigure.length === 0,
  bonusWrongFigure.map((p) => `${p.id} ${p.ibPointsMin}`).join(', '));
const dataMod = await import(new URL('../js/data.js', import.meta.url));
check('js/data.js BONUS_ONLY matches tools/lib/ireland.mjs',
  typeof dataMod.BONUS_ONLY === 'string' && dataMod.BONUS_ONLY === ie.BONUS_ONLY);
const hlProg = [
  head,
  `p-hl,u,,Bonus,BSc,Engineering,English,44,,,,,,2027-05-01,${ie.BONUS_ONLY},https://example.org,2026-08-14,TT`,
  'p-plain,u,,Plain,BSc,Engineering,English,44,,,,,,2027-05-01,Some note.,https://example.org,2026-08-14,TT',
  `p-hl-blank,u,,Bonus blank,BSc,Engineering,English,,,,,,,2027-05-01,${ie.BONUS_ONLY},https://example.org,2026-08-14,TT`,
].join('\n') + '\n';
const { programmes: hl } = await load(uni, hlProg);
const hlRow = (id) => hl.find((p) => p.id === id);
equal('needsHlMaths: bonus sentence plus a figure is true; no sentence, or a blank figure, is false',
  ['p-hl', 'p-plain', 'p-hl-blank'].map((id) => hlRow(id)?.needsHlMaths), [true, false, false]);
const hlLive = live.filter((p) => p.needsHlMaths).map((p) => p.id).sort();
equal('needsHlMaths is on exactly the 601-625 rows without a test',
  hlLive, live.filter(isIrish).filter(shouldBonus).map((p) => p.id).sort());
// Since Phase 3 of plans/points-honesty.md the card says it per round, from
// pointsLines: the latest round's line carries "with HL Maths 4+".
const lastLine = (p) => { const l = pts.pointsLines(p); return pts.pointsLineText(l[l.length - 1]); };
const hlNoLine = live.filter((p) => p.needsHlMaths).filter((p) => !lastLine(p).endsWith(', with HL Maths 4+'));
check('the card says "with HL Maths 4+" on the latest round when needsHlMaths is set',
  hlLive.length > 0 && hlNoLine.length === 0, hlNoLine.map((p) => `${p.id}: ${lastLine(p)}`).join(', '));
console.log(`        ${bonusRows.length} rows need the HL Maths bonus`);

// P02 / Q12 option C (2026-10-25): every Irish cutoff above 625 includes a test
// score (HPAT Medicine, or the CAO "#" marker), so it is not a points total.
// Medicine used to say "No minimum published", though the CAO publishes one
// (480 points = 35 IB, UGMedEntry2027.pdf). None of these courses is hidden
// for its cutoff; HPAT Medicine hides below 35 like any other minimum.
check('HPAT_MIN_POINTS is 480, which converts to 35 IB points',
  ie.HPAT_MIN_POINTS === 480 && ie.lowestIB(480) === 35);
const hpatOut = { ib: 35, notes: [ie.HPAT_NOTE] };
equal('convertCutoff: an HPAT cutoff gives the CAO minimum and only the HPAT sentence, whatever the cutoff',
  [cc(741, { hpat: true, test: true }), cc(500, { hpat: true })], [hpatOut, hpatOut]);
equal('convertCutoff: 706 and 657 with a test give no figure and the plus-test sentence',
  [cc(706, { test: true }), cc(657, { test: true })],
  [{ ib: null, notes: [ie.PLUS_TEST] }, { ib: null, notes: [ie.PLUS_TEST] }]);
equal('convertCutoff: 741 without a test keeps the above-625 sentence', cc(741), { ib: null, notes: [ABOVE_SCALE] });
equal('convertCutoff: no cutoff (null) gives the HPAT minimum on HPAT courses and nothing otherwise',
  [cc(null, { hpat: true }), cc(null)], [hpatOut, { ib: null, notes: [] }]);
check('HPAT_NOTE and PLUS_TEST are plain strings', typeof ie.HPAT_NOTE === 'string' && typeof ie.PLUS_TEST === 'string');
for (const f of ['tools/lib/irish-import.mjs', 'tools/import-tcd.mjs', 'tools/update-cao-points.mjs']) {
  check(`${f} passes hpat: to convertCutoff`, /convertCutoff\([^]*?hpat:/.test(read(f)));
}
check('update-cao-points.mjs keeps HPAT_NOTE on UCD rows',
  /const ucdKeep = new Set\(.*HPAT_NOTE/.test(read('tools/update-cao-points.mjs')));
check('OLD_CAO_SENTENCES removes the plus-test sentence too',
  typeof ie.PLUS_TEST === 'string' && oldPatterns.some((re) => re.test(ie.PLUS_TEST)));
const irish = live.filter(isIrish);
const isHpatRow = (p) => p.otherRequirements.includes(ie.HPAT);
const hpatWrong = irish.filter((p) => isHpatRow(p)
  !== (p.deadlineNotes.includes(ie.HPAT_NOTE) && p.ibPointsMin === ie.lowestIB(480)));
check('every HPAT Irish row, and only those, has the HPAT sentence and the CAO minimum',
  typeof ie.HPAT_NOTE === 'string' && hpatWrong.length === 0, hpatWrong.map((p) => p.id).join(', '));
const plusTestWrong = irish.filter((p) => !isHpatRow(p) && cutoffOf(p) > 625)
  .filter((p) => p.ibPointsMin !== null || !p.deadlineNotes.includes(ie.PLUS_TEST));
check('every non-HPAT Irish cutoff above 625 has no figure and the plus-test sentence',
  typeof ie.PLUS_TEST === 'string' && plusTestWrong.length === 0, plusTestWrong.map((p) => p.id).join(', '));
const stillAbove = live.filter((p) => p.deadlineNotes.includes(ABOVE_SCALE));
check('no row says "Above the 625-point IB maximum" (every such cutoff includes a test)',
  stillAbove.length === 0, stillAbove.map((p) => p.id).join(', '));
check('js/data.js HPAT_NOTE and PLUS_TEST match tools/lib/ireland.mjs',
  typeof dataMod.HPAT_NOTE === 'string' && dataMod.HPAT_NOTE === ie.HPAT_NOTE
    && typeof dataMod.PLUS_TEST === 'string' && dataMod.PLUS_TEST === ie.PLUS_TEST);
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const testProg = [
  head,
  `p-hpat,u,,Medicine,MB,Medicine & Health,English,35,,,,,,2027-02-01,${q(dataMod.HPAT_NOTE)},https://example.org,2026-08-14,TT`,
  `p-hpat-blank,u,,Medicine blank,MB,Medicine & Health,English,,,,,,,2027-02-01,${q(dataMod.HPAT_NOTE)},https://example.org,2026-08-14,TT`,
  `p-test,u,,Music,BMus,Art & Design,English,,,,,,,2027-02-01,${q(dataMod.PLUS_TEST)},https://example.org,2026-08-14,TT`,
  `p-test-fig,u,,Music fig,BMus,Art & Design,English,30,,,,,,2027-02-01,${q(dataMod.PLUS_TEST)},https://example.org,2026-08-14,TT`,
  'p-plain2,u,,Plain,BSc,Engineering,English,35,,,,,,2027-02-01,Some note.,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: tp, meta: tpMeta } = await load(uni, testProg);
const tpRow = (id) => tp.find((p) => p.id === id);
equal('rankedWithHpat / pointsPlusTest follow the sentence and the figure',
  ['p-hpat', 'p-hpat-blank', 'p-test', 'p-test-fig', 'p-plain2']
    .map((id) => [tpRow(id)?.rankedWithHpat, tpRow(id)?.pointsPlusTest]),
  [[true, false], [false, false], [false, true], [false, false], [false, false]]);
check('the HPAT fixture parses cleanly', tpMeta.issues.length === 0, JSON.stringify(tpMeta.issues));
const hpatLive = live.filter((p) => p.rankedWithHpat);
equal('rankedWithHpat is on exactly the HPAT Irish rows, all at 35',
  hpatLive.map((p) => [p.id, p.ibPointsMin]).sort(),
  irish.filter(isHpatRow).map((p) => [p.id, 35]).sort());
equal('pointsPlusTest is on exactly the non-HPAT cutoffs above 625 and the TEST_IN_CUTOFF "#" courses (D27)',
  live.filter((p) => p.pointsPlusTest).map((p) => p.id).sort(),
  irish.filter((p) => !isHpatRow(p) && (cutoffOf(p) > 625
    || (pts.TEST_IN_CUTOFF.has(caoOf(p)?.code) && p.otherRequirements.includes(CAO_TEST)))).map((p) => p.id).sort());
const allLines = (p) => pts.pointsLines(p).map(pts.pointsLineText).join('; ');
check('the card says "then ranked with the HPAT" and "Cutoff includes a test score" under their flags',
  hpatLive.every((p) => allLines(p) === '35 IB points, then ranked with the HPAT')
    && live.filter((p) => p.pointsPlusTest).every((p) => allLines(p) === 'Cutoff includes a test score'),
  [...hpatLive, ...live.filter((p) => p.pointsPlusTest)].map((p) => `${p.id}: ${allLines(p)}`).join(', '));
// Unchanged behaviour, guarded: a blank figure is never hidden by My points,
// and the CAO minimum hides Medicine below 35 like any other minimum.
const { applyFilters, createFilterState } = await import(new URL('../js/filters.js', import.meta.url));
const withPoints = (n) => { const st = createFilterState(); st.myIbPoints = n; return st; };
const shown = (n) => applyFilters(tp, withPoints(n)).map((p) => p.id);
check('a plus-test row (no figure) is shown at 24 points', shown(24).includes('p-test'));
check('an HPAT row (35) is hidden at 34 and shown at 35', !shown(34).includes('p-hpat') && shown(35).includes('p-hpat'));
console.log(`        ${hpatLive.length} rows ranked with the HPAT, ${live.filter((p) => p.pointsPlusTest).length} with a test-score cutoff`);

// ---------------------------------------------------------------- CAO table and rounds

section('CAO table read by column, both rounds in the note (D29, Q4)');
// D29: the table was split on runs of two spaces, so a title with two spaces
// of its own (CK104, DC015) shifted Round 1 into Round 2, and a bare "#"
// (MH002) dropped the course. parseCaoTable reads the columns under the
// "RND 1" / "RND 2" headings instead. The fixture copies the real layout
// (2026-10-26: headings at columns 82 and 91).
const caoLine = (code, title, r1 = '', r2 = '') => `${`${code}  ${title}`.padEnd(82)}${r1.padEnd(9)}${r2}`.padEnd(127);
const caoHead = [`${''.padEnd(82)}2026     2026`, `${''.padEnd(82)}RND 1    RND 2`];
const caoFixture = [
  '<PRE>Points Required for Entry to 2026 Level 8 Courses', ...caoHead,
  '       University College Cork',
  caoLine('CK104', 'Arts - Music - 3 years or 4 years  (BMus or Chinese/European/Internation', '#367'),
  caoLine('DC015', 'Post Primary Teacher Education -  Technology, Engineering and Graphics', '420'),
  caoLine('MH002', 'Education - Primary Teaching - Gaeltacht  Applicants (Froebel)', '#'),
  caoLine('CM010', 'Education Studies', '316', '346v'),
  caoLine('TR028', 'Ancient and Medieval History and Culture', '497', '495*'),
  caoLine('TR093', 'General Nursing (Adelaide School of Nursing)', '#434', '#431'),
  caoLine('NC020', 'Marketing Practice', 'AQA', 'AQA'),
  caoLine('MH103', 'Music Audition', '#AQA', '#AQA'),
  caoLine('ID001', 'Accounting and Finance'),
  '', ...caoHead,
  caoLine('GC212', 'Accounting [Cork]', ',236'),
  caoLine('TR001', 'Both rounds drawn', '510*', '501*'),
].join('\n');
const caoMap = cp.parseCaoTable(caoFixture, { minCourses: 1 });
const roundsOf = (code) => { const e = caoMap.get(code); return e && [e.round1, e.round2].map((v) => v && [v.points, v.aqa, v.test, v.notAll]); };
equal('parseCaoTable: a title with two spaces keeps Round 1 in Round 1 (CK104, DC015)',
  [roundsOf('CK104'), roundsOf('DC015')], [[[367, false, true, false], null], [[420, false, false, false], null]]);
equal('parseCaoTable: a bare "#" is kept as a test with no figure (MH002)', roundsOf('MH002'), [[null, false, true, false], null]);
equal('parseCaoTable: two rounds, with "v", "*", "#", AQA and "#AQA"',
  ['CM010', 'TR028', 'TR093', 'NC020', 'MH103'].map(roundsOf),
  [[[316, false, false, false], [346, false, false, false]], [[497, false, false, false], [495, false, false, true]],
    [[434, false, true, false], [431, false, true, false]], [[null, true, false, false], [null, true, false, false]],
    [[null, true, true, false], [null, true, true, false]]]);
check('parseCaoTable: a course with no value is left out, and a second heading block reads the same',
  !caoMap.has('ID001') && caoMap.get('GC212')?.round1?.points === 236 && caoMap.get('TR001')?.latest?.points === 501);
equal('parseCaoTable: the title is the text between the code and the Round 1 column',
  caoMap.get('CK104')?.title, 'Arts - Music - 3 years or 4 years  (BMus or Chinese/European/Internation');
const throwsOn = (text) => { try { cp.parseCaoTable(text, { minCourses: 1 }); return false; } catch { return true; } };
check('parseCaoTable: headings in different columns stop the run ("layout has changed")',
  throwsOn(caoFixture.replace(`${''.padEnd(82)}RND 1    RND 2`, `${''.padEnd(80)}RND 1    RND 2`)));
check('parseCaoTable: a title running into the Round 1 column stops the run',
  throwsOn(caoFixture.replace(caoLine('CM010', 'Education Studies', '316', '346v'), `CM010  ${'x'.repeat(76)}316      346v`)));
check('parseCaoTable: the real-size guard (500 courses) still applies by default', (() => {
  try { cp.parseCaoTable(caoFixture); return false; } catch (e) { return /parsed only/.test(e.message); }
})());
check('fetchCaoPoints reads through parseCaoTable (no second parser)',
  /parseCaoTable\(await getHtml\(SOURCE\)\)/.test(read('tools/lib/cao-points.mjs'))
    && !/split\(\/\\s\\s\+\/\)/.test(read('tools/lib/cao-points.mjs')));

// Q4 (Leon, 2026-10-26): the note quotes both rounds, each labelled, with its
// own random-draw marker. Every shape caoNote writes must read back through
// parseCaoSentence, which the cards will use.
const v = (points, extra = {}) => ({ points, aqa: false, test: false, notAll: false, newComp: false, ...extra });
const ent = (round1, round2 = null) => ({ code: 'TR028', year: 2026, round1, round2, latest: round2 ?? round1 });
// The note does not carry "#", so either round must mark the whole course as
// needing a test. Looking only at latest.test lost a Round 1-only marker.
const testEntries = [ent(v(625, { test: true }), v(610)), ent(v(625), v(610, { test: true })), ent(v(600)), null];
equal('a test marker in either CAO round marks the course, including Round 1 only',
  testEntries.map((entry) => typeof cp.hasCaoTest === 'function' && cp.hasCaoTest(entry)),
  [true, true, false, false]);
equal('a Round 1-only test marker prevents a bonus IB figure for a 610 Round 2 cutoff',
  cc(testEntries[0].latest.points, { test: typeof cp.hasCaoTest === 'function' && cp.hasCaoTest(testEntries[0]) }),
  { ib: null, notes: [ABOVE_TEST_601] });
for (const f of ['tools/lib/irish-import.mjs', 'tools/import-tcd.mjs', 'tools/import-ucd.mjs', 'tools/update-cao-points.mjs']) {
  check(`${f} reads the course's test marker from both rounds`,
    read(f).includes('hasCaoTest(entry)') && !/latest\.test/.test(read(f)));
}
check('the CAO refresh preserves other requirements and adds a missing test tag',
  /other_requirements/.test(read('tools/update-cao-points.mjs'))
    && /!other\.includes\(CAO_TEST\)/.test(read('tools/update-cao-points.mjs')));
const shapes = [
  [ent(v(495)), 'one round', '2026 CAO cutoff: Round 1 495 points (code TR028).',
    [{ round: 1, points: 495, aqa: false, notAll: false }]],
  [ent(v(510), v(495)), 'two rounds', '2026 CAO cutoff: Round 1 510 points, Round 2 495 points (code TR028).',
    [{ round: 1, points: 510, aqa: false, notAll: false }, { round: 2, points: 495, aqa: false, notAll: false }]],
  [ent(v(497), v(495, { notAll: true })), 'random draw in Round 2',
    '2026 CAO cutoff: Round 1 497 points, Round 2 495 points (code TR028). Some applicants on that score missed out in Round 2 (random draw).',
    [{ round: 1, points: 497, aqa: false, notAll: false }, { round: 2, points: 495, aqa: false, notAll: true }]],
  [ent(v(497, { notAll: true }), v(495)), 'random draw in Round 1',
    '2026 CAO cutoff: Round 1 497 points, Round 2 495 points (code TR028). Some applicants on that score missed out in Round 1 (random draw).',
    [{ round: 1, points: 497, aqa: false, notAll: true }, { round: 2, points: 495, aqa: false, notAll: false }]],
  [ent(v(510, { notAll: true }), v(501, { notAll: true })), 'random draw in both rounds',
    '2026 CAO cutoff: Round 1 510 points, Round 2 501 points (code TR028). Some applicants on that score missed out in both rounds (random draw).',
    [{ round: 1, points: 510, aqa: false, notAll: true }, { round: 2, points: 501, aqa: false, notAll: true }]],
  [ent(v(420), v(null, { aqa: true })), 'AQA in Round 2',
    '2026 CAO cutoff: Round 1 420 points, Round 2 every qualified applicant got a place (code TR028).',
    [{ round: 1, points: 420, aqa: false, notAll: false }, { round: 2, points: null, aqa: true, notAll: false }]],
  [ent(v(434, { test: true }), v(431, { test: true })), '"#" stays out of the sentence',
    '2026 CAO cutoff: Round 1 434 points, Round 2 431 points (code TR028).',
    [{ round: 1, points: 434, aqa: false, notAll: false }, { round: 2, points: 431, aqa: false, notAll: false }]],
  [ent(v(null, { aqa: true }), v(null, { aqa: true })), 'whole-course AQA',
    '2026: every qualified applicant got a place (code TR028) — no cutoff.', []],
  [ent(v(null, { test: true })), 'a bare "#": no figure', 'No 2026 cutoff published (code TR028).', []],
];
for (const [entry, name, sentence, rounds] of shapes) {
  const note = cp.caoNote(entry);
  equal(`caoNote: ${name}`, note, sentence);
  equal(`parseCaoSentence reads back caoNote: ${name}`, pts.parseCaoSentence(`Before. ${note} After.`),
    { year: 2026, code: 'TR028', aqa: name === 'whole-course AQA', rounds });
  check(`rebuildNote replaces caoNote in place: ${name}`,
    cp.rebuildNote(`Before. ${note} After.`, 'NEW.') === 'Before. NEW. After.');
}
equal('parseCaoSentence reads the one-round sentence written before 2026-10-26 (round unknown)',
  pts.parseCaoSentence('2025 CAO cutoff: 544 points (code MH002). Some applicants on that score missed out (random draw).'),
  { year: 2025, code: 'MH002', aqa: false, rounds: [{ round: null, points: 544, aqa: false, notAll: true }] });
equal('rebuildNote puts the fresh block where the old one-round sentence was and drops the D28 sentence',
  cp.rebuildNote('Shared first. 2026 CAO cutoff: 497 points (code TR028). Some applicants on that score missed out (random draw). HL Maths 4+ adds 25 bonus points. Galway note.', 'NEW.'),
  'Shared first. NEW. Galway note.');
check('update-cao-points.mjs rebuilds notes with rebuildNote and keeps no OLD list of its own',
  read('tools/update-cao-points.mjs').includes('rebuildNote(notes, fresh)') && !/const OLD = \[/.test(read('tools/update-cao-points.mjs')));

// One conversion, in js/points.js, for the tools and the browser.
check('tools/lib/ireland.mjs takes lowestIB from js/points.js (the same function)', ie.lowestIB === pts.lowestIB);
check('the IB table is only in js/points.js', !/\[45, 600\]/.test(read('tools/lib/ireland.mjs')) && pts.TABLE[0][1] === 600);
equal('caoPointsFor: 45, 36, 24 and outside the table', [45, 36, 24, 23, 46].map(pts.caoPointsFor), [600, 497, 350, null, null]);
const disagree = [];
for (let n = 300; n <= 760; n++) {
  for (const test of [false, true]) {
    const a = ie.convertCutoff(n, { test });
    const b = pts.ibForCutoff(n, { test });
    if (a.ib !== b.ib || a.notes.includes(ie.BONUS_ONLY) !== b.bonusOnly) disagree.push(`${n}${test ? '#' : ''}`);
  }
}
check('ibForCutoff agrees with convertCutoff for every cutoff 300–760, with and without a test', disagree.length === 0,
  disagree.slice(0, 10).join(', '));

// Real data: every non-UCD Irish row with a CAO code reads back, and its
// figure is the conversion of the latest round.
const nonUcdCao = live.filter(isIrish).filter((p) => !p.id.startsWith('ucd-') && /\(code [A-Z]{2}\d{3}\)/.test(p.deadlineNotes));
const unparsed = nonUcdCao.filter((p) => !caoOf(p));
check('every non-UCD Irish row with a CAO code has a CAO sentence that parses', unparsed.length === 0,
  unparsed.map((p) => p.id).join(', '));
const figureWrong = nonUcdCao.filter((p) => caoOf(p)).filter((p) => {
  if (isHpatRow(p)) return p.ibPointsMin !== 35;
  const test = p.otherRequirements.includes(CAO_TEST);
  return p.ibPointsMin !== pts.ibForCutoff(latestOf(p)?.points ?? null, { test, code: caoOf(p).code }).ib;
});
check('every non-UCD Irish ib_points_min is ibForCutoff of its latest round (HPAT rows 35)', figureWrong.length === 0,
  figureWrong.map((p) => `${p.id} ${p.ibPointsMin}`).join(', '));
const bonusWrong = nonUcdCao.filter((p) => caoOf(p) && !isHpatRow(p)).filter((p) => {
  const test = p.otherRequirements.includes(CAO_TEST);
  return pts.ibForCutoff(latestOf(p)?.points ?? null, { test }).bonusOnly !== p.deadlineNotes.includes(ie.BONUS_ONLY);
});
check('BONUS_ONLY is on a row exactly when its latest round is bonus-only', bonusWrong.length === 0,
  bonusWrong.map((p) => p.id).join(', '));
const twoRound = live.filter((p) => caoOf(p)?.rounds.length === 2);
check('the two-round sentence is on the real rows (Round 1 first)', twoRound.length > 100
  && twoRound.every((p) => caoOf(p).rounds.map((r) => r.round).join() === '1,2'), `${twoRound.length} rows`);
console.log(`        ${nonUcdCao.length} non-UCD Irish rows with a CAO code, ${twoRound.length} rows quote two rounds`);

// ---------------------------------------------------------------- D27
section('"#" cutoffs whose test marks are added, or not confirmed (D27)');
// The CAO "#" says a course also has a test, interview, portfolio or audition,
// not that its marks are in the cutoff. The conversion used to treat every
// "#" cutoff at or below 600 as a points total, so UCC Theatre (#363, the
// workshop adds up to 100) showed about 26 IB points. Leon chose option 2 on
// 2026-11-02: 3 confirmed-added codes say "Cutoff includes a test score", 8
// unconfirmed say "Assessment required; IB equivalent unverified", and the
// separate pass/fail ones keep their figure. plans/d27-test-marked-cutoffs.md.
equal('D27 TEST_IN_CUTOFF holds the three confirmed codes',
  [...(pts.TEST_IN_CUTOFF ?? [])].sort(), ['CK112', 'DC014', 'GY261']);
equal('D27 TEST_UNVERIFIED holds CK114 and the seven UL codes',
  [...(pts.TEST_UNVERIFIED ?? [])].sort(), ['CK114', 'LM076', 'LM099', 'LM131', 'LM132', 'LM133', 'LM134', 'LM135']);
check('D27 the separate-requirement codes and HPAT codes are in neither list',
  ['TR025', 'TR093', 'DN300', 'CK104', 'LM103', ...ie.HPAT_CODES]
    .every((c) => !pts.TEST_IN_CUTOFF?.has(c) && !pts.TEST_UNVERIFIED?.has(c)));
equal('D27 testScoring needs the "#" marker and a listed code',
  [['CK112', true], ['CK114', true], ['CK112', false], ['LM103', true], [null, true]]
    .map(([c, t]) => (typeof pts.testScoring === 'function' ? pts.testScoring(c, t) : 'missing')),
  ['included', 'unverified', null, null, null]);
equal('D27 ibForCutoff gives no figure for a listed "#" code, and the old figure without the marker',
  [pts.ibForCutoff(363, { test: true, code: 'CK112' }), pts.ibForCutoff(300, { test: true, code: 'CK114' }),
    pts.ibForCutoff(389, { test: true, code: 'LM103' }), pts.ibForCutoff(363, { code: 'CK112' })],
  [{ ib: null, bonusOnly: false }, { ib: null, bonusOnly: false },
    pts.ibForCutoff(389, { test: true }), pts.ibForCutoff(363)]);
equal('D27 convertCutoff writes the added / unconfirmed sentence for listed codes',
  [cc(363, { test: true, code: 'CK112' }), cc(625, { test: true, code: 'LM099' }),
    cc(389, { test: true, code: 'LM103' }), cc(null, { test: true, code: 'CK112' })],
  [{ ib: null, notes: [ie.TEST_ADDED] }, { ib: null, notes: [ie.TEST_UNCONFIRMED] },
    cc(389, { test: true }), { ib: null, notes: [] }]);
const d27Disagree = [];
for (const code of ['CK112', 'CK114', 'LM103', null]) {
  for (let n = 300; n <= 760; n += 7) {
    for (const test of [false, true]) {
      if (ie.convertCutoff(n, { test, code }).ib !== pts.ibForCutoff(n, { test, code }).ib) d27Disagree.push(`${code}:${n}${test ? '#' : ''}`);
    }
  }
}
check('D27 convertCutoff and ibForCutoff agree with a code', d27Disagree.length === 0, d27Disagree.slice(0, 10).join(', '));
check('D27 OLD_CAO_SENTENCES strips both new sentences, so a refresh never doubles them',
  [ie.TEST_ADDED, ie.TEST_UNCONFIRMED].every((t) => typeof t === 'string' && oldPatterns.some((re) => re.test(t))));
for (const f of ['tools/lib/irish-import.mjs', 'tools/import-tcd.mjs', 'tools/update-cao-points.mjs']) {
  check(`D27 ${f} passes the CAO code to convertCutoff`, /convertCutoff\([^]*?hpat: HPAT_CODES\.has\(code\), code,/.test(read(f)));
}
// The browser ignores a figure the CSV still has from before the rule, so
// the cards are right before the CAO refresh rewrites the rows.
const d27Uni = 'university_id,name,city,country,application_system,living_cost_monthly,tuition_eu_default,tuition_noneu_default,english_requirement_default,student_life_url,last_verified,verified_by\n'
  + 'tcd,Trinity,Dublin,Ireland,CAO,,,,,,2026-08-14,TT\n'
  + 'ucd,UCD,Dublin,Ireland,CAO,,,,,,2026-08-14,TT\n'
  + 'nl,Dutch,Delft,Netherlands,Studielink,,,,,,2026-08-14,TT\n';
const d27Row = (id, uniId, ib, notes, other = '') =>
  `${id},${uniId},,${id},BSc,Engineering,English,${ib},,${q(other)},,,,2027-02-01,${q(notes)},https://example.org,2026-08-14,TT`;
const d27Prog = [
  head,
  d27Row('ie-added', 'tcd', 26, '2026 CAO cutoff: Round 1 363 points (code CK112).', dataMod.CAO_TEST),
  d27Row('ie-unver', 'tcd', 24, '2026 CAO cutoff: Round 1 300 points (code CK114).', dataMod.CAO_TEST),
  d27Row('ie-sep', 'tcd', 28, '2026 CAO cutoff: Round 1 389 points (code LM103).', dataMod.CAO_TEST),
  d27Row('ie-nomark', 'tcd', 26, '2026 CAO cutoff: Round 1 363 points (code CK112).'),
  d27Row('ucd-listed', 'ucd', 30, "UCD's stated minimum: 30 IB points. 2026 CAO cutoff: Round 1 363 points (code CK112).", dataMod.CAO_TEST),
  d27Row('nl-listed', 'nl', 30, '2026 CAO cutoff: Round 1 363 points (code CK112).', dataMod.CAO_TEST),
].join('\n') + '\n';
const { programmes: d27, meta: d27Meta } = await load(d27Uni, d27Prog);
check('D27 fixture parses cleanly', d27Meta.issues.length === 0, JSON.stringify(d27Meta.issues));
const d27Of = (id) => d27.find((p) => p.id === id);
equal('D27 figure, flags and card line per row',
  ['ie-added', 'ie-unver', 'ie-sep', 'ie-nomark', 'ucd-listed', 'nl-listed'].map((id) => {
    const p = d27Of(id);
    return p && [p.ibPointsMin, p.pointsPlusTest, p.pointsTestUnverified, pts.pointsLines(p).map(pts.pointsLineText).join('; ')];
  }),
  [[null, true, false, 'Cutoff includes a test score'],
    [null, false, true, 'Assessment required; IB equivalent unverified'],
    [28, false, false, '≈ 28 IB points, Round 1 cutoff, 2026'],
    [26, false, false, '≈ 26 IB points, Round 1 cutoff, 2026'],
    [30, false, false, '30 IB points, minimum'],
    [30, false, false, '30 IB points, minimum']]);
equal('D27 compact figure says why there is none',
  ['ie-added', 'ie-unver'].map((id) => pts.pointsShort(d27Of(id)).unknown),
  [{ verdict: 'No IB figure', reason: 'cutoff includes a test score' },
    { verdict: 'No IB figure', reason: 'assessment required, IB equivalent unverified' }]);
const d27Filters = await import(new URL('../js/filters.js', import.meta.url));
equal('D27 My points never hides them (unknown bucket)',
  ['ie-added', 'ie-unver'].map((id) => d27Filters.pointsBucket(d27Of(id), { myIbPoints: 24, hlMaths: false })), ['unknown', 'unknown']);
const d27Live = live.filter((p) => p.pointsTestUnverified || (p.pointsPlusTest && !(cutoffOf(p) > 625)))
  .map((p) => [p.id, p.pointsPlusTest ? 'added' : 'unverified']).sort();
equal('D27 real data: exactly the 11 chosen rows lose their figure', d27Live, [
  ['dcu-jazz-and-contemporary-music-performance', 'added'],
  ['galway-bachelor-of-business-studies-internat', 'added'],
  ['ucc-theatre-and-performative-practices', 'added'],
  ['ucc-youth-and-community-work', 'unverified'],
  ['ul-architecture-barch', 'unverified'],
  ['ul-contemporary-dance-ba', 'unverified'],
  ['ul-irish-dance-ba', 'unverified'],
  ['ul-irish-music-ba', 'unverified'],
  ['ul-music-ba', 'unverified'],
  ['ul-product-design-and-technology-bsc', 'unverified'],
  ['ul-voice-ba', 'unverified'],
]);
equal('D27 real data: the separate-requirement "#" rows keep their figure',
  ['tcd-drama-and-theatre-studies', 'tcd-nursing---general-nursing-adel', 'ucd-veterinary-medicine', 'ucc-arts-music', 'ul-paramedic-studies-bsc']
    .map((id) => typeof live.find((p) => p.id === id)?.ibPointsMin), ['number', 'number', 'number', 'number', 'number']);

// ---------------------------------------------------------------- minimum or cutoff
section('Cards say minimum or cutoff, with round and year (P01, Q4)');
// A published minimum and last year's CAO cutoff are different promises, and
// the card printed both as "N IB points". pointsKind is derived (no column
// yet, Q2 interim) and pointsLines says it, Round 1 first.
const kindUni = 'university_id,name,city,country,application_system,living_cost_monthly,tuition_eu_default,tuition_noneu_default,english_requirement_default,student_life_url,last_verified,verified_by\n'
  + 'tcd,Trinity,Dublin,Ireland,CAO,,,,,,2026-08-14,TT\n'
  + 'ucd,UCD,Dublin,Ireland,CAO,,,,,,2026-08-14,TT\n'
  + 'nl,Dutch,Delft,Netherlands,Studielink,,,,,,2026-08-14,TT\n';
const kindRow = (id, uniId, ib, notes, other = '') =>
  `${id},${uniId},,${id},BSc,Engineering,English,${ib},,${q(other)},,,,2027-02-01,${q(notes)},https://example.org,2026-08-14,TT`;
const kindProg = [
  head,
  kindRow('ie-two', 'tcd', 36, '2026 CAO cutoff: Round 1 510 points, Round 2 495 points (code TR028).'),
  kindRow('ie-one', 'tcd', 37, '2026 CAO cutoff: Round 1 508 points (code TR001).'),
  kindRow('ie-bonus', 'tcd', 44, `2026 CAO cutoff: Round 1 625 points (code TR002). ${ie.BONUS_ONLY}`),
  kindRow('ie-above-r1', 'tcd', 44, '2026 CAO cutoff: Round 1 630 points, Round 2 600 points (code TR003).'),
  kindRow('ie-test-r1', 'tcd', 44, '2026 CAO cutoff: Round 1 610 points, Round 2 600 points (code TR004).', dataMod.CAO_TEST),
  kindRow('ie-aqa-r2', 'tcd', 29, '2026 CAO cutoff: Round 1 400 points, Round 2 every qualified applicant got a place (code TR005).'),
  kindRow('ie-legacy', 'tcd', 40, '2025 CAO cutoff: 544 points (code MH002).'),
  kindRow('ucd-x', 'ucd', 33, "UCD's stated minimum: 33 IB points. 2026 CAO cutoff: Round 1 510 points (code DN100)."),
  kindRow('ie-hpat', 'tcd', 35, `2026 CAO cutoff: Round 1 738 points (code TR051). ${dataMod.HPAT_NOTE}`),
  kindRow('nl-min', 'nl', 36, ''),
  kindRow('ie-blank', 'tcd', '', '2026 CAO cutoff: Round 1 700 points (code TR006).'),
].join('\n') + '\n';
const { programmes: kinds, meta: kindMeta } = await load(kindUni, kindProg);
check('the minimum-or-cutoff fixture parses cleanly', kindMeta.issues.length === 0, JSON.stringify(kindMeta.issues));
const kindOf = (id) => kinds.find((p) => p.id === id);
const linesOf = (p) => pts.pointsLines(p).map(pts.pointsLineText);
equal('pointsKind: Irish cutoffs, UCD/HPAT/non-Irish minimums, blank none',
  ['ie-two', 'ie-legacy', 'ucd-x', 'ie-hpat', 'nl-min', 'ie-blank'].map((id) => kindOf(id)?.pointsKind),
  ['cutoff', 'cutoff', 'minimum', 'minimum', 'minimum', null]);
equal('pointsLines for each kind', Object.fromEntries(kinds.map((p) => [p.id, linesOf(p)])), {
  'ie-two': ['≈ 38 IB points, Round 1 cutoff, 2026', '≈ 36 IB points, Round 2 cutoff, 2026'],
  'ie-one': ['≈ 37 IB points, Round 1 cutoff, 2026'],
  'ie-bonus': ['≈ 44 IB points, Round 1 cutoff, 2026, with HL Maths 4+'],
  'ie-above-r1': ['Round 1 cutoff, 2026: above what any IB total can reach', '≈ 44 IB points, Round 2 cutoff, 2026'],
  'ie-test-r1': ['Round 1 cutoff, 2026: not an IB figure (includes a test score)', '≈ 44 IB points, Round 2 cutoff, 2026'],
  'ie-aqa-r2': ['≈ 29 IB points, Round 1 cutoff, 2026', 'Round 2, 2026: every qualified applicant got a place'],
  'ie-legacy': ['≈ 40 IB points, cutoff, 2025'],
  'ucd-x': ['33 IB points, minimum'],
  'ie-hpat': ['35 IB points, then ranked with the HPAT'],
  'nl-min': ['36 IB points, minimum'],
  'ie-blank': ['No minimum published'],
});
check('the CAO "#" tag marks a cutoff as including a test', kindOf('ie-test-r1')?.cao?.test === true
  && kindOf('ie-two')?.cao?.test === false);
check('js/render.js and js/shortlist.js both take the Points text from pointsLines',
  renderSrc.includes('pointsLines(row)') && read('js/shortlist.js').includes('pointsLines(r)'));

// The real data.
const withFigure = live.filter((p) => p.ibPointsMin !== null);
const kindWrong = live.filter((p) => (p.ibPointsMin === null ? p.pointsKind !== null : !['cutoff', 'minimum'].includes(p.pointsKind)));
check('every row with a figure has exactly one kind, and a blank row none', kindWrong.length === 0,
  kindWrong.map((p) => `${p.id} ${p.pointsKind}`).join(', '));
const cutoffs = live.filter((p) => p.pointsKind === 'cutoff');
const cutoffWrongUni = cutoffs.filter((p) => p.id.startsWith('ucd-') || p.rankedWithHpat || !isIrish(p));
check('no cutoff row is UCD, HPAT or outside Ireland', cutoffWrongUni.length === 0, cutoffWrongUni.map((p) => p.id).join(', '));
const ucdMinimum = live.filter((p) => p.id.startsWith('ucd-') && p.ibPointsMin !== null);
check('every UCD row with a figure is a minimum, including the ones that quote a CAO cutoff',
  ucdMinimum.every((p) => p.pointsKind === 'minimum') && ucdMinimum.filter((p) => caoOf(p)).length > 100,
  `${ucdMinimum.filter((p) => caoOf(p)).length} UCD rows quote a CAO cutoff`);
const cutoffLinesWrong = cutoffs.filter((p) => !linesOf(p).every((l) => l.includes(`cutoff, ${p.cao.year}`)
  && (p.cao.rounds.every((r) => r.round === null) || /^(≈ \d+ IB points, )?Round [12]/.test(l))));
check('every cutoff row\'s lines say "Round N cutoff" (or "cutoff" on the one-round 2025 shape) and the year',
  cutoffs.length > 300 && cutoffLinesWrong.length === 0,
  cutoffLinesWrong.slice(0, 5).map((p) => `${p.id}: ${linesOf(p).join(' | ')}`).join(', '));
const minimumSaysCutoff = live.filter((p) => p.pointsKind !== 'cutoff' && linesOf(p).some((l) => /cutoff/i.test(l) && !/includes a test/.test(l)));
check('no minimum (or blank) row says "cutoff", except the test-score sentence', minimumSaysCutoff.length === 0,
  minimumSaysCutoff.map((p) => p.id).join(', '));
check('every cutoff row\'s latest round converts to its ib_points_min',
  cutoffs.every((p) => p.cao.rounds[p.cao.rounds.length - 1].ib === p.ibPointsMin));
console.log(`        ${cutoffs.length} cutoff rows, ${withFigure.length - cutoffs.length} minimum rows, ${live.length - withFigure.length} with no figure`);

// ---------------------------------------------------------------- HL Maths tick
section('HL Maths 4+ tick and the split count (Q5, Q3, D28)');
// The tick adds the 25 CAO bonus points on Irish cutoff rows. It changes the
// labels and the count, never which rows are shown; unknown never hides.
const bucketProg = [
  head,
  kindRow('c-497', 'tcd', 36, '2026 CAO cutoff: Round 1 497 points (code TR101).'),
  kindRow('c-625', 'tcd', 44, `2026 CAO cutoff: Round 1 625 points (code TR102). ${ie.BONUS_ONLY}`),
  kindRow('c-test-520', 'tcd', 38, '2026 CAO cutoff: Round 1 520 points (code TR103).', dataMod.CAO_TEST),
  kindRow('c-test-560', 'tcd', 40, '2026 CAO cutoff: Round 1 560 points (code TR104).', dataMod.CAO_TEST),
  kindRow('c-r2', 'tcd', 36, '2026 CAO cutoff: Round 1 520 points, Round 2 497 points (code TR105).'),
  kindRow('c-r2-maths', 'tcd', 38, '2026 CAO cutoff: Round 1 530 points, Round 2 515 points (code TR106).'),
  kindRow('c-r2-higher', 'tcd', 38, '2026 CAO cutoff: Round 1 497 points, Round 2 520 points (code TR107).'),
  kindRow('ucd-33', 'ucd', 33, "UCD's stated minimum: 33 IB points. 2026 CAO cutoff: Round 1 600 points (code DN101)."),
  kindRow('ie-hpat35', 'tcd', 35, `2026 CAO cutoff: Round 1 738 points (code TR051). ${dataMod.HPAT_NOTE}`),
  kindRow('nl-37', 'nl', 37, ''),
  kindRow('blank', 'tcd', '', ''),
].join('\n') + '\n';
const { programmes: bk, meta: bkMeta } = await load(kindUni, bucketProg);
check('the bucket fixture parses cleanly', bkMeta.issues.length === 0, JSON.stringify(bkMeta.issues));
const fstate = (my, maths = false) => ({ ...filtersMod.createFilterState(), myIbPoints: my, hlMaths: maths });
const buckets = (my, maths) => Object.fromEntries(bk.map((p) => [p.id, filtersMod.pointsBucket(p, fstate(my, maths))]));
equal('buckets at 36 (497 CAO points), unticked', buckets(36, false), {
  'c-497': 'within', 'c-625': 'hidden', 'c-test-520': 'maths', 'c-test-560': 'unknown', 'c-r2': 'within',
  'c-r2-maths': 'maths', 'c-r2-higher': 'within', 'ucd-33': 'within', 'ie-hpat35': 'within', 'nl-37': 'hidden', blank: 'unknown',
});
equal('buckets at 36, ticked: the bonus counts, nothing new is hidden or shown', buckets(36, true), {
  'c-497': 'within', 'c-625': 'hidden', 'c-test-520': 'within', 'c-test-560': 'unknown', 'c-r2': 'within',
  'c-r2-maths': 'within', 'c-r2-higher': 'within', 'ucd-33': 'within', 'ie-hpat35': 'within', 'nl-37': 'hidden', blank: 'unknown',
});
equal('buckets at 44 (600): a 601–625 cutoff is only with HL Maths 4+ unticked, within ticked',
  [buckets(44, false)['c-625'], buckets(44, true)['c-625']], ['maths', 'within']);
equal('buckets at 32: a UCD 33 and an HPAT 35 minimum hide, ticked or not; a test cutoff never hides',
  [false, true].map((t) => [buckets(32, t)['ucd-33'], buckets(32, t)['ie-hpat35'], buckets(24, t)['c-test-560']]),
  [['hidden', 'hidden', 'unknown'], ['hidden', 'hidden', 'unknown']]);
equal('no bucket while My points is empty', filtersMod.pointsBucket(bk[0], filtersMod.createFilterState()), null);
check('a higher Round 2 does not raise the bar: the lower round (Round 1) decides',
  filtersMod.lowerRound(bk.find((p) => p.id === 'c-r2-higher').cao).round === 1);
const notes = (my, maths) => Object.fromEntries(bk.map((p) => [p.id, filtersMod.pointsNote(p, fstate(my, maths))]));
equal('card notes at 36, unticked', notes(36, false), {
  'c-497': null, 'c-625': null,
  'c-test-520': 'Within your IB points only with HL Maths 4+.',
  'c-test-560': 'Not compared with your IB points: the cutoff may include a test, interview, portfolio or audition.',
  'c-r2': 'Within your IB points on the Round 2 cutoff, not Round 1.',
  'c-r2-maths': 'Within your IB points only with HL Maths 4+. Within your IB points on the Round 2 cutoff, not Round 1.',
  'c-r2-higher': null, 'ucd-33': null, 'ie-hpat35': null, 'nl-37': null,
  blank: 'Not compared with your IB points: no IB figure.',
});
equal('card notes at 36, ticked: the bonus reaches Round 1 of c-r2 (522 ≥ 520) but not of c-r2-maths (530)',
  [notes(36, true)['c-r2'], notes(36, true)['c-r2-maths'], notes(36, true)['c-test-520']],
  [null, 'Within your IB points on the Round 2 cutoff, not Round 1.', null]);
const visible = (my, maths) => applyFilters(bk, fstate(my, maths)).map((p) => p.id);
equal('applyFilters drops only the hidden bucket', visible(36, false),
  bk.map((p) => p.id).filter((id) => !['c-625', 'nl-37'].includes(id)));
equal('pointsSummary at 36, unticked and ticked', [filtersMod.pointsSummary(bk, fstate(36)), filtersMod.pointsSummary(bk, fstate(36, true))],
  ['5 within your IB points · 2 only with HL Maths 4+ · 2 can’t be compared', '7 within your IB points · 2 can’t be compared']);
equal('pointsSummary leaves out an empty bucket and is empty without My points',
  [filtersMod.pointsSummary(bk.filter((p) => p.id === 'c-497'), fstate(36)), filtersMod.pointsSummary(bk, filtersMod.createFilterState())],
  ['1 within your IB points', '']);

// The real data, for every total a student can type.
const today = (p, my) => p.ibPointsMin === null || p.ibPointsMin <= my;
const realProblems = [];
for (let my = 24; my <= 45; my++) {
  const off = new Set(applyFilters(live, fstate(my, false)).map((p) => p.id));
  const on = new Set(applyFilters(live, fstate(my, true)).map((p) => p.id));
  for (const p of live) {
    if (today(p, my) && !off.has(p.id)) realProblems.push(`${my}: ${p.id} hidden, the old rule showed it`);
    if (off.has(p.id) !== on.has(p.id)) realProblems.push(`${my}: ${p.id} visibility changes with the tick`);
    if ((p.ibPointsMin === null || p.cao?.test) && !off.has(p.id)) realProblems.push(`${my}: ${p.id} blank or test cutoff hidden`);
    if (p.pointsKind !== 'cutoff' && filtersMod.pointsBucket(p, fstate(my, false)) !== filtersMod.pointsBucket(p, fstate(my, true))) {
      realProblems.push(`${my}: ${p.id} (not a cutoff) changes bucket with the tick`);
    }
  }
}
check('every total 24–45: unticked shows all the old rule showed, ticked shows the same rows, blanks and test cutoffs never hide, minimums ignore the tick',
  realProblems.length === 0, realProblems.slice(0, 8).join('\n        '));
const lowerNotLatest = cutoffs.filter((p) => filtersMod.lowerRound(p.cao) !== p.cao.rounds[p.cao.rounds.length - 1]
  || filtersMod.lowerRound(p.cao).ib !== p.ibPointsMin);
check('every cutoff row\'s lower round is its latest round and converts to its ib_points_min',
  lowerNotLatest.length === 0, lowerNotLatest.map((p) => p.id).join(', '));
const r2Rows = cutoffs.filter((p) => p.cao.rounds.length === 2 && p.cao.rounds[0].ib !== p.cao.rounds[1].ib);
console.log(`        ${r2Rows.length} cutoff rows convert differently between rounds; at 36 unticked: ${filtersMod.pointsSummary(applyFilters(live, fstate(36)), fstate(36))}`);

equal('maths=1 survives the address round trip; maths=yes and no maths are unticked',
  [paramsToState(stateToParams(fstate(36, true))).hlMaths, stateToParams(fstate(36, true)),
    paramsToState('points=36&maths=yes').hlMaths, paramsToState('points=36').hlMaths],
  [true, 'points=36&maths=1', false, false]);
check('the tick counts as a filter, so Clear all clears it',
  filtersMod.activeFilterCount(fstate(null, true)) === 1);
check('app.js restores, reads, clears and names the tick, and the count carries the split',
  appSrc.includes('dom.maths.checked = fromUrl.hlMaths') && appSrc.includes('state.hlMaths = dom.maths.checked')
    && appSrc.includes('dom.maths.checked = false') && englishSource(appSrc).includes("used.push('HL Maths 4+')")
    && appSrc.includes('pointsSummaryParts(rows, state)'));
// S08: the help lived only in a tooltip and a hidden copy. Spec §6.3: a
// visible p.help that the tick names with aria-describedby.
check('HL Maths 4+ help is a visible p.help describing the tick, with no tooltip or hidden copy; the fee reads "Max EU fee" with "€/year" (S08)',
  /<p class="help" id="f-maths-help">\+25 points on Irish courses<\/p>/.test(indexHtml)
    && /<input type="checkbox" id="f-maths"[^>]*aria-describedby="f-maths-help"/.test(indexHtml)
    && /<label class="tick">/.test(indexHtml) && !/<label class="tick"[^>]*title=/.test(indexHtml) && !indexHtml.includes('(adds the 25 CAO')
    && !/\.help\s*\{[^}]*(?:clip|position:\s*absolute)/.test(cssText)
    && /<label for="f-tuition">Max EU fee<\/label>/.test(indexHtml) && /<span class="unit">(?:<span>)?&euro;\/year(?:<\/span>)?<\/span>/.test(indexHtml)
    && !/id="f-tuition"[^>]*title=/.test(indexHtml));
check('points help is one short visible line that spans the bar, with no tooltip (S08, shortened 2026-11-02)',
  /<label for="f-points">My IB points<\/label>/.test(indexHtml)
    && /<p class="help filter-help" id="f-points-help">Hides programmes above your total.<\/p>/.test(indexHtml)
    && !/id="f-points"[^>]*title=/.test(indexHtml)
    && /\.filter-help\{grid-column:1\/-1;flex-basis:100%\}/.test(cssText)
    && cssText.includes('.is-set:not(.f-pts)>label::after{content:attr(data-active-label);'));
check('shared uncertainty help (points, fees, deadlines) travels inside the extra filters; fee and deadline name it (S08)',
  elementSource(indexHtml, /<div class="more-filters"/).includes('<p class="help filter-help" id="f-unknown-help">Unknown values never hide a programme.</p>')
    && /id="f-deadline" aria-describedby="f-unknown-help"/.test(indexHtml));
// Browser pass, 2026-10-26: at 320 px a two-round line broke "≈ 39" into one
// digit per line, because .req-points did not wrap (A02). Redesign stage 2:
// the number is .plines b, the line .plines li, inside .detail.
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBody = (selector) => [...cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel]) => sel.split(',').map((x) => x.trim()).includes(selector)).map(([, , body]) => body).join(';');
check('a Points line wraps its qualifier and keeps the number whole (320 px, A02)',
  /white-space:\s*nowrap/.test(ruleBody('.plines b')) && !/nowrap/.test(ruleBody('.plines li'))
    && /overflow-wrap:\s*anywhere/.test(ruleBody('.detail')) && /min-width:\s*0/.test(ruleBody('.detail')));
check('the card prints pointsNote, and the old "no published minimum" note is gone',
  renderSrc.includes('pointsNote(row, state)') && !renderSrc.includes('no published minimum'));

// ---------------------------------------------------------------- the detail
section('Each programme renders as the detail article (redesign stage 2, A01 A02 A04 A05 R01)');
// What a rendered detail must never do, on any row: an empty label, a dl that
// does not alternate dt/dd, an empty element, the points note missing or said
// twice, or the old "Tuition (EU)" / bare "No tuition fee" wording.
function detailProblems(row, state, slot = false) {
  const out = [];
  const a = withStubDocument(() => renderDetail(row, state, { slot }));
  const say = (what) => out.push(`${row.id}: ${what}`);
  const head = a.children[0];
  const title = head?.children[0];
  if (a.tagName !== 'article' || !a.classList.contains('detail')) say('not article.detail');
  if (!slot && (!head?.classList.contains('d-head') || title?.tagName !== 'h2')) say('heading is not first in .d-head');
  if (!slot && (title?.id !== `p-${row.id}` || a.getAttribute('aria-labelledby') !== title?.id)) say('not named by its title');
  if (slot && (!head?.classList.contains('d-pts') || byClass(a, 'd-head').length || byClass(a, 'd-cells').length || byTag(a, 'h2').length || a.getAttribute('aria-labelledby'))) say('slot repeats head or cells');
  for (const dl of byTag(a, 'dl')) {
    const kids = dl.children;
    if (kids.length === 0 || kids.length % 2 || kids.some((k, i) => typeof k === 'string' || k.tagName !== (i % 2 ? 'dd' : 'dt'))) say('a dl does not alternate dt/dd');
  }
  if (byTag(a, 'dt').some((dt) => !dt.textContent.trim())) say('empty dt');
  const empty = findAll(a, (n) => !['svg', 'use'].includes(n.tagName) && !n.textContent.trim() && byTag(n, 'svg').length === 0);
  if (empty.length) say(`empty ${empty.map((n) => `${n.tagName}.${n.className}`).join(' ')}`);
  const note = filtersMod.pointsNote(row, state);
  const pnotes = byClass(a, 'pnote');
  const two = a.children.findIndex((c) => c.classList?.contains('two'));
  const notesAt = a.children.findIndex((c) => c.classList?.contains('notes'));
  if (note === null ? pnotes.length !== 0
    : !(pnotes.length === 1 && pnotes[0].textContent === note && pnotes[0].parent === a.children[notesAt] && notesAt > two)) {
    say(`points note ${JSON.stringify(note)} not said exactly once after the facts`);
  }
  const lines = byClass(a, 'plines')[0]?.children.map((li) => li.textContent) ?? [];
  if (JSON.stringify(lines) !== JSON.stringify(pts.pointsLines(row).map(pts.pointsLineText))) say(`lines ${JSON.stringify(lines)}`);
  if (/Tuition \(EU\)|no tuition fee/.test(a.textContent)) say('old fee wording');
  return { out, id: title?.id };
}
const liveRuns = [['empty', noFilters()], ['36', fstate(36)], ['36 ticked', fstate(36, true)], ['37', fstate(37)]];
for (const [label, state] of liveRuns) {
  const shownRows = state.myIbPoints === null ? live : applyFilters(live, state);
  const results = shownRows.map((row) => detailProblems(row, state));
  const problems = results.flatMap((r) => r.out);
  const ids = results.map((r) => r.id);
  check(`every shown live row renders cleanly at My points ${label} (${shownRows.length} rows)`,
    shownRows.length > 0 && problems.length === 0 && new Set(ids).size === ids.length,
    problems.slice(0, 6).join('\n        '));
}
check('each detail is named by its title, on every live row (A05)', live.every((row) => {
  const a = detailOf(row);
  const h2 = byTag(a, 'h2')[0];
  return h2.id === `p-${row.id}` && a.getAttribute('aria-labelledby') === h2.id;
}));
check('the Czech-only live title is lang="cs" and its degree stays English',
  (() => {
    const row = live.find((p) => p.id === 'muni-anthropology');
    const h2 = row && byTag(detailOf(row), 'h2')[0];
    return h2?.lang === 'cs' && byClass(h2, 'deg')[0]?.lang === 'en'
      && byClass(h2, 'visually-hidden')[0]?.textContent === ', ';
  })());

// Named fixtures for the states no live row has today.
const fxCols = head.split(',').concat('admission');
const fxCsv = (rows) => `${fxCols.join(',')}\n${rows.map((r) => fxCols.map((c) => q(r[c] ?? '')).join(',')).join('\n')}\n`;
const fxUniCols = 'university_id,name,city,country,application_system,living_cost_monthly,student_life_url,baseline_requirement,last_verified,verified_by';
const fxUni = `${fxUniCols}\n`
  + 'fx,Fixture University,Town,Netherlands,Studielink,1100,https://example.org/life,a school diploma equivalent to Dutch VWO,2026-08-14,AI-DRAFT\n'
  + 'fy,Plain University,Town,Netherlands,,,,,2026-08-14,AI-DRAFT\n'
  + 'fs,Sample University,Town,Netherlands,,,,,2026-08-14,SAMPLE\n';
const fx = (id, extra = {}) => ({
  programme_id: id, university_id: 'fx', programme: id, degree_type: 'BSc', subject_area: 'Engineering', language: 'English',
  ib_points_min: '30', ib_subjects: 'HL Maths 5', tuition_eu: '2500', english_requirement: 'IELTS 6.5',
  application_deadline: '2027-02-01', official_url: 'https://example.org', last_verified: '2026-08-14', verified_by: 'AI-DRAFT', ...extra,
});
const fxRows = [
  fx('fx-plain'),
  fx('fx-zero', { tuition_eu: '0' }),
  fx('fx-fee-blank', { university_id: 'fy', tuition_eu: '' }),
  fx('fx-fee-q', { tuition_eu: '?' }),
  fx('fx-passed', { application_deadline: '2026-03-31' }),
  fx('fx-today', { application_deadline: '2026-08-14' }),
  fx('fx-tomorrow', { application_deadline: '2026-08-15' }),
  fx('fx-34', { application_deadline: '2026-09-17' }),
  fx('fx-no-deadline', { application_deadline: '' }),
  fx('fx-subjects-none', { ib_subjects: 'none' }),
  fx('fx-subjects-blank', { ib_subjects: '' }),
  fx('fx-admission', { admission: 'Entrance exam · Can be waived' }),
  fx('fx-admission-q', { admission: '?' }),
  fx('fx-english-q', { english_requirement: '?' }),
  fx('fx-nothing', { university_id: 'fx', ib_points_min: '', ib_subjects: 'none', english_requirement: '' }),
  fx('fx-no-general', { university_id: 'fy' }),
  fx('fx-nolink', { official_url: '' }),
  fx('fx-checked', { verified_by: 'JK' }),
  fx('fx-stale', { verified_by: 'JK', last_verified: '2025-06-01' }),
  fx('fx-entrance', { ib_points_min: '', admission: 'Entrance exam: maths' }),
  fx('fx-test-score', { ib_points_min: '', deadline_notes: dataMod.PLUS_TEST }),
  fx('fx-other', { other_requirements: 'Portfolio · Interview' }),
  fx('fx-no-applying', { university_id: 'fy', language: '' }),
];
const { programmes: fxs, meta: fxMeta } = await load(fxUni, fxCsv(fxRows));
check('the detail fixture parses with only the blank official_url reported',
  fxs.length === fxRows.length && fxMeta.issues.length === 1 && /official_url is blank/.test(fxMeta.issues[0]), JSON.stringify(fxMeta.issues));
const fxRow = (id) => fxs.find((p) => p.id === id);
const fxDetail = (id, state) => detailOf(fxRow(id), state);
check('S02 search does not match the site label "Unclassified"',
  subjectRows.every((r) => !r.searchBlob.includes('unclassified')));
for (const row of subjectRows) {
  // A mixed row ("Engineering; Enginering") says one of its subjects is off
  // the list; a row with nothing known says it is not classified.
  const note = row.subjectAreas.length > 1
    ? 'Not filtered by subject area: one of its subject areas is not on the subject list.'
    : 'Not filtered by subject area: its subject area is not classified.';
  equal(`${row.id}: subject filter note agrees with the unknown marker`,
    detailOf(row, engineeringFilter).textContent.includes(note), row.subjectAreas.includes(UNCLASSIFIED));
  check(`${row.id}: no subject note without an active subject filter`,
    !detailOf(row, noFilters()).textContent.includes(note));
}
const cellOf = (a, name) => byClass(a, name)[0];
const fillOf = (cell) => ['v-fit', 'v-cond', 'v-unk', 'v-time', 'v-past'].filter((c) => cell.classList.contains(c)).join(' ');
check('every fixture row renders cleanly with My points empty and at 36',
  [noFilters(), fstate(36)].every((st) => fxs.filter((r) => filtersMod.pointsBucket(r, st) !== 'hidden').every((r) => detailProblems(r, st).out.length === 0)),
  [noFilters(), fstate(36)].flatMap((st) => fxs.flatMap((r) => detailProblems(r, st).out)).slice(0, 6).join('\n        '));

// EU fee: blank is not zero.
equal('EU fee: €2,500 / year, "€0 · No tuition fee", and "Not published" (dashed) for blank and "?"',
  ['fx-plain', 'fx-zero', 'fx-fee-blank', 'fx-fee-q'].map((id) => {
    const cell = cellOf(fxDetail(id), 'c-fee');
    return [cell.children[0].textContent, byClass(cell, 'fig')[0].textContent, fillOf(cell)];
  }), [['EU fee', '€2,500 / year', ''], ['EU fee', '€0 · No tuition fee', ''], ['EU fee', 'Not published', 'v-unk'], ['EU fee', 'Not published', 'v-unk']]);

check('Irish detail fees explain contribution plus levy, with no extra label in compact rows or other countries',
  byClass(detailOf({ ...fxRow('fx-plain'), country: 'Ireland' }), 'c-fee')[0].textContent === 'EU fee€2,500 / yearStudent contribution + levyLiving €1,100/mo'
    && !byClass(fxDetail('fx-plain'), 'c-fee')[0].textContent.includes('Student contribution')
    // Never under "Not published": that would describe a fee we do not have.
    && !byClass(detailOf({ ...fxRow('fx-fee-blank'), country: 'Ireland' }), 'c-fee')[0].textContent.includes('Student contribution'));
// Deadline: long date, urgent with the clock, passed (neutral, struck) and none.
equal('Deadline cell: plain, 34 days, tomorrow, today, passed and not published',
  ['fx-plain', 'fx-34', 'fx-tomorrow', 'fx-today', 'fx-passed', 'fx-no-deadline'].map((id) => {
    const cell = cellOf(fxDetail(id), 'c-ddl');
    const verd = byClass(cell, 'verd')[0];
    const clock = byTag(cell, 'use').some((u) => u.getAttribute('href') === '#i-clock');
    return [fillOf(cell), verd?.textContent ?? null, byClass(cell, 'fig')[0].textContent, clock, byTag(cell, 's').length];
  }), [
    ['', null, '1 February 2027', false, 0],
    ['v-time', 'In 34 days', '17 September 2026', true, 0],
    ['v-time', 'Tomorrow', '15 August 2026', true, 0],
    ['v-time', 'Today', '14 August 2026', true, 0],
    ['v-past', 'Passed, check next cycle', '31 March 2026', false, 1],
    ['v-unk', null, 'Not published', false, 0],
  ]);
check('a passed row says "Check the official admissions page for the next cycle." under Applying, before its deadline notes',
  kvOf(fxDetail('fx-passed'))['Deadline notes']?.children[0]?.textContent === 'Check the official admissions page for the next cycle.'
    && !kvOf(fxDetail('fx-plain'))['Deadline notes']);
check('Irish deadline notes keep the CAO sentence in Applying', (() => {
  const row = live.find((p) => p.id === 'tcd-computer-science');
  return kvOf(detailOf(row))['Deadline notes']?.textContent === row.deadlineNotes && /TR033/.test(row.deadlineNotes);
})());

// Points lines: every form pointsLines can write, with a real space after the number.
const lineRows = [...kinds, fxRow('fx-test-score')];
const lineProblems = lineRows.flatMap((row) => byClass(detailOf(row), 'plines')[0].children.map((li, i) => {
  const line = pts.pointsLines(row)[i];
  const b = byTag(li, 'b')[0];
  const ok = li.textContent === pts.pointsLineText(line)
    && (line.number === null ? !b : b.textContent === line.number && li.children[1] === ` ${line.unit}, ${line.qualifier}`);
  return ok ? null : `${row.id}: ${JSON.stringify(li.textContent)}`;
})).filter(Boolean);
const renderedLines = lineRows.flatMap((row) => byClass(detailOf(row), 'plines')[0].children.map((li) => li.textContent));
const nineForms = [/IB points, minimum$/, /then ranked with the HPAT$/, /, with HL Maths 4\+$/, /^≈ 40 IB points, cutoff, 2025$/,
  /every qualified applicant got a place$/, /not an IB figure \(includes a test score\)$/, /above what any IB total can reach$/,
  /^Cutoff includes a test score$/, /^No minimum published$/];
check('every Points line renders as its pointsLineText, number in bold then a real space, and all nine forms appear',
  lineProblems.length === 0 && nineForms.every((re) => renderedLines.some((t) => re.test(t))),
  [...lineProblems, ...nineForms.filter((re) => !renderedLines.some((t) => re.test(t))).map(String)].join(', '));

// The verdict: a short marked line in the cell, the full pointsNote once after the facts.
const bkRow = (id) => bk.find((p) => p.id === id);
const verdictOf = (row, state) => {
  const a = detailOf(row, state);
  const cell = cellOf(a, 'c-pts');
  const verd = byClass(cell, 'verd');
  return [fillOf(cell), verd.length ? `${verd[0].className}: ${verd[0].textContent}` : null,
    byClass(a, 'pnote')[0]?.textContent ?? null, byClass(cell, 'pnote').length];
};
equal('verdict matrix: cell fill, short verdict, full note after the facts (never in the cell)', [
  verdictOf(bkRow('c-497'), fstate(36)),
  verdictOf(bkRow('c-r2'), fstate(36)),
  verdictOf(bkRow('ie-hpat35'), fstate(36)),
  verdictOf(bkRow('c-test-520'), fstate(36)),
  verdictOf(bkRow('c-r2-maths'), fstate(36)),
  verdictOf(bkRow('c-test-520'), fstate(36, true)),
  verdictOf(bkRow('c-test-560'), fstate(36)),
  verdictOf(bkRow('blank'), fstate(36)),
  verdictOf(fxRow('fx-test-score'), fstate(36)),
  verdictOf(fxRow('fx-entrance'), fstate(36)),
  verdictOf(bkRow('c-497'), noFilters()),
  verdictOf(bkRow('blank'), noFilters()),
], [
  ['v-fit', 'verd m m-fit: Within your IB points', null, 0],
  ['v-fit', 'verd m m-fit: Within your IB points', 'Within your IB points on the Round 2 cutoff, not Round 1.', 0],
  ['v-fit', 'verd m m-fit: Within your IB points, then HPAT', null, 0],
  ['v-cond', 'verd m m-cond: Only with HL Maths 4+', 'Within your IB points only with HL Maths 4+.', 0],
  ['v-cond', 'verd m m-cond: Only with HL Maths 4+', 'Within your IB points only with HL Maths 4+. Within your IB points on the Round 2 cutoff, not Round 1.', 0],
  ['v-fit', 'verd m m-fit: Within your IB points', null, 0],
  ['v-unk', 'verd m m-unk: Cutoff may include test marks', 'Not compared with your IB points: the cutoff may include a test, interview, portfolio or audition.', 0],
  ['v-unk', 'verd m m-unk: No minimum published', 'Not compared with your IB points: no IB figure.', 0],
  ['v-unk', 'verd m m-unk: No IB figure', 'Not compared with your IB points: no IB figure.', 0],
  ['v-unk', 'verd m m-unk: No IB figure', 'Not compared with your IB points: no IB figure.', 0],
  ['', null, null, 0],
  ['v-unk', null, null, 0],
]);
check('TCD Computer Science reads its live band: HL Maths 4+ at 36, within on Round 2 only at 37, no invented degree', (() => {
  const row = live.find((p) => p.id === 'tcd-computer-science');
  const at36 = verdictOf(row, fstate(36));
  const at37 = verdictOf(row, fstate(37));
  console.log(`        tcd-computer-science: ${pts.pointsLines(row).map(pts.pointsLineText).join(' | ')}; degree ${JSON.stringify(row.degreeType)}`);
  return at36[0] === 'v-cond' && at36[2] === 'Within your IB points only with HL Maths 4+.'
    && at37[0] === 'v-fit' && at37[2] === 'Within your IB points on the Round 2 cutoff, not Round 1.'
    && byClass(detailOf(row), 'deg').length === (row.degreeType ? 1 : 0);
})());

// Data rules in the markup.
equal('Subjects: "None required" for none, a dashed "Not checked yet" for blank',
  ['fx-subjects-none', 'fx-subjects-blank'].map((id) => {
    const dd = kvOf(fxDetail(id))['IB subjects'];
    return [dd.textContent, byClass(dd, 'unk-t').length];
  }), [['None required', 0], ['Not checked yet', 1]]);
equal('Admission and Other join their items with " · "; "?" admission is a dashed "Not published"',
  [kvOf(fxDetail('fx-admission')).Admission.textContent, kvOf(fxDetail('fx-other'))['Other requirements'].textContent,
    byClass(kvOf(fxDetail('fx-admission-q')).Admission, 'unk-t')[0]?.textContent, Boolean(kvOf(fxDetail('fx-plain')).Admission)],
  ['Entrance exam · Can be waived', 'Portfolio · Interview', 'Not published', false]);
equal('a "?" Language requirement is a dashed "Not published"',
  byClass(kvOf(fxDetail('fx-english-q'))['Language requirement'], 'unk-t')[0]?.textContent, 'Not published');
check('"nothing at all" is a plain sentence and no list',
  (() => {
    const a = fxDetail('fx-nothing');
    const req = byClass(a, 'd-sec')[0];
    return byTag(req, 'dl').length === 0
      && byClass(req, 'kv-none')[0]?.textContent === 'No IB subject requirements. General requirement: A school diploma equivalent to Dutch VWO. Language requirement not checked yet.';
  })());
check('a blank baseline leaves General out', !kvOf(fxDetail('fx-no-general'))['General requirement']
  && kvOf(fxDetail('fx-plain'))['General requirement']?.textContent === 'A school diploma equivalent to Dutch VWO');
check('an Applying section with nothing to say is left out, not drawn empty',
  (() => {
    const a = fxDetail('fx-no-applying');
    return byClass(a, 'd-sec').length === 1 && byClass(a, 'two')[0].children.length === 1;
  })());
equal('Applying: living costs, taught in and apply via',
  ['Living costs', 'Language', 'Apply via'].map((k) => kvOf(fxDetail('fx-plain'))[k]?.textContent),
  ['€1,100 / month', 'English', 'Studielink']);

// Notes, links and provenance.
const tuitionNote = 'Not filtered by your fee limit: the EU fee is unknown.';
const feeState = { ...noFilters(), maxTuition: 3000 };
check('the tuition note appears for an unknown fee only while Max fee is set',
  byClass(fxDetail('fx-fee-blank', feeState), 'note').some((n) => n.textContent === tuitionNote)
    && !byClass(fxDetail('fx-fee-blank'), 'note').length && !byClass(fxDetail('fx-plain', feeState), 'note').length);
// Jakub's My maths and Entrance exam filters keep a row nobody has checked, and
// the detail says so only while the filter is set and the cell is unknown.
{
  const notesOf = (row, state) => byClass(detailOf(row, state), 'note').map((n) => n.textContent);
  const mathsNote = 'Not filtered by your maths course: it depends on your other subjects or is unclear (see IB subjects).';
  const examNote = 'Not filtered by the entrance-exam choice: nobody has checked whether it has one.';
  const plainRow = fxRow('fx-plain');
  const unknownRow = { ...plainRow, mathsAccepted: null, entranceExam: null };
  const knownRow = { ...plainRow, mathsAccepted: ['AA HL'], entranceExam: 'no' };
  const maths = { ...noFilters(), myMaths: 'AA SL' }, exam = { ...noFilters(), exam: 'none' };
  check('My maths set + maths requirement unknown: the detail says "Not filtered by your maths course"; not for a known row, not when unset, not for the exam',
    notesOf(unknownRow, maths).includes(mathsNote) && !notesOf(unknownRow, maths).includes(examNote)
      && !notesOf(knownRow, maths).includes(mathsNote) && !notesOf(unknownRow, noFilters()).includes(mathsNote)
      && !notesOf(unknownRow, exam).includes(mathsNote), JSON.stringify(notesOf(unknownRow, maths)));
  check('Entrance exam set + exam unknown: the detail says "Not filtered by the entrance-exam choice"; not for a known row, not when unset, not for My maths',
    notesOf(unknownRow, exam).includes(examNote) && !notesOf(unknownRow, exam).includes(mathsNote)
      && !notesOf(knownRow, exam).includes(examNote) && !notesOf(unknownRow, noFilters()).includes(examNote)
      && !notesOf(unknownRow, maths).includes(examNote), JSON.stringify(notesOf(unknownRow, exam)));
  const examRowText = (entranceExam) => kvOf(detailOf({ ...plainRow, entranceExam }))['Entrance exam']?.textContent;
  equal('the Entrance exam row shows its three texts, and "Not checked yet" when nobody has checked',
    ['yes', 'waivable', 'no', null].map(examRowText),
    ['Entrance exam or test', 'Entrance exam — some IB applicants can skip it', 'No entrance exam', 'Not checked yet']);
}
check('no official link: a strong note, no button, and the row is still rendered',
  (() => {
    const a = fxDetail('fx-nolink');
    return byClass(a, 'note-strong')[0]?.textContent === 'No official admissions link. Do not rely on this entry.'
      && byClass(a, 'btn-p').length === 0;
  })());
check('the official link names its programme, opens a new tab safely, and has the external icon (A04)',
  (() => {
    const link = byClass(fxDetail('fx-plain'), 'btn-p')[0];
    return link?.tagName === 'a' && link.textContent === 'Official admissions page for fx-plain, Fixture University (opens in a new tab)'
      && link.href === 'https://example.org/' && link.target === '_blank' && link.rel === 'noopener noreferrer'
      && byTag(link, 'use')[0]?.getAttribute('href') === '#i-ext' && byTag(link, 'svg')[0]?.getAttribute('aria-hidden') === 'true';
  })());
check('a Student life link from the university, with its new-tab phrase',
  (() => {
    const link = byClass(fxDetail('fx-plain'), 'lnk')[0];
    return link?.textContent === 'Student life (opens in a new tab)' && link.href === 'https://example.org/life'
      && link.target === '_blank' && link.rel === 'noopener noreferrer'
      && !byClass(fxDetail('fx-no-general'), 'lnk').length;
  })());
const okOf = (row) => byClass(detailOf(row), 'ok')[0];
equal('provenance: AI-DRAFT none; signed "Checked <date> by JK"; stale adds the tag; signed without a date none',
  [okOf(fxRow('fx-plain')), okOf(fxRow('fx-checked'))?.textContent, okOf(fxRow('fx-stale'))?.textContent,
    byClass(okOf(fxRow('fx-stale')) ?? new ChromeNode('p'), 'tag')[0]?.textContent, okOf(tRow('t-signed'))?.textContent,
    okOf(noDateRows.find((p) => p.id === 'n-signed')), byClass(detailOf(fxRow('fx-plain')), 'tag').length],
  [undefined, 'Checked 14 August 2026 by JK', 'Checked 1 June 2025 by JK may be out of date', 'may be out of date',
    'Checked 14 August 2026 by JK', undefined, 0]);
check('signed under an AI-DRAFT university: fresh, so no stale tag', fxRow('fx-checked').isChecked && !fxRow('fx-checked').isStale
  && byClass(okOf(fxRow('fx-checked')), 'tag').length === 0 && byTag(okOf(fxRow('fx-checked')), 'use')[0]?.getAttribute('href') === '#i-check');
{
  const { programmes: sampleRows } = await load(fxUni, fxCsv([fx('fx-sample', { university_id: 'fs', verified_by: 'JK' })]));
  const a = detailOf(sampleRows[0]);
  check('a sample row shows its tag instead of any Checked line, and the article is marked',
    a.classList.contains('is-sample') && byClass(a, 'tag-strong')[0]?.textContent === 'Invented sample row · not real data'
      && byClass(a, 'ok').length === 0);
}
check('render.js calls pointsNote once, in renderDetail, and the cell builder does not',
  (renderSrc.match(/pointsNote\(/g) ?? []).length === 1 && renderDetailSrc.includes('pointsNote(row, state)'));
// The save star came back on 2026-11-03 (Leon): the rows now take the saved
// ids and the list view's group headings.
check('renderRows keeps its call contract: saved ids for the star, group headings',
  /export function renderRows\(container, rows, \{ state, shortlist = new Set\(\), wide = false, headings = new Map\(\) \}\)/.test(renderSrc)
    && /rows\.map\(\(row\) => renderRow\(row, state, wide, shortlist, headings\)\)/.test(renderSrc)
    && /renderRows\(dom.results, rows\.slice\(0, first\), \{ state, shortlist, wide: wideQuery.matches, headings: listHeadings \}\)/.test(appSrc));
// L09: the rows after the first screen are built by the same renderRow, in the
// list's applied mode.
check('appendRows keeps its call contract: same renderRow, items returned, applied mode',
  /export function appendRows\(container, rows, \{ state, shortlist = new Set\(\), wide = false, headings = new Map\(\) \}\) \{\n  const items = rows\.map\(\(row\) => renderRow\(row, state, wide, shortlist, headings\)\);\n  container\.append\(\.\.\.items\);\n  return items;/.test(renderSrc)
    && /arrive\(appendRows\(dom.results, rows, \{ state, shortlist, wide: appliedWide, headings: listHeadings \}\)\)/.test(appSrc));

// CSS: the detail paints canonical tokens only, and the old card is gone.
const oldTokens = ['--surface', '--ink-soft', '--ink-faint', '--line', '--line-soft', '--inset', '--warn', '--warn-soft', '--warn-line',
  '--save', '--save-soft', '--shadow-md', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--ease', '--dur', '--old-print-ink'];
const detailFamily = /\.(?:detail|d-[\w-]+|cell|c-pts|c-ddl|c-fee|v-[\w-]+|m|m-[\w-]+|plines|two|kv|kv-none|unk-t|tag|tag-strong|ok|notes|note|pnote|note-strong|btn|btn-p|lnk|lab|fig|verd|zf|dot)(?![\w-])/;
const detailRules = [...cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel]) => sel.split(',').some((arm) => detailFamily.test(arm) && !/\.bn-fail/.test(arm)));
const oldInDetail = detailRules.filter(([, , body]) => oldTokens.some((t) => new RegExp(`var\\(\\s*${t}\\s*[,)]`).test(body)));
check('all stylesheet rules use no old token', detailRules.length > 40 && oldInDetail.length === 0 && oldTokens.every((t) => !new RegExp(t + '(?![\\w-])').test(css)),
  oldInDetail.map(([sel]) => sel.trim()).join(', '));
check('no display:contents, and no .card rule left', !/display\s*:\s*contents/.test(cssRules)
  && !/\.card(?![\w-])/.test(cssRules) && /\.sk-row/.test(cssRules));
check('phone hit heights: .lnk uses --tap and .btn --ctl (44 px below 600)',
  /min-height:\s*var\(--tap\)/.test(ruleBody('.lnk')) && /height:\s*var\(--ctl\)/.test(ruleBody('.btn')));
check('off-screen rows are skipped on screen and printed in full',
  /content-visibility:\s*auto/.test(ruleBody('.item'))
    && /@media print[\s\S]*\.item \{[^}]*content-visibility: visible/.test(cssRules));
check('the sprite has the Phosphor i-ext, i-check and i-clock, and no old i-external',
  ['i-ext', 'i-check', 'i-clock', 'i-sort'].every((id) => indexHtml.includes(`<symbol id="${id}" viewBox="0 0 256 256">`))
    && !indexHtml.includes('id="i-external"') && !renderSrc.includes('i-external'));

// Retired tokens are rejected even with the old marker.
{
  const retired = css.replace(':root{', ':root{--surface: #f7f6f3; /* old: remove in stage 3 */');
  check('a marked old token is an unapproved root token', colourPolicyErrors(css).length === 0
    && colourPolicyErrors(retired).includes('Unapproved root token --surface'));
}

// ---------------------------------------------------------------- summary rows
section('Summary rows, on-demand slots and structured counts (redesign stage 3)');
const rowOf = (row, state = noFilters()) => withStubDocument(() => {
  const list = new ChromeNode('ul');
  renderRows(list, [row], { state, shortlist: new Set(), onToggleStar: () => {} });
  return list.children[0];
});
const ptsShort = (row) => pts.pointsShort(row);
const shortCases = {
  'ie-two': [['≈38', 'R1'], ['≈36', 'R2']], 'ie-one': [['≈37', 'R1']],
  'ie-bonus': [['≈44', 'R1']], 'ie-above-r1': [[null, 'R1: no IB figure'], ['≈44', 'R2']],
  'ie-test-r1': [[null, 'R1: no IB figure'], ['≈44', 'R2']], 'ie-aqa-r2': [['≈29', 'R1'], [null, 'R2: all qualified got a place']],
  'ie-legacy': [['≈40', 'cutoff 2025']], 'ucd-x': [['33', 'minimum']],
  'ie-hpat': [['35', 'minimum, then HPAT']], 'nl-min': [['36', 'minimum']], 'ie-blank': [],
};
equal('pointsShort: each minimum, HPAT, round, bonus, legacy, AQA and absent figure',
  Object.fromEntries(kinds.map((p) => [p.id, ptsShort(p).parts.map((x) => [x.figure, x.label])])), shortCases);
const mixed = { ...kindOf('ie-bonus'), cao: { ...kindOf('ie-bonus').cao,
  rounds: [{ round: 1, ib: 44, bonusOnly: true }, { round: 2, ib: 43, bonusOnly: false }] } };
const bothBonus = { ...mixed, cao: { ...mixed.cao, rounds: mixed.cao.rounds.map((r) => ({ ...r, ib: 44, bonusOnly: true })) } };
equal('pointsShort: mixed bonus labels stay per part; all bonus labels share an after line',
  [ptsShort(mixed), ptsShort(bothBonus)], [
    { parts: [{ figure: '≈44', label: 'R1 with HL Maths 4+' }, { figure: '≈43', label: 'R2' }], after: null, unknown: null },
    { parts: [{ figure: '≈44', label: 'R1' }, { figure: '≈44', label: 'R2' }], after: 'with HL Maths 4+', unknown: null },
  ]);
equal('pointsShort: null figures explain test, entrance exam or no minimum',
  ['fx-test-score', 'fx-entrance', 'fx-nothing'].map((id) => ptsShort(fxRow(id))), [
    { parts: [], after: null, unknown: { verdict: 'No IB figure', reason: 'cutoff includes a test score' } },
    { parts: [], after: null, unknown: { verdict: 'No IB figure', reason: 'entrance exam' } },
    { parts: [], after: null, unknown: { verdict: 'No minimum published', reason: null } },
  ]);
check('pointsShort: every live figure matches the corresponding pointsLines number, and unknown is exclusive', live.every((row) => {
  const short = ptsShort(row), lines = pts.pointsLines(row);
  return row.ibPointsMin === null ? short.parts.length === 0 && !!short.unknown
    : short.unknown === null && short.parts.length > 0 && short.parts.length === lines.length
      && short.parts.every((p, i) => p.figure === (lines[i].number?.replace(' ', '') ?? null));
}));
check('pointsShort dispatch stays null, cutoff, HPAT, minimum, even with overlapping flags',
  ptsShort({ ...kindOf('ie-two'), rankedWithHpat: true }).parts.length === 2
    && ptsShort({ ...kindOf('ie-two'), ibPointsMin: null }).unknown.verdict === 'No minimum published');
let helperAgreement = true;
for (let my = 24; my <= 45; my++) for (const tick of [false, true]) {
  const state = fstate(my, tick);
  const shown = applyFilters(live, state);
  if (filtersMod.pointsSummaryParts(shown, state).map((p) => p.text).join(' · ') !== filtersMod.pointsSummary(shown, state)) helperAgreement = false;
  for (const row of live) if (filtersMod.roundTwoOnly(row, state) !== !!filtersMod.pointsNote(row, state)?.includes('Within your IB points on the Round 2 cutoff, not Round 1.')) helperAgreement = false;
}
check('all live totals 24–45, ticked and unticked: summary parts and Round-2-only match the original sentences', helperAgreement);
equal('Round-2-only is false for empty, unknown and hidden buckets',
  [filtersMod.roundTwoOnly(bkRow('c-r2'), noFilters()), filtersMod.roundTwoOnly(bkRow('blank'), fstate(36)), filtersMod.roundTwoOnly(bkRow('c-r2'), fstate(24))], [false, false, false]);
check('pointsNote uses roundTwoOnly and render.js never duplicates its Round-1 comparison',
  read('js/filters.js').includes('if (roundTwoOnly(row, state))') && renderSrc.includes('roundTwoOnly(row, state)') && !renderSrc.includes('first.points'));
const rowPoints = (row, state) => {
  const c = cellOf(rowOf(row, state), 'c-pts');
  return [c.className.split(' ').find((s) => s.startsWith('v-')), byClass(c, 'verd')[0]?.textContent ?? null,
    byClass(c, 'fig')[0]?.textContent ?? null, byClass(c, 'r2')[0]?.textContent ?? null, byClass(c, 'q')[0]?.textContent ?? null];
};
equal('row points matrix: fit, R2, HPAT, conditional, test, null and empty', [
  rowPoints(bkRow('c-497'), fstate(36)), rowPoints(bkRow('c-r2'), fstate(36)), rowPoints(bkRow('ie-hpat35'), fstate(36)),
  rowPoints(bkRow('c-r2-maths'), fstate(36)), rowPoints(bkRow('c-test-520'), fstate(36, true)), rowPoints(bkRow('c-test-560'), fstate(36)),
  rowPoints(fxRow('fx-entrance'), noFilters()), rowPoints(bkRow('blank'), fstate(36)), rowPoints(kindOf('ie-bonus'), noFilters()),
  rowPoints(bkRow('c-625'), fstate(44)), rowPoints(bkRow('c-625'), fstate(44, true)),
], [
  ['v-fit', 'Within your IB points', '≈36 R1', null, null],
  ['v-fit', 'Within your IB points', '≈38 R1 · ≈36 R2', 'Round 2 cutoff only', null],
  ['v-fit', 'Within your IB points, then HPAT', '35 minimum', null, null],
  ['v-cond', 'Only with HL Maths 4+', '≈39 R1 · ≈38 R2', 'Round 2 cutoff only', null],
  ['v-fit', 'Within your IB points', '≈38 R1', null, null],
  ['v-unk', 'Cutoff may include test marks', '≈41 R1', null, null],
  ['v-unk', 'No IB figure', 'entrance exam', null, null],
  ['v-unk', 'No minimum published', null, null, null],
  ['v-none', null, '≈44 R1', null, 'with HL Maths 4+'],
  ['v-cond', 'Only with HL Maths 4+', '≈44 R1', null, null],
  ['v-fit', 'Within your IB points', '≈44 R1', null, null],
]);
check('TCD CS row reads the live figures and band at 36/36 ticked/37/empty', (() => {
  const row = live.find((p) => p.id === 'tcd-computer-science');
  const figure = ptsShort(row).parts.map((p) => `${p.figure} ${p.label}`).join(' · ');
  return rowPoints(row, fstate(36))[0] === 'v-cond' && rowPoints(row, fstate(36, true))[0] === 'v-fit'
    && rowPoints(row, fstate(37))[3] === 'Round 2 cutoff only'
    && rowPoints(row, noFilters())[0] === 'v-none' && rowPoints(row, fstate(36))[2] === figure;
})());
equal('row deadline: short plain date, countdowns, neutral passed and dashed unknown',
  ['fx-plain', 'fx-34', 'fx-tomorrow', 'fx-today', 'fx-passed', 'fx-no-deadline'].map((id) => {
    const c = cellOf(rowOf(fxRow(id)), 'c-ddl');
    return [fillOf(c), byClass(c, 'verd')[0]?.textContent ?? null, byClass(c, 'fig')[0].textContent, byTag(c, 's').length];
  }), [['', null, '1 Feb 2027', 0], ['v-time', 'In 34 days', new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-09-17T00:00:00Z')), 0], ['v-time', 'Tomorrow', '15 Aug 2026', 0],
    ['v-time', 'Today', '14 Aug 2026', 0], ['v-past', 'Passed, check next cycle', '31 Mar 2026', 1], ['v-unk', null, 'Not published', 0]]);
check('compact Irish fees keep the detail-only contribution note out of rows',
  !byClass(rowOf({ ...fxRow('fx-plain'), country: 'Ireland' }), 'c-fee')[0].textContent.includes('Student contribution'));
equal('row date: November and December use short names', [11, 12].map((m) => byClass(rowOf({ ...fxRow('fx-plain'), deadline: new Date(`2026-${m}-01T00:00:00Z`) }), 'c-ddl')[0].textContent),
  ['Deadline1 Nov 2026', 'Deadline1 Dec 2026']);
equal('row fee: known, zero, blank and ? keep distinct meanings',
  ['fx-plain', 'fx-zero', 'fx-fee-blank', 'fx-fee-q'].map((id) => byClass(rowOf(fxRow(id)), 'c-fee')[0].textContent),
  ['EU fee€2,500 / yearLiving €1,100/mo', 'EU fee€0 · No tuition feeLiving €1,100/mo',
    'EU feeNot publishedLiving cost not published', 'EU feeNot publishedLiving €1,100/mo']);
const sentenceRow = { ...fxRow('fx-checked'), languages: ['Czech'], otherRequirements: ['Portfolio'], admission: ['Entrance exam: maths'], isStale: true };
equal('row requirement groups are ordered and provenance follows them', byClass(rowOf(sentenceRow), 'line')[0].textContent,
  'Requires HL Maths 5 · Portfolio · Taught in Czech · Entrance exam: maths Checked by JKmay be out of date');
// Verify pass, 2026-10-27: the row's "Checked" badge was glued to the text
// before it ("mathsChecked by JK"), on screen and when read aloud. The mockup
// has a space and an 8px gap.
check('row Checked badge is spaced from the requirement text, and leads a provenance-only line with no space',
  /margin-left:8px/.test(ruleBody('.line .ok'))
    && byClass(rowOf({ ...fxRow('fx-checked'), ibSubjects: '', otherRequirements: [], admission: [], languages: ['English'] }), 'line')[0].textContent === 'Checked by JK');
check('Irish CAO default is dropped only on Irish rows; English-only and empty requirements add no line', (() => {
  const clean = { ...fxRow('fx-plain'), ibSubjects: '', otherRequirements: [], admission: [], languages: ['English'] };
  const cao = { ...clean, admission: ['Places offered in order of CAO points'] };
  return byClass(rowOf(clean), 'line').length === 0 && byClass(rowOf({ ...cao, country: 'Ireland' }), 'line').length === 0
    && byClass(rowOf(cao), 'line')[0].textContent === cao.admission[0];
})());
check('row provenance keeps the detail signature/date/sample chain',
  !byClass(rowOf(fxRow('fx-plain')), 'ok').length && !byClass(rowOf(noDateRows.find((p) => p.id === 'n-signed')), 'ok').length
    && byClass(rowOf(fxRow('fx-checked')), 'ok')[0]?.textContent === 'Checked by JK'
    && byClass(rowOf(fxRow('fx-stale')), 'tag')[0]?.textContent === 'may be out of date');
// Redesign revisions: the country is a word on a tint keyed by data-country.
// A country with no mapped pair renders the neutral badge without any code
// change, and every mapped pair (and the neutral one) is contrast-checked.
{
  const { PAIRS } = await import('./check-contrast.mjs');
  const mapped = [...cssRules.matchAll(/\.cc\[data-country="?([\w ]+?)"?\]\{background:var\((--[\w-]+)\);color:var\((--[\w-]+)\)\}/g)];
  const paired = (fg, bg) => PAIRS.some(([f, b, , min]) => f === fg && b === bg && min >= 4.5);
  const r = fxRow('fx-plain');
  const badge = (country) => byClass(rowOf({ ...r, country }), 'cc')[0];
  check('country badges: the eleven data countries are mapped, every mapped and the neutral pair has an enforced 4.5 contrast pair, and an unmapped country renders in words on the neutral tint',
    mapped.map(([, c]) => c).sort().join() === 'Austria,Czechia,Denmark,Finland,Germany,Ireland,Italy,Netherlands,Norway,Sweden,United Kingdom'
      && mapped.every(([, , bg, fg]) => paired(fg, bg)) && paired('--cty-ink', '--cty-fill')
      && /background:var\(--cty-fill\);color:var\(--cty-ink\)/.test(ruleBody('.cc'))
      && badge('Portugal')?.textContent === 'Portugal' && badge('Portugal').getAttribute('data-country') === 'Portugal'
      && !mapped.some(([, c]) => c === 'Portugal') && badge('Denmark')?.getAttribute('data-country') === 'Denmark'
      && new Set(live.map((row) => row.country)).size === 11 &&[...new Set(live.map((row) => row.country))].every((c) => mapped.some(([, m]) => m === c)));
}
check('requirements run across the row: the line is a direct child of .row after the three cells, never inside the title block',
  [...live.slice(0, 40), fxRow('fx-checked')].every((row) => {
    const li = rowOf(row), body = li.children[0], line = byClass(li, 'line')[0];
    if (!line) return true;
    const kids = body.children, at = kids.indexOf(line);
    return line.parent === body && at > kids.findIndex((n) => n.classList.contains('c-fee')) && !byClass(byClass(li, 'r-main')[0], 'line').length;
  }));
check('applied chips are named "Remove <label>", show the label and an aria-hidden cross, and keep their node when relabelled', withStubDocument(() => {
  const box = new ChromeNode('div');
  renderAppliedChips(box, [{ key: 'countries:Ireland', label: 'Country: Ireland' }], () => {});
  const first = box.children[0];
  renderAppliedChips(box, [{ key: 'countries:Ireland', label: 'Country: Ireland' }], () => {});
  const kept = box.children[0] === first;
  return kept && first.classList.contains('achip') && first.type === 'button'
    && first.textContent === 'Remove Country: Ireland×' && first.children[2].getAttribute('aria-hidden') === 'true'
    && first.children[0].classList.contains('visually-hidden');
}));
check('row sub line: known, unknown, blank city and unknown country are honest', (() => {
  const r = fxRow('fx-plain');
  return byClass(rowOf(r), 'uc')[0].textContent === 'Fixture University · Town'
    && byClass(rowOf({ ...r, cityUnknown: true }), 'uc')[0].textContent.endsWith('City not published')
    && byClass(rowOf({ ...r, city: '' }), 'uc')[0].textContent === 'Fixture University · City unknown'
    && byClass(rowOf({ ...r, country: 'Elsewhere' }), 'cc')[0].textContent === 'Elsewhere';
})());
for (const [label, state] of [...liveRuns, ['45', fstate(45)]]) {
  const shown = applyFilters(live, state);
  const list = withStubDocument(() => { const n = new ChromeNode('ul'); renderRows(n, shown, { state }); return n; });
  const rowProblems = list.children.filter((li, i) => li.tagName !== 'li' || !li.classList.contains('item') || li.getAttribute('data-id') !== shown[i].id
    || byClass(li, 'cell').length !== 3 || byClass(li, 'lab').length !== 3 || byTag(li, 'article').length
    || byClass(li, 'cc')[0]?.textContent !== shown[i].country || byClass(li, 'cc')[0]?.getAttribute('data-country') !== shown[i].country
    || byClass(li, 'cc')[0]?.getAttribute('aria-hidden') !== null || byClass(li, 'open')[0].getAttribute('aria-expanded') !== 'false');
  check(`all live rows are light, labelled and country coded at ${label}`, list.childElementCount === shown.length && !rowProblems.length);
  const problems = shown.flatMap((row) => detailProblems(row, state, true).out);
  check(`all live slot details preserve every fact and note at ${label}`, !problems.length, problems.slice(0, 6).join(', '));
}
check('all fixture slots render cleanly, including every short points form', [noFilters(), fstate(36), fstate(36, true), fstate(37)].every((st) =>
  [...fxs, ...kinds, ...bk].filter((r) => filtersMod.pointsBucket(r, st) !== 'hidden').every((r) => !detailProblems(r, st, true).out.length)));
check('slot regions have unique stable ids, resolved names and no duplicated head/cells', live.every((row) => {
  const slot = withStubDocument(() => renderSlot(row, noFilters()));
  return slot.id === `x-${row.id}` && slot.getAttribute('role') === 'region' && slot.getAttribute('aria-label') === `Details for ${row.programme}`
    && !indexHtml.includes(`id="${slot.id}"`) && !byClass(slot, 'd-head').length && !byClass(slot, 'd-cells').length;
}));
check('row button name separates degree and keeps Czech pronunciation', (() => {
  const row = live.find((p) => p.id === 'muni-anthropology'), item = rowOf(row), b = byClass(item, 'open')[0], degree = byClass(item, 'deg')[0];
  return b.lang === 'cs' && degree?.lang === 'en' && b.textContent === row.programme
    && degree.textContent === row.degreeType && b.getAttribute('aria-describedby').split(' ').includes(degree.id) && !byClass(b, 'deg').length;
})());
check('sample row carries its tag and never a Checked line', (() => {
  const row = { ...fxRow('fx-checked'), isSample: true }, li = rowOf(row);
  return li.classList.contains('is-sample') && byClass(li, 'tag-strong')[0]?.textContent === 'Invented sample row · not real data' && !byClass(li, 'ok').length;
})());
check('count builds marks with identical text, preserves nodes on no change and rebuilds on change', withStubDocument(() => {
  const n = new ChromeNode('p'), parts = filtersMod.pointsSummaryParts(bk, fstate(36));
  const first = renderCount(n, '9 of 11 programmes', parts), children = [...n.children];
  const same = renderCount(n, '9 of 11 programmes', parts);
  const kept = children.every((c, i) => c === n.children[i]);
  const text = n.textContent === `9 of 11 programmes · ${filtersMod.pointsSummary(bk, fstate(36))}`;
  const marks = byClass(n, 'k').map((x) => x.className).join(' ') === 'k k-fit m m-fit k k-cond m m-cond k k-unk m m-unk';
  return first && !same && kept && text && marks && renderCount(n, '11 programmes', []) && n.textContent === '11 programmes';
}));
const headerButtons = [...indexHtml.matchAll(/<button[^>]*data-sort="([^"]+)"[^>]*>[\s\S]*?<\/button>/g)];
check('sort header has all four SORTS keys, hidden direction text and one default pressed button',
  headerButtons.length === 4 && headerButtons.map((m) => m[1]).sort().join() === Object.keys(filtersMod.SORTS).sort().join()
    && headerButtons.filter((m) => /aria-pressed="true"/.test(m[0])).length === 1
    && headerButtons.every((m) => m[0].includes('class="visually-hidden"')));
check('sort sync runs before load, after options and from both sort controls',
  /applyUrlFields\(\);\s*syncSort\(\);/.test(appSrc) && /renderSortOptions\([^;]+;\s*syncSort\(\);/.test(appSrc)
    && /\[state.sort, state.dir\] = dom.sort.value.split\(':'\);\s*syncSort\(\);/.test(appSrc) && /state.sort = key;\s*syncSort\(\);/.test(appSrc));
check('row toggle retains slots while arrows select only wide without roving tabindex',
  appSrc.includes("button.removeAttribute('aria-controls')") && appSrc.includes('openIds.delete(id)') && appSrc.includes('openIds.has(id)) openRow(item, shownRows.get(id))')
    && /ArrowUp/.test(appSrc) && /ArrowDown/.test(appSrc) && /isComposing/.test(appSrc)
    && !/listbox|setAttribute\(['"]tabindex/.test(appSrc));
check('six static skeleton rows, hidden trap guarded, no compass, no empty live region',
  (indexHtml.match(/class="sk-row"/g) ?? []).length === 6 && /id="loading" aria-hidden="true"/.test(indexHtml)
    && !/shimmer|@keyframes/.test(css) && /\[hidden\] \{ display: none !important; \}/.test(css)
    && !indexHtml.includes('i-compass') && !/<div[^>]*(?:role|aria-live)=[^>]*id="empty-state"|id="empty-state"[^>]*(?:role|aria-live)=/.test(indexHtml));
check('empty h2, search tips and Clear all count are present',
  indexHtml.includes('<h2 id="empty-title">') && indexHtml.includes('Words can appear in any order')
    && indexHtml.includes('Short words match the start of a word') && appSrc.includes("t('clear_all', { value1: activeFilterCount(state) })") && UI.en.clear_all === 'Clear all ({value1})');
check('row wraps whole point parts without clipping requirements; containment only on items',
  /white-space:nowrap/.test(ruleBody('.pt')) && !/white-space:\s*nowrap/.test(ruleBody('.row .cell'))
    && !/line-clamp|max-height|overflow\s*:\s*hidden/.test(ruleBody('.line'))
    && !/content-visibility/.test(ruleBody('.detail') + ruleBody('.expand') + ruleBody('.results>.detail'))
    && /contain-intrinsic-size:auto/.test(ruleBody('.item')) && /border:0;border-radius:0/.test(ruleBody('.expand-inner>.detail')));
check('all CSS variable references are canonical or page variables, with shadow reserved for the pane',
  [...cssRules.replace(/:root\s*\{[^{}]*\}/g, '').matchAll(/var\((--[\w-]+)/g)].every(([, t]) =>
    new RegExp(`${t}\\s*:`).test(cssRules.match(/:root\s*\{([^{}]*)\}/)[1]) || ['--gut', '--ctl', '--fs-ctl', '--tap'].includes(t))
    && (css.match(/var\(--shadow\)/g) ?? []).length === 1
    && /box-shadow:var\(--shadow\)/.test(cssRules.match(/\.pane\{display:block;[^}]+/)?.[0] ?? ''));

// An overly broad slice starting at the gallery's first .listp copied chrome
// as well as rows. Guard the actual duplicate-selector/static-layout failure.
const baseSelectors = [];
let braceDepth = 0, ruleStart = 0;
for (let i = 0; i < cssRules.length; i++) {
  if (cssRules[i] === '{') {
    if (braceDepth === 0) {
      const selector = cssRules.slice(ruleStart, i).trim();
      if (!selector.startsWith('@')) baseSelectors.push(...selector.split(',').map((x) => x.trim()));
    }
    braceDepth++;
  } else if (cssRules[i] === '}') {
    braceDepth--;
    if (braceDepth === 0) ruleStart = i + 1;
  }
}
// Stage 5 owns the filter, sheet and count classes, so they are allowed now;
// the gallery-only rules and the mockup's scrim node stay out.
// Redesign revisions: the one deliberate @container is the list's 900 px
// query (on .listp); any other container query or container is still a copy.
const containerQueriesOk = (source) => (source.match(/@container[^{]*/g) ?? []).every((q) => q.trim() === '@container (min-width: 900px)')
  && (source.match(/container(?:-type)?\s*:/g) ?? []).length === 1 && /\.listp\{[^}]*container-type:inline-size/.test(source);
check('CSS contains no copied mockup gallery, container or scrim rules; the only container query is the list at 900 px',
  !/\.g-h3\b|\.app\s*\{\s*container\s*:|\.listp\s*\{\s*justify-self\s*:|\.spec\s+\.dd(?![\w-])|\.scrim(?![\w-])/.test(cssRules)
    && containerQueriesOk(cssRules) && !containerQueriesOk(cssRules + '@container (min-width: 1024px){.row{gap:0}}')
    && !containerQueriesOk(cssRules + '.app{container-type:inline-size}'));
check('chrome has exactly one base definition each, and stickiness follows A07',
  ['.status', '.mast', '.src', '.lang', '.bn', '.foot', '.fbar', '.sheet', '.cols'].every((sel) => baseSelectors.filter((s) => s === sel).length === 1)
    && stickyChromeOk(css));
check('every live and fixture requirements line preserves source facts in order', [...live, ...fxs, ...kinds, ...bk].every((row) => {
  const li = rowOf(row), line = byClass(li, 'line')[0];
  const wanted = [row.ibSubjects, ...row.otherRequirements,
    ...(row.languages.length === 1 && row.languages[0] === 'English' ? [] : row.languages),
    ...row.admission.filter((text) => !(row.country === 'Ireland' && text === 'Places offered in order of CAO points'))].filter(Boolean);
  let at = 0;
  for (const text of wanted) {
    const found = line?.textContent.indexOf(text, at) ?? -1;
    if (found < 0) return false;
    at = found + text.length;
  }
  return li.getAttribute('aria-hidden') === null
    && byClass(li, 'open')[0].getAttribute('aria-hidden') === null
    && (!line || line.getAttribute('aria-hidden') === null);
}));

// Keep media ancestry: flattened selector matches cannot prove confinement.
function cssTree(source, media = []) {
  const rules = [];
  let start = 0;
  while (start < source.length) {
    const brace = source.indexOf('{', start);
    if (brace < 0) break;
    let end = brace + 1, depth = 1;
    for (; end < source.length && depth; end++) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
    }
    const selector = source.slice(start, brace).trim(), body = source.slice(brace + 1, end - 1);
    // @starting-style nests rules like @media; keep it as ancestry too (Stage 6).
    // @container too (redesign revisions): the 900 px list query is ancestry.
    if (selector.startsWith('@media') || selector.startsWith('@starting-style') || selector.startsWith('@container')) rules.push(...cssTree(body, [...media, selector]));
    else rules.push({ selector, body, media });
    start = end;
  }
  return rules;
}
// A07 (spec §10): nothing in the header band sticks, in any media context;
// .cols sticks only in the 600 block; .status sticks only in the base rules
// and the 600 block puts it back to static.
function stickyChromeOk(source) {
  const rules = cssTree(source.replace(/\/\*[\s\S]*?\*\//g, ''));
  const header = /(?:^|[\s,>+~(])(?:header|h1|\.(?:top|mast|mast-top|mast-id|tagline|lang|src|stat|src-more|fbar|fld|f-q|f-pts|f-hl|f-fee|f-sort|affix|unit|inp|tick|help|err|more|more-filters|dropdown|dropdown-panel|dropdown-count|options|option|clear))(?![\w-])/;
  const sticky = (r) => /position\s*:\s*(?:sticky|fixed)/.test(r.body);
  const arms = (r) => r.selector.split(',').map((x) => x.trim());
  const in600 = (r) => r.media.length === 1 && r.media[0] === '@media (min-width: 600px)';
  return rules.every((r) => !(sticky(r) && (header.test(r.selector)
      || (arms(r).some((a) => /\.cols(?![\w-])/.test(a)) && !in600(r))
      || (arms(r).some((a) => /\.status(?![\w-])/.test(a)) && r.media.length))))
    && rules.some((r) => !r.media.length && arms(r).includes('.status') && /position:sticky;top:0/.test(r.body))
    && rules.some((r) => in600(r) && arms(r).includes('.status') && /position:static/.test(r.body))
    && rules.some((r) => in600(r) && arms(r).includes('.cols') && /position:sticky;top:0/.test(r.body));
}
const paneCss = cssTree(cssRules);
const atMedia = (r, query) => r.media.length === 1 && r.media[0] === `@media ${query}`;
const paneRule = (selector, query) => paneCss.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)
  && (query ? atMedia(r, query) : r.media.length === 0)).map((r) => r.body).join(';');
// Redesign revisions (2026-10-28): one pane query at 1200 (was 1024/1280);
// where a row's facts sit is a 900 px container query on the list.
const desktopQuery = '(min-width: 1200px)', listQuery = '@container (min-width: 900px)';
function confinedPaneRules(source) {
  return cssTree(source).every((r) => {
    const sels = r.selector.split(',').map((s) => s.trim());
    if (sels.includes('.split') && !atMedia(r, desktopQuery) && !atMedia(r, 'print')) return false;
    return !(sels.includes('.pane') && /position\s*:\s*sticky/.test(r.body) && !atMedia(r, desktopQuery));
  });
}
check('app and CSS share the 1200 pane query; no 1280 block or pane rule at 1024; shadow belongs only to its pane rule',
  appSrc.includes("matchMedia('(min-width: 1200px)')") && !appSrc.includes("matchMedia('(min-width: 1024px)')")
    && paneCss.some((r) => atMedia(r, desktopQuery)) && !/min-width:\s*1280px/.test(cssRules)
    && !paneCss.some((r) => r.media.some((m) => /1024px/.test(m)) && /\.(?:split|pane|row|cols|chev|is-sel|goto)(?![\w-])/.test(r.selector))
    && paneCss.filter((r) => /var\(--shadow\)/.test(r.body)).every((r) => r.selector === '.pane' && atMedia(r, desktopQuery)));
check('desktop split and sticky pane stay in their media blocks; negative base fixtures fail',
  confinedPaneRules(cssRules) && !confinedPaneRules(cssRules + '.split{display:grid}')
    && !confinedPaneRules(cssRules + '.pane{position:sticky}')
    && !confinedPaneRules(cssRules + '@media (min-width: 1200px) and (min-height: 600px){.pane{position:sticky}}'));
// The arrow fix (Phase 3 diagnosis): headings and rows share ONE template, gap
// and inset in every context where the headings show, written as a single
// ".cols,.row" rule, and nothing else sets their columns, gap or inset there.
const trackRules = (media) => paneCss.filter((r) => r.media.join('|') === media.join('|'));
function sharedTracks(rules, media, template) {
  const here = rules.filter((r) => r.media.join('|') === media.join('|'));
  const shared = here.filter((r) => r.selector.replace(/\s/g, '') === '.cols,.row');
  const stray = here.filter((r) => r.selector.replace(/\s/g, '') !== '.cols,.row'
    && r.selector.split(',').some((x) => ['.cols', '.row'].includes(x.trim()))
    && /grid-template-columns|column-gap|padding-inline|padding-left|padding-right|(?:^|;)\s*padding\s*:|(?:^|;)\s*gap\s*:/.test(r.body));
  return shared.length === 1 && shared[0].body.includes(`grid-template-columns:${template}`) && !stray.length;
}
const tracksOk = (rules) => sharedTracks(rules, [listQuery], 'minmax(320px,1fr) 206px 146px 124px 16px')
  && /column-gap:12px;padding-inline:16px/.test(trackRules([listQuery]).find((r) => r.selector === '.cols,.row')?.body ?? '')
  && sharedTracks(rules, [`@media ${desktopQuery}`, listQuery], 'minmax(320px,1fr) 206px 146px 124px');
check('headings and rows share one track template, gap and inset at the 900 px list query, with and without the chevron track; split rows fail',
  tracksOk(paneCss)
    && !tracksOk(cssTree(cssRules + '@container (min-width: 900px){.cols{column-gap:8px}}'))
    && !tracksOk(cssTree(cssRules + '@container (min-width: 900px){.row{padding-inline:12px}}'))
    && /grid-template-columns:minmax\(0,1fr\) var\(--pane-w\)/.test(paneRule('.split', desktopQuery))
    && /--pane-w:380px/.test(cssRules) && /display:none/.test(paneRule('.chev', desktopQuery))
    && /container-type:inline-size/.test(paneRule('.listp')) && /display:grid/.test(trackRules([listQuery]).filter((r) => r.selector === '.cols').map((r) => r.body).join(';'))
    && /display:none/.test(trackRules([listQuery]).filter((r) => r.selector === '.listp>.f-sort').map((r) => r.body).join(';'))
    && /display:none/.test(paneRule('.cols')) && /display:flex/.test(paneRule('.listp>.f-sort')));
check('sort marks: one fixed 14x14 SVG box, the active heading changes colour not weight, right columns put the mark first; facet and row chevrons are 16 px SVG boxes that turn whole',
  /width:14px;height:14px;margin-top:1px;flex:none/.test(paneRule('.cols .sm', '(min-width: 600px)'))
    && !/font-weight/.test(paneRule('.cols [aria-pressed=true]', '(min-width: 600px)'))
    && /flex-direction:row-reverse/.test(paneRule('.cols .r', '(min-width: 600px)'))
    && /align-items:flex-start/.test(paneRule('.cols button', '(min-width: 600px)'))
    && /width:16px;height:16px/.test(paneRule('.dd-chev')) && /transform:rotate\(180deg\)/.test(paneRule('.dropdown[open]>summary .dd-chev'))
    && /width:16px;height:16px/.test(paneRule('.chev')) && /transform:rotate\(180deg\)/.test(paneRule('.is-open .chev'))
    && !/::after\{content:""/.test(paneRule('.dropdown>summary::after')) && !/\.dir(?![\w-])/.test(cssRules)
    && !indexHtml.includes('class="dir"') && (indexHtml.match(/<svg class="sm" aria-hidden="true" focusable="false"><use href="#i-(?:sort|chevron-up)"\/><\/svg>/g) ?? []).length === 4
    && (indexHtml.match(/<span class="dd-chev" aria-hidden="true">/g) ?? []).length === 5);
check('pane is hidden by default, sticky/scrollable only wide and borderless inside',
  /display:none/.test(paneRule('.pane')) && /position:sticky;top:12px;max-height:calc\(100vh - 24px\);overflow:auto/.test(paneRule('.pane', desktopQuery))
    && /border:0;border-radius:0/.test(paneRule('.pane .detail', desktopQuery))
    && /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(paneRule('.pane .d-cells', desktopQuery))
    && /grid-template-areas:"pts pts" "ddl fee"/.test(paneRule('.pane .d-cells', desktopQuery))
    && /grid-column:1\/-1/.test(paneRule('.pane .d-cells .c-pts', desktopQuery)));
check('selected tint/ring follow hover, focus inset and goto colours are explicit',
  /background:var\(--accent-tint\);box-shadow:inset 0 0 0 2px var\(--accent\)/.test(paneRule('.is-sel>.row', desktopQuery))
    && cssRules.lastIndexOf('.is-sel>.row') > cssRules.indexOf('.row:hover')
    && /outline-offset:-6px/.test(paneRule('.is-sel .open:focus-visible::after', desktopQuery))
    && /left:-9999px;color:var\(--accent\);text-decoration:underline/.test(paneRule('.goto', desktopQuery))
    && /left:auto;right:12px;bottom:8px;z-index:2/.test(paneRule('.goto:focus', desktopQuery))
    && !paneCss.some((r) => /is-sel|is-past/.test(r.selector) && /opacity/.test(r.body)));
// Stage 4 pushed the pane below the old sticky bar (236 px, 1024 x 600 and up).
// The bar no longer sticks, so that block and its offset went together.
check('no interim height-gated chrome: no (min-height: 600px) media and no 236 px offset; the pane is top 12 px at every height',
  !/@media[^{]*min-height:\s*600px/.test(cssRules) && !/236px/.test(cssRules) && !css.includes('interim until Stage 5')
    && /position:sticky;top:12px;max-height:calc\(100vh - 24px\)/.test(paneRule('.pane', desktopQuery)));
// Stage 6 retarget: the only motion near the pane is the new content's
// opacity and an unselected row's hover; the pane box, Go to details and the
// selection fill never move.
const paneMotionOk = (rules) => rules.every((r) => {
  if (!/\.pane|\.goto|\.is-sel/.test(r.selector) || !/transition|animation/.test(r.body)) return true;
  if (r.selector === '.pane-body>.fade-in') return /^transition:opacity var\(--t-fast\) var\(--ease-out\)$/.test(r.body);
  if (r.selector === '.item:not(.is-sel)>.row:hover') return /^transition:background-color var\(--t-fast\) var\(--ease-out\)$/.test(r.body);
  return false;
});
check('print hides pane/goto and restores a block split; the pane box, goto and selection fill never animate',
  /display:none/.test(paneRule('.pane', 'print')) && /display:none/.test(paneRule('.goto', 'print'))
    && /display:block/.test(paneRule('.split', 'print')) && paneMotionOk(paneCss)
    && !paneMotionOk(cssTree(cssRules + '.pane{transition:opacity .1s}')) && !paneMotionOk(cssTree(cssRules + '.is-sel>.row{transition:background-color .1s}'))
    && !paneMotionOk(cssTree(cssRules + '.pane-body>.fade-in{transition:transform .1s}')));

// Stage 4: the stable pane changes its content and accessible name together.
section('Desktop detail pane: renderer and responsive row controls');
check('pane has a stable heading/body and the results section accepts fallback focus',
  /<aside[^>]*id="pane"[^>]*tabindex="-1"[^>]*aria-labelledby="pane-h"/.test(indexHtml)
    && indexHtml.includes('<h2 class="visually-hidden" id="pane-h">Programme details</h2>')
    && /<section[^>]*aria-labelledby="results-h"[^>]*tabindex="-1"/.test(indexHtml));
check('pane reuse removes old content, keeps stable nodes and resolves every name', typeof renderPane === 'function' && withStubDocument(() => {
  const pane = new ChromeNode('aside'), heading = new ChromeNode('h2'), body = new ChromeNode('div');
  heading.id = 'pane-h'; heading.textContent = 'Programme details'; pane.append(heading, body);
  const ctx = { pane, heading, body }, a = live[0], b = live.find((r) => r.languages.join() === 'Czech');
  for (const [row, shown, expected] of [[a, true, 'content'], [b, true, 'content'], [b, false, 'hidden'], [null, false, 'empty'], [a, true, 'content']]) {
    if (renderPane(ctx, row, shown, noFilters()) !== expected || pane.children[0] !== heading || pane.children[1] !== body) return false;
    const title = byTag(body, 'h2');
    if (expected === 'content') {
      if (!heading.hidden || title.length !== 1 || title[0].id !== `p-${row.id}` || pane.getAttribute('aria-labelledby') !== title[0].id
        || byClass(body, 'd-head').length !== 1 || byClass(body, 'd-cells').length !== 1) return false;
    } else if (heading.hidden || title.length || pane.getAttribute('aria-labelledby') !== 'pane-h'
      || (expected === 'hidden' && (!body.textContent.includes(`${row.programme} does not match your filters`)
        || byTag(body, 'span')[0]?.lang !== 'cs'))
      || (expected === 'empty' && body.textContent !== 'Choose a programmeIts details appear here. Use the Up and Down arrow keys to move through the list.')) return false;
  }
  return true;
}));
check('all live pane details have exactly one full heading, head and cells', typeof renderPane === 'function' && withStubDocument(() => {
  const pane = new ChromeNode('aside'), heading = new ChromeNode('h2'), body = new ChromeNode('div');
  heading.id = 'pane-h'; pane.append(heading, body);
  return live.every((row) => {
    renderPane({ pane, heading, body }, row, true, noFilters());
    return byTag(body, 'h2').length === 1 && byTag(body, 'h2')[0].id === `p-${row.id}`
      && byClass(body, 'd-head').length === 1 && byClass(body, 'd-cells').length === 1;
  });
}));
check('wide and narrow live rows use their own ARIA without selection decoration', withStubDocument(() => [false, true].every((wide) => {
  const list = new ChromeNode('ul'); renderRows(list, live, { state: noFilters(), wide });
  return list.children.every((li) => {
    const b = byClass(li, 'open')[0];
    return b.getAttribute('aria-controls') === (wide ? 'pane' : null) && b.getAttribute('aria-expanded') === (wide ? null : 'false')
      && b.getAttribute('aria-current') === null && !li.classList.contains('is-sel') && !byClass(li, 'goto').length;
  });
})));

// The real index.html as stand-in nodes, so the harness has the actual parents,
// ids, dropdowns and sheet. Enough HTML for this file: tags, quoted attributes,
// comments, void and self-closed elements.
function parseHtml(source) {
  const root = new ChromeNode('#document'), stack = [root];
  const voids = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source']);
  const decode = (t) => t.replace(/&euro;/g, '€').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const token = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const [, close, open, attrs, selfClose, text] of source.matchAll(token)) {
    const top = stack.at(-1);
    if (text !== undefined) { if (text.trim()) top.append(decode(text)); else if (text) top.append(' '); continue; }
    if (close) { const at = stack.findLastIndex((n) => n.tagName === close.toLowerCase()); if (at > 0) stack.length = at; continue; }
    if (!open) continue;
    const node = new ChromeNode(open.toLowerCase());
    for (const [, name, dq, sq, bare] of (attrs ?? '').matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const value = decode(dq ?? sq ?? bare ?? '');
      if (name === 'id') node.id = value;
      else if (name === 'hidden') node.hidden = true;
      else if (name === 'open' || name === 'checked' || name === 'disabled') node[name] = true;
      else node.setAttribute(name, value);
      if (name === 'type' || name === 'value') node[name] = value;
    }
    if (node.tagName === 'input') { node.validity = { badInput: false }; node.value ??= ''; }
    top.append(node);
    if (!selfClose && !voids.has(node.tagName)) stack.push(node);
  }
  return root;
}

// Run actual app functions; only the platform and data load are controlled.
// A wrong widening target, narrow arrow interception or failure unhide must fail.
// start() runs for real up to its never-ending data load, so every handler and
// the initial filter placement are the app's own. 600 and 1024 are separate
// media objects (R4); media/flip still drive only 1024, as in Stage 4.
function paneAppHarness(test, { boot = false } = {}) {
  const originalGlobal = globalThis.document;
  globalThis.document = stubDocument;
  const keys = ['getElementById', 'querySelector', 'querySelectorAll', 'body', 'documentElement', 'activeElement', 'listeners',
    'canFocus', 'moved', 'queueTask', 'scrolls', 'focusOptions', 'focusLog'];
  const original = Object.fromEntries(keys.map((k) => [k, stubDocument[k]]));
  const finish = () => { Object.assign(stubDocument, original); globalThis.document = originalGlobal; };
  let result;
  try {
    const tree = parseHtml(indexHtml), all = () => [...nodesOf(tree)];
    const extra = new Map();
    const get = (id) => all().find((n) => n.id === id)
      ?? (extra.has(id) ? extra.get(id) : extra.set(id, Object.assign(new ChromeNode('div'), { id })).get(id));
    const html = tree.querySelector('html'), docBody = tree.querySelector('body');
    html.clientHeight = 844;
    get('f-deadline').value = 'any';
    const pane = get('pane'), body = tree.querySelector('.pane-body'), resultsSection = tree.querySelector('section[aria-labelledby="results-h"]');
    // Virtual clock for debounces, the Copy link reset and queued dialog events.
    let now = 0, nextId = 1; const timers = new Map();
    const fakeSetTimeout = (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; };
    const fakeClearTimeout = (id) => { timers.delete(id); };
    const advance = (ms) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    };
    const media = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const media600 = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    // Stage 6: reduced motion and print are their own queries, never the
    // layout stubs; an unknown query is an error rather than a silent 1024.
    const motionMedia = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const printMedia = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const queries = { '(min-width: 1200px)': media, '(min-width: 600px)': media600, '(prefers-reduced-motion: reduce)': motionMedia, print: printMedia };
    // Animation frames run only when a test flushes one; a frame queued while
    // flushing waits for the next.
    let nextFrame = 1; const frames = new Map();
    // A deterministic performance.now() for the time-budgeted fill (L09). Each
    // call moves it on by `tick` ms; a test can set tick to 0 and charge time
    // itself, as a row costs on a slow machine.
    // navType is the page's navigation type ('navigate', 'reload', 'back_forward').
    const perf = { t: 0, tick: 1, now() { this.t += this.tick; return this.t; },
      navType: 'navigate', getEntriesByType(type) { return type === 'navigation' ? [{ type: this.navType }] : []; } };
    const flushFrame = () => { const due = [...frames]; frames.clear(); for (const [, fn] of due) fn(now); };
    const windowListeners = {};
    const fireWindow = (type, init = {}) => { for (const fn of windowListeners[type] ?? []) fn({ type, ...init }); };
    const styleReads = [];
    // What the stylesheet hides at each width; a hidden node cannot take focus.
    // The list's Sort select follows a container query this stub cannot see; it
    // never moves, so it is treated as visible at every width.
    const cssHidden = (n) => media600.matches
      ? n.id === 'f-more'
      : (n.classList.contains('more-filters') && n.parent?.id === 'filter-form') || (n.id === 'f-copy' && n.parent?.classList.contains('status'));
    const observers = [];
    class IntersectionObserver {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(node) { this.targets.push(node); }
      disconnect() { this.targets = []; }
    }
    Object.assign(stubDocument, {
      getElementById: get, querySelector: (sel) => tree.querySelector(sel), querySelectorAll: (sel) => tree.querySelectorAll(sel),
      body: docBody, documentElement: html, activeElement: new ChromeNode('input'), listeners: {}, scrolls: [], focusOptions: undefined, focusLog: [],
      canFocus: (node) => { for (let n = node; n; n = n.parent) if (n.hidden || cssHidden(n) || (n.tagName === 'dialog' && !n.open)) return false; return true; },
      moved: (node) => { if (stubDocument.blurOnMove && node.contains(stubDocument.activeElement)) stubDocument.activeElement = docBody; },
      queueTask: (fn) => fakeSetTimeout(fn, 0),
    });
    stubDocument.blurOnMove = true;
    const clipboard = { mode: 'resolve', written: [], writeText(text) {
      if (this.mode === 'reject') return Promise.reject(new Error('NotAllowedError'));
      this.written.push(text); return Promise.resolve();
    } };
    const context = { ...i18n, URLSearchParams, initLanguage: () => i18n.initLanguage('', { getItem: () => 'en' }), document: stubDocument, matchMedia: (q) => { if (!queries[q]) throw new Error(`unexpected media query ${q}`); return queries[q]; },
      requestAnimationFrame: (fn) => { const id = nextFrame++; frames.set(id, fn); return id; }, cancelAnimationFrame: (id) => { frames.delete(id); },
      window: { scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, addEventListener(type, fn) { (windowListeners[type] ??= []).push(fn); } },
      location: { search: '', pathname: '/', hash: '', href: 'http://localhost:8765/?country=Ireland' },
      history: { replaceState() {} }, Date, console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, performance: perf,
      IntersectionObserver, navigator: { clipboard },
      ...shortlistMod, ...compareMod, saveShortlist: (set) => {
        context.savedLists = [...(context.savedLists ?? []), [...set]];
        const works = context.saveWorks ?? true;
        if (works && context.stored) context.stored = [...set];
        return works;
      },
      // context.stored is localStorage's list, shared with a pretend second tab;
      // left unset, storage cannot be read (private browsing).
      readStoredShortlist: () => (context.stored ? [...context.stored] : null),
      toCsv: (rows) => rows.map((r) => r.id).join(','), downloadCsv: (name, csv) => { context.exportedCsv = csv; },
      getComputedStyle: (n) => { styleReads.push({ node: n, state: n.getAttribute?.('data-state') ?? null }); return n.computed ?? { scrollMarginTop: '0px', scrollMarginBottom: '0px' }; },
      ...filtersMod, applyToday: applyTodayEarly, loadShortlist: () => new Set(), loadData: () => new Promise((resolve) => { context.resolveData = resolve; }),
      renderRows, appendRows, renderSlot, renderPane, renderCount, renderCountShort, renderChips, renderAppliedChips, renderSortOptions, setSaved, renderCompare, renderSourceLine() {},
      renderSourceBanner() {}, renderIssues() {} };
    const code = appSrc.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
    runInNewContext(code, context);
    const run = (code) => runInNewContext(code, context);
    context.fixture = [live[0], live.find((r) => r.id === 'sdu-mma'), live.find((r) => r.id.startsWith('tcd-'))];
    context.media = media;
    // All 1,240 real rows, for the L09 checks that need a list longer than the
    // first screen.
    context.live = live;
    if (!boot) run('allRows = fixture; sourceMeta = { issues: [] }; facets = buildFacets(allRows); drawChips(); renderSortOptions(dom.sort, SORTS, state.sort, state.dir); syncSort(); loaded = true; update();');
    const item = (id) => get('results').children.find((n) => n.dataset.id === id);
    const click = (id) => { context.targetButton = item(id).querySelector('button.open'); run('toggleRow({ target: targetButton });'); };
    const flip = (wide) => { media.matches = wide; run('crossWide();'); };
    // A real 600 crossing: the query flips, then its change listeners run.
    const flip600 = (bar) => { media600.matches = bar; for (const fn of media600.listeners) fn({ matches: bar }); };
    const fire = (node, type, init = {}) => dispatchStub(node, { type, ...init });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    // Runs every frame and zero-delay task until none is left, so the rows
    // update() appends after the first paint are all in (L09).
    const drain = () => {
      for (let i = 0; frames.size || [...timers.values()].some((t) => t.at <= now); i++) {
        if (i > 10000) throw new Error('drain: work never ran out');
        flushFrame(); advance(0);
      }
    };
    result = test({ perf, drain, timers, run, get, item, click, flip, flip600, fire, advance, settle, media, media600, observers, clipboard, tree, html,
      docBody, pane, body, resultsSection, context, ids: context.fixture.map((r) => r.id),
      motionMedia, printMedia, frames, flushFrame, fireWindow, styleReads });
  } catch (err) { finish(); throw err; }
  if (result && typeof result.then === 'function') return result.finally(finish);
  finish();
  return result;
}
// Strict: only a real true passes. A Promise or a truthy object is a FAIL.
function appCheck(name, fn) {
  try {
    const result = paneAppHarness(fn);
    if (result && typeof result.then === 'function') { result.catch(() => {}); throw new Error('async check: use asyncAppCheck'); }
    check(name, result === true);
  } catch (err) { check(name, false, err.message); }
}
async function asyncAppCheck(name, fn, options) {
  try { check(name, (await paneAppHarness(fn, options)) === true); } catch (err) { check(name, false, err.message); }
}
appCheck('actual handlers: narrow open A/B, close B selects A, widen clears slots, round trip reopens A', ({ run, click, flip, get, ids: [a, b] }) => {
  click(a); click(b);
  if (get('results').querySelectorAll('.expand').length !== 2 || run('selectedId') !== b) return false;
  click(b); if (run('selectedId') !== a) return false;
  flip(true);
  if (run('selectedId') !== a || run('openIds.size') !== 0 || get('results').querySelectorAll('.expand').length !== 0) return false;
  flip(false);
  return run('[...openIds]').join() === a && get('results').querySelectorAll('.expand').length === 1;
});
appCheck('actual handlers: filtered B remains the hidden pick when A is still open', ({ run, click, flip, item, body, ids: [a, b] }) => {
  click(a); click(b); run('state.search = fixture[0].programme; update();');
  if (!item(a) || item(b) || run('openIds.size') !== 1) return false;
  flip(true);
  if (run('selectedId') !== b || !body.textContent.includes('does not match your filters') || item(a).classList.contains('is-sel')) return false;
  run("state.search = ''; update();");
  return item(b).classList.contains('is-sel') && body.querySelector('h2').id === `p-${b}`;
});
appCheck('actual arrows prevent ends without selecting them; narrow, modified and composing keys stay native', ({ run, flip, get, click, context, ids }) => {
  const key = (button, key, extra = {}) => {
    const e = { target: button, key, preventDefault() { this.defaultPrevented = true; }, ...extra };
    context.keyEvent = e; run('rowKeydown(keyEvent);'); return !!e.defaultPrevented;
  };
  const first = get('results').children[0].querySelector('button.open'); first.focus();
  if (key(first, 'ArrowDown')) return false;
  flip(true); click(ids[1]);
  if (!key(first, 'ArrowUp') || run('selectedId') !== ids[1] || stubDocument.activeElement !== first) return false;
  for (const prop of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing']) if (key(first, 'ArrowDown', { [prop]: true })) return false;
  if (!key(first, 'ArrowDown')) return false;
  const second = get('results').children[1].querySelector('button.open');
  if (stubDocument.activeElement !== second || run('selectedId') !== second.closest('li.item').dataset.id) return false;
  const last = get('results').children.at(-1).querySelector('button.open'); last.focus();
  return key(last, 'ArrowDown') && stubDocument.activeElement === last && run('selectedId') === second.closest('li.item').dataset.id;
});
appCheck('actual Go to details preserves URL and modifiers and selection never enters address state', ({ run, flip, click, item, context, pane, ids: [a] }) => {
  flip(true); click(a); const goto = item(a).querySelector('a.goto');
  if (!goto || goto.getAttribute('href') !== '#pane' || goto.textContent !== 'Go to details') return false;
  const event = { target: goto, button: 0, preventDefault() { this.defaultPrevented = true; } }; context.gotoEvent = event;
  run('toggleRow(gotoEvent);');
  if (!event.defaultPrevented || stubDocument.activeElement !== pane || context.location.hash !== '') return false;
  event.defaultPrevented = false; event.metaKey = true; run('toggleRow(gotoEvent);');
  return !event.defaultPrevented && !/selectedId/.test(appSrc.slice(appSrc.indexOf('function keepAddress'), appSrc.indexOf('function showTotalFailure')));
});
appCheck('actual focus: refresh links/goto, crossing links, hidden picks and zero-results fallback', ({ run, flip, click, item, get, pane, resultsSection, ids: [a] }) => {
  click(a); let link = item(a).querySelector('a'); link.focus(); run('update();');
  if (stubDocument.activeElement !== item(a).querySelector('a')) return false;
  flip(true); if (!pane.contains(stubDocument.activeElement)) return false;
  item(a).querySelector('a.goto').focus(); run('update();');
  if (stubDocument.activeElement !== item(a).querySelector('a.goto')) return false;
  flip(false); if (stubDocument.activeElement !== item(a).querySelector('button.open')) return false;
  flip(true); pane.focus(); run("state.search = 'zzzznomatch'; update();"); flip(false);
  if (stubDocument.activeElement !== resultsSection || !get('results').parent.hidden) return false;
  return true;
});
appCheck('crossing recovers focus cleared by CSS but never steals it from another control', ({ run, flip, click, item, media, pane, ids: [a] }) => {
  flip(true); click(a); pane.focus(); run('rememberFocus();');
  media.matches = false; stubDocument.activeElement = stubDocument.body; run('crossWide();');
  if (stubDocument.activeElement !== item(a).querySelector('button.open')) return false;
  flip(true); pane.focus(); run('rememberFocus();');
  const input = new ChromeNode('input'); input.focus(); run('rememberFocus();'); flip(false);
  if (stubDocument.activeElement !== input) return false;
  flip(true); pane.focus(); run('rememberFocus(); forgetFocus({ relatedTarget: null });');
  media.matches = false; stubDocument.activeElement = stubDocument.body; run('crossWide();');
  return stubDocument.activeElement === stubDocument.body;
});
appCheck('actual crossings ignore loading, stale/repeated mode notifications and total failure', ({ run, flip, media, pane, get }) => {
  run('loaded = false;'); flip(true);
  if (get('results').querySelectorAll('[aria-controls="pane"]').length) return false;
  run('loaded = true; update();'); const first = get('results').children[0];
  run('crossWide({ matches: false });'); if (get('results').children[0] !== first) return false;
  run("showTotalFailure(new Error('controlled failure'));"); flip(false); flip(true);
  return pane.hidden && get('results').parent.hidden && run('loaded') === false;
});
// A debounced filter can run update() after the viewport crosses 1024 but
// before the change event. update() then recorded the new mode, the event did
// nothing, and the pick never moved from the hidden pane into its slot.
appCheck('an update between the resize and its change event still moves the pick both ways', ({ run, flip, click, item, media, body, ids: [a] }) => {
  flip(true); click(a);
  media.matches = false; run('update();');
  if (item(a).querySelectorAll('.expand').length !== 1 || body.querySelector('article') || run('[...openIds]').join() !== a) return false;
  run('crossWide();');
  if (item(a).querySelectorAll('.expand').length !== 1) return false;
  media.matches = true; run('update();'); run('crossWide();');
  return !item(a).querySelector('.expand') && body.querySelector('h2')?.id === `p-${a}` && run('selectedId') === a;
});

// ---------------------------------------------------------------- stage 5
section('Filters, phone sheet and sticky count (redesign stage 5)');
// Source of the element whose opening tag matches openRe (same-tag nesting).
function elementSource(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return '';
  const tag = m[0].match(/^<([a-z]+)/)[1], re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = m.index + 1;
  let depth = 1, hit;
  while (depth && (hit = re.exec(html))) depth += hit[0].startsWith('</') ? -1 : 1;
  return html.slice(m.index, hit ? hit.index + hit[0].length : html.length);
}
const formSrc = elementSource(indexHtml, /<form class="fbar" id="filter-form"/);
const moreSrc = elementSource(indexHtml, /<div class="more-filters">/);
const statusSrc = elementSource(indexHtml, /<div class="status">/);
const sheetSrc = elementSource(indexHtml, /<dialog /);
const stageIds = ['filter-form', 'f-search', 'f-points', 'f-points-error', 'f-maths', 'f-maths-help', 'f-tuition', 'f-tuition-error',
  'dd-subjects', 'dd-countries', 'dd-languages', 'f-subjects', 'f-countries', 'f-languages', 'f-sort', 'f-clear', 'result-count',
  'f-more', 'f-copy', 'filter-sheet', 'sheet-h', 'sheet-done', 'sheet-show'];
check('one copy of each control: every filter, sheet and copy id appears exactly once',
  stageIds.every((id) => (indexHtml.match(new RegExp(`id="${id}"`, 'g')) ?? []).length === 1));
// Redesign revisions: Sort left the sheet for the list itself, where the 900 px
// container query swaps it with the headings (one visible sort control).
const listpSrc = elementSource(indexHtml, /<div class="listp">/);
check('.more-filters holds the fee, the five dropdowns, Deadline and Clear all, inside the filter form in the header; Sort sits in the list before the headings',
  moreSrc.length > 0 && ['id="f-tuition"', 'id="dd-subjects"', 'id="dd-countries"', 'id="dd-languages"', 'id="f-deadline"', 'id="dd-degrees"', 'id="dd-cities"', 'id="f-clear"'].every((s) => moreSrc.includes(s))
    && !formSrc.includes('id="f-sort"') && /<div class="fld f-sort">\s*<label for="f-sort">Sort by<\/label>\s*<select class="inp" id="f-sort"><\/select>\s*<\/div>\s*<div class="cols"/.test(listpSrc)
    && formSrc.includes(moreSrc) && elementSource(indexHtml, /<header class="top">/).includes(formSrc)
    && ['id="f-search"', 'id="f-points"', 'id="f-maths"', 'id="f-more"'].every((s) => formSrc.includes(s) && !moreSrc.includes(s)));
check('.status holds the live count, its aria-hidden twin and Copy link after a 1 px sentinel; Sort has left it; the footer holds Show N',
  /<p class="count cfull" id="result-count" aria-live="polite"><\/p>/.test(statusSrc) && /<p class="count cshort" aria-hidden="true"><\/p>/.test(statusSrc)
    && statusSrc.includes('id="f-copy"') && !statusSrc.includes('f-sort') && /<div class="stuck-mark" aria-hidden="true"><\/div>\s*<div class="status">/.test(indexHtml)
    && elementSource(indexHtml, /<div class="sheet-f">/).includes('id="sheet-show"') && !indexHtml.includes('sort-field'));
check('the sheet is a labelled native dialog with a focusable heading and Done, controlled by Filters',
  /<dialog class="sheet" id="filter-sheet" aria-labelledby="sheet-h">/.test(indexHtml) && /<h2 id="sheet-h" tabindex="-1">Filters<\/h2>/.test(sheetSrc)
    && /id="sheet-done"[^>]*>Done</.test(sheetSrc) && !/role="dialog"|aria-modal/.test(indexHtml)
    && /<button type="button" class="btn more" id="f-more" aria-haspopup="dialog" aria-expanded="false" aria-controls="filter-sheet">/.test(formSrc));
check('every button in the filter form and the sheet is type="button" (no implicit submit)', [formSrc, sheetSrc].every((src) => {
  const buttons = src.match(/<button\b[^>]*>/g) ?? [];
  return buttons.length > 0 && buttons.every((b) => /type="button"/.test(b));
}));
check('the sprite has the Phosphor funnel and a flag for each of the 11 data countries, filled only from the canonical flag tokens',
  /<symbol id="i-filter" viewBox="0 0 256 256">/.test(indexHtml) && ['f-at', 'f-cz', 'f-de', 'f-dk', 'f-fi', 'f-gb', 'f-ie', 'f-it', 'f-nl', 'f-no', 'f-se'].every((id) => {
    const symbol = indexHtml.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`))?.[0] ?? '';
    return /fill:var\(--flag-/.test(symbol) && !/#[0-9a-f]{3,8}\b/i.test(symbol);
  }));
// Stage 5 slipped the funnel and flags in between the globe's licence line and
// the globe, so the MIT credit sat on the wrong icon.
check('the globe and funnel licence lines sit directly on their own symbols',
  /<!-- Phosphor Regular globe,[^>]*-->\s*<symbol id="i-globe"/.test(indexHtml)
    && /<!-- Phosphor Regular funnel,[^>]*-->\s*<symbol id="i-filter"/.test(indexHtml));
check('app and CSS share the 600 px query', appSrc.includes("matchMedia('(min-width: 600px)')") && paneCss.some((r) => atMedia(r, '(min-width: 600px)')));
check('the closed sheet never renders: no screen display on bare .sheet, flex only when open, print may hide it; the page behind does not scroll',
  paneCss.filter((r) => r.selector.split(',').map((s) => s.trim()).includes('.sheet') && /display\s*:/.test(r.body)).every((r) => atMedia(r, 'print') && /display:none/.test(r.body))
    && /display:flex/.test(paneRule('.sheet[open]')) && /overflow:hidden/.test(paneRule('html:has(.sheet[open])'))
    && /background:var\(--scrim\)/.test(paneRule('.sheet::backdrop')) && /min-height:0;overflow:auto/.test(paneRule('.sheet-b'))
    && /margin:0;padding:0;border:0/.test(paneRule('.sheet')));
check('stuck: the full sentence is clipped like .visually-hidden, never display:none; the 600 block resets every clip and hides the twin',
  /position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect\(0 0 0 0\);clip-path:inset\(50%\);white-space:nowrap/.test(paneRule('.is-stuck .cfull'))
    && !paneCss.some((r) => /\.cfull/.test(r.selector) && /display\s*:\s*none/.test(r.body))
    && /position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;white-space:normal/.test(paneRule('.is-stuck .cfull', '(min-width: 600px)'))
    && /display:none/.test(paneRule('.is-stuck .cshort', '(min-width: 600px)')) && /display:block/.test(paneRule('.is-stuck .cshort')));
// Implement, 2026-10-27: .btn-q and .btn-s sat before the .btn base rule at
// equal weight, so Clear all, Done and Copy link drew as full bordered buttons.
check('quiet and small buttons out-rank the later .btn base rule',
  /border-color:transparent;background:none;color:var\(--accent\);text-decoration:underline/.test(paneRule('.btn.btn-q'))
    && /height:var\(--tap\);padding:0 10px;font-size:var\(--fs-13\)/.test(paneRule('.btn.btn-s'))
    && !paneCss.some((r) => r.selector.split(',').map((x) => x.trim()).some((x) => /^\.btn-[qs](?![\w-])/.test(x))));
// Implement, 2026-10-27: a bare .copy in the print list lost to the 600
// block's .status .copy{display:inline-flex}, so print only hid it by luck
// (its parent was hidden).
check('print hides the filter bar, sheet, short count and Copy link with selectors that out-rank their screen rules',
  ['.fbar', '.sheet', '.cshort', '.status .copy', '.sheet .copy'].every((sel) => /display:none/.test(paneRule(sel, 'print').replace(/\s/g, '')))
    && !paneCss.some((r) => atMedia(r, 'print') && r.selector.split(',').map((x) => x.trim()).includes('.copy')));
check('invalid fields get a 2 px ink border placed after the active look, so it wins; flags out-rank the 1em icon rule',
  /border:2px solid var\(--ink\)/.test(paneRule('.inp[aria-invalid=true]'))
    && cssRules.indexOf('.inp[aria-invalid=true]') > cssRules.indexOf('.is-set .inp')
    && /width:21px;height:14px;border-radius:2px;outline:1px solid var\(--hairline\)/.test(paneRule('.dropdown svg.flag')));
check('compact count twin: lead plus each bucket number with its mark, lead only without points, rewritten only on change',
  typeof renderCountShort === 'function' && withStubDocument(() => {
    const n = new ChromeNode('p');
    n.setAttribute('aria-hidden', 'true');
    const parts = [{ kind: 'fit', text: '410 within your IB points' }, { kind: 'cond', text: '41 only with HL Maths 4+' }, { kind: 'unk', text: '679 can’t be compared' }];
    const first = renderCountShort(n, '1130 of 1240 programmes', parts), kids = [...n.children];
    const same = renderCountShort(n, '1130 of 1240 programmes', parts);
    return first === true && same === false && kids.every((c, i) => c === n.children[i])
      && n.textContent === '1130 of 1240 programmes · 410 · 41 · 679' && byTag(n, 'b')[0]?.textContent === '1130 of 1240 programmes'
      && byClass(n, 'k').map((x) => x.className).join(' ') === 'k k-fit m m-fit k k-cond m m-cond k k-unk m m-unk'
      && renderCountShort(n, '1240 programmes', []) === true && n.textContent === '1240 programmes' && n.childElementCount === 1
      && n.getAttribute('aria-hidden') === 'true';
  }));
check('country options get an aria-hidden flag between the tick and the name; an unmapped country gets text only',
  typeof renderChips === 'function' && withStubDocument(() => {
    const names = ['Czechia', 'Denmark', 'Ireland', 'Italy', 'Netherlands', 'Atlantis'];
    const flags = { Czechia: 'f-cz', Denmark: 'f-dk', Ireland: 'f-ie', Italy: 'f-it', Netherlands: 'f-nl' };
    const box = new ChromeNode('div'), plain = new ChromeNode('div');
    renderChips(box, names, new Set(['Ireland']), () => {}, { flags });
    renderChips(plain, ['Czechia'], new Set(), () => {});
    return box.children.length === names.length && box.children.every((label, i) => {
      const svg = byTag(label, 'svg')[0], name = names[i];
      return label.textContent === name && label.children[0].tagName === 'input' && label.children[0].checked === (name === 'Ireland')
        && (name === 'Atlantis' ? !svg : !!svg && svg.getAttribute('aria-hidden') === 'true' && svg.className === 'flag' && label.children[1] === svg
          && byTag(svg, 'use')[0]?.getAttribute('href') === `#${flags[name]}`);
    }) && !byTag(plain, 'svg').length && appSrc.includes('{ flags: COUNTRY_FLAGS }')
      && Object.entries(flags).every(([c, f]) => appSrc.includes(`${c}: '${f}'`));
  }));

// Real handlers on the real markup. Each would pass with a wrong target only
// if the app code were wrong in the same way, so every outcome is asserted.
const kids = (n) => n.children.filter((c) => typeof c !== 'string');
appCheck('actual 600 crossings move .more-filters, Clear all and Copy link as single nodes, round trip and keep values, ticks and open lists', ({ run, get, tree, flip600 }) => {
  run('facets = buildFacets(allRows); drawChips();');
  const more = tree.querySelector('.more-filters'), clear = get('f-clear'), copy = get('f-copy'), show = get('sheet-show');
  const sheetB = tree.querySelector('.sheet-b'), sheetF = tree.querySelector('.sheet-f'), form = get('filter-form'), status = tree.querySelector('.status');
  const narrowOk = () => more.parent === sheetB && kids(sheetB).join() === [more, copy].join() && kids(sheetB)[1] === copy
    && clear.parent === sheetF && clear.nextElementSibling === show;
  const wideOk = () => more.parent === form && kids(form).at(-1) === more && kids(more).at(-1) === clear && kids(status).at(-1) === copy;
  if (!narrowOk()) return false;
  const box = get('dd-countries'), tick = get('f-countries').querySelector('input');
  box.open = true; tick.checked = true; get('f-tuition').value = '3000'; get('f-sort').value = 'tuition:desc';
  let moves = 0; const hook = stubDocument.moved;
  stubDocument.moved = (n) => { moves++; hook(n); };
  flip600(true);
  if (!wideOk() || moves !== 3) return false;
  flip600(true); run('placeFilters();');
  if (moves !== 3) return false;
  // A fresh placement (page load at 600 or wider) finds every node in place:
  // nothing moves, so a control focused before the script ran keeps focus.
  get('f-tuition').focus(); run('appliedBar = null; placeFilters();');
  if (moves !== 3 || stubDocument.activeElement !== get('f-tuition')) return false;
  for (let i = 0; i < 10; i++) { flip600(i % 2 === 0 ? false : true); if (!(i % 2 === 0 ? narrowOk() : wideOk())) return false; }
  return box.open && tick.checked && get('f-tuition').value === '3000' && get('f-sort').value === 'tuition:desc'
    && get('f-countries').querySelector('input') === tick && tree.querySelectorAll('.more-filters').filter((n) => n.parent === form || n.parent === sheetB).length === 1
    && ['f-deadline','f-degrees','f-cities'].every((id) => tree.querySelectorAll(`#${id}`).length === 1);
});
appCheck('actual 600 focus: a moved control keeps focus, sheet focus and the vanishing Filters go to the fee, narrowing goes to Filters, others stay', ({ get, flip600, fire, item, ids: [a] }) => {
  const fee = get('f-tuition'), more = get('f-more'), sheet = get('filter-sheet'), focus = (n) => { n.focus(); fire(n, 'focusin'); };
  const active = () => stubDocument.activeElement;
  fire(more, 'click'); focus(fee); flip600(true);
  if (active() !== fee || sheet.open) return false;
  flip600(false); if (active() !== more) return false;
  for (const id of ['sheet-h', 'sheet-done', 'sheet-show']) {
    fire(more, 'click'); focus(get(id)); flip600(true);
    if (active() !== fee || sheet.open) return false;
    flip600(false); if (active() !== more) return false;
  }
  focus(get('f-search')); flip600(true); if (active() !== get('f-search')) return false;
  flip600(false); focus(item(a).querySelector('button.open')); flip600(true);
  if (active() !== item(a).querySelector('button.open')) return false;
  flip600(false); focus(get('f-points')); flip600(true); flip600(false);
  return active() === get('f-points');
});
appCheck('actual 600 focus cleared by CSS before the callback: Filters and moved controls recover; a real move or same-mode blur forgets', ({ get, flip600, fire, media600, docBody, item, ids: [a] }) => {
  const fee = get('f-tuition'), more = get('f-more'), focus = (n) => { n.focus(); fire(n, 'focusin'); };
  const cssCross = (bar) => {
    const was = stubDocument.activeElement;
    media600.matches = bar; stubDocument.activeElement = docBody;
    fire(was, 'focusout', { relatedTarget: null });
    for (const fn of media600.listeners) fn({ matches: bar });
  };
  focus(more); cssCross(true); if (stubDocument.activeElement !== fee) return false;
  cssCross(false); if (stubDocument.activeElement !== more) return false;
  focus(more); focus(item(a).querySelector('button.open')); stubDocument.activeElement = docBody; cssCross(true);
  if (stubDocument.activeElement !== docBody) return false;
  flip600(false); focus(more); fire(more, 'focusout', { relatedTarget: null }); stubDocument.activeElement = docBody; cssCross(true);
  return stubDocument.activeElement === docBody;
});
appCheck('actual sheet: Filters opens it on the heading; Done, Show N, Escape and a backdrop tap close it and return focus; inner taps do not', ({ get, fire, advance, docBody }) => {
  const sheet = get('filter-sheet'), more = get('f-more'), heading = get('sheet-h');
  sheet.rect = { top: 300, bottom: 844, left: 0, right: 390, width: 390, height: 544 };
  // iOS does not focus a tapped button, so the native return target can be body.
  const open = () => { stubDocument.activeElement = docBody; fire(more, 'click');
    return sheet.open && more.getAttribute('aria-expanded') === 'true' && stubDocument.activeElement === heading; };
  const closed = () => { advance(0); return !sheet.open && more.getAttribute('aria-expanded') === 'false' && stubDocument.activeElement === more; };
  if (!open()) return false; fire(get('sheet-done'), 'click'); if (!closed()) return false;
  if (!open()) return false; fire(get('sheet-show'), 'click'); if (!closed()) return false;
  if (!open()) return false; if (fire(sheet, 'cancel', { bubbles: false })) sheet.close(); if (!closed()) return false;
  if (!open()) return false; fire(sheet, 'click', { clientX: 200, clientY: 120 }); if (!closed()) return false;
  if (!open()) return false;
  fire(sheet, 'click', { clientX: 200, clientY: 500 }); fire(heading, 'click', { clientX: 0, clientY: 0 });
  fire(get('f-tuition'), 'click', { clientX: 0, clientY: 0 }); advance(0);
  return sheet.open && more.getAttribute('aria-expanded') === 'true';
});
appCheck('actual sheet: widening closes it without a focus return; a queued close after a quick reopen neither steals focus nor clears aria-expanded', ({ get, fire, flip600, advance }) => {
  const sheet = get('filter-sheet'), more = get('f-more'), fee = get('f-tuition');
  fire(more, 'click'); fee.focus(); fire(fee, 'focusin'); flip600(true); advance(0);
  if (stubDocument.activeElement !== fee || more.getAttribute('aria-expanded') !== 'false') return false;
  flip600(false); fire(more, 'click'); flip600(true); flip600(false); fire(more, 'click');
  advance(0);
  return sheet.open && more.getAttribute('aria-expanded') === 'true' && stubDocument.activeElement === get('sheet-h');
});
appCheck('actual counts: Filters (n) counts sheet groups, Clear all (n) every filter, Show N the shown rows; fee 0 + two countries is Filters (2)', ({ run, get, fire, advance, context }) => {
  run('facets = buildFacets(allRows); drawChips();');
  const more = get('f-more'), clear = get('f-clear'), show = get('sheet-show'), label = () => more.querySelector('span').textContent;
  const type = (id, value) => { get(id).value = value; fire(get(id), 'input'); advance(150); };
  if (label() !== 'Filters' || more.classList.contains('is-on') || clear.textContent !== 'Clear all' || !clear.disabled
    || show.textContent !== `Show ${context.fixture.length} programmes`) return false;
  type('f-points', '36'); get('f-maths').checked = true; fire(get('f-maths'), 'change');
  if (label() !== 'Filters' || clear.textContent !== 'Clear all (2)' || !get('f-points').closest('.fld').classList.contains('is-set')) return false;
  fire(clear, 'click'); type('f-tuition', '0');
  for (const tick of get('f-countries').querySelectorAll('input').slice(0, 2)) { tick.checked = true; fire(tick, 'change'); }
  if (label() !== 'Filters (2)' || !more.classList.contains('is-on') || clear.textContent !== 'Clear all (2)' || clear.disabled
    || get('dd-countries-count-number').textContent !== '2' || get('dd-countries-count').hidden
    || !get('f-tuition').closest('.fld').classList.contains('is-set') || !get('dd-countries').classList.contains('is-set')
    || get('dd-subjects').classList.contains('is-set') || !/^Show \d+ programmes?$/.test(show.textContent)) return false;
  type('f-search', '  ' + context.fixture[0].programme + ' ');
  if (clear.textContent !== 'Clear all (3)' || label() !== 'Filters (2)' || !get('f-search').closest('.fld').classList.contains('is-set')) return false;
  fire(clear, 'click'); type('f-search', context.fixture[0].programme);
  if (show.textContent !== 'Show 1 programme') return false;
  type('f-tuition', '-5');
  return get('f-tuition').getAttribute('aria-invalid') === 'true' && !get('f-tuition').closest('.fld').classList.contains('is-set') && label() === 'Filters';
});
appCheck('actual sheet Clear all clears every filter and moves focus to the sheet heading', ({ run, get, fire, advance }) => {
  run('facets = buildFacets(allRows); drawChips();');
  const clear = get('f-clear');
  fire(get('f-more'), 'click');
  const tick = get('f-countries').querySelector('input'); tick.checked = true; fire(tick, 'change');
  get('f-tuition').value = '3000'; fire(get('f-tuition'), 'input'); advance(150);
  clear.focus(); fire(clear, 'click');
  return stubDocument.activeElement === get('sheet-h') && clear.disabled && clear.textContent === 'Clear all'
    && run('activeFilterCount(state)') === 0 && !get('f-countries').querySelector('input').checked && get('f-tuition').value === '';
});
appCheck('actual dropdowns: in the sheet Escape is left to the dialog and outside taps or Tab-out keep accordions open; bar panels keep A06', ({ get, fire, flip600 }) => {
  const subjects = get('dd-subjects'), countries = get('dd-countries');
  fire(get('f-more'), 'click'); subjects.open = true;
  const summary = subjects.querySelector('summary'); summary.focus();
  fire(summary, 'keydown', { key: 'Escape' });
  if (!subjects.open || stubDocument.activeElement !== summary) return false;
  fire(get('sheet-h'), 'click'); fire(subjects, 'focusout', { relatedTarget: get('sheet-done') });
  if (!subjects.open) return false;
  countries.open = true; fire(countries, 'toggle', { bubbles: false });
  if (subjects.open || !countries.open) return false;
  flip600(true);
  fire(countries, 'focusout', { relatedTarget: null }); if (!countries.open) return false;
  fire(countries, 'focusout', { relatedTarget: get('f-search') }); if (countries.open) return false;
  subjects.open = true; fire(get('f-search'), 'click'); if (subjects.open) return false;
  subjects.open = true; get('f-search').focus(); fire(get('f-search'), 'keydown', { key: 'Escape' });
  if (subjects.open || stubDocument.activeElement !== get('f-search')) return false;
  subjects.open = true; summary.focus(); fire(summary, 'keydown', { key: 'Escape' });
  return !subjects.open && stubDocument.activeElement === summary;
});
appCheck('actual total failure closes an open sheet and gives sheet focus to the connected Reload; the queued close returns nothing', ({ run, get, fire, advance }) => {
  const more = get('f-more'), sheet = get('filter-sheet');
  fire(more, 'click'); if (stubDocument.activeElement !== get('sheet-h')) return false;
  run("showTotalFailure(new Error('controlled failure'));");
  const banner = get('source-banner'), reload = banner.querySelector('button');
  if (sheet.open || !reload || stubDocument.activeElement !== reload || banner.hidden || !get('filter-form').hidden) return false;
  advance(0);
  return stubDocument.activeElement === reload && more.getAttribute('aria-expanded') === 'false';
});
appCheck('actual stuck count: only while narrow with the sentinel above the viewport; never below it; widening clears it; narrowing reconciles at once', ({ observers, tree, flip600 }) => {
  const io = observers[0], mark = tree.querySelector('.stuck-mark'), status = tree.querySelector('.status');
  const stuck = () => status.classList.contains('is-stuck');
  const at = (top) => { mark.rect = { top, bottom: top + 1, left: 0, right: 390, width: 390, height: 1 };
    io.callback([{ target: mark, isIntersecting: top + 1 > 0 && top < 844, boundingClientRect: mark.rect, rootBounds: { top: 0, bottom: 844 } }]); };
  if (!io || io.targets[0] !== mark) return false;
  at(200); if (stuck()) return false;
  at(-300); if (!stuck()) return false;
  at(1200); if (stuck()) return false;
  at(-300); flip600(true); if (stuck()) return false;
  at(-500); if (stuck()) return false;
  at(200); mark.rect = { top: -300, bottom: -299 }; flip600(false); if (!stuck()) return false;
  flip600(true); mark.rect = { top: 900, bottom: 901 }; flip600(false);
  return !stuck();
});
await asyncAppCheck('actual Copy link: success, rejection and no clipboard change only its own text for 2 s; a second click restarts the timer', async ({ get, fire, advance, settle, clipboard, context }) => {
  const copy = get('f-copy');
  fire(copy, 'click'); await settle();
  if (copy.textContent !== 'Link copied' || clipboard.written.at(-1) !== context.location.href) return false;
  advance(1999); if (copy.textContent !== 'Link copied') return false;
  advance(1); if (copy.textContent !== 'Copy link') return false;
  fire(copy, 'click'); await settle(); advance(1500); fire(copy, 'click'); await settle(); advance(1500);
  if (copy.textContent !== 'Link copied') return false;
  advance(500); if (copy.textContent !== 'Copy link') return false;
  clipboard.mode = 'reject'; fire(copy, 'click'); await settle();
  if (copy.textContent !== 'Copy failed: use the address bar') return false;
  advance(2000); if (copy.textContent !== 'Copy link') return false;
  context.navigator.clipboard = undefined; fire(copy, 'click'); await settle();
  if (copy.textContent !== 'Copy failed: use the address bar') return false;
  advance(2000);
  return copy.textContent === 'Copy link' && copy.getAttribute('aria-live') === null;
});
appCheck('actual arrows scroll the new pick after selecting it: nearest when it fits under the sticky header, start when taller; focus never scrolls', ({ run, flip, get, html, context }) => {
  flip(true);
  const items = kids(get('results'));
  for (const li of items) li.computed = { scrollMarginTop: '52px', scrollMarginBottom: '8px' };
  html.clientHeight = 600;
  items[1].rect = { top: 500, bottom: 640, height: 140 }; items[2].rect = { top: 640, bottom: 1300, height: 660 };
  let calm = true;
  const key = (li, k) => {
    stubDocument.focusLog = [];
    context.keyEvent = { target: li.querySelector('button.open'), key: k, preventDefault() {} }; run('rowKeydown(keyEvent);');
    calm = calm && stubDocument.focusLog.length > 0 && stubDocument.focusLog.every((f) => f.options?.preventScroll === true);
  };
  stubDocument.scrolls = [];
  key(items[0], 'ArrowDown');
  const down = stubDocument.scrolls.at(-1);
  if (!down || down.node !== items[1] || down.options?.block !== 'nearest' || !down.selected || stubDocument.focusOptions?.preventScroll !== true) return false;
  key(items[1], 'ArrowDown');
  const tall = stubDocument.scrolls.at(-1);
  if (tall.node !== items[2] || tall.options?.block !== 'start' || !tall.selected || stubDocument.focusOptions?.preventScroll !== true) return false;
  key(items[2], 'ArrowUp');
  const up = stubDocument.scrolls.at(-1);
  return up.node === items[1] && up.options?.block === 'nearest' && stubDocument.scrolls.length === 3 && calm;
});
appCheck('simultaneous 600 and 1024 crossings stay independent in either order: the pick moves and a sheet control keeps focus', ({ run, click, get, fire, flip600, media, media600, docBody, body, item, ids: [a] }) => {
  const fee = get('f-tuition'), more = get('f-more');
  click(a); fire(more, 'click'); fee.focus(); fire(fee, 'focusin');
  media.matches = true; run('crossWide();'); flip600(true);
  if (stubDocument.activeElement !== fee || body.querySelector('h2')?.id !== `p-${a}` || get('filter-sheet').open) return false;
  flip600(false); media.matches = false; run('crossWide();');
  if (stubDocument.activeElement !== more || !item(a).querySelector('.expand')) return false;
  fire(more, 'click'); fee.focus(); fire(fee, 'focusin');
  media600.matches = true; media.matches = true; stubDocument.activeElement = docBody; fire(fee, 'focusout', { relatedTarget: null });
  for (const fn of media600.listeners) fn({ matches: true });
  run('crossWide();');
  if (stubDocument.activeElement !== fee || body.querySelector('h2')?.id !== `p-${a}` || get('filter-sheet').open) return false;
  // The 1024 callback first, with focus already cleared by CSS: it must not
  // wipe the filter record the 600 callback still needs.
  flip600(false); media.matches = false; run('crossWide();');
  fire(more, 'click'); fee.focus(); fire(fee, 'focusin');
  media600.matches = true; media.matches = true; stubDocument.activeElement = docBody; fire(fee, 'focusout', { relatedTarget: null });
  run('crossWide();');
  for (const fn of media600.listeners) fn({ matches: true });
  return stubDocument.activeElement === fee && body.querySelector('h2')?.id === `p-${a}` && !get('filter-sheet').open;
});

// ---------------------------------------------------------------- stage 6
section('Motion, print and the final pass (redesign stage 6)');
// Spec §8 motion, as CSS. Property-specific and media-aware: what may move,
// for how long, and that reduced motion and print stop all of it.
const allCss = cssTree(cssRules);
const rulesFor = (sel, test = () => true) => allCss.filter((r) => r.selector.split(',').map((x) => x.trim()).includes(sel) && test(r));
const bodyOf = (sel, media = []) => rulesFor(sel, (r) => r.media.join('|') === media.join('|')).map((r) => r.body).join(';');
const transitions = allCss.filter((r) => /(?:^|;)\s*transition\s*:/.test(r.body) && !/transition\s*:\s*none/.test(r.body));
// The dormant shortlist/legacy rules keep their old transitions (not §8
// surfaces, never shown); every other transition must be one listed here.
const motionAllowed = {
  '.row,.btn,.inp,.option,.dropdown>summary': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.cols button': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.item:not(.is-sel)>.row:hover': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.expand': 'transition:grid-template-rows var(--t-slow) var(--ease-out),opacity var(--t-slow) var(--ease-out)',
  '.chev': 'transition:transform var(--t-med) var(--ease-in-out)',
  '.dd-chev': 'transition:transform var(--t-med) var(--ease-in-out)',
  '.pane-body>.fade-in': 'transition:opacity var(--t-fast) var(--ease-out)',
  '.sheet': 'transition:transform var(--t-slow) var(--ease-out),display var(--t-slow) allow-discrete,overlay var(--t-slow) allow-discrete',
  '.sheet::backdrop': 'transition:opacity var(--t-slow) var(--ease-out),display var(--t-slow) allow-discrete,overlay var(--t-slow) allow-discrete',
};
const legacyMotion = ['.button', '.button svg', '.chip', '.star'];
const motionProblems = (rules) => rules.filter((r) => /(?:^|;)\s*transition\s*:/.test(r.body) && !/transition\s*:\s*none/.test(r.body)).filter((r) => {
  const sel = r.selector.split(',').map((x) => x.trim()).join(',');
  if (legacyMotion.includes(r.selector.trim())) return false;
  const want = motionAllowed[sel];
  return !want || !r.body.includes(want) || r.media.some((m) => !/min-width: (?:600|1200)px/.test(m));
}).map((r) => r.selector);
check('§8: every transition is a listed effect with its token time and easing; only the dormant legacy rules keep theirs',
  transitions.length >= 8 && motionProblems(allCss).length === 0 && legacyMotion.every((sel) => rulesFor(sel).length > 0)
    && motionProblems(cssTree(cssRules + '.results{transition:opacity .2s}')).length === 1
    && motionProblems(cssTree(cssRules + '.expand{transition:height .2s}')).length === 1,
  motionProblems(allCss).join(', '));
check('§8: no keyframes, stagger, reorder or count/filter animation; no smooth scrolling; no animation property anywhere but print/reduced-motion resets',
  !/@keyframes|transition-delay|animation-delay|scroll-behavior\s*:\s*smooth|view-transition/.test(cssRules)
    && allCss.every((r) => !/(?:^|;)\s*animation\s*:/.test(r.body) || /animation:\s*none\s*!important/.test(r.body))
    && ['.count', '.cshort', '.results', '.fig', '.status', '.item'].every((sel) => !/transition|animation/.test(bodyOf(sel))));
check('slot: one grid row 1fr open / 0fr and transparent closed, a clipping min-height:0 child; the chevron box turns whole, with no shift between states',
  /display:grid;grid-template-rows:1fr/.test(bodyOf('.expand')) && /grid-template-rows:0fr;opacity:0/.test(bodyOf('.expand[data-state=closed]'))
    && /min-height:0;overflow:hidden/.test(bodyOf('.expand-inner')) && !/(?:^|;)\s*transform\s*:/.test(bodyOf('.chev'))
    && /^transform:rotate\(180deg\)$/.test(bodyOf('.is-open .chev')));
check('wide: the selection fill never fades in or out; only an unselected row fades its hover',
  /transition:none/.test(bodyOf('.row', ['@media (min-width: 1200px)'])) && !/transition/.test(bodyOf('.is-sel>.row', ['@media (min-width: 1200px)'])));
check('sheet: slides from translateY(100%) with @starting-style and discrete display/overlay; the scrim fades; from 600 neither transitions',
  /transform:translateY\(100%\)/.test(bodyOf('.sheet')) && /transform:none/.test(bodyOf('.sheet[open]'))
    && /transform:translateY\(100%\)/.test(bodyOf('.sheet[open]', ['@starting-style'])) && /opacity:0/.test(bodyOf('.sheet[open]::backdrop', ['@starting-style']))
    && /background:var\(--scrim\);opacity:0/.test(bodyOf('.sheet::backdrop')) && /opacity:1/.test(bodyOf('.sheet[open]::backdrop'))
    && /transition:none/.test(bodyOf('.sheet', ['@media (min-width: 600px)'])) && /transition:none/.test(bodyOf('.sheet::backdrop', ['@media (min-width: 600px)']))
    && /opacity:0/.test(bodyOf('.pane-body>.fade-in', ['@starting-style'])));
// The old rule shortened every effect to 0.01ms: still a transition, still
// firing its events late. Reduced motion is now none, backdrop included.
const reducedBody = allCss.filter((r) => r.media.join() === '@media (prefers-reduced-motion: reduce)').map((r) => `${r.selector}{${r.body}}`).join('');
check('reduced motion is instant: transition and animation none !important on every element, pseudo-element and ::backdrop; no 0.01ms',
  /\*, \*::before, \*::after, ::backdrop\s*\{[^}]*transition: none !important;[^}]*animation: none !important;[^}]*scroll-behavior: auto !important/.test(reducedBody)
    && !/0\.01ms/.test(cssRules));
// A05: Chrome named a row "World Bachelor in Business , BSc" (and the pane
// "Antropologie , Bc.") because the clipped, absolute ", " counted as its own
// block. The title's separator is inline at zero size; the global utility is
// untouched.
check('A05: the title/degree separator is inline and zero-sized only inside a row button and the detail title; .visually-hidden itself is unchanged',
  /position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;font-size:0;line-height:0/.test(bodyOf('.open>.visually-hidden'))
    && bodyOf('.open>.visually-hidden') === bodyOf('.d-title>.visually-hidden')
    && /position: absolute;/.test(css.match(/\.visually-hidden \{[^}]*\}/)?.[0] ?? '')
    && (renderSrc.match(/el\('span', 'visually-hidden', ', '\)/g) ?? []).length === 2);
check('renderSlot wraps the reduced detail in one .expand-inner; ids and names unchanged', live.slice(0, 40).every((row) => {
  const slot = withStubDocument(() => renderSlot(row, noFilters()));
  return slot.children.length === 1 && slot.children[0].className === 'expand-inner' && slot.children[0].children.length === 1
    && slot.children[0].children[0].classList.contains('detail') && slot.id === `x-${row.id}` && slot.getAttribute('aria-label') === `Details for ${row.programme}`;
}));

// Slot lifecycle on the actual handlers. Frames and timers run only when a
// test advances them, so every stale callback is flushed before asserting.
const slotsOf = (get) => get('results').querySelectorAll('.expand');
const idsUnique = (tree) => { const all = [...nodesOf(tree)].map((n) => n.id).filter((x) => x && /^[xp]-/.test(x)); return new Set(all).size === all.length; };
const ariaResolves = (tree, get) => get('results').querySelectorAll('button.open').every((b) => {
  const c = b.getAttribute('aria-controls'); return c === null || c === 'pane' || [...nodesOf(tree)].some((n) => n.id === c);
});
appCheck('slot opens on the next frame from a computed closed style; its state and ARIA change at once', ({ get, item, click, flushFrame, styleReads, run, ids: [a] }) => {
  click(a);
  const slot = item(a).querySelector('.expand'), b = item(a).querySelector('button.open');
  if (!slot || slot.getAttribute('data-state') !== 'closed' || b.getAttribute('aria-expanded') !== 'true' || b.getAttribute('aria-controls') !== slot.id
    || run('selectedId') !== a || !item(a).classList.contains('is-open')) return false;
  if (!styleReads.some((r) => r.node === slot && r.state === 'closed')) return false;
  flushFrame();
  return slot.getAttribute('data-state') === 'open' && item(a).querySelector('.expand') === slot && slotsOf(get).length === 1;
});
appCheck('slot closes on its own grid-template-rows transitionend, ignoring child and opacity ends; ARIA changes first, controls go with the node', ({ get, item, click, flushFrame, fire, advance, ids: [a] }) => {
  click(a); flushFrame(); click(a);
  const slot = item(a).querySelector('.expand'), b = item(a).querySelector('button.open');
  if (!slot || slot.getAttribute('data-state') !== 'closed' || slot.inert !== true || b.getAttribute('aria-expanded') !== 'false' || item(a).classList.contains('is-open')) return false;
  fire(slot.querySelector('.detail'), 'transitionend', { propertyName: 'grid-template-rows' });
  fire(slot, 'transitionend', { propertyName: 'opacity' });
  if (!item(a).querySelector('.expand')) return false;
  fire(slot, 'transitionend', { propertyName: 'grid-template-rows' });
  if (item(a).querySelector('.expand') || b.getAttribute('aria-controls') !== null) return false;
  advance(400); flushFrame();
  return slotsOf(get).length === 0 && b.getAttribute('aria-expanded') === 'false';
});
appCheck('slot without a transitionend is removed by the 250 ms fallback, not before', ({ item, click, flushFrame, advance, ids: [a] }) => {
  click(a); flushFrame(); click(a);
  advance(249); if (!item(a).querySelector('.expand')) return false;
  advance(1);
  return !item(a).querySelector('.expand') && item(a).querySelector('button.open').getAttribute('aria-controls') === null;
});
appCheck('a close before the first frame removes the slot at once and the cancelled frame does nothing', ({ get, item, click, flushFrame, advance, frames, ids: [a] }) => {
  click(a); click(a);
  if (item(a).querySelector('.expand') || frames.size !== 0) return false;
  flushFrame(); advance(300);
  return slotsOf(get).length === 0 && item(a).querySelector('button.open').getAttribute('aria-expanded') === 'false';
});
appCheck('reopening a closing slot reuses it; the old end event, timer and frame never remove it; other open rows stay independent', ({ get, tree, item, click, flushFrame, fire, advance, run, ids: [a, b, c] }) => {
  click(b); click(c); flushFrame();
  click(a); flushFrame(); click(a);
  const slot = item(a).querySelector('.expand');
  advance(100); click(a);
  if (item(a).querySelector('.expand') !== slot || slot.inert !== false || slot.getAttribute('data-state') !== 'open') return false;
  fire(slot, 'transitionend', { propertyName: 'grid-template-rows' }); advance(500); flushFrame();
  if (item(a).querySelector('.expand') !== slot || item(a).querySelector('button.open').getAttribute('aria-controls') !== slot.id) return false;
  // Open, close and open again before any frame: one region, open.
  click(a); click(a); flushFrame(); advance(500); flushFrame();
  return item(a).querySelectorAll('.expand').length === 1 && item(a).querySelector('.expand').getAttribute('data-state') === 'open'
    && run('[...openIds].sort().join()') === [a, b, c].sort().join() && slotsOf(get).length === 3 && idsUnique(tree) && ariaResolves(tree, get);
});
appCheck('a rebuild while slots open and close settles them: open ones instant, closing ones gone, no stale callback touches the new rows', ({ get, tree, item, click, flushFrame, fire, advance, run, ids: [a, b] }) => {
  click(a); flushFrame(); click(a); const old = item(a).querySelector('.expand');
  click(b); // pending first frame
  run('update();');
  const fresh = item(b).querySelector('.expand');
  if (item(a).querySelector('.expand') || !fresh || fresh.getAttribute('data-state') !== 'open' || run('slotWork.size') !== 0) return false;
  fire(old, 'transitionend', { propertyName: 'grid-template-rows' }); advance(500); flushFrame();
  return item(b).querySelector('.expand') === fresh && fresh.getAttribute('data-state') === 'open' && slotsOf(get).length === 1
    && item(b).querySelector('button.open').getAttribute('aria-controls') === fresh.id && idsUnique(tree) && ariaResolves(tree, get);
});
appCheck('closing a slot that holds focus moves it to the row button first; widening and narrowing mid-close leave no stale removal', ({ get, item, click, flushFrame, advance, flip, body, run, ids: [a, b] }) => {
  click(a); flushFrame(); const link = item(a).querySelector('.expand a'); link.focus(); click(a);
  if (stubDocument.activeElement !== item(a).querySelector('button.open') || stubDocument.focusOptions?.preventScroll !== true) return false;
  click(a); flushFrame(); click(b); flushFrame(); click(b); flip(true);
  if (slotsOf(get).length || run('slotWork.size') !== 0 || body.querySelector('h2')?.id !== `p-${a}`) return false;
  flip(false); advance(500); flushFrame();
  return item(a).querySelectorAll('.expand').length === 1 && item(a).querySelector('.expand').getAttribute('data-state') === 'open' && !item(b).querySelector('.expand');
});
appCheck('reduced motion at start: slots open and close synchronously with no frame or timer', ({ get, item, click, motionMedia, frames, run, ids: [a] }) => {
  motionMedia.matches = true;
  click(a);
  if (item(a).querySelector('.expand')?.getAttribute('data-state') !== 'open' || frames.size !== 0) return false;
  click(a);
  return !item(a).querySelector('.expand') && run('slotWork.size') === 0 && slotsOf(get).length === 0;
});
appCheck('turning reduced motion on mid-effect settles at once: a closing slot goes, an opening slot opens; turning it off only affects later toggles', ({ item, click, flushFrame, motionMedia, frames, run, ids: [a, b] }) => {
  click(a); flushFrame(); click(a); click(b);
  motionMedia.matches = true; for (const fn of motionMedia.listeners) fn({ matches: true });
  if (item(a).querySelector('.expand') || item(b).querySelector('.expand')?.getAttribute('data-state') !== 'open' || frames.size !== 0 || run('slotWork.size') !== 0) return false;
  motionMedia.matches = false; for (const fn of motionMedia.listeners) fn({ matches: false });
  if (item(b).querySelector('.expand')?.getAttribute('data-state') !== 'open') return false;
  click(a);
  return item(a).querySelector('.expand')?.getAttribute('data-state') === 'closed' && frames.size === 1;
});
appCheck('pane: a different pick fades only its new content; same-pick refreshes, filtering and crossings do not; rapid picks end on the last one', ({ run, flip, click, body, context, get, ids: [a, b, c] }) => {
  flip(true);
  if (body.querySelector('.fade-in')) return false;
  click(a); const first = body.children[0];
  if (!first.classList.contains('fade-in') || body.querySelector('h2')?.id !== `p-${a}`) return false;
  run('update();'); if (body.querySelector('.fade-in') || body.querySelector('h2')?.id !== `p-${a}`) return false;
  click(a); if (body.querySelector('.fade-in')) return false;
  click(b); click(c); click(b);
  if (body.querySelector('h2')?.id !== `p-${b}` || !body.children[0].classList.contains('fade-in') || body.children.length !== 1) return false;
  flip(false); flip(true);
  return !body.querySelector('.fade-in') && body.querySelector('h2')?.id === `p-${b}` && run('selectedId') === b;
});
appCheck('Clear all from the bar or the empty state puts focus on Search (never a disabled or hidden button); from the sheet on its heading; a programmatic clear moves nothing', ({ run, get, fire, advance, flip600, context }) => {
  run('facets = buildFacets(allRows); drawChips();');
  const search = get('f-search'), clear = get('f-clear'), empty = get('empty-clear');
  const type = (id, value) => { get(id).value = value; fire(get(id), 'input'); advance(150); };
  flip600(true);
  type('f-tuition', '3000'); clear.focus(); fire(clear, 'click', { detail: 0 });
  if (stubDocument.activeElement !== search || stubDocument.focusOptions?.preventScroll !== true || !clear.disabled) return false;
  type('f-search', 'zzzz-no-such-programme');
  if (empty.hidden || !get('results').parent.hidden) return false;
  empty.focus(); fire(empty, 'click');
  if (stubDocument.activeElement !== search || !get('empty-state').hidden || get('results').parent.hidden) return false;
  flip600(false); type('f-search', 'zzzz-no-such-programme'); empty.focus(); fire(empty, 'click');
  if (stubDocument.activeElement !== search) return false;
  fire(get('f-more'), 'click'); type('f-tuition', '3000'); clear.focus(); fire(clear, 'click');
  if (stubDocument.activeElement !== get('sheet-h')) return false;
  const other = get('f-points'); other.focus(); type('f-tuition', '3000'); run('clearAll();');
  return stubDocument.activeElement === other && run('activeFilterCount(state)') === 0 && context.fixture.length === get('results').children.length;
});
// L09 (Stage 6 profile): drawPane read the pane's scroll size right after the
// rows were rebuilt, forcing a layout of all 1240 (about 120 ms at 4x). The
// scroll is now read before the rebuild, and an unscrolled pane is not touched.
appCheck('pane scroll: a refresh keeps and clamps it, a new pick resets it, and update() reads it only before rebuilding the rows', ({ run, flip, click, pane, get, ids: [a, b] }) => {
  flip(true); click(a);
  pane.scrollTop = 500; pane.scrollHeight = 1000; pane.clientHeight = 300; run('update();');
  if (pane.scrollTop !== 500) return false;
  pane.scrollHeight = 600; run('update();'); if (pane.scrollTop !== 300) return false;
  click(b); if (pane.scrollTop !== 0) return false;
  let top = 0, heightReads = 0, readAt = [];
  Object.defineProperty(pane, 'scrollTop', { configurable: true, get() { readAt.push(get('results').children[0]); return top; }, set(v) { top = v; } });
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get() { heightReads++; return 600; } });
  const old = get('results').children[0];
  run('update();');
  return heightReads === 0 && readAt.length === 1 && readAt[0] === old && get('results').children[0] !== old && top === 0;
});
// L09: update() draws the first screen of rows at once and appends the rest in
// slices after the first paint. Each check below runs on the 1,240 real rows
// unless it says otherwise, and each was seen to fail with the line it guards
// broken.
const l09 = (run) => {
  run('allRows = live; facets = buildFacets(allRows); update();');
  return run('sortRows(applyFilters(allRows, state, shortlist), state.sort, state.dir).map((row) => row.id)');
};
const listIds = (get) => get('results').children.map((n) => n.dataset.id);
const sameList = (get, want) => { const got = listIds(get); return got.length === want.length && new Set(got).size === got.length && got.every((id, i) => id === want[i]); };
appCheck('L09 a: a short list schedules no frame and no timer', ({ run, frames, timers }) => {
  const before = timers.size; run('update();');
  return frames.size === 0 && timers.size === before && run('pendingRows') === null;
});
appCheck('L09 b: the first update draws 40 rows at the top, the count is whole at once, and the rest arrive in order with no duplicates', ({ run, get, drain }) => {
  const want = l09(run);
  if (want.length !== live.length || get('results').children.length !== 40 || run('currentlyShown') !== live.length
    || !get('result-count').textContent.includes(String(live.length))) return false;
  drain();
  return sameList(get, want) && run('pendingRows') === null;
});
appCheck('L09 c: scrolled 6000 px down (narrow), update() draws enough rows to reach the window bottom at 60 px a row', ({ run, get, context }) => {
  context.window.scrollY = 6000; l09(run);
  return get('results').children.length === Math.ceil((6000 + 844) / 60);
});
// advance(0) would run every nested zero timer, so the old list is left
// pending at its timer (short case) or at its frame (long case).
appCheck('L09 d: a second update before the slices finish leaves exactly the second result, short or long', ({ run, get, drain, flushFrame }) => {
  l09(run); flushFrame();
  if (run('pendingRows')?.timer === undefined) return false;
  const term = run('live[500].programme');
  run(`state.search = ${JSON.stringify(term)}; update();`);
  const short = run('sortRows(applyFilters(allRows, state, shortlist), state.sort, state.dir).map((row) => row.id)');
  drain(); if (short.length >= 40 || !sameList(get, short)) return false;
  run("state.search = ''; update();");
  if (run('pendingRows')?.frame === undefined) return false;
  run("state.countries.add('Ireland'); update();");
  const long = run('sortRows(applyFilters(allRows, state, shortlist), state.sort, state.dir).map((row) => row.id)');
  drain();
  return long.length > 40 && sameList(get, long);
});
appCheck('L09 e: beforeprint while rows are pending puts every row in, in order, with a late open slot open', ({ run, get, item, click, drain, fireWindow }) => {
  const want = l09(run); drain(); const late = want[300];
  click(late); drain(); run('update();');
  if (get('results').children.length >= want.length || item(late)) return false;
  fireWindow('beforeprint');
  return sameList(get, want) && run('printing') === true && run('pendingRows') === null
    && item(late).querySelector('.expand')?.getAttribute('data-state') === 'open'
    && item(late).querySelector('button.open').getAttribute('aria-expanded') === 'true';
});
appCheck('L09 f: a 1200 crossing while rows are pending gives every row the new mode, both ways, and narrowing opens a late pick', ({ run, get, item, click, flip, drain }) => {
  const want = l09(run);
  flip(true);
  if (!sameList(get, want) || !get('results').children.every((li) => {
    const b = li.querySelector('button.open'); return b.getAttribute('aria-controls') === 'pane' && b.getAttribute('aria-expanded') === null;
  })) return false;
  const late = want[300]; click(late); run('update();');
  if (item(late)) return false;
  flip(false);
  return sameList(get, want) && get('results').children.every((li) => {
    const b = li.querySelector('button.open');
    return li.dataset.id === late
      ? b.getAttribute('aria-expanded') === 'true' && li.querySelector('.expand')?.getAttribute('data-state') === 'open'
      : b.getAttribute('aria-expanded') === 'false' && b.getAttribute('aria-controls') === null && !li.querySelector('.expand');
  });
});
appCheck('L09 g: wide, ArrowDown on the last drawn row while rows are pending moves focus and the pick to the next row', ({ run, get, flip, drain, context }) => {
  flip(true); const want = l09(run);
  const last = get('results').children.at(-1).querySelector('button.open'); last.focus();
  const e = { target: last, key: 'ArrowDown', preventDefault() { this.defaultPrevented = true; } };
  context.keyEvent = e; run('rowKeydown(keyEvent);');
  const next = get('results').children[40];
  return e.defaultPrevented && next?.dataset.id === want[40] && stubDocument.activeElement === next.querySelector('button.open')
    && run('selectedId') === want[40] && next.classList.contains('is-sel');
});
appCheck('L09 h: a focused row deep in the list is drawn at once and keeps focus', ({ run, get, item, drain }) => {
  const want = l09(run); drain();
  item(want[300]).querySelector('button.open').focus();
  run('update();');
  return get('results').children.length >= 301 && stubDocument.activeElement === item(want[300])?.querySelector('button.open');
});
appCheck('L09 i: a late row gets its open slot (narrow, no motion) or its selection marks (wide) when it arrives', ({ run, get, item, click, flip, drain, frames }) => {
  const want = l09(run); drain(); const late = want[300];
  click(late); drain(); run('update();');
  if (item(late)) return false;
  drain();
  const slot = item(late).querySelector('.expand');
  if (slot?.getAttribute('data-state') !== 'open' || item(late).querySelector('button.open').getAttribute('aria-expanded') !== 'true'
    || run('slotWork.size') !== 0) return false;
  flip(true); click(late); run('update();');
  if (item(late)) return false;
  drain();
  const marked = get('results').children.filter((li) => li.classList.contains('is-sel') || li.querySelector('a.goto') || li.querySelector('[aria-current]'));
  return marked.length === 1 && marked[0] === item(late) && item(late).classList.contains('is-sel')
    && item(late).querySelector('button.open').getAttribute('aria-current') === 'true' && item(late).querySelector('a.goto')?.textContent === 'Go to details';
});
// A fixed 20-row slice plus one of Chrome's major garbage collections once ran
// 53 ms at 4x CPU. Each fill task now stops once SLICE_MS has passed, so a
// slow machine gets smaller slices instead of long tasks.
appCheck('L09 k: each fill task appends rows only until its time budget is spent, and every row still arrives in order', ({ run, get, perf, timers, flushFrame, context }) => {
  const want = l09(run);
  const realAppend = context.appendRows;
  let cost = 1.5;
  context.appendRows = (container, rows, opts) => { perf.t += rows.length * cost; return realAppend(container, rows, opts); };
  perf.tick = 0;
  // One fill task at a time, the way the browser runs them.
  const task = () => {
    const id = run('pendingRows?.timer');
    if (id === undefined) return null;
    const before = get('results').children.length;
    const t = timers.get(id); timers.delete(id); t.fn();
    return get('results').children.length - before;
  };
  flushFrame();
  const cheap = [];
  for (let i = 0; i < 3; i++) cheap.push(task());
  // 1.5 ms a row: a 5-row chunk is 7.5 ms, under the 8 ms budget, so a task
  // takes a second chunk and then stops (10 rows).
  if (!cheap.every((n) => n === 10)) return false;
  // 10 ms a row: one chunk is already over the budget, and a task still makes
  // progress (one chunk, never zero rows).
  cost = 10;
  const dear = [];
  for (let i = 0; i < 3; i++) dear.push(task());
  if (!dear.every((n) => n === 5)) return false;
  cost = 0.5;
  for (let i = 0; i < 1000 && run('pendingRows') !== null; i++) { const n = task(); if (n === null || n < 1 || n > 20) return false; }
  context.appendRows = realAppend;
  return sameList(get, want) && run('pendingRows') === null;
});
// A reload halfway down the list came back near the top: the browser puts the
// scroll back only once the page is tall enough, and only the first screen was
// drawn. The first draw after a reload or Back/Forward now draws every row.
appCheck('L09 l: the first draw after a reload or Back draws every row at once; a fresh visit and later changes draw the first screen', ({ run, get, perf }) => {
  const drawn = (nav) => { perf.navType = nav; run('firstDraw = true;'); const want = l09(run); return [get('results').children.length, want.length, run('pendingRows')]; };
  for (const nav of ['reload', 'back_forward']) {
    const [n, total, pending] = drawn(nav);
    if (n !== total || total !== live.length || pending !== null) return false;
    run('update();');
    if (get('results').children.length !== 40) return false;
  }
  const [n, total] = drawn('navigate');
  return n === 40 && total === live.length;
});
appCheck('L09 j: total failure while rows are pending appends nothing afterwards', ({ run, get, drain }) => {
  l09(run); const drawn = get('results').children.length;
  run("showTotalFailure(new Error('controlled failure'));"); drain();
  return drawn === 40 && get('results').children.length === drawn && run('pendingRows') === null;
});

// L09 (Stage 6): points.js had no modulepreload, so the browser found it only
// after render.js and filters.js arrived, and the CSVs waited one more round
// trip (about 150 ms at 150 ms latency, plans/finish-review/waterfall*.json).
check('every module in app.js\'s import graph is modulepreloaded', (() => {
  const seen = new Set(), queue = ['app.js'];
  while (queue.length) {
    const file = queue.shift();
    for (const [, dep] of read(`js/${file}`).matchAll(/^import[\s\S]*?from '\.\/([\w-]+\.js)';/gm)) if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
  }
  return seen.size >= 7 && seen.has('points.js') && [...seen].every((dep) => indexHtml.includes(`<link rel="modulepreload" href="js/${dep}">`));
})());
check('the sheet footer starts disabled as "Loading programmes…", with no number until the first count',
  /<button type="button" id="sheet-show" class="btn btn-p" disabled>Loading programmes…<\/button>/.test(indexHtml) && !/>Show programmes</.test(indexHtml));
appCheck('the first count enables Show N with its exact number; total failure closes the sheet and Reload takes its focus', ({ run, get, fire, context }) => {
  const show = get('sheet-show');
  if (show.disabled || show.textContent !== `Show ${context.fixture.length} programmes`) return false;
  fire(get('f-more'), 'click'); show.focus();
  run("showTotalFailure(new Error('controlled failure'));");
  return !get('filter-sheet').open && stubDocument.activeElement === get('source-banner').querySelector('button');
});
appCheck('while printing a 1024 or 600 change moves nothing and changes no open id, pick or focus; afterprint runs what is still due', ({ run, get, item, click, flushFrame, fire, advance, media, media600, fireWindow, printMedia, body, tree, ids: [a, b] }) => {
  click(a); flushFrame(); click(b); flushFrame(); click(b); // b closing
  const button = item(a).querySelector('button.open'); button.focus();
  fireWindow('beforeprint');
  if (item(b).querySelector('.expand') || run('slotWork.size') !== 0) return false;
  const before = { open: run('[...openIds].join()'), sel: run('selectedId'), slots: slotsOf(get).length, more: tree.querySelector('.more-filters').parent };
  let moves = 0; const hook = stubDocument.moved; stubDocument.moved = (n) => { moves++; hook(n); };
  printMedia.matches = true; media.matches = true; for (const fn of media.listeners) fn({ matches: true });
  media600.matches = true; for (const fn of media600.listeners) fn({ matches: true });
  const term = run('fixture[0].programme'); get('f-search').value = term; fire(get('f-search'), 'input'); advance(150);
  if (moves || run('[...openIds].join()') !== before.open || run('selectedId') !== before.sel || slotsOf(get).length !== before.slots
    || stubDocument.activeElement !== button || body.querySelector('article') || tree.querySelector('.more-filters').parent !== before.more) return false;
  // The paper's widths go; the screen is still narrow.
  printMedia.matches = false; media.matches = false; media600.matches = false; fireWindow('afterprint');
  if (moves || run('[...openIds].join()') !== before.open || run('state.search') !== term || item(a).querySelector('.expand')?.getAttribute('data-state') !== 'open') return false;
  // A real crossing that happened during print runs from the restored screen.
  fireWindow('beforeprint'); media.matches = true; for (const fn of media.listeners) fn({ matches: true });
  fireWindow('afterprint');
  return body.querySelector('h2')?.id === `p-${a}` && slotsOf(get).length === 0 && run('appliedWide') === true;
});
// A08 print, as CSS: the list on screen, ink on white, open slots whole.
const printRules = allCss.filter((r) => r.media.join() === '@media print');
const printBody = (sel) => printRules.filter((r) => r.selector.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');
// L09: update() assumes no row is shorter than MIN_ROW_PX on screen. A row
// Chrome has not laid out yet takes its placeholder height, so every screen
// placeholder must be at least that, or the list could end above the scroll.
{
  const minRow = Number(appSrc.match(/const MIN_ROW_PX = (\d+);/)?.[1]);
  const sizes = allCss.filter((r) => !r.media.join().includes('print') && r.selector.split(',').some((x) => x.trim() === '.item'))
    .flatMap((r) => [...r.body.matchAll(/contain-intrinsic-size:\s*([^;]+)/g)].map((m) => m[1]));
  const px = sizes.map((v) => Number(v.match(/(\d+(?:\.\d+)?)px/)?.[1]));
  check('every on-screen .item placeholder height is at least MIN_ROW_PX', minRow > 0 && px.length >= 3 && px.every((n) => n >= minRow),
    `MIN_ROW_PX ${minRow}, placeholders ${sizes.join(' | ')}`);
}
check('A08 print hides controls, count, sort header and the list Sort select, pane, chevrons, skip/goto, sheet, shortlist, skeletons, issues, saved-copy and failure banners, but never the sample warning',
  ['.fbar', '.status', '.lang', '.cols', '.listp>.f-sort', '.pane', '.chev', '.goto', '.skip-link', '.sheet', '.shortlist-bar', '.skeletons', '.issues', '.bn-saved', '.bn-fail']
    .every((sel) => /display:none/.test(printBody(sel).replace(/\s/g, '')))
    && !/display:\s*none/.test(printBody('.bn-sample') + printBody('#source-banner') + printBody('.bn') + printBody('.src-more')));
check('A08 print is ink on white: no row, cell, selected, open or banner fill or shadow; titles and verdicts in ink; marks print with backgrounds off',
  ['.row', '.is-open>.row', '.is-sel>.row', '.cell', '.detail', '.listp', '.bn'].every((sel) => /background: none/.test(printBody(sel)) && /box-shadow: none/.test(printBody(sel)))
    && ['.open', '.d-title', '.cell .verd', '.cell .r2'].every((sel) => /color: var\(--ink\)/.test(printBody(sel)))
    && /background: none; color: var\(--ink\)/.test(printBody('.cc[data-country]'))
    && /print-color-adjust: exact/.test(printBody('.m::before')) && /outline: none/.test(printBody('.open:focus-visible::after')));
check('A08 print shows every row and open slot in full: no content skipping or intrinsic size, slots forced open and unclipped, a closing slot hidden, rows kept whole',
  /content-visibility: visible; contain-intrinsic-size: none/.test(printBody('.item')) && /grid-template-rows: 1fr; opacity: 1/.test(printBody('.expand'))
    && /overflow: visible/.test(printBody('.expand-inner')) && /display: none/.test(printBody('.expand[inert]'))
    && /break-inside: avoid/.test(printBody('.row')) && !/break-inside: avoid/.test(printBody('.item'))
    && /transition: none !important; animation: none !important/.test(printBody('*')));

// D12: the Italy/Denmark merge would undo the Bocconi fee and WBB fixes. It
// must refuse to run without --rerun-one-off before it reads or writes
// anything. Checked as text: running it is exactly what must not happen here.
const merge = read('tools/merge-italy-denmark.mjs');
const firstIo = Math.min(...['readFileSync(', 'writeFileSync(', 'save(']
  .map((call) => { const i = merge.indexOf(call); return i < 0 ? Infinity : i; }));
const guardAt = merge.indexOf("process.argv.includes('--rerun-one-off')");
const exitAt = merge.indexOf('process.exit(', guardAt);
check('merge-italy-denmark.mjs refuses to run without --rerun-one-off',
  guardAt > 0 && exitAt > guardAt && exitAt < firstIo);

// ---------------------------------------------------------------- revision behaviour
section('Revision behaviour: direction, exact search and the three new filters');
const revisionBase = { ...sfRow('f-cs'), degreeType: 'BSc', city: 'Delft', cityUnknown: false, tuitionEu: 1000, ibPointsMin: 30 };
const revisionRows = [
  { ...revisionBase, id: 'a', university: 'Alpha', programme: 'B', deadline: new Date('2027-01-01'), deadlinePassed: false },
  { ...revisionBase, id: 'b', university: 'Alpha', programme: 'A', tuitionEu: 2000, ibPointsMin: 35, deadline: new Date('2027-02-01'), deadlinePassed: false },
  { ...revisionBase, id: 'c', university: 'Beta', tuitionEu: 2000, ibPointsMin: 35, deadline: new Date('2026-01-01'), deadlinePassed: true },
  { ...revisionBase, id: 'd', university: 'Delta', tuitionEu: 0, ibPointsMin: 24, deadline: new Date('2026-02-01'), deadlinePassed: true },
  { ...revisionBase, id: 'e', university: 'Echo', tuitionEu: null, ibPointsMin: null, deadline: null, deadlinePassed: false },
];
const orderedIds = (key, dir) => sortRows(revisionRows, key, dir).map((r) => r.id).join('');
for (const [key, asc, desc] of [['deadline', 'abcde', 'badce'], ['tuition', 'dabce', 'bcade'], ['points', 'dabce', 'bcade'], ['name', 'b acde'.replace(' ', ''), 'edcab']]) {
  equal(`${key}: both directions, buckets/nulls and alphabetical ties`, [orderedIds(key, 'asc'), orderedIds(key, 'desc')], [asc, desc]);
}
equal('two-argument and invalid-key sorts retain the natural deadline default', [orderedIds('deadline'), orderedIds('bad')], ['abcde', 'abcde']);
equal('every sort leaves source rows and their order untouched', revisionRows.map((r) => r.id).join(''), 'abcde');
for (const [query, expected] of [['', ['deadline', 'asc']], ['sort=tuition', ['tuition', 'asc']], ['sort=name&dir=desc', ['name', 'desc']], ['dir=desc', ['deadline', 'desc']], ['sort=bad&dir=desc', ['deadline', 'desc']], ['sort=points&dir=asc', ['points', 'asc']], ['dir=bad', ['deadline', 'asc']]]) {
  const st = paramsToState(query);
  equal(`sort URL ${query || '(old/plain)'}`, [st.sort, st.dir], expected);
}
check('only descending direction is serialized, including the default sort', stateToParams({ ...noFilters(), dir: 'desc' }) === 'dir=desc' && !stateToParams({ ...noFilters(), dir: 'asc' }).includes('dir='));
check('cs expands as an exact folded token anywhere, including punctuation/case', ['cs', 'CS, netherlands', '(cs) netherlands', 'netherlands cs', 'science cs computer'].every((q) => finds(q, 'f-cs')));
check('cs requires both words; css/csr remain ordinary short tokens', !matchesSearch('physics economics', 'cs') && !matchesSearch('computer engineering', 'cs') && !matchesSearch('computer science', 'css') && !matchesSearch('computer science', 'csr') && matchesSearch('css design', 'css') && matchesSearch('csr policy', 'csr'));
equal('real Netherlands CS alias has the same complete ID set', live.filter((r) => matchesSearch(r.searchBlob, 'CS Netherlands')).map((r) => r.id), live.filter((r) => matchesSearch(r.searchBlob, 'computer science netherlands')).map((r) => r.id));
check('university aliases and accent folding survive; an exact typo stays empty', live.some((r) => matchesSearch(r.searchBlob, 'uva')) && finds('Kosice', 'f-law') && !live.some((r) => matchesSearch(r.searchBlob, 'compuuter scieence')));
const dateEdges = [-1, 0, 1, 30, 31, 60, 61, null].map((days) => ({ ...revisionBase, id: String(days), daysUntilDeadline: days }));
const newFilteredIds = (rows, edits) => filtersMod.applyFilters(rows, { ...noFilters(), ...edits }, new Set()).map((r) => r.id);
for (const [mode, expected] of [['any', ['-1','0','1','30','31','60','61','null']], ['open', ['0','1','30','31','60','61','null']], ['30', ['0','1','30','null']], ['60', ['0','1','30','31','60','null']]]) {
  equal(`deadline ${mode}: inclusive endpoints, passed exclusion and unknown inclusion`, newFilteredIds(dateEdges, { deadlineWindow: mode }), expected);
}
check('deadline windows use applyToday across local midnight, year/month and DST boundaries', [
  [2026, 11, 31, '2027-01-01'], [2026, 0, 31, '2026-02-01'], [2026, 2, 28, '2026-03-29'], [2026, 9, 24, '2026-10-25'],
].every(([y,m,d,iso]) => {
  const rows = [{ ...revisionBase, deadline: new Date(`${iso}T00:00:00Z`) }];
  applyToday(rows, new Date(y,m,d,23,59)); const before = rows[0].daysUntilDeadline;
  applyToday(rows, new Date(y,m,d+1,0,1)); const today = rows[0].daysUntilDeadline;
  applyToday(rows, new Date(y,m,d+2,0,1));
  return before === 1 && today === 0 && rows[0].daysUntilDeadline === -1 && !newFilteredIds(rows, { deadlineWindow: 'open' }).length;
}));
const groupRows = [
  { ...revisionBase, id: 'match', degreeType: 'BA / BSc', city: 'Brno / Praha', daysUntilDeadline: 30 },
  { ...revisionBase, id: 'other-degree', degreeType: 'BA', city: 'Brno / Praha', daysUntilDeadline: 30 },
  { ...revisionBase, id: 'unknown-degree', degreeType: '?', city: 'Brno / Praha', daysUntilDeadline: 30 },
  { ...revisionBase, id: 'unknown-city', degreeType: '', city: '', cityUnknown: true, daysUntilDeadline: null },
  { ...revisionBase, id: 'absent-city', degreeType: 'BSc', city: '', daysUntilDeadline: 0 },
  { ...revisionBase, id: 'wrong-city', degreeType: '', city: 'Delft', daysUntilDeadline: 30 },
  { ...revisionBase, id: 'wrong-country', degreeType: '', city: '', country: 'Ireland', daysUntilDeadline: 30 },
  { ...revisionBase, id: 'passed', degreeType: '', city: '', daysUntilDeadline: -1 },
];
const groupState = { degreeTypes: new Set(['BA / BSc', 'BSc']), cities: new Set(['Brno / Praha', 'Praha']), countries: new Set(['Netherlands']), deadlineWindow: '30' };
equal('exact composite labels, OR within groups and AND across groups; unknowns bypass only their own group', newFilteredIds(groupRows, groupState), ['match','unknown-degree','unknown-city','absent-city']);
equal('unknown fields cannot rescue a known fee or points failure', newFilteredIds(groupRows.map((r) => ({ ...r, tuitionEu: 2001 })), { ...groupState, maxTuition: 2000 }), []);
equal('unknown fields still respect points and languages', newFilteredIds(groupRows, { ...groupState, myIbPoints: 29, languages: new Set(['Czech']) }), []);
const revisionFacets = filtersMod.buildFacets(groupRows);
equal('full facets preserve exact composites and exclude unknown markers', [revisionFacets.degreeTypes, revisionFacets.cities], [['BA','BA / BSc','BSc'], ['Brno / Praha','Delft']]);
equal('empty/fallback-shaped rows provide empty new facets', [filtersMod.buildFacets([]).degreeTypes, filtersMod.buildFacets([{ ...revisionBase, city: '?', degreeType: '?' }]).cities], [[], []]);
const specialFacets = { ...revisionFacets, cities: ['Brně / Praha & Town'], degreeTypes: ['BA / BSc', 'BSc (Hons)'] };
const specialState = { ...noFilters(), dir: 'desc', deadlineWindow: '60', degreeTypes: new Set(specialFacets.degreeTypes), cities: new Set(specialFacets.cities) };
const specialUrl = stateToParams(specialState);
const specialBack = paramsToState(`${specialUrl}&degree=bad&degree=BA+%2F+BSc&city=bad`, specialFacets);
equal('repeated special-character URL values validate individually and deduplicate', [[...specialBack.degreeTypes], [...specialBack.cities], specialBack.deadlineWindow, specialBack.dir], [specialFacets.degreeTypes, specialFacets.cities, '60', 'desc']);
check('old/invalid/new URLs default safely and defer lists until facets', ['','deadline=bad','deadline=','deadline=any'].every((q) => paramsToState(q).deadlineWindow === 'any') && paramsToState(specialUrl).degreeTypes.size === 0 && paramsToState(specialUrl).cities.size === 0);
equal('counts add one per new group, regardless of selected values, and ignore sort', filtersMod.activeFilterCount(specialState), 3);
check('city inheritance and override are consumed unchanged by the new city filter', newFilteredIds([row('p-inherit'),row('p-override'),row('p-unknown-city')], { cities: new Set(['Faraway']) }).join() === 'p-override,p-unknown-city');
check('unknown degree and all three city states have visible summary/detail labels', withStubDocument(() => ['', '?'].every((degreeType) => {
  const r = { ...revisionBase, degreeType, city: '' };
  return rowOf(r).textContent.includes('Degree type unknown') && rowOf(r).textContent.includes('City unknown') && detailOf(r).textContent.includes('Degree type unknown') && detailOf(r).textContent.includes('City unknown') && detailOf({ ...r, cityUnknown: true }).textContent.includes('City not published');
})));
check('sort select renders eight explicit synchronized choices', withStubDocument(() => {
  const select = new ChromeNode('select'); renderSortOptions(select, filtersMod.SORTS, 'tuition', 'desc');
  return select.children.length === 8 && select.children.filter((o) => o.selected).map((o) => o.value).join() === 'tuition:desc' && new Set(select.children.map((o) => o.value)).size === 8;
}));
check('option search starts above 12, folds accents, clears/no-matches and preserves hidden selection nodes', withStubDocument(() => {
  const panel = new ChromeNode('div'); panel.setAttribute('aria-label','Fixture');
  const box = new ChromeNode('div'); panel.append(box);
  const values = ['Brně', ...Array.from({length: 12}, (_, i) => `Town ${i}`)];
  renderChips(box, values.slice(0,12), new Set(), () => {});
  if (byTag(box,'input').some((n) => n.type === 'search')) return false;
  const selected = new Set(['Brně']); renderChips(box, values, selected, (v,on) => on ? selected.add(v) : selected.delete(v));
  const search = byTag(box,'input').find((n) => n.type === 'search'), labels = byClass(box,'option'), chosen = labels[0], tick = byTag(chosen,'input')[0];
  search.value = 'brne'; dispatchStub(search, {type:'input'});
  if (chosen.hidden || labels.filter((n) => !n.hidden).length !== 1) return false;
  search.value = 'zzzz'; dispatchStub(search, {type:'input'});
  if (!chosen.hidden || !tick.checked || selected.size !== 1 || byTag(box,'p')[0].hidden) return false;
  dispatchStub(byTag(box,'button')[0], {type:'click'});
  return byClass(box,'option')[0] === chosen && !chosen.hidden && tick.checked && search.value === '' && byTag(box,'p')[0].hidden && stubDocument.activeElement === search;
}));
appCheck('sort headings toggle both ways, a new key starts naturally, select/filter/reset stay synchronized', ({ run,get,fire,flip600,context }) => {
  flip600(true);
  const button = context.document.querySelector('.cols [data-sort="deadline"]');
  fire(button,'click');
  if (run('state.dir') !== 'desc' || get('f-sort').value !== 'deadline:desc' || !button.querySelector('.visually-hidden').textContent.includes('latest first')) return false;
  fire(button,'click'); if (run('state.dir') !== 'asc') return false;
  fire(context.document.querySelector('.cols [data-sort="points"]'),'click');
  if (get('f-sort').value !== 'points:asc') return false;
  get('f-sort').value = 'name:desc'; fire(get('f-sort'),'change');
  if (context.document.querySelector('.sort-label').textContent !== 'University Z–A') return false;
  get('f-sort').value = 'tuition:desc'; fire(get('f-sort'),'change');
  if (context.document.querySelector('.sort-label').textContent !== 'University A–Z') return false;
  get('f-deadline').value = 'open'; fire(get('f-deadline'),'change'); fire(get('f-clear'),'click');
  return run('state.sort + state.dir') === 'tuitiondesc' && get('f-sort').value === 'tuition:desc' && get('f-deadline').value === 'any';
});
// Phase 3 diagnosis: the active mark was a CSS triangle that pointed down in
// both directions and a different box from the inactive one. Now every heading
// keeps exactly one .sm box whose symbol says the state and direction.
appCheck('sort marks: one box per heading, i-sort when inactive, chevron-up for the natural order and chevron down reversed, through clicks and the select', ({ run, get, fire, flip600, context }) => {
  flip600(true);
  const buttons = () => [...context.document.querySelectorAll('.cols [data-sort]')];
  const marks = () => Object.fromEntries(buttons().map((b) => {
    const boxes = b.querySelectorAll('.sm');
    return [b.dataset.sort, boxes.length === 1 && boxes[0].getAttribute('aria-hidden') === 'true' ? boxes[0].querySelector('use').getAttribute('href') : 'bad'];
  }));
  const want = (key, dir) => Object.fromEntries(['name', 'points', 'deadline', 'tuition'].map((k) => [k, k === key ? (dir === 'desc' ? '#i-chevron' : '#i-chevron-up') : '#i-sort']));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(marks(), want('deadline', 'asc'))) return false;
  const deadline = buttons().find((b) => b.dataset.sort === 'deadline');
  fire(deadline, 'click'); if (!same(marks(), want('deadline', 'desc')) || deadline.getAttribute('data-direction') !== 'desc') return false;
  fire(buttons().find((b) => b.dataset.sort === 'tuition'), 'click'); if (!same(marks(), want('tuition', 'asc'))) return false;
  get('f-sort').value = 'name:desc'; fire(get('f-sort'), 'change');
  return same(marks(), want('name', 'desc')) && run('state.sort + state.dir') === 'namedesc';
});
appCheck('early deadline edits win load and URL lists restore only full-dataset values', ({run,get,context}) => {
  context.location.search = '?deadline=60&dir=desc&degree=BSc&degree=bad&city=bad';
  run('applyUrlFields();'); if (get('f-deadline').value !== '60') return false;
  get('f-deadline').value = '30'; run('applyUrlLists(); readFields();');
  return run('state.deadlineWindow') === '30' && run('state.dir') === 'desc' && run('state.cities.size') === 0;
});
appCheck('chips count values, sheet counts groups, removal preserves controls/URL/sort and focuses next/previous/Search', ({run,get,fire,flip600,context}) => {
  flip600(true);
  run("state.degreeTypes = new Set(['BSc','BA']); state.cities = new Set(['Delft','Brno']); state.deadlineWindow = 'open'; dom.deadline.value = 'open'; state.sort = 'name'; state.dir = 'desc'; update();");
  const box = get('applied-filters');
  if (box.children.length !== 5 || get('f-more').querySelector('span').textContent !== 'Filters (3)' || get('f-clear').textContent !== 'Clear all (3)') return false;
  const surviving = box.children[1]; fire(box.children[0],'click');
  if (stubDocument.activeElement !== surviving || run('state.deadlineWindow') !== 'any' || !run('stateToParams(state)').includes('dir=desc')) return false;
  fire(box.children.at(-1),'click'); if (stubDocument.activeElement !== box.children.at(-1)) return false;
  while (box.children.length) fire(box.children[0],'click');
  return stubDocument.activeElement === get('f-search') && run('activeFilterCount(state)') === 0 && run('state.sort + state.dir') === 'namedesc';
});
// Jakub's My maths (#f-mymaths) and Entrance exam (#f-exam) selects, driven through the real handlers.
appCheck('actual My maths / Entrance exam selects: choosing updates state and address, chips read "My maths: AA SL" and "Entrance exam: No exam", Filters (n) and Clear all count them, the HL Maths tick stays separate', ({ run, get, fire, context }) => {
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  const maths = get('f-mymaths'), exam = get('f-exam'), box = get('applied-filters'), more = get('f-more'), clear = get('f-clear');
  const chip = (key) => box.children.find((c) => c.getAttribute('data-chip') === key);
  maths.value = 'AA SL'; fire(maths, 'change');
  if (run('state.myMaths') !== 'AA SL' || run('state.exam') !== null || run('state.hlMaths') !== false) return false;
  if (urls.at(-1) !== '/?mymaths=AA+SL' || chip('myMaths')?.getAttribute('data-label') !== 'My maths: AA SL' || chip('exam')) return false;
  exam.value = 'none'; fire(exam, 'change');
  if (run('state.exam') !== 'none' || run('state.myMaths') !== 'AA SL') return false;
  if (urls.at(-1) !== '/?mymaths=AA+SL&exam=none' || chip('exam')?.getAttribute('data-label') !== 'Entrance exam: No exam') return false;
  if (!maths.closest('.fld')?.classList.contains('is-set') || !exam.closest('.fld')?.classList.contains('is-set')) return false;
  if (more.querySelector('span').textContent !== 'Filters (2)' || clear.textContent !== 'Clear all (2)') return false;
  // The tick is a different filter: it adds a Clear all count and a chip, but nothing to the sheet's count.
  get('f-maths').checked = true; fire(get('f-maths'), 'change');
  if (run('state.hlMaths') !== true || run('state.myMaths') !== 'AA SL' || !chip('hlMaths') || !urls.at(-1).includes('maths=1&mymaths=AA+SL&exam=none')
    || more.querySelector('span').textContent !== 'Filters (2)' || clear.textContent !== 'Clear all (3)') return false;
  exam.value = 'skippable'; fire(exam, 'change');
  return chip('exam')?.getAttribute('data-label') === 'Entrance exam: None or skippable' && urls.at(-1).includes('exam=skippable');
});
appCheck('actual My maths / Entrance exam chips: removing one resets its select to "" and state to null and leaves the other; Clear all resets both', ({ run, get, fire, context }) => {
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  const maths = get('f-mymaths'), exam = get('f-exam'), box = get('applied-filters'), clear = get('f-clear');
  const chip = (key) => box.children.find((c) => c.getAttribute('data-chip') === key);
  maths.value = 'AI HL'; fire(maths, 'change'); exam.value = 'skippable'; fire(exam, 'change');
  fire(chip('myMaths'), 'click');
  if (maths.value !== '' || run('state.myMaths') !== null || exam.value !== 'skippable' || run('state.exam') !== 'skippable'
    || chip('myMaths') || !chip('exam') || urls.at(-1) !== '/?exam=skippable') return false;
  maths.value = 'AI HL'; fire(maths, 'change');
  fire(chip('exam'), 'click');
  if (exam.value !== '' || run('state.exam') !== null || maths.value !== 'AI HL' || run('state.myMaths') !== 'AI HL'
    || chip('exam') || !chip('myMaths') || urls.at(-1) !== '/?mymaths=AI+HL') return false;
  exam.value = 'none'; fire(exam, 'change');
  if (run('activeFilterCount(state)') !== 2) return false;
  fire(clear, 'click');
  return maths.value === '' && exam.value === '' && run('state.myMaths') === null && run('state.exam') === null
    && run('activeFilterCount(state)') === 0 && !chip('myMaths') && !chip('exam') && run('stateToParams(state)') === '';
});
appCheck('actual empty state names "your maths course" and "the entrance-exam choice" only while they are set', ({ run, get }) => {
  const hint = () => { run('renderEmptyState(0);'); return get('empty-hint').textContent; };
  run("state.myMaths = 'AA SL';"); if (hint() !== 'Try changing your maths course.') return false;
  run("state.exam = 'none';"); if (hint() !== 'Try changing your maths course or the entrance-exam choice.') return false;
  run('state.myMaths = null;'); return hint() === 'Try changing the entrance-exam choice.';
});
await asyncAppCheck('real start: a URL with mymaths and exam restores both selects and the state on load, and bad values restore neither', async ({ run, get, context, settle }) => {
  context.location.search = '?mymaths=AI+SL&exam=skippable';
  run('applyUrlFields();');
  if (get('f-mymaths').value !== 'AI SL' || get('f-exam').value !== 'skippable') return false;
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  if (run('loaded') !== true || run('state.myMaths') !== 'AI SL' || run('state.exam') !== 'skippable'
    || get('f-mymaths').value !== 'AI SL' || get('f-exam').value !== 'skippable') return false;
  if (!get('applied-filters').children.some((c) => c.getAttribute('data-label') === 'My maths: AI SL')
    || !get('applied-filters').children.some((c) => c.getAttribute('data-label') === 'Entrance exam: None or skippable')) return false;
  context.location.search = '?mymaths=AA+Higher&exam=maybe';
  run('applyUrlFields();');
  return get('f-mymaths').value === '' && get('f-exam').value === '';
}, { boot: true });
appCheck('all new controls keep identity across 599/600 focus moves; sheet chip removal falls back to heading', ({run,get,fire,flip600}) => {
  const deadline = get('f-deadline'), degrees = get('f-degrees'), cities = get('f-cities');
  fire(get('f-more'),'click'); deadline.focus(); fire(deadline,'focusin'); flip600(true);
  if (get('f-deadline') !== deadline || get('f-degrees') !== degrees || get('f-cities') !== cities || stubDocument.activeElement !== deadline) return false;
  flip600(false); if (stubDocument.activeElement !== get('f-more')) return false;
  fire(get('f-more'),'click'); deadline.value = '30'; fire(deadline,'change');
  const box = get('applied-filters'); fire(box.children[0],'click');
  return stubDocument.activeElement === get('sheet-h') && get('filter-sheet').open;
});
// Two groups, as before: the outer .more-filters (fee, Subject, Country, Language) and the
// inner named group that now also holds Jakub's My maths and Entrance exam selects. Only the
// pick-lists are <details>, so Language stays the outer group's last <details> and City the inner
// group's, and the `.dropdown:last-of-type` rule keeps opening each group's end menu leftwards.
{
  const inner = indexHtml.match(/<div class="more-filters" role="group" aria-label="Deadline, maths, entrance exam, degree type and city">([\s\S]*?)<div id="applied-filters"/)?.[1] ?? '';
  const order = [...inner.matchAll(/id="(f-deadline|f-mymaths|f-exam|dd-degrees|dd-cities)"/g)].map((m) => m[1]).join();
  const outer = indexHtml.slice(indexHtml.indexOf('<div class="more-filters">'), indexHtml.indexOf('<div class="more-filters" role="group"'));
  const outerLists = [...outer.matchAll(/<details class="dropdown" id="([\w-]+)"/g)].map((m) => m[1]).join();
  check('new controls retain the existing Language end-menu alignment within two wrapping groups',
    order === 'f-deadline,f-mymaths,f-exam,dd-degrees,dd-cities' && outerLists === 'dd-subjects,dd-countries,dd-languages'
      && (indexHtml.match(/<div class="more-filters"/g) ?? []).length === 2
      && /\.dropdown:last-of-type \.dropdown-panel,#dd-countries \.dropdown-panel\{left:auto;right:0\}/.test(cssRules));
}
appCheck('my-list export uses reverse direction without changing the shortlist or list filters', ({run,get,fire,context}) => {
  run("shortlist.add(fixture[0].id); shortlist.add(fixture[1].id); shortlist.add(fixture[2].id); state.sort = 'name'; state.dir = 'desc';");
  const expected = context.fixture.slice().sort((a,b) => b.university.localeCompare(a.university) || b.programme.localeCompare(a.programme)).map((r) => r.id).join(',');
  fire(get('export-csv'),'click');
  return context.exportedCsv === expected && run('shortlist.size') === 3;
});
await asyncAppCheck('real start continuation validates new URL lists while current scalar edits win its deferred load', async ({run,get,fire,context,settle}) => {
  context.location.search = '?deadline=60&degree=BSc&degree=bad&city=Odense&city=bad&dir=desc';
  run('applyUrlFields();');
  get('f-deadline').value = '30'; fire(get('f-deadline'),'change');
  context.resolveData({programmes:context.fixture, meta:{issues:[]}}); await settle();
  return run('loaded') === true && run('state.deadlineWindow') === '30' && run('state.dir') === 'desc'
    && run('[...state.degreeTypes].join()') === 'BSc' && run('[...state.cities].join()') === 'Odense'
    && get('f-deadline').value === '30' && get('f-sort').value === 'deadline:desc';
}, {boot:true});
appCheck('country and local option-search changes retain full new facet vocabulary, hidden selections and live count nodes', ({run,get,fire}) => {
  const degrees = get('f-degrees').querySelectorAll('input').map((n) => n.value).join();
  const cities = get('f-cities').querySelectorAll('input').map((n) => n.value).join();
  run("state.degreeTypes.add('BSc'); state.cities.add('Odense'); state.countries.add('Ireland'); update();");
  const countNodes = [...get('result-count').children]; run('renderCounts(currentlyShown);');
  return get('f-degrees').querySelectorAll('input').map((n) => n.value).join() === degrees
    && get('f-cities').querySelectorAll('input').map((n) => n.value).join() === cities
    && run("state.degreeTypes.has('BSc') && state.cities.has('Odense')")
    && countNodes.every((n,i) => get('result-count').children[i] === n);
});
check('both the list and the my-list export pass direction', /sortRows\(state.shortlistOnly && listAll \? inScope : filtered, state.sort, state.dir\)/.test(appSrc) && /sortRows\(allRows.filter\(\(r\) => shortlist.has\(r.id\)\), state.sort, state.dir\)/.test(appSrc));

// X02: the dev server used to listen on every interface and serve .git/, so
// anyone on the same Wi-Fi could download the repository. Start the real
// server on a free port and ask it for hidden paths.
section('Dev server (tools/serve.mjs)');
{
  const { spawn } = await import('node:child_process');
  const { createServer: netServer } = await import('node:net');
  const { writeFileSync, rmSync } = await import('node:fs');
  const probe = join(root, '.check-x02-probe');
  const port = await new Promise((done) => {
    const s = netServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); });
  });
  const server = spawn(process.execPath, [join(root, 'tools/serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error('serve.mjs did not start in 5 s')), 5000);
      server.stdout.on('data', (d) => { if (String(d).includes(`:${port}`)) { clearTimeout(timer); done(); } });
      server.on('exit', (code) => { clearTimeout(timer); fail(new Error(`serve.mjs exited ${code}`)); });
    });
    // node:http, not fetch: the loader checks above replace globalThis.fetch.
    const { get } = await import('node:http');
    const status = (path) => new Promise((done, fail) =>
      get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); done(res.statusCode); }).on('error', fail));
    equal('X02 serves the page', await status('/'), 200);
    // A probe dot-file that certainly exists, so a 404 means "refused" and not
    // "missing" (a git archive copy has no .git/ to ask for).
    writeFileSync(probe, 'x02');
    equal('X02 refuses .git/HEAD', await status('/.git/HEAD'), 404);
    equal('X02 refuses a dot-file', await status('/.check-x02-probe'), 404);
    equal('X02 refuses an encoded dot-path', await status('/%2echeck-x02-probe'), 404);
    equal('X02 refuses a dot-path reached through ..', await status('/js/%2e%2e/.check-x02-probe'), 404);
  } catch (err) {
    check('X02 dev server answered', false, err.message);
  } finally {
    server.kill();
    rmSync(probe, { force: true });
  }
  check('X02 listens on 127.0.0.1 only, not every interface',
    /\.listen\(port, '127\.0\.0\.1'/.test(read('tools/serve.mjs')));
}

// D14: identity is derived at load time, so all sources and filtered views agree.
section('D14 same-name programmes');
const { charlesFaculty } = await import(new URL('../js/data.js', import.meta.url));
const sis = (code) => `https://is.cuni.cz/studium/prijimacky/index.php?fakulta=${code}&do=detail_obor&id=123`;
for (const [code, name] of [['11110', 'First'], ['11130', 'Second'], ['11120', 'Third']]) {
  equal(`D14 ${code} faculty and reordered parameters`, charlesFaculty(sis(code), 'cuni')?.name, `${name} Faculty of Medicine`);
}
for (const [url, uni] of [
  [sis('99999'), 'cuni'], [sis(''), 'cuni'], ['broken', 'cuni'],
  [sis('11110').replace('is.cuni.cz', 'is.cuni.cz.example.org'), 'cuni'],
  [sis('11110').replace('detail_obor', 'info_fakulta'), 'cuni'],
  [sis('11110').replace('/studium/', '/other/'), 'cuni'], [sis('11110'), 'muni'],
  [sis('11110').replace('fakulta=11110&', ''), 'cuni'],
]) equal(`D14 no faculty claim for ${url} / ${uni}`, charlesFaculty(url, uni), null);
const charles = live.filter((r) => r.universityId === 'cuni');
equal('D14 real SIS codes remain the reviewed 17 codes',
  [...new Set(charles.map((r) => new URL(r.officialUrl).searchParams.get('fakulta')))].sort(),
  ['11110', '11120', '11130', '11140', '11150', '11160', '11210', '11220', '11230', '11240', '11260', '11270', '11280', '11310', '11320', '11410', '11510']);
check('D14 every Charles faculty is mapped', charles.length > 0 && charles.every((r) => r.faculty));
check('D14 faculty labels cover every same-name Charles sibling', charles.filter((r) => r.identity).every((r) => r.identity.text === r.faculty.name));
equal('D14 only eight real rows still need fallback', live.filter((r) => r.identity?.unresolved).length, 8);
check('D14 MUNI psychology and physiotherapy already differ on the requirements line',
  ['muni-psychology', 'muni-psychology-2', 'muni-physiotherapy', 'muni-physiotherapy-2'].every((id) => !liveRow(id).identity.unresolved && !liveRow(id).identity.text));
const d14Rows = (rows, append = false) => withStubDocument(() => {
  const container = document.createElement('ul');
  const options = { state: noFilters() };
  if (append) {
    renderRows(container, rows.slice(0, 1), options);
    appendRows(container, rows.slice(1), options);
  } else renderRows(container, rows, options);
  return container;
});
const realRendered = d14Rows(live);
const signatures = new Set();
const collisions = [];
for (const item of realRendered.children) {
  // Requirements, fee and deadline already distinguish some same-name rows.
  const signature = JSON.stringify([liveRow(item.getAttribute('data-id')).universityId, item.textContent]);
  if (signatures.has(signature)) collisions.push(item.getAttribute('data-id'));
  signatures.add(signature);
}
equal('D14 real rows have distinct displayed facts', collisions, []);
const uniqueCharles = charles.find((r) => !r.identity);
const uniquePlain = live.find((r) => !r.identity && !r.faculty);
const uniqueDOM = d14Rows([uniquePlain]);
equal('D14 unique-title sub-line keeps exactly its existing children (no faculty)',
  byClass(uniqueDOM, 'sub')[0].children.map((c) => typeof c === 'string' ? c : [c.tagName, c.className, c.textContent]),
  [['span', 'uc', `${uniquePlain.university} · ${uniquePlain.city}`], ' ', ['span', 'cc', uniquePlain.country]]);
equal('D14 unique title without a faculty describes only its degree', byClass(uniqueDOM, 'open')[0].getAttribute('aria-describedby'), `degree-${uniquePlain.id}`);
// U2: a unique-title Charles row still shows its faculty on the row, as a
// separate described element, so students can compare faculties across titles.
const uniqueCharlesDOM = d14Rows([uniqueCharles]);
const uniqueCharlesId = byClass(uniqueCharlesDOM, 'identity')[0];
equal('U2 unique-title Charles row shows its faculty', uniqueCharlesId?.textContent, uniqueCharles.faculty.name);
equal('U2 unique-title Charles row button is described by the faculty', byClass(uniqueCharlesDOM, 'open')[0].getAttribute('aria-describedby'), `degree-${uniqueCharles.id} ${uniqueCharlesId?.id}`);
check('U2 every Charles row with a mapped faculty shows it on the row', charles.filter((r) => r.faculty).every((r) => byClass(d14Rows([r]), 'identity')[0]?.textContent.startsWith(r.faculty.name)));
// U5: the Czech-language note sits inside the Language dropdown (not as a
// fourth help line in the filter area) and describes that panel.
{
  const html = englishHtml(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const panel = html.slice(html.indexOf('id="dd-languages"'), html.indexOf('</details>', html.indexOf('id="dd-languages"')));
  check('U5 Language panel carries the Czech-taught note and is described by it',
    panel.includes('aria-describedby="f-languages-help"') && /<p class="help dd-help" id="f-languages-help">Degrees taught in Czech at public universities are free, whatever your nationality\./.test(panel));
  equal('U5 note appears once', html.split('id="f-languages-help"').length, 2);
}
for (const row of [charles.find((r) => r.identity), uniqueCharles, live.find((r) => r.identity?.unresolved)]) {
  const rowDOM = d14Rows([row]);
  const pane = detailOf(row);
  const slot = withStubDocument(() => renderSlot(row, noFilters()));
  for (const detail of [pane, slot]) {
    if (row.faculty) equal(`D14 ${row.id} Faculty in pane/slot`, kvOf(detail).Faculty?.textContent, row.faculty.name);
    check(`D14 ${row.id} official link carries identity`,
      byTag(detail, 'a').find((a) => a.href === row.officialUrl).textContent.includes(row.identity?.text || row.faculty.name));
    if (row.identity?.unresolved) check(`D14 ${row.id} honest fallback note in pane/slot`,
      detail.textContent.includes(`This list has ${row.identity.count} entries named ‘${row.programme}’ at ${row.university}. This is entry ${row.identity.entry} of ${row.identity.count}. Differences beyond the facts shown here are not recorded. Compare the official admissions pages.`));
  }
  if (row.identity?.text) {
    const identity = byClass(rowDOM, 'identity')[0];
    equal(`D14 ${row.id} identity matches row description`, identity.textContent, row.identity.text);
    equal(`D14 ${row.id} button describes separate identity element`, byClass(rowDOM, 'open')[0].getAttribute('aria-describedby'), `degree-${row.id} ${identity.id}`);
    check(`D14 ${row.id} identity outside truncatable university/city`, !byClass(rowDOM, 'uc')[0].children.includes(identity));
    const ids = [...nodesOf(rowDOM), ...nodesOf(pane), ...nodesOf(slot)].map((n) => n.id).filter(Boolean);
    equal(`D14 ${row.id} ids unique across list/pane/slot`, new Set(ids).size, ids.length);
  }
}
const facultySecond = charles.find((r) => r.faculty.name === 'Second Faculty of Medicine');
for (const query of ['Second Faculty of Medicine', '2nd Faculty of Medicine', '2. lékařská fakulta']) {
  check(`D14 search alias ${query}`, filtersMod.matchesSearch(facultySecond.searchBlob, query));
}
check('D14 Plzeň stays searchable', filtersMod.matchesSearch(charles.find((r) => r.city === 'Plzeň').searchBlob, 'Plzeň'));

const d14Uni = 'university_id,name,city,country,verified_by\ncuni,Test University,Prague,Czechia,AI-DRAFT';
const d14Header = 'programme_id,university_id,programme,degree_type,city,language,admission,tuition_eu,application_deadline,official_url,verified_by';
const d14Fixture = [
  ['f-a', 'Faculty', 'Bc.', '', 'English', '', '', '', sis('11110')],
  ['f-b', 'Faculty', 'Bc.', '', 'English', '', '', '', sis('11130')],
  ['c-a', 'City', 'Bc.', 'Prague', 'English'], ['c-b', 'City', 'Bc.', 'Plzeň', 'English'],
  ['d-a', 'Degree', 'BA', '', 'English'], ['d-b', 'Degree', 'BSc', '', 'English'],
  ['l-a', 'Language', 'BA', '', 'English'], ['l-b', 'Language', 'BA', '', 'Czech'],
  ['a-a', 'Admission', 'BA', '', 'English', 'Entrance exam'], ['a-b', 'Admission', 'BA', '', 'English', 'Talent exam'],
  ['t-a', 'Tuition', 'BA', '', 'English', '', '100'], ['t-b', 'Tuition', 'BA', '', 'English', '', '200'],
  ['e-a', 'Deadline', 'BA', '', 'English', '', '', '2027-01-01'], ['e-b', 'Deadline', 'BA', '', 'English', '', '', '2027-02-01'],
  ['u-b', 'Same', 'BA', '', 'English'], ['u-a', ' Same ', 'BA', '', 'English'],
  ['n-a', 'Unknown', '?', '?', '?'], ['n-b', 'Unknown', 'BA', 'Prague', 'English'],
  ['z-a', 'École', 'BA', '', 'English'], ['z-b', ' E\u0301COLE ', 'BA', '', 'English'],
  ['s-a', '<script>& “Unique”', 'BA', '', 'English'],
  ['x-a', '<img>&', 'BA', '', 'English'], ['x-b', '<img>&', 'BA', '', 'English'],
].map(([id, title, degree, city = '', language = '', admission = '', fee = '', deadline = '', url = `https://example.org/${id}`]) =>
  [id, 'cuni', title, degree, city, language, admission, fee, deadline, url, 'AI-DRAFT'].join(','));
const fixtureCsv = (rows) => [d14Header, ...rows].join('\n');
const { programmes: identityFixture, meta: identityMeta } = await load(d14Uni, fixtureCsv(d14Fixture));
const { programmes: reversedIdentity } = await load(d14Uni, fixtureCsv([...d14Fixture].reverse()));
equal('D14 identity never creates spreadsheet issues', identityMeta.issues, []);
for (const prefix of ['f', 'c', 'd', 'l', 'a', 't', 'e']) check(`D14 ${prefix} known difference resolves fixtures`,
  identityFixture.filter((r) => r.id.startsWith(prefix + '-')).every((r) => !r.identity.unresolved));
for (const id of ['u-a', 'u-b', 'n-a', 'n-b']) check(`D14 ${id} unknown or different URLs cannot distinguish entries`,
  identityFixture.find((r) => r.id === id).identity.unresolved);
check('D14 group titles ignore case, edge spaces and Unicode composition',
  identityFixture.filter((r) => r.id.startsWith('z-')).every((r) => r.identity?.unresolved && r.identity.count === 2));
equal('D14 numbering uses sorted programme ids', identityFixture.find((r) => r.id === 'u-a').identity.entry, 1);
check('D14 unknown faculty adds no search terms', !identityFixture.find((r) => r.id === 'u-a').searchBlob.includes('faculty'));
check('D14 unique title gets no fallback', !identityFixture.find((r) => r.id === 's-a').identity);
// "None required" is on the card, so it tells two same-name entries apart
// from one that lists subjects (review of 68e5ad9).
{
  const subjHeader = d14Header + ',ib_subjects';
  const rows = [['ns-a', 'none'], ['ns-b', 'Maths HL 5']].map(([id, subj]) =>
    [id, 'cuni', 'NoneVsSubjects', 'BA', '', 'English', '', '', '', `https://example.org/${id}`, 'AI-DRAFT', subj].join(','));
  const { programmes: noneRows } = await load(d14Uni, [subjHeader, ...rows].join('\n'));
  check('D14 "None required" vs listed subjects is a known difference', noneRows.every((r) => !r.identity.unresolved));
}
equal('D14 identity stable under input reorder',
  identityFixture.map((r) => [r.id, r.identity]).sort(), reversedIdentity.map((r) => [r.id, r.identity]).sort());
const d14Examples = [
  live.find((r) => r.programme === 'General Medicine' && r.faculty?.name === 'First Faculty of Medicine'),
  liveRow('muni-psychology'),
  live.find((r) => r.universityId === 'muni' && r.identity?.unresolved),
];
const d14ExampleText = [
  'Charles University · Prague Czechia · First Faculty of Medicine',
  'Masaryk University · Brno Czechia',
  'Masaryk University · Brno Czechia · Same-name entry 2 of 2 · compare official pages',
];
d14Examples.forEach((row, i) => {
  equal(`D14 example ${row.id}`, byClass(d14Rows([row]), 'sub')[0].textContent, d14ExampleText[i]);
});
const d14Original = d14Rows(identityFixture);
const d14Chunked = d14Rows(identityFixture, true);
equal('D14 chunked append preserves identity', d14Original.textContent, d14Chunked.textContent);
for (const row of sortRows(identityFixture, 'university')) {
  equal(`D14 ${row.id} identity survives sort and filtering to one sibling`,
    byClass(d14Rows([row]), 'identity').map((n) => n.textContent), row.identity?.text ? [row.identity.text] : []);
}
const escaped = identityFixture.find((r) => r.id === 'x-a');
for (const dom of [d14Rows([escaped]), detailOf(escaped), withStubDocument(() => renderSlot(escaped, noFilters()))]) {
  check('D14 identity and note render spreadsheet markup as text', !byTag(dom, 'img').length && dom.textContent.includes('<img>&'));
}
const savedIdentity = await load('', '', undefined, { snapshot: {
  universities: csvToObjects(d14Uni).rows, programmes: csvToObjects(fixtureCsv(d14Fixture)).rows,
} });
equal('D14 snapshot path computes the same identities',
  savedIdentity.programmes.map((r) => [r.id, r.faculty, r.identity]), identityFixture.map((r) => [r.id, r.faculty, r.identity]));

// Wording contracts: keep labels, their explanations and their checks in step.
section('Reviewed English wording (S08/S09)');
for (const text of [
  'Find European bachelor programmes by IB requirements, deadlines and EU fees.',
  'Find European bachelor programmes by IB requirements.',
  'Try fewer words or check your spelling. Words can appear in any order: “Dublin computer” works. Typos are not corrected.',
  'Some problems hide a row; others leave a value unknown. Each message explains what happened.',
  'Check requirements, EU fees and deadlines on the official admissions page before applying.',
  'Students maintain this site, and details may change.',
  '>Export CSV', '>Clear my list', '>Data problems',
]) check(`static wording: ${text}`, indexHtml.includes(text));
// Leon, 2026-11-02: the filter hints were too long. The search hint is gone
// (the placeholder already shows examples) and the other two are one short
// line each. Keep them short: no hint over 60 characters, and no search hint.
// The yearly-cost hint (2026-11-03) is the third.
check('search has no help line and no empty grid row for one',
  !indexHtml.includes('f-search-help') && !css.includes('search-help')
    && css.includes('grid-template-areas:"q q more" "pts hl hl"'));
{
  const hints = [...indexHtml.matchAll(/<p class="help filter-help"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
  check('filter hints stay short (three, each 60 characters or fewer)', hints.length === 3 && hints.every((h) => h.length <= 60));
}
equal('deadline labels keep their canonical values and agree with the static options', filtersMod.DEADLINE_WINDOWS,
  { any: 'Any date', open: 'Not passed yet', '30': 'Within 30 days', '60': 'Within 60 days' });
for (const [value, label] of Object.entries(filtersMod.DEADLINE_WINDOWS)) {
  check(`static deadline ${value} says ${label}`, indexHtml.includes(`<option value="${value}">${label}</option>`));
}
equal('fee sorting uses EU fee in both directions',
  [filtersMod.SORTS.tuition, filtersMod.REVERSE_SORTS.tuition], ['EU fee — lowest first', 'EU fee — highest first']);
for (const [key, text] of [
  ['your_browser_could_not_save_your_list_it_may_be_lost_when_you_leave', 'Your browser could not save your list. It may be lost when you leave this page.'],
  ['no_programmes_are_saved_here', 'No programmes are saved here.'],
  ['no_programmes_are_available', 'No programmes are available.'],
  ['no_programmes_match_your_filters', 'No programmes match your filters.'],
  ['search', 'Search: {value1}'], ['my_ib_points', 'My IB points: {value1}'],
  ['max_eu_fee_year', 'Max EU fee: €{value1}/year'],
  ['subject_area', 'Subject area'], ['your_ib_points', 'your IB points'], ['the_eu_fee_limit', 'the EU fee limit'],
]) check(`app wording: ${text}`, UI.en[key] === text && appSrc.includes(`t('${key}'`));
const dataWording = read('js/data.js');
for (const [key, text] of [
  ['contains_no_programmes', '{value1} contains no programmes'],
  ['the_file_has_no', 'the {value1} file has no {value2} {value3} '],
  ['returned_http', '{value1} returned HTTP {value2}'],
  ['signed_but_last_verified_is_blank_no_checked_line_is_shown_add_the_d', '{value1}: signed "{value2}" but last_verified is blank. No "Checked" line is shown. Add the date you checked the official page.'],
  ['verified_by_is_blank_shown_as_not_checked_use_ai_draft_until_you_per', '{value1}: verified_by is blank. Shown as not checked. Use AI-DRAFT until you personally check the official page; then add your initials.'],
  ['is_not_a_usable_link_use_an_http_or_https_url_without_a_username_or', '{value1}: "{value2}" is not a usable link. Use an http:// or https:// URL without a username or password.'],
  ['is_blank_no_official_admissions_link_is_shown_add_the_programme_s_of', '{value1} is blank. No official admissions link is shown. Add the programme’s official admissions page.'],
]) check(`data diagnostic wording: ${text}`, UI.en[key] === text && dataWording.includes(`t('${key}'`));
check('option search names its group naturally and shares the clear action with its no-match help', withStubDocument(() => {
  const panel = new ChromeNode('div'); panel.setAttribute('aria-label', 'Subject area');
  const box = new ChromeNode('div'); panel.append(box);
  renderChips(box, Array.from({ length: 13 }, (_, i) => `Area ${i}`), new Set(), () => {});
  return byClass(box, 'opt-q')[0].textContent === 'Search subject area options'
    && byClass(box, 'opt-clear')[0].textContent === 'Clear the search'
    && byClass(box, 'opt-none')[0].textContent === 'No matching options. Try another spelling or clear the search.';
}));
equal('IB points labels match in the row, pane and slot',
  [byClass(rowOf(fxRow('fx-plain')), 'c-pts')[0].children[0].textContent,
    byClass(fxDetail('fx-plain'), 'c-pts')[0].children[0].textContent,
    withStubDocument(() => byClass(renderSlot(fxRow('fx-plain'), noFilters()), 'lab')[0].textContent)],
  ['IB points', 'IB points', 'IB points']);
const issuesDetail = new ChromeNode('details'), issuesSummary = new ChromeNode('summary'), issuesList = new ChromeNode('ul');
const { renderIssues: wordingIssues } = await import('../js/render.js');
withStubDocument(() => wordingIssues(issuesDetail, issuesSummary, issuesList, ['one', 'two']));
equal('issues summary uses the same data-problems label as its banner', issuesSummary.textContent, '2 data problems');

// ============================================================ yearly cost
// BEGIN yearly-cost checks (2026-11-03). Fee + 12 months' living, the "Max
// yearly cost" filter (budget) and "My living costs" (living). Kept in one
// block so it merges cleanly with other work on this file.
section('Yearly cost: fee + 12 months\' living, Max yearly cost and My living costs');
{
  const cost = await import(new URL('../js/cost.js', import.meta.url));
  const { yearlyCost, budgetFit, livingIsFloor } = cost;
  const FLOOR_LABEL = cost.floorLabel();
  const yc = (over, mine = null) => yearlyCost({ tuitionEu: 2000, livingCostMin: 900, livingCostMax: 1200,
    livingCostSource: 'university\'s estimate', deadlineNotes: '', ...over }, mine);
  const pick = (c) => [c.known, c.low, c.high, c.reason, c.personal, c.floor];

  equal('a known fee and range: fee + 12 × each end', pick(yc({})), [true, 12800, 16400, null, false, false]);
  equal('a 0 fee is a real fee, not unknown', pick(yc({ tuitionEu: 0 })), [true, 10800, 14400, null, false, false]);
  equal('personal living 0 is a real figure and replaces the range', pick(yc({}, 0)), [true, 2000, 2000, null, true, false]);
  equal('an unknown fee gives no total', pick(yc({ tuitionEu: null })), [false, null, null, 'fee', false, false]);
  equal('an unknown living cost gives no total', pick(yc({ livingCostMin: null, livingCostMax: null })), [false, null, null, 'living', false, false]);
  equal('both unknown says both', pick(yc({ tuitionEu: null, livingCostMin: null, livingCostMax: null })), [false, null, null, 'both', false, false]);
  equal('personal living replaces an unknown university estimate',
    pick(yc({ livingCostMin: null, livingCostMax: null }, 800)), [true, 11600, 11600, null, true, false]);
  equal('personal living never rescues an unknown fee', pick(yc({ tuitionEu: null }, 800)), [false, null, null, 'fee', true, false]);
  equal('non-finite, negative or text personal living is ignored, never 0',
    [NaN, Infinity, -Infinity, -5, '800', undefined].map((m) => pick(yc({}, m))),
    Array(6).fill([true, 12800, 16400, null, false, false]));
  equal('a non-finite or negative fee is unknown, never 0',
    [NaN, Infinity, -1, '2000'].map((f) => yc({ tuitionEu: f }).reason), ['fee', 'fee', 'fee', 'fee']);
  equal('a non-finite living cost is unknown', yc({ livingCostMin: Infinity, livingCostMax: Infinity }).reason, 'living');

  // Bounds: 12,800–16,400. If the hide test were "low >= budget", 12,800
  // would hide; if "high >= budget" were the crossing test, 16,400 would say maybe.
  equal('budget: lowest estimate exactly at the budget stays (maybe); one euro under hides',
    [12800, 12799].map((b) => budgetFit(yc({}), b)), ['maybe', 'over']);
  equal('budget: highest estimate exactly at the budget fits; one euro under crosses',
    [16400, 16399].map((b) => budgetFit(yc({}), b)), ['within', 'maybe']);
  equal('budget: unknown fee or living is "unknown", even at 0', [budgetFit(yc({ tuitionEu: null }), 0),
    budgetFit(yc({ livingCostMin: null, livingCostMax: null }), 0)], ['unknown', 'unknown']);
  equal('budget: none set gives null', [budgetFit(yc({}), null), budgetFit(yc({}), undefined)], [null, null]);

  // Floors: a visa or residence-permit figure is a minimum, so it never reads as "within".
  const floor = yc({ tuitionEu: 0, livingCostMin: 957, livingCostMax: 957, livingCostSource: 'national estimate (Migration Agency)' });
  equal('a national minimum is a floor; under budget it may exceed', [floor.floor, floor.low, budgetFit(floor, 20000), budgetFit(floor, 11484), budgetFit(floor, 11483)],
    [true, 11484, 'maybe', 'maybe', 'over']);
  check('your own living figure is never a floor', yc({ livingCostSource: 'national estimate (UDI)' }, 900).floor === false);
  equal('floor sources: visa, UDI, Migration Agency yes; portals, universities and same-city borrowings no',
    ['national estimate (German student visa)', 'national estimate (UDI)', 'national estimate (Migration Agency)',
      'national estimate (UK student visa), £1,171 a month', 'national estimate (Study in NL)', 'national estimate (Study in Finland)',
      'university\'s estimate', 'estimate from VŠE, same city', 'university\'s estimate (weekly totals × 52 / 12), £741–£2,019 a month', '', null]
      .map(livingIsFloor), [true, true, true, true, false, false, false, false, false, false, false]);
  const realFloors = [...new Set(live.filter((r) => livingIsFloor(r.livingCostSource)).map((r) => r.livingCostSource))].sort();
  check('real data: every floor source names a visa, UDI or the Migration Agency, and all four kinds are found',
    realFloors.every((s) => /visa|UDI|Migration Agency/.test(s))
      && ['German student visa', 'UDI', 'Migration Agency', 'UK student visa'].every((k) => realFloors.some((s) => s.includes(k))), realFloors.join(' | '));
  check('real data: no university\'s own estimate or national portal is read as a floor',
    live.every((r) => !livingIsFloor(r.livingCostSource) || !/university's|Study in|same city/.test(r.livingCostSource)));
  equal('UK rows say the pounds were converted', cost.poundNote({ deadlineNotes: 'International fee: £33,500 a year, shown here in euros at the ECB rate of 29 October 2026. Irish citizens…' }),
    'converted from £ at the ECB rate of 29 October 2026');
  check('every real UK row with a converted fee gets the conversion note', live.filter((r) => r.country === 'United Kingdom' && /ECB rate/.test(r.deadlineNotes || ''))
    .every((r) => cost.poundNote(r)?.startsWith('converted from £ at the ECB rate of ')));

  // The filter itself.
  const base = { ...sample[0], tuitionEu: 2000, livingCostMin: 900, livingCostMax: 1200, livingCostSource: 'university\'s estimate', deadlineNotes: '' };
  const rowsAt = [
    { ...base, id: 'b-cross' },
    { ...base, id: 'b-over', tuitionEu: 5000 },
    { ...base, id: 'b-fee-unknown', tuitionEu: null },
    { ...base, id: 'b-living-unknown', livingCostMin: null, livingCostMax: null },
    { ...base, id: 'b-zero', tuitionEu: 0 },
  ];
  const shownIds = (state) => filtersMod.applyFilters(rowsAt, { ...filtersMod.createFilterState(), ...state }, new Set()).map((r) => r.id);
  equal('Max yearly cost 12,800 hides only the row whose lowest estimate is over',
    shownIds({ maxBudget: 12800 }), ['b-cross', 'b-fee-unknown', 'b-living-unknown', 'b-zero']);
  equal('Max yearly cost 0 still shows unknowns', shownIds({ maxBudget: 0 }), ['b-fee-unknown', 'b-living-unknown']);
  equal('My living costs 0 with budget 2,000: fee alone decides, and replaces the unknown living cost',
    shownIds({ maxBudget: 2000, myLiving: 0 }), ['b-cross', 'b-fee-unknown', 'b-living-unknown', 'b-zero']);
  equal('My living costs alone hides nothing', shownIds({ myLiving: 5000 }).length, rowsAt.length);
  const unknownLive = live.filter((r) => !yearlyCost(r).known).map((r) => r.id);
  const shownAtZero = new Set(filtersMod.applyFilters(live, { ...filtersMod.createFilterState(), maxBudget: 0 }, new Set()).map((r) => r.id));
  check(`real data: Max yearly cost 0 keeps every one of the ${unknownLive.length} rows with an unknown cost`,
    unknownLive.length > 0 && unknownLive.every((id) => shownAtZero.has(id)));
  equal('Max yearly cost and My living costs each count as a filter',
    [filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), maxBudget: 0 }),
      filtersMod.activeFilterCount({ ...filtersMod.createFilterState(), maxBudget: 0, myLiving: 0 })], [1, 2]);

  // The address.
  const costQuery = stateToParams({ ...filtersMod.createFilterState(), maxBudget: 15000, myLiving: 0 });
  equal('budget and living go in the address and come back (0 included)',
    [costQuery, paramsToState(costQuery).maxBudget, paramsToState(costQuery).myLiving], ['budget=15000&living=0', 15000, 0]);
  const badEuros = ['-5', 'abc', '1.5', '1e5', '', ' ', '0x10', '9'.repeat(400)];
  equal('invalid budget and living values in the address are ignored',
    badEuros.map((v) => { const s = paramsToState(`budget=${encodeURIComponent(v)}&living=${encodeURIComponent(v)}`); return [s.maxBudget, s.myLiving]; }),
    badEuros.map(() => [null, null]));
  equal('parseEuros refuses a number too long to be exact', filtersMod.parseEuros('9'.repeat(400)), { value: null, valid: false });

  // What the row, the detail and the notes say.
  const fee = (row, state) => byClass(rowOf(row, { ...noFilters(), ...state }), 'c-fee')[0];
  const verdOf = (cell) => byClass(cell, 'verd')[0]?.textContent ?? null;
  equal('row fee cell: crossing says "May exceed your budget" on the conditional fill; unknown says so; within says nothing',
    [[fee(rowsAt[0], { maxBudget: 12800 }).className, verdOf(fee(rowsAt[0], { maxBudget: 12800 }))],
      [fee(rowsAt[2], { maxBudget: 12800 }).className, verdOf(fee(rowsAt[2], { maxBudget: 12800 }))],
      [fee(rowsAt[3], { maxBudget: 12800 }).className, verdOf(fee(rowsAt[3], { maxBudget: 12800 }))],
      [fee(rowsAt[0], { maxBudget: 16400 }).className, verdOf(fee(rowsAt[0], { maxBudget: 16400 }))]],
    [['cell c-fee v-cond', 'May exceed your budget'], ['cell c-fee v-unk', 'Yearly cost unknown'],
      ['cell c-fee', 'Yearly cost unknown'], ['cell c-fee', null]]);
  const livingLine = (row, state) => byClass(fee(row, state), 'liv')[0].textContent;
  equal('row living line: range, your own figure, a national minimum and unknown',
    [livingLine(rowsAt[0]), livingLine(rowsAt[0], { myLiving: 800 }), livingLine(rowsAt[3], { myLiving: 0 }),
      livingLine({ ...base, livingCostMin: 957, livingCostMax: 957, livingCostSource: 'national estimate (Migration Agency)' }),
      livingLine(rowsAt[3])],
    ['Living €900–1,200/mo', 'Living: your €800/mo', 'Living: your €0/mo', 'Living from €957/mo', 'Living cost not published']);
  const YEAR = 'Fee + 12 months\' living (estimate)';
  const kvText = (row, state, key = YEAR) => kvOf(detailOf(row, { ...noFilters(), ...state }))[key]?.textContent ?? null;
  equal('detail: the yearly estimate as a range with its source',
    [kvText(rowsAt[0]), kvText(fxRow('fx-plain')), kvText(rowsAt[4])],
    ['€12,800–16,400 a year · university\'s estimate', '€15,700 a year', '€10,800–14,400 a year · university\'s estimate']);
  equal('detail: your own living figure replaces the estimate, said as yours, including where none was published',
    [kvText(rowsAt[0], { myLiving: 800 }), kvText(rowsAt[0], { myLiving: 800 }, 'Living costs'),
      kvText(fxRow('fx-no-applying'), { myLiving: 500 }), kvText(fxRow('fx-no-applying'), { myLiving: 500 }, 'Living costs')],
    ['€11,600 a year · your €800/month', 'Your €800 / month (replacing €900–1,200 / month · university\'s estimate)',
      '€8,500 a year · your €500/month', 'Your €500 / month (no university estimate)']);
  equal('detail: an unknown fee says so; no living figure means no yearly row',
    [kvText(rowsAt[2]), kvText(rowsAt[3]), kvText(fxRow('fx-fee-blank'), { myLiving: 500 })],
    ['Not known because the EU fee is not published', null, 'Not known because the EU fee is not published']);
  const ukRow = { ...base, country: 'United Kingdom', tuitionEu: 38000, livingCostMin: 1401, livingCostMax: 1401,
    livingCostSource: 'national estimate (UK student visa), £1,171 a month',
    deadlineNotes: 'International fee: £33,500 a year, shown here in euros at the ECB rate of 29 October 2026.' };
  equal('detail: a UK visa figure reads "from", is labelled a national minimum, and keeps the £ conversion',
    [kvText(ukRow), kvText(ukRow, {}, 'Living costs')],
    [`from €54,812 a year · national estimate (UK student visa), £1,171 a month · ${FLOOR_LABEL} · converted from £ at the ECB rate of 29 October 2026`,
      `€1,401 / month · national estimate (UK student visa), £1,171 a month · ${FLOOR_LABEL}`]);
  const notesOf = (row, state) => byClass(detailOf(row, { ...noFilters(), ...state }), 'note').map((n) => n.textContent);
  equal('detail notes: unknown cost not filtered; crossing and floor explain "may exceed"; within says nothing',
    [notesOf(rowsAt[2], { maxBudget: 12800 }), notesOf(rowsAt[0], { maxBudget: 12800 }), notesOf(ukRow, { maxBudget: 60000 }), notesOf(rowsAt[0], { maxBudget: 20000 })],
    [['Not filtered by your yearly budget: the EU fee is not published.'],
      ['May exceed your budget: the lowest estimate (€12,800 a year) fits, the highest (€16,400) does not.'],
      ['May exceed your budget: €54,812 a year uses a national minimum for living costs, and real costs are usually higher.'], []]);

  // The CSV export uses the same sum.
  const costCsv = (rows, opts) => csvToObjects(toCsv(rows, opts)).rows;
  const ex = costCsv([rowsAt[0], rowsAt[2], ukRow]);
  const exCols = (r) => [r['Living costs (EUR/month)'], r['Living costs source'], r['Fee + 12 months living, lowest (EUR)'],
    r['Fee + 12 months living, highest (EUR)'], r['Yearly estimate note']];
  equal('export: yearly estimate columns, unknown reason and floor + £ note',
    ex.map(exCols), [['900–1200', 'university\'s estimate', '12800', '16400', ''],
      ['900–1200', 'university\'s estimate', 'Not known', 'Not known', 'the EU fee is not published'],
      ['1401', 'national estimate (UK student visa), £1,171 a month', '54812', '54812', `${FLOOR_LABEL}; converted from £ at the ECB rate of 29 October 2026`]]);
  equal('export: My living costs replaces the estimate there too', exCols(costCsv([rowsAt[0]], { myLiving: 0 })[0]),
    ['0', 'Your own figure', '2000', '2000', '']);
}

appCheck('Max yearly cost and My living costs: typing sets state, address, chips, Filters (n) and Clear all (n); invalid is refused; chips and Clear all clear them', ({ run, get, fire, advance, context }) => {
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  const budget = get('f-budget'), living = get('f-living'), box = get('applied-filters'), more = get('f-more'), clear = get('f-clear');
  const chip = (key) => box.children.find((c) => c.getAttribute('data-chip') === key);
  budget.value = '15000'; fire(budget, 'input'); advance(150);
  if (run('state.maxBudget') !== 15000 || urls.at(-1) !== '/?budget=15000' || chip('maxBudget')?.getAttribute('data-label') !== 'Max yearly cost: €15000') return false;
  if (!budget.closest('.fld').classList.contains('is-set') || more.querySelector('span').textContent !== 'Filters (1)' || clear.textContent !== 'Clear all (1)') return false;
  living.value = '0'; fire(living, 'input'); advance(150);
  if (run('state.myLiving') !== 0 || urls.at(-1) !== '/?budget=15000&living=0' || chip('myLiving')?.getAttribute('data-label') !== 'My living costs: €0/month') return false;
  if (more.querySelector('span').textContent !== 'Filters (2)' || clear.textContent !== 'Clear all (2)') return false;
  budget.value = '-5'; fire(budget, 'input'); advance(150);
  if (run('state.maxBudget') !== null || budget.getAttribute('aria-invalid') !== 'true' || get('f-budget-error').textContent === '' || chip('maxBudget')) return false;
  budget.value = '15000'; fire(budget, 'input'); advance(150);
  fire(chip('maxBudget'), 'click');
  if (budget.value !== '' || run('state.maxBudget') !== null || run('state.myLiving') !== 0 || urls.at(-1) !== '/?living=0') return false;
  budget.value = '9000'; fire(budget, 'input'); advance(150);
  fire(clear, 'click');
  return budget.value === '' && living.value === '' && run('state.maxBudget') === null && run('state.myLiving') === null
    && !chip('maxBudget') && !chip('myLiving') && run('stateToParams(state)') === '';
});
check('Max yearly cost: label, help text exactly, its unit, and both fields in .more-filters naming their help and errors',
  /<label for="f-budget">Max yearly cost<\/label>/.test(indexHtml) && /<label for="f-living">My living costs<\/label>/.test(indexHtml)
    && indexHtml.includes('<p class="help filter-help" id="f-budget-help">Keeps programmes whose lowest estimate fits</p>')
    && /id="f-budget"[^>]*aria-describedby="f-budget-help f-unknown-help f-budget-error"/.test(indexHtml)
    && /id="f-living"[^>]*aria-describedby="f-living-error"/.test(indexHtml)
    && moreSrc.includes('id="f-budget"') && moreSrc.includes('id="f-living"')
    && ['f-budget', 'f-living', 'f-budget-error', 'f-living-error', 'f-budget-help'].every((id) => (indexHtml.match(new RegExp(`id="${id}"`, 'g')) ?? []).length === 1));
await asyncAppCheck('real start: ?budget=15000&living=0 restores both fields and the state on load', async ({ run, get, context, settle }) => {
  context.location.search = '?budget=15000&living=0';
  run('applyUrlFields();');
  if (get('f-budget').value !== '15000' || get('f-living').value !== '0') return false;
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  return run('state.maxBudget') === 15000 && run('state.myLiving') === 0
    && get('applied-filters').children.some((c) => c.getAttribute('data-label') === 'Max yearly cost: €15000');
}, { boot: true });
await asyncAppCheck('real start: invalid budget and living in the address fill neither field nor the state', async ({ run, get, context, settle }) => {
  context.location.search = '?budget=-1&living=1.5';
  run('applyUrlFields();');
  if (get('f-budget').value !== '' || get('f-living').value !== '') return false;
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  return run('state.maxBudget') === null && run('state.myLiving') === null;
}, { boot: true });
// END yearly-cost checks

// BEGIN shortlist checks
// My list (Leon, 2026-11-03, reversing "No save button, no shortlist"): the
// save star, the list view with its groups, Compare and Share. The pure parts
// are tested directly; the wiring through the harness's real app.js.
section('My list: share link, shared links, address, groups, compare (2026-11-03)');
{
  const { shareQuery, readSharedList, unknownIdsText, mergeIntoShortlist, addressQuery, groupRows, groupHeadings } = shortlistMod;
  const { compareTable, differs, visibleFacts, prunePicks, yearlyLine, money: euro } = compareMod;
  const costMod = await import(new URL('../js/cost.js', import.meta.url));

  // --- share link: the list, and points only when ticked
  equal('share link: ids in order, commas kept, nothing else', shareQuery(['uva-law', 'tcd-x']), 'list=uva-law,tcd-x');
  equal('share link: points are left out unless "Include my IB points" is ticked',
    [shareQuery(['a'], { points: 36 }), shareQuery(['a'], { points: 36, includePoints: false }), shareQuery(['a'], { points: 36, includePoints: true })],
    ['list=a', 'list=a', 'list=a&points=36']);
  equal('share link: a ticked box with no points, or a non-whole number, adds nothing',
    [shareQuery(['a'], { points: null, includePoints: true }), shareQuery(['a'], { points: 36.5, includePoints: true })], ['list=a', 'list=a']);
  equal('share link: a comma or & inside an id is encoded, so it cannot split or add a parameter',
    shareQuery(['a,b', 'c&points=45']), 'list=a%2Cb,c%26points%3D45');
  {
    const ids = ['uva-law', 'tcd-x', 'a,b'];
    equal('share link round trip: the ids come back in order', readSharedList(`?${shareQuery(ids)}`, new Set(ids)).ids, ids);
  }

  // --- an incoming ?list=
  const known = new Set(['a', 'b', 'c']);
  equal('incoming list: none in the address is null (no shared view)', [readSharedList('', known), readSharedList('?points=36', known)], [null, null]);
  equal('incoming list: known ids in link order without repeats; unknown ids reported once each; blanks and spaces ignored',
    readSharedList('?list=b,a,b,ghost,,c%20,+a+,ghost,old', known), { raw: 'b,a,b,ghost,,c%20,+a+,ghost,old', ids: ['b', 'a', 'c'], unknown: ['ghost', 'old'] });
  equal('incoming list: a broken escape is an unknown id, not a crash; a later list= is ignored',
    readSharedList('?points=36&list=a,%E0%A4&list=b', known), { raw: 'a,%E0%A4', ids: ['a'], unknown: ['%E0%A4'] });
  equal('incoming list: an empty list is a shared view with nothing in it', readSharedList('?list=', known), { raw: '', ids: [], unknown: [] });
  equal('incoming list: the unknown-id sentence, singular and plural, none when nothing is missing',
    [unknownIdsText(0), unknownIdsText(1), unknownIdsText(2)],
    [null, '1 programme in this link no longer exists.', '2 programmes in this link no longer exist.']);
  {
    const mine = new Set(['x', 'a']);
    const added = mergeIntoShortlist(mine, ['a', 'b', 'c']);
    equal('saving a shared list adds to the saves and keeps every existing one', [added, [...mine]], [2, ['x', 'a', 'b', 'c']]);
  }

  // --- the address
  equal('address: no shared view, no list; the filters alone', [addressQuery('', null), addressQuery('q=law&points=36', null)], ['', 'q=law&points=36']);
  equal('address: a shared view keeps its list first, then the filters',
    [addressQuery('', { raw: 'a,b' }), addressQuery('points=36', { raw: 'a,b' }), addressQuery('', { raw: 'a%2Cb,c' })],
    ['list=a,b', 'list=a,b&points=36', 'list=a%2Cb,c']);

  // --- groups
  const d = (iso) => new Date(`${iso}T00:00:00Z`);
  const g = (id, extra) => ({ id, deadline: null, deadlinePassed: false, country: 'Ireland', ...extra });
  const dated = [g('apr', { deadline: d('2027-04-01') }), g('none'), g('mar1', { deadline: d('2027-03-31') }),
    g('past', { deadline: d('2026-01-15'), deadlinePassed: true }), g('dec', { deadline: d('2026-12-01') }), g('mar2', { deadline: d('2027-03-01') })];
  const byDeadline = groupRows(dated, 'deadline', noFilters(), filtersMod.pointsBucket);
  equal('groups by deadline: year and month in date order (Dec 2026 before Mar 2027), then passed, then no date; rows keep their order',
    byDeadline.map((x) => [x.label, x.rows.map((r) => r.id)]),
    [['December 2026', ['dec']], ['March 2027', ['mar1', 'mar2']], ['April 2027', ['apr']], ['Deadline passed', ['past']], ['No date', ['none']]]);
  equal('groups by deadline: a group with no rows is left out', groupRows([g('none')], 'deadline', noFilters(), filtersMod.pointsBucket).map((x) => x.key), ['none']);
  equal('group headings: the first row of each group carries "label · count"', [...groupHeadings(byDeadline)],
    [['dec', 'December 2026 · 1'], ['mar1', 'March 2027 · 2'], ['apr', 'April 2027 · 1'], ['past', 'Deadline passed · 1'], ['none', 'No date · 1']]);
  {
    const buckets = { w: 'within', m: 'maths', h: 'hidden', u: 'unknown' };
    const stub = (row) => buckets[row.id[0]];
    const rows = ['u1', 'h1', 'w1', 'm1', 'w2'].map((id) => g(id));
    const withPoints = { ...noFilters(), myIbPoints: 36 };
    equal('groups by points: within, only with HL Maths 4+, above, can’t be compared, in that order',
      groupRows(rows, 'points', withPoints, stub).map((x) => [x.label, x.rows.map((r) => r.id)]),
      [['Within your IB points', ['w1', 'w2']], ['Only with HL Maths 4+', ['m1']], ['Above your IB points', ['h1']], ['Can’t be compared', ['u1']]]);
    const empty = groupRows(rows, 'points', noFilters(), stub);
    equal('groups by points with My IB points empty: one unlabelled group (the page asks for points), no headings',
      [empty.length, empty[0].label, empty[0].rows.length, groupHeadings(empty).size], [1, null, 5, 0]);
    // The real pointsBucket on the real rows: every row lands in its own bucket's group.
    const state36 = { ...noFilters(), myIbPoints: 33 };
    const real = groupRows(live, 'points', state36, filtersMod.pointsBucket);
    const labelOf = { within: 'Within your IB points', maths: 'Only with HL Maths 4+', hidden: 'Above your IB points', unknown: 'Can’t be compared' };
    check('groups by points on the real data use pointsBucket: every row in its bucket, all four groups present, none lost',
      real.length === 4 && real.reduce((n, x) => n + x.rows.length, 0) === live.length
        && real.every((x) => x.rows.every((r) => labelOf[filtersMod.pointsBucket(r, state36)] === x.label)));
  }
  equal('groups by country: alphabetical, a row with no country last',
    groupRows([g('a', { country: 'Italy' }), g('b', { country: '' }), g('c', { country: 'Denmark' }), g('d', { country: 'Italy' })], 'country', noFilters(), filtersMod.pointsBucket)
      .map((x) => [x.label, x.rows.map((r) => r.id)]),
    [['Denmark', ['c']], ['Italy', ['a', 'd']], ['Country not recorded', ['b']]]);
  equal('no grouping: one unlabelled group; an empty list no groups',
    [groupRows(dated, 'none', noFilters(), filtersMod.pointsBucket).map((x) => [x.label, x.rows.length]), groupRows([], 'none', noFilters(), filtersMod.pointsBucket)],
    [[[null, 6]], []]);

  // --- compare: only differences, unknowns, and the yearly total
  const cell = (text, unknown = false) => ({ lines: [unknown ? { tag: text } : { text }], unknown });
  equal('only differences: same facts go, different facts stay, any unknown stays (two unknowns are not known to be equal), the link always stays',
    visibleFacts([
      { key: 'same', always: false, cells: [cell('€0'), cell('€0')] },
      { key: 'diff', always: false, cells: [cell('€0'), cell('€500')] },
      { key: 'unk', always: false, cells: [cell('Not published', true), cell('Not published', true)] },
      { key: 'one-unk', always: false, cells: [cell('€0'), cell('Not published', true)] },
      { key: 'link', always: true, cells: [cell('x'), cell('x')] },
    ], true).map((x) => x.key), ['diff', 'unk', 'one-unk', 'link']);
  check('differs: a different second line counts; identical lines do not',
    differs({ cells: [{ lines: [{ text: 'a' }, { text: 'b' }], unknown: false }, { lines: [{ text: 'a' }], unknown: false }] })
      && !differs({ cells: [{ lines: [{ text: 'a' }], unknown: false }, { lines: [{ text: 'a' }], unknown: false }] }));
  {
    const base = live.find((r) => r.tuitionEu !== null && r.tuitionEu > 0 && r.deadline && r.mathsAccepted && r.entranceExam && r.officialUrl);
    const twin = { ...base, id: 'twin', tuitionEu: base.tuitionEu + 1000 };
    const table = compareTable([base, twin], noFilters());
    equal('compare rows: the facts in order, the official link last', table.map((x) => x.label),
      ['IB points', 'Maths courses accepted', 'Entrance exam', 'EU fee', 'Fee + 12 months\' living (estimate)', 'Deadline', 'Language', 'City', 'Apply via', 'Official page']);
    const shown = visibleFacts(table, true).map((x) => x.key);
    check('only differences on two rows that differ only in fee: the fee and the yearly estimate stay (and any unknown), the rest go',
      shown.includes('fee') && shown.includes('link') && !shown.includes('deadline') && !shown.includes('exam') && !shown.includes('city')
        && shown.every((k) => ['fee', 'yearly', 'link'].includes(k) || table.find((x) => x.key === k).cells.some((c) => c.unknown)), shown.join());
    equal('only differences off: every fact', visibleFacts(table, false).length, table.length);
  }
  {
    const unknownRow = { ...live[0], tuitionEu: null, mathsAccepted: null, entranceExam: null, applicationSystem: '', deadline: null, deadlinePassed: false, officialUrl: null, cityUnknown: true };
    const cells = Object.fromEntries(compareTable([unknownRow, live[0]], noFilters()).map((x) => [x.key, x.cells[0]]));
    equal('compare unknowns use the detail’s words: Not published / Not checked yet, in the dashed box',
      ['fee', 'maths', 'exam', 'deadline', 'apply'].map((k) => [k, cells[k].lines[0].tag, cells[k].unknown]),
      [['fee', 'Not published', true], ['maths', 'Not checked yet', true], ['exam', 'Not checked yet', true], ['deadline', 'Not published', true], ['apply', 'Not published', true]]);
    equal('compare: no official link says what the detail says, and counts as unknown', [cells.link.lines[0].text, cells.link.unknown],
      ['No official admissions link. Do not rely on this entry.', true]);
    equal('compare: a "?" city says "City not published", as the detail’s place line', cells.city.lines[0].tag, 'City not published');
    const yearly = cells.yearly.lines[0];
    check('compare: an unknown fee gives no yearly total and says why', yearly.tag === 'Not known' && yearly.text === ' because the EU fee is not published', JSON.stringify(yearly));
  }
  {
    // The compare total is yearlyCost's, with My living costs, floors labelled.
    const sample = [live.find((r) => r.tuitionEu !== null && r.livingCostMin !== null && !costMod.livingIsFloor(r.livingCostSource)),
      live.find((r) => r.tuitionEu !== null && r.livingCostMin !== null && costMod.livingIsFloor(r.livingCostSource)),
      live.find((r) => r.tuitionEu === 0 && r.livingCostMin !== null)].filter(Boolean);
    const sums = [null, 800, 0].flatMap((myLiving) => sample.map((row) => {
      const state = { ...noFilters(), myLiving };
      const line = compareTable([row, row], state).find((x) => x.key === 'yearly').cells[0].lines[0];
      const cost = costMod.yearlyCost(row, myLiving);
      return JSON.stringify(line) === JSON.stringify(yearlyLine(row, cost)) && line.text.startsWith(cost.floor ? `from ${euro.format(cost.low)}` : euro.format(cost.low))
        && (!cost.floor || line.text.includes('national minimum, not a full budget')) && (myLiving === null || line.text.includes(`your ${euro.format(myLiving)}/month`));
    }));
    check('compare yearly totals are yearlyCost’s: the low figure first, floors labelled, My living costs used (3 rows × none/€800/€0)', sample.length === 3 && sums.every(Boolean));
    // And the detail prints the very same words.
    const row = sample[0];
    const words = compareTable([row, row], noFilters()).find((x) => x.key === 'yearly').cells[0].lines[0].text;
    equal('compare and the detail print the same yearly estimate', kvOf(detailOf(row))['Fee + 12 months\' living (estimate)'].textContent, words);
    const examRow = live.find((r) => r.entranceExam === 'waivable');
    equal('compare and the detail print the same entrance-exam line', kvOf(detailOf(examRow))['Entrance exam'].textContent,
      compareTable([examRow, examRow], noFilters()).find((x) => x.key === 'exam').cells[0].lines[0].text);
  }
  {
    const within = live.find((r) => r.pointsKind !== 'cutoff' && r.ibPointsMin !== null && r.ibPointsMin <= 36);
    const lines = compareTable([within, within], { ...noFilters(), myIbPoints: 36 }).find((x) => x.key === 'points').cells[0].lines;
    check('compare points: the card’s lines, then the row’s verdict words while My IB points is set',
      lines[0].text === `${within.ibPointsMin} IB points, minimum` && lines.at(-1).text === 'Within your IB points' && lines.at(-1).verdict === 'fit', JSON.stringify(lines));
  }
  equal('compare picks: list order, never more than 4, a pick no longer in the list dropped',
    [prunePicks(['c', 'a', 'gone'], ['a', 'b', 'c']), prunePicks(['a', 'b', 'c', 'd', 'e'], ['e', 'd', 'c', 'b', 'a'])], [['a', 'c'], ['e', 'd', 'c', 'b']]);
  {
    const rows = [live[0], live[1]];
    const table = compareTable(rows, noFilters());
    const box = withStubDocument(() => { const div = new ChromeNode('div'); renderCompare(div, rows, table, { onlyDifferences: false }); return div; });
    const cols = findAll(box, (n) => n.tagName === 'th' && n.getAttribute('scope') === 'col');
    const facts = findAll(box, (n) => n.tagName === 'th' && n.getAttribute('scope') === 'row');
    check('compare table: one column header per programme naming it and its university; one row header per fact',
      cols.length === 2 && cols[0].textContent === `${rows[0].programme}${rows[0].university}` && facts.map((n) => n.textContent).join('|') === table.map((x) => x.label).join('|'));
    const diffBox = withStubDocument(() => { const div = new ChromeNode('div'); renderCompare(div, [live[0], live[0]], compareTable([live[0], live[0]], noFilters()), { onlyDifferences: true }); return div; });
    const left = findAll(diffBox, (n) => n.tagName === 'tr' && n.getAttribute('data-fact'));
    check('compare table, only differences: identical facts are not drawn and a line says how many are hidden',
      left.every((tr) => tr.getAttribute('data-fact') === 'link' || compareTable([live[0], live[0]], noFilters()).find((x) => x.key === tr.getAttribute('data-fact')).cells.some((c) => c.unknown))
        && byClass(diffBox, 'cmp-same')[0]?.textContent.endsWith('the same for every programme and hidden.'));
  }
}

section('My list in the page: star, list view, compare, share (2026-11-03)');
const starOf = (item) => item.querySelector('button.star');
appCheck('row star: toggles the save with aria-pressed and the filled symbol, names the programme, never opens the row; the bar counts it', ({ run, get, item, fire, context, ids: [a] }) => {
  const star = starOf(item(a));
  const row = context.fixture[0];
  if (!star || star.getAttribute('aria-pressed') !== 'false' || star.querySelector('use').getAttribute('href') !== '#i-bookmark'
    || star.textContent !== `Save ${row.programme}, ${row.university}, to my list` || !get('shortlist-bar').hidden) return false;
  fire(star, 'click');
  if (run('shortlist.has(fixture[0].id)') !== true || star.getAttribute('aria-pressed') !== 'true' || star.querySelector('use').getAttribute('href') !== '#i-bookmark-fill'
    || item(a).classList.contains('is-open') || get('shortlist-bar').hidden || get('shortlist-count-text').textContent !== '1 saved · 1 shown'
    || JSON.stringify(context.savedLists.at(-1)) !== JSON.stringify([a])) return false;
  fire(star, 'click');
  return run('shortlist.size') === 0 && star.getAttribute('aria-pressed') === 'false' && get('shortlist-bar').hidden;
});
appCheck('detail "Save to my list" in the pane and the slot: toggles with the row star, both ways', ({ run, get, item, fire, flip, click, pane, ids: [a] }) => {
  flip(true); click(a);
  const button = pane.querySelector('button.save');
  if (!button || button.getAttribute('aria-pressed') !== 'false' || button.querySelector('.save-t').textContent !== 'Save to my list') return false;
  fire(button, 'click');
  if (button.getAttribute('aria-pressed') !== 'true' || button.querySelector('.save-t').textContent !== 'Saved to my list'
    || starOf(item(a)).getAttribute('aria-pressed') !== 'true' || run('shortlist.has(fixture[0].id)') !== true) return false;
  flip(false);
  const slotButton = item(a).querySelector('.expand button.save');
  if (!slotButton || slotButton.getAttribute('aria-pressed') !== 'true') return false;
  fire(slotButton, 'click');
  return run('shortlist.size') === 0 && starOf(item(a)).getAttribute('aria-pressed') === 'false' && item(a).classList.contains('is-open');
});
appCheck('a failed save says so in the bar', ({ get, item, fire, context, ids: [a] }) => {
  context.saveWorks = false;
  fire(starOf(item(a)), 'click');
  return !get('shortlist-bar').hidden && get('ml-note').textContent === 'Your browser could not save your list. It may be lost when you leave this page.';
});
appCheck('list view: the filters apply inside it, the bar says how many saves they hide, "Show all saves" brings them back, groups head the rows', ({ run, get, fire, ids: [a, b] }) => {
  run('shortlist.add(fixture[0].id); shortlist.add(fixture[1].id); update();');
  if (get('shortlist-count-text').textContent !== '2 saved · 2 shown') return false;
  run('state.search = fixture[0].programme; update();');
  if (get('shortlist-count-text').textContent !== '2 saved · 1 shown · 1 hidden by your filters' || get('ml-show-all').hidden) return false;
  fire(get('f-shortlist-only'), 'click');
  const ids = () => get('results').children.map((n) => n.dataset.id);
  if (run('state.shortlistOnly') !== true || ids().join() !== a || get('ml-tools').hidden
    || get('shortlist-count-text').textContent !== '2 saved · 1 shown · 1 hidden by your filters' || get('f-shortlist-only').textContent !== 'Back to all programmes'
    || !get('result-count').textContent.startsWith('1 of 2 saved programmes')) return false;
  fire(get('ml-show-all'), 'click');
  if (ids().length !== 2 || get('ml-show-all').textContent !== 'Apply my filters' || !get('shortlist-count-text').textContent.includes('your filters are off')) return false;
  // Grouped by deadline by default: the first row of each group carries its heading.
  const heads = get('results').children.map((n) => n.querySelector('.grp-h')?.textContent).filter(Boolean);
  if (!heads.length || !heads.every((h) => /^(\w+ \d{4}|Deadline passed|No date) · \d+$/.test(h))) return false;
  get('ml-group').value = 'points'; fire(get('ml-group'), 'change');
  if (get('ml-note').textContent !== 'Enter your IB points to group the list by them.' || get('results').children.some((n) => n.querySelector('.grp-h'))) return false;
  get('ml-group').value = 'country'; fire(get('ml-group'), 'change');
  if (!get('results').children[0].querySelector('.grp-h')) return false;
  fire(get('f-shortlist-only'), 'click');
  return run('state.shortlistOnly') === false && get('ml-tools').hidden && !get('results').children.some((n) => n.querySelector('.grp-h'))
    && !run('addressQuery(stateToParams(state), shared)').includes('list=');
});
appCheck('list view: unsaving keeps the row (and focus) until the list is redrawn, but the counts and Compare drop it at once; the last unsave then closes the view', ({ run, get, item, fire, ids: [a, b, c] }) => {
  run('for (const r of fixture) shortlist.add(r.id); update();');
  fire(get('f-shortlist-only'), 'click');
  const boxes = get('ml-picks').querySelectorAll('input');
  for (const box of boxes.filter((x) => x.value !== c)) { box.checked = true; fire(box, 'change'); }
  if (get('ml-compare-go').textContent !== 'Compare 2') return false;
  const star = starOf(item(a)); star.focus();
  fire(star, 'click');
  // Before any redraw: the row stays, the counts and the picker do not.
  const picks = get('ml-picks').querySelectorAll('input');
  if (!item(a) || stubDocument.activeElement !== star || star.getAttribute('aria-pressed') !== 'false'
    || get('shortlist-count-text').textContent !== '2 saved · 2 shown' || !get('result-count').textContent.startsWith('2 of 2 saved programmes')
    || picks.map((x) => x.value).sort().join() !== [b, c].sort().join() || run('comparePicks.join()') !== b
    || !get('ml-compare-go').disabled || get('ml-compare-go').textContent !== 'Compare') return false;
  fire(starOf(item(b)), 'click');
  if (!get('ml-compare').hidden || get('shortlist-count-text').textContent !== '1 saved · 1 shown') return false;
  fire(starOf(item(c)), 'click');
  run('update();');
  return run('state.shortlistOnly') === false && get('results').children.length === 3;
});
appCheck('two tabs: each save or unsave goes on the list as stored now, so the other tab’s changes survive; its storage events update this tab', ({ run, get, item, fire, fireWindow, context, ids: [a, b, c] }) => {
  // This tab loaded with a saved; a second tab has since saved c.
  context.stored = [a];
  run('shortlist.add(fixture[0].id); update();');
  context.stored = [a, c];
  fire(starOf(item(b)), 'click');
  if (JSON.stringify(context.stored) !== JSON.stringify([a, c, b])) return false;
  // The second tab saves another; this tab unsaves a.
  context.stored = [a, c, b, 'other-tab'];
  fire(starOf(item(a)), 'click');
  if (JSON.stringify(context.stored) !== JSON.stringify([c, b, 'other-tab']) || starOf(item(a)).getAttribute('aria-pressed') !== 'false') return false;
  // The second tab unsaves b and says so; an event for another key changes nothing.
  context.stored = [c, 'other-tab'];
  fireWindow('storage', { key: run('SHORTLIST_KEY') });
  if (run('[...shortlist].join()') !== `${c},other-tab` || starOf(item(b)).getAttribute('aria-pressed') !== 'false'
    || starOf(item(c)).getAttribute('aria-pressed') !== 'true' || get('shortlist-count-text').textContent !== '1 saved · 1 shown') return false;
  context.stored = [];
  fireWindow('storage', { key: 'something-else' });
  if (run('shortlist.size') !== 2) return false;
  // Inside the list view a change from the other tab draws the list again.
  fire(get('f-shortlist-only'), 'click');
  context.stored = [a, c];
  fireWindow('storage', { key: run('SHORTLIST_KEY') });
  return get('results').children.map((n) => n.dataset.id).sort().join() === [a, c].sort().join()
    && get('shortlist-count-text').textContent === '2 saved · 2 shown';
});
appCheck('blocked storage: once a write fails, changes go on this tab’s list, not on what storage still holds', ({ run, get, item, fire, context, ids: [a, b] }) => {
  context.stored = []; context.saveWorks = false;
  fire(starOf(item(a)), 'click');
  fire(starOf(item(b)), 'click');
  return run('shortlist.size') === 2 && context.stored.length === 0
    && get('ml-note').textContent === 'Your browser could not save your list. It may be lost when you leave this page.';
});
appCheck('compare: pick 2 to 4 from the list, open the table (list hidden), only-differences, close returns focus to the picker', ({ run, get, fire, context }) => {
  run('for (const r of fixture) shortlist.add(r.id); update();');
  fire(get('f-shortlist-only'), 'click');
  const boxes = get('ml-picks').querySelectorAll('input');
  if (boxes.length !== 3 || !get('ml-compare-go').disabled || get('ml-compare').hidden) return false;
  boxes[0].checked = true; fire(boxes[0], 'change');
  if (!get('ml-compare-go').disabled) return false;
  boxes[1].checked = true; fire(boxes[1], 'change');
  if (get('ml-compare-go').disabled || get('ml-compare-go').textContent !== 'Compare 2') return false;
  fire(get('ml-compare-go'), 'click');
  const cols = () => findAll(get('cmp-body'), (n) => n.tagName === 'th' && n.getAttribute('scope') === 'col').length;
  if (get('compare').hidden || !get('results').parent.parent.parent.hidden || cols() !== 2 || get('cmp-h').textContent !== 'Compare 2 programmes'
    || stubDocument.activeElement !== get('compare')) return false;
  const all = findAll(get('cmp-body'), (n) => n.tagName === 'tr' && n.getAttribute('data-fact')).length;
  get('cmp-diff').checked = true; fire(get('cmp-diff'), 'change');
  const fewer = findAll(get('cmp-body'), (n) => n.tagName === 'tr' && n.getAttribute('data-fact')).length;
  // My living costs changes the compare table's totals at once.
  run('state.myLiving = 0; update();');
  const yearly = findAll(get('cmp-body'), (n) => n.getAttribute('data-fact') === 'yearly')[0];
  fire(get('cmp-close'), 'click');
  return fewer <= all && (!yearly || yearly.textContent.includes('your €0/month') || yearly.textContent.includes('Not known'))
    && get('compare').hidden && !get('results').parent.parent.parent.hidden
    && stubDocument.activeElement === get('ml-compare').querySelector('summary');
});
appCheck('compare picker: a fifth pick is disabled at four', ({ run, get, fire, context }) => {
  context.fixture.push(...context.live.slice(1, 3));
  run('allRows = fixture; for (const r of fixture) shortlist.add(r.id); update();');
  fire(get('f-shortlist-only'), 'click');
  const boxes = get('ml-picks').querySelectorAll('input');
  for (const box of boxes.slice(0, 4)) { box.checked = true; fire(box, 'change'); }
  return boxes.length === 5 && boxes[4].disabled && !boxes[0].disabled && get('ml-compare-go').textContent === 'Compare 4';
});
appCheck('share: the link is ?list= of the saves only; no search, country or fee travels; points only with the tick', ({ run, get, fire, ids: [a, b] }) => {
  run("shortlist.add(fixture[1].id); shortlist.add(fixture[0].id); shortlist.add('gone-row'); state.search = 'x'; state.countries.add('Ireland'); state.maxTuition = 5000; state.myIbPoints = 36; update();");
  fire(get('f-shortlist-only'), 'click');
  get('ml-share').open = true; fire(get('ml-share'), 'toggle');
  const url = new URL(get('ml-share-url').value);
  if ([...url.searchParams.keys()].join() !== 'list' || url.searchParams.get('list') !== `${b},${a}` || url.origin + url.pathname !== 'http://localhost:8765/') return false;
  get('ml-share-points').checked = true; fire(get('ml-share-points'), 'change');
  const withPoints = new URL(get('ml-share-url').value);
  if ([...withPoints.searchParams.keys()].join() !== 'list,points' || withPoints.searchParams.get('points') !== '36') return false;
  run('state.myIbPoints = null; update();'); fire(get('ml-share'), 'toggle');
  return get('ml-share-points').disabled && !get('ml-share-points').checked && new URL(get('ml-share-url').value).search === `?list=${b},${a}`;
});
await asyncAppCheck('incoming ?list=: opens a shared view of the known ids, de-duplicated, reports unknown ids, keeps the points, leaves the saves alone until "Save these to my list"', async ({ run, get, fire, context, settle }) => {
  const [a, b] = [context.fixture[0].id, context.fixture[1].id];
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  context.location.search = `?list=${b},${a},${b},ghost-1,ghost-2&points=36`;
  run("applyUrlFields(); shortlist.add('mine');");
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  const ids = get('results').children.map((n) => n.dataset.id).sort().join();
  if (run('state.shortlistOnly') !== true || ids !== [a, b].sort().join() || run('[...shortlist].join()') !== 'mine' || context.savedLists
    || get('ml-title').textContent !== 'Shared list' || get('ml-save-shared').hidden || get('ml-note').textContent !== '2 programmes in this link no longer exist.'
    || get('f-shortlist-only').textContent !== 'Close shared list' || run('state.myIbPoints') !== 36 || !get('ml-share').hidden
    || !urls.every((u) => u.startsWith(`/?list=${b},${a},${b},ghost-1,ghost-2&points=36`))) return false;
  fire(get('ml-save-shared'), 'click');
  if (run('[...shortlist].join()') !== `mine,${b},${a}` || get('ml-save-shared').textContent !== 'Saved to my list'
    || !get('ml-note').textContent.includes('2 programmes added to your list.')) return false;
  // Filters change: the list stays in the address while the view is open.
  run("state.search = 'a'; update();");
  if (!urls.at(-1).startsWith('/?list=')) return false;
  fire(get('f-shortlist-only'), 'click');
  return run('shared') === null && run('state.shortlistOnly') === false && !urls.at(-1).includes('list=') && urls.at(-1).includes('points=36');
}, { boot: true });
await asyncAppCheck('incoming ?list= of only unknown ids: an empty shared view that says so', async ({ run, get, context, settle }) => {
  context.location.search = '?list=ghost';
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  return run('state.shortlistOnly') === true && get('results').children.length === 0
    && get('empty-title').textContent === 'None of the programmes in this link are listed any more.' && get('ml-note').textContent === '1 programme in this link no longer exists.';
}, { boot: true });
appCheck('keepAddress never adds list= outside a shared view, my list view included', ({ run, get, fire, context }) => {
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  context.location.search = '?q=zz';
  run("shortlist.add(fixture[0].id); state.search = 'x'; update();");
  fire(get('f-shortlist-only'), 'click');
  return urls.length > 0 && urls.every((u) => !u.includes('list='));
});
check('keepAddress builds the address through addressQuery with the shared list', /function keepAddress\(\) \{[\s\S]*?addressQuery\(stateToParams\(state\), shared\)/.test(appSrc));
// END shortlist checks

// BEGIN i18n checks
section('SK/EN interface and data translations');
{
  const renderModuleForI18n = await import('../js/render.js');
  const { compareTable: compareTableForI18n } = await import('../js/compare.js');
  const { readdirSync } = await import('node:fs');
  const { sourceLiterals } = await import('./i18n-scan.mjs');
  const { translationInventory } = await import('./i18n-missing.mjs');
  const allow = JSON.parse(read('tools/i18n-allowlist.json'));
  const skRows = csvToObjects(read('data/i18n/sk.csv')).rows;
  const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const forms = (value) => typeof value === 'object' ? Object.values(value) : [value];
  equal('i18n EN and SK have exactly the same keys', Object.keys(UI.sk).sort(), Object.keys(UI.en).sort());
  const placeholderProblems = Object.keys(UI.en).filter((key) => UI.sk[key] && forms(UI.sk[key]).some((value) =>
    JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(forms(UI.en[key])[0]))));
  equal('nonempty Slovak UI values preserve every placeholder', placeholderProblems, []);
  const unknownKeys = [];
  for (const name of readdirSync(join(root, 'js')).filter((name) => name.endsWith('.js') && name !== 'i18n.js')) {
    const path = `js/${name}`;
    for (const value of sourceLiterals(read(path))) {
      if (!Object.hasOwn(UI.en, value) && !allow.sources[path]?.includes(value)) unknownKeys.push(`${path}: ${value}`);
    }
    for (const [, key] of read(path).matchAll(/\bt\('([^']+)'/g)) if (!Object.hasOwn(UI.en, key)) unknownKeys.push(`${path}: missing key ${key}`);
  }
  equal('new JS literals require a UI key or pinned technical exception', unknownKeys, []);
  check('literal guard sees English in strings and nested templates, ignores comments',
    sourceLiterals("// 'comment'\nconst a = `New wording ${ok ? 'Nested wording' : 'Other wording'}`;").includes('New wording ')
      && sourceLiterals("/* 'comment' */ const a = 'A new label';").includes('A new label')
      && !sourceLiterals("// 'comment'\n").includes('comment'));
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  const htmlProblems = [];
  // Every fallback text in an attributed node must be the EN table's value.
  const decode = (text) => text.replaceAll('&euro;', '€').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');
  for (const [, key, text] of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
    if (!Object.hasOwn(UI.en, key) || i18n.normaliseEnglish(decode(text)) !== i18n.normaliseEnglish(UI.en[key])) htmlProblems.push(key);
  }
  const unmarkedHtml = html.replace(/<[^>]*data-i18n="[^"]+"[^>]*>[^<]*</g, '<');
  for (const text of unmarkedHtml.split(/<[^>]*>/).map((text) => text.trim()).filter((text) => /[A-Za-z]/.test(text))) htmlProblems.push(text);
  for (const tag of html.match(/<[^>]+>/g) || []) {
    for (const [, attr, value] of tag.matchAll(/(aria-label|placeholder|title)="([^"]+)"/g)) {
      if (!tag.includes(`data-i18n-attr="${attr}:`) && !tag.includes(`;${attr}:`)) htmlProblems.push(`${attr}=${value}`);
    }
  }
  equal('all HTML text and accessible labels use existing keys with matching EN fallback', htmlProblems, []);
  const pairs = skRows.map((row) => `${row.field}\u0000${i18n.normaliseEnglish(row.en)}`);
  equal('Slovak CSV field + normalised English pairs are unique', pairs.length, new Set(pairs).size);
  check('every Slovak data row has a translation and AI-DRAFT signature', skRows.every((row) => row.sk?.trim() && row.verified_by === 'AI-DRAFT'));
  const HARD = [
    /\d+(?:[.,:]\d+)*/g,
    /\b(?:HL|SL|AA|AI|IB|DP|CAO|UCAS|HPAT|UCAT|LNAT|TOL|SAT|ACT|IELTS|TOEFL|DSH|TestDaF|GCSE|CEFR|OMPT|TSP|SJT)\b/g,
    /\b[ABC][12]\b/g, /[€£%]/g, /https?:\/\/\S+/g,
  ];
  const bag = (text, re) => (text.match(re) || []).sort().join('|');
  const hardProblems = skRows.filter((row) => {
    const mismatch = HARD.some((re) => bag(row.en, re) !== bag(row.sk, re));
    const allowed = allow.hardExceptions.some((item) => item.field === row.field && item.en === row.en && item.sk === row.sk);
    return (mismatch && !allowed) || [' · ', ';'].some((sep) => row.en.split(sep).length !== row.sk.split(sep).length);
  });
  equal('all Slovak data preserves hard tokens and separators, except exact documented rows', hardProblems.map((row) => `${row.field}: ${row.en}`), []);
  const snapshot = JSON.parse(read('data/fallback.json'));
  equal('offline snapshot includes the exact translation CSV', snapshot.translations, skRows.map(({ __row, ...row }) => row));
  const inventory = translationInventory(csvToObjects(read('data/universities.csv')).rows, csvToObjects(read('data/programmes.csv')).rows, skRows);
  console.log(`        ${skRows.length} Slovak data rows; ${inventory.missing.length} missing; ${inventory.orphans.length} orphan rows (report only)`);

  const storage = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  equal('language defaults to Slovak', i18n.initLanguage('', storage), 'sk');
  storage.value = 'en';
  equal('stored language is used before the default', i18n.initLanguage('', storage), 'en');
  equal('a valid ui= language wins over storage', i18n.initLanguage('?ui=sk', storage), 'sk');
  equal('the teaching-language filter lang= never selects the interface', i18n.initLanguage('?lang=sk&lang=English', storage), 'en');
  i18n.initLanguage('?ui=sk', storage);
  equal('language address rewrite preserves raw shared-list commas', i18n.languageQuery('list=a,b&points=36'), 'list=a,b&points=36&ui=sk');
  equal('ui= is rewritten beside lang= filters, which stay untouched', i18n.languageQuery('q=law&lang=English&ui=en'), 'q=law&lang=English&ui=sk');
  {
    // The two parameters restore independently: lang= feeds the teaching-language
    // filter, ui= the interface, and neither leaks into the other.
    const query = '?lang=English&ui=en';
    const restored = paramsToState(query, urlFacets);
    equal('?lang=English&ui=en restores both the filter and the interface',
      [[...restored.languages], i18n.initLanguage(query, storage)], [['English'], 'en']);
    equal('the interface language never becomes a teaching-language filter',
      [...paramsToState('?ui=sk', urlFacets).languages], []);
  }
  i18n.initLanguage('', storage);
  equal('implicit language is absent from rewritten URL', i18n.languageQuery('q=law'), 'q=law');
  i18n.setLanguage('sk', storage);
  equal('a deliberate switch persists and round-trips', [storage.value, i18n.initLanguage(`?${i18n.languageQuery('q=law')}`, storage)], ['sk', 'sk']);
  equal('share links never carry interface language', shortlistMod.shareQuery(['a'], { points: 36, includePoints: true }), 'list=a&points=36');
  // A temporary translation exercises the three Slovak plural branches even
  // while the shipped UI table is deliberately empty.
  const pluralBefore = UI.sk.programme_count;
  UI.sk.programme_count = { one: 'program', few: 'programy', other: 'programov' };
  equal('Slovak plurals distinguish 1, 2–4 and 5+, including 21', [1, 2, 4, 5, 21].map((count) => t('programme_count', { count })), ['program', 'programy', 'programy', 'programov', 'programov']);
  UI.sk.programme_count = pluralBefore;
  i18n.setDataTranslations(skRows);
  const sampleTranslation = skRows.find((row) => row.field === 'subject_area' && row.en === 'Engineering');
  equal('data lookup normalises whitespace and matches exact field + English', i18n.dataParts('subject_area', ' Engineering  ')[0], { text: sampleTranslation.sk, en: 'Engineering' });
  check('subject and bullet lists translate per item when there is no whole-cell match',
    ['Engineering;Law', 'Engineering · Law'].every((text) => i18n.dataParts('subject_area', text).filter((part) => part.en).length === 2));
  check('missing Slovak is plain English with lang=en and no EN marker', withStubDocument(() => {
    const node = renderModuleForI18n.dataValue('admission', 'A new English requirement');
    return node.textContent === 'A new English requirement' && node.querySelector('[data-untranslated]').lang === 'en'
      && !node.querySelector('button, .data-en');
  }));
  check('translated row/compare values have no reveal or EN marker', withStubDocument(() => {
    const node = renderModuleForI18n.dataValue('subject_area', 'Engineering');
    return node.textContent === sampleTranslation.sk && !node.querySelector('button, .data-en, .data-original');
  }));
  check('Slovak result/list rows and Compare contain no EN controls or markers', withStubDocument(() => {
    const rows = live.filter((row) => ['tud-cse', 'tue-cse'].includes(row.id));
    const list = new ChromeNode('ul'), compare = new ChromeNode('div');
    renderModuleForI18n.renderRows(list, rows, { state: noFilters() });
    renderModuleForI18n.renderCompare(compare, rows, compareTableForI18n(rows, noFilters()));
    return !list.querySelector('.data-en, .data-original, .detail-originals')
      && !compare.querySelector('.data-en, .data-original, .detail-originals');
  }));
  check('equal Slovak and English degrees stay plain and do not count as translated', withStubDocument(() => {
    const node = renderModuleForI18n.dataValue('degree_type', 'BSc');
    return node.textContent === 'BSc' && !node.querySelector('[data-english], [data-untranslated], button');
  }));
  // The label says the next action ("Skryť originál" while shown) and the button has no aria-pressed.
  const originalsLabel = (button, shown) => button.textContent === i18n.t(shown ? 'hide_english_original' : 'show_english_original')
    && button.getAttribute('aria-pressed') === null && i18n.t('hide_english_original') !== i18n.t('show_english_original');
  check('one detail button reveals all originals, persists on re-render, closes them together and relabels itself', withStubDocument(() => {
    const state = noFilters();
    const row = live.find((row) => row.id === 'tud-cse');
    const detail = renderModuleForI18n.renderDetail(row, state);
    const button = detail.querySelector('.detail-originals');
    const originals = detail.querySelectorAll('.data-original');
    if (!button || button.type !== 'button' || !originalsLabel(button, false) || originals.length < 2 || !originals.every((n) => n.hidden && n.lang === 'en')) return false;
    button.dispatchEvent({ type: 'click' });
    if (!originalsLabel(button, true) || originals.some((n) => n.hidden)) return false;
    const rerender = renderModuleForI18n.renderDetail(row, state);
    const next = rerender.querySelector('.detail-originals');
    if (!originalsLabel(next, true) || rerender.querySelectorAll('.data-original').some((n) => n.hidden)) return false;
    next.dispatchEvent({ type: 'click' });
    return originalsLabel(next, false) && rerender.querySelectorAll('.data-original').every((n) => n.hidden)
      && detail.querySelectorAll('.d-sec').every((section) => section.querySelectorAll('.english-note').length === (section.querySelector('[data-untranslated]') ? 1 : 0));
  }));
  check('detail without translated values hides the toggle but labels untranslated sections', withStubDocument(() => {
    i18n.setDataTranslations([]);
    const detail = renderModuleForI18n.renderDetail(live.find((row) => row.id === 'tud-cse'), noFilters());
    i18n.setDataTranslations(skRows);
    return !detail.querySelector('.detail-originals') && detail.querySelectorAll('.english-note').length === 2;
  }));
  equal('free-text inventory counts programme rows separately from missing strings',
    translationInventory([], [{ ib_subjects: 'HL Maths', other_requirements: 'none', deadline_notes: 'A note' }, { ib_subjects: 'HL Maths' }], []).freeText,
    { ib_subjects: 2, other_requirements: 0, deadline_notes: 1 });
  const replacingBefore = UI.sk.your_month_replacing;
  UI.sk.your_month_replacing = '{value2} / {value1}';
  check('personal living translation can reorder the complete estimate and personal figure', withStubDocument(() => {
    const detail = renderModuleForI18n.renderDetail(live.find((row) => row.id === 'tud-cse'), { ...noFilters(), myLiving: 800 });
    return detail.textContent.includes(' / €800') && !detail.textContent.includes('\u0000');
  }));
  UI.sk.your_month_replacing = replacingBefore;
  equal('Slovak "X of Y" counts use the genitive for every count',
    i18n.inLanguage('sk', () => [[1, 1], [2, 3], [5, 7]].map(([shown, count]) => i18n.t('count_of_saved', { shown, count }))),
    ['1 z 1 uloženého programu', '2 z 3 uložených programov', '5 z 7 uložených programov']);
  const states = [noFilters(), { ...noFilters(), search: sampleTranslation.sk }, { ...noFilters(), countries: new Set(['Ireland']), myIbPoints: 36, maxBudget: 16000 }];
  const ids = (state, lang) => { i18n.setLanguage(lang, storage); return applyFilters(live, state, new Set()).map((row) => row.id); };
  for (const [i, state] of states.entries()) equal(`filter ids are identical in EN and SK (case ${i + 1})`, ids(state, 'en'), ids(state, 'sk'));
  check('Slovak subject search finds the same English engineering programmes in either UI', states[1].search !== 'Engineering' && ids(states[1], 'en').length > 0);
  i18n.initLanguage('', { getItem: () => 'en' });
  i18n.setDataTranslations([]);
}
appCheck('switching language preserves filters, selection and page scroll', ({ run, get, context }) => {
  context.window.scrollY = 120;
  run("state.search = 'law'; dom.search.value = 'law'; state.maxTuition = 3000; dom.tuition.value = '3000'; selectedId = fixture[0].id; switchLanguage('sk');");
  const kept = run("state.search === 'law' && state.maxTuition === 3000 && selectedId === fixture[0].id");
  run("switchLanguage('en')");
  return kept && context.window.scrollY === 120;
});
appCheck('language changes reset original state while same-language renders preserve it', ({ run }) => {
  run("switchLanguage('sk'); state.englishOriginals = new Set([fixture[0].id]); switchLanguage('sk');");
  const kept = run('state.englishOriginals.has(fixture[0].id)');
  run("switchLanguage('en'); switchLanguage('sk');");
  return kept && run('state.englishOriginals.size === 0');
});
appCheck('switching the interface language never touches the teaching-language filter', ({ run, context }) => {
  context.history.replaceState = (_, __, url) => { context.location.search = new URL(url, 'http://localhost').search; };
  run("state.languages = new Set(['English']); keepAddress();");
  const before = run('location.search');
  run("switchLanguage('sk')");
  const after = run("[...state.languages].join() + '|' + location.search");
  run("switchLanguage('en')");
  const back = run("[...state.languages].join()");
  return /lang=English/.test(before) && after.startsWith('English|') && /lang=English/.test(after) && /ui=sk/.test(after) && back === 'English';
});
i18n.initLanguage('', { getItem: () => 'en' });
// END i18n checks

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
