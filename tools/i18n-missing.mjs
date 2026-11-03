// Read-only translation report for Jakub. Run from any directory:
//   node tools/i18n-missing.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { csvToObjects } from '../js/csv.js';
import { normaliseEnglish, DATA_FIELDS } from '../js/i18n.js';
import { subjectAreasOf } from '../js/subjects.js';

const read = (file) => csvToObjects(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'), file).rows;

export function translationInventory(universities, programmes, translations) {
  const wanted = new Map();
  const add = (field, english) => {
    const en = normaliseEnglish(english);
    if (en && en !== '?') wanted.set(`${field}\u0000${en}`, { field, en });
  };
  for (const row of [...universities, ...programmes]) {
    for (const field of [...Object.keys(DATA_FIELDS), 'admission_default', 'english_requirement_default']) {
      if (row[field]) add(field, row[field]);
    }
    // Canonical subject names can differ from the CSV's older aliases.
    if (row.subject_area) for (const item of subjectAreasOf(row.subject_area, [], '')) add('subject_area', item);
  }
  const known = new Set(translations.filter((row) => row.sk?.trim()).map((row) => `${row.field}\u0000${normaliseEnglish(row.en)}`));
  const pieces = new Set();
  for (const { field, en } of wanted.values()) for (const item of en.split(/ · |;/)) pieces.add(`${field}\u0000${normaliseEnglish(item)}`);
  const has = (field, en) => known.has(`${field}\u0000${en}`);
  const missing = [...wanted.values()].filter(({ field, en }) => !has(field, en)
    && !en.split(/ · |;/).every((item) => has(field, normaliseEnglish(item))));
  const orphans = translations.filter((row) => !wanted.has(`${row.field}\u0000${normaliseEnglish(row.en)}`)
    && !pieces.has(`${row.field}\u0000${normaliseEnglish(row.en)}`));
  return { missing, orphans };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { missing, orphans } = translationInventory(read('universities.csv'), read('programmes.csv'), read('i18n/sk.csv'));
  console.log(`${missing.length} English data strings need Slovak; ${orphans.length} Slovak rows no longer match current English.`);
  for (const row of missing) console.log(`MISSING ${row.field}: ${row.en}`);
  for (const row of orphans) console.log(`ORPHAN ${row.field}: ${row.en}`);
}
