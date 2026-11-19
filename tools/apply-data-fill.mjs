// Applies a batch of researched cell changes to data/universities.csv and
// data/programmes.csv. This is the only way a data-fill batch should reach the
// CSVs: never hand-edit them (and never open them in Excel, which mangles
// dates and "€ — ·").
//
//   node tools/apply-data-fill.mjs batch.csv [more.csv ...]            dry run, writes nothing
//   node tools/apply-data-fill.mjs --apply batch.csv [more.csv ...]    writes the CSVs
//   --data DIR          folder holding universities.csv and programmes.csv (default: data/)
//   --today YYYY-MM-DD  the date stamped into last_verified (default: today, local time)
//
// Exit codes: 0 clean, 2 at least one line refused (nothing written),
// 3 the stop gate tripped (nothing written), 1 bad arguments or unreadable files.
// After a real --apply run node tools/make-snapshot.mjs and node tools/check.mjs.
//
// Each batch file starts with exactly these nine columns, in this order
// (later columns such as verdict or partition are ignored):
//   entity_type,id,column,expected_old,value,value_kind,year_label,source_url,quote
// entity_type is "uni" (a university_id) or "prog" (a programme_id).
//
// Why each guard exists:
//
// - expected_old (stale baseline protection). Research is done against a copy
//   of the data that can be days old, and Jakub edits main often. A line only
//   applies when the cell still holds exactly what the researcher saw. If it
//   changed in between, somebody else got there first and the line is refused
//   rather than overwriting their work. A line whose new value is already in
//   the cell is a SKIP, so a batch can be run twice without harm.
//
// - value_kind. Blank, "none", "?" and "0" look like nothing but each is a
//   different claim to a student, so a batch has to say which one it means
//   instead of leaving it to an empty or mistyped value:
//     value             a real value. Never "", "?", "none" or "0".
//     blank             empty cell: "nobody has checked", or "inherit the
//                       university default".
//     none              "the university says there is no requirement". Only
//                       ib_subjects and ib_maths, and only on positive evidence.
//     unknown_override  "?": differs from the university default, value not
//                       published. It never inherits, so it is only allowed in
//                       the programme columns where the site understands it.
//     zero              "0": a real "no fee" claim, only in the fee columns.
//
// - AI-DRAFT. verified_by is a human signature. A row signed by a person is
//   never changed by a script, and a university is not changed either while
//   one of its programmes is signed, because that signature also covers the
//   defaults the programme inherits. The script never writes verified_by; it
//   only stamps last_verified on the rows it actually changed.
//
// - Column allowlist. Ids, signatures, dates and the join key are never
//   editable here: changing a programme_id or university_id breaks saved lists.
//
// - Source and quote. Every claim carries the official page and the words on
//   it, so the next person can check it. Only clearing a cell needs no quote.
//
// - Stop gate. If one column loses more than 50 lines, or more than 10% of
//   its lines (and at least 3), the batch itself is wrong (stale baseline,
//   wrong column, a broken extractor) and the owner has to look before
//   anything is written. With --apply, any refusal at all writes nothing:
//   fix the batch first, so a half-applied batch never exists.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../js/csv.js';
import { SUBJECT_AREAS } from '../js/subjects.js';

const HEADER = 'entity_type,id,column,expected_old,value,value_kind,year_label,source_url,quote'.split(',');
const ENTITIES = {
  uni: {
    file: 'universities.csv', key: 'university_id',
    columns: 'english_requirement_default,admission_default,tuition_eu_default,app_fee_default,app_fee_note_default,apply_url_default,baseline_requirement'.split(','),
  },
  prog: {
    file: 'programmes.csv', key: 'programme_id',
    columns: 'programme,degree_type,subject_area,ib_subjects,ib_maths,other_requirements,admission,entrance_exam,tuition_eu,english_requirement,application_deadline,deadline_notes,official_url,app_fee,app_fee_note,ib_points_min'.split(','),
  },
};
const NONE_COLUMNS = ['ib_subjects', 'ib_maths'];
const UNKNOWN_COLUMNS = ['tuition_eu', 'english_requirement', 'admission', 'ib_maths', 'entrance_exam', 'app_fee'];
const ZERO_COLUMNS = ['tuition_eu', 'tuition_eu_default', 'app_fee', 'app_fee_default'];
const MONEY_COLUMNS = ZERO_COLUMNS;
const URL_COLUMNS = ['official_url', 'apply_url_default'];
const NOTE_COLUMNS = ['deadline_notes', 'app_fee_note', 'app_fee_note_default'];
// Every programme needs a name and an official link, so these cannot be cleared.
const NEVER_BLANK = ['programme', 'official_url'];

const realDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const httpUrl = (s) => {
  if (!/^https?:\/\/\S+$/.test(s)) return false;
  try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; }
};

// Same quoting as tools/add-new-data-types.mjs, which wrote the current files:
// quote a cell only when it holds a quote mark, comma or line break; LF line
// ends; one trailing newline. Untouched rows therefore come out byte-identical.
const esc = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const toCsv = (grid) => grid.map((r) => r.map(esc).join(',')).join('\n') + '\n';

const fail = (message) => { console.error(message); process.exit(1); };
const usage = () => fail('Usage: node tools/apply-data-fill.mjs [--apply] [--data DIR] [--today YYYY-MM-DD] batch.csv [more.csv ...]');

// ---------------------------------------------------------------- arguments
const root = fileURLToPath(new URL('../', import.meta.url));
let apply = false;
let dataDir = join(root, 'data');
let today = '';
const batchFiles = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--apply') apply = true;
  else if (a === '--data' || a === '--today') {
    const v = argv[++i];
    if (v == null || v.startsWith('--')) usage();
    if (a === '--data') dataDir = resolve(v); else today = v;
  } else if (a.startsWith('--')) usage();
  else batchFiles.push(a);
}
if (!batchFiles.length) usage();
if (!today) {
  const d = new Date();
  today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
} else if (!realDate(today)) usage();

// ---------------------------------------------------------------- the data
const sheets = {};
for (const [entity, spec] of Object.entries(ENTITIES)) {
  const path = join(dataDir, spec.file);
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { fail(`Cannot read ${path}: ${e.message}`); }
  const grid = parseCsv(text);
  const head = grid[0] || [];
  for (const c of [spec.key, 'verified_by', 'last_verified', ...spec.columns]) {
    if (!head.includes(c)) fail(`${path}: column ${c} is missing`);
  }
  if (new Set(head).size !== head.length) fail(`${path}: duplicate column in the header`);
  const bad = grid.findIndex((r) => r.length !== head.length);
  if (bad !== -1) fail(`${path}: row ${bad + 1} has ${grid[bad].length} cells, the header has ${head.length}`);
  // If writing the file back unchanged would alter it, this script does not
  // know the file's formatting and must not rewrite 4,000 rows to change one.
  if (toCsv(grid) !== text) fail(`${path}: not in the expected CSV formatting (quoting, line ends or blank lines); refusing to rewrite it`);
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const byId = new Map();
  for (const r of grid.slice(1)) {
    if (byId.has(r[col[spec.key]])) fail(`${path}: duplicate ${spec.key} ${r[col[spec.key]]}`);
    byId.set(r[col[spec.key]], r);
  }
  sheets[entity] = { path, text, grid, col, byId };
}
// A signed programme also vouches for what it inherits from its university.
const signedUnis = new Set();
{
  const { grid, col } = sheets.prog;
  if (col.university_id == null) fail(`${sheets.prog.path}: column university_id is missing`);
  for (const r of grid.slice(1)) if (r[col.verified_by] !== 'AI-DRAFT') signedUnis.add(r[col.university_id]);
}

// ---------------------------------------------------------------- the batch
// Splits a file into records and remembers the line each one starts on, so a
// refusal points at the real line even when a quote spans several lines.
function records(text) {
  const out = [];
  let start = 0, line = 1, startLine = 1, inQuotes = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (i === text.length || (ch === '\n' && !inQuotes)) {
      const raw = text.slice(start, i);
      if (raw.trim()) out.push({ line: startLine, cells: parseCsv(raw)[0] || [] });
      start = i + 1; startLine = line + 1;
    }
    if (ch === '\n') line++;
  }
  return out;
}

const lines = [];
for (const file of batchFiles) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { fail(`Cannot read ${file}: ${e.message}`); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const [head, ...rest] = records(text);
  if (!head || HEADER.some((h, i) => head.cells[i] !== h)) fail(`${file}: the header must start with ${HEADER.join(',')}`);
  for (const r of rest) {
    const p = Object.fromEntries(HEADER.map((h, i) => [h, r.cells[i] ?? '']));
    lines.push({ ...p, file, line: r.line, short: r.cells.length < HEADER.length });
  }
}

// What a line would write, or the value_kind rule it breaks.
function written(p) {
  const { column, value, value_kind: kind } = p;
  const literal = (text, allowed, where) => {
    if (!allowed.includes(column) || (kind === 'unknown_override' && p.entity_type !== 'prog')) return { reason: `value_kind ${kind} is only allowed in ${where}` };
    if (value !== '' && value !== text) return { reason: `value_kind ${kind} writes ${JSON.stringify(text)}, but value is ${JSON.stringify(value)}` };
    return { value: text };
  };
  if (kind === 'value') {
    if (value === '') return { reason: 'value_kind value needs a value (use blank to clear a cell)' };
    if (value === '?') return { reason: 'value "?" needs value_kind unknown_override' };
    if (value === 'none') return { reason: 'value "none" needs value_kind none' };
    if (value === '0') return { reason: 'value "0" needs value_kind zero' };
    return { value };
  }
  if (kind === 'blank') {
    if (value !== '') return { reason: 'value_kind blank must have an empty value' };
    if (NEVER_BLANK.includes(column)) return { reason: `${column} can never be blank` };
    return { value: '' };
  }
  if (kind === 'none') return literal('none', NONE_COLUMNS, NONE_COLUMNS.join(', '));
  if (kind === 'unknown_override') return literal('?', UNKNOWN_COLUMNS, `the programme columns ${UNKNOWN_COLUMNS.join(', ')}`);
  if (kind === 'zero') return literal('0', ZERO_COLUMNS, ZERO_COLUMNS.join(', '));
  return { reason: `unknown value_kind ${JSON.stringify(kind)}` };
}

// Format rules for a real value. The four special kinds are fixed literals.
function formatReason(column, v) {
  if (column === 'application_deadline' && !realDate(v)) return 'application_deadline must be a real YYYY-MM-DD date';
  if (MONEY_COLUMNS.includes(column) && !/^\d+(?:\.\d\d)?$/.test(v)) return `${column} must be a plain number (digits, optional .dd)`;
  if (column === 'ib_points_min' && !(/^\d{1,2}$/.test(v) && Number(v) <= 45)) return 'ib_points_min must be a whole number from 0 to 45';
  if (column === 'entrance_exam' && !['yes', 'waivable', 'no'].includes(v)) return 'entrance_exam must be yes, waivable or no';
  if (URL_COLUMNS.includes(column) && !httpUrl(v)) return `${column} must be an http(s) link with no spaces`;
  if (column === 'subject_area') {
    const bad = v.split(';').map((s) => s.trim()).filter((s) => !SUBJECT_AREAS.includes(s));
    if (bad.length) return `subject_area has a part outside the fixed subject list: ${bad.map((s) => JSON.stringify(s)).join(', ')}`;
  }
  if (NOTE_COLUMNS.includes(column) && v.length > 250) return `${column} is ${v.length} characters; the limit is 250`;
  return '';
}

// First pass: what each line targets and would write, so two lines that want
// different values in one cell can both be refused.
const wanted = new Map();
for (const p of lines) {
  const spec = ENTITIES[p.entity_type];
  p.sheet = spec && sheets[p.entity_type];
  p.row = p.sheet?.byId.get(p.id);
  p.allowed = Boolean(spec?.columns.includes(p.column));
  p.out = written(p);
  if (p.row && p.allowed && !p.out.reason) {
    const key = `${p.entity_type}\0${p.id}\0${p.column}`;
    if (!wanted.has(key)) wanted.set(key, new Set());
    wanted.get(key).add(p.out.value);
  }
}

const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const perColumn = new Map(), refusedPerColumn = new Map(), changedPerColumn = new Map();
const touched = { uni: new Set(), prog: new Set() };
const changes = [];
const seen = new Set();
let refusals = 0, skips = 0;

for (const p of lines) {
  const column = p.column || '(no column)';
  count(perColumn, column);
  const where = `${p.file}:${p.line} ${p.entity_type || '(no entity)'} ${p.id || '(no id)'} ${column}`;
  const refuse = (reason) => { refusals++; count(refusedPerColumn, column); console.log(`REFUSE ${where}: ${reason}`); };
  const key = `${p.entity_type}\0${p.id}\0${p.column}`;
  if (p.short) { refuse(`the line has fewer than ${HEADER.length} cells`); continue; }
  if (!p.sheet) { refuse(`entity_type must be uni or prog, not ${JSON.stringify(p.entity_type)}`); continue; }
  if (!p.allowed) { refuse(`column ${JSON.stringify(p.column)} may not be changed on a ${p.entity_type} row`); continue; }
  if (!p.row) { refuse(`unknown ${ENTITIES[p.entity_type].key}`); continue; }
  if (p.out.reason) { refuse(p.out.reason); continue; }
  if (wanted.get(key).size > 1) { refuse(`conflicting lines for this cell: ${[...wanted.get(key)].map((v) => JSON.stringify(v)).join(' vs ')}`); continue; }
  const { col } = p.sheet;
  const current = p.row[col[p.column]];
  const next = p.out.value;
  if (current === next || seen.has(key)) { skips++; console.log(`SKIP ${where}: ${seen.has(key) ? 'repeats an earlier line' : `already ${JSON.stringify(current)}`}`); continue; }
  if (p.row[col.verified_by] !== 'AI-DRAFT') { refuse(`row is signed (verified_by ${JSON.stringify(p.row[col.verified_by])}), not AI-DRAFT`); continue; }
  if (p.entity_type === 'uni' && signedUnis.has(p.id)) { refuse('university has a signed programme, which also covers its defaults'); continue; }
  if (current !== p.expected_old) { refuse(`stale baseline: expected_old ${JSON.stringify(p.expected_old)}, the cell now holds ${JSON.stringify(current)}`); continue; }
  const format = p.value_kind === 'value' ? formatReason(p.column, next) : '';
  if (format) { refuse(format); continue; }
  if (!httpUrl(p.source_url)) { refuse(`source_url must be an http(s) link: ${JSON.stringify(p.source_url)}`); continue; }
  if (p.value_kind !== 'blank' && !p.quote.trim()) { refuse('quote is empty'); continue; }
  seen.add(key);
  changes.push({ p, current, next });
  count(changedPerColumn, column);
  touched[p.entity_type].add(p.id);
  console.log(`CHANGE ${p.entity_type} ${p.id} ${p.column}: ${JSON.stringify(current)} -> ${JSON.stringify(next)}`);
}

// ---------------------------------------------------------------- summary
const list = (map) => [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
console.log(`\nLines read: ${lines.length} (from ${batchFiles.length} file${batchFiles.length === 1 ? '' : 's'})`);
console.log(`Changes: ${changes.length} (${list(changedPerColumn)})`);
console.log(`Refusals: ${refusals} (${list(refusedPerColumn)})`);
console.log(`Skips (cell already holds the value): ${skips}`);
console.log(`Rows touched: ${touched.uni.size} universities, ${touched.prog.size} programmes`);

const stops = [...refusedPerColumn].filter(([column, n]) => n > 50 || (n >= 3 && n > 0.1 * perColumn.get(column)));
if (stops.length) {
  for (const [column, n] of stops) console.log(`STOP: ${n} of ${perColumn.get(column)} lines for ${column} were refused; the batch needs the owner before anything is written.`);
  console.log('Nothing written.');
  process.exit(3);
}
if (refusals) {
  console.log(apply ? 'Nothing written: fix or remove the refused lines, then run again.' : 'Dry run: nothing written. Fix or remove the refused lines.');
  process.exit(2);
}
if (!apply) { console.log('Dry run: nothing written. Add --apply to write.'); process.exit(0); }

for (const { p, next } of changes) {
  const { col } = p.sheet;
  p.row[col[p.column]] = next;
  p.row[col.last_verified] = today;
}
for (const sheet of Object.values(sheets)) {
  const text = toCsv(sheet.grid);
  if (text !== sheet.text) writeFileSync(sheet.path, text);
}
console.log(`Wrote ${changes.length} change${changes.length === 1 ? '' : 's'} into ${dataDir}; last_verified set to ${today} on the changed rows. Run node tools/make-snapshot.mjs and node tools/check.mjs next.`);
