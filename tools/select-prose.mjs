// #17: list research-log cells for Phase 3, in descending university order.
// node tools/select-prose.mjs              > research-log.json
// node tools/select-prose.mjs --mechanical > mechanical.csv
// Mechanical proposals still go through reword-prose.mjs and independent review.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { csvToObjects } from '../js/csv.js';
import { compareTokens, formatProblem, frozenParts } from './lib/reword.mjs';

const COLUMNS = ['deadline_notes', 'other_requirements', 'ib_subjects'];
const SIGNALS = [
  ['retrieval', /\bas of \d|\b(?:read|checked|accessed|retrieved|fetched) (?:on )?\d{4}-\d{2}-\d{2}/i],
  ['fetch', /\b(?:check manually|loads? (?:its )?dates? by script|javascript|could not (?:load|retrieve|verify|confirm|find)|not found|not read|returned no dates|blocked by Microsoft sign-in|was shown closed on)\b/i],
  ['source page', /\b(?:course|programme|source|faculty|admissions?|fees?|tuition|landing|UCAS|IB|university|deadline|how-to-apply|entry requirements) pages?\b|\bIB table\b|\bpage:|\b(?:the page|website|webpage|listing) (?:lists?|says?|prints?|shows?|states?|gives?|labels?)\b/i],
  ['catalogue narration', /\bnot used here\b/i],
  ['quotation', /"[^"]+"|“[^”]+”|‘[^’]+’|(?:^|[\s(])'[^']+\s[^']+'(?=$|[\s).,;:])/],
  ['source link', /\b(?:https?:\/\/|www\.)/i],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthNames = [...MONTHS, 'Sept', ...MONTHS.filter((name) => name.length > 3).map((name) => name.slice(0, 3))];
const DAY_RANGE = new RegExp(`(?<![\\w./-])(\\d{1,2}) *[-–] *(\\d{1,2}) +(${monthNames.join('|')})\\b`, 'g');
// Compact ranges and the wording of an ECB conversion keep their original dates.
const ISO_DATE = /(?<![\w/–—-])(?<!ECB (?:reference )?rate of )(\d{4})-(\d{2})-(\d{2})(?![\w/–—-])/g;
const STALE_SUFFIX = /Last year's date; the 2027\/28 date is not yet published\.$/;

export function researchSignals(value) {
  return SIGNALS.filter(([, pattern]) => pattern.test(value)).map(([signal]) => signal);
}

export function mechanicalValue(column, value) {
  if (researchSignals(value).length || STALE_SUFFIX.test(value)) return value;
  const next = value
    .replace(/ {2,}/g, ' ')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(ISO_DATE, (match, year, month, day) => {
      const parsed = new Date(`${match}T00:00:00Z`);
      if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== match) return match;
      return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
    })
    .replace(DAY_RANGE, (match, start, end, month) => {
      if (+start < 1 || +end > 31 || +start > +end) return match;
      const full = MONTHS.find((name) => name.startsWith(month));
      return `${start}–${end} ${full}`;
    });
  if (next === value || formatProblem(next)) return value;
  if (JSON.stringify(frozenParts(column, next)) !== JSON.stringify(frozenParts(column, value))) return value;
  const { added, missing } = compareTokens(value, next);
  return added.length || missing.length ? value : next;
}

function main(mode) {
  if ((mode !== undefined && mode !== '--mechanical') || process.argv.length > 3) {
    throw new Error('Usage: node tools/select-prose.mjs [--mechanical]');
  }
  const csv = new URL('../data/programmes.csv', import.meta.url);
  const { rows, header, issues } = csvToObjects(readFileSync(csv, 'utf8'), 'programmes.csv');
  if (issues.length || !rows.length || !['programme_id', 'university_id', 'verified_by', ...COLUMNS].every((column) => header.includes(column))) {
    throw new Error(`Invalid programmes.csv: ${issues.join('; ') || 'missing rows or columns'}`);
  }

  if (mode === '--mechanical') {
    const esc = (value) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    console.log('entity_type,id,column,expected_old,value,reason,drops');
    for (const row of rows) {
      if (row.verified_by !== 'AI-DRAFT') continue;
      for (const column of COLUMNS) {
        const old = row[column];
        const next = mechanicalValue(column, old);
        if (next !== old) {
          console.log(['prog', row.programme_id, column, old, next, 'Normalise spacing, punctuation or date style', ''].map(esc).join(','));
        }
      }
    }
    return;
  }

  const universities = new Map();
  let total = 0;
  for (const row of rows) {
    if (row.verified_by !== 'AI-DRAFT') continue;
    for (const column of COLUMNS) {
      const signals = researchSignals(row[column]);
      if (!signals.length) continue;
      if (!universities.has(row.university_id)) universities.set(row.university_id, []);
      universities.get(row.university_id).push({ id: row.programme_id, column, signals });
      total++;
    }
  }
  const groups = [...universities].sort(([a, left], [b, right]) => right.length - left.length || a.localeCompare(b, 'en'));
  console.log(JSON.stringify({
    total,
    universities: groups.map(([id, cells]) => ({ id, count: cells.length, cells })),
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv[2]);
