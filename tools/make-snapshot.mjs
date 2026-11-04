// Rebuilds data/fallback.json — the copy the site shows when the Google Sheet
// cannot be reached.
//
//   node tools/make-snapshot.mjs
//
// Reads the published Sheet if config.js has URLs in it, otherwise the local
// CSVs. Run it whenever the Sheet has changed meaningfully, and commit the
// result. See MAINTENANCE.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { csvToObjects } = await import(new URL('../js/csv.js', import.meta.url));
const { SHEET_CSV_URLS, SAMPLE_CSV_URLS } = await import(new URL('../js/config.js', import.meta.url));

const live = Boolean(SHEET_CSV_URLS.universities && SHEET_CSV_URLS.programmes);
const sources = live ? SHEET_CSV_URLS : SAMPLE_CSV_URLS;

console.log(live ? 'Reading the published Google Sheet.' : 'No Sheet URLs in js/config.js — reading the local CSVs.');

const [universities, programmes] = await Promise.all([
  read(sources.universities),
  read(sources.programmes),
]);

async function read(source) {
  const text = live
    ? await fetchCsv(source)
    : readFileSync(join(root, source), 'utf8');

  // Same reader the site uses, so a malformed row is skipped and reported here
  // too. Rolling our own padded short rows into the snapshot silently — the
  // one path where nobody would ever be told.
  const { rows, issues } = csvToObjects(text, source);
  issues.forEach((issue) => console.log(`  ! ${issue}`));
  if (rows.length === 0) throw new Error(`${source} has no usable data rows.`);

  return rows.map(({ __row, ...rest }) => rest);
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

const anySample = programmes.some((row) => (row.verified_by || '').includes('SAMPLE'));

const snapshot = {
  meta: {
    generated_at: new Date().toISOString().slice(0, 10),
    // No is_sample flag: the site counts SAMPLE rows itself, so a stored flag
    // could only ever go stale and misreport.
    note: 'Offline copy shown only when the Google Sheet cannot be reached.',
  },
  universities,
  programmes,
  translations: csvToObjects(readFileSync(join(root, 'data/i18n/sk.csv'), 'utf8'), 'data/i18n/sk.csv').rows.map(({ __row, ...row }) => row),
};

writeFileSync(join(root, 'data/fallback.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`Wrote data/fallback.json — ${universities.length} universities, ${programmes.length} programmes.`);
if (anySample) console.log('WARNING: some rows are still marked SAMPLE.');
