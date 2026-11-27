// Appends independently reviewed Slovak translations for prose columns to
// data/i18n/sk.csv (issue #18: requirement and deadline prose).
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
const bag = (text, re) => (text.match(re) || []).sort().join('|');
const esc = (v) => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const pairKey = (field, en) => `${field}\u0000${en}`;
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
  extraHolds = NON_SELECTOR_HOLDS,
  today = new Date(),
}) {
  const { rows: progRaw, issues: progIssues } = csvToObjects(programmesCsv, 'programmes.csv');
  if (progIssues.length) throw new Error(`Invalid programmes.csv: ${progIssues.join('; ')}`);
  const built = readSheets(universitiesCsv, programmesCsv, today);
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
  return { heldCells, heldKeys, programmes: built.programmes };
}

function liveDisplayKeys(programmes, heldCells) {
  const live = new Set();
  const add = (field, text) => {
    for (const en of textKeys(text)) {
      if (en && en !== '?' && en !== 'none') live.add(pairKey(field, en));
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
  }
  return live;
}

// Strict line-aware CSV reader (same guard as tools/reword-prose.mjs:138-160),
// so a malformed quote in a batch or review file fails cleanly with exit 1.
function records(file, fail) {
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
  const skText = skBytes.toString('utf8');
  const skGrid = parseCsv(skText);
  if (!skGrid[0] || skGrid[0].length !== 4 || skGrid[0].join(',') !== 'field,en,sk,verified_by') {
    fail(`${skPath}: unexpected header (expected field,en,sk,verified_by)`);
  }
  const existingSk = new Map();
  for (let i = 1; i < skGrid.length; i++) {
    const r = skGrid[i];
    if (r.length !== 4) fail(`${skPath}:${i + 1}: expected 4 columns, got ${r.length}`);
    const k = pairKey(r[0], normaliseEnglish(r[1]));
    if (existingSk.has(k)) fail(`${skPath}:${i + 1}: duplicate normalised key ${r[0]} ${JSON.stringify(r[1])}`);
    existingSk.set(k, r[2]);
  }

  let heldCells, heldKeys, programmes;
  try {
    ({ heldCells, heldKeys, programmes } = heldDisplayKeys({ universitiesCsv: uniText, programmesCsv: progText }));
  } catch (e) {
    fail(e.message);
  }
  const liveKeys = liveDisplayKeys(programmes, heldCells);

  // Parse batch CSV (exact header: field,en,sk).
  const [batchHead, ...batchRows] = records(batchFile, fail);
  if (!batchHead || batchHead.cells.length !== BATCH_HEADER.length || BATCH_HEADER.some((h, i) => batchHead.cells[i] !== h)) {
    fail(`${batchFile}: the header must be exactly ${BATCH_HEADER.join(',')}`);
  }

  // Parse review CSV when supplied (exact header: field,en,sk,verdict).
  // Reject ambiguous or conflicting verdicts instead of relying on last-match order.
  const reviews = new Map();
  const reviewsByNorm = new Map();
  const keptByPair = new Map();
  if (reviewFile) {
    const [revHead, ...revRows] = records(reviewFile, fail);
    if (!revHead || revHead.cells.length !== REVIEW_HEADER.length || REVIEW_HEADER.some((h, i) => revHead.cells[i] !== h)) {
      fail(`${reviewFile}: the header must be exactly ${REVIEW_HEADER.join(',')}`);
    }
    for (const r of revRows) {
      if (r.cells.length !== REVIEW_HEADER.length) {
        fail(`${reviewFile}:${r.line}: expected ${REVIEW_HEADER.length} columns, got ${r.cells.length}`);
      }
      const [field, en, sk, verdict] = r.cells;
      const rKey = reviewKey(field, en, sk);
      const normKey = reviewKey(field, normaliseEnglish(en), sk);
      const prev = reviews.get(rKey) || reviewsByNorm.get(normKey);
      if (prev && prev.verdict !== verdict) {
        fail(`${reviewFile}:${r.line}: conflicting review verdicts (${JSON.stringify(prev.verdict)} vs ${JSON.stringify(verdict)}) for ${field} ${JSON.stringify(en)}`);
      }
      reviews.set(rKey, { field, en, sk, verdict });
      reviewsByNorm.set(normKey, { field, en, sk, verdict });
      if (verdict === 'keep') {
        const pKey = pairKey(field, normaliseEnglish(en));
        const prevKept = keptByPair.get(pKey);
        if (prevKept !== undefined && prevKept !== sk) {
          fail(`${reviewFile}:${r.line}: conflicting keep review rows for ${field} ${JSON.stringify(en)}`);
        }
        keptByPair.set(pKey, sk);
      }
    }
  }

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
    if (!PROSE_FIELDS.includes(field)) {
      refuse(`unsupported field ${JSON.stringify(field)} (only ${PROSE_FIELDS.join(', ')})`);
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

    // Refusal 2: live lookup key for that field on non-held programmes.
    if (!liveKeys.has(pKey)) {
      refuse(`not a live lookup key for ${field}: ${JSON.stringify(en)}`);
      continue;
    }

    // Refusal 4: duplicate in batch, or existing sk.csv row with different sk.
    if (batchSeen.has(pKey)) {
      refuse(`duplicate (${field}, en) within batch: ${JSON.stringify(en)}`);
      continue;
    }
    batchSeen.add(pKey);

    if (existingSk.has(pKey)) {
      const currentSk = existingSk.get(pKey);
      if (currentSk !== sk) {
        refuse(`sk.csv already has a different translation for ${JSON.stringify(en)}`);
        continue;
      }
      // Refusal 5 also guards against skipping a malformed row if sk.csv were edited.
      if (HARD.some((re) => bag(en, re) !== bag(sk, re))) {
        refuse(`hard tokens differ between English and Slovak for ${JSON.stringify(en)}`);
        continue;
      }
      if ([' · ', ';'].some((sep) => en.split(sep).length !== sk.split(sep).length)) {
        refuse(`separator counts (' · ' or ';') differ for ${JSON.stringify(en)}`);
        continue;
      }
      skips++;
      console.log(`SKIP ${where}: already in sk.csv with identical Slovak (${JSON.stringify(en)})`);
      continue;
    }

    // Refusal 5: hard-token bags and separator counts (' · ' and ';').
    if (HARD.some((re) => bag(en, re) !== bag(sk, re))) {
      refuse(`hard tokens differ between English and Slovak for ${JSON.stringify(en)}`);
      continue;
    }
    if ([' · ', ';'].some((sep) => en.split(sep).length !== sk.split(sep).length)) {
      refuse(`separator counts (' · ' or ';') differ for ${JSON.stringify(en)}`);
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
    process.exit(2);
  }
  if (!apply) {
    console.log('Dry run: nothing written. Add --apply --review FILE to write.');
    process.exit(0);
  }
  if (!add.length) {
    console.log('All rows already present in sk.csv; nothing written.');
    process.exit(0);
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
