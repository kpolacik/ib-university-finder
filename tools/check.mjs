import * as savedState from '../js/saved-state.js';
// Checks the parts of this site that are easy to break by accident.
//
//   node tools/check.mjs
//
// Run it after changing anything in js/, and after a big edit to the Sheet.
// It needs no libraries — just Node. Every check prints ok or FAIL, and the
// script exits non-zero if anything failed.

import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
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
// The style methods sit on a prototype, so a style still holds only its values.
const stubStyle = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
class ChromeNode {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.hidden = false; this.attributes = {};
    this.className = ''; this.parent = null; this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 300;
    this.listeners = {}; this.value = ''; this.validity = { badInput: false }; this.style = Object.create(stubStyle);
  }
  get lastChild() { return this.children.at(-1) ?? null; }
  before(node) { this.parent.insertBefore(node, this); }
  after(node) { const next = this.parent.children[this.parent.children.indexOf(this) + 1] ?? null; this.parent.insertBefore(node, next); }
  // A copy without listeners: tag, id, class and attributes, and with
  // cloneNode(true) the children too.
  cloneNode(deep = false) {
    const node = new ChromeNode(this.tagName);
    node.id = this.id; node.className = this.className; node.attributes = { ...this.attributes };
    // parseHtml keeps <details open> as a property; the real attribute is cloned.
    if (deep && this.open) node.open = true;
    if (deep) for (const child of this.children) node.append(typeof child === 'string' ? child : child.cloneNode(true));
    return node;
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
  removeAttribute(name) { delete this.attributes[name]; if (name === 'id') this.id = ''; }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v])); }
  contains(node) { return node === this || this.children.some((c) => typeof c !== 'string' && c.contains(node)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  // Compound selectors (tag, #id, every .class, every [attr]) joined by
  // descendant spaces, with comma lists. Enough for the selectors app.js uses.
  matches(selector) {
    const compound = (node, part) => {
      const tag = part.match(/^[a-z][a-z0-9-]*/)?.[0], id = part.match(/#([\w-]+)/)?.[1];
      const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const attrs = [...part.matchAll(/\[([\w-]+)(?:="?([^"\]]+)"?)?\]/g)];
      return (!part.includes(':checked') || node.checked === true) && (!tag || node.tagName === tag) && (!id || node.id === id) && classes.every((c) => node.classList.contains(c))
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
  blur() { if (stubDocument.activeElement === this) stubDocument.activeElement = stubDocument.body; }
  get isConnected() { return !!stubDocument.body?.contains(this); }
  getClientRects() { return stubDocument.canFocus?.(this) === false ? [] : [this.getBoundingClientRect()]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatchEvent(event) { return dispatchStub(this, event); }
  getBoundingClientRect() { return this.rect ?? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  scrollIntoView(options) { (stubDocument.scrolls ??= []).push({ node: this, options, selected: this.classList.contains('is-sel') }); }
  // <dialog>: show() and showModal() focus a heading; close() returns focus and
  // queues the close event, so it can run after a reopen.
  showModal() { this.show(); }
  show() {
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
  get tabIndex() {
    const explicit = this.getAttribute('tabindex');
    return explicit !== null ? Number(explicit) : (/^(button|input|select|textarea|summary)$/.test(this.tagName) || (this.tagName === 'a' && this.getAttribute('href')) ? 0 : -1);
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
const { renderDetail, renderRows, appendRows, renderSlot, renderCount, renderPane, renderCountShort, renderChips, renderAppliedChips, renderSortOptions, setSaved, setInCompare, renderCompare } = await import(new URL('../js/render.js', import.meta.url));
// My list (2026-11-03): the pure share, group and compare functions app.js
// imports, given to the harness below like the filter functions.
const shortlistMod = await import(new URL('../js/shortlist.js', import.meta.url));
const compareMod = await import(new URL('../js/compare.js', import.meta.url));
// Batch 3 · A: the compare set, its own list apart from the saves.
const compareSetMod = await import(new URL('../js/compare-set.js', import.meta.url));
// PR 7 A12: the shared sheet drag, run for real against the stand-in nodes.
const sheetDragMod = await import(new URL('../js/sheet-drag.js', import.meta.url));
// A stand-in localStorage for the compare set: blocked throws on any access,
// full throws on writes only (a quota or a private-browsing write).
function fakeStorage(entries = {}) {
  return { data: { ...entries }, blocked: false, full: false,
    getItem(key) { if (this.blocked) throw new Error('SecurityError'); return this.data[key] ?? null; },
    setItem(key, value) { if (this.blocked || this.full) throw new Error('QuotaExceededError'); this.data[key] = String(value); } };
}
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
// Settings radios replace the pill: checked state and button wording must follow ?ui and storage.
check('settings exposes native language radios with their own language names and a bilingual legend',
  ['en', 'sk'].every((lang) => foundationHtml.includes(`data-language="${lang}" lang="${lang}"`))
    && /name="site-language"/.test(foundationHtml) && !/class="lang"/.test(foundationHtml)
    && UI.en.settings_language === 'Language · Jazyk' && UI.sk.settings_language === UI.en.settings_language);
check('applyLanguage synchronises checked language, button code and accessible name in both UIs', (() => {
  const nodes = ['en', 'sk'].map((lang) => ({ checked: false, getAttribute: () => lang }));
  const code = { setAttribute() {}, textContent: '' };
  const button = { getAttribute: () => 'aria-label:settings_name', setAttribute(name, value) { this[name] = value; } };
  const root = { documentElement: {}, querySelectorAll: (selector) => ({ '[data-language]': nodes, '#settings-language': [code], '[data-i18n-attr]': [button] }[selector] ?? []) };
  try {
    return ['sk', 'en'].every((lang) => {
      i18n.initLanguage(`?ui=${lang}`, { getItem: () => lang === 'en' ? 'sk' : 'en' }); i18n.applyLanguage(root);
      return nodes.every((node, i) => node.checked === (['en', 'sk'][i] === lang)) && code.textContent === lang.toUpperCase()
        && button['aria-label'] === UI[lang].settings_name && root.documentElement.lang === lang;
    });
  } finally { i18n.initLanguage('', { getItem: () => 'en' }); }
})());
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
      && source.children[0].className === 'stat' && source.children[0].tagName !== 'b'
      && source.textContent.endsWith(' Data comes from the universities’ official pages and the CAO; living costs are estimates.'));
  renderSourceLine(source, rows.slice(0, 1), { ...base, draftCount: 1 });
  equal('one unchecked programme keeps singular source counts without repeating the footer disclaimer', source.textContent,
    '1 programme · 1 university · 1 country. Data comes from the universities’ official pages and the CAO; living costs are estimates.');
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
        && !banner.textContent.includes("Always check the university's official page"));
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
  !/id="f-tuition"[^>]*step="500"/.test(indexHtml) && /id="f-tuition"[^>]*step="1"/.test(indexHtml));
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
  /<h1>University Finder<\/h1>/.test(englishHtml(read('index.html'))) && !/h1\s*::after/.test(css));
// A02: dropdown panels and the masthead stat pushed a 320 px page to 354 px.
// Stage 5: below 600 the panels are accordions in the sheet; in the bar every
// panel is clamped to the viewport and the last one opens leftward.
check('dropdown panels stay inside the viewport: every panel clamped, the last right-aligned, sheet panels static and full width (A02)',
  /max-width:calc\(100vw - 2 \* var\(--gut\)\)/.test(ruleAt(cssText, '.dropdown-panel'))
    && /left:auto;right:0/.test(ruleAt(cssText, '.dropdown-panel.right'))
    && read('js/round2.js').includes('box.left + panel.offsetWidth > document.documentElement.clientWidth - 12')
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
// Read per selector and media query: the same calc() text is also in the #faq
// and .cmp rules, so a plain search of the stylesheet passed with #results
// itself at scroll-margin-top:0. Each width's #results rule must say its offset,
// and no other rule may set one on #results or anything inside it.
const RESULTS_OFFSETS = {
  '(min-width: 600px)': 'calc(var(--header-visible) + var(--columns-height) + 8px)',
  '(max-width: 599.98px)': 'calc(var(--count-height) + 8px)',
};
const offsetsOk = (source) => {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const tops = (body) => [...body.matchAll(/scroll-margin-top\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
  const sets = cssTree(text).filter((r) => /(?:^|,)\s*#results(?![\w-])/.test(r.selector) && tops(r.body).length);
  return Object.entries(RESULTS_OFFSETS).every(([query, value]) => tops(ruleAt(text, '#results', query)).join('|') === value)
    && sets.every((r) => r.selector === '#results,#results :is(li,a,button)' && r.media.length === 1
      && tops(r.body).join('|') === RESULTS_OFFSETS[r.media[0].replace(/^@media /, '')]);
};
const phoneOffsets = ' #results,#results :is(li,a,button){scroll-margin-top:calc(var(--count-height) + 8px)}';
check('A07 skip and arrow targets clear the measured header, headings or phone count plus 8px; zero, fixed-offset and descendant fixtures fail',
  offsetsOk(css) && css.includes(phoneOffsets)
    && !offsetsOk(css + '#results{scroll-margin-top:60px}') && !offsetsOk(css + '#results{scroll-margin-top:0}')
    && !offsetsOk(css.replace(phoneOffsets, ' #results,#results :is(li,a,button){scroll-margin-top:0}'))
    && !offsetsOk(css.replace('scroll-margin-top:calc(var(--header-visible) + var(--columns-height) + 8px)', 'scroll-margin-top:0'))
    && !offsetsOk(css + '@media (min-width: 600px){#results li{scroll-margin-top:0}}')
    && /scroll-margin-bottom:8px/.test(ruleAt(cssText, '#results>.item')));
// A05, A04: names a screen reader reads out.
check('a hidden "," and a real space separate the title from the degree',
  renderSrc.includes("el('span', 'visually-hidden', ',')"));
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

check('round 2 has a white 56px header, gated by both width and height; negative height fixture fails', (() => {
  const valid = (source) => {
    const rules = cssTree(source.replace(/\/\*[\s\S]*?\*\//g, ''));
    return source.includes('.page{max-width:none;--header-visible:0px;')
      && rules.some((r) => r.selector === '.hd' && r.body.includes('height:56px') && r.body.includes('background:var(--panel)'))
      && rules.filter((r) => r.selector === '.hd' && /position:sticky/.test(r.body)).every((r) => r.media.join() === '@media (min-width: 600px) and (min-height: 501px)');
  };
  return valid(css) && !valid(css + '@media (min-width: 600px){.hd{position:sticky}}')
    && !valid(css.replace('.page{max-width:none;--header-visible:0px;', '.page{max-width:1440px;--header-visible:0px;'));
})());
check('compact header keeps its full visible height and offsets; translated-header and short-offset fixtures fail', (() => {
  const fullHeight = (text) => !/body\.compact \.hd(?:-in)?\{transform:translateY/.test(text)
    && !/\.page\.compact\{--header-visible:44px/.test(text) && text.includes('.page{--header-visible:56px}');
  return fullHeight(css) && !fullHeight(css + 'body.compact .hd{transform:translateY(-12px)}')
    && !fullHeight(css + '.page.compact{--header-visible:44px}');
})());
check('round 2 sheet, help, popover origin, FAQ and toast exits match the approved motion', (() => {
  // The sheet's 320 ms became 240 ms up / 200 ms down (Leon, 2026-11-06), then
  // 150/140 reduced latency; 280/220 now preserves a visible settling tail.
  // 2026-11-09: the 280/220 ms and the curve are tokens shared with the FAQ.
  const valid = (text) => text.includes('max-height:85dvh') && text.includes('--t-sheet-in:280ms') && text.includes('--t-sheet-out:220ms')
    && text.includes('transition:transform var(--t-sheet-in) var(--ease-sheet)') && text.includes('transition:transform var(--t-sheet-out) var(--ease-sheet)')
    && text.includes('transition:opacity 180ms var(--ease-out),transform 180ms')
    && text.includes('.dropdown>.dropdown-panel.right{transform-origin:top right}')
    && text.includes('.tip{display:none;') && text.includes('display 180ms allow-discrete')
    && text.includes('.faq-v{transform-box:fill-box;transform-origin:center;transition:transform 240ms var(--ease-out)}') && text.includes('animation:toast-out 160ms')
    && text.includes('@keyframes toast-out{to{opacity:0;transform:translateY(6px)}}');
  return valid(css) && !valid(css.replaceAll('max-height:85dvh', 'max-height:90dvh'))
    && !valid(css.replace('animation:toast-out 160ms', 'animation:none'))
    && !valid(css.replaceAll('.tip{display:none;', '.tip{display:block;'));
})());
check('header and onboarding controls inherit Plex and tabular figures; UA font fixture fails', (() => {
  const valid = (source) => source.includes(':where(.hd,.ob) :where(button,input,select){font-family:inherit;font-variant-numeric:tabular-nums}');
  return valid(css) && !valid(css.replace('font-family:inherit;font-variant-numeric:tabular-nums', 'font-family:Arial'));
})());
// The FAQ itself left the footer for its panel on 2026-11-09 (Leon); the
// footer keeps a button to it (checked under "FAQ panel" below).
check('round 2 moves search to the header and provenance/disclaimer to the footer',
  elementSource(indexHtml, /<header class="hd">/).includes('id="f-search"')
  && elementSource(indexHtml, /<footer class="foot">/).includes('id="source-line"')
  && !elementSource(indexHtml, /<main class="shell">/).includes(UI.en.r2_footer_p));

const { syncSlider } = await import('../js/round2.js');
check('custom budget sliders distinguish unset from explicit zero, cap only the visual thumb, and retain typed amounts', (() => {
  const classes = new Set(), props = {};
  const slider = { min: '0', max: '20000', dataset: { number: 'f-tuition' }, style: { setProperty(k, v) { props[k] = v; } }, classList: { toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } },
    setAttribute() {}, set value(v) { this.n = Math.min(20000, Math.max(0, Number(v))); }, get value() { return this.n; } };
  syncSlider(slider, null); if (classes.has('set') || slider.value !== 20000 || props['--p'] !== '100%') return false;
  syncSlider(slider, 0); if (!classes.has('set') || slider.value !== 0 || props['--p'] !== '0%') return false;
  syncSlider(slider, 50000); return slider.value === 20000 && props['--p'] === '100%';
})());
// An unset slider read its bare thumb position ("20000", "40000", "0").
check('budget sliders say their value with € and its period, "No limit" / "Not set" when unset, and a typed amount past the end as typed, in EN and SK (regression)', (() => {
  const make = (number, max) => ({ min: '0', max: String(max), dataset: { number }, style: { setProperty() {} }, classList: { toggle() {} }, attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, set value(v) { this.n = Math.min(max, Math.max(0, Number(v))); }, get value() { return this.n; } });
  const said = (slider, value) => { syncSlider(slider, value); return slider.attrs['aria-valuetext']; };
  const fee = make('f-tuition', 20000), budget = make('f-budget', 40000), living = make('f-living', 2000);
  const en = [said(fee, null), said(budget, ''), said(living, null), said(fee, 12000), said(budget, 50000), said(living, 800), said(fee, 0), said(living, 0)];
  i18n.initLanguage('', { getItem: () => 'sk' });
  const sk = [said(fee, null), said(living, null), said(fee, 12000), said(living, 800)];
  i18n.initLanguage('', { getItem: () => 'en' });
  return JSON.stringify(en) === JSON.stringify(['No limit', 'No limit', 'Not set', '12,000 € a year', '50,000 € a year', '800 € a month', '0 € a year', '0 € a month'])
    && JSON.stringify(sk.map((s) => s.replace(/\s/g, ' '))) === JSON.stringify(['Bez limitu', 'Nenastavené', '12 000 € ročne', '800 € mesačne']);
})());
check('S08 has specifically named help buttons and persistent described help; scalar facets keep active styling without a fld wrapper',
  indexHtml.includes('aria-label="About HL Maths 4+"') && indexHtml.includes('aria-label="About My IB points"')
  && indexHtml.includes('aria-describedby="f-maths-help"') && indexHtml.includes('aria-controls="f-maths-help"')
  && appSrc.includes("input.closest('.fld') || input.closest('.dropdown')"));

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
// The empty data: icon was replaced by the real logo (2026-11-07); declaring a real file still stops the 404.
check('index.html declares an icon that exists, so no favicon request 404s',
  /<link rel="icon" href="icons\/icon.svg" type="image\/svg\+xml">/.test(indexHtml) && existsSync(new URL('../icons/icon.svg', import.meta.url)));
check('the unused fromCutoff converter is gone', !read('tools/lib/ireland.mjs').includes('fromCutoff'));


// The logo (Leon, 2026-11-07): bookmark IB. Lilac tile with a violet bookmark in the page;
// the tab icon switches to the solid plum version in dark mode; phones get the plum PNG.
section('Logo');
{
  const tiles = indexHtml.match(/<span class="mono"[^]*?<\/span>/g) || [];
  check('both logo tiles draw the bookmark mark, not the old IB text', tiles.length === 2 && tiles.every((t) => t.includes('<use href="#i-logo"/>') && !/>IB</.test(t)));
  check('the logo symbol takes its colours from brand tokens, which are defined', /<symbol id="i-logo"[^]*?var\(--brand-accent\)[^]*?var\(--brand-ink\)[^]*?<\/symbol>/.test(indexHtml) && /--brand-accent:#[0-9a-f]{6}/.test(css));
  check('the old monogram string is gone from both languages', !('r2_monogram' in UI.en) && !('r2_monogram' in UI.sk));
  const icon = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
  check('the tab icon switches to the plum tile in dark mode', /@media \(prefers-color-scheme:dark\)\{\.t\{fill:#47345d\}/.test(icon) && /\.t\{fill:#ebe4f3\}/.test(icon));
  const png = readFileSync(new URL('../icons/apple-touch-icon.png', import.meta.url));
  check('the home-screen icon is a 180 px PNG and index.html links it',
    png.readUInt32BE(16) === 180 && png.readUInt32BE(20) === 180 && /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/.test(indexHtml));
}

// PR 1 review: a selector list mixing ::-webkit-slider-thumb and ::-moz-range-thumb
// is dropped whole by each engine, so the set thumb never got its accent border in Chrome.
check('no rule mixes WebKit and Mozilla range-thumb pseudo-elements in one selector list',
  ![...cssText.matchAll(/([^{}]+)\{/g)].some(([, sel]) => /::-webkit-slider-thumb/.test(sel) && /::-moz-range-thumb/.test(sel)));

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
// "Today" is the newest last_verified in the real data, so a data batch dated after a
// hard-coded day can never read as "in the future" here (the 2026-11-12 batch did).
const lintDataDay = ['universities', 'programmes'].flatMap((kind) => {
  const [head, ...rows] = parseCsv(read(`data/${kind}.csv`));
  return rows.map((r) => r[head.indexOf('last_verified')]);
}).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
const cliGood = runLint(['--no-git', '--today', lintDataDay]);
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
// Every word of the closed vocabulary is used by some programme (Unclassified would be the extra facet).
equal('the current dataset uses every subject in the vocabulary', liveSubjects.filter((s) => s !== UNCLASSIFIED).length, SUBJECT_AREAS.length);
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
// The share guards against a whole column going blank. It was 29 on the fork and
// 144 of 159 after the upstream merge; 266 of 283 after the 2026-11-12 batch. Most
// universities have one, so the guard is a share of the universities, not a count.
check('every programme carries its university\'s baseline (most universities have one)',
  lostBaseline.length === 0 && [...baselineOf.values()].filter(Boolean).length >= 0.8 * baselineOf.size,
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
const isIrish = (p) => p.country === 'Ireland';
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
// 2026-11-12: MTU's MT823/MT936 (offers on the portfolio/test result) and
// MT811 (portfolio, scoring not stated) added for the proposed MTU rows, so a
// low "#240" portfolio score never shows as "IB 24".
equal('D27 TEST_IN_CUTOFF holds the five confirmed codes',
  [...(pts.TEST_IN_CUTOFF ?? [])].sort(), ['CK112', 'DC014', 'GY261', 'MT823', 'MT936']);
equal('D27 TEST_UNVERIFIED holds CK114, the seven UL codes and MT811',
  [...(pts.TEST_UNVERIFIED ?? [])].sort(), ['CK114', 'LM076', 'LM099', 'LM131', 'LM132', 'LM133', 'LM134', 'LM135', 'MT811']);
equal('D27 MTU portfolio cutoffs get no IB figure (MT823 #240 would otherwise read as 24)',
  [pts.ibForCutoff(240, { test: true, code: 'MT823' }).ib, pts.ibForCutoff(372, { test: true, code: 'MT936' }).ib,
    pts.ibForCutoff(400, { test: true, code: 'MT811' }).ib], [null, null, null]);
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
  [{ verdict: 'No IB figure', reason: 'cutoff includes a test score', cell: 'Test in cutoff' },
    { verdict: 'No IB figure', reason: 'assessment required, IB equivalent unverified', cell: 'No IB figure' }]);
const d27Filters = await import(new URL('../js/filters.js', import.meta.url));
equal('D27 My points never hides them (unknown bucket)',
  ['ie-added', 'ie-unver'].map((id) => d27Filters.pointsBucket(d27Of(id), { myIbPoints: 24, hlMaths: false })), ['unknown', 'unknown']);
const d27Live = live.filter((p) => p.pointsTestUnverified || (p.pointsPlusTest && !(cutoffOf(p) > 625)))
  .map((p) => [p.id, p.pointsPlusTest ? 'added' : 'unverified']).sort();
// The three MTU rows (MT823 Visual Communications, MT936 Music, MT811 Animation) come with the
// 2026-11-12 batch, so they are expected only once they are in the data.
const d27Mtu = [['mtu-animation-visual-storytelling', 'unverified'], ['mtu-music', 'added'], ['mtu-visual-communications', 'added']]
  .filter(([id]) => live.some((p) => p.id === id));
equal('D27 real data: exactly the 11 chosen rows (plus the MTU ones, once present) lose their figure', d27Live, [
  ['dcu-jazz-and-contemporary-music-performance', 'added'],
  ['galway-bachelor-of-business-studies-internat', 'added'],
  ...d27Mtu,
  ['ucc-theatre-and-performative-practices', 'added'],
  ['ucc-youth-and-community-work', 'unverified'],
  ['ul-architecture-barch', 'unverified'],
  ['ul-contemporary-dance-ba', 'unverified'],
  ['ul-irish-dance-ba', 'unverified'],
  ['ul-irish-music-ba', 'unverified'],
  ['ul-music-ba', 'unverified'],
  ['ul-product-design-and-technology-bsc', 'unverified'],
  ['ul-voice-ba', 'unverified'],
].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
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
// The count line printed "1512 can't be compared" while the Setup done screen
// said "1,512" / "1 512" (PR 1 leftovers). Same formatting, both languages.
{
  const many = Array.from({ length: 1512 }, () => ({ ibPointsMin: null }));
  const summaryIn = (lang) => { i18n.setLanguage(lang, { setItem() {} }); try { return filtersMod.pointsSummary(many, fstate(36)); } finally { i18n.setLanguage('en', { setItem() {} }); } };
  equal('pointsSummary groups thousands like the count line: 1,512 in English, 1 512 in Slovak',
    [summaryIn('en'), summaryIn('sk').replace(/\u00a0|\u202f/g, ' ')], ['0 within your IB points · 1,512 can’t be compared', '0 v rámci tvojich IB bodov · 1 512 sa nedá porovnať']);
}
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
  [true, 'points=36&maths=1&sort=deadline', false, false]);
check('the tick counts as a filter, so Clear all clears it',
  filtersMod.activeFilterCount(fstate(null, true)) === 1);
check('app.js restores, reads, clears and names the tick, and the count carries the split',
  appSrc.includes('dom.maths.checked = fromUrl.hlMaths') && appSrc.includes('state.hlMaths = dom.maths.checked')
    && appSrc.includes('dom.maths.checked = false') && englishSource(appSrc).includes("used.push('HL Maths 4+')")
    && appSrc.includes('pointsSummaryParts(rows, state)'));
// S08: help is available by click/keyboard, with a visible Irish bonus hint.
{
  const helpOk = (html, field, help, name) => html.includes(`aria-controls="${help}" aria-label="${name}"`)
    && new RegExp(`<input[^>]*id="${field}"[^>]*aria-describedby="[^\\"]*${help}`).test(html)
    && html.includes(`id="${help}"`) && !new RegExp(`id="${field}"[^>]*title=`).test(html);
  check('S08 HL help has a named disclosure, described text and visible +25 hint; missing trigger fails',
    helpOk(indexHtml, 'f-maths', 'f-maths-help', 'About HL Maths 4+')
      && !helpOk(indexHtml.replace('aria-controls="f-maths-help"', ''), 'f-maths', 'f-maths-help', 'About HL Maths 4+')
      && elementSource(indexHtml, /<div class="fld f-hl chipbox">/).includes('+25 on Irish courses'));
  // Item c (PR 1 review): the bubble repeated the visible "+25" hint word for word. It must add
  // who gives the bonus (the CAO) and the grade, in both languages, and not just echo the hint.
  const mathsHelp = (lang) => { i18n.initLanguage('', { getItem: () => lang }); const help = i18n.t('r2_maths_help'), hint = i18n.t('r2_plus25'); i18n.initLanguage('', { getItem: () => 'en' }); return { help, hint }; };
  check('HL Maths help bubble adds the CAO and the grade instead of repeating the +25 hint (EN and SK)',
    ['en', 'sk'].every((lang) => { const { help, hint } = mathsHelp(lang); return help.includes('CAO') && help.includes('4') && help !== hint && !help.startsWith('+25'); })
      && read('index.html').includes('id="f-maths-help" data-i18n="r2_maths_help"') && !read('js/i18n.js').includes('"25_points_on_irish_courses"'));
  check('S08 points help uses a named disclosure and keeps its validation error; missing described text fails',
    helpOk(indexHtml, 'f-points', 'f-points-help', 'About My IB points')
      && !helpOk(indexHtml.replace('aria-describedby="f-points-help f-points-error"', ''), 'f-points', 'f-points-help', 'About My IB points')
      && indexHtml.includes('id="f-points-error" aria-live="polite"'));
}
check('shared uncertainty help (points, fees, deadlines) travels inside the extra filters; fee and deadline name it (S08)',
  elementSource(indexHtml, /<div class="more-filters"/).includes('<p class="help filter-help" id="f-unknown-help">Unknown values never hide a programme.</p>')
    && /<select(?=[^>]*id="f-deadline")(?=[^>]*aria-describedby="f-unknown-help")/.test(indexHtml));
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
  // The Czech explanation uses "no tuition fee" in a sentence, never as a fee label.
  const feeText = (node) => typeof node === 'string' ? node
    : node.classList.contains('dd-note') ? '' : node.children.map(feeText).join('');
  if (/Tuition \(EU\)/.test(a.textContent) || /no tuition fee/.test(feeText(a))) say('old fee wording');
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
      && byClass(h2, 'visually-hidden')[0]?.textContent === ',';
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
// ids and the list view's group headings. Batch 3 · A: and the compare set,
// for the compare toggle beside the star.
// app.js draws rows with appendRows since the windowing; renderRows is left
// for the test harness, so only its signature is pinned.
check('renderRows (test helper) keeps its signature: saved ids for the star, compare ids for its toggle, group headings',
  /export function renderRows\(container, rows, \{ state, shortlist = new Set\(\), compare = new Set\(\), wide = false, headings = new Map\(\) \}\)/.test(renderSrc)
    && /rows\.map\(\(row\) => renderRow\(row, state, wide, shortlist, headings, compare\)\)/.test(renderSrc));
// L09: the rows after the first screen are built by the same renderRow, in the
// list's applied mode.
check('appendRows keeps its call contract: same renderRow, items returned, applied mode',
  /export function appendRows\(container, rows, \{ state, shortlist = new Set\(\), compare = new Set\(\), wide = false, headings = new Map\(\) \}\) \{\n  const items = rows\.map\(\(row\) => renderRow\(row, state, wide, shortlist, headings, compare\)\);\n  container\.append\(\.\.\.items\);\n  return items;/.test(renderSrc)
    && appSrc.includes('appendRows(holder, [row], { state, shortlist, compare: new Set(compareIds), wide: appliedWide, headings: listHeadings })'));

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
// Phone Filters sheet (2026-11-06): in Chrome, <li> rows left at the default
// display:list-item that content-visibility has never drawn make every
// inherited style change rebuild the whole list. showModal() makes the page
// inert, which is such a change: the sheet froze ~500 ms (4x CPU) before it
// moved. Rows are display:block, and no rule may turn them back.
check('result rows are display:block with layout/style/paint containment, never list-item (sheet open/close stall)',
  /(?:^|;)\s*display:\s*block\s*(?:;|$)/.test(ruleBody('.item')) && /contain:\s*layout style paint/.test(ruleBody('.item'))
    && (() => {
      // Every rule whose selector ends on a result row (.item, li.item,
      // .item.is-open, .results>li, ...) may only set display to block.
      const rowSel = /(?:^|[\s>+~])(?:li)?(?:\.item|\.results\s*>\s*li)(?:[.:][\w-]+(?:\([^)]*\))?)*$/;
      const rowBodies = [...cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel]) => sel.split(',').some((x) => rowSel.test(x.trim()))).map(([, , body]) => body);
      const ok = (bodies) => bodies.every((b) => b.split(';').filter((d) => /^\s*display\s*:/.test(d)).every((d) => /^\s*display\s*:\s*block\s*$/.test(d)));
      return rowBodies.length >= 2 && ok(rowBodies) && !ok(['position:relative;display:list-item']) && rowSel.test('.results>.item.is-open') && rowSel.test('.results>li') && !rowSel.test('.item-x');
    })());
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
    { parts: [], after: null, unknown: { verdict: 'No IB figure', reason: 'cutoff includes a test score', cell: 'Test in cutoff' } },
    { parts: [], after: null, unknown: { verdict: 'No IB figure', reason: 'entrance exam', cell: 'Entrance exam' } },
    { parts: [], after: null, unknown: { verdict: 'No minimum published', reason: null, cell: 'Not published' } },
  ]);
// Verification of PR 1: rows whose admission says "Talent exam", "Online
// entrance exam" or "Entrance examination" (entrance_exam = yes) fell through
// to "Not published". The column decides; a row with no exam stays as it was.
const examWorded = (admission, entranceExam) => ptsShort({ ...fxRow('fx-nothing'), admission, entranceExam }).unknown.cell;
equal('pointsShort: any entrance-exam wording with entrance_exam=yes says Entrance exam, not Not published',
  [examWorded(['Talent exam'], 'yes'), examWorded(['Online entrance exam'], 'yes'), examWorded(['Entrance examination'], 'yes'),
    examWorded(['Portfolio'], 'no'), examWorded(['Portfolio'], null)],
  ['Entrance exam', 'Entrance exam', 'Entrance exam', 'Not published', 'Not published']);
check('live rows with entrance_exam=yes and no IB figure never say Not published',
  live.filter((row) => row.ibPointsMin === null && row.entranceExam === 'yes').every((row) => ptsShort(row).unknown.cell !== 'Not published'));
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
  ['v-fit', 'Within your IB points, then HPAT', '35', null, null],
  ['v-cond', 'Only with HL Maths 4+', '≈39 R1 · ≈38 R2', 'Round 2 cutoff only', null],
  ['v-fit', 'Within your IB points', '≈38 R1', null, null],
  ['v-unk', 'Cutoff may include test marks', '≈41 R1', null, null],
  ['v-unk', 'Entrance exam', null, null, null],
  ['v-unk', 'Not published', null, null, null],
  ['v-none', null, '≈44 R1', null, 'with HL Maths 4+'],
  ['v-cond', 'Only with HL Maths 4+', '≈44 R1', null, null],
  ['v-fit', 'Within your IB points', '≈44 R1', null, null],
]);
// Review of PR 1: every row with no figure said "Not published", even when
// the reason is known (a test in the CAO cutoff, D27, or a Czech entrance
// exam). The FAQ defines "Not published" as "the university does not publish
// a figure", so those rows now say what they are, in both languages.
const reasonRows = [['test', fxRow('fx-test-score')], ['unverified', d27Of('ie-unver')], ['exam', fxRow('fx-entrance')], ['none', bkRow('blank')]];
const reasonCells = (lang) => {
  i18n.setLanguage(lang, { setItem() {} });
  try { return reasonRows.map(([why, row]) => [why, ...rowPoints(row, fstate(36)).slice(0, 2)]); } finally { i18n.setLanguage('en', { setItem() {} }); }
};
equal('row points with no figure name the known reason, EN and SK', [reasonCells('en'), reasonCells('sk')], [
  [['test', 'v-unk', 'Test in cutoff'], ['unverified', 'v-unk', 'No IB figure'], ['exam', 'v-unk', 'Entrance exam'], ['none', 'v-unk', 'Not published']],
  [['test', 'v-unk', 'Hranica s testom'], ['unverified', 'v-unk', 'Bez údaja v IB'], ['exam', 'v-unk', 'Prijímacia skúška'], ['none', 'v-unk', 'Nezverejnené']],
]);
check('row points: no live row with a known reason says "Not published"', live.every((row) => {
  const short = ptsShort(row);
  return !short.unknown || !short.unknown.reason || rowPoints(row, fstate(36))[1] !== 'Not published';
}));
// The row cell is at most 108 px wide on a 320 px phone (css/styles.css) and
// its verdict does not wrap; "Bez údaja v IB bodoch" overflowed it.
check('row points reason labels stay as short as the longest existing one', ['en', 'sk'].every((lang) => {
  i18n.setLanguage(lang, { setItem() {} });
  try { return ['r2_pts_test_in_cutoff', 'r2_pts_no_ib_figure', 'entrance_exam'].every((k) => i18n.t(k).length <= 17); } finally { i18n.setLanguage('en', { setItem() {} }); }
}));
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
  }), [['', 'in 171 days', '1 Feb 2027', 0], ['v-time', 'in 34 days', new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-09-17T00:00:00Z')), 0], ['v-time', 'tomorrow', '15 Aug 2026', 0],
    ['v-time', 'today', '14 Aug 2026', 0], ['v-past', 'passed', '31 Mar 2026', 1], ['v-unk', null, 'Not published', 0]]);
// Review of PR 1: the row countdown read "in 0 days" on the day itself,
// "in 1 day" the day before, and Slovak "o 3 dní" (should be "o 3 dni").
// The row now uses countdown(), as the detail does. Each case re-works the
// days with applyToday, the way the app does at load and at midnight.
const rowCountdown = (lang, daysBefore) => {
  const row = { ...fxRow('fx-plain'), deadline: new Date('2026-11-30T00:00:00Z') };
  applyToday([row], new Date(2026, 10, 30 - daysBefore, 10));
  i18n.setLanguage(lang, { setItem() {} });
  try { return byClass(cellOf(rowOf(row), 'c-ddl'), 'verd')[0].textContent; } finally { i18n.setLanguage('en', { setItem() {} }); }
};
equal('row countdown: today, tomorrow, 2-4 and 5+ days, EN and SK',
  ['en', 'sk'].map((lang) => [0, 1, 2, 3, 4, 5, 21].map((n) => rowCountdown(lang, n))), [
    ['today', 'tomorrow', 'in 2 days', 'in 3 days', 'in 4 days', 'in 5 days', 'in 21 days'],
    ['dnes', 'zajtra', 'o 2 dni', 'o 3 dni', 'o 4 dni', 'o 5 dní', 'o 21 dní'],
  ]);
check('compact Irish fees keep the detail-only contribution note out of rows',
  !byClass(rowOf({ ...fxRow('fx-plain'), country: 'Ireland' }), 'c-fee')[0].textContent.includes('Student contribution'));
equal('row date: November and December use short names', [11, 12].map((m) => {
  const row = { ...fxRow('fx-plain'), deadline: new Date(`2026-${m}-01T00:00:00Z`) };
  applyToday([row], new Date(2026, 9, 1, 10));
  return byClass(rowOf(row), 'c-ddl')[0].textContent;
}), ['Deadline1 Nov 2026in 31 days', 'Deadline1 Dec 2026in 61 days']);
equal('row fee: known, zero, blank and ? keep distinct meanings',
  ['fx-plain', 'fx-zero', 'fx-fee-blank', 'fx-fee-q'].map((id) => byClass(rowOf(fxRow(id)), 'c-fee')[0].textContent),
  ['EU fee / year€2,500Living €1,100/mo', 'EU fee / year€0 · No tuition feeLiving €1,100/mo',
    'EU fee / yearNot publishedLiving cost not published', 'EU fee / yearNot publishedLiving €1,100/mo']);
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
  check('country badges: every data country is mapped, every mapped and the neutral pair has an enforced 4.5 contrast pair, and an unmapped country renders in words on the neutral tint',
    mapped.length >= 11 && mapped.every(([, , bg, fg]) => paired(fg, bg)) && paired('--cty-ink', '--cty-fill')
      && /background:var\(--cty-fill\);color:var\(--cty-ink\)/.test(ruleBody('.cc'))
      && badge('Portugal')?.textContent === 'Portugal' && badge('Portugal').getAttribute('data-country') === 'Portugal'
      && !mapped.some(([, c]) => c === 'Portugal') && badge('Denmark')?.getAttribute('data-country') === 'Denmark'
      && new Set(live.map((row) => row.country)).size >= 11 && [...new Set(live.map((row) => row.country))].every((c) => mapped.some(([, m]) => m === c)));
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
check('sort header keeps its four column sorts, hidden direction text and one default pressed button',
  headerButtons.length === 4 && headerButtons.map((m) => m[1]).sort().join() === ['deadline', 'name', 'points', 'tuition'].join()
    && headerButtons.filter((m) => /aria-pressed="true"/.test(m[0])).length === 1
    && headerButtons.every((m) => m[0].includes('class="visually-hidden"')));
check('sort sync runs before load, after options and from both sort controls',
  /applyUrlFields\(\);\s*syncSort\(\);/.test(appSrc) && /renderSortOptions\([^;]+;\s*syncSort\(\);/.test(appSrc)
    && /\[state.sort, state.dir\] = dom.sort.value.split\(':'\);\s*explicitSort = state.sort !== 'best';\s*preferencesDirty = true;\s*syncSort\(\);/.test(appSrc) && /state.sort = key;\s*}\s*syncSort\(\);/.test(appSrc));
check('row toggle retains slots and native button/list semantics with roving controls',
  appSrc.includes("button.removeAttribute('aria-controls')") && appSrc.includes('openIds.delete(id)') && appSrc.includes('openIds.has(id)) openRow(item, shownRows.get(id))')
    && /ArrowUp/.test(appSrc) && /ArrowDown/.test(appSrc) && /isComposing/.test(appSrc)
    && !/listbox/.test(appSrc));
check('six static skeleton rows, hidden trap guarded, no compass, no empty live region',
  (indexHtml.match(/class="sk-row"/g) ?? []).length === 6 && /id="loading" aria-hidden="true"/.test(indexHtml)
    && !/shimmer|@keyframes sk-/.test(css) && /\[hidden\] \{ display: none !important; \}/.test(css)
    && !indexHtml.includes('i-compass') && !/<div[^>]*(?:role|aria-live)=[^>]*id="empty-state"|id="empty-state"[^>]*(?:role|aria-live)=/.test(indexHtml));
check('empty h2, search tips and Clear all count are present',
  indexHtml.includes('<h2 id="empty-title">') && indexHtml.includes('Words can appear in any order')
    && indexHtml.includes('Short words match the start of a word') && appSrc.includes("t('clear_all', { value1: activeFilterCount(state) })") && UI.en.clear_all === 'Clear all ({value1})');
check('row wraps whole point parts without clipping requirements; containment only on items',
  /white-space:nowrap/.test(ruleBody('.pt')) && !/white-space:\s*nowrap/.test(ruleBody('.row .cell'))
    && !/line-clamp|max-height|overflow\s*:\s*hidden/.test(ruleBody('.line'))
    && !/content-visibility/.test(ruleBody('.detail') + ruleBody('.expand') + ruleBody('.results>.detail'))
    && /--row-estimate:180px/.test(ruleBody('.results')) && /border:0;border-radius:0/.test(ruleBody('.expand-inner>.detail')));
check('all CSS variable references are canonical or page variables, with shadow reserved for the pane',
  [...cssRules.replace(/:root\s*\{[^{}]*\}/g, '').matchAll(/var\((--[\w-]+)/g)].every(([, t]) =>
    new RegExp(`${t}\\s*:`).test(cssRules.match(/:root\s*\{([^{}]*)\}/)[1]) || ['--gut', '--ctl', '--fs-ctl', '--tap', '--p', '--fill', '--header-visible', '--columns-height', '--count-height', '--tray-h', '--logo-travel', '--logo-dock'].includes(t))
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
// Alignment fixes (2026-11-05): the detail footer is a second, named container,
// so the Save/Compare pair can stack when the detail is too narrow for both
// labels; its queries name it and nothing else may be a container.
const containerQueriesOk = (source) => (source.match(/@container[^{]*/g) ?? []).every((q) => q.trim() === '@container (min-width: 800px)' || /^@container dfoot \((?:max|min)-width: [\d.]+px\)$/.test(q.trim()))
  && (source.match(/container(?:-type)?\s*:/g) ?? []).length === 2 && /\.listp\{[^}]*container-type:inline-size/.test(source)
  && /\.d-foot\{container:dfoot \/ inline-size\}/.test(source);
check('CSS contains no copied mockup gallery, container or scrim rules; the only container queries are the list at 900 px and the detail footer',
  !/\.g-h3\b|\.app\s*\{\s*container\s*:|\.listp\s*\{\s*justify-self\s*:|\.spec\s+\.dd(?![\w-])|\.scrim(?![\w-])/.test(cssRules)
    && containerQueriesOk(cssRules) && !containerQueriesOk(cssRules + '@container (min-width: 1024px){.row{gap:0}}')
    && !containerQueriesOk(cssRules + '.app{container-type:inline-size}'));
check('chrome has exactly one base definition each, and stickiness follows A07',
  ['.hd', '.hd-in', '.fslot'].every((sel) => baseSelectors.filter((s) => s === sel).length === 1)
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
    // @supports too (2026-11-05): the sheet's height motion is a progressive enhancement.
    if (selector.startsWith('@media') || selector.startsWith('@starting-style') || selector.startsWith('@container') || selector.startsWith('@supports')) rules.push(...cssTree(body, [...media, selector]));
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
  return rules.every((r) => !(sticky(r) && ((header.test(r.selector) && !(r.selector === '.dropdown-panel .opt-q' && /position:sticky;top:0/.test(r.body)))
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
const desktopQuery = '(min-width: 1200px)', listQuery = '@container (min-width: 800px)';
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
const tracksOk = (rules) => sharedTracks(rules, [listQuery], 'minmax(0,1fr) 168px 148px 128px 16px')
  && /column-gap:12px;padding-inline:16px/.test(trackRules([listQuery]).find((r) => r.selector === '.cols,.row')?.body ?? '')
  && sharedTracks(rules, [`@media ${desktopQuery}`, listQuery], 'minmax(0,1fr) 168px 148px 128px');
check('headings and rows share one track template, gap and inset at the 900 px list query, with and without the chevron track; split rows fail',
  tracksOk(paneCss)
    && !tracksOk(cssTree(cssRules + '@container (min-width: 800px){.cols{column-gap:8px}}'))
    && !tracksOk(cssTree(cssRules + '@container (min-width: 800px){.row{padding-inline:12px}}'))
    && /grid-template-columns:minmax\(0,1fr\) var\(--pane-w\)/.test(paneRule('.split', desktopQuery))
    && /--pane-w:clamp\(300px,26vw,380px\)/.test(cssRules) && /display:none/.test(paneRule('.chev', desktopQuery))
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
    && (indexHtml.match(/<span class="dd-chev" aria-hidden="true">/g) ?? []).length === 9);
check('pane is hidden by default, sticky/scrollable only wide and borderless inside',
  /display:none/.test(paneRule('.pane')) && /position:sticky;top:12px;max-height:calc\(100vh - 24px\);overflow:auto/.test(paneRule('.pane', desktopQuery))
    && /border:0;border-radius:0/.test(paneRule('.pane .detail', desktopQuery))
    && /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(paneRule('.pane .d-cells', desktopQuery))
    && /grid-template-areas:"pts pts" "ddl fee"/.test(paneRule('.pane .d-cells', desktopQuery))
    && /grid-column:1\/-1/.test(paneRule('.pane .d-cells .c-pts', desktopQuery)));
check('selected tint and left accent follow hover, focus inset and goto colours are explicit',
  /background:var\(--accent-tint\);box-shadow:inset 3px 0 0 var\(--accent\)/.test(paneRule('.is-sel>.row', desktopQuery))
    && cssRules.lastIndexOf('.is-sel>.row') > cssRules.indexOf('.row:hover')
    && /outline-offset:-6px/.test(paneRule('.is-sel .open:focus-visible::after', desktopQuery))
    && /left:-9999px;color:var\(--accent\);text-decoration:underline/.test(paneRule('.goto', desktopQuery))
    && /left:auto;right:12px;bottom:8px;z-index:2/.test(paneRule('.goto:focus', desktopQuery))
    && !paneCss.some((r) => /is-sel|is-past/.test(r.selector) && /opacity/.test(r.body)));
// Stage 4 pushed the pane below the old sticky bar (236 px, 1024 x 600 and up).
// The bar no longer sticks, so that block and its offset went together.
check('no interim height-gated chrome: no (min-height: 600px) media and no 236 px offset; the pane is top 12 px at every height',
  !/@media[^{]*min-height:\s*600px/.test(cssRules) && !/236px/.test(cssRules) && !css.includes('interim until Stage 5')
    && /top:calc\(var\(--header-visible\) \+ 12px\);max-height:calc\(100dvh - var\(--header-visible\) - 24px\)/.test(paneRule('.pane', desktopQuery)));
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
    } else if (heading.hidden || title.length !== (expected === 'empty' ? 1 : 0) || pane.getAttribute('aria-labelledby') !== 'pane-h'
      || (expected === 'hidden' && (!body.textContent.includes(`${row.programme} does not match your filters`)
        || byTag(body, 'span')[0]?.lang !== 'cs'))
      || (expected === 'empty' && (title[0]?.textContent !== UI.en.r2_pane_heading || !body.textContent.includes(UI.en.r2_pane_pick) || !body.textContent.includes(UI.en.r2_legend) || byClass(body, 'legend').length !== 1))) return false;
  }
  return true;
}));
check('empty pane needs its target heading; a paragraph-only negative fixture fails', withStubDocument(() => {
  const body = new ChromeNode('div');
  renderPane({pane:new ChromeNode('aside'),heading:new ChromeNode('h2'),body}, null, false, noFilters());
  const valid = (node) => byTag(node, 'h2').some((h) => h.textContent === UI.en.r2_pane_heading);
  if (!valid(body)) return false;
  if (byClass(body, 'overview-actions').length) return false;
  byTag(body, 'h2')[0].remove(); return !valid(body);
}));
check('pane overview renders every active filter including numeric budgets without auto-selecting a programme', withStubDocument(() => {
  const pane = new ChromeNode('aside'), heading = new ChromeNode('h2'), body = new ChromeNode('div');
  const state = noFilters(); Object.assign(state, { myIbPoints: 36, maxBudget: 15000, maxTuition: 0, myLiving: 500 }); state.countries.add('Ireland');
  const mode = renderPane({ pane, heading, body }, null, false, state, { savedCount: 2 });
  return mode === 'empty' && body.textContent.includes('€15,000') && body.textContent.includes('Ireland')
    && body.textContent.includes('My list · 2 saved') && byClass(body, 'detail').length === 0;
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
function paneAppHarness(test, { boot = false, compare = null } = {}) {
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
    // Batch 3 · A: where the compare tray replaces the header button.
    const trayMedia = { matches: false, listeners: [], addEventListener(type, fn) { this.listeners.push(fn); } };
    const themeMedia = { matches: false, addEventListener() {}, removeEventListener() {} };
    const queries = { '(prefers-color-scheme: dark)': themeMedia, '(min-width: 1200px)': media, '(min-width: 600px)': media600, '(prefers-reduced-motion: reduce)': motionMedia, print: printMedia,
      '(max-width: 599.98px), (max-height: 500px)': trayMedia };
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
    const context = { ...savedState, readSaved() { return context.savedPrefs ?? null; }, readDismissed() { return true; }, writeSaved(value) { (context.prefWrites ??= []).push(value); }, setupOnboarding(config) { context.onboardingConfig = config; }, syncSegments() {}, onFaqSlide(fn) { context.faqSlide = fn; }, wireSheetDrag: sheetDragMod.wireSheetDrag, wireRound2() {}, syncRound2() {}, showToast(message, label, action, options) { context.toastAction = action; (context.toasts ??= []).push({ message, label, action, options }); }, wireCompactHeader() {}, wireLogoHandover() {}, ...i18n, URLSearchParams, initLanguage: () => i18n.initLanguage('', { getItem: () => 'en' }), document: stubDocument, matchMedia: (q) => { if (!queries[q]) throw new Error(`unexpected media query ${q}`); return queries[q]; },
      requestAnimationFrame: (fn) => { const id = nextFrame++; frames.set(id, fn); return id; }, cancelAnimationFrame: (id) => { frames.delete(id); },
      window: { scrollX: 0, scrollY: 0, scrollTo(x, y) { this.scrollX = x; this.scrollY = y; }, addEventListener(type, fn) { (windowListeners[type] ??= []).push(fn); } },
      location: { search: '', pathname: '/', hash: '', href: 'http://localhost:8765/?country=Ireland' },
      history: { replaceState() {} }, Date, console, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, performance: perf,
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
      IntersectionObserver, navigator: { clipboard },
      ...shortlistMod, ...compareMod, ...compareSetMod,
      // The real compare-set functions on context.compareStorage, a stand-in
      // localStorage a test can block, fill or change as a second tab would.
      readStoredCompare: () => compareSetMod.readStoredCompare(context.compareStorage),
      saveCompare: (ids) => compareSetMod.saveCompare(ids, context.compareStorage),
      loadCompare: () => compareSetMod.loadCompare(context.compareStorage),
      saveShortlist: (set) => {
        context.savedLists = [...(context.savedLists ?? []), [...set]];
        const works = context.saveWorks ?? true;
        if (works && context.stored) context.stored = [...set];
        return works;
      },
      // context.stored is localStorage's list, shared with a pretend second tab;
      // left unset, storage cannot be read (private browsing).
      readStoredShortlist: () => (context.stored ? [...context.stored] : null),
      toCsv: (rows) => rows.map((r) => r.id).join(','), downloadCsv: (name, csv) => { context.exportedCsv = csv; },
      getComputedStyle: (n) => { styleReads.push({ node: n, state: n.getAttribute?.('data-state') ?? null }); return n.computed ?? { scrollMarginTop: '0px', scrollMarginBottom: '0px', getPropertyValue() { return '180px'; } }; },
      ...filtersMod, applyToday: applyTodayEarly, loadShortlist: () => new Set(), loadData: () => new Promise((resolve) => { context.resolveData = resolve; }),
      renderRows, appendRows, renderSlot, renderPane, renderCount, renderCountShort, renderChips, renderAppliedChips, renderSortOptions, setSaved, setInCompare, renderCompare, renderSourceLine() {},
      renderSourceBanner() {}, renderIssues() {} };
    context.compareStorage = fakeStorage(compare ? { [compareSetMod.COMPARE_KEY]: JSON.stringify(compare) } : {});
    const code = appSrc.replace(/^import[\s\S]*?from ['"][^'"]+['"];\n/gm, '');
    runInNewContext(read('js/theme.js').replace(/^export /gm, '') + '\n' + code, context);
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
      motionMedia, printMedia, trayMedia, frames, flushFrame, fireWindow, styleReads });
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
appCheck('actual arrows prevent ends without selecting them; narrow moves focus only and modified/composing keys stay native', ({ run, flip, get, click, context, ids }) => {
  const key = (button, key, extra = {}) => {
    const e = { target: button, key, preventDefault() { this.defaultPrevented = true; }, ...extra };
    context.keyEvent = e; run('rowKeydown(keyEvent);'); return !!e.defaultPrevented;
  };
  const first = get('results').children[0].querySelector('button.open'); first.focus();
  if (!key(first, 'ArrowDown') || run('selectedId') !== null || run('openIds.size') !== 0) return false;
  first.focus(); flip(true); click(ids[1]);
  if (!key(first, 'ArrowUp') || run('selectedId') !== ids[1] || stubDocument.activeElement !== first) return false;
  for (const prop of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing']) if (key(first, 'ArrowDown', { [prop]: true })) return false;
  if (!key(first, 'ArrowDown')) return false;
  const second = get('results').children[1].querySelector('button.open');
  if (stubDocument.activeElement !== second || run('selectedId') !== second.closest('li.item').dataset.id) return false;
  const last = get('results').children.at(-1).querySelector('button.open'); last.focus();
  return key(last, 'ArrowDown') && stubDocument.activeElement === last && run('selectedId') === second.closest('li.item').dataset.id;
});
appCheck('row keyboard: one Tab stop follows title/Compare/Save focus and survives rebuild/crossing', ({ run, get, item, flip, context }) => {
  const first = get('results').querySelector('li.item'), id = first.dataset.id;
  const controls = () => item(id).querySelectorAll('button.open, button.cmpi, button.star');
  const one = (at) => controls().every((b, i) => b.tabIndex === (i === at ? 0 : -1));
  if (!one(0)) return false;
  // The focus stub does not dispatch focusin; deliver that browser event.
  controls()[0].focus(); run('rememberFocus();');
  for (const index of [1, 2]) {
    context.keyEvent = { target: stubDocument.activeElement, key: 'ArrowRight', preventDefault() {} };
    run('rowKeydown(keyEvent); rememberFocus();');
    if (stubDocument.activeElement !== controls()[index] || !one(index)) return false;
    run('update(); rememberFocus();'); flip(true); run('rememberFocus();'); flip(false); run('rememberFocus();');
    if (stubDocument.activeElement !== controls()[index] || !one(index)) return false;
  }
  context.keyEvent = { target: stubDocument.activeElement, key: 'ArrowLeft', preventDefault() {} };
  run('rowKeydown(keyEvent); rememberFocus();');
  return stubDocument.activeElement === controls()[1] && one(1);
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
  moreSrc.length > 0 && ['id="f-tuition"', 'id="dd-subjects"', 'id="dd-countries"', 'id="dd-languages"', 'id="f-deadline"', 'id="dd-degrees"', 'id="dd-cities"'].every((s) => moreSrc.includes(s))
    && !formSrc.includes('id="f-sort"') && /<div class="fld f-sort">[\s\S]*?<select class="inp" id="f-sort" hidden[^>]*><\/select>\s*<details class="dropdown sort-dd" id="dd-sort">[\s\S]*?<\/details>\s*<\/div>\s*<div class="cols"/.test(listpSrc)
    && formSrc.includes(moreSrc) && elementSource(indexHtml, /<div class="fslot">/).includes(formSrc)
    && ['id="f-points"', 'id="f-maths"'].every((s) => moreSrc.includes(s)) && statusSrc.includes('id="f-more"'));
check('.status holds the live count, its aria-hidden twin and Copy link after a 1 px sentinel; Sort has left it; the footer holds Show N',
  /<p class="count cfull" id="result-count" aria-live="polite"><\/p>/.test(statusSrc) && /<p class="count cshort" aria-hidden="true"><\/p>/.test(statusSrc)
    && statusSrc.includes('id="f-copy"') && !statusSrc.includes('f-sort') && /<div class="stuck-mark" aria-hidden="true"><\/div>\s*<div class="status">/.test(indexHtml)
    && elementSource(indexHtml, /<div class="sheet-f">/).includes('id="sheet-show"') && !indexHtml.includes('sort-field'));
check('the sheet is a labelled native dialog with a focusable heading and Done, controlled by Filters',
  /<dialog class="sheet" id="filter-sheet" aria-labelledby="sheet-h" aria-modal="true">/.test(indexHtml) && /<h2 id="sheet-h" tabindex="-1">Filters<\/h2>/.test(sheetSrc)
    && /id="sheet-done"[^>]*aria-label="Close filters"[^>]*><svg/.test(sheetSrc) && /<div class="sheet-scrim" id="sheet-scrim" aria-hidden="true"><\/div>/.test(indexHtml)
    && /<button type="button" class="btn more" id="f-more" aria-haspopup="dialog" aria-expanded="false" aria-controls="filter-sheet">/.test(statusSrc));
// Modal/inert and aria-hidden on the large results ancestor both stall WebKit.
// The old tests pinned browser-owned backdrop/focus; the sheet now owns them.
check('the sheet uses show(), never showModal/inert or background aria-hidden; its own scrim and sheet stack above header, tray and toasts',
  appSrc.includes('dom.sheet.show();') && !/dom\.sheet\.showModal\(/.test(appSrc)
    && !/\.sheet(?:::backdrop|:modal)|html:has\(\.sheet\[open\]\)/.test(css)
    && /z-index:70/.test(paneRule('.sheet')) && /z-index:69/.test(paneRule('.sheet-scrim'))
    && !/setAttribute\('aria-hidden'|\.inert\s*=/.test(appSrc.slice(appSrc.indexOf('function wireSheet()'), appSrc.indexOf('function wireStuck()'))));
check('every button in the filter form and the sheet is type="button" (no implicit submit)', [formSrc, sheetSrc].every((src) => {
  const buttons = src.match(/<button\b[^>]*>/g) ?? [];
  return buttons.length > 0 && buttons.every((b) => /type="button"/.test(b));
}));
check('the sprite has the Phosphor funnel and a flag for each data country, filled only from the canonical flag tokens',
  /<symbol id="i-filter" viewBox="0 0 256 256">/.test(indexHtml) && (() => {
    // The flags the app maps (COUNTRY_FLAGS in js/app.js), plus one for every country in the data.
    const mappedFlags = Object.fromEntries([...appSrc.match(/const COUNTRY_FLAGS = \{([\s\S]*?)\};/)[1].matchAll(/(?:'([^']+)'|(\w+)): '(f-\w+)'/g)].map((m) => [m[1] ?? m[2], m[3]]));
    return [...new Set(live.map((row) => row.country))].every((c) => mappedFlags[c])
      && Object.values(mappedFlags).every((id) => {
        const symbol = indexHtml.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`))?.[0] ?? '';
        return /fill:var\(--flag-/.test(symbol) && !/#[0-9a-f]{3,8}\b/i.test(symbol);
      });
  })());
// Stage 5 slipped the funnel and flags in between the globe's licence line and
// the globe, so the MIT credit sat on the wrong icon.
check('the globe and funnel licence lines sit directly on their own symbols',
  /<!-- Phosphor Regular globe,[^>]*-->\s*<symbol id="i-globe"/.test(indexHtml)
    && /<!-- Phosphor Regular funnel,[^>]*-->\s*<symbol id="i-filter"/.test(indexHtml));
check('app and CSS share the 600 px query', appSrc.includes("matchMedia('(min-width: 600px)')") && paneCss.some((r) => atMedia(r, '(min-width: 600px)')));
check('the closed sheet never renders: no screen display on bare .sheet, flex only when open, print may hide it; the page behind does not scroll',
  paneCss.filter((r) => r.selector.split(',').map((s) => s.trim()).includes('.sheet') && /display\s*:/.test(r.body)).every((r) => atMedia(r, 'print') && /display:none/.test(r.body))
    && /display:flex/.test(paneRule('.sheet[open]')) && /overflow:hidden/.test(paneRule('html.sheet-open'))
    && /background:var\(--scrim\)/.test(paneRule('.sheet-scrim')) && /min-height:0;overflow:auto/.test(paneRule('.sheet-b'))
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
    && /width:20px;height:14px;border-radius:2px;outline:1px solid var\(--hairline\)/.test(paneRule('.dropdown svg.flag')));
check('compact count twin keeps the readable count without cryptic verdict numbers, rewritten only on change',
  typeof renderCountShort === 'function' && withStubDocument(() => {
    const n = new ChromeNode('p');
    n.setAttribute('aria-hidden', 'true');
    const parts = [{ kind: 'fit', text: '410 within your IB points' }, { kind: 'cond', text: '41 only with HL Maths 4+' }, { kind: 'unk', text: '679 can’t be compared' }];
    const first = renderCountShort(n, '1130 of 1240 programmes', parts), kids = [...n.children];
    const same = renderCountShort(n, '1130 of 1240 programmes', parts);
    return first === true && same === false && kids.every((c, i) => c === n.children[i])
      && n.textContent === '1130 of 1240 programmes' && !byClass(n, 'k').length
      && renderCountShort(n, '1240 programmes', []) === true && n.textContent === '1240 programmes' && n.childElementCount === 0
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
    }) && !byTag(plain, 'svg').length && appSrc.includes("{ flags: COUNTRY_FLAGS, forceSearch: true, counts: counts('country') }")
      && Object.entries(flags).every(([c, f]) => appSrc.includes(`${c}: '${f}'`));
  }));

// Real handlers on the real markup. Each would pass with a wrong target only
// if the app code were wrong in the same way, so every outcome is asserted.
const kids = (n) => n.children.filter((c) => typeof c !== 'string');
appCheck('actual 600 crossings move .more-filters, Clear all, Copy link and My list as single nodes, round trip and keep values, ticks and open lists', ({ run, get, tree, flip600 }) => {
  run('facets = buildFacets(allRows); drawChips();');
  // Batch 2 B1 moves the copy help and live status alongside the unchanged controls.
  const help = get('f-copy-help'), feedback = get('f-copy-status');
  const more = tree.querySelector('.more-filters'), clear = get('f-clear'), copy = get('f-copy'), show = get('sheet-show');
  const sheetB = tree.querySelector('.sheet-b'), sheetF = tree.querySelector('.sheet-f'), form = get('filter-form'), status = tree.querySelector('.status');
  // Since 2026-11-06 My list sits before Filters in the phone count row and
  // before Compare in the header from 600 px (CH4), so a crossing moves 6 nodes.
  const list = get('header-list'), compare = get('header-compare'), filtersButton = get('f-more');
  const narrowOk = () => more.parent === sheetB && kids(sheetB).join() === [more, copy, help, feedback].join() && kids(sheetB)[1] === copy
    && clear.parent === sheetF && clear.nextElementSibling === show && list.parent === status && list.nextElementSibling === filtersButton;
  const wideOk = () => more.parent === form && kids(form).at(-1) === more && clear.parent === status && kids(status).slice(-3).join() === [copy, help, feedback].join()
    && list.nextElementSibling === compare && list.parent === compare.parent;
  if (!narrowOk()) return false;
  const box = get('dd-countries'), tick = get('f-countries').querySelectorAll('input').find((node) => node.type === 'checkbox');
  box.open = true; tick.checked = true; get('f-tuition').value = '3000'; get('f-sort').value = 'tuition:desc';
  let moves = 0; const hook = stubDocument.moved;
  stubDocument.moved = (n) => { if (n.isConnected) moves++; hook(n); };
  flip600(true);
  if (!wideOk() || moves !== 6) return false;
  flip600(true); run('placeFilters();');
  if (moves !== 6) return false;
  // A fresh placement (page load at 600 or wider) finds every node in place:
  // nothing moves, so a control focused before the script ran keeps focus.
  get('f-tuition').focus(); run('appliedBar = null; placeFilters();');
  if (moves !== 6 || stubDocument.activeElement !== get('f-tuition')) return false;
  for (let i = 0; i < 10; i++) { flip600(i % 2 === 0 ? false : true); if (!(i % 2 === 0 ? narrowOk() : wideOk())) return false; }
  return box.open && tick.checked && get('f-tuition').value === '3000' && get('f-sort').value === 'tuition:desc'
    && get('f-countries').querySelectorAll('input').find((node) => node.type === 'checkbox') === tick && tree.querySelectorAll('.more-filters').filter((n) => n.parent === form || n.parent === sheetB).length === 1
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
  flip600(false); fire(more, 'click'); focus(get('f-points')); flip600(true); flip600(false);
  return active() === more;
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
  if (!open()) return false; fire(heading, 'keydown', { key: 'Escape' }); if (!closed()) return false;
  if (!open()) return false; fire(get('sheet-scrim'), 'click'); if (!closed()) return false;
  if (!open()) return false;
  fire(sheet, 'click', { clientX: 200, clientY: 500 }); fire(heading, 'click', { clientX: 0, clientY: 0 });
  fire(get('f-tuition'), 'click', { clientX: 0, clientY: 0 }); advance(0);
  return sheet.open && more.getAttribute('aria-expanded') === 'true';
});
// iPhone (Leon, 2026-11-08): after a tap the Filters button showed a focus
// ring. iOS never focuses a tapped button, so the scripted heading focus
// matched :focus-visible and the close's focus return inherited it. The ring
// now follows the last input: none after a pointer, shown after a key.
appCheck('actual sheet: after a tap neither the heading nor Filters gets a focus ring; after a key both do', ({ get, fire, advance, docBody }) => {
  const sheet = get('filter-sheet'), more = get('f-more'), heading = get('sheet-h'), done = get('sheet-done');
  const ring = (node) => stubDocument.activeElement === node && stubDocument.focusOptions?.focusVisible;
  // As in a browser: show() focuses the heading itself (its first
  // focusable element) with the browser's own ring, and focusing a focused
  // element changes nothing.
  const show = sheet.show;
  sheet.show = function () { show.call(this); stubDocument.activeElement = heading; stubDocument.focusOptions = { focusVisible: true }; };
  heading.focus = function (options) { if (stubDocument.activeElement !== heading) ChromeNode.prototype.focus.call(this, options); };
  heading.blur = function () { if (stubDocument.activeElement === heading) stubDocument.activeElement = docBody; };
  stubDocument.activeElement = docBody;
  fire(more, 'pointerdown'); fire(more, 'click');
  if (!sheet.open || ring(heading) !== false) return false;
  fire(done, 'pointerdown'); fire(done, 'click'); advance(0);
  if (sheet.open || ring(more) !== false) return false;
  fire(more, 'keydown', { key: 'Enter' }); fire(more, 'click');
  if (!sheet.open || ring(heading) !== true) return false;
  fire(heading, 'keydown', { key: 'Escape' }); advance(0);
  return !sheet.open && ring(more) === true;
});
appCheck('actual sheet: widening closes it without a focus return; a queued close after a quick reopen neither steals focus nor clears aria-expanded', ({ get, fire, flip600, advance }) => {
  const sheet = get('filter-sheet'), more = get('f-more'), fee = get('f-tuition');
  fire(more, 'click'); fee.focus(); fire(fee, 'focusin'); flip600(true); advance(0);
  if (stubDocument.activeElement !== fee || more.getAttribute('aria-expanded') !== 'false') return false;
  flip600(false); fire(more, 'click'); flip600(true); flip600(false); fire(more, 'click');
  advance(0);
  return sheet.open && more.getAttribute('aria-expanded') === 'true' && stubDocument.activeElement === get('sheet-h');
});
appCheck('actual sheet: Tab and Shift+Tab wrap at both ends, skip disabled/hidden controls, and keep an empty sheet on its heading', ({ get, fire }) => {
  const sheet = get('filter-sheet'), heading = get('sheet-h'), first = get('sheet-done'), last = get('sheet-show');
  fire(get('f-more'), 'click');
  const tab = (node, shiftKey = false) => { node.focus(); return fire(node, 'keydown', { key: 'Tab', shiftKey }); };
  if (tab(heading) || stubDocument.activeElement !== first) return false;
  if (tab(last) || stubDocument.activeElement !== first) return false;
  if (tab(first, true) || stubDocument.activeElement !== last) return false;
  if (tab(heading, true) || stubDocument.activeElement !== last) return false;
  const hidden = new ChromeNode('button'); hidden.hidden = true; sheet.append(hidden);
  const disabled = new ChromeNode('button'); disabled.disabled = true; sheet.append(disabled);
  if (tab(last) || stubDocument.activeElement !== first) return false;
  if (!tab(first)) return false; // Interior stops retain native keyboard behavior.
  for (const node of sheet.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')) node.disabled = true;
  return !tab(heading) && stubDocument.activeElement === heading;
});
appCheck('actual sheet: background focus redirects inside; handled Escape stays open; close/widen/reopen keep scrim and scroll lock in sync', ({ get, fire, html, advance, flip600 }) => {
  const sheet = get('filter-sheet'), more = get('f-more'), scrim = get('sheet-scrim');
  const locked = () => html.classList.contains('sheet-open') && scrim.classList.contains('is-open');
  fire(more, 'click'); if (!locked()) return false;
  get('f-search').focus(); fire(get('f-search'), 'focusin');
  if (stubDocument.activeElement !== get('sheet-h')) return false;
  fire(get('sheet-h'), 'keydown', { key: 'Escape', defaultPrevented: true }); if (!sheet.open) return false;
  fire(get('sheet-h'), 'keydown', { key: 'Escape' });
  if (locked() || sheet.open || stubDocument.activeElement !== more) return false;
  fire(more, 'click'); advance(0); if (!sheet.open || !locked()) return false;
  flip600(true); advance(0); if (sheet.open || locked()) return false;
  flip600(false); fire(more, 'click'); sheet.close(); advance(0);
  return !locked() && stubDocument.activeElement === more;
});
// A flex column avoids WebKit re-laying out every previous block on append.
check('sheet warm stays hidden and untappable until opened',
  /\.sheet\.is-warm\{display:flex;flex-direction:column;visibility:hidden;pointer-events:none/.test(css)
    && /\.sheet\.is-warm\[open\]\{visibility:visible;pointer-events:auto/.test(css));
check('results use a flex column on screen and block flow in print',
  /\.results\{[^}]*display:flex;flex-direction:column/.test(css)
    && /@media print[\s\S]*\.results[^}]*display: ?block/.test(css));
appCheck('window updates pause during the sheet slide and resume on its transform end', ({ run, get, fire, flushFrame, advance }) => {
  run('allRows = live; update();');
  const count = get('results').children.length;
  fire(get('f-more'), 'pointerdown'); flushFrame(); advance(0);
  if (get('results').children.length !== count) return false;
  fire(get('f-more'), 'click'); advance(0);
  if (get('results').children.length !== count) return false;
  fire(get('filter-sheet'), 'transitionend', { propertyName: 'opacity' }); advance(0);
  if (get('results').children.length !== count) return false;
  fire(get('filter-sheet'), 'transitionend', { propertyName: 'transform' }); advance(0);
  flushFrame(); return get('results').querySelectorAll('li.item').length < 40;
});
appCheck('paused window updates recover on widening, reduced motion and a missing transition event; print flushes immediately', ({ run, get, fire, flushFrame, advance, flip600, motionMedia, fireWindow }) => {
  for (const action of ['wide', 'reduce', 'timeout', 'print']) {
    flip600(false); motionMedia.matches = false;
    run('closeSheet(); allRows = live; update();'); fire(get('f-more'), 'click');
    flushFrame(); advance(0);
    if (get('results').children.length === run('allRows.length')) return false;
    if (action === 'wide') flip600(true);
    if (action === 'reduce') { motionMedia.matches = true; for (const fn of motionMedia.listeners) fn(); }
    if (action === 'timeout') {
      advance(250);
      if (get('results').children.length === run('allRows.length')) return false;
      advance(250);
    }
    if (action === 'print') fireWindow('beforeprint');
    advance(0);
    if (action === 'print' ? get('results').children.length !== run('allRows.length') : run('sheetSlideTimer !== undefined')) return false;
    if (action === 'print') fireWindow('afterprint');
  }
  return true;
});
appCheck('both sheet slides pause rows and promote only until transform end; cancelled taps and reduced motion release promotion', ({ run, get, fire, advance, motionMedia }) => {
  const sheet = get('filter-sheet'), scrim = get('sheet-scrim');
  const promoted = () => sheet.classList.contains('is-sliding') && scrim.classList.contains('is-sliding');
  run('allRows = live; update();'); fire(get('f-more'), 'click');
  if (!promoted()) return false;
  fire(sheet, 'transitionend', { propertyName: 'transform' }); advance(0);
  if (promoted()) return false;
  run('allRows = live; update();');
  const count = get('results').children.length;
  fire(get('sheet-done'), 'click'); advance(0);
  if (!promoted() || get('results').children.length !== count) return false;
  fire(sheet, 'transitionend', { propertyName: 'opacity' }); advance(0);
  if (!promoted() || get('results').children.length !== count) return false;
  fire(sheet, 'transitionend', { propertyName: 'transform' }); advance(0);
  if (promoted() || get('results').children.length !== count) return false;
  fire(get('f-more'), 'pointerdown'); advance(499);
  if (!promoted()) return false;
  advance(1); if (promoted()) return false;
  motionMedia.matches = true; fire(get('f-more'), 'click'); fire(get('sheet-done'), 'click');
  return !promoted();
});
appCheck('sheet warm waits two frames after the visible window, runs once, and changes no focus, URL, preferences, scrim or dialog state', ({ run, context, get, flushFrame, advance }) => {
  run('sheetWarmScheduled = false; allRows = live; update();');
  const sheet = get('filter-sheet');
  context.warms = 0; run('const actualWarm = warmSheet; warmSheet = () => { warms++; actualWarm(); };');
  const before = stubDocument.activeElement;
  let writes = 0; context.history.replaceState = () => writes++; context.writeSaved = () => writes++;
  sheet.show = sheet.close = () => { throw Error('warming opened/closed the dialog'); };
  flushFrame(); if (context.warms) return false;
  advance(0); if (context.warms) return false;
  flushFrame(); run('scheduleSheetWarm();'); flushFrame(); flushFrame();
  return sheet.classList.contains('is-warm') && context.warms === 1 && !sheet.open && !writes && stubDocument.activeElement === before
    && !get('sheet-scrim').classList.contains('is-open');
});
appCheck('an early open or widening cancels the pending warm without affecting the sheet', ({ run, get, flushFrame, fire, flip600 }) => {
  run('scheduleSheetWarm();'); flushFrame(); fire(get('f-more'), 'click'); flushFrame();
  if (!get('filter-sheet').open || get('filter-sheet').classList.contains('is-warm')) return false;
  fire(get('sheet-done'), 'click'); flip600(true); run('warmSheet();');
  return !get('filter-sheet').classList.contains('is-warm') && !get('filter-sheet').open;
});
// Each arrow press in the Sort pick-list committed a sort and closed the
// list, sending focus back to its button after one step.
appCheck('actual Sort pick-list: arrow keys sort and keep it open with focus on the new radio; Enter, Space on the chosen one, and a click close it (regression)', ({ run, get, fire, context }) => {
  // A plain object is enough: dispatchStub copies the type.
  context.Event = function Event(type, init = {}) { return { type, ...init }; };
  const details = get('dd-sort'), box = get('sort-options'), summary = details.querySelector('summary');
  // The stand-in <select> has no .options; the real one lists its <option>s.
  Object.defineProperty(get('f-sort'), 'options', { get() { return this.children; } });
  run('sortPick();');
  const radios = () => box.querySelectorAll('input');
  const pick = (value, how) => {
    const radio = radios().find((node) => node.value === value);
    if (how === 'arrow') fire(box, 'keydown', { key: 'ArrowDown' }); else fire(box, 'pointerdown');
    radio.checked = true; fire(radio, 'change');
  };
  details.open = true;
  const [first, second, third] = radios().filter((node) => !node.disabled).map((node) => node.value);
  pick(second, 'arrow');
  if (!details.open || run('`${state.sort}:${state.dir}`') !== second || stubDocument.activeElement?.value !== second
    || stubDocument.activeElement === radios().find((node) => node.value === first)) return false;
  pick(third, 'arrow');
  if (!details.open || run('`${state.sort}:${state.dir}`') !== third || stubDocument.activeElement?.value !== third) return false;
  fire(box, 'keydown', { key: 'Enter' });
  if (details.open || stubDocument.activeElement !== summary) return false;
  details.open = true;
  const chosen = radios().find((node) => node.checked); chosen.focus();
  fire(chosen, 'keyup', { key: ' ' });
  if (details.open || stubDocument.activeElement !== summary) return false;
  details.open = true;
  pick(first, 'click');
  return !details.open && stubDocument.activeElement === summary && run('`${state.sort}:${state.dir}`') === first;
});
// Below 600 px Search is the filter form's only text field, so Enter there
// submitted it and reloaded the page to ?q=…, losing the language and a
// shared ?list= view. Smoke "PHN enter" presses the real key.
appCheck('actual phone Enter in Search: the filter form is never submitted, on phones or wider (regression)', ({ get, fire, flip600 }) => {
  flip600(false);
  const phone = fire(get('filter-form'), 'submit');
  flip600(true);
  return phone === false && fire(get('filter-form'), 'submit') === false;
});
appCheck('actual counts: Filters (n) counts sheet groups, Clear all (n) every filter, Show N the shown rows; points + HL Maths and fee 0 + two countries are each Filters (2)', ({ run, get, fire, advance, context }) => {
  run('facets = buildFacets(allRows); drawChips();');
  const more = get('f-more'), clear = get('f-clear'), show = get('sheet-show'), label = () => more.querySelector('span').textContent;
  const type = (id, value) => { get(id).value = value; fire(get(id), 'input'); advance(150); };
  if (label() !== 'Filters' || more.classList.contains('is-on') || clear.textContent !== 'Clear all' || !clear.disabled
    || show.textContent !== `Show ${context.fixture.length} programmes`) return false;
  type('f-points', '36'); get('f-maths').checked = true; fire(get('f-maths'), 'change');
  // Points and HL Maths live in the phone sheet, so they count there too; the
  // old rule left them out and showed "Filters" beside "Clear all (2)".
  if (label() !== 'Filters (2)' || !more.classList.contains('is-on') || clear.textContent !== 'Clear all (2)' || !get('f-points').closest('.fld').classList.contains('is-set')) return false;
  fire(clear, 'click'); type('f-tuition', '0');
  for (const tick of get('f-countries').querySelectorAll('input').filter((node) => node.type === 'checkbox').slice(0, 2)) { tick.checked = true; fire(tick, 'change'); }
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
  const tick = get('f-countries').querySelectorAll('input').find((node) => node.type === 'checkbox'); tick.checked = true; fire(tick, 'change');
  get('f-tuition').value = '3000'; fire(get('f-tuition'), 'input'); advance(150);
  clear.focus(); fire(clear, 'click');
  return stubDocument.activeElement === get('sheet-h') && clear.disabled && clear.textContent === 'Clear all'
    && run('activeFilterCount(state)') === 0 && !get('f-countries').querySelectorAll('input').find((node) => node.type === 'checkbox').checked && get('f-tuition').value === '';
});
appCheck('actual dropdowns: handled inner Escape leaves the sheet open; outside taps or Tab-out keep accordions open; bar panels keep A06', ({ get, fire, flip600 }) => {
  const subjects = get('dd-subjects'), countries = get('dd-countries');
  fire(get('f-more'), 'click'); subjects.open = true;
  const summary = subjects.querySelector('summary'); summary.focus();
  // round2.js handles the inner Escape in capture phase (real smoke below).
  fire(summary, 'keydown', { key: 'Escape', defaultPrevented: true });
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
// Copy feedback now describes the snapshot; changing the button label hid the
// result behind the phone modal and made the desktop action change width.
await asyncAppCheck("Copy link writes the state's address and a state-based toast; failure never says copied", async ({ get, fire, settle, clipboard, context, run }) => {
  context.location.origin = 'http://localhost:8765';
  context.toastMessages = [];
  context.showToast = (message) => context.toastMessages.push(message);
  const copy = get('f-copy'), label = copy.textContent;
  fire(copy, 'click'); await settle();
  if (clipboard.written.at(-1) !== 'http://localhost:8765/' || context.toastMessages.at(-1) !== t('r2_copied_none')) return false;
  run("state.countries.add('Ireland'); dom.points.value = '36';");
  fire(copy, 'click'); await settle();
  if (context.toastMessages.at(-1) !== t('r2_copied_filters_points')) return false;
  run("state.countries.clear(); dom.points.value = ''; state.sort = 'name';");
  fire(copy, 'click'); await settle();
  if (!clipboard.written.at(-1).includes('?sort=name') || context.toastMessages.at(-1) !== t('r2_copied_sort')) return false;
  get('f-search').value = 'biology'; fire(get('f-search'), 'input');
  fire(copy, 'click'); await settle();
  if (!clipboard.written.at(-1).includes('q=biology')) return false;
  context.location.hash = '#top-marker';
  clipboard.mode = 'reject'; fire(copy, 'click'); await settle();
  if (context.toastMessages.at(-1) !== t('r2_copy_failed_desktop')) return false;
  context.navigator.clipboard = undefined; fire(copy, 'click'); await settle();
  return context.toastMessages.at(-1) === t('r2_copy_failed_desktop') && copy.textContent === label
    && copy.querySelector('.copy-long').textContent === t('r2_copy_filters_link')
    && copy.getAttribute('aria-live') === null;
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
  '.btn': 'transition:transform 120ms ease-out,background-color 120ms ease-out',
  // A10 (PR 7): only the vertical stroke of the FAQ's "+" turns, onto the
  // horizontal one. The answers' height is a Web Animation in faq.js now:
  // the old height:auto transition ran only in Chrome.
  '.faq-v': 'transition:transform 240ms var(--ease-out)',
  '.segment-thumb': 'transition:transform 280ms var(--spring-snappy)',
  // Setup now owns the scrim, since show() has no native ::backdrop.
  'dialog.ob': 'transition:opacity 140ms var(--ease-out),transform 140ms var(--ease-out),display 140ms allow-discrete',
  'dialog.ob[open]': 'transition:opacity 180ms var(--ease-out),transform 180ms var(--ease-out),display 180ms allow-discrete',
  '.ob-scrim': 'transition:opacity 140ms var(--ease-out),display 140ms allow-discrete',
  '.ob-scrim.is-open': 'transition:opacity 180ms var(--ease-out),display 180ms allow-discrete',
  '.ob-bar i': 'transition:transform 360ms var(--ease-out)',
  '.ob .chip': 'transition:background 140ms,border-color 140ms,transform 120ms var(--ease-out)',
  '.dropdown>.dropdown-panel': 'transition:transform 250ms var(--ease-out),opacity 250ms var(--ease-out)',
  // Leon 2026-11-08: the bar's lists fade shut in Safari too (round2.js holds [open]).
  '.dropdown.closing>.dropdown-panel': 'transition:transform 150ms var(--ease-out),opacity 150ms var(--ease-out)',
  '.switch input::after': 'transition:transform 260ms var(--spring-snappy)',
  'input[type=range]::-webkit-slider-thumb': 'transition:transform 160ms var(--ease-out)',
  '.tip': 'transition:opacity 180ms var(--ease-out),transform 180ms var(--ease-out),visibility 180ms,display 180ms allow-discrete',
  // Phone help and sheet rows grow to height:auto where the browser can (M .tip timing; M .faq's optional 260 ms height).
  '.sheet-b .tip': 'transition:opacity 180ms var(--ease-out),transform 180ms var(--ease-out),height 180ms var(--ease-out),padding 180ms var(--ease-out),margin 180ms var(--ease-out),visibility 180ms,display 180ms allow-discrete',
  '.sheet-b .dropdown::details-content': 'transition:height 260ms var(--ease-out),content-visibility 260ms allow-discrete',
  '.sheet-b .dropdown[open]::details-content': 'transition:height 260ms var(--ease-out)',
  '.hd': 'transition:transform 240ms var(--ease-out)',
  '.hd-in': 'transition:transform 240ms var(--ease-out)',
  '.mark,.filters-btn': 'transition:opacity 160ms,transform 240ms var(--ease-out)',
  // Batch 3 C2: in the compact header only the wordmark fades; the tile stays.
  '.mark h1': 'transition:opacity 160ms,transform 240ms var(--ease-out)',
  '.row,.btn,.inp,.option,.dropdown>summary': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.cols button': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.item:not(.is-sel)>.row:hover': 'transition:background-color var(--t-fast) var(--ease-out)',
  '.expand': 'transition:grid-template-rows var(--t-slow) var(--ease-out),opacity var(--t-slow) var(--ease-out)',
  '.chev': 'transition:transform var(--t-med) var(--ease-in-out)',
  '.dd-chev': 'transition:transform var(--t-med) var(--ease-in-out)',
  '.pane-body>.fade-in': 'transition:opacity var(--t-fast) var(--ease-out)',
  // Leon 2026-11-06: 320 ms felt sluggish; 240 ms up ([open]), 200 ms down.
  // Smooth-slide follow-up: retain the first frame, give the movement a settling tail.
  // 2026-11-09: the times and curve became tokens shared with the FAQ panel.
  '.sheet': 'transition:transform var(--t-sheet-out) var(--ease-sheet),display var(--t-sheet-out) allow-discrete,visibility var(--t-sheet-out)',
  '.sheet[open]': 'transition:transform var(--t-sheet-in) var(--ease-sheet),display var(--t-sheet-in) allow-discrete',
  // Leon 2026-11-06: the phone Compare tray slides up instead of appearing at once.
  '.cmp-tray': 'transition:transform 280ms var(--ease-out),opacity 200ms var(--ease-out),display 280ms allow-discrete',
  '.sheet-scrim': 'transition:opacity var(--t-sheet-out) var(--ease-sheet),display var(--t-sheet-out) allow-discrete',
  '.sheet-scrim.is-open': 'transition:opacity var(--t-sheet-in) var(--ease-sheet),display var(--t-sheet-in) allow-discrete',
  // The FAQ panel behind the header's "?" (Leon, 2026-11-09) moves exactly as
  // the sheet does; visibility waits for the closing slide once it is warm.
  '.faqp': 'transition:transform var(--t-sheet-out) var(--ease-sheet),display var(--t-sheet-out) allow-discrete,visibility var(--t-sheet-out)',
  '.faqp[open]': 'transition:transform var(--t-sheet-in) var(--ease-sheet),display var(--t-sheet-in) allow-discrete',
  // A10: its scrim fades with visibility, not display, which Safari before
  // 18 cannot transition (it snapped in and out).
  '.faq-scrim': 'transition:opacity var(--t-sheet-out) var(--ease-sheet),visibility var(--t-sheet-out) linear',
  '.faq-scrim.is-open': 'transition:opacity var(--t-sheet-in) var(--ease-sheet),visibility var(--t-sheet-in) linear',
};
// The one exception to "reduced motion stops everything": the FAQ panel and
// its scrim fade in 120 ms instead of sliding (Leon, 2026-11-09), so the panel
// does not blink into place. No transform; only here.
const reducedFade = {
  '.faqp': 'transition:opacity 120ms linear,display 120ms allow-discrete,visibility 120ms !important',
  '.faq-scrim': 'transition:opacity 120ms linear,visibility 120ms linear !important',
};
const legacyMotion = ['.button', '.button svg', '.chip', '.star'];
const motionProblems = (rules) => rules.filter((r) => /(?:^|;)\s*transition\s*:/.test(r.body) && !/transition\s*:\s*none/.test(r.body)).filter((r) => {
  const sel = r.selector.split(',').map((x) => x.trim()).join(',');
  if (legacyMotion.includes(r.selector.trim())) return false;
  if (r.media.length === 1 && /^@media \(prefers-reduced-motion: ?reduce\)$/.test(r.media[0]) && reducedFade[sel]) return !r.body.includes(reducedFade[sel]) || /transform\s+\d/.test(r.body);
  const want = motionAllowed[sel];
  return !want || !r.body.includes(want) || r.media.some((m) => !/min-width: (?:600|1200)px|^@supports \(interpolate-size:allow-keywords\)$/.test(m));
}).map((r) => r.selector);
check('§8: every transition is a listed effect with its token time and easing; only the dormant legacy rules keep theirs',
  transitions.length >= 8 && motionProblems(allCss).length === 0 && legacyMotion.every((sel) => rulesFor(sel).length > 0)
    && motionProblems(cssTree(cssRules + '.results{transition:opacity .2s}')).length === 1
    && motionProblems(cssTree(cssRules + '.expand{transition:height .2s}')).length === 1
    && motionProblems(cssTree(cssRules + '@media (prefers-reduced-motion:reduce){.sheet{transition:opacity 120ms linear}}')).length === 1
    && motionProblems(cssTree(cssRules + '@media (prefers-reduced-motion:reduce){.faqp{transition:transform 120ms linear}}')).length === 1,
  motionProblems(allCss).join(', '));
// 2026-11-08: the phone logo handover (option C: logo-travel, logo-shrink,
// logo-off, tile-on, count-glide) runs on the scroll, not the clock.
// visibility is allowed in the tile's step and only there: it is not motion,
// it keeps the hidden tile out of reach of taps and Tab.
check('round 2 animations use only opacity and transform (the phone tile\'s step also visibility); arbitrary keyframes and animated dimensions fail', (() => {
  const valid = (source) => {
    const animations = [...source.matchAll(/@keyframes ([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
    return animations.every(([, name, body]) => ['toast-in','toast-out','step-in','step-back','logo-travel','logo-shrink','logo-off','tile-on','count-glide'].includes(name)
      && !(name === 'tile-on' ? /(?:^|[;{])\s*(?!opacity\b|transform\b|visibility\b)[a-z-]+\s*:/ : /(?:^|[;{])\s*(?!opacity\b|transform\b)[a-z-]+\s*:/).test(body));
  };
  return valid(cssRules) && !valid(cssRules + '@keyframes bad{from{height:0}}') && !valid(cssRules.replace('@keyframes logo-shrink{', '@keyframes logo-shrink{0%{visibility:hidden}'));
})());
check('slot: one grid row 1fr open / 0fr and transparent closed, a clipping min-height:0 child; the chevron box turns whole, with no shift between states',
  /display:grid;grid-template-rows:1fr/.test(bodyOf('.expand')) && /grid-template-rows:0fr;opacity:0/.test(bodyOf('.expand[data-state=closed]'))
    && /min-height:0;overflow:hidden/.test(bodyOf('.expand-inner')) && !/(?:^|;)\s*transform\s*:/.test(bodyOf('.chev'))
    && /^transform:rotate\(180deg\)$/.test(bodyOf('.is-open .chev')));
check('wide: the selection fill never fades in or out; only an unselected row fades its hover',
  /transition:none/.test(bodyOf('.row', ['@media (min-width: 1200px)'])) && !/transition/.test(bodyOf('.is-sel>.row', ['@media (min-width: 1200px)'])));
check('sheet: slides from translateY(100%) with @starting-style and discrete display; its own scrim fades; from 600 neither transitions',
  /transform:translateY\(100%\)/.test(bodyOf('.sheet')) && /transform:none/.test(bodyOf('.sheet[open]'))
    && /transform:translateY\(100%\)/.test(bodyOf('.sheet[open]', ['@starting-style'])) && /opacity:0/.test(bodyOf('.sheet-scrim.is-open', ['@starting-style']))
    && /background:var\(--scrim\);opacity:0/.test(bodyOf('.sheet-scrim')) && /opacity:1/.test(bodyOf('.sheet-scrim.is-open'))
    && ['.sheet', '.sheet[open]', '.sheet-scrim', '.sheet-scrim.is-open'].every((sel) => /transition:none/.test(bodyOf(sel, ['@media (min-width: 600px)'])))
    && /opacity:0/.test(bodyOf('.pane-body>.fade-in', ['@starting-style'])));
check('sheet slide contains paint and promotes transform and scrim opacity only while moving; missing-containment and permanent-promotion fixtures fail', (() => {
  const valid = (source) => {
    const rules = cssTree(source.replace(/\/\*[\s\S]*?\*\//g, ''));
    const body = (sel) => rules.filter(r => r.selector === sel && !r.media.length).map(r => r.body).join(';');
    return /contain:layout paint/.test(body('.sheet'))
      && body('.sheet.is-sliding') === 'will-change:transform'
      && body('.sheet-scrim.is-sliding') === 'will-change:opacity'
      && !/will-change/.test(body('.sheet') + body('.sheet-scrim'))
      && body('.sheet[open]').includes('transition:transform var(--t-sheet-in) var(--ease-sheet),display var(--t-sheet-in) allow-discrete')
      && body('.sheet').includes('transition:transform var(--t-sheet-out) var(--ease-sheet),display var(--t-sheet-out) allow-discrete,visibility var(--t-sheet-out)')
      && /--ease-sheet:cubic-bezier\(\.32,\.72,0,1\);/.test(source);
  };
  return valid(css) && !valid(css.replace('contain:layout paint;', ''))
    && !valid(css.replace('.sheet.is-sliding{will-change:transform}', '.sheet{will-change:transform}'));
})());
// The old rule shortened every effect to 0.01ms: still a transition, still
// firing its events late. Reduced motion is now none, backdrop included.
const reducedBody = allCss.filter((r) => r.media.join() === '@media (prefers-reduced-motion: reduce)').map((r) => `${r.selector}{${r.body}}`).join('');
check('reduced motion is instant: transition and animation none !important on every element, pseudo-element and ::backdrop; no 0.01ms',
  /\*, \*::before, \*::after, ::backdrop\s*\{[^}]*transition: none !important;[^}]*animation: none !important;[^}]*scroll-behavior: auto !important/.test(reducedBody)
    && !/0\.01ms/.test(cssRules));
// Review of PR 1: "*" never matches ::details-content or the slider thumb, so
// under reduced motion the phone sheet's lists still grew for 260 ms and the
// thumb still scaled. Every pseudo-element that has a transition anywhere
// (other than ::before, ::after and ::backdrop, which the rule above covers)
// needs its own rule there, alone, since one unknown pseudo-element would
// drop a shared selector list.
const motionPseudoGaps = (source) => {
  const tree = cssTree(source.replace(/\/\*[\s\S]*?\*\//g, ''));
  const reduced = tree.filter((r) => r.media.join() === '@media (prefers-reduced-motion: reduce)' && /transition: ?none !important/.test(r.body)).map((r) => r.selector.trim());
  const moving = tree.filter((r) => /(?:^|;)\s*transition\s*:/.test(r.body) && !/transition\s*:\s*none/.test(r.body));
  const pseudos = new Set(moving.flatMap((r) => [...r.selector.matchAll(/::([\w-]+)/g)].map((m) => m[1])).filter((name) => !['before', 'after', 'backdrop'].includes(name)));
  return [...pseudos].filter((name) => !reduced.some((sel) => !sel.includes(',') && new RegExp(`::${name}$`).test(sel)));
};
check('reduced motion also stops ::details-content and the slider thumbs, each in a rule of its own',
  motionPseudoGaps(cssRules).length === 0
    && ['::details-content', 'input[type=range]::-webkit-slider-thumb', 'input[type=range]::-moz-range-thumb'].every((sel) => /transition: none !important/.test(bodyOf(sel, ['@media (prefers-reduced-motion: reduce)'])))
    && motionPseudoGaps(cssRules + '.x::marker{transition:color 1s}').join() === 'marker'
    && motionPseudoGaps(cssRules.replace('::details-content { transition: none !important; }', '')).join() === 'details-content',
  motionPseudoGaps(cssRules).join(', '));
// A05: Chrome named a row "World Bachelor in Business , BSc" (and the pane
// "Antropologie , Bc.") because the clipped, absolute ", " counted as its own
// block. The title's separator is inline at zero size; the global utility is
// untouched.
check('A05: the title/degree separator is inline and zero-sized only inside a row button and the detail title; .visually-hidden itself is unchanged',
  /position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;clip-path:none;font-size:0;line-height:0/.test(bodyOf('.open>.visually-hidden'))
    && bodyOf('.open>.visually-hidden') === bodyOf('.d-title>.visually-hidden')
    && /position: absolute;/.test(css.match(/\.visually-hidden \{[^}]*\}/)?.[0] ?? '')
    && (renderSrc.match(/el\('span', 'visually-hidden', ','\)/g) ?? []).length === 1);
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
// Windowing replaces the old eventual full-mount scheduler. Layout/anchoring
// is tested in browsers; this harness checks state and row identity.
const l09 = (run) => {
  run('allRows = live; facets = buildFacets(allRows); update();');
  return run('windowRows.map(row => row.id)');
};
const listIds = (get) => get('results').querySelectorAll('li.item').map(n => n.dataset.id);
const sameList = (get, want) => listIds(get).join() === want.join();
appCheck('row keyboard: narrow arrows cross the window edge on Save without opening details', ({ run, get, item, context }) => {
  const ids = l09(run), last = get('results').querySelectorAll('li.item').at(-1);
  const nextId = ids[ids.indexOf(last.dataset.id) + 1];
  const button = last.querySelector('button.star'); button.focus();
  context.keyEvent = { target: button, key: 'ArrowDown', preventDefault() {} };
  run('rowKeydown(keyEvent); rememberFocus();');
  return stubDocument.activeElement === item(nextId).querySelector('button.star')
    && item(nextId).querySelector('button.star').tabIndex === 0
    && item(nextId).querySelector('button.open').tabIndex === -1
    && run('openIds.size') === 0 && run('selectedId') === null && listIds(get).length < 40;
});
appCheck('window: full estimated length at once, bounded DOM after idle, correct list positions', ({ run, get, drain }) => {
  const ids = l09(run); drain();
  return listIds(get).length < 40 && run('rowOffsets.at(-1)') === ids.length * 180
    && get('results').querySelector('.row-space').getAttribute('aria-hidden') === 'true'
    && get('results').querySelector('li.item').getAttribute('aria-setsize') === String(ids.length);
});
appCheck('window: Save and Compare focus restore on rebuild, including a distant row', ({ run, item }) => {
  const ids = l09(run), id = ids[300];
  for (const selector of ['button.star', 'button.cmpi']) {
    run(`mountRow(${JSON.stringify(id)}).querySelector(${JSON.stringify(selector)}).focus(); update();`);
    if (stubDocument.activeElement !== item(id).querySelector(selector)) return false;
  }
  return true;
});
appCheck('window: deep focus survives a rebuild without mounting all preceding rows', ({ run, get, item }) => {
  const ids = l09(run);
  run(`mountRow(${JSON.stringify(ids[300])}).querySelector('button.open').focus(); update();`);
  return listIds(get).length < 40 && stubDocument.activeElement === item(ids[300]).querySelector('button.open');
});
appCheck('window: print includes every row and saved open slot, afterprint returns to bounded DOM', ({ run, get, item, fireWindow }) => {
  const ids = l09(run);
  run(`openIds.add(${JSON.stringify(ids[300])});`);
  fireWindow('beforeprint');
  if (!sameList(get, ids) || !item(ids[300]).querySelector('.expand') || get('results').querySelector('.row-space')) return false;
  fireWindow('afterprint');
  return listIds(get).length < 40 && run('openIds.size') === 1;
});
appCheck('window: afterprint prunes the full catalogue before reading screen geometry', ({ run, get, fireWindow }) => {
  l09(run);
  fireWindow('beforeprint');
  const list = get('results'), rect = list.getBoundingClientRect.bind(list);
  let fullReads = 0;
  list.getBoundingClientRect = () => {
    if (list.querySelectorAll('li.item').length > 40) fullReads++;
    return rect();
  };
  fireWindow('afterprint');
  return fullReads === 0 && listIds(get).length < 40;
});
appCheck('window: print keeps the visible programme when measured heights differ from estimates', ({ run, get, context, fireWindow }) => {
  l09(run);
  run('rowHeights = rowHeights.map((height, i) => i < 30 ? 220 : height); indexRowHeights();');
  get('results').rect = { top: -6000, width: 0, height: 500000 };
  context.window.scrollY = 6000;
  run('renderWindow();');
  const before = run('windowRows[rowAt(window.scrollY)].id');
  fireWindow('beforeprint'); fireWindow('afterprint');
  return run('windowRows[rowAt(window.scrollY)].id') === before;
});
appCheck('window: printing Compare keeps the hidden list window and restores it on close', ({ run, get, fireWindow }) => {
  const ids = l09(run), before = listIds(get);
  run(`compareIds = ${JSON.stringify(ids.slice(0, 2))}; openCompare(null);`);
  fireWindow('beforeprint'); fireWindow('afterprint');
  if (!sameList(get, before)) return false;
  run('closeCompare(true);');
  return sameList(get, before);
});
appCheck('window: ArrowDown past mounted edge mounts the next row and selects it wide', ({ run, get, flip, context }) => {
  flip(true); const ids = l09(run);
  const items = get('results').querySelectorAll('li.item'), last = items.at(-1);
  const index = ids.indexOf(last.dataset.id);
  context.keyEvent = { target: last.querySelector('button.open'), key: 'ArrowDown', preventDefault() {} };
  run('rowKeydown(keyEvent);');
  return stubDocument.activeElement.closest('li.item').dataset.id === ids[index + 1]
    && run('selectedId') === ids[index + 1] && listIds(get).length < 40;
});
appCheck('window: crossing modes stays bounded and late arrivals inherit selection/open state', ({ run, get, item, flip }) => {
  const ids = l09(run), id = ids[300];
  flip(true); run(`selectedId = ${JSON.stringify(id)}; mountRow(selectedId);`);
  if (!item(id).classList.contains('is-sel')) return false;
  flip(false); run('mountRow(selectedId);');
  return listIds(get).length < 40 && item(id).querySelector('button.open').getAttribute('aria-expanded') === 'true';
});
appCheck('window: measurements correct only heights above the visible anchor', ({ run, get, context }) => {
  l09(run);
  get('results').rect = { top: -6000, width: 0 };
  context.window.scrollY = 6000;
  run('renderWindow();');
  const first = get('results').querySelector('li.item');
  first.rect = { height: 220 };
  run('renderWindow();');
  return context.window.scrollY === 6040 && run('rowAt(6000)') === 33;
});
appCheck('window: Home reaches the top without height corrections cancelling its smooth scroll; scrollend restores anchoring', ({ run, get, context, fireWindow }) => {
  l09(run);
  get('results').rect = { top: -6000, width: 0, height: 500000 };
  context.window.scrollY = 6000;
  run('goHome();');
  let corrections = 0;
  context.window.scrollTo = () => { corrections++; };
  get('results').querySelector('li.item').rect = { height: 220 };
  run('renderWindow();');
  if (corrections !== 0) return false;
  fireWindow('scrollend', { target: get('pane') });
  get('results').querySelector('li.item').rect = { height: 240 };
  run('renderWindow();');
  if (corrections !== 0) return false;
  fireWindow('scrollend', { target: stubDocument });
  get('results').querySelector('li.item').rect = { height: 260 };
  run('renderWindow();');
  return corrections === 1;
});
appCheck('window: interrupted Home restores anchoring on user input even without scrollend', ({ run, get, context, fireWindow }) => {
  l09(run);
  get('results').rect = { top: -6000, width: 0, height: 500000 };
  context.window.scrollY = 6000;
  // pointerdown: dragging the scrollbar, where no scrollend comes (Safari < 17.4).
  for (const type of ['touchstart', 'wheel', 'pointerdown', 'keydown']) {
    run('goHome();');
    let corrections = 0;
    context.window.scrollTo = () => { corrections++; };
    fireWindow(type);
    get('results').querySelector('li.item').rect = { height: 220 };
    run('renderWindow();');
    if (corrections !== 1) return false;
  }
  return true;
});
appCheck('window: a big jump keeps its scroll position through intermediate layout reads', ({ run, get, context }) => {
  l09(run);
  const list = get('results');
  list.rect = { top: -30000, width: 0, height: 500000 };
  context.window.scrollY = 30000;
  const prototype = Object.getPrototypeOf(list), remove = prototype.remove;
  // Model WebKit clamping during a layout read while the gaps are absent.
  prototype.remove = function () {
    remove.call(this);
    if (!list.querySelector('.row-space') && !parseFloat(list.style.minHeight)) context.window.scrollY = 0;
  };
  try {
    run('renderWindow();');
    list.rect.top = -100000;
    context.window.scrollY = 100000;
    run('renderWindow();');
    return context.window.scrollY === 100000;
  } finally { prototype.remove = remove; }
});
appCheck('window: height changes below the anchor never interrupt scrolling', ({ run, get, context }) => {
  l09(run);
  get('results').rect = { top: -6000, width: 0, height: 500000 };
  context.window.scrollY = 6000;
  run('renderWindow();');
  get('results').querySelectorAll('li.item').at(-1).rect = { height: 400 };
  let corrections = 0;
  context.window.scrollTo = () => { corrections++; };
  run('renderWindow();');
  return corrections === 0;
});
// Review of the windowing PR (2026-11-09). An update while Compare was open
// emptied the hidden list, and Close never drew it again: a blank list, or the
// old position clamped near the top. smoke "window fixes" checks it in Chrome.
appCheck('window: an update while Compare is open leaves the list drawn after Close, at the old scroll, focus on the trigger', ({ run, get, context }) => {
  const ids = l09(run);
  get('results').rect = { top: -6000, width: 0, height: 500000 };
  context.window.scrollY = 6000;
  run('renderWindow();');
  run(`compareIds = ${JSON.stringify(ids.slice(0, 2))};`);
  get('header-compare').focus();
  run('openCompare(dom.headerCompare);');
  context.window.scrollY = 0;
  run("state.search = live[0].programme.slice(0, 3); update();");
  if (listIds(get).length !== 0) return false;
  run('closeCompare(true);');
  return listIds(get).length > 0 && listIds(get).length < 40 && context.window.scrollY === 6000
    && stubDocument.activeElement === get('header-compare');
});
// A language switch scrolled back to the old pixel offset after the rows had
// changed height (Slovak rows are taller): another programme ended up on top.
// smoke "window fixes" measures the real rows in Chrome.
appCheck('window: a language switch keeps the programme at the top of the list where it was on screen', ({ run, get, item, context }) => {
  const ids = l09(run), id = ids[4];
  context.window.scrollY = 6000;
  context.window.scrollBy = function (x, y) { this.scrollX += x; this.scrollY += y; };
  item(id).rect = { top: 120, bottom: 300, height: 180 };
  run("switchLanguage('sk');");
  // The rebuilt row sits at 0 here, so the page moves up by its 120 px shift.
  return context.window.scrollY === 5880 && !!item(id);
});
// Print near the end: the full list is shorter than the estimates, so the
// position read after print was clamped; and the tray's room went with it.
appCheck('window: afterprint goes back to the position read before print, with the tray\'s room kept', ({ run, get, context, fireWindow, html }) => {
  l09(run);
  context.window.scrollY = 6000;
  html.style.setProperty('--tray-h', '62px');
  fireWindow('beforeprint');
  context.window.scrollY = 4000;
  fireWindow('afterprint');
  // The tray observer keeps --tray-h while printing; a tray still hidden
  // after print (none here: Compare is empty) gives the room back.
  return context.window.scrollY === 6000 && html.style['--tray-h'] === undefined
    && appSrc.includes("else if (!printing) document.documentElement.style.removeProperty('--tray-h');");
});
// Escape in the wide pane focused nothing when the picked row was not drawn.
appCheck('window: Escape in the wide pane returns focus to a picked row that was scrolled out of the window', ({ run, get, item, flip, fire, context }) => {
  flip(true); const ids = l09(run), id = ids[300];
  run(`selectRow(${JSON.stringify(id)});`);
  get('results').rect = { top: -30000, width: 0, height: 500000 };
  context.window.scrollY = 30000;
  get('pane').focus();
  run('renderWindow();');
  if (item(id)) return false;
  fire(get('pane'), 'keydown', { key: 'Escape' });
  return run('selectedId') === null && stubDocument.activeElement === item(id)?.querySelector('button.open') && listIds(get).length < 40;
});
// The list was measured while still hidden after "No programmes match".
appCheck('window: rows come back from "No programmes match" measured at the shown width', ({ run, get, tree }) => {
  l09(run);
  const list = get('results'), listp = tree.querySelector('.listp');
  list.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0, width: listp.hidden ? 0 : 800 });
  run("state.search = 'zzzz'; update();");
  if (!listp.hidden || listIds(get).length) return false;
  run('clearAll();');
  return !listp.hidden && run('windowWidth') === 800 && listIds(get).length > 0;
});
appCheck('window: a second filter update replaces the dataset and removes stale focus rows', ({ run, get, drain }) => {
  l09(run); run("state.search = live[500].programme; update();"); drain();
  const want = run('windowRows.map(row => row.id)');
  return want.length < 40 && sameList(get, want);
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
  let moves = 0; const hook = stubDocument.moved; stubDocument.moved = (n) => { if (n.isConnected) moves++; hook(n); };
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
// Each estimate belongs to the layout it was measured in: the base phone row,
// a 320 px phone, the 600 px tablet list and the 800 px list container.
check('window estimates are the measured heights, each on .results under its own media or container query; native anchoring is off',
  JSON.stringify(allCss.filter((r) => /--row-estimate/.test(r.body)).map((r) => [r.selector, r.media.join(' '), r.body.trim()]))
    === JSON.stringify([['.results', '', '--row-estimate:180px'], ['.results', '@media (max-width: 359.98px)', '--row-estimate:240px'],
      ['.results', '@media (min-width: 600px)', '--row-estimate:152px'], ['.results', '@container (min-width: 800px)', '--row-estimate:90px']])
    && /overflow-anchor:none/.test(ruleAt(cssText, 'html')));
// Windowing replaced the old content skipping. Print mounts every row
// (flushRows); the gaps that stand in for unmounted rows must not print.
check('print shows every row: containment off, gaps hidden',
  /contain: none/.test(printBody('.item')) && /display: none/.test(printBody('.row-space')));
appCheck('window: scroll bursts schedule one frame and do not run under the Filters slide', ({ run, fireWindow, frames, flushFrame, fire, get }) => {
  l09(run); flushFrame(); flushFrame();
  fireWindow('scroll'); fireWindow('scroll'); fireWindow('scroll');
  if (frames.size !== 1) return false;
  fire(get('f-more'), 'pointerdown');
  fireWindow('scroll');
  return frames.size === 0;
});
// Batch 3 · A: and the compare tray, the header Compare button and every compare control.
check('A08 print hides controls, count, sort header and the list Sort select, pane, chevrons, skip/goto, sheet, shortlist, skeletons, issues, saved-copy and failure banners, compare controls and tray, but never the sample warning',
  ['.fbar', '.status', '.hd', '.cols', '.listp>.f-sort', '.pane', '.chev', '.goto', '.skip-link', '.sheet', '.shortlist-bar', '.skeletons', '.issues', '.bn-saved', '.bn-fail',
    '.cmp-tray', '#header-compare', '.cmpi', '.cmpb', '.cmp-acts', '.cmp-nav']
    .every((sel) => /display:none/.test(printBody(sel).replace(/\s/g, '')))
    && !/display:\s*none/.test(printBody('.bn-sample') + printBody('#source-banner') + printBody('.bn')));
check('the print block has no .src-more rule: nothing renders that element, so the rule was dead', printBody('.src-more') === ''
  && !printRules.some((r) => r.selector.includes('src-more')));
// GitHub can't be run here, so this only pins the shape of the workflow: smoke
// on pull requests only (the checks job keeps running on pushes), the real-Chrome
// flag that turns "no Chrome" into a failure, the pinned action majors, and the
// least-privilege token.
{
  const workflow = read('.github/workflows/checks.yml');
  const jobs = workflow.split(/^jobs:\n/m)[1] ?? '';
  const smokeJob = jobs.split(/^  smoke:\n/m)[1] ?? '', checksJob = (jobs.split(/^  smoke:\n/m)[0] ?? '');
  check('GitHub checks: "checks" runs on every push and PR; "smoke" runs on pull requests only, in real Chrome (--require-chrome), Node 26, 40 minutes, with a failure-only artifact',
    /^on: \[push, pull_request\]$/m.test(workflow) && /^permissions:\n  contents: read$/m.test(workflow)
    && !/^    if:/m.test(checksJob) && /node tools\/check\.mjs/.test(checksJob) && /node tools\/check-contrast\.mjs/.test(checksJob)
    && /^    if: github\.event_name == 'pull_request'$/m.test(smokeJob) && /^    runs-on: ubuntu-latest$/m.test(smokeJob) && /^    timeout-minutes: 40$/m.test(smokeJob)
    && /node-version: 26/.test(smokeJob) && /run: node tools\/smoke\.mjs --require-chrome\b/.test(smokeJob)
    && /if: failure\(\)\n        uses: actions\/upload-artifact@v7/.test(smokeJob)
    && [...workflow.matchAll(/uses: (\S+)/g)].every((m) => /@v\d+$/.test(m[1])));
}
// The first GitHub smoke run (2026-11-09) failed 22 checks that pass on a Mac.
// These pin the fixes in tools/smoke.mjs so they can't quietly come back.
{
  const smoke = read('tools/smoke.mjs');
  const code = smoke.replace(/^\s*\/\/.*$/gm, '');
  check('smoke drags with Input.dispatchTouchEvent (touchSwipe), never Input.synthesizeScrollGesture: on GitHub\'s Linux Chrome that left every page unscrolled (B3A, R4B, CMP, ROW)',
    !/synthesizeScrollGesture/.test(code) && /async function touchSwipe\(/.test(code)
    && (code.match(/touchSwipe\(page, /g) ?? []).length >= 6
    && /y: Math\.round\(yDistance < 0 \? height \* 0\.8 : height \* 0\.2\)/.test(code));
  check('smoke Chrome says it has a mouse (pointer fine, hover) on every system: Linux headless says pointer:none, so the facet search never focused (R3A)',
    /'--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2'/.test(code));
  check('smoke "FAQ reduced motion" waits for the closed panel to rest at opacity 0 first (switching the media setting starts a hidden 120 ms fade; GitHub read opacity 1), then reads the fade start in the page',
    /'the closed panel at rest'/.test(code) && /!p\.open&&o==='0'&&!p\.getAnimations\(\)\.some\(a=>a\.playState==='running'\)/.test(code)
    && /addEventListener\('transitionrun'/.test(code) && /'the fade to start'/.test(code));
  check('smoke "FAQ open" waits for the slide\'s transitionend before it reads tap-to-settled (it read null once)',
    /'the slide\\'s transitionend'/.test(code));
  check('smoke --only=<section,…> runs just the named sections and rejects unknown names and an empty list (it passed with 0 checks)',
    /startsWith\('--only='\)/.test(code) && /if \(!only\.length\) throw/.test(code) && /--only: no section/.test(code) && /Object.hasOwn\(sections, name\)/.test(code));
  // PR #6's second GitHub run: Show sits where Finish was, so a quick tap was
  // the second click of a double-tap, which Show ignores on purpose.
  check('smoke "NMO timing" waits out the double-tap window after Finish and fails by name if a Setup close tap counts as a double-tap (GitHub read it as a blocked Filters tap)',
    /if\(action==='finish'\)\{\s*for\(let i=0;i<5;i\+\+\)\{[^\n]*\}\s*await new Promise\(r=>setTimeout\(r,800\)\);\s*\}/.test(code)
    && /window\.__obDetail=e\.detail/.test(code) && /await page\.ev\('__obDetail'\)===1/.test(code));
}
// The header and footer do not print, so paper had neither the site's name nor
// the warning (the old check read a .src-more rule nothing renders any more).
// smoke "PR print head" measures both on emulated print media.
check('A08 paper carries the site name and the check-the-official-page warning: .print-head holds both, hidden on screen, shown in print',
  /<div class="print-head"><p class="print-name" data-i18n="r2_wordmark">[^<]+<\/p><p data-i18n="r2_footer_p">[^<]+<\/p><\/div>/.test(read('index.html'))
    && indexHtml.includes(`<div class="print-head"><p class="print-name">${UI.en.r2_wordmark}</p><p>${UI.en.r2_footer_p}</p></div>`)
    && /display:none/.test(ruleAt(cssText, '.print-head')) && /display: block/.test(printBody('.print-head')));
// Setup and the Filters sheet printed over the list when left open: their
// [open] rules out-ranked the print hide. smoke "PR print dialogs" prints both.
check('A08 print hides the open Setup and Filters dialogs and their scrims, at their [open] weight',
  ['dialog.sheet', 'dialog.sheet[open]', '.sheet-scrim', '.sheet-scrim.is-open', 'dialog.ob', 'dialog.ob[open]', '.ob-scrim', '.ob-scrim.is-open']
    .every((sel) => /display: none/.test(printBody(sel)))
    && /overflow: visible/.test(printBody('html.sheet-open')) && /overflow: visible/.test(printBody('html.onboarding-open')));
check('A08 print is ink on white: no row, cell, selected, open or banner fill or shadow; titles and verdicts in ink; marks print with backgrounds off',
  ['.row', '.is-open>.row', '.is-sel>.row', '.cell', '.detail', '.listp', '.bn'].every((sel) => /background: none/.test(printBody(sel)) && /box-shadow: none/.test(printBody(sel)))
    && ['.open', '.d-title', '.cell .verd', '.cell .r2'].every((sel) => /color: var\(--ink\)/.test(printBody(sel)))
    && /background: none; color: var\(--ink\)/.test(printBody('.cc[data-country]'))
    && /print-color-adjust: exact/.test(printBody('.m::before')) && /outline: none/.test(printBody(':focus-visible::after')));
check('A08 print shows every row and open slot in full: no content skipping or intrinsic size, slots forced open and unclipped, a closing slot hidden, rows kept whole',
  /contain: none/.test(printBody('.item'))
    && !allCss.some((r) => /(?:^|[\s,>])(?:li)?\.item(?![\w-])/.test(r.selector) && /content-visibility/.test(r.body))
    && /grid-template-rows: 1fr; opacity: 1/.test(printBody('.expand'))
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
for (const [key, asc, desc] of [['deadline', 'abcde', 'badce'], ['tuition', 'dabce', 'bcade'], ['points', 'dabce', 'bcade'], ['name', 'bacde', 'cdeab']]) {
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
check('sort select keeps Best match disabled without points alongside yearly cost', withStubDocument(() => {
  const select = new ChromeNode('select'); renderSortOptions(select, filtersMod.SORTS, 'tuition', 'desc');
  return select.children.length === 11 && select.children.find((o) => o.value === 'best:asc')?.disabled === true && select.children.filter((o) => o.selected).map((o) => o.value).join() === 'tuition:desc' && new Set(select.children.map((o) => o.value)).size === 11;
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
  if (context.document.querySelector('.sort-label').textContent !== 'Programme — Z to A') return false;
  get('f-sort').value = 'tuition:desc'; fire(get('f-sort'),'change');
  if (context.document.querySelector('.sort-label').textContent !== 'Programme — A to Z') return false;
  get('f-deadline').value = 'open'; fire(get('f-deadline'),'change'); fire(get('f-clear'),'click');
  return run('state.sort + state.dir') === 'deadlineasc' && get('f-sort').value === 'deadline:asc' && get('f-deadline').value === 'any';
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
  if (!maths.closest('.fld')?.classList.contains('is-set') || !exam.closest('.dropdown')?.classList.contains('is-set')) return false;
  if (more.querySelector('span').textContent !== 'Filters (2)' || clear.textContent !== 'Clear all (2)') return false;
  // The tick is a different filter: it adds a chip and one to both counts, as
  // it sits in the phone sheet beside My maths.
  get('f-maths').checked = true; fire(get('f-maths'), 'change');
  if (run('state.hlMaths') !== true || run('state.myMaths') !== 'AA SL' || !chip('hlMaths') || !urls.at(-1).includes('maths=1&mymaths=AA+SL&exam=none')
    || more.querySelector('span').textContent !== 'Filters (3)' || clear.textContent !== 'Clear all (3)') return false;
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
// Two wrap rows preserve every filter and contain all facet panels.
{
  const row = elementSource(indexHtml, /<div class="frow facets-row">/);
  const valid = (source) => ['subjects','countries','languages','cities','degrees','deadline','exam','budget'].every((id) => source.includes(`id="dd-${id}"`));
  check('round 2 puts eight facets in the second row with Budget last, maths in the first; a missing facet fails',
    valid(row) && !valid(row.replace('id="dd-exam"', 'id="missing"')) && formSrc.includes('id="maths-seg"')
    && formSrc.indexOf('id="dd-budget"') > formSrc.indexOf('id="dd-exam"') && !formSrc.slice(0, formSrc.indexOf('class="frow facets-row"')).includes('id="dd-budget"'));
}
appCheck('my-list export uses reverse direction without changing the shortlist or list filters', ({run,get,fire,context}) => {
  run("shortlist.add(fixture[0].id); shortlist.add(fixture[1].id); shortlist.add(fixture[2].id); state.sort = 'name'; state.dir = 'desc';");
  const expected = context.fixture.slice().sort((a,b) => b.programme.localeCompare(a.programme) || a.university.localeCompare(b.university)).map((r) => r.id).join(',');
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
check('both the list and the my-list export pass direction', /sortRows\(state.shortlistOnly && listAll \? inScope : filtered, state.sort, state.dir, state\)/.test(appSrc) && /sortRows\(allRows.filter\(\(r\) => shortlist.has\(r.id\)\), state.sort, state.dir, state\)/.test(appSrc));

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
// U5: the Czech note belongs to matching details, not the Language filter.
{
  const html = read('index.html');
  const panel = html.slice(html.indexOf('id="dd-languages"'), html.indexOf('</details>', html.indexOf('id="dd-languages"')));
  check('U5 Language panel has no Czech help or description',
    !/f-languages-help|aria-describedby|dd-help/.test(panel));
  check('U5 old Czech note key is removed',
    !read('js/i18n.js').includes('degrees_taught_in_czech_at_public_universities_are_free_whatever_you'));
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
  'Try fewer words or check your spelling. Words can appear in any order: “Dublin computer” works. Typos are not corrected.',
  'Some problems hide a row; others leave a value unknown. Each message explains what happened.',
  UI.en.r2_footer_p,
  '>Export CSV', '>Clear my list', '>Data problems',
]) check(`static wording: ${text}`, indexHtml.includes(text));
// Jakub, 2026-11-04 (#3): the "starting point, not a source of truth" wording
// read awkwardly and was replaced. The 2026-11-05 merge with design round 2
// almost brought it back in the footer; keep it out of both languages.
check('the old "starting point" warning is gone from the page and both languages',
  !indexHtml.includes('starting point') && !JSON.stringify(UI).includes('starting point')
    && !JSON.stringify(UI).includes('východisk'));
check('the footer carries Jakub\'s "Students maintain this site." in both languages',
  UI.en.r2_footer_p.endsWith('Students maintain this site.') && UI.sk.r2_footer_p.endsWith('Túto stránku spravujú študenti.'));
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
  // Batch 3 B3: the empty My list's hint says how to save (was 'no_programmes_are_saved_here').
  ['r3_list_empty_hint', 'Use the bookmark next to any programme to save it here. Your list stays in this browser.'],
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
  return byClass(box, 'opt-q')[0].querySelector('input').placeholder === 'Search subject area options'
    && byClass(box, 'opt-q')[0].querySelector('input').getAttribute('aria-label') === 'Search subject area options'
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
  check('real data: every floor source names a visa, UDI, the Migration Agency or an immigration service, and all four kinds are found',
    realFloors.every((s) => /visa|UDI|Migration Agency|Immigration Service/.test(s))
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
  /<label for="f-budget">Max yearly cost \(fee \+ living\)<\/label>/.test(indexHtml) && /<label for="f-living">My living costs<\/label>/.test(indexHtml)
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
  const { compareTable, differs, visibleFacts, yearlyLine, money: euro } = compareMod;
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
  // Verification of PR 1: Slovak month headings read "november 2026"; the
  // Undo action was "Späť", the same word as Back.
  equal('Slovak month group headings start with a capital, and Undo is not Back',
    (() => { i18n.setLanguage('sk', { setItem() {} }); try { return groupRows(dated, 'deadline', noFilters(), filtersMod.pointsBucket).slice(0, 3).map((x) => x.label); } finally { i18n.setLanguage('en', { setItem() {} }); } })()
      .concat(UI.sk.r2_undo === UI.sk.r2_back ? 'same as Back' : UI.sk.r2_undo),
    ['December 2026', 'Marec 2027', 'Apríl 2027', 'Vrátiť späť']);
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
  {
    const rows = [live[0], live[1]];
    const table = compareTable(rows, noFilters());
    const box = withStubDocument(() => { const div = new ChromeNode('div'); renderCompare(div, rows, table, { onlyDifferences: false }); return div; });
    const cols = findAll(box, (n) => n.tagName === 'th' && n.getAttribute('scope') === 'col');
    const facts = findAll(box, (n) => n.tagName === 'th' && n.getAttribute('scope') === 'row');
    // Batch 3 · A: each column header also holds its Save toggle and "x".
    check('compare table: one column header per programme naming it and its university, then its own controls; one row header per fact',
      cols.length === 2 && cols[0].children.slice(0, 2).map((n) => n.textContent).join('|') === `${rows[0].programme}|${rows[0].university}`
      && cols[0].children.length === 3 && cols[0].children[2].classList.contains('cmp-acts') && facts.map((n) => n.textContent).join('|') === table.map((x) => x.label).join('|'));
    check('compare column accessible names reference only the programme and university, excluding action labels',
      cols.every((col) => col.getAttribute('aria-labelledby') === col.children.slice(0, 2).map((n) => n.id).join(' ')
        && col.children.slice(0, 2).every((n) => Boolean(n.id))));
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
// Batch 3 B3 rewrote this check: Compare no longer follows the saves (A adds
// its own check), and the last unsave leaves an empty list view instead of
// silently closing it (Leon, 2026-11-05: an empty My list did nothing).
appCheck('list view: unsaving keeps the row (and focus) until the list is redrawn, but the counts drop it at once; the last unsave leaves an empty list view', ({ run, get, item, fire, ids: [a, b, c] }) => {
  run('for (const r of fixture) shortlist.add(r.id); update();');
  fire(get('f-shortlist-only'), 'click');
  const star = starOf(item(a)); star.focus();
  fire(star, 'click');
  // Before any redraw: the row stays, the counts do not.
  if (!item(a) || stubDocument.activeElement !== star || star.getAttribute('aria-pressed') !== 'false'
    || get('shortlist-count-text').textContent !== '2 saved · 2 shown' || !get('result-count').textContent.startsWith('2 of 2 saved programmes')) return false;
  fire(starOf(item(b)), 'click');
  if (get('shortlist-count-text').textContent !== '1 saved · 1 shown') return false;
  fire(starOf(item(c)), 'click');
  run('update();');
  return run('state.shortlistOnly') === true && get('results').children.length === 0 && !get('empty-state').hidden
    && get('empty-title').textContent === 'Your list is empty.' && !get('empty-back').hidden && get('ml-tools').hidden;
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
// Batch 3 · A: Compare is its own set, opened from the header or the phone
// tray at any count; the My list picker that fed it is gone.
appCheck('compare view: opens from any view at any count, 2 columns hide the list, only-differences, close restores view, scroll and the trigger\'s focus', ({ run, get, fire, context, docBody, ids: [a, b] }) => {
  const trigger = new ChromeNode('button'); docBody.append(trigger); context.cmpTrigger = trigger;
  run(`compareIds = [${JSON.stringify(a)}, ${JSON.stringify(b)}]; update();`);
  context.window.scrollY = 1234;
  run('openCompare(cmpTrigger);');
  const cols = () => findAll(get('cmp-body'), (n) => n.tagName === 'th' && n.getAttribute('scope') === 'col').length;
  const facts = () => findAll(get('cmp-body'), (n) => n.tagName === 'tr' && n.getAttribute('data-fact')).length;
  if (get('compare').hidden || !get('results').parent.parent.parent.hidden || !get('shortlist-bar').hidden || cols() !== 2
    || get('cmp-h').textContent !== 'Compare 2 programmes' || stubDocument.activeElement !== get('cmp-h') || get('cmp-diff-label').hidden
    || !get('cmp-one').hidden || !get('cmp-empty').hidden) return false;
  const all = facts();
  get('cmp-diff').checked = true; fire(get('cmp-diff'), 'change');
  if (facts() > all) return false;
  // My living costs changes the totals at once, with the view still open.
  run('state.myLiving = 0; update();');
  const yearly = findAll(get('cmp-body'), (n) => n.getAttribute('data-fact') === 'yearly')[0];
  if (get('compare').hidden || (yearly && !yearly.textContent.includes('your €0/month') && !yearly.textContent.includes('Not known'))) return false;
  context.window.scrollY = 0;
  fire(get('cmp-close'), 'click');
  if (!get('compare').hidden || get('results').parent.parent.parent.hidden || stubDocument.activeElement !== trigger || context.window.scrollY !== 1234) return false;
  // From My list: back in the list view with its bar.
  run(`shortlist.add(${JSON.stringify(a)}); update();`);
  fire(get('f-shortlist-only'), 'click');
  run('openCompare(cmpTrigger);');
  if (!get('shortlist-bar').hidden) return false;
  run(`onToggleStar(${JSON.stringify(b)});`);
  if (!get('shortlist-bar').hidden) return false;
  fire(get('cmp-close'), 'click');
  if (run('state.shortlistOnly') !== true || get('shortlist-bar').hidden || get('ml-tools').hidden) return false;
  // At 0: an empty state whose Browse closes the view.
  run('compareIds = []; openCompare(null);');
  if (get('cmp-empty').hidden || cols() !== 0 || get('cmp-h').textContent !== 'Compare' || !get('cmp-diff-label').hidden) return false;
  fire(get('cmp-browse'), 'click');
  return get('compare').hidden && !get('results').parent.parent.parent.hidden;
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

appCheck('Escape dismisses only the picked detail and returns focus to its row; a dialog protects the pick', ({run,click,flip,get,fire,ids:[a]}) => {
  click(a); fire(get('results'),'keydown',{key:'Escape'});
  if(run('selectedId')!==null || get('results').querySelector('button.open').getAttribute('aria-expanded')!=='false')return false;
  flip(true); click(a); fire(get('results'),'keydown',{key:'Escape'});
  return run('selectedId')===null && !get('results').querySelector('.is-sel');
});
check('phone Sort can shrink below its longest native option instead of widening a 320px page',
  /min-width:0/.test(ruleAt(cssText, '.listp>.f-sort .inp')));
check('Country search is available even with eleven options and matches Slovak country names', withStubDocument(() => {
  const parent = new ChromeNode('div'), box = new ChromeNode('div'); parent.setAttribute('aria-label','Country'); parent.append(box);
  i18n.setLanguage('sk', {setItem(){}});
  try {
    renderChips(box,['Ireland','Germany'],new Set(),()=>{}, {forceSearch:true});
    const search = byTag(box,'input').find((n)=>n.type==='search');
    if(!search)return false; search.value='Írsko'; dispatchStub(search,{type:'input'});
    return byClass(box,'option').filter((n)=>!n.hidden).length===1 && byClass(box,'option')[0].textContent==='Írsko';
  } finally { i18n.setLanguage('en', {setItem(){}}); }
}));
section('Round 2 saved filters and transactional onboarding');
{
  const { restoration, storedFilters, validateFilters, validateLoadedFacets, hasFilterParams, hasSetupAnswers, FILTER_KEY, ONBOARDING_KEY } = savedState;
  // Leon, 2026-11-05: clicking through setup with nothing chosen showed "Your answers are now filters".
  check('setup with no answers is not reported as applied filters; any one answer is', !hasSetupAnswers(validateFilters({})) && !hasSetupAnswers(validateFilters({cities:['Dublin'], search:'law', deadlineWindow:'30'})) && [{myIbPoints:36},{hlMaths:true},{maxBudget:0},{subjectAreas:['Law']},{countries:['Ireland']},{languages:['English']}].every((raw) => hasSetupAnswers(validateFilters(raw))));
  const saved = { version: 1, filters: { search: 'Dublin', myIbPoints: 36, maxBudget: 15000, maxTuition: 0, hlMaths: true, countries: ['Ireland', 'Atlantis'], languages: ['English'], subjectAreas: ['Law'], cities: ['Dublin'], degreeTypes: ['BA'] } };
  for (const query of ['?q=', '?points=bad', '?maths=0', '?mymaths=bad', '?exam=bad', '?fee=', '?budget=bad', '?living=0', '?subject=bad', '?country=bad', '?lang=English', '?degree=bad', '?city=bad', '?deadline=bad', '?sort=bad', '?dir=bad', '?list=']) {
    const choice = restoration(query, saved);
    check(`URL parameter ${query} suppresses saved filters and onboarding`, choice.source === 'url' && !choice.onboarding && choice.state.search === '' && choice.state.myIbPoints === null);
  }
  check('UI-language-only and unrelated URL parameters still restore saved filters', ['?ui=sk', '?ui=en', '?ref=school'].every((query) => restoration(query, saved).state.myIbPoints === 36));
  check('teaching-language lang remains a recognised filter, distinct from UI language', hasFilterParams('?lang=English') && !hasFilterParams('?ui=sk'));
  check('first visit alone shows onboarding; dismissed/completed, saved filters and list links suppress it', restoration('', null).onboarding && !restoration('', null, true).onboarding && !restoration('', saved).onboarding && !restoration('?list=x', null).onboarding);
  check('corrupt, old-version and array preferences are ignored', [null, {}, {version: 0, filters:{}}, {version:1, filters:[]}].every((value) => restoration('', value).source === 'defaults'));
  const invalid = validateFilters({myIbPoints: '36', maxTuition:-1, maxBudget:Infinity, myLiving:1.5, hlMaths:'true', myMaths:'bad', exam:'bad', deadlineWindow:'bad', countries:['Ireland', 9, null], shortlistOnly:true, shared:['x'], compare:['x']});
  check('stored scalars require valid JSON types, ranges and enum values; unknown UI state is discarded', invalid.myIbPoints === null && invalid.maxTuition === null && invalid.maxBudget === null && invalid.myLiving === null && !invalid.hlMaths && invalid.myMaths === null && invalid.exam === null && invalid.deadlineWindow === 'any' && !invalid.shortlistOnly && !invalid.shared && [...invalid.countries].join() === 'Ireland');
  const coerced = validateFilters({myMaths:['AA HL'], exam:['none'], deadlineWindow:['30']});
  check('stored enum arrays cannot masquerade as valid strings', coerced.myMaths === null && coerced.exam === null && coerced.deadlineWindow === 'any');
  const exact = validateFilters({myIbPoints:45, maxTuition:0, maxBudget:50000, myLiving:0});
  check('explicit zero and beyond-slider amounts survive storage validation', exact.myIbPoints === 45 && exact.maxTuition === 0 && exact.maxBudget === 50000 && exact.myLiving === 0);
  const chosen = restoration('', saved).state;
  chosen.countries.delete('Ireland'); chosen.countries.add('Germany'); chosen.search = 'loading edit'; chosen.myIbPoints = 40;
  const real = {countries:['Ireland','Germany'], languages:['English'], subjectAreas:['Law'], cities:['Dublin'], degreeTypes:['BA']};
  validateLoadedFacets(chosen, real);
  check('post-load facet validation drops unknown saved values and preserves edits made during loading', [...chosen.countries].join() === 'Germany' && chosen.search === 'loading edit' && chosen.myIbPoints === 40);
  const stored = storedFilters({...chosen, shortlistOnly:true, sort:'points', dir:'desc', selectedId:'secret', shared:['x'], compare:['y'], panels:['z']}, real);
  equal('storage contains exactly the fourteen validated filter fields, no view/list/sort/selection/panels', Object.keys(stored.filters).sort(), ['search','subjectAreas','countries','languages','degreeTypes','cities','deadlineWindow','maxTuition','maxBudget','myLiving','myIbPoints','hlMaths','myMaths','exam'].sort());
  check('storage representation is versioned, JSON serializable and uses a separate onboarding key', stored.version === 1 && JSON.parse(JSON.stringify(stored)).filters.countries[0] === 'Germany' && FILTER_KEY !== ONBOARDING_KEY);
}
await asyncAppCheck('URL hydration never writes saved preferences; a later explicit edit does', async ({run,get,fire,context,settle,advance}) => {
  context.savedPrefs = {version:1,filters:{myIbPoints:42}}; context.location.search = '?points=36';
  run('applyUrlFields();'); context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle(); advance(500);
  if ((context.prefWrites ?? []).length || get('f-points').value !== '36') return false;
  get('f-points').value = '38'; fire(get('f-points'),'input'); advance(500);
  return context.prefWrites?.at(-1)?.filters.myIbPoints === 38;
}, {boot:true});
await asyncAppCheck('saved restoration keeps points edits during loading; Clear all removes only filters', async ({run,get,fire,context,settle,advance}) => {
  context.savedPrefs = {version:1,filters:{myIbPoints:42,countries:['Ireland','Atlantis']}};
  run('applyUrlFields();'); get('f-points').value = '37'; fire(get('f-points'),'input');
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle(); advance(500);
  if (run('state.myIbPoints') !== 37 || run('state.countries.has("Atlantis")')) return false;
  run('clearAll();'); advance(500);
  return context.prefWrites.at(-1) === null && run('preferencesDirty') === false;
}, {boot:true});
appCheck('removing an applied filter persists the explicit edit, without storing the current sort', ({run,context,advance}) => {
  run("state.countries.add('Ireland'); state.sort = 'name'; state.dir = 'desc'; update(); preferencesDirty = false; removeChip('countries:Ireland');");
  advance(500);
  return context.prefWrites?.at(-1)?.filters.countries.length === 0 && !('sort' in context.prefWrites.at(-1).filters);
});
await asyncAppCheck('onboarding apply callback preserves sort and persists exactly once through the shared debounce', async ({run,get,fire,context,settle,advance}) => {
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  get('f-sort').value = 'tuition:desc'; fire(get('f-sort'), 'change');
  context.onboardingConfig.apply(savedState.validateFilters({myIbPoints:38}));
  advance(500);
  return get('f-points').value === '38' && run('state.sort') === 'tuition' && run('state.dir') === 'desc'
    && context.prefWrites.length === 1 && context.prefWrites[0].filters.myIbPoints === 38;
}, {boot:true});
await asyncAppCheck('facet change handlers preserve edits made while data is loading', async ({run,get,fire,context,settle}) => {
  context.savedPrefs = {version:1,filters:{countries:['Ireland','Atlantis']}};
  run('applyUrlFields(); facets = buildFacets(fixture); drawChips();');
  const option = byTag(get('f-countries'),'input').find(n=>n.value==='Ireland');
  option.checked = false; fire(option,'change');
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  return run('state.countries.size') === 0 && !byTag(get('f-countries'),'input').find(n=>n.value==='Ireland').checked;
}, {boot:true});
appCheck('another tab refreshes the unselected summary pane and Undo returns focus to its row star', ({run,get,fireWindow,context,ids:[id]}) => {
  run('state.myIbPoints = 36; update();');
  context.stored = [id]; fireWindow('storage',{key:shortlistMod.SHORTLIST_KEY});
  if (!get('pane').textContent.includes('My list · 1 saved')) return false;
  run('onToggleStar(fixture[0].id);'); context.toastAction();
  return stubDocument.activeElement === get('results').querySelector(`[data-save-id="${id}"]`)
    && run('shortlist.has(fixture[0].id)') === true;
});
appCheck('heading sort cycles include the default order, announced next state and URL/phone synchronization', ({run,get,fire,context}) => {
  const urls=[]; context.history.replaceState=(s,t,url)=>{urls.push(url);context.location.search=new URL(url,'http://localhost').search;};
  for (const key of ['name','points','tuition']) {
    const button=context.document.querySelector(`[data-sort="${key}"]`);
    fire(button,'click');
    if (run('state.sort')!==key || run('state.dir')!=='asc' || get('f-sort').value!==`${key}:asc` || button.getAttribute('aria-pressed')!=='true') return false;
    fire(button,'click');
    if (run('state.dir')!=='desc' || !button.querySelector('.visually-hidden').textContent.includes('default order') || !urls.at(-1).includes('dir=desc')) return false;
    fire(button,'click');
    if(run('state.sort')!=='deadline' || run('state.dir')!=='asc' || get('f-sort').value!=='deadline:asc' || /sort=|dir=/.test(urls.at(-1))) return false;
  }
  const deadline=context.document.querySelector('[data-sort="deadline"]');
  fire(deadline,'click'); if(run('state.dir')!=='desc')return false;
  fire(deadline,'click'); if(run('state.dir')!=='asc')return false;
  get('f-sort').value='points:desc'; fire(get('f-sort'),'change');
  return run('state.sort')==='points' && run('state.dir')==='desc';
});
// The real setup dialog on the app harness's page. apply() returns the number
// shown, as app.js's callback does; media queries default to desktop.
// Review of PR 1 (2026-11-07): apply() returns { shown, summary, filtered } and
// closeCompare is counted; phone picks the narrow media query's answer.
function realSetup({get,fire,context,resultsSection}, {shown = 7, summary = [], filtered = false, sheetFiltered = filtered, phone = false, state = savedState.validateFilters({}), env = {}} = {}) {
  const writes=[], applied=[], toasts=[], compareCloses=[];
  const base={document:stubDocument,t,formatCount:i18n.formatCount,facetLabel:i18n.facetLabel,dataValue:(field,value)=>{const node=new ChromeNode('span');node.textContent=i18n.dataParts(field,value).map(p=>p.text).join('');return node;},validateFilters:savedState.validateFilters,hasSetupAnswers:savedState.hasSetupAnswers,ONBOARDING_KEY:savedState.ONBOARDING_KEY,
    localStorage:{setItem:(key,value)=>writes.push([key,value])},syncSlider(){},showToast:(...args)=>toasts.push(args),matchMedia:()=>({matches:phone,addEventListener(){}}),requestAnimationFrame:()=>0,cancelAnimationFrame(){},innerHeight:800,openFaq(){},...env};
  const setup=runInNewContext(read('js/onboarding.js').replace(/^import[^;]+;\n/gm,'' ).replace(/^export /gm,'')+'\nsetupOnboarding;',base);
  const api=setup({state,facets:filtersMod.buildFacets(context.fixture),flags:{},apply:answers=>{applied.push(answers);return {shown,summary,filtered,sheetFiltered};},results:resultsSection,closeSheet(){},closeCompare:()=>compareCloses.push(stubDocument.activeElement),firstVisit:true});
  const dialog=get('onboarding'), primary=()=>dialog.querySelector('.ob-foot .btn-p'), next=()=>fire(primary(),'click');
  // On the done screen: the heading, the count line, no "Step n of 5", the bar full.
  const doneScreen=()=>{const section=dialog.querySelector('.ob-done');return section&&{heading:section.querySelector('h2').textContent,count:section.querySelector('.ob-count').textContent,
    text:section.textContent,focused:stubDocument.activeElement===get('ob-title'),noStep:!dialog.querySelector('.ob-n'),bar:dialog.querySelector('.ob-bar i').style.transform,barShown:!dialog.querySelector('.ob-bar').hidden,
    buttons:dialog.querySelectorAll('.ob-foot button').map(b=>b.textContent)};};
  return {writes,applied,toasts,compareCloses,dialog,primary,next,doneScreen,api};
}
// Setup uses the same cheap modality as Filters: no page-wide inert/ARIA walk.
check('Setup uses show(), aria-modal and its own scrim, never showModal/inert/background aria-hidden', (() => {
  const src = read('js/onboarding.js');
  return src.includes('dialog.show();') && !/showModal\(|\.inert\s*=|setAttribute\(['"](?:inert|aria-hidden)/.test(src.replace(/svg\.setAttribute\([^;]+;/g, ''))
    && /id="onboarding" aria-modal="true" aria-labelledby="ob-title"/.test(read('index.html'))
    && /class="ob-scrim" id="onboarding-scrim" aria-hidden="true"/.test(read('index.html'))
    && !/html:has\([^}]*ob/.test(css) && !css.includes('dialog.ob::backdrop') && /html\.onboarding-open\{overflow:hidden\}/.test(css)
    && /z-index:80/.test(bodyOf('dialog.ob')) && /z-index:79/.test(bodyOf('.ob-scrim'));
})());
appCheck('Setup traps Tab both ways, skips disabled/hidden controls and redirects stray focus', (h) => {
  const {dialog, primary} = realSetup(h, {phone:true}), {get,fire} = h;
  const skip=dialog.querySelector('.skipwrap button');
  fire(get('ob-title'),'keydown',{key:'Tab'});
  if(stubDocument.activeElement!==primary() || !stubDocument.focusOptions.focusVisible)return false;
  fire(primary(),'keydown',{key:'Tab',shiftKey:true});
  if(stubDocument.activeElement!==skip)return false;
  fire(skip,'keydown',{key:'Tab'});
  if(stubDocument.activeElement!==primary())return false;
  primary().disabled=true; fire(skip,'keydown',{key:'Tab'});
  if(stubDocument.activeElement!==skip)return false;
  get('f-search').focus(); fire(get('f-search'),'focusin');
  return stubDocument.activeElement===get('ob-title') && dialog.open;
});
appCheck('Setup Escape/Skip restore keyboard/tap focus, release scrim/lock and survive a queued close after reopen', (h) => {
  const {dialog,api,writes}=realSetup(h), {get,fire,advance}=h;
  fire(dialog,'keydown',{key:'Escape'});
  if(dialog.open||writes.at(-1)[1]!=='dismissed'||stubDocument.activeElement!==get('f-search')||!stubDocument.focusOptions.focusVisible)return false;
  const trigger=get('f-more');api.open(trigger);advance(0);
  if(!dialog.open||!get('onboarding-scrim').classList.contains('is-open'))return false;
  fire(dialog,'pointerdown');fire(dialog.querySelector('.skipwrap button'),'click');
  return !dialog.open&&stubDocument.activeElement===trigger&&!stubDocument.focusOptions.focusVisible
    &&!get('onboarding-scrim').classList.contains('is-open')&&!stubDocument.documentElement.classList.contains('onboarding-open');
});
appCheck('Setup opened from the sheet returns to Filters when Edit is hidden', (h) => {
  const {dialog,api}=realSetup(h,{phone:true}), {get,fire}=h;
  fire(dialog,'cancel');const trigger=get('filter-sheet').querySelector('[data-edit]');
  // A closing sheet can still have boxes during its discrete display fade.
  trigger.getClientRects=()=>[{}];
  api.open(trigger);fire(dialog,'keydown',{key:'Escape'});
  return stubDocument.activeElement===get('f-more');
});
// Batch 3 C1 rewrote these: Finish now applies and shows the done screen; the
// done screen's "Show my programmes" closes setup. Skip and Esc are unchanged.
for (const outcome of ['apply','skip','cancel']) appCheck(`real onboarding handlers: ${outcome}, fourths progress, one transaction and stable focus`, (h) => {
  const {get,fire,resultsSection}=h, {writes,applied,toasts,compareCloses,dialog,next,doneScreen}=realSetup(h);
  if(!dialog.querySelector('.ob-bar').hidden || dialog.querySelector('.ob-bar i').style.transform!=='scaleX(0)')return false;
  next(); const points=get('ob-points'); points.value='38'; fire(points,'input'); next();
  if(dialog.querySelector('.ob-bar i').style.transform!=='scaleX(0.5)')return false;
  if(outcome==='apply'){
    next();next();
    if(dialog.querySelector('.ob-foot .btn-p').textContent!==t('r3_ob_finish'))return false;
    next();
    const d=doneScreen();
    if(!dialog.open||!d||d.heading!==t('r2_answers_applied')||!d.focused||!d.noStep||d.bar!=='scaleX(1)'||!d.barShown)return false;
    if(JSON.stringify(d.buttons)!==JSON.stringify([t('r2_show_mine'),t('r3_ob_faq')])||dialog.querySelector('.skipwrap'))return false;
    if(writes.length!==1||writes[0][1]!=='completed'||applied.length!==1)return false;
    next();
  }
  else if(outcome==='skip')fire(dialog.querySelector('.skipwrap button'),'click');
  else fire(dialog,'cancel');
  return !dialog.open && writes.length===1 && writes[0][1]===(outcome==='apply'?'completed':'dismissed')
    && applied.length===(outcome==='apply'?1:0) && (outcome!=='apply'||applied[0].myIbPoints===38) && toasts.length===0 && !dialog.querySelector('.ob-done')===(outcome!=='apply')
    && stubDocument.activeElement===(outcome==='apply'?resultsSection:get('f-search'))
    && compareCloses.length===(outcome==='apply'?1:0)
    && !(stubDocument.scrolls??[]).some(s=>s.node===resultsSection);
});
// Leon, 2026-11-05: finishing setup with nothing chosen still said "Your answers are now filters".
appCheck('real onboarding handlers: clicking through with no answers shows the no-answers done screen and no toast', (h) => {
  const {writes,applied,toasts,dialog,next,doneScreen}=realSetup(h,{shown:2915});
  for(let i=0;i<5;i++)next();
  const d=doneScreen();
  return dialog.open && applied.length===1 && toasts.length===0 && writes.length===1 && writes[0][1]==='completed'
    && d && d.heading===t('r3_ob_done_h_none') && d.count==='2,915 programmes shown' && d.text.includes(t('r5_ob_done_p_empty_wide')) && !d.text.includes(t('r3_ob_done_p_none'))
    && !d.text.includes(t('r2_answers_applied')) && d.focused;
});
// Was "onboarding completion toast uses the compact Edit action…": the toast is
// gone (the done screen says it), and r2_edit_short with it. The native maths
// half still stands.
check('setup ends with no toast and no Edit toast key; native maths shares the segmented label',
  !read('js/onboarding.js').includes('showToast') && !('r2_edit_short' in UI.en) && !('r2_edit_short' in UI.sk)
  && /value="" data-i18n="r2_any_maths"/.test(read('index.html')));


section('Review round 1 presentation regressions');
check('active fields cannot style nested panel searches or unset budget inputs',
  !cssRules.includes('.is-set .inp{') && cssRules.includes('.fld.is-set>.inp,.fld.is-set>.affix>.inp{')
  && cssRules.includes('.budget .fld.is-set>.affix>.inp{border-width:1px;border-color:var(--hairline);background:var(--panel)'));
check('invalid points keep the first filter row aligned; all buttons inherit the font and have press feedback',
  !/\.chipbox:has\(\[aria-invalid=true\]\)\{[^}]*margin-bottom/.test(cssRules)
  && cssRules.includes('button{font-family:inherit}') && cssRules.includes('.btn:active{transform:scale(.97)}'));
check('compact unknown cells use the same short wording and retain the phone/tablet labels', (()=>{
  const row=rowOf({...fxRow('fx-fee-blank'),ibPointsMin:null,deadline:null});
  return ['c-pts','c-ddl','c-fee'].every(name=>byClass(row,name)[0].textContent.includes('Not published'))
    && cssRules.includes('.row .v-unk .verd,.row .v-unk .fig{font-size:13px;font-weight:400;white-space:nowrap}')
    && cssRules.includes('@container (min-width: 800px){.row .v-unk .lab{display:none}}');
})());
check('compact cells lead with the value, deadline tiles hug their content, the fee figure omits the annual unit its label carries', (()=>{
  const row=rowOf(fxRow('fx-34'),fstate(36)),cell=byClass(row,'c-ddl')[0];
  return cell.children.findIndex(n=>n.className==='fig')<cell.children.findIndex(n=>n.className==='verd')
    && !byClass(byClass(row,'c-fee')[0],'fig')[0].textContent.includes('/ year')
    && cssRules.includes('justify-self:start;width:max-content;max-width:100%')
    && cssRules.includes('.row .c-ddl{flex-direction:column;align-items:flex-start;text-align:left}');
})());
appCheck('pane close clears the pick and restores its row button',({click,get,fire,flip,run,ids:[id]})=>{
  flip(true); click(id); fire(get('pane-close'),'click');
  return run('selectedId')===null && get('pane').textContent.includes('Pick a programme')
    && stubDocument.activeElement===get('results').querySelector('button.open');
});
check('phone help sits directly after its chip and opens inline; compact badge hides zero and no Budget info button remains',
  read('js/round2.js').includes("button.closest('.fld').after(tip)")
  && cssRules.includes('.sheet-b .tip{display:none;') && cssRules.includes('.sheet-b .tip.is-open{display:block}')
  && read('js/round2.js').includes("getElementById('compact-count').hidden = active === 0")
  && !read('index.html').includes('class="info budget-info"'));
// The 44 px hit areas themselves are measured in a real browser (smoke R3G).
check('the slider keeps its thin visual track inside the 44 px hit area',
  /::-webkit-slider-runnable-track\{height:4px/.test(cssRules));
check('status count can shrink at 320px, verdicts sit outside its sticky row and only the number is bold',withStubDocument(()=>{
  const node=new ChromeNode('p');renderCount(node,'2,915 programmes',[]);
  return byTag(node,'b')[0].textContent==='2,915' && node.textContent==='2,915 programmes'
    && cssRules.includes('.status .count{min-width:0;flex:1;')
    && read('index.html').indexOf('id="count-summary"')>read('index.html').indexOf('id="f-copy"');
}));
check('popover alignment uses its full layout width, never the opening animation scale',
  read('js/round2.js').includes('box.left + panel.offsetWidth') && !read('js/round2.js').includes('const box = panel.getBoundingClientRect()'));
check('facet counts report real full-dataset occurrences without adding to the option name', withStubDocument(()=>{
  const panel=new ChromeNode('div'),box=new ChromeNode('div');panel.setAttribute('aria-label','Country');panel.append(box);
  renderChips(box,['Ireland','Germany'],new Set(),()=>{},{counts:new Map([['Ireland',548],['Germany',61]])});
  return byClass(box,'option-count').map(n=>n.textContent).join() === '548,61'
    && byClass(box,'option-count').every(n=>n.getAttribute('aria-hidden')==='true');
}));
// This used to assert display:none on the wordmark, and that is what took the
// page's only h1 out of the accessibility tree below 700 px (batch 2, A2). What
// it looks like there is measured in a real browser (smoke R4B).
check('reviewed chrome keeps phone search short, the wordmark clipped but readable up to 700 px, heading columns aligned and FAQ icons sized',
  read('js/round2.js').includes("innerWidth >= 600 && longHintFits(dom.search) ? 'r2_searchph' : 'search_2'")
  && cssRules.includes('@media(min-width:600px) and (max-width:700px){.slot{width:36px}}')
  && !/\.mark h1\{[^}]*display:none/.test(cssRules)
  && /@media \(max-width:700px\)\{\s*\.mark h1\{position:absolute;width:1px;height:1px;[^}]*clip-path:inset\(50%\)/.test(cssRules)
  && !read('index.html').includes('data-sort="deadline" class="r"')
  && read('index.html').includes('data-i18n="r2_fee_heading"') && cssRules.includes('.row{gap:10px 12px;')
  && cssRules.includes('.faq summary>.ic{width:16px;height:16px;') && cssRules.includes('.foot{margin-top:48px}'));
// The old 1024-1199 rule also narrowed the points field and the row gap. What is
// left is measured in smoke R4C, which also proves the placeholder is not clipped.
check('only the maths buttons and closed facet chevrons tighten at 1024-1099 px, never the row gap or the points field',
  !cssRules.includes('(max-width:1199px)') && cssRules.includes('.frow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px}')
  && cssRules.includes('.fbar .more-filters{gap:8px}') && !cssRules.includes('.frow{gap:6px}')
  && cssRules.includes('.pts input.inp{width:68px;') && !cssRules.includes('.pts input.inp{width:64px}')
  && /@media \(min-width:1024px\) and \(max-width:1099\.98px\)\{\s*\.seg button\{padding:0 6px\}/.test(cssRules)
  && cssRules.includes('#budget-value:empty{display:none}'));
section('Review round 2 regressions');
// The bar's lists no longer hold their content with a ::details-content
// transition (Safari ignored it; round2.js holds [open] while closing), so
// nothing delays the content on opening either.
check('the facet panel is not still hidden when its toggle event focuses the search',
  !/(?:^|\})\s*\.dropdown(?:\[open\])?::details-content\{[^}]*transition:(?!none)/.test(cssRules)
  && /\.sheet-b \.dropdown\[open\]::details-content\{height:auto;transition:height/.test(cssRules));
check('radios never get a blank value from a panel Clear; the select stays the source of truth',
  read('js/round2.js').includes("input:not([type=range],[type=radio]),select") && read('js/round2.js').includes('input.checked = input.value === select.value'));
check('one wording for a verdict: rows, legend and status all say "V rámci tvojich IB bodov"', (()=>{
  const sk=Object.entries(UI.sk).filter(([k])=>k.startsWith('within_your_ib_points')).map(([,v])=>typeof v==='string'?v:'');
  return !Object.hasOwn(UI.en,'r2_within') && !Object.hasOwn(UI.sk,'r2_within')
    && UI.sk.within_your_ib_points==='V rámci tvojich IB bodov'
    && !JSON.stringify(UI.sk).includes('V dosahu tvojich') && !JSON.stringify(UI.sk).includes('v dosahu tvojich') && sk.length>0;
})());
check('"Typ titulu neznámy" stays whole; a compact verdict wraps at spaces only and balances',
  /\.unk-t\{[^}]*white-space:nowrap/.test(cssRules) && cssRules.includes('.row .cell{overflow-wrap:normal}') && cssRules.includes('.row .verd{text-wrap:balance}'));
check('a phone verdict list ends no line in a separator, in a span the phone can drop, with the text unchanged', withStubDocument(()=>{
  const node=new ChromeNode('p');renderCount(node,'',[{kind:'fit',text:'3 within'},{kind:'cond',text:'1 only'}]);
  return node.textContent==='3 within · 1 only' && byClass(node,'sep').length===1 && cssRules.includes('.count-summary .sep{display:none}');
}));
check('every programme count on the page is grouped (2,915), including the sheet button and the footer', (()=>{
  const app=read('js/app.js'),render=read('js/render.js');
  return app.includes("t('show', { value1: formatCount(shown)") && render.includes('${formatCount(rows.length)}') && i18n.formatCount(2915)==='2,915';
})());
check('the row label above a tile is out of flow, and only the phone/tablet layout shows it',
  cssRules.includes('.row .cell .lab{position:absolute;bottom:100%') && cssRules.includes('@container (min-width: 800px){.row .cell{margin-top:0}}'));
check('facet search keeps about seven and a half option rows, pointer autofocus and formatted budgets',
  cssRules.includes('.dropdown-panel>.options:has(.opt-q){max-height:356px}')
  && read('js/round2.js').includes("matchMedia('(pointer:fine)').matches")
  && read('js/round2.js').includes("new Intl.NumberFormat(getLanguage() === 'sk' ? 'sk-SK' : 'en-IE').format(amounts[0])"));
check('quiet degree labels use a real leading space; phone chevrons, switch, buttons and selects match the mockup',
  read('js/render.js').includes("heading.append(title, document.createTextNode(' '), degree)")
  && cssRules.includes('.unk-t{display:inline;padding:0;border:0;')
  && cssRules.includes('.deg{white-space:nowrap;margin-left:0;')
  && cssRules.includes('.ob .big-pts .btn{font-size:22px}') && cssRules.includes('.ob .switch{padding-left:0}')
  && cssRules.includes('.sheet-b .dropdown>summary .dd-chev{transform:rotate(-90deg)}')
  && cssRules.includes('.sheet-b .f-hl .switch>span{white-space:nowrap}')
  && cssRules.includes('.maths-control>select{border-color:var(--hairline);font-size:15px}')
  && read('index.html').includes('<use href="#i-filter"/></svg><span data-i18n="filters_2">'));
check('switch track (off) and slider thumb (unset) use the --edge-soft token; on/set states carry the accent instead',
  /--edge-soft:#[0-9a-f]{6}/i.test(css)
  && cssRules.includes('.switch input{appearance:none;width:34px;height:20px;border:1px solid var(--edge-soft);')
  && cssRules.includes('input[type=range]::-webkit-slider-thumb{appearance:none;width:20px;height:20px;margin-top:-8px;border-radius:50%;background:var(--panel);border:1px solid var(--edge-soft);')
  && cssRules.includes('input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:var(--panel);border:1px solid var(--edge-soft)}')
  && cssRules.includes('.switch input:checked{background:var(--accent);border-color:var(--accent)}')
  && cssRules.includes('input[type=range].set::-webkit-slider-thumb{border-color:var(--accent)}')
  && cssRules.includes('input[type=range].set::-moz-range-thumb{border-color:var(--accent)}')
  && !/\.switch input\{[^}]*var\(--edge\)/.test(cssRules)
  && !/slider-thumb\{[^}]*var\(--edge\)/.test(cssRules) && !/range-thumb\{[^}]*var\(--edge\)/.test(cssRules));
appCheck('Slovak subjects and degree types agree between onboarding, pane and facet labels',({get,fire,resultsSection})=>{
  i18n.setDataTranslations(csvToObjects(read('data/i18n/sk.csv')).rows); i18n.setLanguage('sk',{setItem(){}});
  try {
    const state=savedState.validateFilters({subjectAreas:['Engineering'],degreeTypes:['Bachelor']});
    const subject=new ChromeNode('div'),degree=new ChromeNode('div');
    renderChips(subject,['Engineering'],state.subjectAreas,()=>{},{field:'subject_area'});
    renderChips(degree,['Bachelor'],state.degreeTypes,()=>{},{field:'degree_type'});
    const subjectLabel=byClass(subject,'data-value')[0].textContent,degreeLabel=byClass(degree,'data-value')[0].textContent;
    renderPane({pane:get('pane'),heading:get('pane-h'),body:stubDocument.querySelector('.pane-body')},null,false,state);
    const pane=stubDocument.querySelector('.pane-body').textContent;
    const env={matchMedia:()=>({matches:false,addEventListener(){}}),document:stubDocument,t,facetLabel:i18n.facetLabel,dataValue:(field,value)=>{const n=new ChromeNode('span');n.textContent=i18n.dataParts(field,value).map(p=>p.text).join('');return n;},validateFilters:savedState.validateFilters,hasSetupAnswers:savedState.hasSetupAnswers,ONBOARDING_KEY:savedState.ONBOARDING_KEY,localStorage:{setItem(){}},syncSlider(){},showToast(){}};
    const setup=runInNewContext(read('js/onboarding.js').replace(/^import[^;]+;\n/gm,'').replace(/^export /gm,'')+'\nsetupOnboarding;',env);
    setup({state,facets:{subjectAreas:['Engineering'],countries:[],languages:[]},flags:{},apply(){},results:resultsSection,closeSheet(){},firstVisit:true});
    fire(get('onboarding').querySelector('.ob-foot .btn-p'),'click');fire(get('onboarding').querySelector('.ob-foot .btn-p'),'click');
    return subjectLabel!=='Engineering' && degreeLabel!=='Bachelor' && pane.includes(subjectLabel) && pane.includes(degreeLabel)
      && get('onboarding').querySelector('.chip').textContent===subjectLabel;
  } finally {i18n.setLanguage('en',{setItem(){}});i18n.setDataTranslations([]);}
});
check('Programme sort orders programme titles before university names in both directions',
  sortRows([{programme:'Zoology',university:'Alpha'},{programme:'Arts',university:'Zulu'}],'name')[0].programme==='Arts'
  && sortRows([{programme:'Zoology',university:'Alpha'},{programme:'Arts',university:'Zulu'}],'name','desc')[0].programme==='Zoology');

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
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
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
  equal('language defaults to English', i18n.initLanguage('', storage), 'en');
  storage.value = 'sk';
  equal('a stored Slovak choice still wins over the English default', i18n.initLanguage('', storage), 'sk');
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
    return detail.textContent.replace(/\u00a0/g, ' ').includes(' / 800 €') && !detail.textContent.includes('\u0000');
  }));
  UI.sk.your_month_replacing = replacingBefore;
  // Slovak reads "€1,000" as one euro (comma = decimal mark), so euros follow the language.
  equal('euros read "2 771 €" in Slovak and "€2,771" in English, one sign per range',
    ['sk', 'en'].map((lang) => i18n.inLanguage(lang, () => [compareMod.money.format(2771), compareMod.moneyRange(1000, 1500)].join(' | ').replace(/\u00a0/g, ' '))),
    ['2 771 € | 1 000–1 500 €', '€2,771 | €1,000–1,500']);
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

section('Batch 2 · A');
// batch 2 · A checks go here
// The app harness stubs wireCompactHeader and wireRound2, so code in them would
// never run there. These run the real functions on a small fake page.
const realRound2 = await import('../js/round2.js');
function withGlobals(globals, fn) {
  const saved = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try { return fn(); } finally {
    for (const [name, was] of saved) { if (was) Object.defineProperty(globalThis, name, was); else delete globalThis[name]; }
  }
}
const fakeObserver = class { observe() {} };
// Batch 3 C2: the logo and the phone tile ([data-home]) go home, then scroll
// to the top and focus the logo; `home` counts goHome() calls and `order`
// records what happened in which order.
function logoClick(init, { reduced = false, target = 'mark' } = {}) {
  const order = [];
  const fake = (extra = {}) => ({ listeners: {}, tabIndex: 0, style: { setProperty() {} }, classList: { toggle() {} }, contains: () => false,
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }, getBoundingClientRect: () => ({ height: 0, bottom: 0 }), ...extra });
  const doc = { activeElement: null };
  const mark = fake({ tabIndex: -1, focus(options) { doc.activeElement = mark; order.push(['focus', options]); } }), tile = fake();
  const header = fake({ querySelector: () => mark }), parts = { '.hd': header, '.fslot': fake(), '.cols': fake() };
  const scrolls = [], location = { hash: '', search: '?country=Ireland' };
  let home = 0;
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...init };
  withGlobals({
    document: Object.assign(doc, { querySelector: (s) => parts[s], querySelectorAll: (s) => (s === '[data-home]' ? [tile] : []), getElementById: () => fake(), body: fake(), addEventListener() {} }),
    window: { addEventListener() {} }, innerWidth: 1280, innerHeight: 900, ResizeObserver: fakeObserver, IntersectionObserver: fakeObserver,
    getComputedStyle: () => ({ display: 'none' }), requestAnimationFrame: () => 0, location, scrollTo: (options) => { scrolls.push(options); order.push(['scroll']); },
    matchMedia: (query) => ({ matches: reduced && query === '(prefers-reduced-motion: reduce)' }),
  }, () => {
    realRound2.wireCompactHeader({ status: fake(), points: fake(), shortlistOnly: fake() }, { goHome() { home++; order.push(['home']); } });
    for (const fn of (target === 'tile' ? tile : mark).listeners.click) fn(event);
  });
  return { prevented: event.prevented, scrolls, hash: location.hash, search: location.search, home, focused: doc.activeElement === mark, tabIndex: mark.tabIndex, order };
}
// Batch 3 C2: the name changes from "back to top" to going home, on both links.
check('the logo link has a translated name: below 700 px it would have none, the wordmark clipped and the tile aria-hidden',
  /<a class="mark" href="#top-marker" aria-label="University Finder, all programmes" data-i18n-attr="aria-label:r3_home_label">/.test(read('index.html'))
  && /<a class="home-tile" href="#top-marker" data-home aria-label="University Finder, all programmes" data-i18n-attr="aria-label:r3_home_label"><span class="mono" aria-hidden="true"><svg viewBox="0 0 36 36"><use href="#i-logo"\/><\/svg><\/span><\/a>/.test(read('index.html'))
  && UI.en.r3_home_label === 'University Finder, all programmes' && UI.sk.r3_home_label === 'University Finder, všetky programy'
  && !('r2_home_label' in UI.en) && !('r2_home_label' in UI.sk));
// Batch 3 C2 changed this: the click now also goes home (goHome, which the app
// harness checks below), and focus lands on the logo after the scroll starts.
for (const target of ['mark', 'tile']) equal(`a plain ${target === 'mark' ? 'logo' : 'phone home tile'} click goes home, scrolls to the top, focuses the logo and leaves the address alone, so #top-marker cannot reach a copied link`,
  logoClick({}, { target }), { prevented: true, scrolls: [{ top: 0, behavior: 'smooth' }], hash: '', search: '?country=Ireland', home: 1, focused: true, tabIndex: 0,
    order: [['home'], ['scroll'], ['focus', { preventScroll: true }]] });
equal('with reduced motion the logo scroll is instant',
  logoClick({}, { reduced: true }).scrolls, [{ top: 0, behavior: 'instant' }]);
check('a modified or middle click on the logo keeps the browser\'s own behaviour',
  [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }].every((init) => {
    const click = logoClick(init);
    return click.prevented === false && click.scrolls.length === 0 && click.home === 0 && !click.focused;
  }));

// ChromeNode's dataset is a read-only copy; the real radio builder writes to it.
class WiredNode extends ChromeNode {
  get dataset() {
    return new Proxy({}, { get: (_, name) => this.getAttribute(`data-${String(name).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined,
      set: (_, name, value) => { this.setAttribute(`data-${String(name).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value); return true; } });
  }
}
const noteCheck = (() => {
  const page = new WiredNode('div');
  const make = (id, className = '') => { const n = new WiredNode('div'); n.id = id; n.className = className; page.append(n); return n; };
  const select = (id, options) => {
    const n = make(id); n.setAttribute('aria-label', id); n.setAttribute('aria-describedby', 'f-unknown-help'); n.setAttribute('data-i18n-attr', 'aria-label:deadline');
    n.options = options.map(([value, i18n]) => ({ value, dataset: { i18n } }));
    return n;
  };
  for (const id of ['header-list', 'f-budget-help']) make(id);
  make('', 'budget-panel');
  const fakeDocument = { documentElement: {}, querySelectorAll: (s) => page.querySelectorAll(s), querySelector: (s) => page.querySelector(s),
    getElementById: (id) => page.querySelector(`#${id}`), createElement: (tag) => new WiredNode(tag), addEventListener() {} };
  const dom = { search: make('f-search'), points: make('f-points'), myMaths: make('f-mymaths'), dropdowns: [], sheet: make('filter-sheet'),
    deadline: select('f-deadline', [['any', 'any_date'], ['open', 'not_passed_yet'], ['30', 'within_30_days'], ['60', 'within_60_days']]),
    exam: select('f-exam', [['', 'any'], ['none', 'no_exam'], ['skippable', 'none_or_skippable']]),
    subjects: make('f-subjects'), countries: make('f-countries'), languages: make('f-languages'), degrees: make('f-degrees'), cities: make('f-cities') };
  return withGlobals({ document: fakeDocument, window: { addEventListener() {} }, innerWidth: 1280, ResizeObserver: fakeObserver, matchMedia: () => ({ matches: false }) }, () => {
    realRound2.wireRound2(dom);
    const note = page.querySelector('#f-deadline-open-note'), openRadio = page.querySelectorAll('input').find((n) => n.value === 'open');
    const result = { described: page.querySelectorAll('input').filter((n) => n.getAttribute('aria-describedby')).map((n) => `${n.name}=${n.value}`),
      points: openRadio.getAttribute('aria-describedby') === note.id, tag: note.tagName, beside: note.previousElementSibling === openRadio.parent && !openRadio.parent.contains(note), en: note.textContent };
    i18n.setLanguage('sk', { setItem() {} });
    try { i18n.applyLanguage(fakeDocument); result.sk = note.textContent; } finally { i18n.initLanguage('', { getItem: () => 'en' }); }
    return result;
  });
})();
equal('the Deadline note describes only "Not passed yet", beside its label so the name stays short, and follows the language', noteCheck, {
  described: ['f-deadline-radio=open'], points: true, tag: 'small', beside: true,
  en: 'Uses the recorded deadline dates. Programmes with no recorded date stay in the list.',
  sk: 'Riadi sa zaznamenanými termínmi. Programy bez zaznamenaného termínu zostávajú v zozname.' });
// Through the real parser, so "unknown" is what a blank or ? cell really becomes.
appCheck('"Not passed yet" follows recorded dates, as its note says: unknown and future stay, a past date goes even with rolling admission in its notes', ({ run, get, fire, drain, context }) => {
  context.deadlineRows = sheetsModule.readSheets(lintSheets().universities, lintCsv(lintProgHeader, [
    { ...lintProg, programme_id: 'd-blank', application_deadline: '' },
    { ...lintProg, programme_id: 'd-unknown', application_deadline: '?' },
    { ...lintProg, programme_id: 'd-future', application_deadline: '2099-01-15' },
    { ...lintProg, programme_id: 'd-past', application_deadline: '2020-01-15' },
    { ...lintProg, programme_id: 'd-rolling', application_deadline: '2020-01-15', deadline_notes: 'Rolling admission: applications stay open until places are full.' },
  ]), new Date()).programmes;
  run('allRows = deadlineRows; sourceMeta = { issues: [] }; facets = buildFacets(allRows); drawChips(); update();');
  drain();
  const shown = () => get('results').children.map((n) => n.dataset.id).sort().join();
  const any = shown();
  get('f-deadline').value = 'open'; fire(get('f-deadline'), 'change'); drain();
  const open = shown();
  get('f-deadline').value = 'any'; fire(get('f-deadline'), 'change'); drain();
  return any === 'd-blank,d-future,d-past,d-rolling,d-unknown' && open === 'd-blank,d-future,d-unknown' && shown() === any;
});

section('Batch 2 · B');
// Batch 2 B review: a failed list copy selects the link that failed, even if
// the list or the points tick changed while the clipboard was pending.
check('B1 failed list copy restores the snapshot link before selecting it',
  /catch \{[^}]*dom\.shareUrl\.value = url;\s*dom\.shareUrl\.select\(\);/.test(appSrc));
const { linkContents } = filtersMod;
check('B1 link contents covers all nine states, HL Maths and descending sort', (() => {
  const plain = createFilterState();
  const points = { ...plain, myIbPoints: 36 };
  const filtered = { ...plain, hlMaths: true };
  return linkContents(plain) === 'none' && linkContents({ ...plain, sort: 'name' }) === 'sort'
    && linkContents({ ...plain, dir: 'desc' }) === 'sort'
    && linkContents(points) === 'points' && linkContents(filtered) === 'filters'
    && linkContents({ ...filtered, myIbPoints: 36 }) === 'filters_points'
    && linkContents(plain, { shared: true }) === 'shared'
    && linkContents(points, { shared: true }) === 'shared_points'
    && linkContents(filtered, { shared: true }) === 'shared_filters'
    && linkContents({ ...filtered, myIbPoints: 36 }, { shared: true }) === 'shared_filters_points';
})());
check('B1 bare and ui-only links restore recipient filters; sort links use URL defaults', (() => {
  const stored = { version: 1, filters: { countries: ['Ireland'] } };
  return ['', '?ui=sk'].every((q) => {
    const r = savedState.restoration(q, stored);
    return r.source === 'saved' && r.state.countries.has('Ireland');
  }) && (() => { const r = savedState.restoration('?sort=name', stored); return r.source === 'url' && !r.state.countries.size; })();
})());
await asyncAppCheck('B1 each of the nine actual copy results describes its URL, without a hash', async ({run,get,fire,settle,context,clipboard}) => {
  context.location.origin = 'http://localhost:8765'; context.location.hash = '#top-marker';
  const messages = []; context.showToast = message => messages.push(message);
  // The exact address, not just "has a list=": the fixture's shared list once
  // had no raw value, so the copied link said list=undefined and still passed.
  // raw is copied as the address had it, two ids and their comma included.
  const list = run('fixture[0].id + "," + fixture[1].id');
  for (const [kind, shared, points, filters, sort, query] of [
    ['none',false,false,false,false,''],['sort',false,false,false,true,'?sort=name'],
    ['filters',false,false,true,false,'?q=biology'],['points',false,true,false,false,'?points=36&sort=best'],['filters_points',false,true,true,false,'?q=biology&points=36&sort=best'],
    ['shared',true,false,false,false,`?list=${list}`],['shared_filters',true,false,true,false,`?list=${list}&q=biology`],
    ['shared_points',true,true,false,false,`?list=${list}&points=36&sort=best`],['shared_filters_points',true,true,true,false,`?list=${list}&q=biology&points=36&sort=best`]
  ]) {
    context.copyCase = {shared,points,filters,sort};
    run("Object.assign(state, createFilterState()); shared = copyCase.shared ? {raw:fixture[0].id+','+fixture[1].id,ids:[fixture[0].id,fixture[1].id],unknown:[]} : null; state.shortlistOnly = !!shared; state.sort = copyCase.sort ? 'name' : 'deadline'; dom.points.value = copyCase.points ? '36' : ''; dom.search.value = copyCase.filters ? 'biology' : ''; update();");
    fire(get('f-copy'),'click'); await settle();
    const url = clipboard.written.at(-1);
    if(messages.at(-1)!==t('r2_copied_'+kind) || url !== `http://localhost:8765/${query}`) return false;
  }
  return messages.length===9;
});
await asyncAppCheck('B1 pending copies keep their snapshot, including language, success and rejection', async ({ run, get, fire, settle, context }) => {
  context.location.origin = 'http://localhost:8765';
  const messages = []; context.showToast = (message) => messages.push(message);
  for (const reject of [false, true]) {
    run("state.countries = new Set(['Ireland']); dom.points.value = ''; dom.search.value = ''; switchLanguage('en');");
    let done; let url;
    context.navigator.clipboard = { writeText(value) { url = value; return new Promise((resolve, fail) => { done = reject ? fail : resolve; }); } };
    fire(get('f-copy'), 'click');
    run("dom.points.value = '36'; dom.search.value = 'law'; switchLanguage('sk');");
    done(); await settle();
    if (!url.includes('country=Ireland') || /points=|q=|#/.test(url) || messages.at(-1) !== UI.en[reject ? 'r2_copy_failed_desktop' : 'r2_copied_filters']) return false;
  }
  return true;
});
await asyncAppCheck('B1 sheet status repeats once and clears on every close route, language change and widening', async ({ run, get, fire, settle, flushFrame, advance, flip600, context }) => {
  context.location.origin = 'http://localhost:8765';
  const messages = []; context.showToast = (message) => messages.push(message);
  const sheet = get('filter-sheet'), status = get('f-copy-status');
  for (const close of ['done', 'apply', 'escape', 'backdrop', 'language', 'widen']) {
    flip600(false); fire(get('f-more'), 'click');
    for (let i = 0; i < 2; i++) {
      fire(get('f-copy'), 'click'); await settle();
      if (status.textContent !== '') return false;
      flushFrame(); if (status.textContent !== t('r2_copied_none') || messages.length) return false;
    }
    if (close === 'done') fire(get('sheet-done'), 'click');
    if (close === 'apply') fire(get('sheet-show'), 'click');
    if (close === 'escape') { sheet.close(); }
    if (close === 'backdrop') fire(get('sheet-scrim'), 'click');
    if (close === 'language') run("switchLanguage('sk');");
    if (close === 'widen') flip600(true);
    advance(0); flushFrame();
    if (status.textContent !== '' || sheet.open) return false;
    run("switchLanguage('en');");
  }
  fire(get('f-more'), 'click');
  let done; context.navigator.clipboard = { writeText: () => new Promise((resolve) => { done = resolve; }) };
  fire(get('f-copy'), 'click'); fire(get('sheet-done'), 'click'); advance(0); done(); await settle(); flushFrame();
  if (!(status.textContent === '' && messages.length === 1 && messages[0] === t('r2_copied_none'))) return false;
  // A rejection that settles after the sheet closed says the desktop failure, not "close Filters".
  fire(get('f-more'), 'click');
  let fail; context.navigator.clipboard = { writeText: () => new Promise((_, reject) => { fail = reject; }) };
  fire(get('f-copy'), 'click'); fire(get('sheet-done'), 'click'); advance(0); fail(new Error('denied')); await settle(); flushFrame();
  return status.textContent === '' && messages.length === 2 && messages[1] === t('r2_copy_failed_desktop');
});
await asyncAppCheck('B1 sheet missing clipboard and rejection show only the sheet failure', async ({ run, get, fire, settle, flushFrame, clipboard, context }) => {
  context.location.origin = 'http://localhost:8765';
  const messages = []; context.showToast = (message) => messages.push(message);
  fire(get('f-more'), 'click');
  for (const api of [clipboard, undefined]) {
    clipboard.mode = 'reject'; context.navigator.clipboard = api;
    fire(get('f-copy'), 'click'); await settle(); flushFrame();
    if (get('f-copy-status').textContent !== t('r2_copy_failed_sheet')) return false;
  }
  return messages.length === 0;
});
await asyncAppCheck('B1 list share uses EN and SK plurals, points opt-in, failure selection and pending snapshots', async ({ run, get, fire, settle, context }) => {
  const messages = []; context.showToast = (message) => messages.push(message);
  get('ml-share-url').select = () => { context.linkSelected = true; };
  run('allRows = live.slice(0, 5);');
  const button = get('ml-share-copy'), label = button.textContent;
  for (const ui of ['en', 'sk']) for (const count of [1, 2, 3, 4, 5]) for (const points of [false, true]) {
    context.n = count; context.ui = ui; context.points = points;
    run("switchLanguage(ui); shortlist.clear(); allRows.slice(0,n).forEach(r => shortlist.add(r.id)); dom.points.value = '36'; readFields(); dom.sharePoints.checked = points; update();");
    fire(button, 'click'); await settle();
    if (messages.at(-1) !== t(count === 1 ? (points ? 'r2_list_copied_points_one' : 'r2_list_copied_one') : (points ? 'r2_list_copied_points' : 'r2_list_copied'), { count })) return false;
  }
  run("switchLanguage('en'); shortlist.clear(); allRows.slice(0,3).forEach(r => shortlist.add(r.id)); dom.sharePoints.checked = true;");
  let done; let url;
  context.navigator.clipboard = { writeText(value) { url = value; return new Promise((resolve) => { done = resolve; }); } };
  fire(button, 'click');
  run('shortlist.clear(); dom.sharePoints.checked = false;'); done(); await settle();
  if (!url.includes('points=36') || messages.at(-1) !== t('r2_list_copied_points', { count: 3 })) return false;
  context.navigator.clipboard = undefined; fire(button, 'click'); await settle();
  return context.linkSelected && messages.at(-1) === t('r2_copy_failed_list') && button.textContent === label;
});
appCheck('B1 shared help and copy names stay truthful in EN and SK', ({ run, get, ids: [a] }) => {
  // The shared harness strips translation attributes for legacy source checks.
  const original = parseHtml(read('index.html'));
  for (const id of ['f-copy', 'ml-share-help']) for (const attr of ['data-i18n', 'data-i18n-attr']) {
    const value = original.querySelector('#' + id).getAttribute(attr);
    if (value) get(id).setAttribute(attr, value);
  }
  for (const cls of ['copy-long', 'copy-short']) get('f-copy').querySelector('.' + cls).setAttribute('data-i18n', original.querySelector('.' + cls).getAttribute('data-i18n'));
  for (const language of ['en', 'sk']) {
    run(`switchLanguage('${language}'); shared = null; renderListBar();`);
    if (get('f-copy-help').textContent !== t('r2_copy_help')) return false;
    run(`shared = { ids: ['${a}'], unknown: [] }; state.shortlistOnly = true; update();`);
    if (get('f-copy-help').textContent !== t('r2_copy_help_shared')) return false;
    const name = get('f-copy').getAttribute('aria-label');
    if (!name.includes(get('f-copy').querySelector('.copy-long').textContent)
      || !name.toLowerCase().includes(t('copy_link').toLowerCase()) || get('ml-share-help').textContent !== t('r2_share_help')) return false;
  }
  return true;
});
check('B1 tablet Share panel anchors within its toolbar only at 600–1023 px', (() => {
  const rules = cssTree(cssRules);
  const tablet = '@media(min-width:600px) and (max-width:1023.98px)';
  const contains = (selector, declarations) => rules.some(r => r.selector === selector
    && r.media.length === 1 && r.media[0] === tablet && declarations.every(d => r.body.includes(d)));
  return contains('.ml-tools', ['position:relative']) && contains('#ml-share', ['position:static'])
    && contains('#ml-share>.ml-panel', ['left:auto', 'right:0', 'top:auto'])
    && rules.filter(r => r.selector === '#ml-share>.ml-panel').every(r => r.media[0] === tablet);
})());
i18n.initLanguage('', { getItem: () => 'en' });


section('Batch 2 · C');
// Verifier finding: the 44 px centred action block also printed; print keeps a plain left-aligned link.
check('C1 print resets the detail actions to a plain left-aligned link',
  /@media print\{\.d-actions\{display:block\}\.d-actions \.btn\{min-height:0;text-align:left\}\}/.test(cssText));
{
  const row = { ...live[0], studentLifeUrl: 'https://example.org/life', isChecked: true,
    lastVerified: new Date('2026-08-14'), verifiedBy: 'Fixture' };
  // Batch 3 · A: the detail also carries the compare button (Leon's compare
  // icon on every programme), so the actions are official, save, compare.
  const detail = withStubDocument(() => renderDetail(row, noFilters(), { saved: false, inCompare: false }));
  const foot = byClass(detail, 'd-foot')[0], actions = byClass(foot, 'd-actions')[0];
  equal('C1 actions contain official, then save, then compare', actions.children.map((n) => [n.tagName, n.className]),
    [['a', 'btn btn-p'], ['button', 'btn save'], ['button', 'btn cmpb']]);
  check('C1 Student life and provenance stay outside actions',
    actions.parent === foot && byClass(foot, 'lnk')[0]?.parent === foot && byClass(foot, 'ok')[0]?.parent === foot);
  const solo = withStubDocument(() => renderDetail({ ...row, officialUrl: null }, noFilters(), { saved: false }));
  equal('C1 no official URL leaves one action', byClass(solo, 'd-actions')[0]?.childElementCount, 1);
  check('C1 actions use equal grid tracks and 10px gap',
    /\.d-actions\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,15rem\),1fr\)\);gap:10px/.test(read('css/styles.css')));
}
appCheck('C2 second wide activation focuses the pane without navigation; narrow still toggles', ({ run, flip, click, pane, context, ids: [a] }) => {
  let opened = false, changed = false;
  context.window.open = () => { opened = true; };
  context.history.replaceState = () => { changed = true; };
  const href = context.location.href;
  flip(true); click(a);
  if (run('selectedId') !== a || stubDocument.activeElement === pane) return false;
  changed = false;
  click(a);
  if (stubDocument.activeElement !== pane || run('selectedId') !== a || opened || changed || context.location.href !== href) return false;
  flip(false);
  // Crossing reopens the selected row inline; close it before the two-click pair.
  click(a); click(a);
  if (!run('openIds.has(fixture[0].id)')) return false;
  click(a);
  return !run('openIds.has(fixture[0].id)');
});
{
  const czech = live.find((r) => r.country === 'Czechia' && r.languages.includes('Czech') && r.tuitionEu === 0);
  for (const lang of ['en', 'sk']) {
    i18n.initLanguage('', { getItem: () => lang });
    const note = t('r2_czech_free');
    check('C3 free Czech detail note is in Language (' + lang + ')',
      kvOf(detailOf(czech))[t('language')]?.textContent.includes(note));
    for (const [name, row] of [
      ['English taught', { ...czech, languages: ['English'] }],
      ['paid', { ...czech, tuitionEu: 2000 }],
      ['non-Czech', { ...czech, country: 'Austria' }],
    ]) {
      const detail = detailOf(row);
      check('C3 no note for ' + name + ' (' + lang + ')', !detail.textContent.includes(note));
      check('C3 note-free detail keeps the fee wording guard (' + name + ', ' + lang + ')',
        !/Tuition \(EU\)|no tuition fee/.test(detail.textContent));
    }
  }
  i18n.initLanguage('', { getItem: () => 'en' });
  for (const [name, fee, defaultFee, expected] of [
    ['inherited zero', '', '0', true], ['explicit zero', '0', '2000', true],
    ['unknown override', '?', '0', false], ['blank unknown', '', '', false],
    ['question unknown', '', '?', false], ['positive override', '2000', '0', false],
  ]) {
    const uni = 'university_id,name,city,country,tuition_eu_default,verified_by\nfx,Fixture,Prague,Czechia,' + defaultFee + ',AI-DRAFT\n';
    const prog = 'programme_id,university_id,programme,language,tuition_eu,application_deadline,official_url,verified_by\np,fx,Fixture,Czech,' + fee + ',,https://example.org,AI-DRAFT\n';
    const { programmes } = await load(uni, prog);
    equal('C3 parser-to-render ' + name, detailOf(programmes[0]).textContent.includes(t('r2_czech_free')), expected);
  }
}

section('Batch 2 follow-up');
// At 600–700 px the compact Filters button (87–120 px) sat in the 36/44 px logo
// slot, so Search covered it ("Fil…", right part unclickable). It shows its icon
// alone there, filling the slot; the label stays for screen readers and the count
// moves to the corner. smoke.mjs measures it in Chrome.
check('F1 compact Filters at 600–700 px is icon-only, fills the slot, label kept for screen readers, count on the corner',
  /@media \(min-width:600px\) and \(max-width:700px\)\{\s*\.filters-btn\{width:100%;padding:0\}\s*\.filters-btn>span:not\(\.badge\)\{[^}]*clip-path:inset\(50%\)[^}]*\}\s*\.filters-btn>\.badge\{position:absolute;[^}]*\}/.test(cssText)
  && /<button class="btn filters-btn" id="compact-filters"[^>]*><svg class="ic" aria-hidden="true">[^]*?<span data-i18n="filters_2">Filters<\/span><span id="compact-count" class="badge">/.test(read('index.html')));
// "Podľa univerzity" was clipped in the 112 px living-costs field (Leon chose
// "Podľa školy", 2026-11-05). English keeps "University's".
check('F2 Slovak living-costs placeholder is "Podľa školy" (smoke F2 measures the fit)',
  UI.sk.university_s === 'Podľa školy' && UI.en.university_s === "University's"
  && /id="f-living"[^>]*data-i18n-attr="placeholder:university_s"/.test(read('index.html')));
check('F3 the unused .dd-help rule stays removed', !/\.dd-help\b/.test(cssText));

section('Batch 3 · A');
// Compare is its own set of up to four programmes, apart from My list (Leon,
// 2026-11-05). js/compare-set.js holds it; app.js keeps it in step.
{
  const { toggleIn, restoreAt, normalizeCompare, readStoredCompare, saveCompare, loadCompare, COMPARE_KEY } = compareSetMod;
  const known = new Set(['a', 'b', 'c', 'd', 'e']);
  equal('A1 toggleIn: add, add last, remove, re-add goes last',
    [toggleIn([], 'a', known), toggleIn(['a'], 'b', known), toggleIn(['a', 'b'], 'a', known), toggleIn(['b'], 'a', known)],
    [{ ids: ['a'], result: 'added' }, { ids: ['a', 'b'], result: 'added' }, { ids: ['b'], result: 'removed' }, { ids: ['b', 'a'], result: 'added' }]);
  equal('A1 toggleIn: a fifth is refused and the set is unchanged; one in the set still comes out',
    [toggleIn(['a', 'b', 'c', 'd'], 'e', known), toggleIn(['a', 'b', 'c', 'd'], 'c', known)],
    [{ ids: ['a', 'b', 'c', 'd'], result: 'full' }, { ids: ['a', 'b', 'd'], result: 'removed' }]);
  equal('A1 toggleIn: ids no longer in the data do not count toward four',
    toggleIn(['gone', 'a', 'b', 'c'], 'd', known), { ids: ['gone', 'a', 'b', 'c', 'd'], result: 'added' });
  equal('A1 restoreAt: back at its old index; refused when full; already there is unchanged, never doubled or moved',
    [restoreAt(['a', 'c'], 'b', 1, known), restoreAt(['a', 'b', 'c', 'd'], 'e', 0, known), restoreAt(['b', 'a'], 'a', 0, known), restoreAt(['a'], 'b', 9, known)],
    [{ ids: ['a', 'b', 'c'], result: 'restored' }, { ids: ['a', 'b', 'c', 'd'], result: 'full' }, { ids: ['b', 'a'], result: 'restored' }, { ids: ['a', 'b'], result: 'restored' }]);
  equal('A1 normalizeCompare: duplicates go, the first four known stay in order, unknown ids are kept, a reappearing fifth is dropped',
    [normalizeCompare(['a', 'a', 'b'], known), normalizeCompare(['a', 'x', 'b', 'c', 'd', 'e'], known), normalizeCompare(['x', 'a', 'b', 'c', 'd'], new Set([...known, 'x']))],
    [['a', 'b'], ['a', 'x', 'b', 'c', 'd'], ['x', 'a', 'b', 'c']]);
  const store = (text) => fakeStorage(text === undefined ? {} : { [COMPARE_KEY]: text });
  const blocked = Object.assign(fakeStorage(), { blocked: true });
  equal('A1 storage reads: missing, corrupt, not a list and blocked',
    [readStoredCompare(store()), readStoredCompare(store('{oops')), readStoredCompare(store('{"a":1}')), readStoredCompare(blocked), loadCompare(blocked)],
    [[], [], [], null, []]);
  equal('A1 storage reads keep string ids once each, in stored order', readStoredCompare(store('["b",1,"a","b",null]')), ['b', 'a']);
  const full = Object.assign(fakeStorage(), { full: true }), ok = fakeStorage();
  check('A1 saveCompare reports a failed write and writes JSON otherwise',
    saveCompare(['a'], full) === false && saveCompare(['a', 'b'], ok) === true && ok.data[COMPARE_KEY] === '["a","b"]');
  check('A1 the compare key is its own, never the saves\' key', COMPARE_KEY === 'ib-university-finder:compare:v1' && COMPARE_KEY !== shortlistMod.SHORTLIST_KEY);
}
const cmpStored = (context) => JSON.parse(context.compareStorage.data[compareSetMod.COMPARE_KEY] ?? 'null');
const cmpToggle = (run, id) => run(`changeCompare((ids) => toggleIn(ids, ${JSON.stringify(id)}, knownIds()))`);
{
  const rows = live.slice(0, 3);
  const make = (lang) => { i18n.initLanguage('', { getItem: () => lang }); return withStubDocument(() => { const ul = new ChromeNode('ul'); renderRows(ul, rows, { state: noFilters(), compare: new Set([rows[0].id]) }); return ul; }); };
  for (const lang of ['en', 'sk']) {
    const ul = make(lang);
    const toggles = ul.children.map((li) => li.querySelector('button.cmpi'));
    const main = ul.children[0].querySelector('.r-main');
    const kids = main.children.filter((n) => typeof n !== 'string');
    const name = toggles[0].querySelector('.visually-hidden').textContent;
    check(`A2 rows: the compare toggle is pressed with the filled-pan symbol only for a programme in Compare, and comes before the star (${lang})`,
      toggles[0].getAttribute('aria-pressed') === 'true' && toggles[0].querySelector('use').getAttribute('href') === '#i-compare-on'
      && toggles[1].getAttribute('aria-pressed') === 'false' && toggles[1].querySelector('use').getAttribute('href') === '#i-compare'
      && toggles.every((b, i) => b.type === 'button' && b.getAttribute('data-compare-id') === rows[i].id && !b.disabled)
      && kids.indexOf(toggles[0]) === kids.length - 2 && kids.at(-1).classList.contains('star'));
    check(`A2 rows: the toggle is named by the programme and its university (${lang})`,
      name === t('r3_cmp_add_label', { programme: rows[0].programme, university: rows[0].university })
      && name.includes(rows[0].programme) && name.includes(rows[0].university) && name.startsWith(lang === 'sk' ? 'Pridať' : 'Add'));
  }
  i18n.initLanguage('', { getItem: () => 'en' });
  const solo = withStubDocument(() => renderDetail({ ...rows[0], officialUrl: null }, noFilters(), { saved: true, inCompare: true }));
  const pair = byClass(solo, 'd-actions')[0].children;
  check('A2 detail without an official link: Save and Compare are the pair, Compare says "In compare" with its symbol',
    pair.length === 2 && pair[0].classList.contains('save') && pair[1].classList.contains('cmpb') && pair[1].getAttribute('aria-pressed') === 'true'
    && pair[1].querySelector('.cmpb-w').textContent === 'In compare' && pair[1].querySelector('use').getAttribute('href') === '#i-compare-on'
    && pair[1].textContent.endsWith(`: ${rows[0].programme}, ${rows[0].university}`));
  const none = withStubDocument(() => renderDetail(rows[0], noFilters()));
  check('A2 a detail drawn without inCompare has no compare button (the print and CSV paths)', !byClass(none, 'cmpb').length);
  check('A2 CSS: the toggle sits in column 2 beside the star in column 3; the official link spans the detail pair',
    /\.r-main\{grid-template-columns:minmax\(0,1fr\) auto auto;/.test(cssText) && /\.r-main>\.cmpi\{grid-column:2;grid-row:1\/span 2\}/.test(cssText)
    && /\.r-main>\.star\{grid-column:3\}/.test(cssText) && /\.d-actions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\s*\.d-actions>a\.btn-p\{grid-column:1\/-1\}/.test(cssText)
    && /<symbol id="i-compare" /.test(indexHtml) && /<symbol id="i-compare-on" /.test(indexHtml));
}
check('A2 both row actions retain 44 px targets with a mouse as well as touch',
  /\.r-main>:(?:is|where)\(\.cmpi,\.star\)\{min-width:44px;min-height:44px\}/.test(cssText));
const cmpOf = (node) => node.querySelector('button[data-compare-id]');
appCheck('A2 a compare click toggles the row, its open slot and the pane together, and never opens or selects a row', ({ run, get, click, flip, item, fire, pane, ids: [a, b] }) => {
  click(b);
  const before = [run('selectedId'), run('[...openIds].join()')].join('|');
  fire(cmpOf(item(a)), 'click');
  if ([run('selectedId'), run('[...openIds].join()')].join('|') !== before || item(a).querySelector('.expand')) return false;
  if (cmpOf(item(a)).getAttribute('aria-pressed') !== 'true' || run('compareIds.join()') !== a) return false;
  const slotButton = item(b).querySelector('.expand button.cmpb');
  if (!slotButton || slotButton.getAttribute('aria-pressed') !== 'false') return false;
  fire(slotButton, 'click');
  if (cmpOf(item(b)).getAttribute('aria-pressed') !== 'true' || slotButton.querySelector('.cmpb-w').textContent !== 'In compare' || run('selectedId') !== b) return false;
  flip(true);
  const paneButton = pane.querySelector('button.cmpb');
  if (!paneButton || paneButton.getAttribute('aria-pressed') !== 'true') return false;
  fire(paneButton, 'click');
  return cmpOf(item(b)).getAttribute('aria-pressed') === 'false' && cmpOf(item(b)).querySelector('use').getAttribute('href') === '#i-compare'
    && paneButton.getAttribute('aria-pressed') === 'false' && run('compareIds.join()') === a && run('selectedId') === b;
});
appCheck('A2 programmes already in Compare draw pressed: a slot opened later, the pane, and rows that arrive after the first screen', ({ run, get, click, flip, item, pane, drain, context }) => {
  const late = context.live[70].id, early = context.live[1].id;
  run(`allRows = live.slice(0, 120); compareIds = [${JSON.stringify(late)}, ${JSON.stringify(early)}]; update();`);
  if (item(late)) return false;
  run(`mountRow(${JSON.stringify(late)}); mountRow(${JSON.stringify(context.live[2].id)});`);
  // Focus-pinning keeps the late row mounted while the early one arrives.
  run(`mountRow(${JSON.stringify(late)}).querySelector('button.open').focus(); mountRow(${JSON.stringify(context.live[2].id)});`);
  if (cmpOf(item(late))?.getAttribute('aria-pressed') !== 'true' || cmpOf(item(context.live[2].id)).getAttribute('aria-pressed') !== 'false') return false;
  click(early);
  if (item(early).querySelector('.expand button.cmpb')?.getAttribute('aria-pressed') !== 'true') return false;
  flip(true);
  return pane.querySelector('button.cmpb')?.getAttribute('aria-pressed') === 'true';
});
const cmpCols = (get) => findAll(get('cmp-body'), (n) => n.tagName === 'th' && n.getAttribute('scope') === 'col');
const cmpColIds = (get) => cmpCols(get).map((th) => th.getAttribute('data-id'));
const cmpX = (get, id) => get('cmp-body').querySelector(`[data-compare-remove="${id}"]`);
const cmpSave = (get, id) => get('cmp-body').querySelector(`th [data-save-id="${id}"]`);
// Seeds this tab and its storage alike: every change re-reads storage first.
const cmpSet = (ids) => `compareIds = ${JSON.stringify(ids)}; saveCompare(compareIds);`;
appCheck('A3 three columns: "x" on the middle one leaves two with focus on the new middle "x" and an Undo toast; Undo puts it back in its place', ({ run, get, fire, context, ids: [a, b, c] }) => {
  run(`${cmpSet([a, b, c])} update(); openCompare(null);`);
  if (cmpColIds(get).join() !== [a, b, c].join()) return false;
  const x = cmpX(get, b); x.focus(); fire(x, 'click');
  const toast = context.toasts.at(-1);
  if (cmpColIds(get).join() !== [a, c].join() || stubDocument.activeElement !== cmpX(get, c) || toast.message !== 'Removed from compare.' || toast.label !== 'Undo'
    || cmpStored(context).join() !== [a, c].join() || get('compare').hidden) return false;
  toast.action();
  return cmpColIds(get).join() === [a, b, c].join() && stubDocument.activeElement === cmpX(get, b) && cmpStored(context).join() === [a, b, c].join();
});
appCheck('A3 a column "x" pressed from the keyboard (click detail 0) asks the toast to move focus to Undo; a pointer click does not', ({ run, get, fire, context, ids: [a, b, c] }) => {
  run(`${cmpSet([a, b, c])} update(); openCompare(null);`);
  fire(cmpX(get, b), 'click', { detail: 0 });
  if (context.toasts.at(-1).options?.focusAction !== true) return false;
  fire(cmpX(get, a), 'click', { detail: 1 });
  return context.toasts.at(-1).options?.focusAction === false;
});
appCheck('A3 Undo after two removals puts the programme back before the ones that came after it', ({ run, get, fire, context, ids: [a, b, c] }) => {
  context.fixture.push(...context.live.slice(1, 2));
  const d = context.fixture[3].id;
  run(`allRows = fixture; ${cmpSet([a, b, c, d])} update(); openCompare(null);`);
  fire(cmpX(get, b), 'click');
  const undoB = context.toasts.at(-1).action;
  fire(cmpX(get, a), 'click');
  undoB();
  return cmpColIds(get).join() === [b, c, d].join() && cmpStored(context).join() === [b, c, d].join();
});
appCheck('A3 two, one, none: one column asks for another and hides "Show only differences"; none is the empty state with focus on Browse, which closes the view', ({ run, get, fire, ids: [a, b] }) => {
  run(`${cmpSet([a, b])} update(); openCompare(null);`);
  cmpX(get, b).focus(); fire(cmpX(get, b), 'click');
  if (cmpColIds(get).join() !== a || get('cmp-one').hidden || !get('cmp-diff-label').hidden || get('compare').hidden
    || get('cmp-h').textContent !== 'Compare 1 programme' || stubDocument.activeElement !== cmpX(get, a)) return false;
  cmpX(get, a).focus(); fire(cmpX(get, a), 'click');
  if (cmpCols(get).length !== 0 || get('cmp-empty').hidden || !get('cmp-one').hidden || stubDocument.activeElement !== get('cmp-browse') || get('compare').hidden) return false;
  fire(get('cmp-browse'), 'click');
  return get('compare').hidden && !get('results').parent.parent.parent.hidden;
});
appCheck('A3 a column\'s Save toggles the saves with the row star both ways, in place: focus and the hidden bar stay, Compare never changes', ({ run, get, fire, item, ids: [a, b] }) => {
  run(`${cmpSet([a, b])} update(); openCompare(null);`);
  const save = cmpSave(get, a); save.focus(); fire(save, 'click');
  if (save.getAttribute('aria-pressed') !== 'true' || save.querySelector('.save-s').textContent !== 'Saved' || cmpSave(get, a) !== save
    || stubDocument.activeElement !== save || !get('shortlist-bar').hidden || starOf(item(a)).getAttribute('aria-pressed') !== 'true'
    || run('compareIds.join()') !== [a, b].join()) return false;
  fire(starOf(item(a)), 'click');
  return save.getAttribute('aria-pressed') === 'false' && save.querySelector('.save-s').textContent === 'Save' && run('shortlist.size') === 0
    && run('compareIds.join()') === [a, b].join() && !get('compare').hidden;
});
appCheck('A3 redraws keep focus and the sideways scroll: a filter (columns come from all programmes), another tab dropping the focused column, the language', ({ run, get, fireWindow, context, ids: [a, b, c] }) => {
  run(`${cmpSet([a, b, c])} update(); openCompare(null);`);
  get('cmp-body').querySelector('.cmp-scroll').scrollLeft = 120;
  cmpSave(get, b).focus();
  run("state.search = 'zzzz-no-match'; update();");
  if (cmpColIds(get).join() !== [a, b, c].join() || stubDocument.activeElement !== cmpSave(get, b) || get('cmp-body').querySelector('.cmp-scroll').scrollLeft !== 120) return false;
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([a, c]);
  fireWindow('storage', { key: compareSetMod.COMPARE_KEY });
  if (cmpColIds(get).join() !== [a, c].join() || stubDocument.activeElement !== cmpX(get, c)) return false;
  run("switchLanguage('sk');");
  const ok = stubDocument.activeElement === cmpX(get, c) && get('cmp-body').querySelector('.cmp-scroll').scrollLeft === 120
    && get('cmp-h').textContent === 'Porovnať 2 programy' && cmpSave(get, a).querySelector('.save-s').textContent === 'Uložiť';
  run("switchLanguage('en');");
  return ok;
});
i18n.initLanguage('', { getItem: () => 'en' });
appCheck('A3 a passed deadline stays in Compare, with its label, while the list filters it out', ({ run, get, context, ids: [a] }) => {
  context.past = { ...context.fixture[0], id: 'past-fixture', deadline: new Date('2026-01-15'), deadlinePassed: true, daysUntilDeadline: -30, isUrgent: false };
  run(`allRows = [...fixture, past]; ${cmpSet(['past-fixture', a])} state.deadlineWindow = 'open'; update(); openCompare(null);`);
  const deadline = findAll(get('cmp-body'), (n) => n.getAttribute('data-fact') === 'deadline')[0];
  return !run("shownRows.has('past-fixture')") && cmpColIds(get).join() === ['past-fixture', a].join()
    && deadline.children[1].textContent.includes('Passed, check next cycle');
});
appCheck('A3 closeCompare(false) hides the view and moves neither focus nor the page', ({ run, get, context, ids: [a] }) => {
  run(`${cmpSet([a])} update(); openCompare(null);`);
  context.window.scrollY = 500;
  const log = stubDocument.focusLog.length, active = stubDocument.activeElement;
  run('closeCompare(false);');
  return get('compare').hidden && stubDocument.focusLog.length === log && stubDocument.activeElement === active && context.window.scrollY === 500;
});
await asyncAppCheck('A3 a shared list stays open, with ?list= in the address, after Compare closes', async ({ run, get, fire, context, settle }) => {
  const [a, b] = [context.fixture[0].id, context.fixture[1].id];
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
  context.location.search = `?list=${a}`;
  run('applyUrlFields();');
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  run(`${cmpSet([b])} openCompare(null); state.search = 'x'; update();`);
  fire(get('cmp-close'), 'click');
  return run('state.shortlistOnly') === true && run('shared') !== null && !get('shortlist-bar').hidden && get('ml-title').textContent === 'Shared list'
    && urls.length > 0 && urls.every((u) => u.startsWith(`/?list=${a}`));
}, { boot: true });
equal('A3 the heading counts in both languages: Slovak 1 program, 2 and 4 programy, 5 programov',
  [1, 2, 4, 5].map((count) => i18n.inLanguage('sk', () => t('r3_cmp_heading', { count }))).concat([1, 2].map((count) => t('r3_cmp_heading', { count }))),
  ['Porovnať 1 program', 'Porovnať 2 programy', 'Porovnať 4 programy', 'Porovnať 5 programov', 'Compare 1 programme', 'Compare 2 programmes']);
appCheck('A4 the header Compare button counts the set and is pressed while the view is open; it opens and closes the view', ({ run, get, fire, ids: [a, b] }) => {
  const button = get('header-compare');
  if (get('header-compare-count').textContent !== '0' || button.getAttribute('aria-pressed') !== 'false') return false;
  fire(cmpOf(get('results').children[0]), 'click'); fire(cmpOf(get('results').children[1]), 'click');
  if (get('header-compare-count').textContent !== '2') return false;
  button.focus(); fire(button, 'click');
  if (get('compare').hidden || button.getAttribute('aria-pressed') !== 'true' || stubDocument.activeElement !== get('cmp-h')) return false;
  fire(button, 'click');
  if (!get('compare').hidden || button.getAttribute('aria-pressed') !== 'false' || stubDocument.activeElement !== button) return false;
  // Ids no longer in the data never count.
  run(`${cmpSet(['gone', a])} syncCompareControls();`);
  return get('header-compare-count').textContent === '1';
});
appCheck('A4 the tray: phones only, from one programme, "Compare n of 4"; hidden at 0, while open, while typing, in a dialog, behind any pick-list open outside the Filters sheet (the bar on a phone on its side, Sort on a portrait phone) and while printing; has-tray follows it', ({ run, get, fire, flip600, trayMedia, docBody, ids: [a, b] }) => {
  // The harness starts with focus on a stand-in text field, which counts as typing.
  stubDocument.activeElement = docBody;
  const tray = get('cmp-tray'), shown = () => !tray.hidden && docBody.classList.contains('has-tray');
  const gone = () => tray.hidden && !docBody.classList.contains('has-tray');
  trayMedia.matches = true; for (const fn of trayMedia.listeners) fn({ matches: true });
  if (!gone()) return false;
  fire(cmpOf(get('results').children[0]), 'click');
  if (!shown() || get('cmp-tray-text').textContent !== 'Compare 1 of 4') return false;
  fire(cmpOf(get('results').children[1]), 'click');
  if (get('cmp-tray-text').textContent !== 'Compare 2 of 4') return false;
  // Typing in Search (the keyboard is up): hidden; a checkbox is not typing.
  fire(get('f-search'), 'focusin');
  if (!gone()) return false;
  fire(get('f-search'), 'focusout', { relatedTarget: get('f-maths') });
  if (!shown()) return false;
  fire(get('f-search'), 'focusin'); fire(get('f-search'), 'focusout', { relatedTarget: null });
  if (!shown()) return false;
  // Opening from the tray hides it; closing brings it back with focus on Open.
  get('cmp-tray-open').focus(); fire(get('cmp-tray-open'), 'click');
  if (!gone() || get('compare').hidden) return false;
  fire(get('cmp-close'), 'click');
  if (!shown() || stubDocument.activeElement !== get('cmp-tray-open')) return false;
  // A dialog: the filter sheet.
  get('filter-sheet').showModal(); fire(get('sheet-h'), 'focusin');
  if (!gone()) return false;
  get('filter-sheet').close(); fire(get('filter-sheet'), 'close', { bubbles: false });
  if (!shown()) return false;
  // Review of PR 1: a phone on its side has the tray and the bar's floating
  // pick-lists, and the tray covered Budget's first field. It goes while one
  // is open and comes back when it closes; a list left open in the closed
  // sheet does not count.
  const budget = get('dd-budget'), toggle = (open) => { budget.open = open; fire(budget, 'toggle', { bubbles: false }); };
  toggle(true); if (!shown()) return false; toggle(false);
  // Widening moves focus to the tuition field (a keyboard field); not what is tested here.
  flip600(true); stubDocument.activeElement = docBody; toggle(true);
  if (!gone()) return false;
  toggle(false);
  if (!shown()) return false;
  flip600(false); stubDocument.activeElement = docBody;
  // Desktop: no tray. Printing: none.
  trayMedia.matches = false; for (const fn of trayMedia.listeners) fn({ matches: false });
  if (!gone()) return false;
  trayMedia.matches = true; for (const fn of trayMedia.listeners) fn({ matches: true });
  run('printing = true; syncTray();');
  if (!gone()) return false;
  run('afterPrint();');
  if (!shown()) return false;
  run(`${cmpSet([])} syncCompareControls();`);
  return gone();
});
appCheck('A4 the tray says it in Slovak: "Porovnanie: 3 zo 4", and Open is named "Otvoriť porovnanie"', ({ run, get, trayMedia, docBody, ids: [a, b, c] }) => {
  trayMedia.matches = true; stubDocument.activeElement = docBody;
  run(`${cmpSet([a, b, c])} switchLanguage('sk');`);
  const ok = get('cmp-tray-text').textContent === 'Porovnanie: 3 zo 4' && !get('cmp-tray').hidden
    && t('r3_cmp_open_label') === 'Otvoriť porovnanie' && t('r3_tray_open') === 'Otvoriť';
  run("switchLanguage('en');");
  return ok;
});
i18n.initLanguage('', { getItem: () => 'en' });
// The tray is fixed to the bottom, but its place in the markup is its place
// in Tab and screen-reader order. After </main> it came after every row
// (about 8,700 stops on a phone), so it now sits right after the count row,
// before My list, Compare and the results.
check('A4 markup: the header button beside My list, the tray right after the count row (before the list) with text and button apart, one status line (regression)',
  /<button class="btn hb" id="header-list" type="button">[^]*?<span class="hb-l" data-i18n="my_list">My list<\/span><span id="header-list-count" class="badge">0<\/span><\/button><button class="btn hb" id="header-compare" type="button" aria-pressed="false"><svg class="ic" aria-hidden="true"><use href="#i-compare"\/><\/svg><span class="hb-l" data-i18n="compare_2">Compare<\/span><span id="header-compare-count" class="badge">0<\/span><\/button>/.test(read('index.html'))
  && /<p class="copy-status" id="f-copy-status" role="status" aria-live="polite"><\/p>\s*<\/div>\s*(?:<!--[^]*?-->\s*)?<div class="cmp-tray" id="cmp-tray" hidden>\s*<p id="cmp-tray-text"><\/p>\s*<button type="button" class="btn btn-p btn-s" id="cmp-tray-open"[^>]*data-i18n-attr="aria-label:r3_cmp_open_label">Open<\/button>\s*<\/div>\s*<p class="count count-summary" id="count-summary"/.test(read('index.html'))
  && (() => { const html = read('index.html'), at = (s) => html.indexOf(s);
    return at('<div class="status">') < at('id="cmp-tray"') && at('id="cmp-tray"') < at('id="shortlist-bar"') && at('id="cmp-tray"') < at('id="results"') && at('id="cmp-tray"') < at('</main>'); })()
  && /<\/dialog>\s*<p class="visually-hidden" id="cmp-status" role="status" aria-live="polite"><\/p>\s*<footer/.test(read('index.html')));
check('A4 CSS: the header button hides where the tray serves; icon-only header buttons at 600–1023; the tray reserves its height, scroll padding and the toasts\' lift, none in print',
  /@media \(max-width:599\.98px\),\(max-height:500px\)\{#header-compare\{display:none\}\}/.test(cssText)
  && /@media \(min-width:600px\) and \(max-width:1023\.98px\)\{\s*\.hb \.hb-l\{position:absolute;[^}]*clip-path:inset\(50%\)/.test(cssText)
  && /body\.has-tray\{padding-bottom:var\(--tray-h,0px\)\}/.test(cssText) && /html\{scroll-padding-bottom:var\(--tray-h,0px\)\}/.test(cssText)
  && /\.toasts\{bottom:calc\(24px \+ var\(--tray-h,0px\)\)\}/.test(cssText)
  && /@media print\{\s*body\.has-tray\{padding-bottom:0\}\s*html\{scroll-padding-bottom:0\}\s*\.cmp:not\(\[hidden\]\) ~ \.split\{display:none\}/.test(cssText)
  && appSrc.includes("matchMedia('(max-width: 599.98px), (max-height: 500px)')"));
appCheck('A5 a fifth is refused: the set stays, the button is neither pressed nor disabled, and the limit toast opens Compare', ({ run, get, fire, context }) => {
  context.fixture.push(...context.live.slice(1, 3));
  const ids = context.fixture.map((r) => r.id);
  run(`allRows = fixture; ${cmpSet(ids.slice(0, 4))} update();`);
  const fifth = cmpOf(get('results').children.find((n) => n.dataset.id === ids[4]));
  fire(fifth, 'click');
  const toast = context.toasts.at(-1);
  if (run('compareIds.join()') !== ids.slice(0, 4).join() || fifth.getAttribute('aria-pressed') !== 'false' || fifth.disabled || fifth.getAttribute('aria-disabled')
    || toast.message !== 'You can compare up to 4 programmes. Remove one first.' || toast.label !== 'Open compare' || get('header-compare-count').textContent !== '4') return false;
  toast.action();
  return !get('compare').hidden && cmpColIds(get).join() === ids.slice(0, 4).join() && stubDocument.activeElement === get('cmp-h');
});
appCheck('A5 desktop: an add shows one toast with the count and "Open compare"; a removal a plain toast; nothing in the status line', ({ get, fire, context, flushFrame }) => {
  const button = cmpOf(get('results').children[0]);
  fire(cmpOf(get('results').children[1]), 'click');
  fire(button, 'click');
  const added = context.toasts.at(-1);
  if (context.toasts.length !== 2 || added.message !== 'Added to compare (2 of 4).' || added.label !== 'Open compare') return false;
  fire(button, 'click');
  flushFrame();
  const removed = context.toasts.at(-1);
  return context.toasts.length === 3 && removed.message === 'Removed from compare.' && !removed.action && get('cmp-status').textContent === '';
});
// "Added to compare (3 of 4) · Open compare" stayed up over the open
// comparison until its timer ran out.
appCheck('A5 desktop: opening Compare from the header retires the "Open compare" toast of an add and of a refused fifth, and no other (regression)', ({ run, get, fire, context }) => {
  context.fixture.push(...context.live.slice(1, 3));
  const ids = context.fixture.map((r) => r.id);
  run('allRows = fixture; update();');
  const toasts = [];
  context.showToast = (message, label, action, options) => { const toast = { message, label, action, options, gone: false }; toasts.push(toast); return () => { toast.gone = true; }; };
  fire(cmpOf(get('results').children[0]), 'click');
  const added = toasts.at(-1);
  if (added?.label !== 'Open compare' || added.gone) return false;
  fire(get('header-compare'), 'click');
  if (get('compare').hidden || !added.gone) return false;
  fire(get('header-compare'), 'click');
  run(`${cmpSet(ids.slice(0, 4))} update();`);
  fire(cmpOf(get('results').children.find((n) => n.dataset.id === ids[4])), 'click');
  const full = toasts.at(-1);
  if (full?.message !== 'You can compare up to 4 programmes. Remove one first.' || full.gone) return false;
  fire(cmpOf(get('results').children.find((n) => n.dataset.id === ids[0])), 'click');
  const removed = toasts.at(-1);
  fire(get('header-compare'), 'click');
  return !get('compare').hidden && full.gone && removed.message === 'Removed from compare.' && !removed.gone;
});
appCheck('A5 phones: no toast, the status line says it once; rapid adds 1 to 4 leave one line, "4 of 4"', ({ run, get, fire, context, trayMedia, frames, flushFrame }) => {
  trayMedia.matches = true;
  context.fixture.push(...context.live.slice(1, 2));
  run('update();');
  const rows = get('results').children;
  fire(cmpOf(rows[0]), 'click');
  if (get('cmp-status').textContent !== '' || frames.size !== 1) return false;
  flushFrame();
  if (get('cmp-status').textContent !== 'Added to compare, 1 of 4.' || (context.toasts ?? []).length) return false;
  fire(cmpOf(rows[0]), 'click');
  for (const row of rows) fire(cmpOf(row), 'click');
  if (frames.size !== 1 || get('cmp-status').textContent !== '') return false;
  flushFrame();
  if (get('cmp-status').textContent !== 'Added to compare, 4 of 4.') return false;
  fire(cmpOf(rows[3]), 'click'); flushFrame();
  return get('cmp-status').textContent === 'Removed from compare.' && (context.toasts ?? []).length === 0;
});
{
  // The real showToast, on a stand-in page with a fake clock.
  const toastPage = (test) => {
    let now = 0, nextId = 1; const timers = new Map();
    const advance = (ms) => {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((p, q) => p[1].at - q[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    };
    const region = Object.assign(new ChromeNode('div'), { id: 'toasts' });
    const page = { ...stubDocument, activeElement: null, getElementById: (id) => (id === 'toasts' ? region : null), listeners: {} };
    return withGlobals({
      document: page, matchMedia: () => ({ matches: false }),
      setTimeout: (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
    }, () => {
      const focus = (node) => { const was = page.activeElement; page.activeElement = node;
        if (was) dispatchStub(was, { type: 'focusout', relatedTarget: node }); if (node) dispatchStub(node, { type: 'focusin' }); };
      return test({ region, advance, focus, show: realRound2.showToast, buttonOf: (toast) => toast.querySelector('button') });
    });
  };
  check('A5 toasts: one leaves after 6 s with its 160 ms exit; a new one replaces an unfocused one', toastPage(({ region, advance, show }) => {
    show('One'); show('Two');
    if (region.children.length !== 1 || region.textContent !== 'Two') return false;
    advance(5999); if (region.children.length !== 1 || region.children[0].classList.contains('out')) return false;
    advance(1); if (!region.children[0].classList.contains('out')) return false;
    advance(160); return region.children.length === 0;
  }));
  check('A5 toasts: hovering pauses the timer; leaving starts it again', toastPage(({ region, advance, show }) => {
    show('One'); const toast = region.children[0];
    dispatchStub(toast, { type: 'mouseenter', bubbles: false }); advance(20000);
    if (region.children[0] !== toast) return false;
    dispatchStub(toast, { type: 'mouseleave', bubbles: false }); advance(6160);
    return region.children.length === 0;
  }));
  check('A5 toasts: a focused Undo is never replaced or timed out; the new toast goes beside it, and each Undo keeps its own action', toastPage(({ region, advance, focus, show, buttonOf }) => {
    const done = [];
    show('Removed A', 'Undo', () => done.push('A'));
    const first = region.children[0];
    focus(buttonOf(first));
    show('Removed B', 'Undo', () => done.push('B'));
    const second = region.children[1];
    if (region.children.length !== 2 || region.children[0] !== first || stubDocument !== stubDocument) return false;
    advance(20000);
    if (!region.children.includes(first) || region.children.includes(second)) return false;
    // A third while the first still holds focus: at most two, the focused one kept.
    show('Removed C', 'Undo', () => done.push('C'));
    const third = region.children.at(-1);
    if (region.children.length !== 2 || region.children[0] !== first) return false;
    dispatchStub(buttonOf(first), { type: 'click' });
    focus(buttonOf(third));
    dispatchStub(buttonOf(third), { type: 'click' });
    advance(200);
    return done.join() === 'A,C' && region.children.length === 0;
  }));
  check('A5 toasts: asked to (a keyboard removal), the toast moves focus to its Undo, and Escape there closes it without anything else handling the key; otherwise focus stays put', toastPage(({ region, advance, show, buttonOf }) => {
    stubDocument.activeElement = null;
    show('Removed A', 'Undo', () => {});
    if (stubDocument.activeElement !== null) return false;
    show('Removed B', 'Undo', () => {}, { focusAction: true });
    const toast = region.children[0];
    if (region.children.length !== 1 || stubDocument.activeElement !== buttonOf(toast)) return false;
    dispatchStub(buttonOf(toast), { type: 'keydown', key: 'Enter' });
    if (region.children.length !== 1) return false;
    const stopped = !dispatchStub(buttonOf(toast), { type: 'keydown', key: 'Escape' });
    advance(200);
    return stopped && region.children.length === 0;
  }));
  check('A5 hovering during toast exit cancels removal until the pointer leaves', toastPage(({ region, advance, show }) => {
    show('Removed'); const toast = region.children[0];
    advance(6000);
    dispatchStub(toast, { type: 'mouseenter', bubbles: false }); advance(1000);
    if (region.children[0] !== toast || toast.classList.contains('out')) return false;
    dispatchStub(toast, { type: 'mouseleave', bubbles: false }); advance(6160);
    return region.children.length === 0;
  }));
  check('A5 toasts: focus arriving during the exit keeps the toast; leaving it starts the timer again', toastPage(({ region, advance, focus, show, buttonOf }) => {
    show('Removed', 'Undo', () => {});
    const toast = region.children[0];
    advance(6000); if (!toast.classList.contains('out')) return false;
    focus(buttonOf(toast)); advance(1000);
    if (region.children[0] !== toast || toast.classList.contains('out')) return false;
    focus(null); dispatchStub(buttonOf(toast), { type: 'focusout', relatedTarget: null });
    advance(6160);
    return region.children.length === 0;
  }));
}
check('A6 the My list picker is gone: no #ml-compare, #ml-compare-open or #ml-compare-hint in the page, no prunePicks, and its words are out of both languages',
  !/id="ml-compare|id="ml-picks"/.test(read('index.html')) && !/prunePicks|comparePicks|drawPicks|syncPicks/.test(appSrc + read('js/compare.js'))
  && ['r2_compare_hint', 'r2_compare_n', 'pick_2_to_4_programmes', 'compare', 'compare_programmes'].every((key) => !Object.hasOwn(UI.en, key) && !Object.hasOwn(UI.sk, key))
  && !/\.ml-hint|\.cmp-cta|\.ml-picks/.test(cssText));
equal('A6 the range says "z" for 2 and 3 and "zo" for 4 in Slovak; English is "of"',
  [i18n.inLanguage('sk', () => t('r3_cmp_range', { from: 1, to: 2, total: 3 })), i18n.inLanguage('sk', () => t('r3_cmp_range_zo', { from: 3, to: 4, total: 4 })), t('r3_cmp_range_zo', { from: 1, to: 2, total: 4 })],
  ['Programy 1–2 z 3', 'Programy 3–4 zo 4', 'Programmes 1–2 of 4']);
appCheck('A6 three or four programmes get the arrows and the range above a framed scroll box they control; two do not', ({ run, get, context }) => {
  context.fixture.push(...context.live.slice(1, 2));
  const ids = context.fixture.map((r) => r.id);
  run(`allRows = fixture; ${cmpSet(ids.slice(0, 2))} update(); openCompare(null);`);
  if (get('cmp-body').querySelector('.cmp-nav') || !get('cmp-body').querySelector('.cmp-frame .cmp-scroll')) return false;
  const texts = [];
  for (const [n, lang] of [[3, 'sk'], [4, 'sk'], [3, 'en']]) {
    run(`switchLanguage('${lang}'); ${cmpSet(ids.slice(0, n))} syncCompareControls();`);
    const nav = get('cmp-body').querySelector('.cmp-nav'), box = get('cmp-body').querySelector('.cmp-scroll');
    if (!nav || nav.parent !== get('cmp-body') || get('cmp-body').children[0] !== nav || box.id !== 'cmp-scroll'
      || [nav.querySelector('.cmp-prev'), nav.querySelector('.cmp-next')].some((b) => b.getAttribute('aria-controls') !== 'cmp-scroll' || !b.getAttribute('aria-label'))
      || nav.querySelector('.cmp-range').getAttribute('aria-live')) return false;
    texts.push(nav.querySelector('.cmp-range').textContent, nav.querySelector('.cmp-next').getAttribute('aria-label'));
  }
  run("switchLanguage('en');");
  return /z 3$/.test(texts[0]) && texts[1] === 'Nasledujúci program' && /zo 4$/.test(texts[2]) && /of 3$/.test(texts[4]) && texts[5] === 'Next programme';
});
i18n.initLanguage('', { getItem: () => 'en' });
check('A6 CSS: below 600 px Close is a 44 px icon at the heading\'s right, its words kept for screen readers, the differences tick on row 2; the nav shows only there; the fade stops at the end',
  /@media \(max-width:599\.98px\)\{\s*\.cmp-head\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;[^}]*\}\s*#cmp-h\{grid-column:1;grid-row:1\}\s*#cmp-close\{grid-column:2;grid-row:1;width:44px;height:44px;padding:0\}\s*\.cmp-close-t\{position:absolute;[^}]*clip-path:inset\(50%\)[^}]*\}\s*#cmp-diff-label\{grid-column:1\/-1;grid-row:2\}/.test(cssText)
  && /@media \(min-width:600px\)\{\.cmp-nav\{display:none\}\}/.test(cssText) && /\.cmp-frame\.at-end::after\{display:none\}/.test(cssText)
  && /\.cmp-frame::after\{[^}]*pointer-events:none\}/.test(cssText) && /<span class="cmp-close-t" data-i18n="close_compare">Close compare<\/span>/.test(read('index.html')));
// Found in Chrome (smoke B3A): each has its browser check there too.
check('A6 the view is shown before its table is drawn: a hidden box kept its sideways scroll at 0 and measured the phone cue as "1–3 of 3"',
  (() => { const body = appSrc.slice(appSrc.indexOf('function drawCompare()'), appSrc.indexOf('function wireCompareCue'));
    return body.indexOf('dom.compare.hidden = false;') > 0 && body.indexOf('dom.compare.hidden = false;') < body.indexOf('renderCompare(') && body.indexOf('renderCompare(') < body.indexOf('wireCompareCue(next)'); })());
check('A6 a dashed unknown wraps inside a compare column (it poked 28 px past the last column, so the last snap never reached the end)',
  /\.cmp-t \.unk-t\{white-space:normal\}/.test(cssText));
check('A3 compare column names use the whole column below the "x" (a float spacer, not padding down the whole cell) and Save never breaks inside its word',
  /\.cmp-t th\.cmp-p::before\{content:"";float:right;width:36px;height:34px\}/.test(cssText) && !/th\.cmp-p\{[^}]*padding-right:48px/.test(cssText)
  && /\.cmp-save\{[^}]*overflow-wrap:normal/.test(cssText));
// After the merge B's 2 x 2 toolbar owns this: Clear is an outlined grid cell
// beside Print, and no rule may stretch it across the row (smoke R3H checks
// the layout in Chrome).
check('A6 with the picker gone the phone My list toolbar keeps Clear my list beside Print, not Print alone on a row (smoke R3H)',
  /border:1px solid var\(--edge\)/.test(ruleAt(cssText, '.mylist.is-list .ml-tools>#clear-shortlist', '(max-width: 599.98px)'))
  && !/#clear-shortlist[^{]*\{[^}]*grid-column:1\s*\/\s*-1/.test(cssText) && !/\.ml-tools>\.btn-q\{[^}]*grid-column:1/.test(cssText));
check('A4 a wide but short window keeps the pane\'s end above the tray',
  /@media \(min-width:1200px\)\{body\.has-tray \.pane\{max-height:calc\(100dvh - var\(--header-visible\) - 24px - var\(--tray-h,0px\)\)\}\}/.test(cssText));
appCheck('A1 two tabs: an add here goes on the set as stored now, so the other tab\'s add survives; its storage events update this tab, key null too', ({ run, context, fireWindow, ids: [a, b, c] }) => {
  cmpToggle(run, a);
  // A second tab adds c before this tab hears of it.
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([a, c]);
  cmpToggle(run, b);
  if (JSON.stringify(cmpStored(context)) !== JSON.stringify([a, c, b]) || run('compareIds.join()') !== [a, c, b].join()) return false;
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([c]);
  fireWindow('storage', { key: compareSetMod.COMPARE_KEY });
  if (run('compareIds.join()') !== c) return false;
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([b, c]);
  fireWindow('storage', { key: 'something-else' });
  if (run('compareIds.join()') !== c) return false;
  // Storage cleared in another tab: key null refreshes both sets, even when the saves cannot be read.
  context.compareStorage.data = {};
  fireWindow('storage', { key: null });
  return run('compareIds.length') === 0;
});
// A storage event takes another tab's set through normalizeCompare: a set of
// five (an older tab, or one edited by hand) must not open a fifth column, and
// an id missing from the data is kept aside without taking one of the four.
appCheck('A1 another tab stores five programmes and one unknown id: this tab keeps the first four known, in order, and the unknown id uncounted', ({ run, get, context, fireWindow }) => {
  // The harness has three programmes; Compare needs five known ones here.
  context.fiveRows = live.slice(0, 5);
  run('allRows = fiveRows; facets = buildFacets(allRows); drawChips(); update();');
  const five = context.fiveRows.map((r) => r.id);
  if (new Set(five).size !== 5 || five.includes('not-in-the-data')) return false;
  run(`${cmpSet(five.slice(0, 2))} update(); openCompare(null);`);
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([five[0], 'not-in-the-data', ...five.slice(1)]);
  fireWindow('storage', { key: compareSetMod.COMPARE_KEY });
  return run('compareIds.join()') === [five[0], 'not-in-the-data', ...five.slice(1, 4)].join()
    && cmpColIds(get).join() === five.slice(0, 4).join() && /\b4\b/.test(get('cmp-h').textContent);
});
appCheck('A1 a failed write keeps this tab\'s edits: later changes go on its own copy, not on what storage still holds', ({ run, context, ids: [a, b, c] }) => {
  context.compareStorage.data[compareSetMod.COMPARE_KEY] = JSON.stringify([c]);
  context.compareStorage.full = true;
  cmpToggle(run, a);
  if (run('compareFailed') !== true || run('compareIds.join()') !== [c, a].join()) return false;
  cmpToggle(run, b);
  return run('compareIds.join()') === [c, a, b].join() && cmpStored(context).join() === c;
});
appCheck('A1 saves, unsaves, Clear my list and Clear all never change the compare set', ({ run, get, item, fire, ids: [a, b] }) => {
  cmpToggle(run, a); cmpToggle(run, b);
  fire(item(a).querySelector('button.star'), 'click');
  fire(item(a).querySelector('button.star'), 'click');
  fire(item(b).querySelector('button.star'), 'click');
  if (run('compareIds.join()') !== [a, b].join()) return false;
  run("state.search = 'x'; update(); clearAll();");
  const confirm = globalThis.window;
  run('window.confirm = () => true;');
  fire(get('clear-shortlist'), 'click');
  return confirm === globalThis.window && run('shortlist.size') === 0 && run('compareIds.join()') === [a, b].join();
});
{
  // The harness's fixture: live[0], sdu-mma and the first Trinity row.
  const [fa, fc] = [live[0].id, live.find((r) => r.id.startsWith('tcd-')).id];
  for (const [name, search] of [['a bare address', ''], ['?ui=sk', '?ui=sk'], ['a filter address', '?country=Ireland&points=36'], ['a shared ?list=', `?list=${fa}`]]) {
    await asyncAppCheck(`A1 ${name} restores the compare set on its own: filters, saved preferences and links are untouched`, async ({ run, context, settle, advance }) => {
      const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); };
      context.location.search = search;
      run('applyUrlFields();');
      context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle(); advance(500);
      return run('compareIds.join()') === [fc, 'gone', fa].join() && run('shownCompare().join()') === [fc, fa].join()
        && !(context.prefWrites ?? []).length && run('state.shortlistOnly') === search.startsWith('?list=')
        && urls.every((u) => !u.includes(fc) && !/compare|cmp/.test(u)) && !run('shareLink()').includes(fc)
        && cmpStored(context).join() === [fc, 'gone', fa, fc].join();
    }, { boot: true, compare: [fc, 'gone', fa, fc] });
  }
}

section('Batch 3 · B');
// B1 (Leon, Q2): on a phone the main view's My list box was a half-empty
// second row above the cards. The stub has no layout, so the state is checked
// here and the computed display:none in smoke "B3B main top".
check('B3B1 on a phone the main-view My list bar is hidden unless a failure note shows', (() => {
  // With Compare out of the bar (A), the rule needs no phone scope: the bar
  // shows only for a failure note at every width.
  const rule = ruleAt(cssText, '.mylist:not(.is-list):not(:has(.ml-note:not([hidden])))');
  return /display:none/.test(rule) && !/\.ml-hint|cmp-cta/.test(cssText.match(/\.mylist:not\(\.is-list\):not\(:has\([^{]*\{/g)?.join('') || '');
})());
appCheck('B3B1 with 3 saved and no note the main-view bar carries no note (so the phone rule hides it); a failed save shows the note', ({ run, get, item, fire, context, ids: [a] }) => {
  run('for (const r of fixture) shortlist.add(r.id); update();');
  const bar = get('shortlist-bar');
  if (bar.hidden || bar.classList.contains('is-list') || !get('ml-note').hidden) return false;
  context.saveWorks = false;
  fire(starOf(item(a)), 'click');
  return !bar.hidden && !bar.classList.contains('is-list') && !get('ml-note').hidden && get('ml-note').textContent !== '';
});
// B2 (Leon, 2026-11-05): the phone list toolbar. The back button keeps its
// chevron because the text goes in its own span; a language switch wrote the
// whole button's textContent before, which would wipe the icon.
appCheck('B3B2 the back button text sits in .ml-open-t beside its chevron, through a language switch; Clear my list keeps its trash icon', ({ run, get, fire }) => {
  const back = get('f-shortlist-only'), clear = get('clear-shortlist');
  const icons = () => back.querySelector('use')?.getAttribute('href') === '#i-chevron' && clear.querySelector('use')?.getAttribute('href') === '#i-trash';
  run('shortlist.add(fixture[0].id); update();');
  if (back.querySelector('.ml-open-t').textContent !== 'Open my list' || !icons()) return false;
  fire(back, 'click');
  if (back.querySelector('.ml-open-t').textContent !== 'Back to all programmes' || !icons()) return false;
  try {
    run("switchLanguage('sk')");
    // (The harness strips data-i18n, so Clear's static label is left to the HTML i18n check.)
    return back.querySelector('.ml-open-t').textContent === UI.sk.back_to_all_programmes && icons();
  } finally { run("switchLanguage('en')"); }
});
check('B3B2 the back chevron shows only in the list view, pointing left; the trash icon and the outlined Clear only below 600 px', (() => {
  const phone = '(max-width: 599.98px)';
  return /display:none/.test(ruleAt(cssText, '.ml-open>.ic'))
    && /display:block/.test(ruleAt(cssText, '.mylist.is-list .ml-open>.ic')) && /rotate\(90deg\)/.test(ruleAt(cssText, '.mylist.is-list .ml-open>.ic'))
    && /display:none/.test(ruleAt(cssText, '#clear-shortlist>.ic')) && /display:block/.test(ruleAt(cssText, '#clear-shortlist>.ic', phone))
    && /border:1px solid var\(--edge\)/.test(ruleAt(cssText, '.mylist.is-list .ml-tools>#clear-shortlist', phone))
    && /order:-1/.test(ruleAt(cssText, '.mylist.is-list .ml-open', phone))
    // The old quiet-text Clear rules are gone (they made it look like an empty cell).
    && !/\.ml-tools>\.btn-q|:has\(#ml-compare\[hidden\]\)/.test(cssText);
})());
// iPhone (Leon, 2026-11-08): the bar's pick-lists (Sort too) faded in but
// snapped shut, because Safari ignores a ::details-content content-visibility
// transition. holdDropdownClose keeps [open] for the fade under .closing while
// .open already reads false; a tap on the button mid-fade reopens it.
{
  class FakeDetails {
    constructor() {
      this.attr = true; this.classes = new Set(); this.events = [];
      const summary = this.summary = { aria: 'true', listeners: [], setAttribute: (name, value) => { summary.aria = value; }, addEventListener: (type, fn) => summary.listeners.push(fn) };
      this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) };
    }
    get open() { return this.attr; }
    set open(value) { if (this.attr !== Boolean(value)) this.events.push('native'); this.attr = Boolean(value); }
    querySelector() { return this.summary; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  let reduced = false;
  const globals = { HTMLDetailsElement: FakeDetails, matchMedia: () => ({ matches: reduced }) };
  const make = (inSheet = false) => withGlobals(globals, () => { const d = new FakeDetails(); realRound2.holdDropdownClose?.(d, () => inSheet); return d; });
  const set = (d, value) => withGlobals(globals, () => { d.open = value; });
  const tap = (d) => withGlobals(globals, () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; d.summary.listeners.forEach((fn) => fn(event)); return event.prevented; });
  const fade = () => new Promise((ok) => setTimeout(ok, (realRound2.DROPDOWN_CLOSE_MS ?? 0) + 40));
  const state = (d) => ({ reads: d.open, attr: d.attr, closing: d.classes.has('closing'), aria: d.summary.aria, events: d.events.join() });
  const closing = make(); set(closing, false); const during = state(closing); await fade(); const after = state(closing);
  check('bar pick-list: closing keeps [open] under .closing for the fade, reads closed at once, and closes for real after it',
    realRound2.DROPDOWN_CLOSE_MS >= 120 && realRound2.DROPDOWN_CLOSE_MS <= 150
      && JSON.stringify(during) === JSON.stringify({ reads: false, attr: true, closing: true, aria: 'false', events: '' })
      && JSON.stringify(after) === JSON.stringify({ reads: false, attr: false, closing: false, aria: 'false', events: 'native' }),
    JSON.stringify({ during, after }));
  const back = make(); const tapClosed = tap(back); const midFade = state(back); const tapOpened = tap(back); const reopened = state(back); await fade();
  check('bar pick-list: a tap on the open button fades it; a second tap mid-fade reopens it with a toggle event, and it stays open',
    tapClosed && midFade.closing && !midFade.reads && tapOpened && JSON.stringify(reopened) === JSON.stringify(state(back))
      && reopened.reads && reopened.attr && !reopened.closing && reopened.events === 'toggle',
    JSON.stringify({ midFade, reopened, now: state(back) }));
  const sheetList = make(true); set(sheetList, false); const inSheet = state(sheetList);
  reduced = true; const still = make(); set(still, false); const reducedNow = state(still); reduced = false;
  const plain = withGlobals({ matchMedia: () => ({ matches: false }) }, () => { const d = new FakeDetails(); realRound2.holdDropdownClose?.(d, () => false); d.open = false; return d.attr; });
  check('bar pick-list: in the phone sheet, under reduced motion, and without a real <details> it closes at once',
    !inSheet.attr && !inSheet.closing && !reducedNow.attr && !reducedNow.closing && plain === false, JSON.stringify({ inSheet, reducedNow, plain }));
  const round2Src = read('js/round2.js');
  check('bar pick-list: every dropdown is wired to fade shut, Escape skips a fading list, and the fading panel is transparent and takes no taps',
    /holdDropdownClose\(d, \(\) => dom\.sheet\.contains\(d\)\)/.test(round2Src)
      && round2Src.includes("document.querySelector('.dropdown[open]:not(.closing),.ml-pop[open]')")
      && /\.dropdown\.closing>\.dropdown-panel\{transform:scale\(\.97\);opacity:0;pointer-events:none;transition:transform 150ms/.test(cssRules)
      && cssRules.includes('.dropdown.closing>summary .dd-chev{transform:none}'));
}
// B3 (Leon, 2026-11-05): clicking "My list (0)" did nothing, because update()
// turned an empty list view straight off. The header button is wired in
// round2.js, which the harness stubs, so the real wireRound2 runs here.
appCheck('B3B3 with 0 saves the real header My list opens an empty list view that says how to save (EN, SK); its button goes back with focus on the header', ({ run, get, fire }) => {
  const header = get('header-list');
  // The stand-in nodes lack prepend, which wireRound2 uses before it wires the
  // header, and click(), which its handler calls; lent for this check only.
  const hadPrepend = Object.hasOwn(ChromeNode.prototype, 'prepend');
  const hadClick = Object.hasOwn(ChromeNode.prototype, 'click');
  if (!hadPrepend) ChromeNode.prototype.prepend = function (node) { this.append(node); };
  if (!hadClick) ChromeNode.prototype.click = function () { fire(this, 'click'); };
  try {
    withGlobals({ window: { addEventListener() {} }, innerWidth: 390, ResizeObserver: fakeObserver, matchMedia: () => ({ matches: false }) },
      () => realRound2.wireRound2(run('dom')));
  } catch { /* Only the header listener (attached early) is needed; later stand-in gaps are not this check's subject. */ } finally {
    if (!hadPrepend) delete ChromeNode.prototype.prepend;
  }
  try { return emptyListFlow(); } finally { if (!hadClick) delete ChromeNode.prototype.click; }
  function emptyListFlow() {
  if (run('shortlist.size') !== 0 || run('state.shortlistOnly') !== false) return false;
  fire(header, 'click');
  const texts = () => [get('empty-title').textContent, get('empty-hint').textContent, get('empty-back').textContent];
  if (run('state.shortlistOnly') !== true || get('empty-state').hidden || get('empty-back').hidden
    || JSON.stringify(texts()) !== JSON.stringify([UI.en.your_list_is_empty, UI.en.r3_list_empty_hint, UI.en.back_to_all_programmes])
    || !get('empty-clear').hidden || !get('empty-tips').hidden || get('shortlist-bar').hidden || !get('shortlist-bar').classList.contains('is-list')
    || !get('ml-tools').hidden || !get('ml-origin').hidden || !get('ml-show-all').hidden || get('shortlist-count-text').textContent !== '0 saved') return false;
  try {
    run("switchLanguage('sk')");
    if (JSON.stringify(texts()) !== JSON.stringify([UI.sk.your_list_is_empty, UI.sk.r3_list_empty_hint, UI.sk.back_to_all_programmes])) return false;
  } finally { run("switchLanguage('en')"); }
  fire(get('empty-back'), 'click');
  return run('state.shortlistOnly') === false && stubDocument.activeElement === header && get('empty-state').hidden
    && get('results').children.length === 3;
  }
});
appCheck('B3B3 Clear my list still returns to all programmes', ({ run, get, fire, context }) => {
  run('for (const r of fixture) shortlist.add(r.id); update();');
  fire(get('f-shortlist-only'), 'click');
  context.window.confirm = () => true;
  fire(get('clear-shortlist'), 'click');
  return run('shortlist.size') === 0 && run('state.shortlistOnly') === false && get('empty-state').hidden;
});
await asyncAppCheck('B3B3 a shared link whose programmes have all gone keeps its own message, with no back button in the empty state', async ({ run, get, context, settle }) => {
  context.location.search = '?list=ghost';
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  return run('state.shortlistOnly') === true && get('empty-title').textContent === 'None of the programmes in this link are listed any more.'
    && get('empty-hint').textContent === UI.en.close_the_shared_list_to_see_every_programme && get('empty-back').hidden;
}, { boot: true });
check('B3B3 the empty-list hint exists in EN and SK',
  UI.en.r3_list_empty_hint === 'Use the bookmark next to any programme to save it here. Your list stays in this browser.'
  && UI.sk.r3_list_empty_hint === 'Program sem uložíš záložkou vedľa neho. Tvoj zoznam zostane v tomto prehliadači.');

section('Batch 3 · C');
// C1: setup ends on a done screen (Leon, 2026-11-05), replacing step 1's FAQ
// link and the completion toast.
{
  const sk = (key, count) => { i18n.setLanguage('sk', { setItem() {} }); try { return t(key, { count }); } finally { i18n.setLanguage('en', { setItem() {} }); } };
  // Review of PR 1, 2026-11-07: "match your answers" counted rows outside the
  // student's IB points (HL-Maths-only, can't be compared); the count says "shown".
  equal('B3C1 done screen EN copy', [t('r3_ob_finish'), t('r3_ob_done_count', { count: 1 }), t('r3_ob_done_count', { count: 3 }), t('r3_ob_shown_count', { count: 1 }), t('r3_ob_shown_count', { count: 0 }), t('r3_ob_done_p'), t('r3_ob_done_h_none'), t('r3_ob_done_p_none'), t('r3_ob_faq'), t('r2_show_mine'), t('r2_answers_applied')],
    ['Finish', '1 programme shown', '3 programmes shown', '1 programme shown', '0 programmes shown', 'You can change these filters any time in Filters.', "You haven't added any setup answers.", 'Your existing filters still apply. You can change them any time in Filters.', 'Read the FAQ', 'Show my programmes', 'Your answers are now filters']);
  equal('B3C1 done screen SK plurals for 1, 3, 312 and 0 (0 takes "other")',
    [1, 3, 312, 0].flatMap((n) => [sk('r3_ob_done_count', n), sk('r3_ob_shown_count', n)]),
    ['1 zobrazený program', 'Zobrazený je 1 program', '3 zobrazené programy', 'Zobrazené sú 3 programy',
      '312 zobrazených programov', 'Zobrazených je 312 programov', '0 zobrazených programov', 'Zobrazených je 0 programov']);
  equal('B3C1 done screen SK copy', ['r3_ob_finish', 'r3_ob_done_p', 'r3_ob_done_h_none', 'r3_ob_done_p_none', 'r3_ob_faq'].map((key) => UI.sk[key]),
    ['Dokončiť', 'Tieto filtre môžeš kedykoľvek zmeniť vo Filtroch.', 'Nastavenie zostalo prázdne.', 'Tvoje doterajšie filtre stále platia. Kedykoľvek ich môžeš zmeniť vo Filtroch.', 'Prečítaj si časté otázky']);
  // Verification of PR 1: only the no-answers count ended with a full stop,
  // so the two done-screen counts read differently.
  check('done-screen counts never end with a full stop, EN and SK',
    [UI.en, UI.sk].every((ui) => ['r3_ob_done_count', 'r3_ob_shown_count'].every((key) => Object.values(ui[key]).every((v) => !v.endsWith('.')))));
  check('B3C1 the step 1 FAQ link, its key and its CSS are gone', !('r2_ob_faq' in UI.en) && !('r2_ob_faq' in UI.sk) && !/\.ob-faq\b/.test(cssText) && !read('js/onboarding.js').includes('ob-faq'));
}
appCheck('B3C1 step 1 has no FAQ link; Skip on any step never shows the done screen', (h) => {
  const {dialog,next,doneScreen,applied,writes}=realSetup(h);
  if (dialog.querySelector('.ob-faq') || dialog.querySelector('a')) return false;
  next(); next(); h.fire(dialog.querySelector('.skipwrap button'), 'click');
  return !dialog.open && !doneScreen() && applied.length === 0 && writes[0][1] === 'dismissed';
});
appCheck('B3C1 Esc on the done screen keeps the answers and writes "completed" once', (h) => {
  const {get,fire,resultsSection}=h, {dialog,next,doneScreen,applied,writes}=realSetup(h,{shown:1});
  next(); const points=get('ob-points'); points.value='40'; fire(points,'input'); next(); next(); next(); next();
  const d=doneScreen();
  if (!d || d.count !== '1 programme shown') return false;
  fire(dialog, 'cancel');
  return !dialog.open && applied.length === 1 && applied[0].myIbPoints === 40 && writes.length === 1 && writes[0][1] === 'completed'
    && stubDocument.activeElement === resultsSection;
});
appCheck('B3C1 a second Finish click applies nothing more; the done screen formats the count', (h) => {
  const {dialog,next,doneScreen,applied,primary}=realSetup(h,{shown:2915,state:savedState.validateFilters({countries:['Ireland']})});
  for (let i = 0; i < 4; i++) next();
  const finish = primary(); h.fire(finish, 'click'); h.fire(finish, 'click');
  // The second click of a double-click (detail 2) lands on "Show my programmes".
  h.fire(primary(), 'click', { detail: 2 });
  return applied.length === 1 && dialog.open && doneScreen()?.count === '2,915 programmes shown';
});
// The done screen's FAQ button used to scroll to the footer FAQ below every
// row, re-aiming while rows near the bottom settled. Since the header's "?"
// panel (Leon, 2026-11-09) it opens that panel instead, and closing the panel
// returns to the list. Nothing scrolls any more.
appCheck('B3C1 the done screen FAQ button closes setup as completed, then opens the FAQ panel over the list', (h) => {
  const {resultsSection}=h, faqOpens=[];
  const {dialog,next,writes}=realSetup(h,{env:{openFaq:(back)=>faqOpens.push({back,setupOpen:dialog.open})}});
  for (let i = 0; i < 5; i++) next();
  stubDocument.scrolls = [];
  h.fire(dialog.querySelectorAll('.ob-foot button').find((b) => b.textContent === t('r3_ob_faq')), 'click');
  return !dialog.open && writes.length === 1 && writes[0][1] === 'completed' && faqOpens.length === 1
    && faqOpens[0].back === resultsSection && faqOpens[0].setupOpen === false && stubDocument.scrolls.length === 0;
});
check('the done screen no longer scrolls to the footer FAQ: the jump and its re-aiming and scroll margin are gone',
  !/showFaq|scrollIntoView|getElementById\('faq'\)/.test(read('js/onboarding.js'))
  && /import \{ openFaq \} from '\.\/faq\.js';/.test(read('js/onboarding.js')) && /openFaq\(results\)/.test(read('js/onboarding.js'))
  && !/#faq\{scroll-margin/.test(cssRules));
appCheck('B3C1 reopening after completion starts again at step 1 with Skip and no done screen', (h) => {
  const {dialog,next,doneScreen,api,writes}=realSetup(h);
  for (let i = 0; i < 6; i++) next();
  if (dialog.open) return false;
  api.open(null);
  const ok = dialog.open && !doneScreen() && dialog.querySelector('.ob-foot .btn-p').textContent === t('r2_start')
    && !!dialog.querySelector('.skipwrap') && !dialog.querySelector('.ob-foot').classList.contains('ob-done-foot');
  h.fire(dialog, 'cancel');
  return ok && writes.at(-1)[1] === 'dismissed';
});
check('B3C1 the done screen stacks full width on phones, primary first; 44 px buttons',
  /\.ob-done-foot\{flex-direction:row-reverse\}/.test(cssText) && /\.ob-done-foot>\.btn\{min-height:44px/.test(cssText)
  && /@media \(max-width:599\.98px\)\{\s*\.ob-done-foot\{flex-direction:column;align-items:stretch\}/.test(cssText)
  && /foot\.replaceChildren\(show, faq, el\('span', 'sp'\)\)/.test(read('js/onboarding.js')));
// Was a source pin on "return currentlyShown". Review of PR 1 (2026-11-07):
// with My list's "Show all saves" on, setup's answers did not filter the list
// and the done screen counted a 42-point save for 24 points. apply() now ends
// "Show all saves" and returns the count, the count line's points parts and
// whether any filter is on.
await asyncAppCheck('B3C1 the app apply callback ends "Show all saves" and returns the shown count, the points parts and whether a filter is on', async ({run,context,settle,ids:[a,b]}) => {
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  run(`shortlist.add('${a}'); shortlist.add('${b}'); state.shortlistOnly = true; listAll = true; update();`);
  if (run('listAll') !== true) return false;
  const result = context.onboardingConfig.apply(savedState.validateFilters({myIbPoints:24}));
  const parts = run('pointsSummaryParts(applyFilters(allRows, state, shortlist).filter((row) => shortlist.has(row.id)), state).map((p) => p.text)');
  return run('listAll') === false && result.shown === run('currentlyShown') && result.shown === run('applyFilters(allRows, state, shortlist).length')
    && JSON.stringify(result.summary) === JSON.stringify(parts) && result.summary.length >= 1 && result.filtered === true;
}, {boot:true});
appCheck('B3C1 the done screen says "shown" and splits it as the count line does when IB points are set', (h) => {
  const {get,fire}=h, summary=['10 within your IB points','2 only with HL Maths 4+','24 can’t be compared'];
  const {next,doneScreen}=realSetup(h,{shown:36,summary});
  next(); const points=get('ob-points'); points.value='30'; fire(points,'input'); next(); next(); next(); next();
  return doneScreen()?.count === '36 programmes shown · 10 within your IB points · 2 only with HL Maths 4+ · 24 can’t be compared';
});
// Review of list-perf (2026-11-09): the done screen ran one digit-regex over
// the lead AND the summary parts, which pointsSummaryParts had already grouped,
// so "1,033" became "1,33" and Slovak "1 033" lost its group. Only the lead is
// formatted there now.
for (const [lang, sep] of [['en', ','], ['sk', ' ']]) appCheck(`B3C1 the done screen keeps a grouped count in the points parts intact: ${lang}`, (h) => {
  const {get,fire}=h, many=Array.from({length:1033},()=>({ibPointsMin:null}));
  i18n.setLanguage(lang,{setItem(){}});
  try {
    const summary=filtersMod.pointsSummaryParts(many,fstate(36)).map((p)=>p.text);
    const {next,doneScreen}=realSetup(h,{shown:1033,summary});
    next(); const points=get('ob-points'); points.value='30'; fire(points,'input'); next(); next(); next(); next();
    const count=doneScreen()?.count.replace(/[  ]/g,' ');
    return count === [i18n.t('r3_ob_done_count',{count:1033}).replace('1033',`1${sep}033`), ...summary].join(' · ').replace(/[  ]/g,' ')
      && count.includes(`1${sep}033 `) && !/(^|\D)33(\D|$)/.test(count);
  } finally { i18n.setLanguage('en',{setItem(){}}); }
});
// Review of PR 1 (2026-11-07): setup's last line named Filters, which only
// phones have, and "Your existing filters still apply" showed with none on.
for (const [name, opts, answers, key] of [
  ['answers, from 600 px', {}, true, 'r5_ob_done_p_wide'], ['answers, phone', {phone:true}, true, 'r3_ob_done_p'],
  ['no answers, a filter on, from 600 px', {filtered:true}, false, 'r5_ob_done_p_none_wide'], ['no answers, a filter on, phone', {filtered:true,phone:true}, false, 'r3_ob_done_p_none'],
  ['no answers, no filter, from 600 px', {}, false, 'r5_ob_done_p_empty_wide'], ['no answers, no filter, phone', {phone:true}, false, 'r5_ob_done_p_empty'],
]) appCheck(`B3C1 the done screen's filters line: ${name}`, (h) => {
  const {get,fire}=h, {next,doneScreen}=realSetup(h,opts);
  next(); if (answers) { const points=get('ob-points'); points.value='30'; fire(points,'input'); } next(); next(); next(); next();
  const d=doneScreen(), still=['r3_ob_done_p_none','r5_ob_done_p_none_wide'].some((k)=>d?.text.includes(t(k)));
  return !!d && d.text.includes(t(key)) && still === !!opts.filtered && !answers === (d.heading === t('r3_ob_done_h_none'));
});
// Verification of PR 1: with only Search on, phones said "Your existing
// filters still apply … in Filters", but Search is in the header, not Filters.
for (const [name, phone, key] of [['phone', true, 'r5_ob_done_p_empty'], ['from 600 px', false, 'r5_ob_done_p_none_wide']])
  appCheck(`the done screen with only Search on: ${name}`, (h) => {
    const {next,doneScreen}=realSetup(h,{filtered:true,sheetFiltered:false,phone});
    next(); next(); next(); next(); next();
    const d=doneScreen(); return !!d && d.text.includes(t(key)) && (phone ? !d.text.includes(t('r3_ob_done_p_none')) : true);
  });
check('the app tells setup whether a Filters-sheet filter (not Search) is on', /sheetFiltered: active - \(state\.search\.trim\(\) \? 1 : 0\) > 0/.test(read('js/app.js')));
appCheck('B3C1 the done screen\'s filters line follows a crossing of 600 px', (h) => {
  const phone = { matches: false, addEventListener(type, listener) { this.change = listener; } };
  const {next,doneScreen}=realSetup(h,{env:{matchMedia:()=>phone}});
  for (let i = 0; i < 5; i++) next();
  if (!doneScreen()?.text.includes(t('r5_ob_done_p_empty_wide'))) return false;
  phone.matches = true; phone.change();
  return doneScreen().text.includes(t('r5_ob_done_p_empty')) && !doneScreen().text.includes(t('r5_ob_done_p_empty_wide'));
});
appCheck('B3C1 each step heading is described by its "Step n of 5", so focus on it reads the step', (h) => {
  const {dialog,next}=realSetup(h);
  const steps=[];
  for (let i = 0; i < 5; i++) { const head=dialog.querySelector('#ob-title'), label=dialog.querySelector('.ob-n'); steps.push(!!label && head.getAttribute('aria-describedby')===label.id && label.id==='ob-step-n' && stubDocument.activeElement===head && label.textContent===t('r2_step',{step:i+1})); next(); }
  return steps.every(Boolean) && !dialog.querySelector('#ob-title').getAttribute('aria-describedby');
});
{
  const sk = (key, vars) => { i18n.setLanguage('sk', { setItem() {} }); try { return t(key, vars); } finally { i18n.setLanguage('en', { setItem() {} }); } };
  equal('B3C1 setup copy: step 2 says points hide programmes above the total; the filters line by width and filter (EN, SK)',
    ['r2_ob2p', 'r5_ob_done_p_wide', 'r5_ob_done_p_none_wide', 'r5_ob_done_p_empty', 'r5_ob_done_p_empty_wide'].flatMap((k) => [t(k), sk(k)]),
    ['We’ll hide programmes above your total and mark the rest.', 'Programy nad tvojím počtom bodov skryjeme, ostatné označíme.',
      'You can change these filters any time above the list.', 'Tieto filtre môžeš kedykoľvek zmeniť nad zoznamom.',
      'Your existing filters still apply. You can change them any time above the list.', 'Tvoje doterajšie filtre stále platia. Kedykoľvek ich môžeš zmeniť nad zoznamom.',
      'You can set filters any time in Filters.', 'Filtre si môžeš kedykoľvek nastaviť vo Filtroch.',
      'You can set filters any time above the list.', 'Filtre si môžeš kedykoľvek nastaviť nad zoznamom.']);
  equal('B3C1 the points count with SK parts reads naturally', [sk('r3_ob_done_count', { count: 36 }), sk('within_your_ib_points_2', { value1: 10 })],
    ['36 zobrazených programov', '10 v rámci tvojich IB bodov']);
}

// C2: the logo goes home (Leon, 2026-11-05). goHome() leaves My list, a shared
// list and Compare; filters, search, sort, saves and the pane's pick stay.
// Batch 2 A2 kept the list view; this reverses it. The scroll, the hash and the
// focus on .mark are checked on the real handler above (logoClick).
appCheck('B3C2 home from My list: the main list, with filters, sort, saves and the pick unchanged', ({ run, ids: [a, b] }) => {
  run(`shortlist.add('${a}'); shortlist.add('${b}'); state.myIbPoints = 36; state.sort = 'name'; state.dir = 'desc'; state.shortlistOnly = true; update(); selectedId = '${a}';`);
  if (run('state.shortlistOnly') !== true) return false;
  run('goHome();');
  return run('state.shortlistOnly') === false && run('listAll') === false && run('state.myIbPoints') === 36 && run('state.sort') === 'name' && run('state.dir') === 'desc'
    && run('shortlist.size') === 2 && run('selectedId') === a && run('currentlyShown') === 3;
});
appCheck('B3C2 home from a shared list: shared is gone and list= leaves the address, filters stay', ({ run, context, ids: [a, b] }) => {
  const urls = []; context.history.replaceState = (s, t, u) => { urls.push(u); context.location.search = new URL(u, 'http://localhost').search; };
  run(`shared = { ids: ['${a}', '${b}'], unknown: [] }; state.shortlistOnly = true; state.myIbPoints = 36; update();`);
  if (!urls.at(-1)?.includes('list=')) return false;
  run('goHome();');
  return run('shared') === null && run('state.shortlistOnly') === false && !urls.at(-1).includes('list=') && urls.at(-1).includes('points=36') && !urls.at(-1).includes('#');
});
appCheck('B3C2 home from Compare: the view closes and the list shows; open panels close', ({ run, get }) => {
  run('compareOpen = true; dom.compare.hidden = false; dom.split.hidden = true;');
  get('ml-share').open = true; get('dd-countries').open = true;
  run('goHome();');
  return run('dom.compare.hidden') === true && run('dom.split.hidden') === false && get('ml-share').open === false && get('dd-countries').open === false;
});
check('B3C2 the app passes goHome to the compact header', /wireCompactHeader\(dom, \{ goHome \}\);/.test(appSrc));
check('B3C2 the compact header no longer takes the logo out of the tab order', !/\.mark'\)\.tabIndex = allowed/.test(read('js/round2.js')));
// 2026-11-08: the phone tile is out of the flow, over the row's left edge,
// hidden until the handover shows it; the count keeps the 50 px on its right.
check('B3C2 from 600 px the tile stays and only the wordmark fades; the slot is 94 px at 600–700 px; the phone tile lies over the stuck row\'s left edge',
  /body\.compact \.mark\{opacity:1;transform:none;pointer-events:auto\}\s*body\.compact \.mark h1\{opacity:0;transform:translateY\(-4px\);pointer-events:none\}/.test(cssText)
  && /@media \(min-width:600px\) and \(max-width:700px\)\{\s*\.slot\{width:94px\}\s*\.mark\{width:44px;justify-content:center\}\s*\.filters-btn\{left:50px;width:44px\}/.test(cssText)
  && /\.home-tile\{display:none\}\s*@media screen and \(max-width:599\.98px\)\{\s*\.status \.home-tile\{display:flex;[^}]*position:absolute;left:var\(--gut\);top:0;bottom:0;margin-block:auto;width:44px;height:44px;[^}]*opacity:0;visibility:hidden\}/.test(cssText)
  && /transform:scale\(\.818\)/.test(ruleAt(cssText, '.status .home-tile .mono', 'screen and (max-width:599.98px)'))
  && /margin-right:50px/.test(ruleAt(cssText, '.status .count', 'screen and (max-width:599.98px)'))
  && !/\.is-stuck \.home-tile/.test(cssText));

// Leon, iPhone, 2026-11-08: the stuck row's tile came in late and pushed the
// count right; on the way up both logos showed. Then, from mockups, option C:
// the header logo holds its spot while the header leaves, shrinks to 36 px and
// lands where the row's tile sits, which takes over at that pixel when the row
// sticks; the count glides 50 px right in the first 16 px of scroll. One scroll
// timeline (the 1 px mark) drives it all. Reduced motion: no glide or shrink,
// the count waits one tile in and the tile is a cut. Smoke runBatch3C measures
// it frame by frame in Chrome, natively and with the fallback forced.
{
  const phone = 'screen and (max-width:599.98px)', sup = '@supports (timeline-scope:--a) and (animation-timeline:--a)', off = ':root:not([data-handover=frames]) ';
  const inSup = (sel, mediaFirst) => cssTree(cssText).filter((r) => r.selector.trim() === sel && r.media.join('|') === (mediaFirst ? [`@media ${mediaFirst}`, sup] : [sup, `@media ${phone}`]).join('|')).map((r) => r.body).join(';');
  const logo = inSup(off + '.hd .mark'), mono = inSup(off + '.hd .mono'), tile = inSup(off + '.status .home-tile'), count = inSup(off + '.status .count');
  const rTile = inSup(off + '.status .home-tile', 'screen and (max-width:599.98px) and (prefers-reduced-motion:reduce)');
  const kf = (name) => (cssText.match(new RegExp(`@keyframes ${name}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`)) || [])[1] || '';
  check('B3C2b phones: the logo travels into the row on one scroll timeline: glued while the header leaves, 36 px at the stick, then the tile at the same scroll position; the count glides first; reduced motion is a cut',
    /timeline-scope:--stuck/.test(inSup('.page')) && /view-timeline:--stuck block/.test(inSup('.stuck-mark'))
      && /animation:logo-travel linear both,logo-off step-end both;animation-timeline:--stuck,--stuck;animation-range:cover calc\(100% - var\(--logo-travel\)\) cover 100%,cover calc\(100% - 1px\) cover 100%/.test(logo)
      && /animation:logo-shrink linear both;animation-timeline:--stuck;animation-range:cover calc\(100% - 22px\) cover 100%/.test(mono)
      && /animation:tile-on step-end both;animation-timeline:--stuck;animation-range:cover calc\(100% - 1px\) cover 100%/.test(tile)
      && /animation:count-glide linear\(0,\.93 80%,1\) both;animation-timeline:--stuck;animation-range:cover calc\(100% - var\(--logo-travel\)\) cover calc\(100% - var\(--logo-travel\) \+ 16px\)/.test(count)
      && /animation:tile-on step-end both !important;animation-timeline:--stuck !important;animation-range:cover calc\(100% - 1px\) cover 100% !important/.test(rTile)
      && /transform:translateX\(50px\)/.test(ruleAt(cssText, '.status .count', 'screen and (max-width:599.98px) and (prefers-reduced-motion:reduce)'))
      && kf('logo-travel') === 'from{transform:none}to{transform:translateY(calc(var(--logo-travel) + var(--logo-dock)))}'
      && kf('logo-shrink') === 'from{transform:none}to{transform:scale(.818)}'
      && kf('logo-off') === 'from{opacity:1}to{opacity:0}'
      && kf('tile-on') === 'from{opacity:0;visibility:hidden}to{opacity:1;visibility:visible}'
      && kf('count-glide') === 'from{transform:none}to{transform:translateX(50px)}'
      && /animation:none/.test(inSup('.page:has(.stream>#compare:not([hidden]),.status[hidden]) :is(.hd .mark,.hd .mono)'))
      && /--logo-travel:57px;--logo-dock:0px/.test(ruleAt(cssText, '.page', phone))
      && /padding-block:6px/.test(ruleAt(cssText, '.status', phone)) && /padding:6px var\(--gut\)/.test(ruleAt(cssText, '.status.is-stuck'))
      && /min-height:var\(--ctl\);line-height:20px/.test(ruleAt(cssText, '.status.is-stuck .cshort', phone)),
    JSON.stringify({ logo, mono, tile, count, rTile }));
}

// The keyframes need two distances CSS cannot know (a data banner pushes the
// row down; a three-line 320 px Slovak count makes the row taller), and Safari
// before 26 has no scroll timelines: round2.js measures the distances, and
// there runs option B frame by frame from the same clock. Run here against a
// fake page, with and without scroll-timeline support.
{
  const round2Src = read('js/round2.js');
  const handoverSrc = round2Src.slice(round2Src.indexOf('export function wireLogoHandover'), round2Src.indexOf('export function syncSegments'));
  const run = ({ native, reduced = false, phone = true, statusShown = true }) => {
    const style = () => { const s = {}; return { s, setProperty(k, v) { s[k] = v; }, removeProperty(k) { delete s[k]; }, get opacity() { return s.opacity; }, set opacity(v) { s.opacity = v; }, get visibility() { return s.visibility; }, set visibility(v) { s.visibility = v; }, get transform() { return s.transform; }, set transform(v) { s.transform = v; } }; };
    const node = (props = {}) => ({ style: style(), offsetTop: 0, offsetHeight: 0, offsetParent: null, ...props });
    const body = node(), hd = node({ offsetTop: 0, offsetParent: body }), slot = node({ offsetTop: 6, offsetParent: hd }), logo = node({ offsetTop: 0, offsetParent: slot });
    const status = node({ offsetTop: 57, offsetParent: body }), tile = node({ offsetTop: 14, offsetParent: statusShown ? status : null });
    const counts = [node(), node()], banner = node();
    let markBottom = 57;
    const stuckMark = node({ offsetTop: 56, offsetHeight: 1, offsetParent: body, getBoundingClientRect: () => ({ bottom: markBottom }) });
    status.querySelector = (sel) => sel === '.home-tile' ? tile : null;
    status.querySelectorAll = (sel) => sel === '.count' ? counts : [];
    hd.querySelector = (sel) => sel === '.mark' ? logo : null;
    const root = { dataset: {} }, listeners = {}, frames = [];
    const env = {
      document: { body, documentElement: root, querySelector: (sel) => sel === '.hd' ? hd : null },
      ResizeObserver: class { observe() {} },
      CSS: { supports: (q) => native && /timeline/.test(q) },
      matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? reduced : phone, addEventListener() {} }),
      addEventListener: (type, fn) => { listeners[type] = fn; },
      requestAnimationFrame: (fn) => frames.push(fn),
    };
    const wire = runInNewContext(handoverSrc.replace(/^export /, '') + '\nwireLogoHandover;', env);
    wire({ status, stuckMark, banner });
    const at = (bottom) => { markBottom = bottom; listeners.scroll?.(); while (frames.length) frames.shift()(); return { logo: { ...logo.style.s }, tile: { ...tile.style.s }, count: counts[0].style.s.transform }; };
    return { body: body.style.s, root, listeners, at };
  };
  const nat = run({ native: true });
  const fb = run({ native: false });
  const steps = []; for (let d = -60; d <= 20; d++) steps.push([d, fb.at(-d)]);
  const both = steps.filter(([, f]) => Number(f.logo.opacity) > 0 && f.logo.visibility !== 'hidden' && Number(f.tile.opacity) > 0 && f.tile.visibility !== 'hidden');
  const slide = steps.map(([, f]) => Number((f.count || 'translateX(0px)').match(/-?[\d.]+/)[0]));
  const jumps = slide.slice(1).map((x, i) => Math.abs(x - slide[i]));
  const red = run({ native: false, reduced: true });
  const redSteps = [-30, -1, 0, 1, 30].map((d) => [d, red.at(-d)]);
  const hidden = run({ native: false, statusShown: false });
  const hiddenAt = hidden.at(-10);
  check('B3C2c phones: round2.js measures --logo-travel (where the row sticks) and --logo-dock (the tile\'s drop); with scroll timelines it adds nothing else',
    nat.body['--logo-travel'] === '57px' && nat.body['--logo-dock'] === '8px' && nat.root.dataset.handover === undefined && !nat.listeners.scroll
      && /wireLogoHandover\(dom\);/.test(appSrc) && /export function wireLogoHandover/.test(round2Src),
    JSON.stringify(nat.body));
  check('B3C2d without scroll timelines: option B frame by frame from one clock: the logo fades out first, the count slides 50 px without a jump, the tile fades in; never both; reduced motion is one cut for both at the stick; no row, no handover',
    fb.root.dataset.handover === 'frames' && typeof fb.listeners.scroll === 'function'
      && both.length === 0 && slide[0] === 0 && slide.at(-1) === 50 && Math.max(...jumps) <= 4
      && steps.find(([d]) => d === -20)[1].logo.opacity === '0' && steps.find(([d]) => d === -8)[1].tile.visibility === 'hidden'
      && steps.find(([d]) => d === 12)[1].tile.opacity === '1'
      && redSteps.every(([d, f]) => f.tile.opacity === (d >= 0 ? '1' : '0') && f.logo.opacity === (d >= 0 ? '0' : '1') && f.count === undefined)
      && hiddenAt.logo.opacity === undefined && hiddenAt.tile.opacity === undefined,
    JSON.stringify({ both: both.slice(0, 2), maxJump: Math.max(...jumps), red: redSteps, hiddenAt }));
}

section('Alignment · list, detail, Compare');
// The 2026-11-05 alignment audit (list-detail and compare findings). Layout is
// measured in Chrome (smoke runAlignListCompare); these pin the rules and the
// one DOM change, so a later edit cannot quietly undo them.
{
  const block = cssText.slice(cssText.indexOf('.deg,.d-title .deg{'), cssText.indexOf('.r-main{grid-template-columns:minmax(0,1fr) auto auto;'));
  check('AL degree: wraps inside itself as one unit, never nowrap past the pane or the row (Slovak long-cycle degree, 384 px)',
    /\.deg,\.d-title \.deg\{display:inline-block;max-width:100%;white-space:normal;overflow-wrap:normal\}/.test(block));
  check('AL faculty identity wraps only between words instead of shrinking into word fragments',
    /\.sub \.identity\{overflow-wrap:normal\}/.test(block));
  check('AL row labels start with the value text (the cell padding), the fee label ends with it',
    /\.row \.cell \.lab\{padding-left:inherit\}\s*\.row \.c-fee \.lab\{padding-left:0;padding-right:inherit\}/.test(block));
  check('AL row toggles centre on the title\'s first line, out-ranking the old -4 px margin',
    /\.r-main>:is\(\.cmpi,\.star\)\{margin-top:calc\(var\(--fs-16\) \* 1\.35 \/ 2 - 22px\)\}/.test(block)
    && /@media \(pointer:coarse\)\{\s*\.r-main>:is\(\.star,\.cmpi\):hover\{background:none\}/.test(block));
  check('AL the last open row is clipped to the card corners; a sort heading is as wide as its label',
    /#results>\.item:last-child>\.expand>\.expand-inner\{border-radius:0 0 calc\(var\(--r-panel\) - 1px\)/.test(block)
    && /@container \(min-width: 800px\)\{\.cols>button\{justify-self:start\}\}/.test(block) && /\.expand-inner\{min-height:0;overflow:hidden\}/.test(cssText));
  check('AL detail pair: labels break only between words; stacked below 450 px of footer (330 px in English); equal icons',
    /\.d-foot\{container:dfoot \/ inline-size\}\s*\.d-actions \.btn\{overflow-wrap:normal\}\s*\.d-actions :is\(\.save,\.cmpb\) \.ic\{width:18px;height:18px\}/.test(block)
    && /@container dfoot \(max-width: 449\.98px\)\{\.d-foot>\.d-actions\{grid-template-columns:minmax\(0,1fr\)\}\}/.test(block)
    && /@container dfoot \(min-width: 330px\)\{\.d-foot>\.d-actions:lang\(en\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/.test(block));
  check('AL compare Save sits at the foot of every header cell, one width; columns keep room for it from 600 px',
    /\.cmp-t th\.cmp-p\{padding-bottom:66px\}/.test(block) && /\.cmp-t th\.cmp-p \.cmp-save\{position:absolute;left:12px;bottom:10px;/.test(block)
    && /@media \(min-width:600px\)\{\s*\.cmp-t th\.cmp-p\{min-width:110px\}\s*\.cmp-t th\.cmp-p \.cmp-save\{width:86px;border-radius:8px\}\s*\}/.test(block));
  check('AL compare "x": its own strip below 1024 px, 4 px from the cell edge so its focus ring is not clipped',
    /@media \(max-width:1023\.98px\)\{\s*\.cmp \.cmp-t th\.cmp-p::before\{display:none\}\s*\.cmp-t th\.cmp-p\{padding-top:44px\}\s*\}/.test(block)
    && /\.cmp-x\{position:absolute;top:4px;right:4px;/.test(cssText));
  check('AL compare fact names are 6.5rem from 600 to 1023 px; one programme sizes its column to its facts',
    /@media \(min-width:600px\) and \(max-width:1023\.98px\)\{\.cmp \.cmp-t tbody th,\.cmp \.cmp-t \.cmp-c\{width:6\.5rem;padding-inline:10px\}\}/.test(block)
    && /@media \(min-width:600px\)\{\.cmp-t\[data-n="1"\]\{width:auto\}\}/.test(block));
  // Review of PR 1: as display:inline its padding never counted, so the
  // link was 42 px with a coarse pointer; it is an inline-block of --tap.
  check('AL compare: shared first baseline, the link wraps as text in an inline-block at least --tap tall, 44 px Close and Browse, landing clear of what sticks',
    /\.cmp \.cmp-t tbody th\{line-height:20px\}/.test(block) && /\.cmp-t \.lnk\{display:inline-block;min-height:var\(--tap\);padding-block:calc\(\(var\(--tap\) - 20px\) \/ 2\);margin-block:calc\(\(20px - var\(--tap\)\) \/ 2\);line-height:20px\}/.test(block) && /\.cmp-t \.lnk-end\{white-space:nowrap\}/.test(block)
    && /#cmp-close,#cmp-browse\{height:44px\}/.test(block) && /\.cmp\{scroll-margin-top:calc\(var\(--header-visible\) \+ 8px\)\}/.test(block)
    && /@media \(max-width:599\.98px\)\{\.cmp\{scroll-margin-top:calc\(var\(--count-height\) \+ 8px\)\}\}/.test(block));
  // Review of PR 1: visibility:hidden kept the count's width, a gap before
  // "Edit my answers" on desktop; display:none takes it out of the row.
  check('AL while Compare is open the list count is not shown and keeps no width; toast actions are one line and 44 px wide; print keeps no room for Save',
    /\.stream:has\(>#compare:not\(\[hidden\]\)\) :is\(#result-count,\.status \.cshort\)\{display:none\}/.test(block) && !/visibility:hidden/.test(block)
    && /\.toast button\{flex:none;min-width:44px;white-space:nowrap\}/.test(block)
    && /@media print\{\.cmp \.cmp-t th\.cmp-p\{padding-block:10px\}\.cmp \.cmp-t \.lnk \.ic\{display:none\}\}/.test(block));
  // The section must sit before Batch 3 · A, whose later rules it does not
  // override by order: each override above wins by specificity instead.
  check('AL the section sits just above Batch 3 · A', css.indexOf('/* Alignment fixes · list, detail, Compare */') > 0
    && css.indexOf('/* Alignment fixes · list, detail, Compare */') < css.indexOf('/* Batch 3 · A: Compare */'));
  const rows = [live.find((r) => r.officialUrl), live.filter((r) => r.officialUrl)[1]];
  const box = withStubDocument(() => { const div = new ChromeNode('div'); renderCompare(div, rows, compareMod.compareTable(rows, noFilters()), { onlyDifferences: false }); return div; });
  const links = findAll(box, (n) => n.tagName === 'a' && n.classList.contains('lnk'));
  check('AL compare link: the last word and its icon share a no-wrap span, before the hidden "opens in a new tab"; the text reads as before',
    links.length === 2 && links.every((a) => {
      const [text, end, hidden] = a.children;
      return text === 'Official admissions ' && end.classList?.contains('lnk-end') && end.children[0] === 'page' && end.children[1]?.tagName === 'svg'
        && hidden.classList?.contains('visually-hidden') && a.children.length === 3
        && a.textContent.startsWith('Official admissions page');
    }), JSON.stringify(links.map((a) => a.children.map((c) => typeof c === 'string' ? c : c.className))));
}

// Alignment audit fixes (2026-11-05, Leon: "all is aligned"). Layout is
// measured in Chrome by runAlignChromeSetup in tools/smoke.mjs; these pin the
// rules so a later edit cannot quietly undo them.
section('Alignment · header, My list, setup');
{
  const round2Src = read('js/round2.js');
  check('AL-H1 Search shows its long hint only where it fits whole, measured with offsetWidth, re-measured on field resize, font load and every update',
    /innerWidth >= 600 && longHintFits\(dom\.search\) \? 'r2_searchph' : 'search_2'/.test(round2Src)
    && /input\.offsetWidth - \[borderLeftWidth, borderRightWidth, paddingLeft, paddingRight\]/.test(round2Src) && !/input\.clientWidth/.test(round2Src)
    && /new ResizeObserver\(\(\) => searchPlaceholder\(\)\)\.observe\(dom\.search\)/.test(round2Src)
    && /fonts\?\.ready\?\.then\(\(\) => searchPlaceholder\(\)\)/.test(round2Src)
    && /syncSegments\(\);\s*searchPlaceholder\(\);/.test(round2Src)
    && /text-overflow:ellipsis/.test(ruleAt(cssText, '.search .inp'))
    && /display:none/.test(ruleAt(cssText, '.search kbd', '(min-width:600px) and (max-width:700px)')));
  check('AL-H1 without canvas measurement Search falls back to its short hint', (() => {
    const measure = (createElement) => runInNewContext(round2Src.replace(/^import[^;]+;\n/gm, '').replace(/^export /gm, '') + '\nlongHintFits;', { document: { createElement } });
    return [() => ({ getContext: () => null }), () => { throw new Error('canvas unavailable'); }]
      .every(create => measure(create)({}) === false);
  })());
  check('AL-H2 phones: no doubled hairline under the header (empty filter band and the stuck-row marker)',
    /border-bottom:0/.test(ruleAt(cssText, '.fslot', '(max-width:599.98px)'))
    && /margin-inline:calc\(-1 \* var\(--gut\)\);background:var\(--panel\)/.test(ruleAt(cssText, '.stuck-mark', '(max-width:599.98px)')));
  check('AL-H3 Filters sheet: Edit my answers comes first and its text, Copy link and its help share one left edge; the points label wraps before the field shrinks',
    /<div class="more-filters"><button type="button" class="btn btn-a sheet-edit" data-edit/.test(read('index.html'))
    && /margin-left:-15px/.test(ruleAt(cssText, '.sheet-b .sheet-edit')) && /margin:0/.test(ruleAt(cssText, '.sheet-b .copy'))
    && !/margin-top:12px/.test(ruleAt(cssText, '.sheet-b .copy', '(max-width: 599.98px)'))
    && /flex:1 1 0;white-space:normal/.test(ruleAt(cssText, '.sheet-b .pts>label')) && /min-width:64px/.test(ruleAt(cssText, '.sheet-b .pts input.inp')));
  check('AL-H4 focus rings: the wordmark link has room after "Finder"; settings radios draw theirs inside the visible label',
    /padding-right:6px/.test(ruleAt(cssText, 'body:not(.compact) .mark', '(min-width:701px)'))
    && /outline-offset:-3px/.test(ruleAt(cssText, '.settings-seg label:has(input:focus-visible)')));
  // Review of PR 1: the -15 px margin puts the button 1 px from the sheet's
  // scrolling edge, which cut off the left of its 2 px ring at offset 2.
  check('AL-H4 Edit my answers in the sheet draws its focus ring inside the button, so the sheet does not clip it',
    /margin-left:-15px/.test(ruleAt(cssText, '.sheet-b .sheet-edit')) && /outline-offset:-3px/.test(ruleAt(cssText, '.sheet-b .sheet-edit:focus-visible')));
}

{
  const html = read('index.html');
  check('AL-M1 My list from 600 px: Clear is a small outlined button at the right end; Group by has its own row to 1023 px; the CSV note is its own line',
    /height:var\(--tap\);margin-left:auto;padding:0 10px;border:1px solid var\(--edge\)/.test(ruleAt(cssText, '.mylist .ml-tools>#clear-shortlist', '(min-width:600px)'))
    && /flex:0 0 100%;display:flex/.test(ruleAt(cssText, '.ml-group', '(min-width:600px) and (max-width:1023.98px)'))
    && /flex:0 0 100%/.test(ruleAt(cssText, '.ml-tools>.ml-export-note')));
  check('AL-M2 the CSV note is hidden with Export on a shared list',
    /<p class="help ml-mine ml-export-note" data-i18n="export_note">/.test(html));
  check('AL-M3 phones: one-line tool labels (SK "Vymazať zoznam", no icons under 360 px), centred if a label still wraps',
    UI.sk.clear_my_list === 'Vymazať zoznam'
    && /display:none/.test(ruleAt(cssText, '.mylist.is-list .ml-tools>#clear-shortlist>.ic', '(max-width:359.98px)'))
    && /padding-inline:6px/.test(ruleAt(cssText, '.mylist.is-list .ml-tools>#clear-shortlist.btn', '(max-width:359.98px)'))
    && /flex-wrap:wrap;align-content:center/.test(ruleAt(cssText, '.mylist.is-list .ml-tools>.btn', '(max-width:599.98px)')));
}
appCheck('AL-M4 an empty My list has one way back, the empty card\'s button; the bar\'s back button returns with saves', ({ run, get, fire }) => {
  // The empty card's button clicks the bar's; the stand-in nodes lack click().
  const hadClick = Object.hasOwn(ChromeNode.prototype, 'click');
  if (!hadClick) ChromeNode.prototype.click = function () { fire(this, 'click'); };
  try { return flow(); } finally { if (!hadClick) delete ChromeNode.prototype.click; }
  function flow() {
  fire(get('f-shortlist-only'), 'click');
  if (run('state.shortlistOnly') !== true || get('empty-back').hidden || !get('f-shortlist-only').hidden) return false;
  fire(get('empty-back'), 'click');
  run('shortlist.add(fixture[0].id); update();');
  fire(get('f-shortlist-only'), 'click');
  return run('state.shortlistOnly') === true && !get('f-shortlist-only').hidden && get('empty-state').hidden;
  }
});
check('AL-M5 the empty list card lines up with the pane, and the bar is joined only to a shown list',
  /margin-top:0/.test(ruleAt(cssText, '.mylist:not([hidden]) ~ .split .empty'))
  && /border-bottom:0/.test(ruleAt(cssText, '.mylist.is-list:has(~ .split:not([hidden]) .listp:not([hidden]))', '(max-width: 599.98px)')));

appCheck('AL-S3 setup footer follows visual order on phones and preserves focus across the breakpoint', (h) => {
  const phone = { matches: true, addEventListener(type, listener) { this.change = listener; } };
  const { dialog, primary, next } = realSetup(h, { env: { matchMedia: () => phone } });
  next();
  const foot = dialog.querySelector('.ob-foot');
  if (foot.querySelector('button') !== primary()) return false;
  primary().focus();
  phone.matches = false; phone.change();
  if (foot.children.at(-1) !== primary() || stubDocument.activeElement !== primary()) return false;
  phone.matches = true; phone.change();
  return foot.querySelector('button') === primary() && stubDocument.activeElement === primary();
});
check('AL-S1 setup: the step column never outgrows the dialog; the switch label wraps',
  /grid-template-columns:minmax\(0,1fr\)/.test(ruleAt(cssText, '.ob-step.on')) && /white-space:normal/.test(ruleAt(cssText, '.ob .switch')));
check('AL-S2 setup: Next full width on top on phones, 44 px buttons, no done-screen gap, the hint clear of Skip\'s ring',
  /order:-1;flex:0 0 100%;margin-left:0/.test(ruleAt(cssText, '.ob-foot:not(.ob-done-foot)>.btn-p', '(max-width:599.98px)'))
  && /height:44px/.test(ruleAt(cssText, '.ob-foot .btn')) && /min-height:0/.test(ruleAt(cssText, '.ob .ob-body:has(.ob-done)'))
  // Leon, 2026-11-09 (option B): the hint is a second line inside Skip, which stacks its two lines.
  && /flex-direction:column/.test(ruleAt(cssText, '.skipwrap .btn.btn-q')) && !ruleAt(cssText, '.skipwrap small')
  && /skipButton\.append\(el\('small', '', t\('r2_skip_sub'\)\)\)/.test(read('js/onboarding.js'))
  && /outline-offset:-3px/.test(ruleAt(cssText, '.skipwrap .btn.btn-q:focus-visible')));
// The footer heading's alignment with the first question went with the footer FAQ (2026-11-09).
check('AL-F1 FAQ: the "+" sits on the first line\'s centre; the footer heading no longer lines up with a footer FAQ',
  /margin-top:calc\(\.5lh - 8px\)/.test(ruleAt(cssText, '.faq summary>.ic')) && !ruleAt(cssText, '.foot h2', '(min-width:600px)'));

section("Phone My list and Compare, 2026-11-06");
// Leon (iPhone 16, 393 x 852): the phone My list box took half the screen,
// and Compare looked rough. Layout is measured in Chrome by smoke
// runPhoneMyListCompare; these pin the markup, the state and the rules.
{
  const phone = '(max-width:599.98px)';
  const rawHtml = read('index.html');
  const pmCss = css.slice(css.indexOf('/* ------------------------------------------------- Phone My list and Compare, 2026-11-06 */'),
    css.indexOf("/* ------------------------------------------------- Leon's review, 2026-11-06 */"));
  check('PM0 the section sits just above Leon\'s review', pmCss.length > 0
    && css.indexOf('Phone My list and Compare, 2026-11-06 */') < css.indexOf("Leon's review, 2026-11-06 */"));
  check('PM1 My list has a phone-only More toggle in its first row, closed, controlling the tools, in EN and SK',
    /<div class="ml-row">[\s\S]*?<button type="button" id="ml-more" class="btn btn-s ml-more" aria-expanded="false" aria-controls="ml-tools" hidden><span data-i18n="ml_more">More<\/span>[\s\S]*?<\/div>\s*<p class="ml-note"/.test(rawHtml)
    && UI.en.ml_more === 'More' && UI.sk.ml_more === 'Viac'
    && /display:none/.test(ruleAt(cssText, '.ml-more')) && /display:inline-flex/.test(ruleAt(cssText, '.mylist.is-list .ml-more:not([hidden])', phone)));
  check('PM2 phones: while More is closed Share, Export, Print, Clear and both footnotes are hidden; Group by never is',
    /@media \(max-width:599\.98px\)\{[^@]*\.mylist\.is-list:not\(\.ml-more-open\) :is\(#ml-share,\.ml-tools>\.ml-mine,#ml-origin\)\{display:none\}/.test(pmCss)
    && /class="btn btn-s ml-mine"[^>]*id="export-csv"|id="export-csv" class="btn btn-s ml-mine"/.test(rawHtml)
    && /id="print-shortlist" class="btn btn-s ml-mine"/.test(rawHtml) && /id="clear-shortlist" class="btn btn-q ml-mine"/.test(rawHtml)
    && /class="help ml-mine ml-export-note"/.test(rawHtml) && !/ml-group/.test(pmCss));
  check('PM3 phones: Back and More share the first line (Back gives way, never More), and the title starts the next',
    /flex:1 1 0;min-width:0/.test(ruleAt(cssText, '.mylist.is-list .ml-open', phone))
    && /order:-1/.test(ruleAt(cssText, '.mylist.is-list .ml-more:not([hidden])', phone)) && /flex:none/.test(ruleAt(cssText, '.mylist.is-list .ml-more:not([hidden])', phone))
    && /content:"";flex:0 0 100%;height:0/.test(ruleAt(cssText, '.mylist.is-list .ml-row:has(>.ml-more:not([hidden]))::before', phone)));
}
appCheck('PM4 More opens and closes the list tools, closes Share with it, and is shut and hidden again outside the own list', ({ run, get, fire }) => {
  const more = get('ml-more'), bar = get('shortlist-bar');
  const state = () => [more.hidden, more.getAttribute('aria-expanded'), bar.classList.contains('ml-more-open')].join();
  run('for (const r of fixture) shortlist.add(r.id); update();');
  if (!more.hidden) return false;
  fire(get('f-shortlist-only'), 'click');
  if (state() !== 'false,false,false') return false;
  fire(more, 'click');
  if (state() !== 'false,true,true') return false;
  get('ml-share').open = true;
  fire(more, 'click');
  if (state() !== 'false,false,false' || get('ml-share').open) return false;
  fire(more, 'click');
  fire(get('f-shortlist-only'), 'click');
  if (run('state.shortlistOnly') !== false || state() !== 'true,false,false') return false;
  fire(get('f-shortlist-only'), 'click');
  return state() === 'false,false,false';
});
appCheck('PM5 an empty My list has no More', ({ run, get, fire }) => {
  run('shortlist.add(fixture[0].id); update();');
  fire(get('f-shortlist-only'), 'click');
  fire(get('ml-more'), 'click');
  run('shortlist.clear(); update();');
  return run('state.shortlistOnly') === true && get('ml-more').hidden && get('ml-more').getAttribute('aria-expanded') === 'false'
    && !get('shortlist-bar').classList.contains('ml-more-open');
});
await asyncAppCheck('PM6 a shared list has no More (none of its tools apply)', async ({ run, get, context, settle }) => {
  context.location.search = `?list=${context.fixture[0].id}`;
  context.resolveData({ programmes: context.fixture, meta: { issues: [] } }); await settle();
  return run('state.shortlistOnly') === true && get('ml-title').textContent === 'Shared list' && get('ml-more').hidden;
}, { boot: true });
{
  const rows = [live[0], live[1], live[2]];
  const table = compareMod.compareTable(rows, noFilters());
  const box = withStubDocument(() => { const div = new ChromeNode('div'); renderCompare(div, rows, table, { onlyDifferences: false }); return div; });
  const body = findAll(box, (n) => n.tagName === 'tbody')[0];
  const trs = body.children;
  const pairs = table.map((fact, i) => [trs[2 * i], trs[2 * i + 1], fact]);
  check('PM7 Compare draws each fact\'s name as an aria-hidden line spanning every column, just before the fact\'s own row; the row headers stay',
    trs.length === 2 * table.length && pairs.every(([caption, row, fact]) => caption.classList.contains('cmp-lr') && caption.getAttribute('aria-hidden') === 'true'
      && caption.children.length === 1 && caption.children[0].tagName === 'td' && caption.children[0].getAttribute('colspan') === '4'
      && caption.textContent === fact.label && row.getAttribute('data-fact') === fact.key
      && row.children[0].tagName === 'th' && row.children[0].getAttribute('scope') === 'row' && row.children[0].textContent === fact.label));
  const phone = '(max-width:599.98px)';
  check('PM8 the fact-name line shows only on phones, where the name column shrinks to zero width but stays in the table',
    /display:none/.test(ruleAt(cssText, '.cmp-lr')) && /display:table-row/.test(ruleAt(cssText, '.cmp-t tr.cmp-lr', phone))
    && /width:0;padding:0;border:0;overflow:hidden;white-space:nowrap;clip-path:inset\(50%\)/.test(ruleAt(cssText, '.cmp .cmp-t tbody th', phone))
    && /width:0/.test(ruleAt(cssText, '.cmp .cmp-t .cmp-c', phone)) && !/display:none/.test(ruleAt(cssText, '.cmp .cmp-t tbody th', phone))
    && /position:sticky;left:0/.test(ruleAt(cssText, '.cmp-lr span', phone))
    && /width:150%/.test(ruleAt(cssText, '.cmp-t[data-n="3"]', phone)) && /width:200%/.test(ruleAt(cssText, '.cmp-t[data-n="4"]', phone))
    && /scroll-padding-left:0/.test(ruleAt(cssText, '.cmp-scroll', phone)));
  check('PM9 phones: Save and the "x" share one line at the foot of the programme\'s header; Close and the arrows are quiet like the header buttons',
    /position:absolute;left:12px;right:12px;bottom:8px;display:flex/.test(ruleAt(cssText, '.cmp .cmp-t th.cmp-p .cmp-acts', phone))
    && /position:static/.test(ruleAt(cssText, '.cmp .cmp-t th.cmp-p .cmp-save', phone)) && /position:static/.test(ruleAt(cssText, '.cmp .cmp-t th.cmp-p .cmp-x', phone))
    && /padding:10px 12px 64px/.test(ruleAt(cssText, '.cmp .cmp-t th.cmp-p', phone))
    && /border-color:var\(--hairline\);border-radius:8px/.test(ruleAt(cssText, '#cmp-close', phone))
    && /border-color:var\(--hairline\);border-radius:8px/.test(ruleAt(cssText, '.cmp-nav .btn', phone))
    && /border-bottom:1px solid var\(--hairline\)/.test(ruleAt(cssText, '.cmp-one', phone)));
}

section("Leon's review, 2026-11-06");
// The last value set for a property across every plain rule for a selector:
// later rules win, so an old nowrap above a later normal is fine.
const lastValue = (selector, prop, query) => [...ruleAt(cssText, selector, query).matchAll(new RegExp(`(?:^|;)${prop}:([^;]+)`, 'g'))].at(-1)?.[1];
check('LR1 rows never cut off the university name: the line wraps and the country tag follows inline',
  lastValue('.sub', 'display') === 'block' && lastValue('.sub .uc', 'white-space') === 'normal' && lastValue('.sub .uc', 'overflow') === 'visible');
// A margin-left on the badge stayed when the badge wrapped onto its own line,
// so it sat 6 px in from the name above (smoke BADGE flush measures it).
check('LR1b the country badge has no left margin; its 6 px gap is the end of the university text',
  ['.cc', '.sub .cc', '.row .cc'].every((sel) => !/(?:^|;)margin(?:-left|-inline-start)?:/.test(ruleAt(cssText, sel)))
  && lastValue('.sub .uc', 'margin-right') === '6px');
check('LR2 phones: the header and count row are one block, and the list starts 12 px below it',
  /border-bottom:0/.test(ruleAt(cssText, '.hd', '(max-width:599.98px)'))
  && /border-bottom:1px solid var\(--hairline\);margin-bottom:12px/.test(ruleAt(cssText, '.status', '(max-width:599.98px)')));
// 2026-11-07: the tile grew to 44 px and fills its tap area, so it needs no -4 px nudge;
// a leftover nudge would push the tile 4 px into the margin.
// 2026-11-08 (option C): the row's tile is placed on the margin (left:var(--gut)),
// so the header logo lands on it at the same pixel.
check('LR3 phones: the IB tile sits on the page margin, in the header and the stuck count row',
  /width:44px;height:44px/.test(ruleAt(cssText, '.mono', '(max-width:599.98px),(pointer:coarse)'))
  && !/margin-left:-4px/.test(ruleAt(cssText, '.mark', '(max-width:599.98px)')) && !/margin-left/.test(ruleAt(cssText, '.status .home-tile', 'screen and (max-width:599.98px)'))
  && /left:var\(--gut\);[^;]*;[^;]*;margin-block:auto;width:44px;height:44px/.test(ruleAt(cssText, '.status .home-tile', 'screen and (max-width:599.98px)')));
check('LR5 Sort is the filters\' pick-list: its radios set the hidden select and fire its change; it has no Clear footer',
  /<details class="dropdown sort-dd" id="dd-sort">/.test(indexHtml)
  && /dom\.sort\.value = input\.value;\s*dom\.sort\.dispatchEvent\(new Event\('change'\)\);/.test(appSrc)
  && /function syncSort\(\) \{[\s\S]*?dom\.sort\.value = [^;]+;\s*sortPick\(\);/.test(appSrc)
  && /if \(d\.id !== 'dd-sort'\) \{ footer\.append/.test(read('js/round2.js')));
check('LR6 Language filter options retain their flags, French included',
  /renderChips\(dom\.languages,[^;]*flags: LANGUAGE_FLAGS/.test(appSrc) && /French: 'f-fr'/.test(appSrc) && indexHtml.includes('<symbol id="f-fr"'));
check('LR7 setup\'s done screen names the bookmark and scales icons in both versions, and the FAQ explains My list vs Compare and where the list is kept',
  /el\('p', 'ob-count', count\), doneNote\.node, toolsHint\(\), faqHint\(\)\)/.test(read('js/onboarding.js'))
  && ['r7_faq_list'].every((k) => read("index.html").includes(`data-i18n="${k}"`) && read("index.html").includes(`data-i18n="${k}_a"`))
  && (read('js/i18n.js').match(/"r4_ob_done_tools": "[^"]*\{bookmark\}[^"]*\{scales\}[^"]*"/g) ?? []).length === 2);
// Leon, 2026-11-09: the done screen says the FAQ can be reopened from the
// header's "?", with the icon itself in the sentence, in natural EN and SK.
check('Setup done screen: one line says the "?" at the top reopens the FAQ, with the icon and a spoken name, EN and SK',
  /const faqHint = \(\) => iconHint\('r6_ob_faq_later', 'ob-tools ob-help-hint', \{ '\{help\}': \['#i-help', 'r6_icon_help'\] \}\);/.test(read('js/onboarding.js'))
  && UI.en.r6_ob_faq_later === 'Reopen the FAQ any time with {help} at the top.' && UI.sk.r6_ob_faq_later === 'Časté otázky otvoríš kedykoľvek cez {help} hore.'
  && UI.en.r6_icon_help === 'the question mark' && UI.sk.r6_icon_help === 'otáznik');
check('LR4 "Show the original" has the 8 px corners of the other outlined buttons',
  lastValue('.detail-originals', 'border-radius') === '8px');

section('Compare and header, round 2, 2026-11-06');
// Leon's second look at Compare and the header. Layout is measured in Chrome
// by smoke runCompareHeaderR2; these pin the rules.
{
  const phone = '(max-width:599.98px)';
  const chCss = css.slice(css.indexOf('/* ------------------------------------------------- Compare and header, round 2, 2026-11-06 */'),
    css.indexOf('/* ------------------------------------------------- motion preferences */'));
  check('CH0 the section sits just above the motion preferences', chCss.length > 0
    && css.indexOf('Compare and header, round 2, 2026-11-06 */') > css.indexOf("Leon's review, 2026-11-06 */"));
  check('CH1 phones: while Compare is open the count row is gone, Compare keeps its 12 px gap and opens with it at the top',
    /display:none/.test(ruleAt(cssText, '.stream:has(>#compare:not([hidden]))>.status', phone))
    && /margin-top:12px;scroll-margin-top:12px/.test(ruleAt(cssText, '.stream:has(>#compare:not([hidden]))>.cmp', phone))
    && !/display:none/.test(ruleAt(cssText, '.stream:has(>#compare:not([hidden]))>.status')));
  // 36 px since the footer FAQ went (2026-11-09): the heading lost its 12 px offset.
  check('CH2 from 600 px the footer sits 36 px under an open Compare (heading 44 px under it); under the list it keeps its 48 px',
    /margin-top:36px/.test(ruleAt(cssText, 'body:has(#compare:not([hidden])) .foot', '(min-width:600px)'))
    && lastValue('.foot', 'margin-top') === '48px');
  check('CH2b phones: an open Compare puts the footer 36 px lower so its heading sits 44 px under the card, as on desktop; the list keeps 48 px',
    /margin-top:36px/.test(ruleAt(cssText, 'body:has(#compare:not([hidden])) .foot', phone))
    && lastValue('.foot', 'margin-top') === '48px');
  check('CH3 Close comparison has the 8 px corners of the other outlined buttons at every width',
    lastValue('#cmp-close', 'border-radius') === '8px' && /border-radius:8px/.test(ruleAt(cssText, '#cmp-close', phone)));
// Leon, 2026-11-07: corners nest concentrically, outer = inner + inset. The 8 px
// controls sit 8 px into a panel's corner (Close comparison, phone Sort), so panels are 16 px.
check('CH7 concentric corners: panels are 16 px, and phone Sort sits 8 px from the top and right of the list card',
  /--r-panel:16px;/.test(cssText) && lastValue('.listp>.f-sort', 'padding') === '8px 8px 8px 12px'
  // My list's Group by lines up with Sort below it (smoke R3H), so it has the same 8 px inset.
  && lastValue('.mylist', 'padding') === '8px 8px 8px 12px');
  check('CH3b desktop Compare: Save and the "x" have the same 8 px corners as Close comparison (the table is not a rounded container, so no concentric inset applies); the card keeps --r-panel',
    /border-radius:8px/.test(ruleAt(cssText, '.cmp-t th.cmp-p .cmp-save', '(min-width:600px)'))
    && lastValue('.cmp-x', 'border-radius') === '8px' && lastValue('.cmp', 'border-radius') === 'var(--r-panel)');
  check('CH4 phones: the one My list button moves into the count row before Filters, and back before Compare from 600 px; focus survives the move',
    /if \(bar\) put\(headerRight, dom\.headerList, dom\.headerCompare\);\s*else put\(dom\.status, dom\.headerList, dom\.more\);/.test(appSrc)
    && /if \(listFocused && document\.activeElement !== dom\.headerList\) dom\.headerList\.focus/.test(appSrc)
    && (read('index.html').match(/id="header-list"/g) ?? []).length === 1);
  check('CH6 crossing 600 px keeps focus in My list: widening moves it off the hidden More, narrowing opens More for a hidden tool (regression, smoke "PM list focus")',
    /function keepListFocus\(was, bar\)/.test(appSrc) && /else if \(listWas\) keepListFocus\(listWas, bar\)/.test(appSrc)
    && /listFocus = isListTool\(document\.activeElement\)/.test(appSrc) && /listMoreOpen = true;\s*syncListMore\(\);/.test(appSrc));
  check('CH5 phones: in the count row My list is 44 px tall with Filters\' hairline and corners, takes the free space before Filters, and keeps its words for screen readers',
    /flex:none;height:44px;margin-left:auto;[^}]*border-color:var\(--hairline\);border-radius:8px/.test(ruleAt(cssText, '.status #header-list', phone))
    && /margin-left:0/.test(ruleAt(cssText, '.status #header-list~.more', phone))
    && /display:block;position:absolute;width:1px;height:1px;[^}]*clip-path:inset\(50%\)/.test(ruleAt(cssText, '.status #header-list>.hb-l', phone)));
}

// Verification of PR 1: the focused Compare heading printed its blue ring.
check('print removes every focus outline, even the Compare heading\'s ID rule', (() => { const print = cssText.slice(cssText.indexOf('@media print {\n  *, *::before')); return print.includes(':focus, :focus-visible, :focus-visible::after { outline: none !important; }'); })());

// Verification of PR 1: the two-line HL Maths help kept the bubble 260 px
// wide, 12 px past its longest line (smoke R2L measures it in Chrome).
check('an opened help bubble is narrowed to its longest line', /selectNodeContents\(tip\)[\s\S]{0,300}tip\.style\.width = `\$\{Math\.ceil\(text \+ pad\) \+ 1\}px`/.test(read('js/round2.js')));

section('Facts and copy, review of PR 1, 2026-11-07');
{
  const inLang = (lang, fn) => { i18n.setLanguage(lang, { setItem() {} }); try { return fn(); } finally { i18n.setLanguage('en', { setItem() {} }); } };
  // The source FAQ said unchecked rows "are marked"; none are (every row is
  // AI-DRAFT and only signed rows carry a badge). The FAQ quotes the badge a
  // signed row really shows, so the two cannot drift apart (since 2026-11-09
  // in "Can I rely on what it says?").
  equal('FAQ quotes the real "Checked" badge and never claims unchecked rows are marked',
    ['en', 'sk'].map((lang) => inLang(lang, () => {
      const a = t('r7_faq_rely_a');
      return [a.includes(t('checked', { value1: t('by', { value1: '…' }) })), /are marked|sú označené/.test(a)];
    })), [[true, false], [true, false]]);
  check('FAQ CAO answer names the UCD exception and the HL Maths bonus in EN and SK',
    /UCD shows its own IB minimum/.test(UI.en.r7_faq_cao_a) && /UCD uvádza vlastné minimum/.test(UI.sk.r7_faq_cao_a)
      && /601 to 625/.test(UI.en.r7_faq_cao_a) && /601 do 625/.test(UI.sk.r7_faq_cao_a));
  // Review of list-perf (2026-11-09): "the CAO minimum (35)" read as 35 CAO points;
  // the HPAT minimum is 480 CAO points = 35 IB. The Slovak answer also said "sa dá
  // dosiahnuť len s ňou" for the 601-625 band; it is "možno dosiahnuť".
  check('FAQ CAO answer gives the HPAT minimum as 480 points (35 IB) in EN and SK, and the Slovak band wording is natural',
    /CAO minimum \(480 points, 35 IB\)/.test(UI.en.r7_faq_cao_a) && /minimum CAO \(480 bodov, 35 IB\)/.test(UI.sk.r7_faq_cao_a)
      && !/sa dá dosiahnuť/.test(UI.sk.r7_faq_cao_a) && /601 do 625 možno dosiahnuť len s ňou/.test(UI.sk.r7_faq_cao_a));
  // Verification of PR 1: the footer still said all data comes from the
  // universities' pages.
  check('footer source line names the CAO and calls living costs estimates, EN and SK',
    /CAO/.test(UI.en.r2_footer_data) && /estimates/.test(UI.en.r2_footer_data)
      && /CAO/.test(UI.sk.r2_footer_data) && /odhady/.test(UI.sk.r2_footer_data));
  // On phones the points field is in the Filters sheet, not "above".
  check('share help points to the filters, not "above", in EN and SK',
    /in the filters/.test(UI.en.enter_your_ib_points_above_to_include_them) && !/above/.test(UI.en.enter_your_ib_points_above_to_include_them)
      && /vo filtroch/.test(UI.sk.enter_your_ib_points_above_to_include_them) && !/vyššie/.test(UI.sk.enter_your_ib_points_above_to_include_them));
  equal('My list pane button uses Slovak plurals for 0, 1, 2, 4, 5 and 21 saved',
    inLang('sk', () => [0, 1, 2, 4, 5, 21].map((count) => t('r2_pane_list', { count }))),
    ['Môj zoznam · 0 uložených', 'Môj zoznam · 1 uložený', 'Môj zoznam · 2 uložené', 'Môj zoznam · 4 uložené', 'Môj zoznam · 5 uložených', 'Môj zoznam · 21 uložených']);
  equal('Slovak sort, setup and done-screen grammar',
    [inLang('sk', () => t('sorted_activate_to_sort', { value1: 'X', value2: t('r2_default_order') })), UI.sk.r2_ob2m, UI.sk.r3_ob_done_h_none,
      UI.sk.r4_ob_done_tools.replace('{bookmark}', UI.sk.r4_icon_bookmark).replace('{scales}', UI.sk.r4_icon_scales)],
    [', zoradené: X. Aktivuj na zoradenie: predvolené poradie.', 'Mám HL matematiku a očakávam 4 alebo viac', 'Nastavenie zostalo prázdne.',
      'Tlačidlom so záložkou si programy uložíš do Môjho zoznamu a tlačidlom s váhami porovnáš až 4 vedľa seba.']);
  // WebKit and VoiceOver drop list semantics from a list with list-style:none
  // (the results) or display:grid items (the points lines).
  check('results and points-line lists keep an explicit list role for Safari',
    /<ul class="results" id="results" role="list"/.test(read('index.html'))
      && byTag(detailOf(fxRow('fx-plain')), 'ul').filter((u) => u.className === 'plines').every((u) => u.getAttribute('role') === 'list')
      && byTag(detailOf(fxRow('fx-plain')), 'ul').some((u) => u.className === 'plines'));
}

// Leon, iPhone, 2026-11-08: "couldn't scroll down" in Compare. overflow-x:auto
// alone made the sideways box scroll 2 px down too (the last row's link tap
// padding), and vertical swipes over the table went to it, not the page. The
// smoke test (CMP touch scroll) swipes on a touch phone.
check('Compare\'s sideways scroll box never scrolls vertically: overflow-y:hidden, and no screen rule makes it a vertical scroller or limits touch panning',
  /overflow-x:auto;overflow-y:hidden/.test(ruleAt(cssText, '.cmp-scroll'))
    && cssTree(cssText).filter((r) => /\.cmp-scroll(?![\w-])/.test(r.selector) && !r.media.some((m) => /print/.test(m)))
      .every((r) => !/(?:^|;)\s*(?:overflow(?:-y)?\s*:\s*(?:auto|scroll|visible)|overflow\s*:\s*\S+\s+(?:auto|scroll)|touch-action)/.test(r.body)));


section('Smarter sort');
{
  const st = { ...noFilters(), myIbPoints: 36 };
  const base = { ...revisionBase, ibPointsMin: 30, pointsKind: 'minimum', cao: null, livingCostMin: 500, livingCostMax: 600 };
  const make = (id, changes = {}) => ({ ...base, id, university: id, programme: id, deadline: new Date('2027-02-01'), deadlinePassed: false, ...changes });
  const maths = make('maths', { pointsKind: 'cutoff', cao: { rounds: [{round:1, points: 520}], test: false } });
  // Pick a cutoff just above the student's CAO total, requiring the bonus.
  const { caoPointsFor } = await import('../js/points.js');
  maths.cao.rounds[0].points = caoPointsFor(36) + 10;
  const rows = [make('unknown', {ibPointsMin:null}), maths, make('far'), make('near', {ibPointsMin:35}), make('early', {deadline:new Date('2027-01-01')}), make('passed', {deadline:new Date('2026-01-01'),deadlinePassed:true}), make('no-date', {deadline:null})];
  equal('Best match: buckets, deadline before closeness, then smaller gap', sortRows(rows, 'best', 'asc', st).map(r=>r.id), ['early','near','far','passed','no-date','maths','unknown']);
  equal('Best match has the same useful order for a reverse request', sortRows(rows, 'best', 'desc', st).map(r=>r.id), sortRows(rows, 'best', 'asc', st).map(r=>r.id));
  const ties = [make('z'),make('a'),make('early',{deadline:new Date('2027-01-01')}),make('unknown',{deadline:null})];
  for (const key of ['tuition','points','cost']) for (const dir of ['asc','desc']) equal(`${key} ${dir}: ties use deadline then university/name`, sortRows(ties,key,dir,st).map(r=>r.id), ['early','a','z','unknown']);
  const costs = [make('low',{tuitionEu:0}),make('high',{tuitionEu:2000}),make('missing-fee',{tuitionEu:null}),make('missing-living',{tuitionEu:100,livingCostMin:null})];
  equal('cost lowest: unknown fee/living last', sortRows(costs,'cost','asc',st).map(r=>r.id), ['low','high','missing-fee','missing-living']);
  equal('cost highest: unknown fee/living still last', sortRows(costs,'cost','desc',st).map(r=>r.id), ['high','low','missing-fee','missing-living']);
  equal('cost uses personal living costs, including zero', sortRows(costs,'cost','asc',{...st,myLiving:0}).map(r=>r.id), ['low','missing-living','high','missing-fee']);
  for (const key of ['best','cost','deadline']) {
    const parsed = paramsToState(stateToParams({...st,sort:key}));
    equal(`${key} URL round trip`, [parsed.sort,parsed.myIbPoints], [key,36]);
  }
  equal('Deadline with points is explicit in shared and reloaded URLs', new URLSearchParams(stateToParams({...st,sort:'deadline'})).get('sort'), 'deadline');
  equal('Best match URL without usable points falls back to deadline', ['sort=best','sort=best&points=bad','sort=best&points=46'].map(q=>paramsToState(q).sort), ['deadline','deadline','deadline']);
  equal('saved Best match without points falls back to deadline', savedState.validateFilters({sort:'best'}).sort, 'deadline');
  equal('saved Best match with points is valid', savedState.validateFilters({sort:'best',myIbPoints:36}).sort, 'best');
  const state = noFilters(); filtersMod.setMyPoints(state,36);
  equal('setting points activates Best match', state.sort, 'best');
  state.sort='cost'; filtersMod.setMyPoints(state,38,true);
  equal('explicit pick sticks through points edits', state.sort, 'cost');
  state.sort='best'; filtersMod.setMyPoints(state,null,true);
  equal('clearing points on Best match restores deadline', [state.sort,state.dir], ['deadline','asc']);
  check('Best match menu is conditional and has only one direction', withStubDocument(()=>{
    const select = new ChromeNode('select'); renderSortOptions(select,filtersMod.SORTS,'best','asc',st);
    return select.children.length===11 && select.children.filter(o=>o.value.startsWith('best:')).map(o=>o.value).join()==='best:asc';
  }));
}
appCheck('points field auto-switches, explicit menu choice sticks, and clear removes Best match', ({run,get,fire,advance}) => {
  run('wireInputs();'); get('f-points').value='36'; fire(get('f-points'),'input'); advance(200);
  if(run('state.sort')!=='best') return false;
  get('f-sort').value='cost:desc'; fire(get('f-sort'),'change');
  get('f-points').value='38'; fire(get('f-points'),'input'); advance(200);
  if(run('state.sort')!=='cost' || run('state.dir')!=='desc') return false;
  get('f-sort').value='best:asc'; fire(get('f-sort'),'change');
  run('clearAll();');
  return run('state.sort')==='deadline' && get('f-sort').children.find(o=>o.value==='best:asc')?.disabled === true;
});
await asyncAppCheck('Setup done activates Best match before showing results', async ({run,context,settle})=>{
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  context.onboardingConfig.apply(savedState.validateFilters({myIbPoints:36}));
  return run('state.sort')==='best' && run('state.myIbPoints')===36;
},{boot:true});
// Leon, 2026-11-09: a hand-picked sort was lost on reload, because
// storedFilters dropped sort and dir ("Sort is never written to preferences").
{
  const { storedFilters, restoration } = savedState;
  const base = { ...savedState.validateFilters({ myIbPoints: 36 }), sort: 'name', dir: 'desc' };
  equal('a hand-picked sort is stored with its direction', [storedFilters(base, null, true).filters.sort, storedFilters(base, null, true).filters.dir], ['name', 'desc']);
  check('a sort the page chose is not stored', !('sort' in storedFilters(base, null, false).filters) && !('dir' in storedFilters(base).filters));
  check('Best match is never stored, even when picked', !('sort' in storedFilters({ ...base, sort: 'best', dir: 'asc' }, null, true).filters));
  const back = restoration('', storedFilters(base, null, true));
  check('a stored sort comes back and counts as picked', back.source === 'saved' && back.state.sort === 'name' && back.state.dir === 'desc' && back.sortPicked === true);
  check('a stored sort that fails validation is not picked', [{ sort: 'best' }, { sort: 'bogus' }].every((f) => restoration('', { version: 1, filters: f }).sortPicked === false && restoration('', { version: 1, filters: f }).state.sort === 'deadline'));
  check('stored Best match with stored points still restores', restoration('', { version: 1, filters: { sort: 'best', myIbPoints: 36 } }).state.sort === 'best');
  check('a filter or sort URL ignores the stored sort (never merged)', ['?country=Ireland', '?points=36', '?sort=tuition'].every((q) => { const r = restoration(q, storedFilters(base, null, true)); return r.source === 'url' && r.state.sort !== 'name' && !r.sortPicked; }));
  check('older snapshots without a sort restore deadline order, not picked', restoration('', { version: 1, filters: { myIbPoints: 36 } }).sortPicked === false);
}
await asyncAppCheck('a sort picked in the menu is saved; Clear all removes it with the filters', async ({run,get,fire,context,settle,advance}) => {
  Object.defineProperty(get('f-sort'), 'options', {get() { return this.children; }});
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  context.Event = class { constructor(type) { this.type = type; this.bubbles = false; } };
  fire(get('sort-options').querySelectorAll('input').find((n) => n.value === 'tuition:desc'), 'change'); advance(500);
  const last = context.prefWrites?.at(-1)?.filters;
  if (last?.sort !== 'tuition' || last?.dir !== 'desc') return false;
  run('clearAll();'); advance(500);
  if (context.prefWrites.at(-1) !== null || run('state.sort') !== 'deadline' || run('state.dir') !== 'asc' || run('explicitSort')) return false;
  get('f-points').value = '38'; fire(get('f-points'), 'input'); advance(500);
  return run('state.sort') === 'best';
}, {boot:true});
await asyncAppCheck('a sort picked from a column header is saved too', async ({fire,context,settle,advance}) => {
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  fire(context.document.querySelector('.cols [data-sort="points"]'),'click'); advance(500);
  return context.prefWrites?.at(-1)?.filters.sort === 'points';
}, {boot:true});
await asyncAppCheck('a restored hand-picked sort survives setting points (no switch to Best match)', async ({run,get,fire,context,settle,advance}) => {
  context.savedPrefs = {version:1,filters:{sort:'name',dir:'asc'}};
  run('applyUrlFields();'); context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle(); advance(500);
  if (run('state.sort') !== 'name' || run('explicitSort') !== true) return false;
  get('f-points').value = '36'; fire(get('f-points'),'input'); advance(500);
  if (run('state.sort') !== 'name') return false;
  context.onboardingConfig.apply(savedState.validateFilters({myIbPoints:38}));
  return run('state.sort') === 'name' && run('state.myIbPoints') === 38;
}, {boot:true});
await asyncAppCheck('saved points without a saved sort still select Best match on reload', async ({run,context,settle,advance}) => {
  context.savedPrefs = {version:1,filters:{myIbPoints:36}};
  run('applyUrlFields();'); context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle(); advance(500);
  return run('state.sort') === 'best' && run('explicitSort') === false;
}, {boot:true});
appCheck('Clear all forgets a hand-picked Tuition sort and points can choose Best match again', ({run,get,fire,advance}) => {
  run('wireInputs();');
  get('f-sort').value = 'tuition:desc'; fire(get('f-sort'),'change');
  run('clearAll();');
  if (run('state.sort') !== 'deadline' || run('state.dir') !== 'asc' || run('explicitSort') || new URLSearchParams(run('stateToParams(state)')).has('sort')) return false;
  get('f-points').value = '38'; fire(get('f-points'),'input'); advance(500);
  return run('state.sort') === 'best';
});
appCheck('URL points are applied before syncSort builds the initial Best match menu', ({run,context}) => {
  context.location.search = '?points=36&sort=best';
  run('state.myIbPoints = null; applyUrlFields(); syncSort();');
  return run('state.sort') === 'best' && run('state.myIbPoints') === 36;
});
appCheck('Best match radios mirror disabled options, reject disabled changes, and enable/disable with points', ({run,get,fire,context,advance}) => {
  Object.defineProperty(get('f-sort'), 'options', {get() { return this.children; }});
  context.Event = class { constructor(type) { this.type = type; this.bubbles = false; } };
  run('syncSort(); wireInputs();');
  const best = () => get('sort-options').querySelectorAll('input').find((n) => n.value === 'best:asc');
  if (!best()?.disabled || !get('f-sort').children.find((n) => n.value === 'best:asc')?.disabled) return false;
  fire(best(), 'change');
  if (run('state.sort') !== 'deadline') return false;
  get('f-points').value = '38'; fire(get('f-points'),'input'); advance(500);
  if (best().disabled || run('state.sort') !== 'best') return false;
  get('f-points').value = ''; fire(get('f-points'),'input'); advance(500);
  return best().disabled === true && run('state.sort') === 'deadline';
});
for (const language of ['en','sk']) check(`${language}: Best match disabled hint is readable and disappears with points`, withStubDocument(() => {
  i18n.setLanguage(language);
  try {
    const select = new ChromeNode('select');
    renderSortOptions(select,filtersMod.SORTS,'deadline');
    const off = select.children.find(o=>o.value==='best:asc');
    if (!off?.disabled || off.textContent !== (language === 'en' ? 'Best match (enter your IB points first)' : 'Najlepšia zhoda (najprv zadaj svoje IB body)')) return false;
    renderSortOptions(select,filtersMod.SORTS,'best','asc',{myIbPoints:38});
    const on = select.children.find(o=>o.value==='best:asc');
    return on.disabled === false && on.textContent === (language === 'en' ? 'Best match' : 'Najlepšia zhoda');
  } finally { i18n.setLanguage('en'); }
}));
// Reload through the same boot ordering: URL fields, syncSort, then data/readFields.
for (const source of ['url', 'saved']) {
  await asyncAppCheck(`${source}: explicit Deadline with points survives boot and later points edits`, async ({run,get,fire,context,settle,advance}) => {
    if (source === 'url') context.location.search = '?points=36&sort=deadline';
    else context.savedPrefs = {version:1,filters:{myIbPoints:36,sort:'deadline',dir:'asc'}};
    run('applyUrlFields(); syncSort();');
    context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
    if (run('state.sort') !== 'deadline' || run('state.myIbPoints') !== 36) return false;
    get('f-points').value = '38'; fire(get('f-points'),'input'); advance(500);
    return run('state.sort') === 'deadline';
  }, {boot:true});
}
await asyncAppCheck('a URL Best match without points does not suppress automatic Best match later', async ({run,get,fire,context,settle,advance}) => {
  context.location.search = '?sort=best';
  run('applyUrlFields(); syncSort();');
  context.resolveData({programmes:context.fixture,meta:{issues:[]}}); await settle();
  if (run('state.sort') !== 'deadline') return false;
  get('f-points').value = '38'; fire(get('f-points'),'input'); advance(500);
  return run('state.sort') === 'best' && run('explicitSort') === false;
}, {boot:true});
section('FAQ panel behind the header\'s "?" (Leon, 2026-11-09)');
// The FAQ lived only in the footer, below every row. The header's "?" opens
// the same questions in a panel (js/faq.js), built like the Filters sheet:
// show(), its own scrim, focus trap and Escape, never a page-wide inert.
// Runs the real module against the real index.html as stand-in nodes.
// The twelve questions approved by Leon on 2026-11-09, in order.
const FAQ_KEYS = ['what', 'rely', 'check', 'points', 'no_points', 'unknown', 'cao', 'fee', 'cost', 'setup', 'list', 'who'].map((k) => `r7_faq_${k}`);
function faqHarness(test, env = {}) {
  const keys = ['getElementById', 'querySelector', 'querySelectorAll', 'body', 'documentElement', 'activeElement', 'listeners', 'canFocus', 'queueTask', 'scrolls', 'focusLog', 'focusOptions'];
  const saved = Object.fromEntries(keys.map((k) => [k, stubDocument[k]]));
  const original = globalThis.document;
  globalThis.document = stubDocument;
  try {
    const tree = parseHtml(read('index.html')), all = () => [...nodesOf(tree)];
    const get = (id) => all().find((n) => n.id === id) ?? null;
    const tasks = [], hidden = new Set();
    Object.assign(stubDocument, {
      getElementById: get, querySelector: (sel) => tree.querySelector(sel), querySelectorAll: (sel) => tree.querySelectorAll(sel),
      body: tree.querySelector('body'), documentElement: tree.querySelector('html'), activeElement: tree.querySelector('body'),
      listeners: {}, scrolls: [], focusLog: [], focusOptions: undefined, queueTask: (fn) => tasks.push(fn),
      // A closed <details> shows only its summary, so the mailto link in the
      // last answer is out of the Tab order until that question is open.
      canFocus: (node) => {
        for (let n = node, c = null; n; c = n, n = n.parent) {
          if (n.hidden || hidden.has(n) || n.getAttribute('inert') !== null || (n.tagName === 'dialog' && !n.open) || (n.tagName === 'details' && !n.open && c && c.tagName !== 'summary')) return false;
        }
        return true;
      },
    });
    // The module wires itself when there is a document, as in the browser.
    // Timers and frames only queue: a test runs them when it means to.
    const timers = [], slides = [];
    // faq.js imports the shared sheet drag (A12): both run here, unbundled.
    const source = read('js/sheet-drag.js').replace(/^export /gm, '') + read('js/faq.js').replace(/^import[^;]+;\n/gm, '').replace(/^export /gm, '');
    const api = runInNewContext(source + '\n({ wireFaq, openFaq, closeFaq, onFaqSlide });', { document: stubDocument, ...env,
      setTimeout: (fn) => timers.push(fn), clearTimeout() {}, requestAnimationFrame: (fn) => timers.push(fn), cancelAnimationFrame() {} });
    api.onFaqSlide((on) => slides.push(on));
    api.wireFaq(); // a second call changes nothing
    const fire = (node, type, init = {}) => dispatchStub(node, { type, ...init });
    return test({ tree, get, api, fire, tasks, timers, slides, hide: (node) => hidden.add(node), panel: get('faq-panel'), opener: get('faq-open'), heading: get('faq-h'), footer: get('faq-foot'),
      scrim: get('faq-scrim'), html: stubDocument.documentElement, results: tree.querySelector('section[aria-labelledby="results-h"]') });
  } catch (err) { console.log(`        ${err.message}`); return false; } finally {
    Object.assign(stubDocument, saved);
    globalThis.document = original;
  }
}
{
  const html = read('index.html'), faqSrc = read('js/faq.js').replace(/\/\/.*$/gm, '');
  const shut = ({ panel, html: root, scrim, opener }) => !panel.open && !root.classList.contains('faq-open') && !scrim.classList.contains('is-open') && opener.getAttribute('aria-expanded') === 'false';
  // Leon, 2026-11-09: the panel is the FAQ's only home; the footer keeps a button to it.
  check('FAQ "?" sits in the header between Compare and settings, names the panel it opens, and says "FAQ" beside it (shown from 1024 px)',
    /id="header-compare"[\s\S]*?<\/button><button class="btn hb" id="faq-open" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="faq-panel" aria-label="FAQ" data-i18n-attr="aria-label:r6_faq"><svg class="ic" aria-hidden="true"><use href="#i-help"\/><\/svg><span class="faq-l" data-i18n="r6_faq_l">FAQ<\/span><\/button>\s*<div class="settings"/.test(html)
      && /<dialog class="faqp" id="faq-panel" aria-labelledby="faq-h" aria-modal="true">/.test(html)
      && /<div class="faq-scrim" id="faq-scrim" aria-hidden="true"><\/div>/.test(html) && html.includes('<symbol id="i-help"')
      && /\.faq-l\{display:none\}/.test(cssText) && /display:inline/.test(ruleAt(cssText, '#faq-open .faq-l', '(min-width:1024px)')));
  check('FAQ lives only in its panel: twelve questions, each key once in the page, none in the footer; the footer has a "FAQ" button to the panel',
    (() => {
      const panelSrc = elementSource(html, /<div class="faqp-b faq">/), footSrc = elementSource(html, /<footer class="foot">/);
      return (panelSrc.match(/<details>/g) ?? []).length === 12 && !/<details/.test(footSrc) && !/id="faq"/.test(html)
        && FAQ_KEYS.every((k) => html.split(`data-i18n="${k}"`).length === 2 && html.split(`data-i18n="${k}_a"`).length === 2 && panelSrc.includes(`data-i18n="${k}_a"`))
        && /<button type="button" class="btn btn-a" id="faq-foot" aria-haspopup="dialog" aria-controls="faq-panel" data-i18n="r6_faq_l">FAQ<\/button>/.test(footSrc)
        && footSrc.includes('id="source-line"') && footSrc.includes('data-i18n="r2_footer_h"')
        && !/cloneNode|getElementById\('faq'\)/.test(faqSrc) && !/#faq(?![\w-])/.test(cssText);
    })());
  check('FAQ: all twelve questions and answers are written in EN and SK',
    FAQ_KEYS.every((k) => [k, `${k}_a`].every((key) => UI.en[key]?.trim() && UI.sk[key]?.trim() && UI.sk[key] !== UI.en[key])));
  equal('FAQ panel strings in EN and SK', ['r6_faq', 'r6_faq_h', 'r6_faq_close', 'r6_faq_l'].flatMap((k) => [UI.en[k], UI.sk[k]]),
    ['FAQ', 'Časté otázky', 'Frequently asked questions', 'Časté otázky', 'Close the FAQ', 'Zavrieť časté otázky', 'FAQ', 'Časté otázky']);
  // A10 (PR 7): a shutting answer's own subtree is inert and aria-hidden;
  // that is the only place either may appear, never the page behind.
  check('FAQ panel opens with show(): no showModal, inert or background aria-hidden (WebKit restyles every row for those)',
    (() => {
      const at = faqSrc.indexOf('function expose('), end = faqSrc.indexOf('\n}', at);
      const outside = faqSrc.slice(0, at) + faqSrc.slice(end);
      return faqSrc.includes('panel.show();') && at > 0 && !/showModal\(/.test(faqSrc) && !/\binert\b|aria-hidden/.test(outside.replace("node.closest('[inert]')", ''))
        && /answer\.setAttribute\('inert', ''\); answer\.setAttribute\('aria-hidden', 'true'\);/.test(faqSrc.slice(at, end));
    })());
  check('FAQ panel starts with its twelve questions closed, in the approved order; the footer\'s "FAQ" opens it and gets focus back',
    faqHarness(({ fire, panel, footer, heading, opener, get }) => {
      const qs = panel.querySelectorAll('details');
      const order = qs.map((d) => d.querySelector('summary [data-i18n]').getAttribute('data-i18n'));
      if (qs.length !== 12 || JSON.stringify(order) !== JSON.stringify(FAQ_KEYS) || qs.some((d) => d.open) || get('faq')) return false;
      fire(footer, 'click');
      const opened = panel.open && stubDocument.activeElement === heading && opener.getAttribute('aria-expanded') === 'true';
      fire(heading, 'keydown', { key: 'Escape' });
      return opened && !panel.open && stubDocument.activeElement === footer;
    }) === true);
  check('FAQ panel pauses row mounting while it slides, both ways, and resumes once its transform transition ends (or the fallback timer runs)',
    faqHarness(({ fire, panel, opener, scrim, slides, timers }) => {
      fire(opener, 'pointerdown');
      const early = slides.join() === 'true' && panel.classList.contains('is-sliding') && scrim.classList.contains('is-sliding');
      fire(opener, 'click');
      const once = slides.join() === 'true';
      fire(panel.querySelector('summary'), 'transitionend', { propertyName: 'height' });
      const notByAnswer = slides.join() === 'true';
      fire(panel, 'transitionend', { propertyName: 'transform' });
      const resumed = slides.join() === 'true,false' && !panel.classList.contains('is-sliding');
      fire(panel.querySelector('.faqp-x'), 'click');
      const closing = slides.join() === 'true,false,true';
      while (timers.length) timers.shift()();
      return early && once && notByAnswer && resumed && closing && slides.join() === 'true,false,true,false' && !scrim.classList.contains('is-sliding');
    }) === true);
  check('FAQ panel: switching language translates the copies, the heading and both buttons\' names',
    faqHarness(({ tree, panel, heading, opener }) => {
      const root = { documentElement: {}, querySelectorAll: (sel) => tree.querySelectorAll(sel) };
      i18n.setLanguage('sk', { setItem() {} });
      try {
        i18n.applyLanguage(root);
        return panel.querySelector('summary span').textContent === UI.sk.r7_faq_what && panel.querySelectorAll('.a span').at(-1).textContent === UI.sk.r7_faq_who_a
          && panel.querySelector('a[href^="mailto:"]').textContent === UI.sk.r7_faq_email
          && heading.textContent === UI.sk.r6_faq_h && opener.getAttribute('aria-label') === UI.sk.r6_faq
          && panel.querySelector('.faqp-x').getAttribute('aria-label') === UI.sk.r6_faq_close;
      } finally { i18n.setLanguage('en', { setItem() {} }); i18n.applyLanguage(root); }
    }) === true);
  check('FAQ "?" opens the panel with its scrim and lock class, says so, and focuses the heading; Escape closes and returns to "?"',
    faqHarness((h) => {
      const { fire, opener, panel, heading, scrim, html: root } = h;
      fire(opener, 'click');
      const opened = panel.open && root.classList.contains('faq-open') && scrim.classList.contains('is-open') && opener.getAttribute('aria-expanded') === 'true'
        && stubDocument.activeElement === heading;
      fire(heading, 'keydown', { key: 'Escape', defaultPrevented: true });
      const keptForOthers = panel.open;
      fire(heading, 'keydown', { key: 'Escape' });
      return opened && keptForOthers && shut(h) && stubDocument.activeElement === opener;
    }) === true);
  check('FAQ panel: the scrim and the close button each close it and return to "?"',
    faqHarness((h) => {
      const { fire, opener, panel, scrim } = h;
      fire(opener, 'click'); fire(scrim, 'click');
      const byScrim = shut(h) && stubDocument.activeElement === opener;
      fire(opener, 'click'); fire(panel.querySelector('.faqp-x'), 'click');
      return byScrim && shut(h) && stubDocument.activeElement === opener;
    }) === true);
  check('FAQ panel traps Tab both ways and pulls stray focus back to its heading',
    faqHarness(({ fire, get, opener, panel, heading }) => {
      fire(opener, 'click');
      const close = panel.querySelector('.faqp-x'), summaries = panel.querySelectorAll('summary'), last = summaries.at(-1);
      fire(heading, 'keydown', { key: 'Tab' });
      const first = stubDocument.activeElement === close;
      fire(close, 'keydown', { key: 'Tab', shiftKey: true });
      const back = stubDocument.activeElement === last;
      fire(last, 'keydown', { key: 'Tab' });
      const wrap = stubDocument.activeElement === close;
      const mid = summaries[1]; mid.focus(); const event = { key: 'Tab' };
      const inside = fire(mid, 'keydown', event) && stubDocument.activeElement === mid; // the browser moves it
      fire(get('f-search'), 'focusin');
      return first && back && wrap && inside && stubDocument.activeElement === heading;
    }) === true);
  check('FAQ panel: Setup\'s done screen hands over the results list, which gets focus back; a hidden target falls back to "?"; a second open does nothing',
    faqHarness(({ api, opener, results, hide, panel }) => {
      api.openFaq(results); api.openFaq(); api.closeFaq();
      const toList = stubDocument.activeElement === results;
      api.openFaq(results); hide(results); api.closeFaq();
      return toList && !panel.open && stubDocument.activeElement === opener;
    }) === true);
  check('FAQ panel: a quick reopen survives the queued close event of the close before it',
    faqHarness(({ fire, opener, panel, scrim, tasks, html: root }) => {
      fire(opener, 'click'); fire(scrim, 'click'); fire(opener, 'click');
      while (tasks.length) tasks.shift()();
      return panel.open && root.classList.contains('faq-open') && scrim.classList.contains('is-open') && opener.getAttribute('aria-expanded') === 'true';
    }) === true);
  check('FAQ panel: a wheel over the scrim, or over a panel with nothing to scroll, never scrolls the list behind',
    faqHarness(({ fire, opener, panel, scrim }) => {
      fire(opener, 'click');
      const body = panel.querySelector('.faqp-b'), summary = panel.querySelector('summary');
      const scrimBlocked = !fire(scrim, 'wheel'), headBlocked = !fire(panel.querySelector('.faqp-x'), 'wheel'), bodyScrolls = fire(summary, 'wheel');
      body.scrollHeight = body.clientHeight;
      return scrimBlocked && headBlocked && bodyScrolls && !fire(summary, 'wheel');
    }) === true);
  // CSS: the Filters sheet's stacking, curve and timing; a bottom sheet on
  // phones, from the right from 600 px; "?" mid-close reaches the button
  // through the fading scrim; reduced motion fades; print hides it all.
  const z = (sel) => Number(ruleAt(cssText, sel).match(/z-index:(\d+)/)?.[1]);
  check('FAQ panel CSS: above header, tray and toasts, below Setup; sheet on phones, side panel from 600 px; the closing scrim lets "?" through',
    z('.faqp') === 70 && z('.faq-scrim') === 69 && z('.faq-scrim') > Math.max(z('.hd'), z('.toasts'), z('.cmp-tray')) && z('dialog.ob') > z('.faqp')
      && /transform:translateY\(100%\)/.test(ruleAt(cssText, '.faqp')) && /max-height:85dvh/.test(ruleAt(cssText, '.faqp'))
      && /inset:0 0 0 auto;width:min\(440px,100%\);max-height:none;[^}]*transform:translateX\(100%\)/.test(ruleAt(cssText, '.faqp', '(min-width:600px)'))
      && /@media \(min-width:600px\)\{[^@]*@starting-style\{\.faqp\[open\]\{transform:translateX\(100%\)\}\}/.test(cssText)
      && /pointer-events:none/.test(ruleAt(cssText, '.faq-scrim')) && /pointer-events:auto/.test(ruleAt(cssText, '.faq-scrim.is-open'))
      && /overflow:hidden/.test(ruleAt(cssText, 'html.faq-open', '(max-width:599.98px)')) && !ruleAt(cssText, 'html.faq-open'));
// Smoke F1 found it: with touch at 600 px the 44 px "?" left Search 148 px
// wide (it wants 160). Only there the header buttons sit 4 px apart.
check('FAQ "?" on a 600-700 px touch screen: the header tightens its gaps so Search keeps 160 px',
  /gap:4px/.test(ruleAt(cssText, '.hd .hd-right', '(pointer:coarse) and (min-width:600px) and (max-width:700px)'))
    && /gap:12px/.test(ruleAt(cssText, '.hd .hd-in', '(pointer:coarse) and (min-width:600px) and (max-width:700px)')));
  check('FAQ panel CSS: reduced motion fades it in 120 ms with no slide; print hides the panel and scrim',
    /transform:none/.test(ruleAt(cssText, '.faqp[open]', '(prefers-reduced-motion:reduce)'))
      && /@media \(prefers-reduced-motion:reduce\)\{[^@]*@starting-style\{\.faqp\[open\]\{opacity:0;transform:none\}\}/.test(cssText)
      && /opacity:0;transition:opacity 120ms linear,visibility 120ms !important;transition:opacity 120ms linear,display 120ms allow-discrete,visibility 120ms !important/.test(ruleAt(cssText, '.faqp', '(prefers-reduced-motion:reduce)'))
      && /display:none/.test(ruleAt(cssText, 'dialog.faqp[open]', 'print')) && /display:none/.test(ruleAt(cssText, '.faq-scrim.is-open', 'print')));
}

section('FAQ text, twelve questions (Leon, 2026-11-09)');
// Rewritten from /tmp/ib-lp/faq/draft-v2.md after three reviews. Quoted UI
// labels must be the labels the page really shows in that language, so a
// renamed button or badge fails here instead of leaving the FAQ wrong.
{
  // Since 2026-11-09 the questions are in the panel, not the footer.
  const html = read('index.html'), footFaq = elementSource(html, /<div class="faqp-b faq">/);
  const email = 'ibuniversityfinder@gmail.com';
  equal('FAQ panel has the twelve approved questions, in order, each with its answer',
    [...footFaq.matchAll(/<summary><span data-i18n="([^"]+)">/g)].map((m) => m[1]), FAQ_KEYS);
  check('FAQ: every question and answer has nonempty EN and SK text, used once in index.html',
    FAQ_KEYS.flatMap((k) => [k, `${k}_a`]).every((k) => UI.en[k]?.trim() && UI.sk[k]?.trim() && UI.en[k] !== UI.sk[k]
      && html.split(`data-i18n="${k}"`).length === 2));
  check('FAQ: the old five questions\' keys are gone from i18n.js and index.html',
    !Object.keys(UI.en).some((k) => /^r[24]_faq_/.test(k)) && !Object.keys(UI.sk).some((k) => /^r[24]_faq_/.test(k)) && !/data-i18n="r[24]_faq_/.test(html));
  check('FAQ: the last answer ends with a working mailto link to the contact address, the same in EN and SK',
    UI.en.r7_faq_email === email && UI.sk.r7_faq_email === email
      && footFaq.includes(`<span data-i18n="r7_faq_who_a">${UI.en.r7_faq_who_a}</span> <a href="mailto:${email}" data-i18n="r7_faq_email">${email}</a>.</div></details>`)
      && html.split('href="mailto:').length === 2 && /Tell us at$/.test(UI.en.r7_faq_who_a) && /Napíš nám na$/.test(UI.sk.r7_faq_who_a)
      && /Jakub and Leon/.test(UI.en.r7_faq_who_a) && /Jakub a Leon/.test(UI.sk.r7_faq_who_a));
  check('FAQ link is the accent colour and underlined like the site\'s other text links',
    /color:var\(--accent\);text-decoration:underline/.test(ruleAt(cssText, '.faq .a a')) && /color:var\(--accent-press\)/.test(ruleAt(cssText, '.faq .a a:hover')));
  // "Checked by …" is built from two keys, as on a signed row; "national
  // minimum" is the start of the row's "national minimum, not a full budget".
  const labels = (lang) => {
    const ui = UI[lang];
    return [`${ui.checked.replace('{value1}', ui.by.replace('{value1}', '…'))}`, ui.deadline_notes, ui.entrance_exam, ui.r2_pts_test_in_cutoff, ui.not_published,
      ui.not_checked_yet, ui.national_minimum_not_a_full_budget.split(',')[0], ui.my_living_costs, ui.r2_edit].sort();
  };
  const quoted = (lang) => [...new Set(FAQ_KEYS.flatMap((k) => [UI[lang][k], UI[lang][`${k}_a`]])
    .flatMap((text) => [...text.matchAll(lang === 'en' ? /“([^”]+)”/g : /„([^“]+)“/g)].map((m) => m[1])))].sort();
  equal('FAQ quotes exactly the real EN labels', quoted('en'), labels('en'));
  equal('FAQ quotes exactly the real SK labels', quoted('sk'), labels('sk'));
  check('FAQ EN text uses curly quotes and apostrophes only; SK uses „…“',
    FAQ_KEYS.flatMap((k) => [UI.en[k], UI.en[`${k}_a`]]).every((text) => !/["']/.test(text))
      && FAQ_KEYS.flatMap((k) => [UI.sk[k], UI.sk[`${k}_a`]]).every((text) => !/["'“”]/.test(text.replace(/„[^“]*“/g, ''))));
  check('FAQ focus trap skips controls in closed answers with checkVisibility (Chrome gives a hidden mailto link client rects; smoke "FAQ keys")',
    /node\.getClientRects\(\)\.length && \(node\.checkVisibility\?\.\(\) \?\? true\)/.test(read('js/faq.js')));
  check('FAQ panel: with the last question open, Shift+Tab from the close button reaches the mailto link and Tab wraps back; closed, the link is skipped',
    faqHarness(({ fire, opener, panel }) => {
      fire(opener, 'click');
      const close = panel.querySelector('.faqp-x'), last = panel.querySelectorAll('details').at(-1), link = last.querySelector('a');
      fire(close, 'keydown', { key: 'Tab', shiftKey: true });
      const skipped = stubDocument.activeElement === last.querySelector('summary');
      last.open = true; close.focus();
      fire(close, 'keydown', { key: 'Tab', shiftKey: true });
      const reached = stubDocument.activeElement === link && link.getAttribute('href') === 'mailto:ibuniversityfinder@gmail.com';
      fire(link, 'keydown', { key: 'Tab' });
      return skipped && reached && stubDocument.activeElement === close;
    }) === true);
}

// A second palette must not create an unchecked escape hatch in the colour policy.
{
  const wrapper = css.match(/@media screen\{\s*:root\[data-theme="dark"\]\{[^}]*\}\s*\}/)[0];
  const replaceDark = (change) => css.replace(wrapper, change(wrapper));
  const mutations = [
    ['wrong value', replaceDark((v) => v.replace('--ground:#1b2027;', '--ground:#000000;')), 'Changed dark token --ground'],
    ['missing token', replaceDark((v) => v.replace('--ground:#1b2027;', '')), 'Missing dark token --ground'],
    ['extra token', replaceDark((v) => v.replace('color-scheme:dark;', 'color-scheme:dark;--extra:1px;')), 'Unapproved dark token --extra'],
    ['duplicate token', replaceDark((v) => v.replace('--ground:#1b2027;', '--ground:#1b2027;--ground:#1b2027;')), 'Duplicate dark token --ground'],
    ['non-token declaration', replaceDark((v) => v.replace('color-scheme:dark;', 'color-scheme:dark;display:block;')), 'Unapproved dark token display'],
    ['duplicate scheme', replaceDark((v) => v.replace('color-scheme:dark;', 'color-scheme:dark;color-scheme:dark;')), 'Duplicate dark color-scheme'],
    ['light scheme changed', css.replace('color-scheme:light;', 'color-scheme:dark;'), 'Changed root color-scheme'],
    ['second rule', css + wrapper, 'Theme selector outside approved dark wrapper'],
    ['bare rule', replaceDark((v) => v.replace('@media screen{', '').replace(/\}\s*$/, '')), 'Theme selector outside approved dark wrapper'],
    ['nested in print', replaceDark((v) => '@media print{' + v + '}'), 'Expected one dark rule in its own top-level screen wrapper'],
    ['sibling in wrapper', replaceDark((v) => v.replace(/\}\s*$/, '.extra{color:var(--ink)}}')), 'Expected one dark rule in its own top-level screen wrapper'],
    ['stray scheme', css + '.extra{color-scheme:light}', 'Color-scheme outside approved palettes'],
    ['uppercase stray scheme', css + '.extra{COLOR-SCHEME:light}', 'Color-scheme outside approved palettes'],
    ['stray hex', css + '.extra{color:#fff}', 'Colour literal outside root in color'],
    // Verify review: these three passed the first version of the scan.
    ['spaced theme attribute', css + '[ data-theme="dark"] .extra{color:var(--ink)}', 'Theme selector outside approved dark wrapper'],
    ['escaped theme attribute', css + '[data\\-theme=dark] .extra{color:var(--ink)}', 'Theme selector outside approved dark wrapper'],
    ['system dark query', css + '@media (prefers-color-scheme:dark){.extra{color:var(--ink)}}', 'Color-scheme media query outside approved dark wrapper'],
  ];
  for (const [name, text, reason] of mutations) check(`dark colour policy rejects ${name} for its intended reason`, colourPolicyErrors(text).includes(reason));
  equal('dark policy preserves an unrelated screen wrapper', colourPolicyErrors(css + '@media screen{.extra{color:var(--ink)}}'), []);
}
// The new control must keep the licensed sprite and disclosure semantics.
check('settings is a named disclosure with a licensed gear and native radio labels',
  /Phosphor Regular gear, @phosphor-icons\/core 2\.1\.1, MIT\./.test(indexHtml)
    && /<symbol id="i-gear"/.test(indexHtml)
    && /id="settings-open"[^>]*aria-expanded="false" aria-controls="settings-panel"/.test(indexHtml)
    && /<div id="settings-panel" hidden>/.test(indexHtml)
    && !/<[^>]+\bpopover(?:[=>\s])/.test(indexHtml)
    && ['settings_sk', 'settings_en'].every((key) => UI.en[key] === UI.sk[key]));
// Boot and module share validity/default rules, including a throwing storage getter.
{
  const html = read('index.html');
  const boot = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const themeSource = read('js/theme.js').replace(/^export /gm, '');
  check('theme boot precedes CSS, shares the module key and sets the canvas meta', Boolean(boot)
    && html.indexOf('<script>') < html.indexOf('<link rel="stylesheet"')
    && html.includes('<meta name="color-scheme" content="light dark">')
    && boot.includes('ib-university-finder:theme') && themeSource.includes('ib-university-finder:theme')
    && boot.includes("setAttribute('content', theme)"));
  const fixture = (stored, dark, failure) => {
    const listeners = new Set(), writes = [], attrs = {};
    const media = { matches: dark, addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
    const env = { document: { documentElement: { dataset: {} }, querySelector: () => ({ setAttribute(k, v) { attrs[k] = v; } }) }, matchMedia: () => media };
    const storage = { getItem() { if (failure === 'read') throw Error('blocked'); return stored; },
      setItem(k, v) { if (failure === 'write') throw Error('full'); writes.push([k, v]); },
      removeItem(k) { if (failure === 'remove') throw Error('blocked'); writes.push([k, null]); } };
    Object.defineProperty(env, 'localStorage', { get() { if (failure === 'getter') throw Error('blocked'); return storage; } });
    const flip = (value) => { media.matches = value; for (const fn of [...listeners]) fn(); };
    const api = runInNewContext(themeSource + '\n({initTheme, setThemeChoice, getThemeChoice});', env);
    return { env, api, listeners, writes, attrs, flip };
  };
  for (const dark of [false, true]) for (const stored of [undefined, 'junk', 'system', 'light', 'dark']) for (const failure of [null, 'getter', 'read']) {
    const f = fixture(stored, dark, failure);
    runInNewContext(boot, f.env);
    const expected = !failure && ['light', 'dark'].includes(stored) ? stored : dark ? 'dark' : 'light';
    const before = f.env.document.documentElement.dataset.theme;
    f.api.initTheme();
    check(`theme boot/module agree: system ${dark}, stored ${stored}, failure ${failure}`, before === expected
      && f.env.document.documentElement.dataset.theme === expected && f.attrs.content === expected && f.writes.length === 0);
  }
  for (const failure of [null, 'getter', 'write', 'remove']) {
    const f = fixture(undefined, false, failure), key = 'ib-university-finder:theme';
    f.api.initTheme(); f.flip(true);
    const system = f.env.document.documentElement.dataset.theme === 'dark' && f.listeners.size === 1;
    f.api.setThemeChoice('light'); f.flip(false); f.flip(true);
    const pinned = f.api.getThemeChoice() === 'light' && f.env.document.documentElement.dataset.theme === 'light' && f.listeners.size === 0;
    f.api.setThemeChoice('system'); f.flip(false);
    const resumed = f.api.getThemeChoice() === 'system' && f.env.document.documentElement.dataset.theme === 'light' && f.listeners.size === 1;
    f.api.setThemeChoice('system'); f.api.setThemeChoice('invalid');
    check(`theme memory survives ${failure ?? 'working storage'} and cleans up System listeners`, system && pinned && resumed && f.listeners.size === 1
      && f.writes.every(([k]) => k === key));
  }
  // The text scan may ignore script bodies only, never visible unmarked HTML.
  const scan = (text) => text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').split(/<[^>]*>/).filter((v) => /[A-Za-z]/.test(v));
  equal('HTML scan ignores script bodies but retains visible unmarked text', scan('<script>const boot = true;</script><p>Untranslated wording</p>'), ['Untranslated wording']);
  check('theme never enters saved filters or URL writers', !/theme/i.test(read('js/saved-state.js'))
    && !/theme/i.test(appSrc.slice(appSrc.indexOf('function keepAddress('), appSrc.indexOf('\n}', appSrc.indexOf('function keepAddress('))))
    && !/theme/i.test(appSrc.slice(appSrc.indexOf('function copyLink('), appSrc.indexOf('\n}', appSrc.indexOf('function copyLink(')))));
}
// Run the actual thumb measurement for both radio labels and the retained maths buttons.
{
  const round2 = read('js/round2.js').replace(/^import[^;]+;\n/gm, '').replace(/^export /gm, '');
  const label = { offsetWidth: 72, offsetLeft: 4 }, maths = { offsetWidth: 44, offsetLeft: 80 };
  const segment = (selected, radio) => ({ group: { offsetWidth: 160, querySelector: (s) => s === 'input:checked' ? (radio ? { closest: () => selected } : null) : selected }, thumb: { style: {} }, key: null });
  const radio = segment(label, true), buttons = segment(maths, false), hidden = segment(label, true); hidden.group.offsetWidth = 0;
  const env = { fixtures: [radio, buttons, hidden] };
  runInNewContext(round2 + '\nsegments = fixtures; syncSegments();', env);
  const measured = radio.thumb.style.width === '72px' && buttons.thumb.style.transform === 'translateX(80px)' && hidden.key === null;
  label.offsetWidth = 92; hidden.group.offsetWidth = 160;
  runInNewContext('syncSegments(true);', env);
  check('segment thumbs measure the checked label, force remeasure after translation, and wait for hidden groups to open', measured && radio.thumb.style.width === '92px' && hidden.thumb.style.width === '92px');
}
appCheck('settings handlers keep the panel open after a choice; null focusout stays open, real focusout and outside pointer close it', ({ get, fire, run, context }) => {
  const button = get('settings-open'), panel = get('settings-panel'), radio = panel.querySelector('[data-theme-choice="dark"]');
  fire(button, 'click');
  if (panel.hidden || button.getAttribute('aria-expanded') !== 'true') return false;
  radio.checked = true; fire(radio, 'change');
  if (panel.hidden || run('getThemeChoice()') !== 'dark') return false;
  fire(button.parentElement, 'focusout', { relatedTarget: null });
  if (panel.hidden) return false;
  fire(button.parentElement, 'focusout', { relatedTarget: get('f-search') });
  if (!panel.hidden) return false;
  fire(button, 'click'); fire(get('f-search'), 'pointerdown');
  return panel.hidden && button.getAttribute('aria-expanded') === 'false';
});

// ---------------------------------------------------------------- PR 7 polish
section('PR 7 UI polish: points box, FAQ answers, settings, sheet drag (A09-A12)');
// A09: iOS gives an <input> side padding of its own, so "45" in 44 px bold
// ran wider than the 90 px box's content area and scrolled sideways.
{
  const big = ruleAt(cssText, '.ob .big-pts input');
  check('A09 Setup\'s points box resets the browser\'s own padding and keeps its 90 px, 44 px bold, centred, numeric look',
    /width:90px;height:60px;padding:0;font-size:44px;font-weight:700;text-align:center;/.test(big) && /appearance:textfield/.test(big)
      && !/padding:0/.test(ruleAt(cssText.replace('width:90px;height:60px;padding:0;', 'width:90px;height:60px;'), '.ob .big-pts input')));
}
check('A10/A12 warmed sheet slides retain a Safari 16.4 transition before the newer allow-discrete shorthand',
  ['.sheet', '.faqp'].every((sel) => ruleAt(cssText, sel).includes('transition:transform var(--t-sheet-out) var(--ease-sheet),visibility var(--t-sheet-out);transition:'))
    && ['.sheet[open]', '.faqp[open]'].every((sel) => ruleAt(cssText, sel).includes('transition:transform var(--t-sheet-in) var(--ease-sheet);transition:')));
// A12's gesture rules, as pure functions.
check('A12 catching an opening sheet counts only finger travel towards dismissal',
  /shouldDismiss\(drag\.offset - drag\.base, drag\.height, dragVelocity\(drag\.samples\)\)/.test(read('js/sheet-drag.js')));
{
  const { dragVelocity, shouldDismiss } = sheetDragMod;
  const line = (speed, from = 0, n = 6, step = 16) => Array.from({ length: n }, (_, i) => ({ t: from + i * step, y: speed * i * step }));
  check('A12 drag speed is read over the last 80 ms: a steady flick reads its speed; a hold before lifting reads 0',
    Math.abs(dragVelocity(line(0.8)) - 0.8) < 1e-9
      && dragVelocity([...line(1.2), { t: 80 + 200, y: 96 }]) === 0);
  check('A12 one noisy sample cannot invent a flick, and two samples or under 20 ms are not enough to call one',
    dragVelocity([...line(0.05), { t: 88, y: 4 + 40 }]) < 0.5 && dragVelocity([...line(0.05)].map((s, i, a) => (i === a.length - 4 ? { ...s, y: s.y - 30 } : s))) < 0.5
      && dragVelocity([{ t: 0, y: 0 }, { t: 40, y: 40 }]) === 0 && dragVelocity([{ t: 0, y: 0 }, { t: 6, y: 20 }, { t: 12, y: 40 }]) === 0);
  check('A12 dismiss at min(120 px, a quarter of the sheet) or a 0.5 px/ms flick that moved 24 px; a fast upward finger always settles back',
    shouldDismiss(120, 900, 0) && !shouldDismiss(119, 900, 0) && shouldDismiss(100, 400, 0) && !shouldDismiss(99, 400, 0)
      && shouldDismiss(24, 900, 0.5) && !shouldDismiss(23, 900, 0.9) && !shouldDismiss(60, 900, 0.49)
      && !shouldDismiss(300, 900, -0.5) && shouldDismiss(300, 900, -0.2) && shouldDismiss(120, 0, 0));
}
// A12 on the real Filters sheet: the stand-in page, the real app.js and helper.
const pointer = (y, t, extra = {}) => ({ pointerId: 1, isPrimary: true, button: 0, clientY: y, timeStamp: t, ...extra });
const dragSheet = (fire, region, steps) => {
  let t = 1000, y = 100;
  fire(region, 'pointerdown', pointer(y, t));
  for (const [dy, dt] of steps.slice(0, -1)) { y += dy; t += dt; fire(region, 'pointermove', pointer(y, t)); }
  const [dy, dt] = steps.at(-1); y += dy; t += dt;
  return pointer(y, t);
};
appCheck('A12 Filters: a drag from the handle follows the finger, holds rows with no timer, and past 120 px closes through Done\'s path from where it was', ({ get, fire, run, advance }) => {
  const sheet = get('filter-sheet'), grab = sheet.querySelector('.grab'), more = get('f-more');
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  fire(more, 'click'); advance(600);
  if (!sheet.open || !grab) return false;
  const atClose = [];
  const close = sheet.close; sheet.close = function () { atClose.push([this.style.transform, this.style.transition]); return close.call(this); };
  const up = dragSheet(fire, grab, [[30, 100], [30, 100], [30, 100], [30, 100]]);
  const tracking = sheet.style.transform === 'translateY(90px)' && sheet.style.transition === 'none' && run('sheetDragHold') === true && run('sheetSlideTimer') === undefined;
  advance(2000);
  const heldRows = run('sheetDragHold') === true && run('windowFrame') === 0 && sheet.classList.contains('is-sliding');
  fire(grab, 'pointerup', up);
  return tracking && heldRows && !sheet.open && JSON.stringify(atClose) === JSON.stringify([[undefined, undefined]])
    && run('sheetDragHold') === false && run('sheetSlideTimer') !== undefined && more.getAttribute('aria-expanded') === 'false';
});
appCheck('A12 Filters: a short drag, a hold before lifting, a cancel and a lost capture all settle back open and hand rows to the bounded pause', ({ get, fire, run, advance }) => {
  const sheet = get('filter-sheet'), header = sheet.querySelector('.sheet-h h2');
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  fire(get('f-more'), 'click'); advance(600);
  const settled = () => sheet.open && sheet.style.transform === undefined && sheet.style.transition === undefined && run('sheetDragHold') === false;
  const results = [];
  fire(header, 'pointerup', dragSheet(fire, header, [[20, 100], [20, 100], [20, 100]])); results.push(settled());
  // 0.9 px/ms and 75 px, then 200 ms still: no speed left, not far enough.
  fire(header, 'pointerup', dragSheet(fire, header, [[15, 16], [15, 16], [15, 16], [15, 16], [15, 16], [0, 200]])); results.push(settled());
  dragSheet(fire, header, [[50, 16], [50, 16]]); fire(sheet, 'pointercancel', pointer(200, 2000)); results.push(settled());
  dragSheet(fire, header, [[50, 16], [50, 16]]); fire(sheet, 'lostpointercapture', pointer(200, 2000)); results.push(settled());
  // A late pointerup of the ended gesture finds nothing to do.
  fire(sheet, 'pointerup', pointer(900, 3000)); results.push(settled());
  advance(600);
  return results.every(Boolean) && run('sheetSlideTimer') === undefined && !sheet.classList.contains('is-sliding');
});
appCheck('A12 Filters: a quick downward flick closes; the close button, the body, a second finger and a wide screen never drag', ({ get, fire, run, advance, flip600 }) => {
  const sheet = get('filter-sheet'), header = sheet.querySelector('.sheet-h'), done = get('sheet-done'), body = sheet.querySelector('.sheet-b');
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  fire(get('f-more'), 'click'); advance(600);
  for (const [node, extra] of [[done, {}], [body, {}], [header, { isPrimary: false }], [header, { button: 2 }]]) {
    fire(node, 'pointerdown', pointer(100, 0, extra)); fire(node, 'pointermove', pointer(400, 50, extra));
    if (sheet.style.transform !== undefined || run('sheetDragHold')) return false;
  }
  fire(header, 'pointerup', dragSheet(fire, header, [[10, 16], [10, 16], [10, 16], [12, 16]]));
  const flicked = !sheet.open;
  fire(get('f-more'), 'click'); advance(600);
  flip600(true);
  fire(header, 'pointerdown', pointer(100, 0)); fire(header, 'pointermove', pointer(400, 50));
  return flicked && !sheet.open && sheet.style.transform === undefined && run('sheetDragHold') === false;
});
// Linux Chrome 156 turned a fast flick on the header into a fling and spent the
// next tap on stopping it: touch and pointer events arrived, no click
// (PR 7 CI, 2026-11-11). A cancelled touchmove leaves no gesture to fling.
appCheck('A12 Filters: touchmove on the handle and header is cancelled while a drag is on, and never before it, after it, on Done or in the body', ({ get, fire, advance }) => {
  const sheet = get('filter-sheet'), grab = sheet.querySelector('.grab'), header = sheet.querySelector('.sheet-h h2'), done = get('sheet-done'), body = sheet.querySelector('.sheet-b');
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  fire(get('f-more'), 'click'); advance(600);
  const cancelled = (node, cancelable = true) => !fire(node, 'touchmove', { cancelable });
  const before = [grab, header, done, body].some((node) => cancelled(node));
  const during = [];
  for (const region of [grab, header]) {
    dragSheet(fire, region, [[10, 100], [10, 100]]);
    during.push(cancelled(region), !cancelled(region, false), !cancelled(body));
    fire(region, 'pointerup', pointer(120, 1300));
    during.push(sheet.open && !cancelled(region));
  }
  fire(done, 'pointerdown', pointer(100, 0)); fire(done, 'pointermove', pointer(400, 50));
  return !before && during.every(Boolean) && !cancelled(done);
});
// The same fling by another road (PR 7 CI, 2026-11-11): Escape ended the drag
// with the finger still down, and its next move was no longer cancelled.
appCheck('A12 Filters: a touch that began a drag keeps its touchmove cancelled after Escape or a lost capture, until the finger lifts', ({ get, fire, advance }) => {
  const sheet = get('filter-sheet'), header = sheet.querySelector('.sheet-h h2'), touching = { pointerType: 'touch' };
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  const cancelled = (node) => !fire(node, 'touchmove', { cancelable: true });
  const results = [];
  for (const [how, lift] of [['escape', 'touchend'], ['lost', 'touchcancel']]) {
    fire(get('f-more'), 'click'); advance(600);
    fire(header, 'pointerdown', pointer(100, 1000, touching)); fire(header, 'pointermove', pointer(140, 1016, touching));
    if (how === 'escape') fire(get('sheet-h'), 'keydown', { key: 'Escape' }); else fire(sheet, 'lostpointercapture', pointer(140, 1020, touching));
    results.push(sheet.open === (how === 'lost') && sheet.style.transform === undefined, cancelled(header), cancelled(header));
    fire(header, lift);
    results.push(!cancelled(header));
    if (sheet.open) fire(get('sheet-done'), 'click');
    advance(600);
  }
  return results.every(Boolean);
});
appCheck('A12 Filters: Done, Escape or a reopen during a drag let go of the finger, release the row hold, and a late move does nothing', ({ get, fire, run, advance }) => {
  const sheet = get('filter-sheet'), header = sheet.querySelector('.sheet-h h2');
  sheet.rect = { top: 200, bottom: 844, left: 0, right: 390, width: 390, height: 644 };
  const results = [];
  for (const how of ['done', 'escape']) {
    fire(get('f-more'), 'click'); advance(600);
    dragSheet(fire, header, [[40, 16], [40, 16]]);
    if (how === 'done') fire(get('sheet-done'), 'click'); else fire(get('sheet-h'), 'keydown', { key: 'Escape' });
    fire(sheet, 'pointermove', pointer(700, 2000));
    results.push(!sheet.open && sheet.style.transform === undefined && sheet.style.transition === undefined && run('sheetDragHold') === false && run('sheetSlideTimer') !== undefined);
    advance(600);
  }
  fire(get('f-more'), 'click'); advance(600);
  fire(header, 'pointerup', dragSheet(fire, header, [[10, 100], [10, 100]]));
  return results.every(Boolean) && sheet.open && sheet.style.transform === undefined;
});
// A11: the settings popover's logical state and its exit.
const fakeAnimate = (log) => function (frames, options) {
  const animation = { frames, options, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
  log.push(animation); return animation;
};
appCheck('A11 settings: grows in 200 ms; a close is closed at once (inert, Escape passes, outside taps ignored); a reopen mid-exit starts from the screen; only the latest exit hides it', ({ get, fire }) => {
  const button = get('settings-open'), panel = get('settings-panel'), anims = [];
  panel.animate = fakeAnimate(anims);
  fire(button, 'click');
  const opened = !panel.hidden && panel.getAttribute('inert') === null && button.getAttribute('aria-expanded') === 'true' && anims.length === 1
    && anims[0].frames[0].opacity === 0 && /scale\(\.97\)/.test(anims[0].frames[0].transform) && anims[0].frames[1].transform === 'none' && anims[0].options.duration === 200
    && stubDocument.activeElement === panel.querySelector('[data-language="en"]');
  anims[0].onfinish();
  const shown = !panel.hidden && anims[0].cancelled;
  fire(button, 'click');
  const closing = button.getAttribute('aria-expanded') === 'false' && panel.getAttribute('inert') === '' && !panel.hidden && anims.length === 2
    && anims[1].options.duration === 140 && anims[1].frames[0].opacity === 1 && anims[1].frames[1].opacity === 0 && stubDocument.activeElement === button;
  const escapePasses = fire(get('f-search'), 'keydown', { key: 'Escape' });
  fire(get('f-search'), 'pointerdown');
  const noSecondExit = anims.length === 2;
  panel.computed = { opacity: '0.4', transform: 'matrix(0.98, 0, 0, 0.98, 0, -2)' };
  fire(button, 'click');
  const reversed = anims[1].cancelled && anims.length === 3 && anims[2].frames[0].opacity === '0.4' && anims[2].frames[0].transform === 'matrix(0.98, 0, 0, 0.98, 0, -2)'
    && panel.getAttribute('inert') === null && !panel.hidden && button.getAttribute('aria-expanded') === 'true';
  anims[1].onfinish();
  const staleIgnored = !panel.hidden && panel.getAttribute('inert') === null;
  delete panel.computed;
  fire(get('f-search'), 'pointerdown');
  anims.at(-1).onfinish();
  return opened && shown && closing && escapePasses && noSecondExit && reversed && staleIgnored
    && panel.hidden && panel.getAttribute('inert') === null && anims.at(-1).cancelled;
});
appCheck('A11 settings: Escape closes and returns to the gear; focusout closes; Reduce Motion fades only, in 100 ms, and still hides at its end', ({ get, fire, motionMedia }) => {
  const button = get('settings-open'), panel = get('settings-panel'), anims = [];
  panel.animate = fakeAnimate(anims);
  fire(button, 'click'); anims[0].onfinish();
  const esc = !fire(get('f-search'), 'keydown', { key: 'Escape', stopImmediatePropagation() { this.stopped = true; } }) && button.getAttribute('aria-expanded') === 'false' && stubDocument.activeElement === button;
  anims[1].onfinish();
  fire(button, 'click'); anims[2].onfinish();
  fire(button.parentElement, 'focusout', { relatedTarget: get('f-search') });
  const out = button.getAttribute('aria-expanded') === 'false' && panel.getAttribute('inert') === '';
  anims[3].onfinish();
  motionMedia.matches = true;
  try {
    fire(button, 'click');
    const reducedIn = anims[4].frames[0].transform === 'none' && anims[4].frames[1].transform === 'none' && anims[4].options.duration === 100;
    anims[4].onfinish(); fire(button, 'click');
    const reducedOut = anims[5].frames[1].transform === 'none' && anims[5].options.duration === 100;
    anims[5].onfinish();
    return esc && out && reducedIn && reducedOut && panel.hidden && panel.getAttribute('inert') === null;
  } finally { motionMedia.matches = false; }
});
check('A11 settings CSS: flat inset track and thumb, no ring, shadow or glow; one label weight; taps pass through a shutting panel; maths segments untouched',
  /padding:3px;background:var\(--hover\);border:0;/.test(ruleAt(cssText, '.settings-seg')) && /top:3px;bottom:3px;box-shadow:none/.test(ruleAt(cssText, '.settings-seg .segment-thumb'))
    && /font-weight:600/.test(ruleAt(cssText, '.settings-seg label')) && !/font-weight/.test(ruleAt(cssText, '.settings-seg label:has(input:checked)'))
    && /pointer-events:none/.test(ruleAt(cssText, '#settings-panel[inert]')) && /transform-origin:top right/.test(ruleAt(cssText, '#settings-panel'))
    && !/padding:0/.test(ruleAt(cssText, '.settings-seg', '(pointer:coarse),(max-width:599px)'))
    && /box-shadow:0 0 0 1px var\(--hairline\)/.test(ruleAt(cssText, '.segment-thumb')) && /top:0;bottom:0/.test(ruleAt(cssText, '.segment-thumb', '(pointer: coarse),(max-width:599px)')));
// A10: the FAQ answers, run for real with a stand-in Web Animation.
const answerRig = (panel) => {
  const anims = [];
  for (const details of panel.querySelectorAll('details')) {
    details.animate = fakeAnimate(anims);
    // screen: the height on screen mid-animation, read once before the answer lets go of it.
    const height = () => { const h = details.screen ?? (details.open ? 144 : 44); delete details.screen; return h; };
    Object.defineProperty(details, 'rect', { configurable: true, get: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: height() }) });
    details.querySelector('.a').rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 100 };
  }
  return anims;
};
check('A10 FAQ: one answer open at a time; opening another shuts the first in the same tap, which says collapsed and leaves Tab and the reader at once while it shuts',
  faqHarness(({ fire, opener, panel }) => {
    fire(opener, 'click');
    const anims = answerRig(panel), qs = panel.querySelectorAll('details'), s = (i) => qs[i].querySelector('summary');
    const before = qs.every((d) => d.querySelector('summary').getAttribute('aria-expanded') === 'false');
    const prevented = !fire(s(0), 'click');
    const first = qs[0].open && s(0).getAttribute('aria-expanded') === 'true' && anims.length === 1 && anims[0].frames[0].height === '44px' && anims[0].frames[1].height === '144px'
      && anims[0].options.duration === 260;
    anims[0].onfinish();
    fire(s(1), 'click');
    const a0 = qs[0].querySelector('.a');
    const swap = s(0).getAttribute('aria-expanded') === 'false' && a0.getAttribute('inert') === '' && a0.getAttribute('aria-hidden') === 'true' && qs[0].open
      && s(1).getAttribute('aria-expanded') === 'true' && qs[1].open && anims.length === 3 && anims[1].frames[1].height === '44px'
      && qs.filter((d) => d.querySelector('summary').getAttribute('aria-expanded') === 'true').length === 1;
    anims[1].onfinish();
    const shut = !qs[0].open && a0.getAttribute('inert') === null && a0.getAttribute('aria-hidden') === null && qs[0].style.overflow === undefined;
    return before && prevented && first && swap && shut;
  }) === true);
check('A10 FAQ: a tap mid-way reverses from the height on screen, and the older animation\'s late finish changes nothing',
  faqHarness(({ fire, opener, panel }) => {
    fire(opener, 'click');
    const anims = answerRig(panel), d = panel.querySelectorAll('details')[2], s = d.querySelector('summary');
    fire(s, 'click'); anims[0].onfinish();
    fire(s, 'click');
    d.screen = 90;
    fire(s, 'click');
    const reversed = anims[1].cancelled && anims[2].frames[0].height === '90px' && anims[2].frames[1].height === '144px' && s.getAttribute('aria-expanded') === 'true';
    anims[1].onfinish();
    return reversed && d.open && d.querySelector('.a').getAttribute('inert') === null;
  }) === true);
check('A10 FAQ: while the last answer shuts, its mailto link is out of the Tab trap even though its <details> is still open',
  faqHarness(({ fire, opener, panel }) => {
    fire(opener, 'click');
    const anims = answerRig(panel), last = panel.querySelectorAll('details').at(-1), close = panel.querySelector('.faqp-x');
    fire(last.querySelector('summary'), 'click'); anims[0].onfinish();
    fire(last.querySelector('summary'), 'click');
    close.focus();
    fire(close, 'keydown', { key: 'Tab', shiftKey: true });
    return last.open && stubDocument.activeElement === last.querySelector('summary');
  }) === true);
check('A10 FAQ: closing the panel, a resize or a new language mid-animation stops it and shows the logical state at its natural size',
  faqHarness(({ fire, opener, panel }) => {
    const resize = [];
    fire(opener, 'click');
    const anims = answerRig(panel), qs = panel.querySelectorAll('details'), s = (i) => qs[i].querySelector('summary');
    fire(s(0), 'click'); anims[0].onfinish(); fire(s(1), 'click');
    fire(panel.querySelector('.faqp-x'), 'click');
    const closed = anims[1].cancelled && anims[2].cancelled && !qs[0].open && qs[1].open && qs[0].querySelector('.a').getAttribute('inert') === null;
    fire(opener, 'click');
    fire(s(2), 'click');
    globalThis.__faqResize?.forEach((fn) => fn());
    return closed && resize.length === 0 && anims[3].cancelled && anims[4].cancelled && !qs[1].open && qs[2].open && s(2).getAttribute('aria-expanded') === 'true';
  }, { addEventListener(type, fn) { if (type === 'resize') (globalThis.__faqResize ??= []).push(fn); } }) === true);
delete globalThis.__faqResize;
check('A10 FAQ: a <details> opened or shut by the browser (find in page) becomes the logical state; without Web Animations or under Reduce Motion answers switch at once',
  faqHarness(({ fire, opener, panel }) => {
    fire(opener, 'click');
    const qs = panel.querySelectorAll('details'), s = (i) => qs[i].querySelector('summary');
    fire(s(0), 'click');
    const instant = qs[0].open && s(0).getAttribute('aria-expanded') === 'true';
    qs[3].open = true; fire(qs[3], 'toggle', { bubbles: false });
    const adopted = !qs[0].open && s(0).getAttribute('aria-expanded') === 'false' && s(3).getAttribute('aria-expanded') === 'true';
    qs[3].open = false; fire(qs[3], 'toggle', { bubbles: false });
    fire(s(5), 'click');
    return instant && adopted && s(3).getAttribute('aria-expanded') === 'false' && qs[5].open && qs.filter((d) => d.open).length === 1;
  }) === true);
check('A10 FAQ markup and CSS: two real strokes per question, only the vertical one turns (240 ms) by aria-expanded; no height:auto answer transition; the scrim fades by visibility, never display',
  (() => {
    const html = read('index.html'), panelSrc = elementSource(html, /<div class="faqp-b faq">/);
    const icon = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h16"/><path class="faq-v" d="M12 4v16"/></svg></summary>';
    return panelSrc.split(icon).length === 13 && !panelSrc.includes('#i-plus')
      && /transform-box:fill-box;transform-origin:center;transition:transform 240ms var\(--ease-out\)/.test(ruleAt(cssText, '.faq-v'))
      && /transform:rotate\(90deg\)/.test(ruleAt(cssText, '.faq summary[aria-expanded=true] .faq-v'))
      && !/\.faq details(?:\[open\])?::details-content|\.faqp-b\{interpolate-size|\.faq details\[open\] summary/.test(cssText) && !/transition/.test(ruleAt(cssText, '.faq .a'))
      && /display:block;visibility:hidden;/.test(ruleAt(cssText, '.faq-scrim')) && /visibility:visible/.test(ruleAt(cssText, '.faq-scrim.is-open'))
      && !/display/.test(ruleAt(cssText, '.faq-scrim.is-open'));
  })());
check('A10 FAQ answer timing in faq.js is --t-answer and --ease-out from styles.css',
  (() => {
    const src = read('js/faq.js'), ms = Number(src.match(/const ANSWER_MS = (\d+);/)?.[1]), ease = src.match(/const ANSWER_EASE = '([^']+)';/)?.[1];
    return ms === parseInt(css.match(/--t-answer:(\d+)ms/)?.[1], 10) && ease === css.match(/--ease-out:([^;]+);/)?.[1];
  })());
check('A10/A12 close buttons in both sheet headers: a quiet 32 px circle inside the 44 px target, centred icon, no border, shadow or glow',
  ['.sheet-h .btn', '.faqp-h .btn'].every((sel) => {
    const rule = ruleAt(cssText, sel);
    return /width:44px;height:44px;padding:0;justify-content:center;/.test(rule) && /border:0;border-radius:50%/.test(rule)
      && /radial-gradient\(circle 16px,var\(--hover\) 15\.5px,transparent 16px\)/.test(rule) && !/shadow/.test(rule);
  }) && ['.sheet-h .btn>.ic', '.faqp-h .btn>.ic'].every((sel) => /display:block;flex:none;width:18px;height:18px/.test(ruleAt(cssText, sel))));
check('A12 handle markup and CSS: a real element first in both sheets, phone only, 12 px like the old drawn one; touch-action off only on handle and header',
  (() => {
    const html = read('index.html');
    const grab = '<div class="grab" aria-hidden="true"><span></span></div>';
    return html.includes(`<dialog class="sheet" id="filter-sheet" aria-labelledby="sheet-h" aria-modal="true">\n  ${grab}\n  <div class="sheet-h">`)
      && html.includes(`<dialog class="faqp" id="faq-panel" aria-labelledby="faq-h" aria-modal="true">\n  ${grab}\n  <div class="faqp-h">`)
      && /display:none/.test(ruleAt(cssText, '.grab')) && /height:12px;padding-top:8px/.test(ruleAt(cssText, '.grab', '(max-width:599.98px)'))
      && /width:36px;height:4px;border-radius:2px;background:var\(--hairline\)/.test(ruleAt(cssText, '.grab>span', '(max-width:599.98px)'))
      && !/\.(?:sheet|faqp)::before/.test(cssText)
      && cssTree(cssText).filter((r) => /touch-action\s*:\s*none/.test(r.body)).map((r) => r.selector.replace(/\s+/g, '')).sort().join('|') === ['.faq-scrim', '.grab,.sheet-h,.faqp-h', '.ob-scrim', '.sheet-scrim'].sort().join('|');
  })());
check('A12 FAQ: on a phone the header drags the sheet down to close it through closeFaq (focus back on "?"); rows are held without a timer; wide screens never drag',
  (() => {
    const run = (phoneWide) => faqHarness(({ fire, opener, panel, heading, slides, timers }) => {
      panel.rect = { top: 100, bottom: 844, left: 0, right: 390, width: 390, height: 744 };
      fire(opener, 'click');
      fire(panel, 'transitionend', { propertyName: 'transform' });
      const before = slides.join();
      const up = dragSheet(fire, heading, [[40, 100], [40, 100], [40, 100], [40, 100]]);
      if (!phoneWide) return panel.style.transform === undefined && before === slides.join();
      const tracking = panel.style.transform === 'translateY(120px)' && slides.join() === `${before},true` && panel.classList.contains('is-sliding');
      fire(panel, 'transitionend', { propertyName: 'transform' });
      const held = slides.at(-1) === true;
      fire(heading, 'pointerup', up);
      while (timers.length) timers.shift()();
      return tracking && held && !panel.open && panel.style.transform === undefined && stubDocument.activeElement === opener && slides.at(-1) === false;
    }, { matchMedia: (q) => ({ matches: phoneWide && q === '(max-width: 599.98px)' }) });
    return run(true) === true && run(false) === true;
  })());
check('A12 the gesture helper is shared and owns no spring: both sheets call wireSheetDrag, and app.js closes the drag on every close and open',
  /wireSheetDrag\(dom\.sheet, \{ regions: '\.grab,\.sheet-h'/.test(appSrc) && /wireSheetDrag\(panel, \{ regions: '\.grab,\.faqp-h'/.test(read('js/faq.js'))
    && (appSrc.match(/sheetDrag\?\.reset\(\);/g) ?? []).length === 3 && !/spring|requestAnimationFrame/.test(read('js/sheet-drag.js').replace(/\/\/.*$/gm, ''))
    && indexHtml.includes('<link rel="modulepreload" href="js/sheet-drag.js">'));

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
