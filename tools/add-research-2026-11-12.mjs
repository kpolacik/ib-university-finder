// One-off: add the universities and programmes the 2026-11-12 research wave
// found missing from the site: 124 universities and 1,053 programmes in 11
// countries, and Slovakia (12 universities, 237 programmes) as a new country.
//
//   node tools/add-research-2026-11-12.mjs <proposals-dir>
//
// The research lives in /Users/leon/projects/ib-research-expansion/proposals
// (that folder's README.md says what each file is). It was built from
// official pages and the site's own rules, and every row is AI-DRAFT. Its
// evidence for every risky field (points, fee, deadline, entrance exam) is in
// proposals/evidence.jsonl: the URL, the place on the page, the quote and the
// academic year. The proposals' own `source_url` and `quote` columns are the
// last two columns of both CSVs; they are not site columns, so they are
// dropped here and the evidence file stays the record.
//
// This is a record of a one-off. Do not re-run it. It refuses to run twice (any
// id that already exists in data/ stops it), and it refuses a proposal folder
// that is not clean:
//   - missing-evidence.csv has a data row (a risky field with no quote), or
//   - problems.txt is not empty (the research build's own column checks), or
//   - a header differs from the site's header plus `source_url,quote`, or
//   - a row is signed by a person (only a person signs, so every row must be
//     AI-DRAFT), or an id repeats, or a programme names an unknown university.
//
// The rows are appended after the existing ones in the site's column order,
// written the way the files already are: LF line endings, a field quoted only
// when it holds a comma, a double quote or a newline, and one final newline.
// The existing bytes are left alone. Nothing is written until every check has
// passed. Afterwards run `node tools/make-snapshot.mjs` and `node tools/check.mjs`
// so data/fallback.json matches the CSVs, and commit the three files together.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const EXTRA = ['source_url', 'quote'];

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const readTable = (text) => {
  const [head, ...rows] = parseCsv(text);
  return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) };
};
const fail = (msg) => { console.error(`Refusing to run: ${msg}`); process.exit(1); };

const dirArg = process.argv[2];
if (!dirArg) fail('usage: node tools/add-research-2026-11-12.mjs <proposals-dir>');
const dir = resolve(dirArg);
const need = (name) => { const p = join(dir, name); if (!existsSync(p)) fail(`${p} is missing`); return p; };

// ------------------------------------------------------------ the folder

const missing = readTable(readFileSync(need('missing-evidence.csv'), 'utf8'));
if (missing.rows.length) fail(`missing-evidence.csv has ${missing.rows.length} row(s) with a risky field and no quote (first: ${missing.rows[0].id}, ${missing.rows[0].field}); get the evidence first`);
const problems = readFileSync(need('problems.txt'), 'utf8').trim();
if (problems) fail(`problems.txt is not empty:\n${problems.slice(0, 600)}`);

// ------------------------------------------------------------ the tables

const files = ['universities', 'programmes'].map((name) => {
  const siteText = readFileSync(new URL(`${name}.csv`, DATA), 'utf8');
  const site = readTable(siteText);
  const proposal = readTable(readFileSync(need(`${name}.csv`), 'utf8'));
  const expected = [...site.head, ...EXTRA];
  if (proposal.head.join() !== expected.join()) {
    fail(`${name}.csv header differs from the site's header plus ${EXTRA.join(',')}\n  proposal: ${proposal.head.join(',')}\n  expected: ${expected.join(',')}`);
  }
  return { name, siteText, site, proposal };
});
const [unis, progs] = files;
const idKey = { universities: 'university_id', programmes: 'programme_id' };

for (const f of files) {
  const key = idKey[f.name];
  const existing = new Set(f.site.rows.map((r) => r[key]));
  const seen = new Set();
  for (const r of f.proposal.rows) {
    const id = r[key];
    if (!id) fail(`a ${f.name} row has no ${key}`);
    if (existing.has(id)) fail(`${key} "${id}" is already in data/${f.name}.csv (was this run before?)`);
    if (seen.has(id)) fail(`${key} "${id}" appears twice in the proposal's ${f.name}.csv`);
    seen.add(id);
    if (r.verified_by !== 'AI-DRAFT') fail(`${f.name}.csv ${id} has verified_by "${r.verified_by}"; only a person may sign, so it must be AI-DRAFT`);
  }
}

const allUniIds = new Set([...unis.site.rows, ...unis.proposal.rows].map((r) => r.university_id));
for (const p of progs.proposal.rows) {
  if (!allUniIds.has(p.university_id)) fail(`programme ${p.programme_id} names the unknown university ${p.university_id}`);
}

// ------------------------------------------------------------ write

const line = (head, r) => head.map((h) => esc(r[h])).join(',');
for (const f of files) {
  const lines = f.proposal.rows.map((r) => line(f.site.head, r));
  const base = f.siteText.endsWith('\n') ? f.siteText : f.siteText + '\n';
  f.out = base + lines.join('\n') + '\n';
}
for (const f of files) writeFileSync(new URL(`${f.name}.csv`, DATA), f.out);

// ------------------------------------------------------------ report

const countryOf = new Map([...unis.site.rows, ...unis.proposal.rows].map((r) => [r.university_id, r.country]));
const tally = new Map();
const bump = (country, which) => { const t = tally.get(country) ?? { universities: 0, programmes: 0 }; t[which]++; tally.set(country, t); };
for (const u of unis.proposal.rows) bump(u.country, 'universities');
for (const p of progs.proposal.rows) bump(countryOf.get(p.university_id), 'programmes');
for (const [country, t] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${country}: ${t.universities} universities, ${t.programmes} programmes`);
}
console.log(`Total: ${unis.proposal.rows.length} universities, ${progs.proposal.rows.length} programmes`);
