// Appends independently reviewed Slovak translations for prose columns to
// data/i18n/sk.csv (issue #18: requirement and deadline prose), whole
// cells of living_cost_source and baseline_requirement (Layer 2A), and
// single-bullet english_requirement cells (Layer 2B-1).
//
// Why this exists: tools/add-sk-rows.mjs only handles the four PR2 fee/recognition
// columns, checks raw whole strings only, and has no review, hard-token,
// separator or held-cell guards. Bulk prose translation needs every key to match
// how js/i18n.js dataParts() actually looks up live non-held displays, while
// refusing any key that a held #17 cell can read (whole, piece or compact
// cross-field) and refusing any change to hard tokens or separators.
//
//   node tools/apply-sk-translations.mjs [--data DIR] batch.csv
//       dry run, writes nothing
//   node tools/apply-sk-translations.mjs --apply --review review.csv [--data DIR] batch.csv
//       appends approved AI-DRAFT rows to DIR/i18n/sk.csv (default: data/)
//
// Input CSVs:
//   batch.csv   exact header: field,en,sk
//   review.csv  exact header: field,en,sk,verdict
//
// Exit codes: 0 clean (or dry run with 0 refusals), 2 at least one line refused
// (nothing written), 1 bad arguments, unreadable/malformed files, conflicting
// review verdicts, or atomic write failure.
//
// programmes.csv and universities.csv are read-only inputs; only sk.csv is
// appended, atomically through a temp file and rename. After a real --apply run
// node tools/make-snapshot.mjs and node tools/check.mjs.
import { readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { csvToObjects, parseCsv } from '../js/csv.js';
import { readSheets } from '../js/data.js';
import { DATA_FIELDS, normaliseEnglish } from '../js/i18n.js';
import { appliedCells, selectResearchCells } from './select-prose.mjs';

export const PROSE_FIELDS = ['ib_subjects', 'other_requirements', 'deadline_notes'];
// Issue #18 Layer 2A: university text copied onto each programme. Only the
// whole cell is a key. A piece key would make dataParts() translate a
// semicolon cell item by item, and the detail view capitalises every piece
// of baseline_requirement (js/render.js dataValue), mid-sentence included.
// Kept apart from PROSE_FIELDS: sk.csv already holds eight baseline rows for
// held UK cells, which the prose guard in tools/check.mjs would reject.
export const WHOLE_CELL_DATA_FIELDS = ['living_cost_source', 'baseline_requirement'];
// Issue #18 Layer 2B-1: a programme's English requirement when it shows one
// bullet. A row is stored under the physical column the text comes from:
// english_requirement for a programme's own wording, english_requirement_default
// for university wording the programme inherits (js/i18n.js dataParts reads
// both). Only the whole shown cell is a key. Multi-bullet cells and university
// defaults no programme shows are never keys. Not in WHOLE_CELL_PROPS: that map
// assumes university-level text, and this one is programme-level with inheritance.
export const SINGLE_BULLET_FIELDS = ['english_requirement', 'english_requirement_default'];
export const SUPPORTED_FIELDS = [...PROSE_FIELDS, ...WHOLE_CELL_DATA_FIELDS, ...SINGLE_BULLET_FIELDS];
const WHOLE_CELL_PROPS = { living_cost_source: 'livingCostSource', baseline_requirement: 'baselineRequirement' };

// Pinned non-selector holds (23 cells) that sit beside the live
// selectResearchCells() output. A key read by any held cell's display is
// refused even when unheld programmes share the same English text.
export const NON_SELECTOR_HOLDS = [
  // K8 (#17 REST-2): deadline note held pending English source/wording resolution.
  { entity: 'prog', id: 'tul-anglophone-studies', column: 'deadline_notes', label: 'K8' },
  // P4b G001 (#17 Phase 4b): MUNI paramedic practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-paramedic-practice', column: 'admission', label: 'P4b G001' },
  // P4b G002 (#17 Phase 4b): MUNI sports/physiotherapy practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-physiotherapy', column: 'admission', label: 'P4b G002' },
  // P4b G002 (#17 Phase 4b): MUNI physical activity practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-physical-acitivity-and-health', column: 'admission', label: 'P4b G002' },
  // P4b G002 (#17 Phase 4b): MUNI sports management practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-sports-management', column: 'admission', label: 'P4b G002' },
  // P4b G002 (#17 Phase 4b): MUNI PE and sport practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-physical-education-and-sport', column: 'admission', label: 'P4b G002' },
  // P4b G002 (#17 Phase 4b): MUNI physical training practical/talent exam admission wording held.
  { entity: 'prog', id: 'muni-physical-training', column: 'admission', label: 'P4b G002' },
  // P4b G007 (#17 Phase 4b): SAMK physiotherapy admission note reports intake 0 / unclear.
  { entity: 'prog', id: 'samk-physiotherapy', column: 'admission', label: 'P4b G007' },
  // P4b G013 (#17 Phase 4b): Comenius history teaching admission source-page note held.
  { entity: 'prog', id: 'comenius-fedu-ucitelstvo-historie', column: 'admission', label: 'P4b G013' },
  // P4b G023 (#17 Phase 4b): Birmingham UCAS admission_default wording held.
  { entity: 'uni', id: 'birmingham', column: 'admission_default', label: 'P4b G023' },
  // P4b G029 (#17 Phase 4b): Leeds UCAS admission_default wording held.
  { entity: 'uni', id: 'leeds', column: 'admission_default', label: 'P4b G029' },
  // P4b G030 (#17 Phase 4b): Manchester UCAS admission_default wording held.
  { entity: 'uni', id: 'manchester', column: 'admission_default', label: 'P4b G030' },
  // P4b G056 (#17 Phase 4b): Birmingham IB baseline_requirement wording held.
  { entity: 'uni', id: 'birmingham', column: 'baseline_requirement', label: 'P4b G056' },
  // P4b G059 (#17 Phase 4b): Leeds IB baseline_requirement held (repair review lacked both full texts).
  { entity: 'uni', id: 'leeds', column: 'baseline_requirement', label: 'P4b G059' },
  // P4b G063 (#17 Phase 4b): MUNI Portuguese Czech-B2 english_requirement note held.
  { entity: 'prog', id: 'muni-portuguese-language-and-literature', column: 'english_requirement', label: 'P4b G063' },
  // P4b G064 (#17 Phase 4b): MUNI computational linguistics Czech-C1 english_requirement note held.
  { entity: 'prog', id: 'muni-computational-linguistics', column: 'english_requirement', label: 'P4b G064' },
  // P4b G065 (#17 Phase 4b): TUL European Business english_requirement certificate note held.
  { entity: 'prog', id: 'tul-european-business', column: 'english_requirement', label: 'P4b G065' },
  // carry-for-18: Bath UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'bath', column: 'baseline_requirement', label: 'carry-for-18' },
  // carry-for-18: Exeter UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'exeter', column: 'baseline_requirement', label: 'carry-for-18' },
  // carry-for-18: Glasgow UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'glasgow', column: 'baseline_requirement', label: 'carry-for-18' },
  // carry-for-18: Sheffield UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'sheffield', column: 'baseline_requirement', label: 'carry-for-18' },
  // carry-for-18: Southampton UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'southampton', column: 'baseline_requirement', label: 'carry-for-18' },
  // carry-for-18: St Andrews UK baseline_requirement held for Layer 2 update mode.
  { entity: 'uni', id: 'st-andrews', column: 'baseline_requirement', label: 'carry-for-18' },
];

// Layer 2A exclusions reference internal evidence and need source wording work in #17.
const LAYER2A_HOLDS = [
  ['stu', 'L2A-017'], ['jcu', 'L2A-027'], ['tul', 'L2A-035'], ['avans', 'L2A-079'],
].map(([id, label]) => ({ entity: 'uni', id, column: 'baseline_requirement', label }));

const BATCH_HEADER = ['field', 'en', 'sk'];
const REVIEW_HEADER = ['field', 'en', 'sk', 'verdict'];
const DEFAULT_CAPABLE = ['admission', 'english_requirement', 'ib_recognition', 'app_fee_note'];
const CROSS_FIELD_PROSE = ['ib_subjects', 'other_requirements'];
const SPLIT = /( · |;\s*)/;

// Exact copy of tools/check.mjs:7787-7792 (and :7796 for separators), with no
// hardExceptions allowlist for newly added prose translations.
const HARD = [
  /\d+(?:[.,:]\d+)*/g,
  /\b(?:HL|SL|AA|AI|IB|DP|CAO|UCAS|HPAT|UCAT|LNAT|TOL|SAT|ACT|IELTS|TOEFL|DSH|TestDaF|GCSE|CEFR|OMPT|TSP|SJT)\b/g,
  /\b[ABC][12]\b/g, /[€£%]/g, /https?:\/\/\S+/g,
];
// Layer 2B-1 only (SINGLE_BULLET_FIELDS): language test names and the >= and +
// signs of scores such as "B2+" or "IELTS >= 6.0" must survive verbatim. Kept
// apart from HARD, which must match tools/check.mjs for every older row (four
// older sk.csv rows would fail this bag). Unicode lookarounds instead of \b so
// ÚJOP, VŠP, MŠMT and the two-word EF SET match as whole tokens.
const TEST_NAMES = [
  'PTE', 'Duolingo', 'Cambridge', 'CAE', 'CPE', 'FCE', 'TOEIC', 'iBT', 'ITP', 'PBT', 'UKVI', 'LanguageCert',
  'Linguaskill', 'ELLT', 'OET', 'telc', 'TELC', 'Unicert', 'UNIcert', 'EF SET', 'YKI', 'ESOL', 'SCIO', 'Scio',
  'OSP', 'VŠP', 'ÚJOP', 'MŠMT', 'IMAT', 'ACRES', 'MOI', 'SERR', 'CLA',
];
const SINGLE_BULLET_HARD = [
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${TEST_NAMES.join('|')})(?![\\p{L}\\p{N}])`, 'gu'),
  /[≥+]/g,
];
const bag = (text, re) => (text.match(re) || []).sort().join('|');
export function translationTextProblem(en, sk, field = '') {
  if (HARD.some((re) => bag(en, re) !== bag(sk, re))) {
    return `hard tokens differ between English and Slovak for ${JSON.stringify(en)}`;
  }
  if (SINGLE_BULLET_FIELDS.includes(field) && SINGLE_BULLET_HARD.some((re) => bag(en, re) !== bag(sk, re))) {
    return `test names or the ≥ and + signs differ between English and Slovak for ${JSON.stringify(en)}`;
  }
  if ([' · ', ';'].some((sep) => en.split(sep).length !== sk.split(sep).length)) {
    return `separator counts (' · ' or ';') differ for ${JSON.stringify(en)}`;
  }
  return '';
}
const esc = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const pairKey = (field, en) => `${field}\u0000${en}`;
// The other physical name of an English requirement key, or null.
export const twinField = (field) => SINGLE_BULLET_FIELDS.includes(field)
  ? SINGLE_BULLET_FIELDS.find((f) => f !== field) : null;
const reviewKey = (field, en, sk) => JSON.stringify([field, en, sk]);

function textKeys(text) {
  const whole = normaliseEnglish(text);
  if (!whole) return [];
  const out = [whole];
  if (/ · |;/.test(whole)) {
    for (const [i, piece] of whole.split(SPLIT).filter(Boolean).entries()) {
      if (i % 2 === 0) {
        const norm = normaliseEnglish(piece);
        if (norm) out.push(norm);
      }
    }
  }
  return out;
}

export function loadSelectorBatches() {
  const batchDir = new URL('./prose-batches/', import.meta.url);
  return readdirSync(batchDir)
    .filter((name) => /^phase-3-.*\.csv$/.test(name))
    .sort()
    .map((name) => readFileSync(new URL(name, batchDir), 'utf8'));
}

// Runtime surfaces that render a programme's fields (pre- and post-compact fix).
function rowSurfaces(row, compactSplit) {
  const s = [];
  const add = (field, text, sources) => { if (text) s.push({ field, text, sources }); };
  const others = row.otherRequirements;
  if (compactSplit) {
    add('ib_subjects', row.ibSubjects, ['ib_subjects']);
    add('other_requirements', others.join(' · '), ['other_requirements']);
  } else {
    add('ib_subjects', [row.ibSubjects, ...others].filter(Boolean).join(' · '), ['ib_subjects', 'other_requirements']);
  }
  add('admission', row.admission.filter((t) => !(row.country === 'Ireland' && t === 'Places offered in order of CAO points')).join(' · '), ['admission', 'admission_default']);
  const nothingAtAll = row.ibPointsMin === null && row.noSubjectsRequired && others.length === 0 && row.englishRequirement.length === 0
    && !row.englishUnknown && row.admission.length === 0 && !row.admissionUnknown;
  const oneShort = others.length === 1 && others[0].length <= 32;
  if (oneShort) add('other_requirements', others[0], ['other_requirements']);
  else add('other_requirements', others.join(' · '), ['other_requirements']);
  if (!nothingAtAll && !row.noSubjectsRequired) add('ib_subjects', row.ibSubjects, ['ib_subjects']);
  add('deadline_notes', row.deadlineNotes, ['deadline_notes']);
  add('english_requirement', row.englishRequirement.join(' · '), ['english_requirement', 'english_requirement_default']);
  add('admission', row.admission.join(' · '), ['admission', 'admission_default']);
  add('baseline_requirement', row.baselineRequirement, ['baseline_requirement']);
  add('ib_recognition', row.ibRecognition, ['ib_recognition', 'ib_recognition_default']);
  add('app_fee_note', row.appFeeNote, ['app_fee_note', 'app_fee_note_default']);
  add('application_system', row.applicationSystem, ['application_system']);
  add('living_cost_source', row.livingCostSource, ['living_cost_source']);
  add('degree_type', row.degreeType, ['degree_type']);
  for (const [field, prop] of Object.entries(DATA_FIELDS)) {
    const vals = Array.isArray(row[prop]) ? row[prop] : [row[prop]];
    for (const v of vals) add(field, v, [field, `${field}_default`]);
  }
  return s;
}

function collectHeldCells(progRaw, batchTexts, extraHolds) {
  const held = new Map();
  const selected = selectResearchCells(progRaw, appliedCells(batchTexts));
  for (const uni of selected.universities) {
    for (const cell of uni.cells) held.set(`prog|${cell.id}|${cell.column}`, 'selector');
  }
  for (const cell of extraHolds) {
    const k = `${cell.entity}|${cell.id}|${cell.column}`;
    if (!held.has(k)) held.set(k, cell.label);
  }
  return held;
}

// Returns Map<`${field}\0${en}`, Set<string>> of every lookup key that any held
// cell's display can read (whole, piece, _default twin, or ib_subjects /
// other_requirements cross-field). Used by both the writer and tools/check.mjs.
export function heldDisplayKeys({
  universitiesCsv,
  programmesCsv,
  batchTexts = loadSelectorBatches(),
  extraHolds = [...NON_SELECTOR_HOLDS, ...LAYER2A_HOLDS],
  today = new Date(),
}) {
  const { rows: progRaw, issues: progIssues } = csvToObjects(programmesCsv, 'programmes.csv');
  if (progIssues.length) throw new Error(`Invalid programmes.csv: ${progIssues.join('; ')}`);
  // Raw university rows: a default no programme inherits is in no built row,
  // but a whole key equal to one of its pieces would translate it later.
  const { rows: uniRaw, issues: uniIssues } = csvToObjects(universitiesCsv, 'universities.csv');
  if (uniIssues.length) throw new Error(`Invalid universities.csv: ${uniIssues.join('; ')}`);
  const built = readSheets(universitiesCsv, programmesCsv, today);
  // The UI can display a partial sheet. A missing programme can hide a held
  // use of wording shared with a programme that did load.
  if (built.programmes.length !== progRaw.length) {
    throw new Error(`Cannot check held cells: readSheets skipped programme rows. ${built.issues.join('; ')}`);
  }
  const heldCells = collectHeldCells(progRaw, batchTexts, extraHolds);
  const heldKeys = new Map();
  const record = (field, text, sourceLabel) => {
    const fields = DEFAULT_CAPABLE.includes(field)
      ? [field, `${field}_default`]
      : CROSS_FIELD_PROSE.includes(field) ? CROSS_FIELD_PROSE : [field];
    for (const en of textKeys(text)) {
      for (const f of fields) {
        const k = pairKey(f, en);
        if (!heldKeys.has(k)) heldKeys.set(k, new Set());
        heldKeys.get(k).add(sourceLabel);
      }
    }
  };
  for (const [cellId, label] of heldCells) {
    const [entity, id, column] = cellId.split('|');
    const matches = entity === 'prog'
      ? built.programmes.filter((r) => r.id === id)
      : built.programmes.filter((r) => r.universityId === id);
    for (const compactSplit of [false, true]) {
      for (const row of matches) {
        for (const s of rowSurfaces(row, compactSplit)) {
          if (s.sources.includes(column)) record(s.field, s.text, `${cellId} (${label})`);
        }
      }
    }
  }
  return { heldCells, heldKeys, programmes: built.programmes, progRaw, uniRaw };
}

// Every held cell that reads one of en's own ' · ' or ';' pieces, under either
// English requirement name. Refusal 3 checks the whole key only; a new whole
// containing held #17 wording (P4b G065 "English B2") must not translate it.
export function heldPieceLabels(en, heldKeys) {
  const labels = new Set();
  for (const piece of textKeys(en).slice(1)) {
    for (const f of SINGLE_BULLET_FIELDS) for (const label of heldKeys.get(pairKey(f, piece)) || []) labels.add(label);
  }
  return [...labels].sort();
}

// A semicolon slot of a new whole whose English already has a Slovak row keeps
// that Slovak exactly: students can search those words today, and changing a
// historic translation needs its own decision. existing(key) returns the
// sk.csv row for a pair key, or undefined. Empty slots (a trailing ';') skip.
export function historicSlotProblem(en, sk, existing) {
  if (!en.includes(';')) return '';
  const skSlots = sk.split(';');
  for (const [i, slot] of en.split(';').entries()) {
    const piece = normaliseEnglish(slot);
    if (!piece) continue;
    for (const f of SINGLE_BULLET_FIELDS) {
      const row = existing(pairKey(f, piece));
      if (row && (skSlots[i] ?? '').trim() !== row.sk.trim()) {
        return `changes existing Slovak ${JSON.stringify(row.sk)} for the piece ${JSON.stringify(piece)} (${f}); needs a separate decision`;
      }
    }
  }
  return '';
}

export function liveDisplayKeys(programmes, heldCells, progRaw = null) {
  const live = new Set();
  const usable = (en) => en && en !== '?' && en !== 'none';
  const rawById = progRaw && new Map(progRaw.map((r) => [String(r.programme_id ?? '').trim(), r]));
  const add = (field, text) => {
    for (const en of textKeys(text)) {
      if (usable(en)) live.add(pairKey(field, en));
    }
  };
  for (const row of programmes) {
    if (!heldCells.has(`prog|${row.id}|ib_subjects`) && row.ibSubjects) {
      add('ib_subjects', row.ibSubjects);
    }
    if (!heldCells.has(`prog|${row.id}|other_requirements`) && row.otherRequirements.length) {
      const others = row.otherRequirements;
      add('other_requirements', others.join(' · '));
      if (others.length === 1 && others[0].length <= 32) add('other_requirements', others[0]);
    }
    if (!heldCells.has(`prog|${row.id}|deadline_notes`) && row.deadlineNotes) {
      add('deadline_notes', row.deadlineNotes);
    }
    for (const [field, prop] of Object.entries(WHOLE_CELL_PROPS)) {
      const en = normaliseEnglish(row[prop]);
      if (usable(en) && !heldCells.has(`uni|${row.universityId}|${field}`) && !heldCells.has(`prog|${row.id}|${field}`)) {
        live.add(pairKey(field, en));
      }
    }
    // Layer 2B-1: one shown bullet, under the column its text comes from. With
    // no raw rows the physical column is unknown, so no key is live.
    const raw = rawById?.get(row.id);
    if (raw && row.englishRequirement.length === 1
      && !heldCells.has(`prog|${row.id}|english_requirement`)
      && !heldCells.has(`uni|${row.universityId}|english_requirement_default`)) {
      const own = String(raw.english_requirement ?? '').trim();
      const en = normaliseEnglish(row.englishRequirement[0]);
      // dataParts can expose a bullet separator after normalising whitespace.
      if (own !== '?' && usable(en) && !en.includes(' · ')) {
        live.add(pairKey(own ? 'english_requirement' : 'english_requirement_default', en));
      }
    }
  }
  return live;
}

// Map<`${field}\0${piece}`, Set<id>> of every ' · ' or ';' piece of a
// whole-cell field, held or not (university ids), and of every English
// requirement text (programme or university ids). dataParts() falls back to
// piece lookups, so a whole key admitted for one cell could otherwise translate
// part of another cell that happens to contain it as an item.
//
// English requirement leaves sit under both physical names, because dataParts
// reads both. They cover pieces of every shown cell, every raw programme value
// and every university default (one no programme inherits included, from
// uniRaw), plus each whole bullet item of a multi-bullet text: search and the
// detail view look bullet items up whole, and an item can itself contain ';'.
export function wholeCellLeaves(programmes, { progRaw = [], uniRaw = [] } = {}) {
  const leaves = new Map();
  const leaf = (field, piece, id) => {
    const k = pairKey(field, piece);
    if (!leaves.has(k)) leaves.set(k, new Set());
    leaves.get(k).add(id);
  };
  const englishLeaves = (text, id) => {
    const pieces = textKeys(text).slice(1);
    const items = String(text ?? '').split(' · ');
    if (items.length > 1) for (const item of items) { const norm = normaliseEnglish(item); if (norm) pieces.push(norm); }
    for (const piece of pieces) for (const f of SINGLE_BULLET_FIELDS) leaf(f, piece, id);
  };
  for (const row of programmes) {
    for (const [field, prop] of Object.entries(WHOLE_CELL_PROPS)) {
      for (const piece of textKeys(row[prop]).slice(1)) leaf(field, piece, row.universityId);
    }
    englishLeaves(row.englishRequirement.join(' · '), row.id);
  }
  for (const raw of progRaw) {
    const own = String(raw.english_requirement ?? '').trim();
    if (own && own !== '?') englishLeaves(own, String(raw.programme_id ?? '').trim());
  }
  for (const raw of uniRaw) {
    const text = String(raw.english_requirement_default ?? '').trim();
    if (text && text !== '?') englishLeaves(text, String(raw.university_id ?? '').trim());
  }
  return leaves;
}

// Strict line-aware CSV reader (same guard as tools/reword-prose.mjs:138-160),
// so a malformed quote in a batch or review file fails cleanly with exit 1.
function records(file, raw, fail) {
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const out = [];
  let start = 0, line = 1, startLine = 1, inQuotes = false;
  for (let i = 0; i <= raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (i === raw.length || (ch === '\n' && !inQuotes)) {
      const part = raw.slice(start, i).replace(/\r$/, '');
      if (part.trim()) {
        // parseCsv strips a file BOM. Passing it one record must not turn a
        // different review field into an exact match after the header.
        if (part.startsWith('\uFEFF')) fail(`${file}:${startLine}: unexpected BOM inside CSV`);
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

export function readTranslationDictionary(file, text, fail) {
  const [head, ...rows] = records(file, text, fail);
  if (!head || head.cells.length !== 4 || head.cells.join(',') !== 'field,en,sk,verified_by') {
    fail(`${file}: unexpected header (expected field,en,sk,verified_by)`);
  }
  const dictionary = new Map();
  for (const { line, cells } of rows) {
    if (cells.length !== 4) fail(`${file}:${line}: expected 4 columns, got ${cells.length}`);
    const [field, en, sk, verifiedBy] = cells;
    // Match the live loader's lookup key, while preserving exact reviewed text.
    const k = pairKey(field.trim(), normaliseEnglish(en));
    if (dictionary.has(k)) fail(`${file}:${line}: duplicate normalised key ${field} ${JSON.stringify(en)}`);
    dictionary.set(k, { field, en, sk, verifiedBy });
  }
  return dictionary;
}

export function readTranslationReviews(file, text, fail) {
  const [head, ...rows] = records(file, text, fail);
  if (!head || head.cells.length !== REVIEW_HEADER.length || REVIEW_HEADER.some((h, i) => head.cells[i] !== h)) {
    fail(`${file}: the header must be exactly ${REVIEW_HEADER.join(',')}`);
  }
  const reviews = new Map();
  const reviewsByNorm = new Map();
  const keptByPair = new Map();
  for (const { line, cells } of rows) {
    if (cells.length !== REVIEW_HEADER.length) {
      fail(`${file}:${line}: expected ${REVIEW_HEADER.length} columns, got ${cells.length}`);
    }
    const [field, en, sk, verdict] = cells;
    const rKey = reviewKey(field, en, sk);
    const normKey = reviewKey(field, normaliseEnglish(en), sk);
    const prev = reviewsByNorm.get(normKey);
    if (prev && prev.verdict !== verdict) {
      fail(`${file}:${line}: conflicting review verdicts (${JSON.stringify(prev.verdict)} vs ${JSON.stringify(verdict)}) for ${field} ${JSON.stringify(en)}`);
    }
    const review = { field, en, sk, verdict, line };
    reviews.set(rKey, review);
    reviewsByNorm.set(normKey, review);
    if (verdict === 'keep') {
      const pKey = pairKey(field, normaliseEnglish(en));
      const prevKept = keptByPair.get(pKey);
      if (prevKept !== undefined && prevKept !== sk) {
        fail(`${file}:${line}: conflicting keep review rows for ${field} ${JSON.stringify(en)}`);
      }
      keptByPair.set(pKey, sk);
    }
  }
  return reviews;
}

function main(argv) {
  const fail = (message) => { console.error(message); process.exit(1); };
  const usage = () => fail('Usage: node tools/apply-sk-translations.mjs [--apply --review review.csv] [--data DIR] batch.csv');

  const root = fileURLToPath(new URL('../', import.meta.url));
  let apply = false;
  let dataDir = join(root, 'data');
  let reviewFile = '';
  const batchFiles = [];
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
  if (batchFiles.length !== 1) usage();
  if (apply && !reviewFile) fail('--apply needs --review FILE: every translation row requires an independent keep review.');
  const batchFile = batchFiles[0];

  // Read-only inputs: universities.csv, programmes.csv, and existing i18n/sk.csv.
  const readUtf8 = (path) => {
    try { return readFileSync(path, 'utf8'); } catch (e) { fail(`Cannot read ${path}: ${e.message}`); }
  };
  const uniText = readUtf8(join(dataDir, 'universities.csv'));
  const progText = readUtf8(join(dataDir, 'programmes.csv'));
  const skPath = join(dataDir, 'i18n/sk.csv');
  let skBytes;
  try { skBytes = readFileSync(skPath); } catch (e) { fail(`Cannot read ${skPath}: ${e.message}`); }
  const existingSk = readTranslationDictionary(skPath, skBytes.toString('utf8'), fail);

  let heldCells, heldKeys, programmes, progRaw, uniRaw;
  try {
    ({ heldCells, heldKeys, programmes, progRaw, uniRaw } = heldDisplayKeys({ universitiesCsv: uniText, programmesCsv: progText }));
  } catch (e) {
    fail(e.message);
  }
  const liveKeys = liveDisplayKeys(programmes, heldCells, progRaw);
  const leaves = wholeCellLeaves(programmes, { progRaw, uniRaw });

  // Parse batch CSV (exact header: field,en,sk).
  const [batchHead, ...batchRows] = records(batchFile, readUtf8(batchFile), fail);
  if (!batchHead || batchHead.cells.length !== BATCH_HEADER.length || BATCH_HEADER.some((h, i) => batchHead.cells[i] !== h)) {
    fail(`${batchFile}: the header must be exactly ${BATCH_HEADER.join(',')}`);
  }

  const reviews = reviewFile ? readTranslationReviews(reviewFile, readUtf8(reviewFile), fail) : new Map();

  const batchSeen = new Set();
  const add = [];
  let skips = 0;
  let refusals = 0;

  for (const r of batchRows) {
    const field = r.cells[0] ?? '';
    const en = r.cells[1] ?? '';
    const sk = r.cells[2] ?? '';
    const where = `${batchFile}:${r.line} ${field || '(no field)'}`;
    const refuse = (why) => { refusals++; console.log(`REFUSE ${where}: ${why}`); };

    if (r.cells.length !== BATCH_HEADER.length) {
      refuse(`expected ${BATCH_HEADER.length} columns, got ${r.cells.length}`);
      continue;
    }
    // Refusal 1: supported field, non-empty sk, normalised en, not ? or none.
    if (!SUPPORTED_FIELDS.includes(field)) {
      refuse(`unsupported field ${JSON.stringify(field)} (only ${SUPPORTED_FIELDS.join(', ')})`);
      continue;
    }
    if (!sk.trim()) {
      refuse('the Slovak text is empty');
      continue;
    }
    if (!en || en !== normaliseEnglish(en)) {
      refuse(`English key must be non-empty and normalised: ${JSON.stringify(en)}`);
      continue;
    }
    if (en === '?' || en === 'none') {
      refuse(`marker value ${JSON.stringify(en)} cannot be translated`);
      continue;
    }

    const pKey = pairKey(field, en);

    // Refusal 3 (checked before live so held-only keys still name the held cell):
    // key read by any held cell's display (whole, piece, or cross-field).
    const heldBy = heldKeys.get(pKey);
    if (heldBy) {
      refuse(`key is read by held cell ${[...heldBy].sort().join(', ')}`);
      continue;
    }
    const single = SINGLE_BULLET_FIELDS.includes(field);

    // Refusal 3b: an English requirement whole whose own piece a held cell reads.
    const heldPieces = single ? heldPieceLabels(en, heldKeys) : [];
    if (heldPieces.length) {
      refuse(`a piece of this key is read by held cell ${heldPieces.join(', ')}`);
      continue;
    }

    // Refusal 2: live lookup key for that field on non-held programmes.
    if (!liveKeys.has(pKey)) {
      refuse(`not a live lookup key for ${field}: ${JSON.stringify(en)}`);
      continue;
    }

    // Refusal 2b: a whole-cell key that is also a piece of another cell of the
    // same field would translate part of that cell too (see wholeCellLeaves).
    const leafOf = (WHOLE_CELL_DATA_FIELDS.includes(field) || single) && leaves.get(pKey);
    if (leafOf) {
      refuse(`key is also a ${field} piece at ${[...leafOf].sort().join(', ')}: ${JSON.stringify(en)}`);
      continue;
    }

    // Refusal 4: duplicate in batch, or existing sk.csv row with different sk.
    if (batchSeen.has(pKey)) {
      refuse(`duplicate (${field}, en) within batch: ${JSON.stringify(en)}`);
      continue;
    }
    batchSeen.add(pKey);

    const existing = existingSk.get(pKey);
    if (existing && existing.sk !== sk) {
      refuse(`sk.csv already has a different translation for ${JSON.stringify(en)}`);
      continue;
    }

    // Refusal 4b: the same English under the other English requirement name.
    // dataParts reads english_requirement first and search maps both names to
    // one key, so a second row would silently win or collide.
    const twin = single && pairKey(twinField(field), en);
    if (twin && (existingSk.has(twin) || batchSeen.has(twin) || liveKeys.has(twin))) {
      refuse(`the same English is also a ${twinField(field)} key (in sk.csv, this batch or a live cell): ${JSON.stringify(en)}`);
      continue;
    }

    // Refusal 5: hard-token bags and separator counts (' · ' and ';'), plus
    // test names and the ≥ and + signs for English requirement keys.
    const textProblem = translationTextProblem(en, sk, field);
    if (textProblem) {
      refuse(textProblem);
      continue;
    }

    // Refusal 5b: a semicolon slot with an existing Slovak row keeps that Slovak.
    const slotProblem = single ? historicSlotProblem(en, sk, (k) => existingSk.get(k)) : '';
    if (slotProblem) {
      refuse(slotProblem);
      continue;
    }
    if (existing) {
      skips++;
      console.log(`SKIP ${where}: already in sk.csv with identical Slovak (${JSON.stringify(en)})`);
      continue;
    }

    // Refusal 6: in --apply mode, every non-SKIP line needs an exact keep review.
    if (apply) {
      const rev = reviews.get(reviewKey(field, en, sk));
      if (!rev) {
        refuse(`no review row for exact (${field}, en, sk): ${JSON.stringify(en)}`);
        continue;
      }
      if (rev.verdict !== 'keep') {
        refuse(`review verdict is ${JSON.stringify(rev.verdict)}, not "keep"`);
        continue;
      }
    }

    add.push([field, en, sk, 'AI-DRAFT']);
    console.log(`ADD ${field}: ${JSON.stringify(en)} -> ${JSON.stringify(sk)}`);
  }

  console.log(`\nLines read: ${batchRows.length}`);
  console.log(`To add: ${add.length}`);
  console.log(`Skipped: ${skips}`);
  console.log(`Refused: ${refusals}`);

  if (refusals) {
    console.log(apply ? 'Nothing written: fix or remove the refused lines, then run again.' : 'Dry run: nothing written. Fix or remove the refused lines.');
    process.exitCode = 2;
    return;
  }
  if (!apply) {
    console.log('Dry run: nothing written. Add --apply --review FILE to write.');
    return;
  }
  if (!add.length) {
    console.log('All rows already present in sk.csv; nothing written.');
    return;
  }

  // Append-only atomic write: existing bytes stay an exact prefix, written via
  // a sibling temp file and rename. Touch no other file.
  const needsNewline = skBytes.length > 0 && skBytes[skBytes.length - 1] !== 0x0a;
  const suffix = Buffer.from((needsNewline ? '\n' : '') + add.map((r) => r.map(esc).join(',')).join('\n') + '\n', 'utf8');
  const nextBytes = Buffer.concat([skBytes, suffix]);
  const mode = statSync(skPath).mode & 0o777;
  const tmpPath = join(dirname(skPath), `.sk-apply-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(tmpPath, nextBytes, { mode });
    renameSync(tmpPath, skPath);
  } catch (e) {
    try { unlinkSync(tmpPath); } catch { /* ignore if not created */ }
    fail(`Atomic write failed for ${skPath}: ${e.message}`);
  }
  console.log(`Appended ${add.length} row${add.length === 1 ? '' : 's'} to ${skPath}. Run node tools/make-snapshot.mjs and node tools/check.mjs next.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
