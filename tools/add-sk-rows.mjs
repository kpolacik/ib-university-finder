// Adds Slovak text for new fee notes and IB-recognition texts to data/i18n/sk.csv.
//
// Why this exists: check.mjs refuses a fee note or recognition text that has no
// Slovak row ("PR2 all four new free-text columns have Slovak coverage"), so a
// data-fill batch that writes a new note cannot be committed without one. The
// CSVs are never edited by hand, so this script appends the rows instead.
//
// Input: a CSV with the header  field,en,sk  . Each line is refused unless
//   - field is one of the four guarded columns below (other columns are left to
//     the translation pass, which works from `node tools/i18n-missing.mjs`);
//   - en is, character for character, a value that column holds in the data
//     today (so a typo cannot create an orphan row);
//   - sk.csv has no row for that field and English text yet (never overwrites).
// Rows are written with verified_by AI-DRAFT: nobody has checked the Slovak.
//
//   node tools/add-sk-rows.mjs rows.csv          dry run, writes nothing
//   node tools/add-sk-rows.mjs --apply rows.csv  appends the rows
// Then: node tools/make-snapshot.mjs && node tools/check.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../js/csv.js';

const FIELDS = { app_fee_note: 'programmes', app_fee_note_default: 'universities', ib_recognition: 'programmes', ib_recognition_default: 'universities' };
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file || args.some((a) => a.startsWith('--') && a !== '--apply')) { console.error('Usage: node tools/add-sk-rows.mjs [--apply] rows.csv'); process.exit(1); }

const esc = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const grid = (path) => parseCsv(readFileSync(path, 'utf8'));
const values = {};
for (const [field, sheet] of Object.entries(FIELDS)) {
  const g = grid(join(root, `data/${sheet}.csv`));
  const i = g[0].indexOf(field);
  values[field] = new Set(g.slice(1).map((r) => r[i]));
}
const skPath = join(root, 'data/i18n/sk.csv');
const skText = readFileSync(skPath, 'utf8');
const sk = parseCsv(skText);
if (sk[0].join(',') !== 'field,en,sk,verified_by') { console.error('data/i18n/sk.csv: unexpected header'); process.exit(1); }
const have = new Set(sk.slice(1).map((r) => `${r[0]}\u0000${r[1]}`));

const [head, ...rows] = grid(file);
if (!head || head.slice(0, 3).join(',') !== 'field,en,sk') { console.error(`${file}: the header must be field,en,sk`); process.exit(1); }
let refused = 0;
const add = [];
for (const [n, r] of rows.entries()) {
  const [field, en, skv] = [r[0] ?? '', r[1] ?? '', r[2] ?? ''];
  const where = `${file}:${n + 2} ${field}`;
  const no = (why) => { refused++; console.log(`REFUSE ${where}: ${why}`); };
  if (!(field in FIELDS)) no('only fee notes and IB-recognition texts are added here');
  else if (!skv.trim()) no('the Slovak text is empty');
  else if (!values[field].has(en)) no('the English text is not a current value of that column');
  else if (have.has(`${field}\u0000${en}`)) no('sk.csv already has a row for this text');
  else { have.add(`${field}\u0000${en}`); add.push([field, en, skv, 'AI-DRAFT']); console.log(`ADD ${field}: ${JSON.stringify(en)} -> ${JSON.stringify(skv)}`); }
}
console.log(`\n${add.length} to add, ${refused} refused.`);
if (refused) { console.log('Nothing written.'); process.exit(2); }
if (!apply) { console.log('Dry run: nothing written. Add --apply to write.'); process.exit(0); }
writeFileSync(skPath, skText + (skText.endsWith('\n') ? '' : '\n') + add.map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`Appended ${add.length} row${add.length === 1 ? '' : 's'} to data/i18n/sk.csv.`);
