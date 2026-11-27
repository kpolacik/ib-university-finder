import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { csvToObjects } from '../../js/csv.js';
import { BULLET, readSheets } from '../../js/data.js';
import { DATA_FIELDS, dataParts, normaliseEnglish, setDataTranslations } from '../../js/i18n.js';
import { pointsShort } from '../../js/points.js';
import { translationInventory } from '../i18n-missing.mjs';
import { lintData } from '../lint-data.mjs';

export const TRANSLATED = {
  prog: ['admission', 'english_requirement', 'ib_recognition', 'app_fee_note'],
  uni: ['admission_default', 'english_requirement_default', 'ib_recognition_default', 'app_fee_note_default', 'baseline_requirement'],
};
const CAO_ITEM = 'Places offered in order of CAO points';
const separators = [' \u00b7 ', ';'];
// Match the hard-token test in tools/check.mjs, not the looser prose tokens.
const HARD = [
  /\d+(?:[.,:]\d+)*/g,
  /\b(?:HL|SL|AA|AI|IB|DP|CAO|UCAS|HPAT|UCAT|LNAT|TOL|SAT|ACT|IELTS|TOEFL|DSH|TestDaF|GCSE|CEFR|OMPT|TSP|SJT)\b/g,
  /\b[ABC][12]\b/g, /[\u20ac\u00a3%]/g, /https?:\/\/\S+/g,
];
const equal = isDeepStrictEqual;
const key = (field, en) => JSON.stringify([field, normaliseEnglish(en)]);
const resolve = (field, en) => dataParts(field, en, 'sk');
const hasCoverage = (parts) => parts.some(({ text, missing, en }) => !missing && (en || !/^(?:\u00b7|;)$/.test(text.trim())));
const csvRows = (text, label) => csvToObjects(text, label).rows;
const requireParity = (ok, reason) => { if (!ok) throw new Error(reason); };

export function translatedRefusal(field, old, next) {
  if (normaliseEnglish(old) === normaliseEnglish(next)) return 'normalization-only reword';
  if (field === 'admission' || field === 'admission_default') {
    const sentinels = (text) => text.split(BULLET).map((item) => item.trim()).filter(Boolean)
      .flatMap((item, i) => /^Entrance exam\b/.test(item) ? [[i, 'exam']] : item === CAO_ITEM ? [[i, 'CAO']] : []);
    if (!equal(sentinels(old), sentinels(next))) return 'admission Entrance exam prefix or exact CAO sentinel changed position or count';
    const numerus = (text) => normaliseEnglish(text).match(/\bnumerus fixus\b/gi)?.length || 0;
    if (numerus(old) !== numerus(next)) return 'protected numerus fixus wording changed';
  }
  return '';
}

function validateMove(field, old, next, row, pinned, previous = old) {
  requireParity(row.sk.trim() && row.verified_by === 'AI-DRAFT', `Slovak source must be nonempty AI-DRAFT: ${key(field, old)}`);
  requireParity(!pinned.has(JSON.stringify([field, old.trim(), row.sk])), `pinned Slovak hard-token exception: ${key(field, old)}`);
  const bags = (text) => HARD.map((re) => (text.match(re) || []).sort());
  const counts = (text) => separators.map((sep) => text.split(sep).length);
  requireParity(equal(bags(previous), bags(next)) && equal(bags(next), bags(row.sk)), `Slovak hard tokens changed or disagree: ${key(field, old)}`);
  requireParity(equal(counts(previous), counts(next)) && equal(counts(next), counts(row.sk)), `Slovak separator counts changed or disagree: ${key(field, old)}`);
}

function compareParts(before, after) {
  if (before.en === after.en) return equal(before.parts, after.parts);
  // Revealed English and existing English fallback can change. Compare each
  // part in place so a joined display cannot hide lost item-search coverage.
  const kept = ({ text, missing }) => missing ? { missing } : { text };
  return equal(before.parts.map(kept), after.parts.map(kept));
}

function capture({ universitiesCsv, programmesCsv, translations, today }) {
  setDataTranslations(translations);
  const unis = csvRows(universitiesCsv, 'Universities');
  const progs = csvRows(programmesCsv, 'Programmes');
  const raw = new Map();
  const probe = (field, en) => ({ en, parts: resolve(field, en) });
  for (const [rows, entity, id] of [[unis, 'uni', 'university_id'], [progs, 'prog', 'programme_id']]) {
    rows.forEach((row) => TRANSLATED[entity].forEach((field) => {
      raw.set(`${entity} ${row[id]} ${field}`, probe(field, row[field]));
    }));
  }
  const parsed = new Map();
  for (const row of readSheets(universitiesCsv, programmesCsv, today).programmes) {
    const { admission, englishRequirement, baselineRequirement, ibRecognition, appFeeNote, ...facts } = row;
    const wording = { admission, englishRequirement, baselineRequirement, ibRecognition, appFeeNote };
    const display = Object.entries(DATA_FIELDS).filter(([, prop]) => Object.hasOwn(wording, prop))
      .map(([field, prop]) => [field, probe(field, Array.isArray(row[prop]) ? row[prop].join(BULLET) : row[prop])]);
    // The compact Irish row omits the frozen CAO item; the card still has it.
    display.push(['compact admission', probe('admission', admission.filter((item) => row.country !== 'Ireland' || item !== CAO_ITEM).join(BULLET))]);
    const search = Object.entries(DATA_FIELDS).map(([field, prop]) => [field,
      (Array.isArray(row[prop]) ? row[prop] : [row[prop]]).map((en) => probe(field, en)),
    ]);
    parsed.set(row.id, { facts, points: pointsShort(row), wording, display, search });
  }
  const findings = lintData({ universitiesCsv, programmesCsv, today }).map(({ severity, rule, where, id, message }) => {
    // The quoted maths sentence can change, but its source column is part of
    // the finding's identity. Other findings keep their original description.
    return JSON.stringify([severity, rule, where, id, rule === 'maths-none' ? message.split(' says: "')[0] : message]);
  }).sort();
  return { raw, parsed, findings, unis, progs, inventory: translationInventory(unis, progs, translations) };
}

function verify(before, after, groups) {
  for (const [label, old] of before.raw) {
    requireParity(compareParts(old, after.raw.get(label)), `Slovak raw lookup changed: ${label}`);
  }
  requireParity(before.parsed.size === after.parsed.size, 'parsed programme count changed');
  const signed = new Set(before.progs.filter((row) => row.verified_by !== 'AI-DRAFT').map((row) => row.programme_id));
  for (const [id, old] of before.parsed) {
    const next = after.parsed.get(id);
    requireParity(next && equal(old.facts, next.facts) && equal(old.points, next.points), `parsed facts, same-name identity or points label changed: prog ${id}`);
    requireParity(!signed.has(id) || equal(old.wording, next.wording), `university reword changes effective English on signed prog ${id}`);
    old.display.forEach(([field, probe], i) => {
      requireParity(compareParts(probe, next.display[i][1]), `Slovak card lookup changed: prog ${id} ${field}`);
    });
    old.search.forEach(([field, items], i) => {
      const nextItems = next.search[i][1];
      requireParity(items.length === nextItems.length && items.every((item, i) => compareParts(item, nextItems[i])),
        `Slovak item search changed: prog ${id} ${field}`);
    });
  }
  requireParity(equal(before.findings, after.findings), 'data lint finding identities changed');
  requireParity(equal(before.inventory.orphans, after.inventory.orphans), 'Slovak ORPHAN rows changed');
  const missing = (state) => new Set(state.inventory.missing.map(({ field, en }) => key(field, en)));
  const oldMissing = missing(before), newMissing = missing(after);
  const allowed = new Set(oldMissing);
  for (const pair of oldMissing) {
    if (newMissing.has(pair)) continue;
    const [field] = JSON.parse(pair);
    const stillUsed = [after.unis, after.progs].some((rows) => rows.some((row) => key(field, row[field]) === pair));
    requireParity(groups.has(pair) && !stillUsed, `unchanged MISSING Slovak key disappeared: ${pair}`);
  }
  for (const [source, group] of groups) if (!group.every(({ already }) => already) && oldMissing.has(source)) {
    const { column, value } = group[0];
    const dest = key(column, value);
    requireParity(newMissing.has(dest), `previously missing Slovak key gained inventory coverage: ${dest}`);
    allowed.add(dest);
  }
  const unexpected = [...newMissing].find((pair) => !allowed.has(pair));
  requireParity(!unexpected, `new MISSING Slovak key: ${unexpected}`);
}

export function stageTranslated({ prog, uni, sk, lines, toCsv }) {
  const skRows = csvRows(sk.text, 'Slovak');
  const lookup = new Map();
  skRows.forEach((row, i) => {
    const pair = key(row.field, row.en);
    requireParity(!lookup.has(pair), `duplicate normalized Slovak key: ${pair}`);
    lookup.set(pair, i);
  });
  const groups = new Map(), destinations = new Map();
  for (const line of lines) {
    const source = key(line.column, line.expected_old), dest = key(line.column, line.value);
    if (!groups.has(source)) groups.set(source, []);
    const group = groups.get(source);
    requireParity(!group.length || group[0].value === line.value, `contradictory destinations for ${source}`);
    requireParity(!destinations.has(dest) || destinations.get(dest) === source, `two Slovak sources target ${dest}`);
    group.push(line);
    destinations.set(dest, source);
  }
  const { hardExceptions } = JSON.parse(readFileSync(new URL('../i18n-allowlist.json', import.meta.url), 'utf8'));
  const pinned = new Set(hardExceptions.map(({ field, en, sk }) => JSON.stringify([field, en, sk])));
  const today = new Date();
  const before = capture({ universitiesCsv: uni.text, programmesCsv: prog.text, translations: skRows, today });
  const moves = [];
  for (const [source, group] of groups) {
    const { column, expected_old, value } = group[0];
    const dest = key(column, value);
    const sourceIndex = lookup.get(source), destIndex = lookup.get(dest);
    const occurrences = [prog, uni].flatMap((sheet) => sheet.grid.slice(1).filter((row) => key(column, row[sheet.col[column]]) === source));
    if (group.some(({ already }) => already) && sourceIndex !== undefined) {
      throw new Error(`partial retry: OLD Slovak key still exists: ${source}`);
    }
    if (group.every(({ already }) => already)) {
      if (destIndex !== undefined) {
        requireParity(!occurrences.length && sk.grid[destIndex + 1][sk.col.en] === value, `partial retry: shared OLD still present or NEW key is not exact: ${source}`);
        // A successful rekey no longer has the original English CSV cell.
        validateMove(column, expected_old, value, skRows[destIndex], pinned, value);
      } else {
        requireParity(!hasCoverage(resolve(column, value)), `retry has item-only or default-only Slovak coverage: ${dest}`);
      }
      continue;
    }
    requireParity(destIndex === undefined, `normalized NEW collides with existing Slovak key: ${dest}`);
    if (sourceIndex === undefined) {
      requireParity(!hasCoverage(resolve(column, expected_old)), `OLD has item-only or default-only Slovak coverage: ${source}`);
      continue;
    }
    const moving = new Set(group.map(({ row }) => row));
    requireParity(occurrences.every((row) => moving.has(row)) && occurrences.length === moving.size, `shared OLD not completely moved: ${source}`);
    const rawEn = sk.grid[sourceIndex + 1][sk.col.en];
    validateMove(column, rawEn, value, skRows[sourceIndex], pinned);
    moves.push({ index: sourceIndex + 1, field: column, old: rawEn, next: value });
  }
  for (const { entity_type, row, column, value, already } of lines) {
    if (!already) row[(entity_type === 'prog' ? prog : uni).col[column]] = value;
  }
  for (const { index, next } of moves) sk.grid[index][sk.col.en] = next;
  const outputs = [prog, uni, sk].map(({ path, text, grid }) => ({ path, text, next: toCsv(grid) }));
  const [programmesCsv, universitiesCsv, slovakCsv] = outputs.map(({ next }) => next);
  if (outputs.some(({ text, next }) => text !== next)) {
    verify(before, capture({ universitiesCsv, programmesCsv, translations: csvRows(slovakCsv, 'Slovak'), today }), groups);
  }
  return { outputs: outputs.filter(({ text, next }) => text !== next), moves };
}
