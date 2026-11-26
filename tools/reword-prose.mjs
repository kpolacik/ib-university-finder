// Rewords prose cells in data/programmes.csv without changing what they say
// (issue #17: research-log notes written for us, shown to students). It is the
// writer for wording only. A new or corrected fact goes through
// tools/apply-data-fill.mjs instead, with its source and quote.
//
//   node tools/reword-prose.mjs batch.csv [more.csv ...]                       dry run, writes nothing
//   node tools/reword-prose.mjs --apply --review review.csv batch.csv [...]    writes data/programmes.csv
//   --data DIR   folder holding programmes.csv (default: data/)
//
// Exit codes: 0 clean, 2 at least one line refused (nothing written), 1 bad
// arguments or unreadable files. After a real --apply run
// node tools/make-snapshot.mjs and node tools/check.mjs.
//
// The batch file starts with exactly these seven columns, in this order
// (later columns are ignored):
//   entity_type,id,column,expected_old,value,reason,drops
// entity_type is "prog" (a programme_id). `drops` lists, separated by spaces,
// the condition tokens the new value leaves out on purpose, written as the dry
// run prints them (for example date:2026-10-28).
//
// The review file is written by the independent reviewer, not by whoever
// wrote the batch. It starts with these six columns:
//   entity_type,id,column,value,verdict,approved_drops
// A line is written only if the review has a row for exactly this cell and
// this exact new value, with verdict "keep", approving every drop. So a value
// edited after review, or a drop nobody approved, cannot reach the data.
//
// Why each guard exists:
//
// - Columns. Only deadline_notes, other_requirements and ib_subjects. Their
//   English is not a Slovak lookup key today; rewording a translated column
//   would orphan its Slovak row (js/i18n.js dataParts) and needs its own step.
//   Ids, verified_by and last_verified are never written: a reword is not a
//   re-check, so it must not make a row look freshly verified.
// - expected_old. Jakub edits the data often. A line applies only when the cell
//   still holds exactly what the rewording was based on; a cell that already
//   holds the new value is a SKIP, so a batch can be run twice.
// - AI-DRAFT. A row signed by a person is never changed by a script.
// - Frozen text and condition tokens (tools/lib/reword.mjs): sentences code
//   reads back must come through byte for byte, every number, date, amount,
//   code or test name must survive unless dropped and approved, and none may
//   appear from nowhere.
// - Same-name siblings. js/data.js addProgrammeIdentity compares ib_subjects
//   and other_requirements between programmes of one university with the same
//   name. If two such rows hold the same text and only one is reworded, they
//   look different and lose the "Same-name entry" warning. Distinct text must
//   also stay distinct to avoid introducing the warning.
// - With --apply, any refusal at all writes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../js/csv.js';
import { BULLET } from '../js/data.js';
import { frozenParts, compareTokens, formatProblem, isMarker } from './lib/reword.mjs';

const HEADER = 'entity_type,id,column,expected_old,value,reason,drops'.split(',');
const REVIEW_HEADER = 'entity_type,id,column,value,verdict,approved_drops'.split(',');
const COLUMNS = ['deadline_notes', 'other_requirements', 'ib_subjects'];
// The columns addProgrammeIdentity compares between same-name programmes.
const IDENTITY_COLUMNS = ['ib_subjects', 'other_requirements'];

// Same quoting as tools/apply-data-fill.mjs, so untouched rows come out
// byte-identical.
const esc = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const toCsv = (grid) => grid.map((r) => r.map(esc).join(',')).join('\n') + '\n';

const fail = (message) => { console.error(message); process.exit(1); };
const usage = () => fail('Usage: node tools/reword-prose.mjs [--apply --review review.csv] [--data DIR] batch.csv [more.csv ...]');

// ---------------------------------------------------------------- arguments
const root = fileURLToPath(new URL('../', import.meta.url));
let apply = false;
let dataDir = join(root, 'data');
let reviewFile = '';
const batchFiles = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply') apply = true;
  else if (a === '--data' || a === '--review') {
    const v = argv[++i];
    if (v == null || v.startsWith('--')) usage();
    if (a === '--data') dataDir = resolve(v); else reviewFile = v;
  } else if (a.startsWith('--')) usage();
  else batchFiles.push(a);
}
if (!batchFiles.length) usage();
if (apply && !reviewFile) fail('--apply needs --review FILE: every reword is written only after an independent reviewer has approved its exact text.');

// ---------------------------------------------------------------- the data
const path = join(dataDir, 'programmes.csv');
let text;
try { text = readFileSync(path, 'utf8'); } catch (e) { fail(`Cannot read ${path}: ${e.message}`); }
const grid = parseCsv(text);
const head = grid[0] || [];
for (const c of ['programme_id', 'university_id', 'programme', 'verified_by', 'last_verified', ...COLUMNS]) {
  if (!head.includes(c)) fail(`${path}: column ${c} is missing`);
}
if (new Set(head).size !== head.length) fail(`${path}: duplicate column in the header`);
const badRow = grid.findIndex((r) => r.length !== head.length);
if (badRow !== -1) fail(`${path}: row ${badRow + 1} has ${grid[badRow].length} cells, the header has ${head.length}`);
if (toCsv(grid) !== text) fail(`${path}: not in the expected CSV formatting (quoting, line ends or blank lines); refusing to rewrite it`);
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const byId = new Map();
for (const r of grid.slice(1)) {
  if (byId.has(r[col.programme_id])) fail(`${path}: duplicate programme_id ${r[col.programme_id]}`);
  byId.set(r[col.programme_id], r);
}
// Same key as js/data.js addProgrammeIdentity.
const sameName = (r) => JSON.stringify([r[col.university_id].trim(), r[col.programme].trim().toLowerCase().normalize('NFC')]);
const groups = new Map();
for (const r of grid.slice(1)) {
  const key = sameName(r);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// ---------------------------------------------------------------- the batch
// Splits a file into records and remembers the line each one starts on, so a
// refusal points at the real line even when a quote spans several lines.
function records(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { fail(`Cannot read ${file}: ${e.message}`); }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const out = [];
  let start = 0, line = 1, startLine = 1, inQuotes = false;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (i === raw.length || (ch === '\n' && !inQuotes)) {
      const part = raw.slice(start, i).replace(/\r$/, '');
      if (part.trim()) {
        if (inQuotes || !/^(?:"(?:[^"]|"")*"|[^",\r\n]*)(?:,(?:"(?:[^"]|"")*"|[^",\r\n]*))*$/.test(part)) {
          fail(`${file}:${startLine}: malformed CSV record`);
        }
        out.push({ line: startLine, cells: parseCsv(part)[0] || [] });
      }
      start = i + 1; startLine = line + 1;
    }
    if (ch === '\n') line++;
  }
  return out;
}
const tokenList = (s) => (s || '').split(/\s+/).filter(Boolean);
const reviewKey = (entity, id, column, value) => JSON.stringify([entity, id, column, value]);

const lines = [];
for (const file of batchFiles) {
  const [first, ...rest] = records(file);
  if (!first || HEADER.some((h, i) => first.cells[i] !== h)) fail(`${file}: the header must start with ${HEADER.join(',')}`);
  for (const r of rest) {
    const p = Object.fromEntries(HEADER.map((h, i) => [h, r.cells[i] ?? '']));
    lines.push({ ...p, file, line: r.line, short: r.cells.length < HEADER.length });
  }
}

const reviews = new Map();
if (reviewFile) {
  const [first, ...rest] = records(reviewFile);
  if (!first || REVIEW_HEADER.some((h, i) => first.cells[i] !== h)) fail(`${reviewFile}: the header must start with ${REVIEW_HEADER.join(',')}`);
  for (const r of rest) {
    if (r.cells.length < REVIEW_HEADER.length) fail(`${reviewFile}:${r.line}: the review row has fewer than ${REVIEW_HEADER.length} cells`);
    const v = Object.fromEntries(REVIEW_HEADER.map((h, i) => [h, r.cells[i] ?? '']));
    const key = reviewKey(v.entity_type, v.id, v.column, v.value);
    const previous = reviews.get(key);
    if (previous && (previous.verdict !== v.verdict || previous.approved_drops !== v.approved_drops)) {
      fail(`${reviewFile}:${r.line}: conflicting review rows for ${v.id} ${v.column} and this exact value`);
    }
    reviews.set(key, v);
  }
}

// First pass: what each line wants, so two lines that want different values in
// one cell are both refused, and siblings can be compared with the final text.
const wanted = new Map();
for (const p of lines) {
  const key = `${p.id}\0${p.column}`;
  if (!wanted.has(key)) wanted.set(key, new Set());
  wanted.get(key).add(p.value);
}
const finalValue = (row, column) => {
  const want = wanted.get(`${row[col.programme_id]}\0${column}`);
  return want?.size === 1 ? [...want][0] : row[col[column]];
};
// Compare the same displayed facts as addProgrammeIdentity in js/data.js.
const identityFact = (column, value) => column === 'other_requirements'
  ? value.split(BULLET).map((item) => item.trim()).filter((item) => item && item !== '?').join(BULLET)
  : value.trim();
const distinguishes = (a, b) => a !== '' && a !== '?' && b !== '' && b !== '?' && a !== b;

const changes = [];
const seen = new Set();
let refusals = 0, skips = 0;
for (const p of lines) {
  const where = `${p.file}:${p.line} ${p.entity_type || '(no entity)'} ${p.id || '(no id)'} ${p.column || '(no column)'}`;
  const refuse = (reason) => { refusals++; console.log(`REFUSE ${where}: ${reason}`); };
  const key = `${p.id}\0${p.column}`;
  if (p.short) { refuse(`the line has fewer than ${HEADER.length} cells`); continue; }
  if (p.entity_type !== 'prog') { refuse(`entity_type must be prog, not ${JSON.stringify(p.entity_type)}`); continue; }
  if (!COLUMNS.includes(p.column)) { refuse(`column ${JSON.stringify(p.column)} may not be reworded here (only ${COLUMNS.join(', ')})`); continue; }
  const row = byId.get(p.id);
  if (!row) { refuse('unknown programme_id'); continue; }
  if (wanted.get(key).size > 1) { refuse(`conflicting lines for this cell: ${[...wanted.get(key)].map((v) => JSON.stringify(v)).join(' vs ')}`); continue; }
  const current = row[col[p.column]];
  if (current === p.value) { skips++; console.log(`SKIP ${where}: already holds the new value`); continue; }
  if (row[col.verified_by] !== 'AI-DRAFT') { refuse(`row is signed (verified_by ${JSON.stringify(row[col.verified_by])}), not AI-DRAFT`); continue; }
  if (current !== p.expected_old) { refuse(`stale baseline: expected_old ${JSON.stringify(p.expected_old)}, the cell now holds ${JSON.stringify(current)}`); continue; }
  if (isMarker(current)) { refuse(`the old value ${JSON.stringify(current)} is blank or a marker`); continue; }
  const format = formatProblem(p.value);
  if (format) { refuse(format); continue; }
  if (!p.reason.trim()) { refuse('reason is empty'); continue; }

  const frozenOld = frozenParts(p.column, current), frozenNew = frozenParts(p.column, p.value);
  if (JSON.stringify(frozenOld) !== JSON.stringify(frozenNew)) {
    const lost = frozenOld.filter((s) => !frozenNew.includes(s)), extra = frozenNew.filter((s) => !frozenOld.includes(s));
    refuse(`frozen text changed (code reads it back): ${[...lost.map((s) => `lost ${JSON.stringify(s)}`), ...extra.map((s) => `new ${JSON.stringify(s)}`)].join('; ') || 'count or order of protected text changed'}`);
    continue;
  }
  const { kept, missing, added } = compareTokens(current, p.value);
  const drops = tokenList(p.drops);
  const undeclared = missing.filter((t) => !drops.includes(t));
  if (undeclared.length) { refuse(`condition tokens missing from the new value: ${undeclared.join(' ')} (keep them, or list them in drops for the reviewer)`); continue; }
  const pointless = drops.filter((t) => !missing.includes(t));
  if (pointless.length) { refuse(`drops names tokens the new value still has, or the old one never had: ${pointless.join(' ')}`); continue; }
  if (added.length) { refuse(`new condition tokens: ${added.join(' ')}. A reword adds no fact; new evidence goes through tools/apply-data-fill.mjs`); continue; }

  if (IDENTITY_COLUMNS.includes(p.column)) {
    const oldFact = identityFact(p.column, current);
    const newFact = identityFact(p.column, p.value);
    const changed = groups.get(sameName(row)).filter((s) => s !== row
      && distinguishes(oldFact, identityFact(p.column, s[col[p.column]]))
        !== distinguishes(newFact, identityFact(p.column, finalValue(s, p.column))));
    if (changed.length) { refuse(`same-name sibling ${changed.map((s) => s[col.programme_id]).join(', ')} would gain or lose a displayed difference`); continue; }
  }

  if (apply) {
    const review = reviews.get(reviewKey('prog', p.id, p.column, p.value));
    if (!review) { refuse('no review row for this exact new value'); continue; }
    if (review.verdict !== 'keep') { refuse(`the reviewer's verdict is ${JSON.stringify(review.verdict)}, not "keep"`); continue; }
    const unapproved = drops.filter((t) => !tokenList(review.approved_drops).includes(t));
    if (unapproved.length) { refuse(`drops the reviewer did not approve: ${unapproved.join(' ')}`); continue; }
  }
  if (seen.has(key)) { skips++; console.log(`SKIP ${where}: repeats an earlier line`); continue; }
  seen.add(key);
  changes.push({ row, column: p.column, next: p.value });
  console.log(`CHANGE prog ${p.id} ${p.column} (${p.reason})\n  old: ${JSON.stringify(current)}\n  new: ${JSON.stringify(p.value)}\n  kept tokens: ${kept.join(' ') || '(none)'}${drops.length ? `\n  drops: ${drops.join(' ')}` : ''}`);
}

// ---------------------------------------------------------------- summary
console.log(`\nLines read: ${lines.length} (from ${batchFiles.length} file${batchFiles.length === 1 ? '' : 's'})`);
console.log(`Changes: ${changes.length}`);
console.log(`Refusals: ${refusals}`);
console.log(`Skips: ${skips}`);
if (refusals) {
  console.log(apply ? 'Nothing written: fix or remove the refused lines, then run again.' : 'Dry run: nothing written. Fix or remove the refused lines.');
  process.exit(2);
}
if (!apply) { console.log('Dry run: nothing written. Add --apply --review FILE to write.'); process.exit(0); }

for (const { row, column, next } of changes) row[col[column]] = next;
const out = toCsv(grid);
if (out !== text) writeFileSync(path, out);
console.log(`Wrote ${changes.length} change${changes.length === 1 ? '' : 's'} into ${path}; last_verified and verified_by untouched. Run node tools/make-snapshot.mjs and node tools/check.mjs next.`);
