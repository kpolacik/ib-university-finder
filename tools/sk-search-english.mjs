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
// review.csv is the same file tools/apply-sk-translations.mjs used: exact
// header field,en,sk,verdict. A row is added only when its verdict is keep,
// its field is living_cost_source or baseline_requirement (Layer 2A) or
// english_requirement or english_requirement_default (Layer 2B-1, Leon's
// Option 2 on 2026-11-27), and data/i18n/sk.csv already has exactly that
// Slovak text for it in a new AI-DRAFT row. The original 1,082 rows must still
// match the base bytes; an English requirement row must also come after the
// 1,198 rows that were there before Layer 2B-1, which must match too. The list
// keeps the physical sk.csv name (english_requirement_default for inherited
// university wording); js/i18n.js maps it to english_requirement at runtime,
// so the two names of one English text may never both be listed or stored.
// Run it after the --apply of
// apply-sk-translations.mjs, then node tools/check.mjs. The list only grows:
// existing entries stay, and every entry is checked again before writing.
//
// Exit codes: 0 clean, 2 at least one review row refused (nothing written),
// 1 bad arguments, unreadable or malformed files, or a failed write.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normaliseEnglish, SEARCH_ENGLISH_FIELDS } from '../js/i18n.js';
import {
  heldDisplayKeys, heldPieceLabels, historicSlotProblem, liveDisplayKeys, readTranslationDictionary, readTranslationReviews,
  SINGLE_BULLET_FIELDS, translationTextProblem, twinField, wholeCellLeaves,
} from './apply-sk-translations.mjs';

const BLOCK = /(\/\/ BEGIN SEARCH_ENGLISH[^\n]*\n)export const SEARCH_ENGLISH_VERSION = (\d+);\nexport const SEARCH_ENGLISH_KEYS = \[\n([\s\S]*?)\];\n(\/\/ END SEARCH_ENGLISH\n)/;
const pairKey = (field, en) => `${field}\u0000${en}`;
const BASE_SK_ROWS = 1082;
export const BASE_SK_BYTES = 413339;
const BASE_SK_SHA256 = '77aa522e2a97253e3673591bd830ea0effb8de1e0f8cdd87e3485d4ebb4ca893';
// Layer 2B-1 base: sk.csv at ec30f31 (1,198 rows, the 116 Layer 2A rows
// included). English requirement entries need it, so a historic row can never
// become a new search member; Layer 2A entries keep needing only the 1,082 rows.
const L2B1_BASE_SK_ROWS = 1198;
export const L2B1_BASE_SK_BYTES = 458303;
export const L2B1_BASE_SK_SHA256 = '49c5a04acc024afa6f78167da7937f69dd8592e5efda20ac2c5feacad22ecf52';

export function readSearchEnglishDictionary(file, bytes, fail) {
  const dictionary = readTranslationDictionary(file, bytes.toString('utf8'), fail);
  // Use the exact base file at 2379d5d so edits, reordering, and duplicated
  // keys cannot turn historical translations into new search members.
  const sha = (n) => createHash('sha256').update(bytes.subarray(0, n)).digest('hex');
  if (sha(BASE_SK_BYTES) !== BASE_SK_SHA256) fail(`${file}: the original ${BASE_SK_ROWS} rows must match the unchanged 2379d5d byte prefix`);
  const keys = [...dictionary.keys()];
  return {
    dictionary,
    older: new Set(keys.slice(0, BASE_SK_ROWS)),
    hasL2B1Prefix: bytes.length >= L2B1_BASE_SK_BYTES && sha(L2B1_BASE_SK_BYTES) === L2B1_BASE_SK_SHA256,
    olderL2B1: new Set(keys.slice(0, L2B1_BASE_SK_ROWS)),
  };
}

// listed: pair keys already in the list or being added beside these entries.
export function searchEnglishProblems(entries, {
  dictionary, older, hasL2B1Prefix = false, olderL2B1 = new Set(), heldKeys, liveKeys, leaves, listed = new Set(),
}) {
  const problems = [];
  const seen = new Set();
  const entryKeys = new Set(entries.filter((e) => Array.isArray(e) && e.length === 2).map(([f, en]) => pairKey(f, en)));
  let prev = null;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || entry.some((v) => typeof v !== 'string')) {
      problems.push(`not a [field, en] pair: ${JSON.stringify(entry)}`);
      continue;
    }
    const [field, en] = entry;
    const label = `${field} ${JSON.stringify(en)}`;
    const k = pairKey(field, en);
    if (!SEARCH_ENGLISH_FIELDS.includes(field)) problems.push(`${label}: field is outside Layer 2A search`);
    if (!en || en !== normaliseEnglish(en) || en === '?' || en === 'none') problems.push(`${label}: English must be a normalised value`);
    if (seen.has(k)) problems.push(`${label}: listed twice`);
    if (prev !== null && !(prev < k)) problems.push(`${label}: not in sorted order`);
    seen.add(k); prev = k;
    const single = SINGLE_BULLET_FIELDS.includes(field);
    const row = dictionary.get(k);
    if (single && !hasL2B1Prefix) problems.push(`${label}: sk.csv must keep the unchanged ${L2B1_BASE_SK_ROWS}-row byte prefix from before Layer 2B-1`);
    if (!row) problems.push(`${label}: no sk.csv translation`);
    else if (older.has(k)) problems.push(`${label}: an older sk.csv row (before Layer 2A), which keeps its previous search`);
    else if (single && olderL2B1.has(k)) problems.push(`${label}: an older sk.csv row (before Layer 2B-1), which keeps its previous search`);
    else if (row.field !== field || row.en !== en || row.verifiedBy !== 'AI-DRAFT' || !row.sk.trim()) {
      problems.push(`${label}: sk.csv must have the exact field and English, non-empty Slovak, and AI-DRAFT signature`);
    } else if (normaliseEnglish(row.sk) === en) {
      problems.push(`${label}: Slovak equals the English, nothing to add`);
    } else {
      const textProblem = translationTextProblem(en, row.sk, field);
      if (textProblem) problems.push(`${label}: ${textProblem}`);
      const slotProblem = single ? historicSlotProblem(en, row.sk, (key) => (olderL2B1.has(key) ? dictionary.get(key) : undefined)) : '';
      if (slotProblem) problems.push(`${label}: ${slotProblem}`);
    }
    if (single) {
      const twin = pairKey(twinField(field), en);
      if (dictionary.has(twin) || liveKeys.has(twin) || entryKeys.has(twin) || listed.has(twin)) {
        problems.push(`${label}: the same English is also a ${twinField(field)} key (in sk.csv, a live cell or the list)`);
      }
      const heldPieces = heldPieceLabels(en, heldKeys);
      if (heldPieces.length) problems.push(`${label}: a piece is read by held cell ${heldPieces.join(', ')}`);
    }
    if (heldKeys.has(k)) problems.push(`${label}: read by held cell ${[...heldKeys.get(k)].sort().join(', ')}`);
    if (!liveKeys.has(k)) problems.push(`${label}: not a live whole cell`);
    if (leaves.has(k)) problems.push(`${label}: also a piece of a cell at ${[...leaves.get(k)].sort().join(', ')}`);
  }
  return problems;
}

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
  const usage = () => fail('Usage: node tools/sk-search-english.mjs [--apply] --review review.csv [--data DIR] [--js FILE]');
  const root = fileURLToPath(new URL('../', import.meta.url));
  let apply = false, dataDir = join(root, 'data'), jsFile = join(root, 'js/i18n.js'), reviewFile = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (['--data', '--js', '--review'].includes(a)) {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) usage();
      if (a === '--data') dataDir = resolve(v);
      else if (a === '--js') jsFile = resolve(v);
      else reviewFile = v;
    } else usage();
  }
  if (!reviewFile) usage();
  const read = (path, encoding) => { try { return readFileSync(path, encoding); } catch (e) { fail(`Cannot read ${path}: ${e.message}`); } };

  const jsText = read(jsFile, 'utf8');
  let current;
  try { current = readSearchEnglishBlock(jsText); } catch (e) { fail(`${jsFile}: ${e.message}`); }

  const skPath = join(dataDir, 'i18n/sk.csv');
  const sk = readSearchEnglishDictionary(skPath, read(skPath), fail);
  const reviews = readTranslationReviews(reviewFile, read(reviewFile, 'utf8'), fail);
  let held;
  try {
    held = heldDisplayKeys({
      universitiesCsv: read(join(dataDir, 'universities.csv'), 'utf8'),
      programmesCsv: read(join(dataDir, 'programmes.csv'), 'utf8'),
    });
  } catch (e) { fail(e.message); }
  const ctx = {
    ...sk,
    heldKeys: held.heldKeys,
    liveKeys: liveDisplayKeys(held.programmes, held.heldCells, held.progRaw),
    leaves: wholeCellLeaves(held.programmes, { progRaw: held.progRaw, uniRaw: held.uniRaw }),
  };
  const existingProblems = searchEnglishProblems(current.entries, ctx);
  if (existingProblems.length) {
    for (const problem of existingProblems) console.log(`REFUSE list: ${problem}`);
    process.exitCode = 2;
    return;
  }
  const have = new Set(current.entries.map(([f, en]) => pairKey(f, en)));
  const additions = [];
  let refusals = 0, ignored = 0;
  for (const { field, en, sk: slovak, verdict, line } of reviews.values()) {
    if (verdict !== 'keep' || !SEARCH_ENGLISH_FIELDS.includes(field)) { ignored++; continue; }
    const where = `${reviewFile}:${line}`;
    const k = pairKey(field, en);
    if (sk.dictionary.get(k)?.sk !== slovak) { refusals++; console.log(`REFUSE ${where}: sk.csv has no row with exactly this Slovak for ${field} ${JSON.stringify(en)}`); continue; }
    if (normaliseEnglish(slovak) === en) { ignored++; console.log(`IGNORE ${where}: Slovak equals the English, nothing to add`); continue; }
    if (have.has(k)) { console.log(`SKIP ${where}: already listed`); continue; }
    const problems = searchEnglishProblems([[field, en]], { ...ctx, listed: have });
    if (problems.length) { refusals++; console.log(`REFUSE ${where}: ${problems.join('; ')}`); continue; }
    have.add(k);
    additions.push([field, en]);
    console.log(`ADD ${field}: ${JSON.stringify(en)}`);
  }
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

  const next = sortEntries([...current.entries, ...additions]);
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
