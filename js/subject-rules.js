// Reads and validates data/ib-subject-rules.csv, the reviewed IB subject
// rules (F01). Stateless: the same text, catalogue and day always give the
// same answer, so tools/check.mjs and tools/make-snapshot.mjs use exactly
// what the page uses. Which response is current, and for how long, is
// subject-authority.js's job.
//
// A rule is used only when every check here passes. Anything doubtful makes
// it unusable, and the page then shows only the catalogue's own wording: a
// student may plan around a "reviewed" line, so a wrong one costs more than a
// missing one. MAINTENANCE.md explains each column for maintainers.
//
// The flow is readRuleRecords (the file) → acceptRule (one record, the only
// acceptance boundary) → combineRules (withdrawals, duplicates, doubt).

import { safeUrl } from './data.js';
import { IB_COURSES, LEVELS, MATHS_FAMILY, TARGET_INTAKE, familyOf } from './ib-subjects.js';

export const RULES_PATH = 'data/ib-subject-rules.csv';
export const RULE_SCHEMA_VERSION = '1';
export const RULE_COLUMNS = [
  'schema_version', 'programme_id', 'intake', 'status', 'scope', 'evidence_kind', 'routes', 'sources',
  'programme_dependencies', 'university_dependencies', 'checked_on', 'recheck_by', 'author', 'reviewer', 'reviewed_on',
];
export const RULE_STATUSES = ['draft', 'approved', 'withdrawn'];
export const EVIDENCE_KINDS = ['complete-restrictions', 'partial-restrictions', 'explicit-no-restrictions'];
export const IB_DIPLOMA = 'ib-diploma';
// Qualifications a scope may name. Only a qualification on this list can be
// proof that a rule or route is for someone else: an unknown or misspelt one
// makes the record invalid, never "definitely not for IB students". Each is a
// separate school-leaving qualification from the IB Diploma.
export const QUALIFICATIONS = [IB_DIPLOMA, 'a-levels', 'european-baccalaureate', 'national-school-leaving'];

// The catalogue columns a rule may depend on. A key outside these is a typo
// or a column that no longer exists, and blocks the rule.
export const PROGRAMME_COLUMNS = [
  'programme_id', 'university_id', 'city', 'programme', 'degree_type', 'subject_area', 'language', 'ib_points_min',
  'ib_subjects', 'ib_maths', 'other_requirements', 'admission', 'entrance_exam', 'tuition_eu', 'tuition_noneu',
  'english_requirement', 'application_deadline', 'deadline_notes', 'official_url', 'last_verified', 'verified_by',
  'application_system', 'apply_url', 'apply_code', 'app_fee', 'app_fee_note', 'places', 'places_kind', 'places_year',
  'intake_months', 'ib_recognition', 'ib_offer',
];
export const UNIVERSITY_COLUMNS = [
  'university_id', 'name', 'city', 'country', 'application_system', 'living_cost_min', 'living_cost_max',
  'living_cost_monthly', 'living_cost_source', 'tuition_eu_default', 'tuition_noneu_default', 'baseline_requirement',
  'english_requirement_default', 'admission_default', 'student_life_url', 'last_verified', 'verified_by', 'aliases',
  'qs_rank', 'the_rank', 'rankings_year', 'image_file', 'image_author', 'image_licence', 'image_licence_url',
  'image_source_url', 'apply_url_default', 'app_fee_default', 'app_fee_note_default', 'intake_months_default',
  'ib_recognition_default', 'ib_offer_default',
];
// Every rule records these, even when blank, so a change to any of them
// (including "none" becoming the four maths courses) retires the rule.
export const REQUIRED_PROGRAMME_DEPENDENCIES = [
  'programme_id', 'university_id', 'programme', 'official_url', 'ib_subjects', 'ib_maths', 'other_requirements',
  'entrance_exam', 'admission', 'english_requirement',
];
export const REQUIRED_UNIVERSITY_DEPENDENCIES = [
  'university_id', 'name', 'baseline_requirement', 'admission_default', 'english_requirement_default',
];

// Reasons a record is not used. 'sample' is its own reason so that a test can
// tell an invented rule from every other problem (tools/check.mjs).
export const REASONS = [
  'schema', 'programme', 'intake', 'status', 'draft', 'scope', 'scope-inapplicable', 'evidence-kind', 'routes',
  'sources', 'unsafe-link', 'dates', 'expired', 'unsigned', 'self-review', 'ai-draft', 'sample', 'dependencies',
  'unbound', 'drift',
];

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const INTAKE = /^\d{4}\/\d{2}$/;
const INITIALS = /^\p{Lu}{2,4}$/u;
const MAX_TEXT = 400;
const MAX_QUOTE = 500;

// The whole file. Header-only is a valid, empty table. This file has its own
// strict reader, unlike the catalogue's forgiving one (js/csv.js): any
// quoting the CSV rules do not allow, a row with the wrong number of cells, or
// any header cell that is not exactly the expected one makes the whole file
// untrusted, because a misread row could be a withdrawal.
export function readRuleRecords(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: 'empty', records: [] };
  const grid = strictCsv(text);
  if (!grid) return { ok: false, reason: 'malformed', records: [] };
  const [header, ...rows] = grid;
  if (header.length !== RULE_COLUMNS.length || header.some((cell, i) => cell !== RULE_COLUMNS[i])) return { ok: false, reason: 'header', records: [] };
  if (rows.some((cells) => cells.length !== RULE_COLUMNS.length)) return { ok: false, reason: 'malformed', records: [] };
  return { ok: true, reason: null, records: rows.map((cells) => Object.fromEntries(RULE_COLUMNS.map((c, i) => [c, cells[i].trim()]))) };
}

// RFC 4180 with no repairs. A quote may only open a field and only close one:
// the character after a closing quote must be a comma or the end of the line.
// Lines end in LF or CRLF; a lone CR, a quote inside an unquoted field or an
// unclosed quote fails the file. Empty lines are skipped (one ends the file).
// Returns rows of cells, or null.
function strictCsv(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [];
  let i = 0;
  const endLine = () => { if (!(row.length === 1 && row[0] === '' && !row.quoted)) rows.push(row); row = []; };
  while (i <= text.length) {
    let field = '';
    let quoted = false;
    if (text[i] === '"') {
      quoted = true;
      i++;
      for (;;) {
        if (i >= text.length) return null;
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++;
          break;
        }
        field += text[i++];
      }
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
        if (text[i] === '"') return null;
        field += text[i++];
      }
    }
    row.push(field);
    if (quoted) row.quoted = true;
    if (i >= text.length) { endLine(); break; }
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '\r') { if (text[i + 1] !== '\n') return null; i++; }
    if (text[i] === '\n') { i++; endLine(); if (i >= text.length) break; continue; }
    return null;
  }
  return rows;
}

// acceptRule(record, { raw, today }) → { ok, key, withdrawal, rule, reasons }
// raw: data.js's map of programme id → the exact catalogue rows the page
// loaded. today: the current local date. Optional expiryDay is the latest
// ISO calendar day already observed for the same response.
// disjoint: the record is, by its own cited scope, for a different known
// qualification. Such a record can never apply to an IB Diploma student, so
// it does not compete with an IB record for the same programme.
export function acceptRule(record, context) {
  const inspected = inspectRule(record, context);
  const ok = inspected.reasons.length === 0;
  return { ok, key: inspected.key, withdrawal: ok && inspected.withdrawal, disjoint: inspected.disjoint === true,
    rule: ok ? inspected.rule : null, reasons: inspected.reasons };
}

// Everything acceptRule decides, with the rule built whenever its structure is
// readable. Only acceptRule turns this into a usable rule.
export function inspectRule(record, { raw = new Map(), today = new Date(), expiryDay } = {}) {
  const reasons = new Set();
  const cell = (name) => (typeof record?.[name] === 'string' ? record[name].trim() : '');
  const programmeId = cell('programme_id');
  const intake = cell('intake');
  const key = programmeId ? { programme: programmeId, intake } : null;
  if (!key) reasons.add('programme');
  if (cell('schema_version') !== RULE_SCHEMA_VERSION) reasons.add('schema');
  if (intake !== TARGET_INTAKE) reasons.add('intake');
  const status = cell('status');
  if (!RULE_STATUSES.includes(status)) reasons.add('status');
  if (status === 'withdrawn') return { key, withdrawal: true, rule: null, reasons: [...reasons] };
  if (status === 'draft') reasons.add('draft');

  const author = signer(cell('author'), reasons);
  const reviewer = signer(cell('reviewer'), reasons);
  if (author && reviewer && author === reviewer) reasons.add('self-review');

  const kind = cell('evidence_kind');
  if (!EVIDENCE_KINDS.includes(kind)) reasons.add('evidence-kind');

  const sources = readSources(json(cell('sources')), reasons);
  const cited = (ids) => Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string' && Object.hasOwn(sources, id));
  const scope = readScope(json(cell('scope')), reasons, cited, 'scope');
  const body = readRoutes(json(cell('routes')), kind, reasons, cited);
  // Proven disjoint only by a valid, cited scope naming a known other
  // qualification. Anything less stays a possible competitor.
  const disjoint = !reasons.has('schema') && Boolean(scope?.valid && scope.qualification !== IB_DIPLOMA);
  if (disjoint) reasons.add('scope-inapplicable');
  // A rule with no route that could be an IB Diploma route gives no verdict.
  if (!disjoint && kind !== 'explicit-no-restrictions' && body.routes.length && body.routes.every((r) => r.scope?.qualification && r.scope.qualification !== IB_DIPLOMA)) reasons.add('routes');

  const dates = readDates(cell('checked_on'), cell('reviewed_on'), cell('recheck_by'), today, expiryDay, reasons);
  bind(programmeId, json(cell('programme_dependencies')), json(cell('university_dependencies')), raw, reasons);

  const rule = reasons.has('scope') || reasons.has('routes') || reasons.has('sources') || reasons.has('evidence-kind') || !dates
    ? null
    : {
      programmeId, intake, kind, scope, sources, ...body,
      checkedOn: dates.checked, reviewedOn: dates.reviewed, recheckBy: dates.recheck,
      author, reviewer, sample: false,
    };
  return { key, withdrawal: false, disjoint, rule, reasons: REASONS.filter((r) => reasons.has(r)) };
}

// Initials of a real person. "SAMPLE" marks an invented rule and "AI-DRAFT"
// an unchecked one; neither may ever be used, whatever else the cell says.
function signer(value, reasons) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.includes('AI-DRAFT') || value.includes('AI-DRAFT')) reasons.add('ai-draft');
  if (words.includes('SAMPLE')) reasons.add('sample');
  const initials = words.filter((w) => w !== 'SAMPLE' && w !== 'AI-DRAFT');
  if (initials.length !== 1 || !INITIALS.test(initials[0])) { reasons.add('unsigned'); return null; }
  return initials[0];
}

function json(text) {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, allowed) => Object.keys(value).every((k) => allowed.includes(k));

// { en, sk? }: what a student reads. English is required.
function readText(value) {
  if (!isObject(value) || !onlyKeys(value, ['en', 'sk'])) return null;
  if (typeof value.en !== 'string' || !value.en.trim() || value.en.length > MAX_TEXT) return null;
  if (value.sk !== undefined && (typeof value.sk !== 'string' || value.sk.length > MAX_TEXT)) return null;
  return { en: value.en.trim(), sk: (value.sk || '').trim() };
}

function readSources(value, reasons) {
  if (!isObject(value) || !Object.keys(value).length) { reasons.add('sources'); return {}; }
  const out = {};
  for (const [id, source] of Object.entries(value)) {
    if (!ID.test(id) || !isObject(source) || !onlyKeys(source, ['url', 'quote', 'lang'])) { reasons.add('sources'); continue; }
    const url = typeof source.url === 'string' ? safeUrl(source.url) : null;
    if (!url) reasons.add('unsafe-link');
    const quote = typeof source.quote === 'string' ? source.quote.trim() : '';
    const validLang = source.lang === undefined || (typeof source.lang === 'string' && /^[a-z]{2}$/.test(source.lang));
    if (!quote || quote.length > MAX_QUOTE || !validLang) {
      reasons.add('sources');
      continue;
    }
    // A citation ID can establish scope only if it points to usable evidence.
    if (url) out[id] = { url, quote, lang: source.lang || 'en' };
  }
  return out;
}

// A condition the page cannot know (where the diploma was taken, a birth
// date...). It keeps the rule, but makes applicability unknown.
function readConditions(value, reasons, cited) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { reasons.add('routes'); return []; }
  return value.map((item) => {
    const text = isObject(item) && onlyKeys(item, ['en', 'sk', 'sources']) ? readText({ en: item.en, sk: item.sk }) : null;
    if (!text || !cited(item.sources)) { reasons.add('routes'); return { text: { en: '', sk: '' }, sources: [] }; }
    return { text, sources: item.sources };
  });
}

// A scope, for the whole record or for one route: which qualification it is
// for (from QUALIFICATIONS), a label a student reads, its sources, and any
// condition the page cannot know about the student. `problem` is the reason
// a broken one adds ('scope' for the record, 'routes' for a route).
function readScope(value, reasons, cited, problem) {
  if (!isObject(value) || !onlyKeys(value, ['qualification', 'label', 'conditions', 'sources'])
      || typeof value.qualification !== 'string' || !QUALIFICATIONS.includes(value.qualification)) {
    reasons.add(problem);
    return null;
  }
  const local = new Set();
  const label = readText(value.label);
  if (!label || !cited(value.sources)) local.add(problem);
  const conditions = readConditions(value.conditions, local, cited);
  if (local.size) reasons.add(problem);
  return { qualification: value.qualification, label: label || { en: '', sk: '' }, conditions,
    sources: Array.isArray(value.sources) ? value.sources : [], valid: local.size === 0 };
}

const COURSE_IDS = new Set(IB_COURSES.map((c) => c.id));
const COURSE_LEVELS = new Map(IB_COURSES.map((c) => [c.id, c.levels]));

function readClause(value, reasons, cited, general) {
  const fail = () => { reasons.add('routes'); return null; };
  if (!isObject(value)) return fail();
  const extra = general ? ['routes'] : [];
  if (value.type === 'subject') {
    if (!onlyKeys(value, ['type', 'courses', 'levels', 'min_grade', 'exclude_levels', 'exclude_courses', 'sources', ...extra])) return fail();
    const courses = value.courses, levels = value.levels;
    if (!Array.isArray(courses) || !courses.length || new Set(courses).size !== courses.length || !courses.every((c) => COURSE_IDS.has(c))) return fail();
    if (!Array.isArray(levels) || !levels.length || new Set(levels).size !== levels.length) return fail();
    if (!levels.every((l) => LEVELS.includes(l) && courses.every((c) => COURSE_LEVELS.get(c).includes(l)))) return fail();
    const minGrade = value.min_grade ?? null;
    if (minGrade !== null && !(Number.isInteger(minGrade) && minGrade >= 1 && minGrade <= 7)) return fail();
    const excludeLevels = value.exclude_levels ?? [];
    if (!Array.isArray(excludeLevels) || !excludeLevels.every((l) => LEVELS.includes(l) && !levels.includes(l))) return fail();
    const excludeCourses = value.exclude_courses ?? [];
    const mathsClause = courses.some((c) => familyOf(c) === MATHS_FAMILY);
    if (!Array.isArray(excludeCourses) || !excludeCourses.every((c) => familyOf(c) === MATHS_FAMILY && !courses.includes(c))
        || (excludeCourses.length && !mathsClause)) return fail();
    if (!cited(value.sources)) return fail();
    return { type: 'subject', courses, levels, minGrade, excludeLevels, excludeCourses, sources: value.sources, ...(general ? { routes: value.routes } : {}) };
  }
  if (['exam', 'waiver', 'manual'].includes(value.type)) {
    if (!onlyKeys(value, ['type', 'en', 'sk', 'sources', ...extra])) return fail();
    const text = readText({ en: value.en, sk: value.sk });
    if (!text || !cited(value.sources)) return fail();
    return { type: value.type, text, sources: value.sources, ...(general ? { routes: value.routes } : {}) };
  }
  return fail();
}

// routes: { routes: [{ id, clauses, scope? }], general?: [clause], partial_note? }
// or, for an explicit absence: { absence_sources: [...] } and nothing else.
function readRoutes(value, kind, reasons, cited) {
  const empty = { routes: [], general: [], absenceSources: [], partialNote: null };
  if (!isObject(value)) { reasons.add('routes'); return empty; }
  if (kind === 'explicit-no-restrictions') {
    if (!onlyKeys(value, ['absence_sources']) || !cited(value.absence_sources)) reasons.add('routes');
    return { ...empty, absenceSources: Array.isArray(value.absence_sources) ? value.absence_sources : [] };
  }
  if (!onlyKeys(value, ['routes', 'general', 'partial_note']) || !Array.isArray(value.routes) || !value.routes.length) {
    reasons.add('routes');
    return empty;
  }
  const ids = new Set();
  const routes = value.routes.map((route) => {
    if (!isObject(route) || !onlyKeys(route, ['id', 'clauses', 'scope']) || typeof route.id !== 'string' || !ID.test(route.id) || ids.has(route.id)
        || !Array.isArray(route.clauses) || !route.clauses.length) {
      reasons.add('routes');
      return { id: '', clauses: [], scope: null };
    }
    ids.add(route.id);
    return {
      id: route.id,
      clauses: route.clauses.map((c) => readClause(c, reasons, cited, false)).filter(Boolean),
      // No scope: the record's own scope. A route scope uses the same form.
      scope: route.scope === undefined ? null : readScope(route.scope, reasons, cited, 'routes'),
    };
  });
  const general = value.general === undefined ? [] : Array.isArray(value.general)
    ? value.general.map((c) => readClause(c, reasons, cited, true)).filter(Boolean) : (reasons.add('routes'), []);
  for (const clause of general) {
    if (clause.routes !== undefined && (!Array.isArray(clause.routes) || !clause.routes.length || !clause.routes.every((id) => ids.has(id)))) reasons.add('routes');
  }
  let partialNote = null;
  if (kind === 'partial-restrictions') {
    partialNote = readText(value.partial_note);
    if (!partialNote) reasons.add('routes');
  } else if (value.partial_note !== undefined) reasons.add('routes');
  return { routes, general, absenceSources: [], partialNote };
}

// Real calendar dates, in order: checked, then reviewed (not in the future),
// then recheck-by. Recheck-by counts through that local day.
function readDates(checked, reviewed, recheck, today, expiryDay, reasons) {
  const real = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };
  if (![checked, reviewed, recheck].every(real) || !(checked <= reviewed && reviewed <= recheck)) { reasons.add('dates'); return null; }
  const day = localDay(today);
  if (reviewed > day) reasons.add('dates');
  if (recheck < day || (expiryDay && recheck < expiryDay)) reasons.add('expired');
  return { checked, reviewed, recheck };
}

export function localDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A value as the catalogue file holds it: trimmed text, or null when the
// column is missing altogether. Never the parsed value: "none" and the four
// maths courses read the same once parsed, and a rule must notice the change.
export function rawValue(row, column) {
  if (!row || !Object.hasOwn(row, column)) return null;
  return String(row[column] ?? '').trim();
}

function readDependencies(value, columns, required, reasons) {
  if (!isObject(value) || !required.every((k) => Object.hasOwn(value, k))
      || !Object.entries(value).every(([k, v]) => columns.includes(k) && (v === null || typeof v === 'string'))) {
    reasons.add('dependencies');
    return null;
  }
  return value;
}

// The rule says which catalogue values it was reviewed against. They must be
// exactly what this page loaded, from whichever source won (CSV, Sheet or the
// saved copy), or the rule may describe a programme that has since changed.
function bind(programmeId, programmeDeps, universityDeps, raw, reasons) {
  const p = readDependencies(programmeDeps, PROGRAMME_COLUMNS, REQUIRED_PROGRAMME_DEPENDENCIES, reasons);
  const u = readDependencies(universityDeps, UNIVERSITY_COLUMNS, REQUIRED_UNIVERSITY_DEPENDENCIES, reasons);
  if (!p || !u) return;
  if (p.programme_id !== programmeId || u.university_id !== p.university_id) { reasons.add('dependencies'); return; }
  const loaded = raw instanceof Map ? raw.get(programmeId) : null;
  if (!loaded || loaded.unsafe || !loaded.programme || !loaded.university) { reasons.add('unbound'); return; }
  const differs = Object.entries(p).some(([k, v]) => rawValue(loaded.programme, k) !== v)
    || Object.entries(u).some(([k, v]) => rawValue(loaded.university, k) !== v);
  if (differs) reasons.add('drift');
}

// combineRules(results) → { rules: Map(programme_id → rule), blocked }
// One usable rule per programme for the target intake, or none:
// - any withdrawal for it wins over every approval, old or new;
// - a record proven (by cited scope) to be for another qualification is
//   ignored: it cannot apply to an IB Diploma student;
// - any record for it that failed (or whose intake is unreadable) might be
//   a competing rule, so none is used;
// - two approvals are ambiguous, so none is used;
// - a record whose programme cannot be read makes the whole table untrusted.
export function combineRules(results) {
  const groups = new Map();
  for (const result of results) {
    if (!result.key) return { rules: new Map(), blocked: 'unreadable' };
    const { programme, intake } = result.key;
    if (intake !== TARGET_INTAKE && INTAKE.test(intake)) continue;
    // For another known qualification by its own cited scope: never an IB
    // rule and never in competition with one. A withdrawal is never skipped.
    if (result.disjoint && !result.withdrawal) continue;
    if (!groups.has(programme)) groups.set(programme, []);
    groups.get(programme).push(result);
  }
  const rules = new Map();
  for (const [programme, group] of groups) {
    if (group.some((r) => !r.ok || r.withdrawal)) continue;
    if (group.length !== 1 || !group[0].rule) continue;
    rules.set(programme, group[0].rule);
  }
  return { rules, blocked: null };
}
