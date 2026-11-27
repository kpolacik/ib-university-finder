// Adds keep-reviewed Layer 2A translations to the search-English list in
// js/i18n.js (SEARCH_ENGLISH_KEYS), so their English stays searchable beside
// the Slovak (issue #18; Leon chose "incremental" on 2026-11-27).
//
// Why a separate list: by default a translated cell is searched only in
// Slovak, which drops English words students type ("diploma", "secondary").
// Leon wanted the English kept only for the newly reviewed translations, not
// for the older ones or other fields, so the page needs to know exactly which
// (field, English) pairs those are. Neither CSV row order nor verified_by
// tells it, so this list is written from the review file itself.
//
//   node tools/sk-search-english.mjs --review review.csv [--data DIR] [--js FILE]
//       dry run, writes nothing
//   node tools/sk-search-english.mjs --apply --review review.csv [--data DIR] [--js FILE]
//       rewrites only the SEARCH_ENGLISH block of FILE (default js/i18n.js)
//
// --first-new-row N is for test fixtures only: the default refuses the 1,082
// sk.csv rows that existed before Layer 2A (SK_ROWS_BEFORE_LAYER2A).
//
// review.csv is the same file tools/apply-sk-translations.mjs used: exact
// header field,en,sk,verdict. A row is added only when its verdict is keep,
// its field is living_cost_source or baseline_requirement, and data/i18n/sk.csv
// already has exactly that Slovak text for it. Run it after the --apply of
// apply-sk-translations.mjs, then node tools/check.mjs. The list only grows:
// existing entries stay, and every entry is checked again before writing.
//
// Exit codes: 0 clean, 2 at least one review row refused (nothing written),
// 1 bad arguments, unreadable or malformed files, or a failed write.
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { csvToObjects, parseCsv } from '../js/csv.js';
import { normaliseEnglish } from '../js/i18n.js';
import {
  SK_ROWS_BEFORE_LAYER2A, WHOLE_CELL_DATA_FIELDS, heldDisplayKeys, liveDisplayKeys, searchEnglishProblems, wholeCellLeaves,
} from './apply-sk-translations.mjs';

const BLOCK = /(\/\/ BEGIN SEARCH_ENGLISH[^\n]*\n)export const SEARCH_ENGLISH_VERSION = (\d+);\nexport const SEARCH_ENGLISH_KEYS = \[\n([\s\S]*?)\];\n(\/\/ END SEARCH_ENGLISH\n)/;
const pairKey = (field, en) => `${field}\u0000${en}`;

// Reads the block back as data, never by evaluating the file.
export function readSearchEnglishBlock(jsText) {
  const m = jsText.match(BLOCK);
  if (!m) throw new Error('SEARCH_ENGLISH block not found or not in the written format');
  const entries = m[3].split('\n').filter(Boolean).map((line) => {
    const t = line.trim().replace(/,$/, '');
    const entry = JSON.parse(t);
    if (`  ${JSON.stringify(entry)},` !== line) throw new Error(`SEARCH_ENGLISH line not in the written format: ${line}`);
    return entry;
  });
  return { version: Number(m[2]), entries };
}

export function writeSearchEnglishBlock(jsText, version, entries) {
  const body = entries.map((e) => `  ${JSON.stringify(e)},\n`).join('');
  return jsText.replace(BLOCK, (_, begin, _v, _b, end) =>
    `${begin}export const SEARCH_ENGLISH_VERSION = ${version};\nexport const SEARCH_ENGLISH_KEYS = [\n${body}];\n${end}`);
}

export const sortEntries = (entries) => [...entries].sort((a, b) => {
  const ka = pairKey(a[0], a[1]), kb = pairKey(b[0], b[1]);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});

function main(argv) {
  const fail = (message) => { console.error(message); process.exit(1); };
  const usage = () => fail('Usage: node tools/sk-search-english.mjs [--apply] --review review.csv [--data DIR] [--js FILE] [--first-new-row N]');
  const root = fileURLToPath(new URL('../', import.meta.url));
  let apply = false, dataDir = join(root, 'data'), jsFile = join(root, 'js/i18n.js'), reviewFile = '', firstNewRow = SK_ROWS_BEFORE_LAYER2A;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (['--data', '--js', '--review', '--first-new-row'].includes(a)) {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) usage();
      if (a === '--data') dataDir = resolve(v);
      else if (a === '--js') jsFile = resolve(v);
      else if (a === '--review') reviewFile = v;
      else if (/^\d+$/.test(v)) firstNewRow = Number(v);
      else usage();
    } else usage();
  }
  if (!reviewFile) usage();
  const readUtf8 = (path) => { try { return readFileSync(path, 'utf8'); } catch (e) { fail(`Cannot read ${path}: ${e.message}`); } };

  const jsText = readUtf8(jsFile);
  let current;
  try { current = readSearchEnglishBlock(jsText); } catch (e) { fail(`${jsFile}: ${e.message}`); }

  const skText = readUtf8(join(dataDir, 'i18n/sk.csv'));
  const { rows: skRows, issues } = csvToObjects(skText, 'sk.csv');
  if (issues.length) fail(`Invalid sk.csv: ${issues.join('; ')}`);
  let held;
  try {
    held = heldDisplayKeys({
      universitiesCsv: readUtf8(join(dataDir, 'universities.csv')),
      programmesCsv: readUtf8(join(dataDir, 'programmes.csv')),
    });
  } catch (e) { fail(e.message); }
  const ctx = {
    skRows, firstNewRow, heldKeys: held.heldKeys, liveKeys: liveDisplayKeys(held.programmes, held.heldCells), leaves: wholeCellLeaves(held.programmes),
  };
  const skByKey = new Map(skRows.map((r) => [pairKey(String(r.field).trim(), normaliseEnglish(r.en)), r.sk]));

  const grid = parseCsv(readUtf8(reviewFile));
  if (!grid.length || grid[0].join(',') !== 'field,en,sk,verdict') fail(`${reviewFile}: the header must be exactly field,en,sk,verdict`);
  const have = new Set(current.entries.map(([f, en]) => pairKey(f, en)));
  const additions = [];
  let refusals = 0, ignored = 0;
  for (const [i, cells] of grid.slice(1).entries()) {
    if (cells.length === 1 && cells[0] === '') continue;
    const where = `${reviewFile}:${i + 2}`;
    if (cells.length !== 4) { refusals++; console.log(`REFUSE ${where}: expected 4 columns, got ${cells.length}`); continue; }
    const [field, en, sk, verdict] = cells;
    if (verdict !== 'keep' || !WHOLE_CELL_DATA_FIELDS.includes(field)) { ignored++; continue; }
    const k = pairKey(field, en);
    if (skByKey.get(k) !== sk) { refusals++; console.log(`REFUSE ${where}: sk.csv has no row with exactly this Slovak for ${field} ${JSON.stringify(en)}`); continue; }
    if (normaliseEnglish(sk) === en) { ignored++; console.log(`IGNORE ${where}: Slovak equals the English, nothing to add`); continue; }
    if (have.has(k)) { console.log(`SKIP ${where}: already listed`); continue; }
    const problems = searchEnglishProblems([[field, en]], ctx);
    if (problems.length) { refusals++; console.log(`REFUSE ${where}: ${problems.join('; ')}`); continue; }
    have.add(k);
    additions.push([field, en]);
    console.log(`ADD ${field}: ${JSON.stringify(en)}`);
  }
  const next = sortEntries([...current.entries, ...additions]);
  const existingProblems = searchEnglishProblems(next, ctx);
  for (const p of existingProblems) { refusals++; console.log(`REFUSE list: ${p}`); }

  console.log(`\nListed now: ${current.entries.length} (version ${current.version})`);
  console.log(`To add: ${additions.length}`);
  console.log(`Ignored: ${ignored}`);
  console.log(`Refused: ${refusals}`);
  if (refusals) {
    console.log('Nothing written: fix the refused rows, then run again.');
    process.exitCode = 2;
    return;
  }
  if (!apply) { console.log('Dry run: nothing written. Add --apply to write.'); return; }
  if (!additions.length) { console.log('Nothing to add; nothing written.'); return; }

  const out = writeSearchEnglishBlock(jsText, current.version + 1, next);
  const mode = statSync(jsFile).mode & 0o777;
  const tmp = join(dirname(jsFile), `.search-english-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, out, { mode });
    renameSync(tmp, jsFile);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* not created */ }
    fail(`Atomic write failed for ${jsFile}: ${e.message}`);
  }
  console.log(`Wrote version ${current.version + 1} with ${next.length} entries to ${jsFile}. Run node tools/check.mjs next.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
