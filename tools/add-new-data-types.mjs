// Re-runnable PR 2 import. Reads verified research only; never signs a row or
// changes last_verified. Run after merging main, then run make-snapshot.mjs.
// node tools/add-new-data-types.mjs [wave-directory] [media-directory] [rankings-directory]
// --dry-run validates and reports without writing CSVs or the translation todo.
// --no-todo leaves the external translation todo untouched.
// --self-test exercises the conversion and refusal rules without reading inputs.
//
// ECB reference date: 2026-11-12; 1 EUR = GBP 0.83595, CZK 24.379,
// SEK 11.0628, DKK 7.4754, NOK 10.563. Round to whole euros.
// https://data-api.ecb.europa.eu/service/data/EXR/D.GBP+CZK+SEK+DKK+NOK.EUR.SP00.A?startPeriod=2026-11-12&endPeriod=2026-11-12&format=csvdata
// QS World University Rankings 2027:
// https://www.topuniversities.com/rankings/endpoint?nid=4153156&page=0&items_per_page=2000&tab=indicators
// THE World University Rankings 2027:
// https://www.timeshighereducation.com/json/ranking_tables/world_university_rankings/2027
// Evidence remains in the research repository. Its verified proposals already
// passed the quote checker and human/model research review; this script enforces
// the import's format, provenance, signature, year and cross-cell rules again.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parseCsv } from '../js/csv.js';

const ECB_DATE = '2026-11-12';
const RATES = { EUR: 1, GBP: 0.83595, CZK: 24.379, SEK: 11.0628, DKK: 7.4754, NOK: 10.563 };
const NEW = {
  universities: 'qs_rank,the_rank,rankings_year,image_file,image_author,image_licence,image_licence_url,image_source_url,apply_url_default,app_fee_default,app_fee_note_default,intake_months_default,ib_recognition_default,ib_offer_default'.split(','),
  programmes: 'apply_url,apply_code,app_fee,app_fee_note,places,places_kind,places_year,intake_months,ib_recognition,ib_offer'.split(','),
};
const GAP_COLUMNS = new Set(['degree_type', 'english_requirement_default', 'ib_subjects', 'entrance_exam']);
const CORRECTIONS = new Set(['admission', 'application_deadline', 'deadline_notes', 'tuition_eu', 'english_requirement']);
const UNKNOWN = new Set(['app_fee', 'places', 'intake_months', 'ib_recognition', 'ib_offer']);
const FREE_TEXT = ['ib_recognition', 'ib_recognition_default', 'app_fee_note', 'app_fee_note_default'];
const UNICATT_OLD = 'Full IB Diploma only (at least 12 years of schooling; IB certificates and the Career-related Programme are not accepted). Final scores go from IBO to Cattolica by the May 2027 session, which replaces legalisation, Dichiarazione di Valore or CIMEA statements; November retakes are not accepted.';
const UNICATT_NEW = UNICATT_OLD.replace('Final scores go from IBO to Cattolica by the May 2027 session', 'Final scores from the May 2027 session are sent directly from IBO to Cattolica when released in July 2027');
const recognition = (id, field, value) => id === 'unicatt' && field === 'ib_recognition_default' && value === UNICATT_OLD ? UNICATT_NEW : value;
const writeTodo = (args) => !args.includes('--no-todo');
const RANK = /^(?:=?\d+|\d+–\d+|\d+\+)$/;
const validRank = value => RANK.test(value) && value.match(/\d+/g).every(n => Number(n) > 0);
const COMPARISON = /(?:^|\.)(?:studyportals\.com|bachelorsportal\.com|mastersportal\.com|educations\.com|topuniversities\.com|timeshighereducation\.com|wikipedia\.org|unipage\.net)$/i;
const safe = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };
const official = (s) => safe(s) && !COMPARISON.test(new URL(s).hostname);
const fee = (value) => {
  const m = /^(\d+(?:\.\d{1,2})?) (EUR|GBP|CZK|SEK|DKK|NOK)$/.exec(value);
  return m ? { amount: +m[1], original: m[1], currency: m[2], euros: String(Math.round(+m[1] / RATES[m[2]])) } : null;
};
const conversion = (f) => `${f.original} ${f.currency} at the ECB reference rate of ${ECB_DATE} (1 EUR = ${RATES[f.currency]} ${f.currency}), rounded to ${f.euros} EUR. `;
const rank = (s) => /^(?:none|Reporter)?$/i.test(s.trim()) ? '' : s.trim().replace(/-/g, '–');
const yearReason = (p) => {
  if (['undated', '2027/28'].includes(p.year_label)) return '';
  if (/^places(?:_kind|_year)?$/.test(p.column) && /^\d{4}\/\d{2}$/.test(p.year_label)) return '';
  if (/^app_fee(?:_default|_note|_note_default)?$/.test(p.column) && p.year_label === '2026/27') return '';
  return 'year has no permitted label field';
};
const esc = (v) => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
const csv = (head, rows) => [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
const read = (p) => {
  const [head, ...cells] = parseCsv(readFileSync(p, 'utf8'));
  assert(head?.length, `Empty CSV: ${p}`);
  assert.equal(new Set(head).size, head.length, `Duplicate header: ${p}`);
  const rows = cells.map((r, i) => {
    assert.equal(r.length, head.length, `${p} row ${i + 2}: cell count`);
    return Object.fromEntries(head.map((h, j) => [h, r[j]]));
  });
  return { head, rows };
};

// Explicit house-style mapping: shorten awards, not programme titles. Specialist
// awards without a confident equivalent remain verbatim and appear in the report.
const DEGREES = {
  'Bachelor of Arts': 'BA', 'Bachelor of Science': 'BSc',
  'Bachelor of Science (Honours)': 'BSc (Hons)', 'Bachelor of Arts (Honours)': 'BA (Hons)',
  'Bachelor of Commerce': 'BComm', 'Bachelor of Engineering': 'BEng',
  'Bachelor of Laws': 'LLB', 'Bachelor of Fine Arts': 'BFA', 'Bachelor of Education': 'BEd',
  'Bachelor of Social Science': 'BSocSc', 'Bachelor of Medical Science': 'BMedSci',
  'Bachelor of Business Administration': 'BBA', 'Bachelor’s Degree in Business Administration': 'BBA',
  'Bachelor of International Business Administration': 'BBA',
  'Bachelor of Business Studies': 'BBS', 'Bachelor in Business Studies': 'BBS',
  'Bachelor of Science in Business and Economics': 'BSc',
  'Bachelor’s Degree': 'Bachelor', 'Bachelor’s degree': 'Bachelor',
  'Degree of Bachelor': 'Bachelor', "bachelor's degree": 'Bachelor',
  'Bachelor of Music': 'BMus', 'Bachelor of Philosophy': 'BPhil',
  'BSC': 'BSc', 'Bsc': 'BSc', 'BSc.': 'BSc', 'B.Sc.': 'BSc',
  'B.A.': 'BA', 'B. A.': 'BA', 'B ED': 'BEd', 'B. ED': 'BEd',
  'Bsc (Education)': 'BSc (Education)', 'BA/BSc': 'BA / BSc',
};
const degree = (v) => DEGREES[v] || Object.entries(DEGREES).find(([key]) => key.toLowerCase() === v.toLowerCase())?.[1] || v;
// Browser research replaces only scripted country defaults. Independent
// programme/university research conflicts remain for the owner to inspect.
function mergeBrowser(proposals, browser, conflicts) {
  const cells = new Map(proposals.map((p) => [`${p.id}\0${p.column}`, p]));
  for (const p of browser) {
    const key = `${p.id}\0${p.column}`;
    const previous = cells.get(key);
    if (!previous || previous.slice === 'system') cells.set(key, p);
    else conflicts.push({ id: p.id, column: p.column, kept: previous.value, browser: p.value });
  }
  return [...cells.values()];
}
function selfTest() {
  assert(writeTodo([])); assert(!writeTodo(['--no-todo']));
  assert.equal(recognition('unicatt', 'ib_recognition_default', UNICATT_OLD), UNICATT_NEW);
  assert.equal(recognition('unicatt', 'ib_recognition_default', UNICATT_NEW), UNICATT_NEW);
  assert.equal(recognition('other', 'ib_recognition_default', UNICATT_OLD), UNICATT_OLD);
  assert.equal(recognition('unicatt', 'ib_recognition', UNICATT_OLD), UNICATT_OLD);
  assert.equal(recognition('unicatt', 'ib_recognition_default', UNICATT_OLD + ' '), UNICATT_OLD + ' ');
  assert.equal(fee('34.50 GBP').euros, '41');
  assert.equal(fee('1050 CZK').euros, '43');
  assert.equal(fee('0 EUR').euros, '0');
  assert.equal(fee('41'), null); assert.equal(fee('-1 EUR'), null);
  assert.match(conversion(fee('1050 CZK')), /1050 CZK.*2026-11-12.*43 EUR/);
  assert.equal(yearReason({ column: 'ib_offer', year_label: '2026/27' }), 'year has no permitted label field');
  assert.equal(yearReason({ column: 'app_fee', year_label: '2026/27' }), '');
  assert.equal(yearReason({ column: 'places', year_label: '2025/26' }), '');
  for (const value of ['0', '=0', '0+', '0–10', '10–0']) assert(!validRank(value), `Invalid zero rank: ${value}`);
  for (const value of ['1', '=218', '201–250', '1201+']) assert(validRank(value), `Valid positive rank: ${value}`);
  assert.equal(rank('1001-1200'), '1001–1200'); assert.equal(rank('Reporter'), '');
  assert.equal(degree('Bachelor of Science (Honours)'), 'BSc (Hons)');
  assert.equal(degree('B.Sc. (Cur.)'), 'B.Sc. (Cur.)');
  assert(!official('https://www.bachelorsportal.com/apply')); assert(!safe('javascript:alert(1)'));
  assert.equal(csv(['a'], [{ a: 'a,"b"' }]), 'a\n"a,""b"""\n');
  const conflict = [];
  const merged = mergeBrowser([
    { id: 'a', column: 'ib_recognition_default', value: 'country', slice: 'system' },
    { id: 'b', column: 'app_fee', value: '20 EUR', slice: 'R1' },
  ], [
    { id: 'a', column: 'ib_recognition_default', value: 'university' },
    { id: 'b', column: 'app_fee', value: '30 EUR' },
    { id: 'c', column: 'app_fee', value: '40 EUR' },
  ], conflict);
  assert.deepEqual(merged.map((p) => p.value), ['university', '20 EUR', '40 EUR']);
  assert.equal(conflict.length, 1);
  console.log('Import self-tests passed.');
}
if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }
const args = process.argv.slice(2).filter((a) => a !== '--dry-run' && a !== '--no-todo');
const dry = process.argv.includes('--dry-run');
const root = fileURLToPath(new URL('../', import.meta.url));
const wave = resolve(args[0] || '/Users/leon/projects/ib-research-expansion/pr2/wave');
const media = resolve(args[1] || '/Users/leon/projects/ib-research-media');
const rankings = resolve(args[2] || '/Users/leon/projects/ib-research-expansion/rankings/extract');
const sheets = Object.fromEntries(['universities', 'programmes'].map((name) => [name, read(join(root, 'data', `${name}.csv`))]));
const indexes = Object.fromEntries(Object.entries(sheets).map(([name, s]) => [name, new Map(s.rows.map((r) => [r[name === 'universities' ? 'university_id' : 'programme_id'], r]))]));
const before = structuredClone(sheets);
for (const [name, s] of Object.entries(sheets)) for (const c of NEW[name]) {
  if (!s.head.includes(c)) s.head.push(c);
  for (const r of s.rows) if (r[c] == null) r[c] = '';
}
const report = { proposals: { applied: 0, unchanged: 0, refused: [] }, replacements: [], gapfill: { applied: 0, unchanged: 0, dropped: [], unnormalised: [] }, testFees: { present: false, applied: 0 }, photos: { included: [], omitted: [] }, rankings: { ranked: [], held: [], checkedAbsent: [] }, translations: {}, coverage: {} };
const refuse = (p, reason, group = 'proposals') => report[group][group === 'gapfill' ? 'dropped' : 'refused'].push({ id: p.id, column: p.column, value: p.value, reason, file: p.file });
const target = (p) => indexes.universities.get(p.id) || indexes.programmes.get(p.id);
const signed = (p, group) => {
  const row = target(p);
  if (!row) { refuse(p, 'unknown id', group); return true; }
  if (row.verified_by !== 'AI-DRAFT') { refuse(p, 'row is not AI-DRAFT', group); return true; }
  // A signed programme also covers inherited university data.
  if (indexes.universities.has(p.id) && sheets.programmes.rows.some((r) => r.university_id === p.id && r.verified_by !== 'AI-DRAFT')) {
    refuse(p, 'university has a signed programme', group); return true;
  }
  return false;
};
const verified = read(join(wave, 'proposals_verified.csv')).rows;
assert.equal(new Set(verified.map((p) => `${p.id}\0${p.column}`)).size, verified.length, 'Duplicate verified proposal');
const browserFile = join(wave, 'browser/browser_verified.csv');
report.browser = { present: existsSync(browserFile), lines: 0, conflicts: [] };
const browser = report.browser.present ? read(browserFile).rows : [];
report.browser.lines = browser.length;
const proposals = mergeBrowser(verified, browser, report.browser.conflicts);
const byCell = new Map();
for (const p of proposals) {
  const key = `${p.id}\0${p.column}`;
  assert(!byCell.has(key), `Duplicate proposal: ${p.id} ${p.column}`);
  byCell.set(key, p);
}
const testFile = join(wave, 'test_fees.csv');
const tests = existsSync(testFile) ? read(testFile).rows : [];
report.testFees.present = existsSync(testFile);
const testIds = new Set(tests.map((t) => t.id));
for (const p of proposals) {
  if (signed(p)) continue;
  const row = target(p);
  const name = indexes.universities.has(p.id) ? 'universities' : 'programmes';
  let reason = '';
  let value = p.column === 'degree_type' ? degree(p.value) : recognition(p.id, p.column, p.value);
  const fillOnly = GAP_COLUMNS.has(p.column);
  if (!NEW[name].includes(p.column) && !(name === 'programmes' && CORRECTIONS.has(p.column)) && !fillOnly) reason = 'column outside approved proposals';
  else if (!official(p.source_url) || !p.quote.trim()) reason = 'missing official source or quote';
  else if (yearReason(p)) reason = yearReason(p);
  else if (value === '?' && !UNKNOWN.has(p.column)) reason = 'unknown marker is not allowed';
  else if (/^(?:app_fee(?:_default)?|tuition_eu)$/.test(p.column) && value !== '?') {
    const f = fee(value);
    const note = byCell.get(`${p.id}\0${p.column === 'app_fee_default' ? 'app_fee_note_default' : 'app_fee_note'}`)?.value || '';
    if (!f) reason = 'fee missing original amount or supported currency';
    else if (testIds.has(p.id) && p.column.startsWith('app_fee') && tests.some((t) => t.id === p.id && +t.amount === f.amount && t.currency === f.currency)) reason = 'admission-test fee is not an application fee';
    else if (f.amount === 0 && !note) reason = 'zero fee needs a sourced explanatory note';
    else if (p.year_label === '2026/27' && !/2026\/27 figure/.test(note)) reason = 'old fee needs 2026/27 figure in its note';
    else value = f.euros;
  } else if (/^apply_url/.test(p.column) && !official(value)) reason = 'unsafe or comparison apply URL';
  else if (p.column === 'apply_code' && !/^(UCAS|CAO|SE):\S+$/.test(value)) reason = 'invalid apply code';
  else if (/^ib_offer/.test(p.column) && !['predicted', 'final', '?'].includes(value)) reason = 'invalid offer vocabulary';
  else if (/^intake_months/.test(p.column) && value !== '?' && !/^(?:[1-9]|1[0-2])(?: · (?:[1-9]|1[0-2]))*$/.test(value)) reason = 'invalid intake months';
  else if (p.column === 'places' && value !== '?' && !/^[1-9]\d*$/.test(value)) reason = 'invalid places count';
  else if (p.column === 'places_kind' && !['capacity', 'eu_quota', 'past_intake', 'open'].includes(value)) reason = 'invalid places kind';
  else if (p.column === 'places_year' && !/^\d{4}(?:\/\d{2})?$/.test(value)) reason = 'invalid places year';
  if (!reason && p.column === 'places_kind' && value === 'open') {
    // Verified programme/faculty pages only. A national assertion cannot prove
    // that a particular programme has no limit.
    const host = new URL(p.source_url).hostname;
    const programmePage = /\/(?:course|courses|programme|programmes|corso)\//.test(new URL(p.source_url).pathname) || /univie\.ac\.at$/.test(host) && /\/[^/]+(?:-programme|data-science)\/?$/.test(new URL(p.source_url).pathname);
    if (!programmePage || !/zulassungsfrei|no (?:fixed )?(?:upper )?limit|open admission|accesso libero|open access|unlimited|non-restricted|without.*entrance/i.test(p.quote)) reason = 'open places lack programme-specific no-limit evidence';
    else if (byCell.has(`${p.id}\0places`)) reason = 'open places must have no number';
  }
  if (!reason && fillOnly && row[p.column] && row[p.column] !== value && !(p.column === 'entrance_exam' && row[p.column] === '?')) reason = 'current cell is not blank';
  if (reason) { refuse(p, reason); continue; }
  if (row[p.column] === value) report.proposals.unchanged++;
  else {
    if (CORRECTIONS.has(p.column)) report.replacements.push({ id: p.id, column: p.column, old: row[p.column], new: value });
    row[p.column] = value;
    report.proposals.applied++;
  }
}
// Build notes from the source text on each run, then add conversion/test prefixes
// once. This avoids duplicated notes on a second run or after an upstream merge.
for (const p of proposals.filter((p) => /^(?:app_fee(?:_default)?|tuition_eu)$/.test(p.column))) {
  if (report.proposals.refused.some((r) => r.id === p.id && r.column === p.column)) continue;
  const f = fee(p.value);
  if (!f || f.currency === 'EUR') continue;
  const row = target(p);
  const column = p.column === 'tuition_eu' ? 'deadline_notes' : p.column === 'app_fee_default' ? 'app_fee_note_default' : 'app_fee_note';
  const prefix = (p.column === 'tuition_eu' ? 'Tuition: ' : '') + conversion(f);
  if (!row[column].startsWith(prefix)) row[column] = prefix + row[column];
}
for (const t of tests) {
  const column = t.scope === 'university' ? 'app_fee_note_default' : 'app_fee_note';
  const p = { id: t.id, column, value: `${t.amount} ${t.currency}` };
  if (signed(p)) continue;
  assert(official(t.source_url) && t.quote.trim() && fee(p.value), `Invalid test fee: ${t.id}`);
  const year = t.year_label.replace(/^(\d{4})\/(\d{2})(\d{2})$/, '$1/$3');
  assert(['undated', '2027/28', '2026/27'].includes(year), `Unsupported test fee year: ${t.id}`);
  const label = t.test_name ? ` (${t.test_name})` : '';
  const sentence = `Admission test${label}: ${t.amount} ${t.currency}${year === 'undated' ? '' : ` (${year} figure)`}. `;
  const row = target(p);
  if (!row[column].includes(sentence.trim())) { row[column] = sentence + row[column]; report.testFees.applied++; }
}

const files = [...Array.from({ length: 17 }, (_, i) => `DT${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 6 }, (_, i) => `RT${String(i + 1).padStart(2, '0')}`), 'EN01', 'EN01b', 'EN02', 'EN03', 'EN04', 'EN04b', 'EN05', 'TS01', 'EX01'];
const sample = read(join(wave, 'gapfill/verify/degree_sample_verdicts.csv')).rows;
const unnormalised = new Set();
const knownDegrees = new Set(before.programmes.rows.map((r) => r.degree_type));
for (const file of files) {
  const path = join(wave, 'gapfill/verify', `${file}.csv`);
  const verdicts = [...(existsSync(path) ? read(path).rows : []), ...sample.filter((r) => r.file === `${file}.csv`)];
  for (const p of read(join(wave, 'gapfill/out', `${file}.csv`)).rows) {
    p.file = file;
    if (signed(p, 'gapfill')) continue;
    const row = target(p);
    const bad = verdicts.filter((v) => v.id === p.id && v.column === p.column && (!v.value || v.value === p.value) && v.verdict !== 'ok');
    const exception = (v) => {
      if (p.id === 'vse-en-business-information-systems-and-comp' && p.column === 'entrance_exam') return true;
      if (p.column !== 'degree_type') return false;
      if (file === 'DT04' && v.verdict === 'wrong' && /short form/.test(v.reason)) return true;
      return v.verdict === 'unsure' && /heading|breadcrumb|title/.test(v.reason) && !/truncates|both|variants|alongside|FAQ|contact heading/.test(v.reason);
    };
    if (bad.some((v) => !exception(v))) { refuse(p, `verification ${bad.find((v) => !exception(v)).verdict}: ${bad.find((v) => !exception(v)).reason}`, 'gapfill'); continue; }
    if (file === 'EN04b' && p.id === 'um-uss') { refuse(p, 'EN03 takes precedence', 'gapfill'); continue; }
    assert(['degree_type', 'english_requirement', 'english_requirement_default', 'ib_subjects', 'entrance_exam'].includes(p.column), `Unexpected gap-fill column: ${p.column}`);
    let value = p.column === 'degree_type' ? degree(p.value) : p.value;
    // DT04's verifier gives the actual displayed short award, including Hons
    // where applicable. These 37 format-only verdicts were explicitly accepted.
    const short = file === 'DT04' && bad.find((v) => /The page uses (.+?) for this bachelor/.test(v.reason));
    if (short) value = /The page uses (.+?) for this bachelor/.exec(short.reason)[1];
    if (row[p.column] && !(p.column === 'entrance_exam' && row[p.column] === '?')) {
      if (row[p.column] === value) report.gapfill.unchanged++;
      else refuse(p, 'current cell is not blank', 'gapfill');
      continue;
    }
    row[p.column] = value;
    report.gapfill.applied++;
    if (p.column === 'degree_type' && value === p.value && !knownDegrees.has(value) && !unnormalised.has(value)) {
      unnormalised.add(value); report.gapfill.unnormalised.push(value);
    }
  }
}

const picks = read(join(media, 'picks.csv')).rows;
for (const p of picks) {
  const row = indexes.universities.get(p.id);
  assert(row, `Unknown photo id: ${p.id}`);
  if (signed({ id: p.id, column: 'image_file' })) continue;
  for (const c of NEW.universities.filter((c) => c.startsWith('image_'))) row[c] = '';
  const path = `img/universities/${p.id}.jpg`;
  if (!['ok', 'replace'].includes(p.verdict) || !existsSync(join(root, path))) {
    report.photos.omitted.push({ id: p.id, reason: !['ok', 'replace'].includes(p.verdict) ? `verdict ${p.verdict}` : 'no prepared image (see photo preparation report)' }); continue;
  }
  assert(safe(p.commons_page), `Missing image source: ${p.id}`);
  assert(!/NC|ND|GFDL/i.test(p.licence), `Unsupported image licence: ${p.id}`);
  assert(!/CC BY/.test(p.licence) || p.credit.trim(), `Missing author: ${p.id}`);
  assert(!/@|\bmail\b/i.test(p.credit), `Unclean credit: ${p.id}`);
  // Public-domain picks sometimes have no standalone licence URL. The file's
  // Licensing section is the source of its public-domain declaration.
  const licenceUrl = p.licence_url || (/public domain/i.test(p.licence) ? `${p.commons_page}#Licensing` : '');
  assert(safe(licenceUrl), `Missing licence URL: ${p.id}`);
  Object.assign(row, { image_file: path, image_author: p.credit, image_licence: p.licence, image_licence_url: licenceUrl, image_source_url: p.commons_page });
  report.photos.included.push(p.id);
}
const rankFile = existsSync(join(rankings, 'matches.clean.csv')) ? 'matches.clean.csv' : 'matches.csv';
report.rankings.file = rankFile;
for (const r of read(join(rankings, rankFile)).rows) {
  const p = { id: r.university_id, column: 'rankings_year' };
  if (signed(p)) continue;
  const row = target(p);
  let qs = rank(r.qs_rank_display), the = rank(r.the_rank_display);
  // Apply the old decisions only to the uncleaned fallback. The owner-reviewed
  // clean file supersedes them, including explicit one-sided absences.
  if (rankFile !== 'matches.clean.csv') {
  if (['itu', 'mci', 'modul-vienna', 'bocconi', 'cbs', 'sse', 'luiss'].includes(p.id)) qs = the = '';
  if (['utrecht', 'leipzig'].includes(p.id)) the = '';
  if (p.id === 'fau') qs = '=218';
  }
  const hold = Boolean(r.needs_leon?.trim()) || rankFile !== 'matches.clean.csv' && (Object.values(r).some((v) => /\bCHECK\b/.test(v)) || Boolean(qs) !== Boolean(the));
  Object.assign(row, { qs_rank: '', the_rank: '', rankings_year: '' });
  if (hold) { report.rankings.held.push(p.id); continue; }
  assert((!qs || validRank(qs)) && (!the || validRank(the)), `Invalid rank: ${p.id}`);
  Object.assign(row, { qs_rank: qs, the_rank: the, rankings_year: '2027' });
  report.rankings[qs || the ? 'ranked' : 'checkedAbsent'].push(p.id);
}

// Cross-cell checks run before any writes, including on a second run.
for (const [name, sheet] of Object.entries(sheets)) for (const r of sheet.rows) {
  assert.equal(r.last_verified, before[name].rows.find((b) => (b.programme_id || b.university_id) === (r.programme_id || r.university_id)).last_verified);
  for (const c of ['app_fee', 'app_fee_default']) if (r[c] === '0') assert(r[c === 'app_fee' ? 'app_fee_note' : 'app_fee_note_default'], `Zero fee without note: ${r.programme_id || r.university_id}`);
  if (r.places_kind === 'open') assert(!r.places, `Open with number: ${r.programme_id}`);
  else if (r.places && r.places !== '?') assert(['capacity', 'eu_quota', 'past_intake'].includes(r.places_kind), `Places without kind: ${r.programme_id}`);
}
// Stop before writing if any one refusal rule loses over 50 lines of a column.
for (const group of ['proposals', 'gapfill']) {
  const counts = new Map();
  for (const r of report[group][group === 'gapfill' ? 'dropped' : 'refused']) {
    const key = `${r.column}: ${r.reason}`; counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) assert(count <= 50, `STOP: ${count} ${group} lines refused by ${key}; owner decision required`);
}
const sk = read(join(root, 'data/i18n/sk.csv'));
const strings = new Map();
for (const s of Object.values(sheets)) for (const r of s.rows) for (const field of FREE_TEXT) {
  const english = r[field];
  if (!english || english === '?') continue;
  const key = `${field}\0${english}`;
  if (!strings.has(key)) strings.set(key, { field, english, count: 0 });
  strings.get(key).count++;
}
const todo = [...strings.values()].sort((a, b) => a.field.localeCompare(b.field) || a.english.localeCompare(b.english));
for (const field of FREE_TEXT) report.translations[field] = todo.filter((r) => r.field === field).length;
const translationsFile = join(wave, 'sk/translations.csv');
report.translations.present = existsSync(translationsFile);
report.translations.applied = 0;
if (existsSync(translationsFile)) for (const t of read(translationsFile).rows) {
  t.english = recognition('unicatt', t.field, t.english);
  if (!strings.has(`${t.field}\0${t.english}`) || !t.slovak.trim()) continue;
  const existing = sk.rows.find((r) => r.field === t.field && r.en === t.english);
  if (existing && existing.verified_by !== 'AI-DRAFT') continue;
  if (existing) existing.sk = t.slovak;
  else sk.rows.push({ field: t.field, en: t.english, sk: t.slovak, verified_by: 'AI-DRAFT' });
  report.translations.applied++;
}
for (const [name, sheet] of Object.entries(sheets)) {
  report.coverage[name] = {};
  const countries = [...new Set(sheets.universities.rows.map((r) => r.country))].sort();
  for (const c of NEW[name]) {
    report.coverage[name][c] = {};
    for (const country of countries) {
      const rows = sheet.rows.filter((r) => (name === 'universities' ? r.country : indexes.universities.get(r.university_id).country) === country);
      const filled = rows.filter((r) => r[c]).length;
      report.coverage[name][c][country] = `${filled}/${rows.length} (${(100 * filled / rows.length).toFixed(1)}% filled; ${(100 * (rows.length - filled) / rows.length).toFixed(1)}% blank)`;
    }
  }
}
if (!dry) {
  for (const [name, sheet] of Object.entries(sheets)) writeFileSync(join(root, 'data', `${name}.csv`), csv(sheet.head, sheet.rows));
  if (writeTodo(process.argv)) {
    mkdirSync(join(wave, 'sk'), { recursive: true });
    writeFileSync(join(wave, 'sk/todo.csv'), csv(['field', 'english', 'count'], todo));
  }
  if (existsSync(translationsFile)) writeFileSync(join(root, 'data/i18n/sk.csv'), csv(sk.head, sk.rows));
}
console.log(JSON.stringify(report, null, 2));
if (!report.browser.present) console.log('browser_verified.csv absent: continuing with proposals_verified.csv only.');
if (!report.testFees.present) console.log('test_fees.csv absent: continuing without admission-test fee notes.');
if (!report.translations.present) console.log('translations.csv absent: data/i18n/sk.csv left untouched.');
console.log(dry ? 'Dry run: no files written.' : `Wrote the data CSVs${process.argv.includes('--no-todo') ? '' : ' and sk/todo.csv'}. Run node tools/make-snapshot.mjs next.`);
