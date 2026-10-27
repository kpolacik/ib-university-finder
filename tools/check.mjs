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
const { safeUrl } = await import(new URL('../js/data.js', import.meta.url));

let failures = 0;
const section = (name) => console.log(`\n${name}`);
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const equal = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`);

// Loads the data layer against whatever CSV text you give it.
async function load(universities, programmes, today = new Date('2026-08-14')) {
  globalThis.fetch = async (url) => ({
    ok: true,
    text: async () => (String(url).includes('universities') ? universities : programmes),
  });
  // A fresh query string dodges the module cache between fixtures.
  const { loadData } = await import(new URL(`../js/data.js?t=${Math.random()}`, import.meta.url));
  return loadData(today);
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
  'programme_id,university_id,programme,admission,official_url,last_verified,verified_by',
  'a-inherit,a,Inherits,,https://example.org,2026-08-14,TT',
  'a-own,a,Own,Entrance exam · Can be waived,https://example.org,2026-08-14,TT',
  'a-unknown,a,Unknown,?,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: adm } = await load(uniA, progA);
const admOf = (id) => adm.find((p) => p.id === id).admission;
equal('blank admission inherits the university default', admOf('a-inherit'), ['Places go by points']);
equal('own admission wins and splits on the bullet', admOf('a-own'), ['Entrance exam', 'Can be waived']);
equal('"?" admission does not inherit', admOf('a-unknown'), []);

// ------------------------------------------------------------- maths filter

section('ib_maths: accepted courses, "none", unknown, and the filter');
const progM = [
  'programme_id,university_id,programme,ib_maths,official_url,last_verified,verified_by',
  'm-aa,a,AA HL only,AA HL,https://example.org,2026-08-14,TT',
  'm-three,a,Three,AA HL · AA SL · AI HL,https://example.org,2026-08-14,TT',
  'm-none,a,No maths,none,https://example.org,2026-08-14,TT',
  'm-blank,a,Not checked,,https://example.org,2026-08-14,TT',
  'm-q,a,Unknown,?,https://example.org,2026-08-14,TT',
  'm-bad,a,Typo,AA Higher,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: mrows, meta: mmeta } = await load(uniA, progM);
const mOf = (id) => mrows.find((p) => p.id === id).mathsAccepted;
equal('a list splits on the bullet', mOf('m-three'), ['AA HL', 'AA SL', 'AI HL']);
equal('"none" accepts every course', mOf('m-none'), ['AA HL', 'AA SL', 'AI HL', 'AI SL']);
check('blank and "?" are unknown, never "none"', mOf('m-blank') === null && mOf('m-q') === null);
check('a misspelt course is reported and treated as unknown',
  mOf('m-bad') === null && mmeta.issues.some((i) => /AA Higher/.test(i)));
const { applyFilters, createFilterState } = await import(new URL('../js/filters.js', import.meta.url));
const mstate = createFilterState();
mstate.myMaths = 'AI SL';
equal('AI SL hides only what states it is not accepted',
  applyFilters(mrows, mstate, new Set()).map((p) => p.id), ['m-none', 'm-blank', 'm-q', 'm-bad']);
mstate.myMaths = 'AA HL';
check('AA HL keeps everything here', applyFilters(mrows, mstate, new Set()).length === mrows.length);

// ------------------------------------------------------------- exam filter

section('entrance_exam: yes, waivable, no, unknown, and the filter');
const progE = [
  'programme_id,university_id,programme,entrance_exam,official_url,last_verified,verified_by',
  'e-yes,a,Exam,yes,https://example.org,2026-08-14,TT',
  'e-waive,a,Waivable,waivable,https://example.org,2026-08-14,TT',
  'e-no,a,No exam,no,https://example.org,2026-08-14,TT',
  'e-blank,a,Not checked,,https://example.org,2026-08-14,TT',
  'e-q,a,Unknown,?,https://example.org,2026-08-14,TT',
  'e-bad,a,Typo,maybe,https://example.org,2026-08-14,TT',
].join('\n') + '\n';
const { programmes: erows, meta: emeta } = await load(uniA, progE);
const eOf = (id) => erows.find((p) => p.id === id).entranceExam;
check('the three states load as written', eOf('e-yes') === 'yes' && eOf('e-waive') === 'waivable' && eOf('e-no') === 'no');
check('blank and "?" are unknown, never "no"', eOf('e-blank') === null && eOf('e-q') === null);
check('an unexpected value is reported and treated as unknown',
  eOf('e-bad') === null && emeta.issues.some((i) => /"maybe"/.test(i)));
const estate = createFilterState();
estate.exam = 'none';
equal('"No exam" hides exams, waivable or not, and keeps unknowns',
  applyFilters(erows, estate, new Set()).map((p) => p.id), ['e-no', 'e-blank', 'e-q', 'e-bad']);
estate.exam = 'skippable';
equal('"No exam, or one I can skip" hides only compulsory exams',
  applyFilters(erows, estate, new Set()).map((p) => p.id), ['e-waive', 'e-no', 'e-blank', 'e-q', 'e-bad']);

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

// ---------------------------------------------------------------- export

section('Shortlist CSV export');
const { toCsv } = await import(new URL('../js/shortlist.js', import.meta.url));
const messy = sample.filter((p) => p.ibSubjects.includes(',')).slice(0, 3);
const grid = parseCsv(toCsv(messy));
check('every exported row has the same column count',
  grid.every((r) => r.length === grid[0].length), JSON.stringify(grid.map((r) => r.length)));
check('commas inside a field survive the round trip',
  messy.length > 0 && grid[1][grid[0].indexOf('Subject requirements')] === messy[0].ibSubjects);

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
console.log(`        ${live.length} programmes across ${new Set(live.map((p) => p.university)).size} universities`);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
