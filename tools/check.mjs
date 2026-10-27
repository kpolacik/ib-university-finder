// Checks the parts of this site that are easy to break by accident.
//
//   node tools/check.mjs
//
// Run it after changing anything in js/, and after a big edit to the Sheet.
// It needs no libraries — just Node. Every check prints ok or FAIL, and the
// script exits non-zero if anything failed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const { parseCsv, csvToObjects } = await import(new URL('../js/csv.js', import.meta.url));
const appSrcEarly = readFileSync(join(root, 'js/app.js'), 'utf8');
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
    this.className = ''; this.parent = null;
  }
  set textContent(text) { this.replaceChildren(String(text)); }
  get textContent() { return this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  get childElementCount() { return this.children.filter((c) => typeof c !== 'string').length; }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node !== 'string') {
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = this;
      }
      this.children.push(node);
    }
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
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (...add) => { this.className = [...new Set([...names(), ...add])].join(' '); },
      contains: (name) => names().includes(name),
    };
  }
}
const stubDocument = {
  createElement: (tag) => new ChromeNode(tag),
  createElementNS: (ns, tag) => new ChromeNode(tag),
  createTextNode: (text) => String(text),
};
// Installs the stand-in only while fn runs, then puts back whatever was there.
function withStubDocument(fn) {
  const original = globalThis.document;
  globalThis.document = stubDocument;
  try { return fn(); } finally {
    if (original === undefined) delete globalThis.document; else globalThis.document = original;
  }
}
const { renderDetail, renderRows, renderSlot, renderCount } = await import(new URL('../js/render.js', import.meta.url));
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
const renderSrc = read('js/render.js');
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
// Redesign stage 2: the row is "English requirement" and the tag .unk-t, so
// this renders the two rows rather than matching the old source text.
equal('the detail always has an English requirement row: "Not checked yet", or "Not published" for "?"',
  ['h-blank', 'h-q'].map((id) => {
    const dd = kvOf(detailOf(hcRow(id)))['English requirement'];
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
  kvAnchor >= 0 && renderSrc.indexOf("reqRow(list, 'General'") > kvAnchor);
equal('the detail shows the baseline as General, first letter capitalised',
  kvOf(detailOf(hcRow('h-blank'))).General?.textContent, 'A recognised school diploma');
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
    usedSnapshot(res) && res.meta.issues.some((i) => /^Live data unavailable/.test(i) && why.test(i)),
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
    && appSrcEarly.includes('Could not load the programme list. Check your connection and reload the page.')
    && appSrcEarly.includes("'Reload'") && !appSrcEarly.includes('${err.message}'));
check('a total failure hides the filters and lists the reasons in the problems panel',
  appSrcEarly.includes('dom.form.hidden = true') && /renderIssues\([^)]*err\.reasons/.test(appSrcEarly));


section('Stage 1 foundations: self-hosted fonts, colour policy and source chrome (L10, A05)');
const foundationHtml = read('index.html');
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
check('language buttons expose the selected English and described unavailable Slovak',
  /class="lang" role="group" aria-label="Site language"/.test(foundationHtml)
    && /type="button" aria-pressed="true">EN/.test(foundationHtml)
    && /type="button" aria-pressed="false" aria-disabled="true" lang="sk" aria-describedby="sk-later">SK/.test(foundationHtml)
    && /class="visually-hidden" id="sk-later">Slovak version coming later/.test(foundationHtml));
check('source line starts hidden without a live region and uses allRows once after load',
  /<p class="src" id="source-line" hidden><\/p>/.test(foundationHtml)
    && appSrcEarly.includes('renderSourceLine(dom.sourceLine, allRows, meta)')
    && (appSrcEarly.match(/renderSourceLine\(/g) ?? []).length === 1);
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
      && source.children[2].className === 'src-more');
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
        && saved.textContent.includes(date ? '26 October 2026' : 'an unknown date'));
  }
  for (const count of [1, 2]) {
    renderSourceBanner(banner, { ...base, issues: Array(count).fill('problem') });
    const saved = banner.children[0];
    const link = saved.children[1].children.at(-1);
    check(`issues-only neutral status with ${count} ${count === 1 ? 'problem' : 'problems'}`,
      saved.className === 'bn bn-saved' && saved.attributes.role === 'status'
        && saved.textContent.includes(`${count} spreadsheet ${count === 1 ? 'problem:' : 'problems:'}`)
        && saved.textContent.includes('some rows may be missing or incomplete.')
        && link.href === '#issues' && link.textContent === 'See the list below the results.');
  }
  for (const count of [1, 3]) {
    renderSourceBanner(banner, { ...base, sampleCount: count });
    const sample = banner.children[0];
    equal(`sample-only ${count === 3 ? 'all' : 'mixed'} bold lead`, sample.children[0].children[0].textContent,
      count === 3 ? 'Every figure on this page is made up.' : '1 of 3 entries are made-up sample rows.');
    check('sample uses a separate red status with the original applications warning',
      sample.className === 'bn bn-sample' && sample.attributes.role === 'status'
        && sample.textContent.includes(`Do not use ${count === 3 ? 'it' : 'them'} for real applications.`));
  }
  for (const samples of [0, 1]) {
    renderSourceBanner(banner, { ...base, source: 'snapshot', draftCount: 3, sampleCount: samples, issues: ['problem'] });
    check(`snapshot plus issues${samples ? ' plus samples' : ''} keeps one neutral status and its link`,
      banner.children.length === (samples ? 2 : 1) && banner.children[0].className === 'bn bn-saved'
        && banner.children[0].textContent.includes('saved copy') && banner.children[0].textContent.includes('See the list below')
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

section('Search: every word, any order; short words start a word (S01)');
const filtersMod = await import(new URL('../js/filters.js', import.meta.url));
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
  'f-cs,nl,Computer Science and Engineering,Computer Science & IT,2027-01-15,https://example.org,2026-08-14,TT',
  'f-phys,nl,Applied Physics,Natural Sciences,2027-01-15,https://example.org,2026-08-14,TT',
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
const indexHtml = read('index.html');
check('the fee field takes any whole euro amount (no step="500")',
  !indexHtml.includes('step="500"') && /id="f-tuition"[^>]*step="1"/.test(indexHtml));
check('both number fields point at a message element',
  /id="f-points"[^>]*aria-describedby="f-points-error"/.test(indexHtml) && indexHtml.includes('id="f-points-error"')
    && /id="f-tuition"[^>]*aria-describedby="f-tuition-error"/.test(indexHtml) && indexHtml.includes('id="f-tuition-error"'));
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
  indexHtml.includes('id="empty-clear"') && appSrc.includes("dom.emptyClear.addEventListener('click', clearAll)"));

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
check('app.js writes the URL values into the fields before loading, and keeps the address up to date',
  startBody.indexOf('applyUrlFields(') > 0 && startBody.indexOf('applyUrlFields(') < startBody.indexOf('await loadData(')
    && appSrc.includes('history.replaceState('));

// The audits found these with a keyboard, a screen reader and a 320 px phone.
// There is no DOM here, so they are checked as text; the browser steps in
// the plan cover how they behave.
section('Keyboard, screen readers and narrow screens (A02-A07)');
check('one .visually-hidden utility is defined', /\.visually-hidden \{[^}]*clip/.test(css));
// A03: the text inputs and Sort replaced the outline with a 1.04:1 soft ring.
check('text inputs and Sort keep the focus outline (no outline: none)',
  !/\.field input:focus[^{]*\{[^}]*outline: none/.test(css) && !/select:focus[^{]*\{[^}]*outline: none/.test(css));
// A05: the h1's decorative full stop was read out as part of the title.
check('the h1 is plain IB University Finder with no generated full stop',
  /<h1>IB University Finder<\/h1>/.test(read('index.html')) && !/h1\s*::after/.test(css));
// A02: dropdown panels and the masthead stat pushed a 320 px page to 354 px.
const narrow = css.slice(css.indexOf('@media (max-width: 719px)'));
check('below 720 px the dropdown panels span the menus row',
  /\.filterbar-menus \{ position: relative; \}/.test(narrow) && /\.dropdown \{ position: static; \}/.test(narrow)
    && /\.dropdown-panel \{[^}]*left: 0; right: 0; width: auto;/.test(narrow));
check('the source line wraps normally and phone hides stat and advice',
  /\.src\{[^}]*white-space:normal/.test(css) && /\.stat,\.src-more\{display:none\}/.test(css)
    && /@media \(min-width: 600px\)[\s\S]*?\.tagline,\.stat,\.src-more\{display:inline\}/.test(css));
// A07: the sticky bar hid the skip-link target and filled a landscape phone.
check('the filter bar is sticky only on screens at least 720 wide and 600 tall',
  /@media \(min-width: 720px\) and \(min-height: 600px\) \{\s*\.filterbar \{ position: sticky;/.test(css)
    && !/@media \(min-width: 720px\) \{\s*\.filterbar \{ position: sticky/.test(css));
check('#results has a scroll-margin-top that clears the sticky bar', /#results \{[^}]*scroll-margin-top/.test(css));
// A05, A04: names a screen reader reads out.
check('a hidden ", " separates the title from the degree',
  renderSrc.includes("el('span', 'visually-hidden', ', ')"));
check('a Czech-only title is marked lang="cs"', /title\.lang = 'cs'/.test(renderSrc));
// Redesign stage 2: the source check is on renderDetail; every live row is
// rendered and checked further down ("each detail is named by its title").
check('each detail is named by its title (aria-labelledby, id from programme_id)',
  renderDetailSrc.includes("article.setAttribute('aria-labelledby'") && /title\.id = `p-\$\{row\.id\}`/.test(renderDetailSrc));
check('the official link names its programme and says it opens a new tab',
  renderSrc.includes('(opens in a new tab)') && /for \$\{row\.programme\}, \$\{row\.university\}/.test(renderSrc));
// A06: the pick-lists and the live result count.
check('a dropdown closes when focus leaves it (focusout)', appSrc.includes("addEventListener('focusout'"));
check('Escape returns focus to the summary only from inside the open dropdown',
  /open\.contains\(document\.activeElement\)/.test(appSrc));
check('the dropdown count reads "2 selected" (hidden text in its own span)',
  indexHtml.includes('<span class="visually-hidden"> selected</span>') && appSrc.includes("subjectsCountNumber"));
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
  messy.length > 0 && grid[1][grid[0].indexOf('Subject requirements')] === messy[0].ibSubjects);
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
equal('the export says "not published" for a "?" admission, city and language',
  [cell(4, 'Admission'), cell(4, 'City'), cell(4, 'Language')], ['not published', 'not published', 'not published']);
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

// D01: WBB closes 1 Nov 2026 and goes through the Common App. The row used to
// say "2027/28 dates not out yet" and inherit Bocconi's own portal.
const liveRow = (id) => live.find((p) => p.id === id);
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
// it was, and its note gave a 15 January deadline the page doesn't have.
const ucg = liveRow('rug-ucg');
const ucgText = ucg ? [...ucg.otherRequirements, ...ucg.admission, ucg.deadlineNotes].join(' | ') : '';
check('rug-ucg is not called numerus fixus, and has no 15 January date',
  ucg && !/(?<!not (a )?)numerus fixus/i.test(ucgText) && !/15 January/i.test(ucgText), ucgText || 'row missing');

// D09: notes are for students, not maintainer to-dos, and must not promise
// news by a date that has gone. Real deadlines ("by 15 January 2027") are fine;
// only "will confirm / announce / publish ... by <date>" is a promise.
const confirm = live.filter((p) => /CONFIRM/.test(p.deadlineNotes));
check('no note contains a CONFIRM to-do', confirm.length === 0, confirm.map((p) => p.id).join(', '));
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const runDate = new Date();
const lapsed = live.filter((p) => [...p.deadlineNotes.matchAll(
  /\bwill (?:confirm|announce|publish)\b[^.]*?\bby (\d{1,2}) ([A-Za-z]+) (\d{4})/gi,
)].some(([, d, m, y]) => {
  const month = MONTHS.indexOf(m.toLowerCase());
  return month >= 0 && new Date(Date.UTC(+y, month, +d)) < runDate;
}));
check('no note promises news by a date that has passed', lapsed.length === 0,
  `a note promises news by a date that has passed — re-read the page: ${lapsed.map((p) => p.id).join(', ')}`);

// R02 on the real data: these three rows have a different admission route from
// their university and nobody has published it. They must say so on the card.
const unknownAdmission = ['lei-archaeology', 'lei-luc', 'uu-ucr'].filter((id) => !(liveRow(id) && liveRow(id).admissionUnknown));
check('lei-archaeology, lei-luc and uu-ucr show an unknown admission route', unknownAdmission.length === 0,
  unknownAdmission.join(', '));

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
check('every programme carries its university\'s baseline (29 universities have one)',
  lostBaseline.length === 0 && [...baselineOf.values()].filter(Boolean).length === 29,
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
  && !p.otherRequirements.includes(ie.HPAT) && p.otherRequirements.join(' · ') !== CAO_TEST;
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
equal('pointsPlusTest is on exactly the non-HPAT cutoffs above 625',
  live.filter((p) => p.pointsPlusTest).map((p) => p.id).sort(),
  irish.filter((p) => !isHpatRow(p) && cutoffOf(p) > 625).map((p) => p.id).sort());
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
  const test = p.otherRequirements.join(' · ') === CAO_TEST;
  return p.ibPointsMin !== pts.ibForCutoff(latestOf(p)?.points ?? null, { test }).ib;
});
check('every non-UCD Irish ib_points_min is ibForCutoff of its latest round (HPAT rows 35)', figureWrong.length === 0,
  figureWrong.map((p) => `${p.id} ${p.ibPointsMin}`).join(', '));
const bonusWrong = nonUcdCao.filter((p) => caoOf(p) && !isHpatRow(p)).filter((p) => {
  const test = p.otherRequirements.join(' · ') === CAO_TEST;
  return pts.ibForCutoff(latestOf(p)?.points ?? null, { test }).bonusOnly !== p.deadlineNotes.includes(ie.BONUS_ONLY);
});
check('BONUS_ONLY is on a row exactly when its latest round is bonus-only', bonusWrong.length === 0,
  bonusWrong.map((p) => p.id).join(', '));
const twoRound = live.filter((p) => caoOf(p)?.rounds.length === 2);
check('the two-round sentence is on the real rows (Round 1 first)', twoRound.length > 100
  && twoRound.every((p) => caoOf(p).rounds.map((r) => r.round).join() === '1,2'), `${twoRound.length} rows`);
console.log(`        ${nonUcdCao.length} non-UCD Irish rows with a CAO code, ${twoRound.length} rows quote two rounds`);

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
  'c-test-520': 'Within your points only with HL Maths 4+.',
  'c-test-560': 'Shown despite your points: the cutoff includes a test, interview or audition.',
  'c-r2': 'Within your points on the Round 2 cutoff, not Round 1.',
  'c-r2-maths': 'Within your points only with HL Maths 4+. Within your points on the Round 2 cutoff, not Round 1.',
  'c-r2-higher': null, 'ucd-33': null, 'ie-hpat35': null, 'nl-37': null,
  blank: 'Shown despite your points: points unknown.',
});
equal('card notes at 36, ticked: the bonus reaches Round 1 of c-r2 (522 ≥ 520) but not of c-r2-maths (530)',
  [notes(36, true)['c-r2'], notes(36, true)['c-r2-maths'], notes(36, true)['c-test-520']],
  [null, 'Within your points on the Round 2 cutoff, not Round 1.', null]);
const visible = (my, maths) => applyFilters(bk, fstate(my, maths)).map((p) => p.id);
equal('applyFilters drops only the hidden bucket', visible(36, false),
  bk.map((p) => p.id).filter((id) => !['c-625', 'nl-37'].includes(id)));
equal('pointsSummary at 36, unticked and ticked', [filtersMod.pointsSummary(bk, fstate(36)), filtersMod.pointsSummary(bk, fstate(36, true))],
  ['5 within your points · 2 only with HL Maths 4+ · 2 points unknown', '7 within your points · 2 points unknown']);
equal('pointsSummary leaves out an empty bucket and is empty without My points',
  [filtersMod.pointsSummary(bk.filter((p) => p.id === 'c-497'), fstate(36)), filtersMod.pointsSummary(bk, filtersMod.createFilterState())],
  ['1 within your points', '']);

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
    && appSrc.includes('dom.maths.checked = false') && appSrc.includes("used.push('HL Maths 4+')")
    && appSrc.includes('pointsSummaryParts(rows, state)'));
check('index.html has the HL Maths 4+ checkbox with its help text', /<input type="checkbox" id="f-maths"/.test(read('index.html'))
  && read('index.html').includes('adds the 25 CAO bonus points on Irish courses'));
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
  if (/Tuition \(EU\)|No tuition fee/.test(a.textContent)) say('old fee wording');
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
const cellOf = (a, name) => byClass(a, name)[0];
const fillOf = (cell) => ['v-fit', 'v-cond', 'v-unk', 'v-time', 'v-past'].filter((c) => cell.classList.contains(c)).join(' ');
check('every fixture row renders cleanly with My points empty and at 36',
  [noFilters(), fstate(36)].every((st) => fxs.filter((r) => filtersMod.pointsBucket(r, st) !== 'hidden').every((r) => detailProblems(r, st).out.length === 0)),
  [noFilters(), fstate(36)].flatMap((st) => fxs.flatMap((r) => detailProblems(r, st).out)).slice(0, 6).join('\n        '));

// EU fee: blank is not zero.
equal('EU fee: €2,500 / year, "€0 · no tuition fee", and "Not published" (dashed) for blank and "?"',
  ['fx-plain', 'fx-zero', 'fx-fee-blank', 'fx-fee-q'].map((id) => {
    const cell = cellOf(fxDetail(id), 'c-fee');
    return [cell.children[0].textContent, byClass(cell, 'fig')[0].textContent, fillOf(cell)];
  }), [['EU fee', '€2,500 / year', ''], ['EU fee', '€0 · no tuition fee', ''], ['EU fee', 'Not published', 'v-unk'], ['EU fee', 'Not published', 'v-unk']]);

// Deadline: long date, urgent with the clock, passed (neutral, struck) and none.
equal('Deadline cell: plain, 34 days, tomorrow, today, passed and not published',
  ['fx-plain', 'fx-34', 'fx-tomorrow', 'fx-today', 'fx-passed', 'fx-no-deadline'].map((id) => {
    const cell = cellOf(fxDetail(id), 'c-ddl');
    const verd = byClass(cell, 'verd')[0];
    const clock = byTag(cell, 'use').some((u) => u.getAttribute('href') === '#i-clock');
    return [fillOf(cell), verd?.textContent ?? null, byClass(cell, 'fig')[0].textContent, clock, byTag(cell, 's').length];
  }), [
    ['', null, '1 February 2027', false, 0],
    ['v-time', 'in 34 days', '17 September 2026', true, 0],
    ['v-time', 'tomorrow', '15 August 2026', true, 0],
    ['v-time', 'today', '14 August 2026', true, 0],
    ['v-past', 'Passed, check next cycle', '31 March 2026', false, 1],
    ['v-unk', null, 'Not published', false, 0],
  ]);
check('a passed row says "Check the official page for the next cycle." under Applying, before its deadline notes',
  kvOf(fxDetail('fx-passed'))['Deadline notes']?.children[0]?.textContent === 'Check the official page for the next cycle.'
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
  ['v-fit', 'verd m m-fit: Within your points', null, 0],
  ['v-fit', 'verd m m-fit: Within your points', 'Within your points on the Round 2 cutoff, not Round 1.', 0],
  ['v-fit', 'verd m m-fit: Within your points, then HPAT', null, 0],
  ['v-cond', 'verd m m-cond: Only with HL Maths 4+', 'Within your points only with HL Maths 4+.', 0],
  ['v-cond', 'verd m m-cond: Only with HL Maths 4+', 'Within your points only with HL Maths 4+. Within your points on the Round 2 cutoff, not Round 1.', 0],
  ['v-fit', 'verd m m-fit: Within your points', null, 0],
  ['v-unk', 'verd m m-unk: Cutoff includes a test', 'Shown despite your points: the cutoff includes a test, interview or audition.', 0],
  ['v-unk', 'verd m m-unk: No minimum published', 'Shown despite your points: points unknown.', 0],
  ['v-unk', 'verd m m-unk: No IB figure', 'Shown despite your points: points unknown.', 0],
  ['v-unk', 'verd m m-unk: No IB figure', 'Shown despite your points: points unknown.', 0],
  ['', null, null, 0],
  ['v-unk', null, null, 0],
]);
check('TCD Computer Science reads its live band: HL Maths 4+ at 36, within on Round 2 only at 37, no invented degree', (() => {
  const row = live.find((p) => p.id === 'tcd-computer-science');
  const at36 = verdictOf(row, fstate(36));
  const at37 = verdictOf(row, fstate(37));
  console.log(`        tcd-computer-science: ${pts.pointsLines(row).map(pts.pointsLineText).join(' | ')}; degree ${JSON.stringify(row.degreeType)}`);
  return at36[0] === 'v-cond' && at36[2] === 'Within your points only with HL Maths 4+.'
    && at37[0] === 'v-fit' && at37[2] === 'Within your points on the Round 2 cutoff, not Round 1.'
    && byClass(detailOf(row), 'deg').length === (row.degreeType ? 1 : 0);
})());

// Data rules in the markup.
equal('Subjects: "None required" for none, a dashed "Not checked yet" for blank',
  ['fx-subjects-none', 'fx-subjects-blank'].map((id) => {
    const dd = kvOf(fxDetail(id)).Subjects;
    return [dd.textContent, byClass(dd, 'unk-t').length];
  }), [['None required', 0], ['Not checked yet', 1]]);
equal('Admission and Other join their items with " · "; "?" admission is a dashed "Not published"',
  [kvOf(fxDetail('fx-admission')).Admission.textContent, kvOf(fxDetail('fx-other')).Other.textContent,
    byClass(kvOf(fxDetail('fx-admission-q')).Admission, 'unk-t')[0]?.textContent, Boolean(kvOf(fxDetail('fx-plain')).Admission)],
  ['Entrance exam · Can be waived', 'Portfolio · Interview', 'Not published', false]);
equal('a "?" English requirement is a dashed "Not published"',
  byClass(kvOf(fxDetail('fx-english-q'))['English requirement'], 'unk-t')[0]?.textContent, 'Not published');
check('"nothing at all" is a plain sentence and no list',
  (() => {
    const a = fxDetail('fx-nothing');
    const req = byClass(a, 'd-sec')[0];
    return byTag(req, 'dl').length === 0
      && byClass(req, 'kv-none')[0]?.textContent === 'No requirements beyond a school diploma equivalent to Dutch VWO';
  })());
check('a blank baseline leaves General out', !kvOf(fxDetail('fx-no-general')).General
  && kvOf(fxDetail('fx-plain')).General?.textContent === 'A school diploma equivalent to Dutch VWO');
check('an Applying section with nothing to say is left out, not drawn empty',
  (() => {
    const a = fxDetail('fx-no-applying');
    return byClass(a, 'd-sec').length === 1 && byClass(a, 'two')[0].children.length === 1;
  })());
equal('Applying: living costs, taught in and apply via',
  ['Living costs', 'Taught in', 'Apply via'].map((k) => kvOf(fxDetail('fx-plain'))[k]?.textContent),
  ['€1,100 / month', 'English', 'Studielink']);

// Notes, links and provenance.
const tuitionNote = 'Shown despite the tuition filter — we do not have a fee for this one.';
const feeState = { ...noFilters(), maxTuition: 3000 };
check('the tuition note appears for an unknown fee only while Max fee is set',
  byClass(fxDetail('fx-fee-blank', feeState), 'note').some((n) => n.textContent === tuitionNote)
    && !byClass(fxDetail('fx-fee-blank'), 'note').length && !byClass(fxDetail('fx-plain', feeState), 'note').length);
check('no official link: a strong note, no button, and the row is still rendered',
  (() => {
    const a = fxDetail('fx-nolink');
    return byClass(a, 'note-strong')[0]?.textContent === 'No official link on file — do not rely on this entry.'
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
check('renderRows keeps its call contract and the inert shortlist options',
  /export function renderRows\(container, rows, \{ state, shortlist, onToggleStar \}\)/.test(renderSrc)
    && /rows\.map\(\(row\) => renderRow\(row, state\)\)/.test(renderSrc)
    && appSrc.includes('renderRows(dom.results, rows, { state, shortlist, onToggleStar })'));

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
  'ie-bonus': [['≈44', 'R1']], 'ie-above-r1': [[null, 'R1 no IB figure'], ['≈44', 'R2']],
  'ie-test-r1': [[null, 'R1 no IB figure'], ['≈44', 'R2']], 'ie-aqa-r2': [['≈29', 'R1'], [null, 'R2 all qualified']],
  'ie-legacy': [['≈40', 'cutoff 2025']], 'ucd-x': [['33', 'minimum']],
  'ie-hpat': [['35', 'then HPAT']], 'nl-min': [['36', 'minimum']], 'ie-blank': [],
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
  for (const row of live) if (filtersMod.roundTwoOnly(row, state) !== !!filtersMod.pointsNote(row, state)?.includes('Within your points on the Round 2 cutoff, not Round 1.')) helperAgreement = false;
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
  ['v-fit', 'Within your points', '≈36 R1', null, null],
  ['v-fit', 'Within your points', '≈38 R1 · ≈36 R2', 'on the Round 2 cutoff only', null],
  ['v-fit', 'Within your points, then HPAT', '35 minimum', null, null],
  ['v-cond', 'Only with HL Maths 4+', '≈39 R1 · ≈38 R2', 'on the Round 2 cutoff only', null],
  ['v-fit', 'Within your points', '≈38 R1', null, null],
  ['v-unk', 'Cutoff includes a test', '≈41 R1', null, null],
  ['v-unk', 'No IB figure', 'entrance exam', null, null],
  ['v-unk', 'No minimum published', null, null, null],
  ['v-none', null, '≈44 R1', null, 'with HL Maths 4+'],
  ['v-cond', 'Only with HL Maths 4+', '≈44 R1', null, null],
  ['v-fit', 'Within your points', '≈44 R1', null, null],
]);
check('TCD CS row reads the live figures and band at 36/36 ticked/37/empty', (() => {
  const row = live.find((p) => p.id === 'tcd-computer-science');
  const figure = ptsShort(row).parts.map((p) => `${p.figure} ${p.label}`).join(' · ');
  return rowPoints(row, fstate(36))[0] === 'v-cond' && rowPoints(row, fstate(36, true))[0] === 'v-fit'
    && rowPoints(row, fstate(37))[3] === 'on the Round 2 cutoff only'
    && rowPoints(row, noFilters())[0] === 'v-none' && rowPoints(row, fstate(36))[2] === figure;
})());
equal('row deadline: short plain date, countdowns, neutral passed and dashed unknown',
  ['fx-plain', 'fx-34', 'fx-tomorrow', 'fx-today', 'fx-passed', 'fx-no-deadline'].map((id) => {
    const c = cellOf(rowOf(fxRow(id)), 'c-ddl');
    return [fillOf(c), byClass(c, 'verd')[0]?.textContent ?? null, byClass(c, 'fig')[0].textContent, byTag(c, 's').length];
  }), [['', null, '1 Feb 2027', 0], ['v-time', 'in 34 days', new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-09-17T00:00:00Z')), 0], ['v-time', 'tomorrow', '15 Aug 2026', 0],
    ['v-time', 'today', '14 Aug 2026', 0], ['v-past', 'Passed, check next cycle', '31 Mar 2026', 1], ['v-unk', null, 'Not published', 0]]);
equal('row date: November and December use short names', [11, 12].map((m) => byClass(rowOf({ ...fxRow('fx-plain'), deadline: new Date(`2026-${m}-01T00:00:00Z`) }), 'c-ddl')[0].textContent),
  ['Deadline1 Nov 2026', 'Deadline1 Dec 2026']);
equal('row fee: known, zero, blank and ? keep distinct meanings',
  ['fx-plain', 'fx-zero', 'fx-fee-blank', 'fx-fee-q'].map((id) => byClass(rowOf(fxRow(id)), 'c-fee')[0].textContent),
  ['EU fee€2,500 / year', 'EU fee€0 · no tuition fee', 'EU feeNot published', 'EU feeNot published']);
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
check('row sub line: known, unknown, blank city and unknown country are honest', (() => {
  const r = fxRow('fx-plain');
  return byClass(rowOf(r), 'uc')[0].textContent === 'Fixture University · Town'
    && byClass(rowOf({ ...r, cityUnknown: true }), 'uc')[0].textContent.endsWith('City not published')
    && byClass(rowOf({ ...r, city: '' }), 'uc')[0].textContent === 'Fixture University'
    && byClass(rowOf({ ...r, country: 'Elsewhere' }), 'cc')[0].textContent === 'Elsewhere';
})());
for (const [label, state] of [...liveRuns, ['45', fstate(45)]]) {
  const shown = applyFilters(live, state);
  const list = withStubDocument(() => { const n = new ChromeNode('ul'); renderRows(n, shown, { state }); return n; });
  const rowProblems = list.children.filter((li, i) => li.tagName !== 'li' || !li.classList.contains('item') || li.getAttribute('data-id') !== shown[i].id
    || byClass(li, 'cell').length !== 3 || byClass(li, 'lab').length !== 3 || byTag(li, 'article').length
    || !byClass(li, 'cc')[0]?.getAttribute('aria-hidden') || byClass(li, 'open')[0].getAttribute('aria-expanded') !== 'false');
  check(`all live rows are light, labelled and country coded at ${label}`, list.childElementCount === shown.length && !rowProblems.length);
  const problems = shown.flatMap((row) => detailProblems(row, state, true).out);
  check(`all live slot details preserve every fact and note at ${label}`, !problems.length, problems.slice(0, 6).join(', '));
}
check('all fixture slots render cleanly, including every short points form', [noFilters(), fstate(36), fstate(36, true), fstate(37)].every((st) =>
  [...fxs, ...kinds, ...bk].filter((r) => filtersMod.pointsBucket(r, st) !== 'hidden').every((r) => !detailProblems(r, st, true).out.length)));
check('slot regions have unique stable ids, resolved names and no duplicated head/cells', live.every((row) => {
  const slot = withStubDocument(() => renderSlot(row, noFilters()));
  return slot.id === `x-${row.id}` && slot.getAttribute('role') === 'region' && slot.getAttribute('aria-label') === `${row.programme}, details`
    && !indexHtml.includes(`id="${slot.id}"`) && !byClass(slot, 'd-head').length && !byClass(slot, 'd-cells').length;
}));
check('row button name separates degree and keeps Czech pronunciation', (() => {
  const row = live.find((p) => p.id === 'muni-anthropology'), b = byClass(rowOf(row), 'open')[0];
  return b.lang === 'cs' && byClass(b, 'deg')[0]?.lang === 'en' && b.textContent === `${row.programme}, ${row.degreeType}`;
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
    && /state.sort = dom.sort.value;\s*syncSort\(\);/.test(appSrc) && /state.sort = key;\s*syncSort\(\);/.test(appSrc));
check('row toggle removes controls with the target, restores shown open ids and uses no arrow-key handler',
  appSrc.includes("button.removeAttribute('aria-controls')") && appSrc.includes('openIds.delete(id)') && appSrc.includes('openIds.has(item.dataset.id)')
    && !/ArrowUp|ArrowDown|aria-current/.test(appSrc));
check('six static skeleton rows, hidden trap guarded, no compass, no empty live region',
  (indexHtml.match(/class="sk-row"/g) ?? []).length === 6 && /id="loading" aria-hidden="true"/.test(indexHtml)
    && !/shimmer|@keyframes/.test(css) && /\[hidden\] \{ display: none !important; \}/.test(css)
    && !indexHtml.includes('i-compass') && !/<div[^>]*(?:role|aria-live)=[^>]*id="empty-state"|id="empty-state"[^>]*(?:role|aria-live)=/.test(indexHtml));
check('empty h2, search tips and Clear all count are present',
  indexHtml.includes('<h2 id="empty-title">') && indexHtml.includes('Search matches words in any order')
    && indexHtml.includes('Short words match the start of a word') && appSrc.includes('`Clear all (${activeFilterCount(state)})`'));
check('row wraps whole point parts without clipping requirements; containment only on items',
  /white-space:nowrap/.test(ruleBody('.pt')) && !/white-space:\s*nowrap/.test(ruleBody('.row .cell'))
    && !/line-clamp|max-height|overflow\s*:\s*hidden/.test(ruleBody('.line'))
    && !/content-visibility/.test(ruleBody('.detail') + ruleBody('.expand') + ruleBody('.results>.detail'))
    && /contain-intrinsic-size:auto/.test(ruleBody('.item')) && /border:0;border-radius:0/.test(ruleBody('.expand>.detail')));
check('all CSS variable references are canonical or page variables, with shadow reserved for the pane',
  [...cssRules.replace(/:root\s*\{[^{}]*\}/g, '').matchAll(/var\((--[\w-]+)/g)].every(([, t]) =>
    new RegExp(`${t}\\s*:`).test(cssRules.match(/:root\s*\{([^{}]*)\}/)[1]) || ['--gut', '--ctl', '--fs-ctl', '--tap'].includes(t))
    && !/var\(--shadow\)/.test(css));

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
check('row CSS contains no copied mockup gallery, filter or sheet rules',
  !/\.g-h3\b|\.app\s*\{\s*container\s*:|\.(?:fbar|fld|inp|cshort|is-stuck|split|copy)(?![\w-])|\.listp\s*\{\s*justify-self\s*:|\.spec\s+\.dd(?![\w-])/.test(cssRules));
check('Stage 3 chrome has exactly one base definition and count/columns stay static',
  ['.status', '.mast', '.src', '.lang', '.bn', '.foot'].every((sel) => baseSelectors.filter((s) => s === sel).length === 1)
    && !/position\s*:\s*(?:sticky|fixed)/.test(ruleBody('.status') + ruleBody('.cols')));
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

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
