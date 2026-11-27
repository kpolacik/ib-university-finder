import { t, dateFormatter, getLanguage } from './i18n.js';
// IB Diploma subjects: the course list, the public wording of a reviewed
// subject rule, and the pure checker that compares a student's subjects with
// one rule (F01). No DOM, no storage, no clock: tools/check.mjs tests every
// branch with plain objects.
//
// What a reviewed rule is and how it is approved lives in subject-rules.js
// (validation) and subject-authority.js (which rules are current). This file
// only reads a rule that has already passed both.
//
// The checker's rules of thumb, from the product spec (my-subjects v4):
// - a source that names SL alone proves nothing about HL, so a level the
//   source does not mention stays unknown unless it is explicitly excluded;
// - a missing subject, a missing grade or a low predicted grade is never a
//   conflict, only "needs checking";
// - meeting a restriction is not the same as there being no restriction:
//   "No listed subject restrictions" needs a reviewed statement of absence.

// The intake every rule must be labelled with. A rule for another year is
// never used, even when its wording looks the same.
export const TARGET_INTAKE = '2027/28';

export const LEVELS = ['HL', 'SL'];
const BOTH = ['HL', 'SL'];
const SL_ONLY = ['SL'];

// Supported IB courses. The ids are stable and never reused; the labels are UI
// keys in i18n.js. This is the list a student can enter, not a claim about
// what any school offers. A course missing here is "not supported yet" and is
// never mapped to a similar one.
export const IB_COURSES = [
  { id: 'en-a-lit', group: 1, levels: BOTH, key: 'ibc_en_a_lit' },
  { id: 'en-a-lang-lit', group: 1, levels: BOTH, key: 'ibc_en_a_lang_lit' },
  { id: 'sk-a-lit', group: 1, levels: BOTH, key: 'ibc_sk_a_lit' },
  { id: 'cs-a-lit', group: 1, levels: BOTH, key: 'ibc_cs_a_lit' },
  { id: 'en-b', group: 2, levels: BOTH, key: 'ibc_en_b' },
  { id: 'fr-b', group: 2, levels: BOTH, key: 'ibc_fr_b' },
  { id: 'de-b', group: 2, levels: BOTH, key: 'ibc_de_b' },
  { id: 'es-b', group: 2, levels: BOTH, key: 'ibc_es_b' },
  { id: 'fr-ab-initio', group: 2, levels: SL_ONLY, key: 'ibc_fr_ab_initio' },
  { id: 'de-ab-initio', group: 2, levels: SL_ONLY, key: 'ibc_de_ab_initio' },
  { id: 'es-ab-initio', group: 2, levels: SL_ONLY, key: 'ibc_es_ab_initio' },
  { id: 'economics', group: 3, levels: BOTH, key: 'ibc_economics' },
  { id: 'history', group: 3, levels: BOTH, key: 'ibc_history' },
  { id: 'geography', group: 3, levels: BOTH, key: 'ibc_geography' },
  { id: 'psychology', group: 3, levels: BOTH, key: 'ibc_psychology' },
  { id: 'business-management', group: 3, levels: BOTH, key: 'ibc_business_management' },
  { id: 'philosophy', group: 3, levels: BOTH, key: 'ibc_philosophy' },
  { id: 'global-politics', group: 3, levels: BOTH, key: 'ibc_global_politics' },
  { id: 'biology', group: 4, levels: BOTH, key: 'ibc_biology' },
  { id: 'chemistry', group: 4, levels: BOTH, key: 'ibc_chemistry' },
  { id: 'physics', group: 4, levels: BOTH, key: 'ibc_physics' },
  { id: 'computer-science', group: 4, levels: BOTH, key: 'ibc_computer_science' },
  { id: 'design-technology', group: 4, levels: BOTH, key: 'ibc_design_technology' },
  // One maths course per student: the two share a family.
  { id: 'maths-aa', group: 5, levels: BOTH, family: 'maths', key: 'ibc_maths_aa' },
  { id: 'maths-ai', group: 5, levels: BOTH, family: 'maths', key: 'ibc_maths_ai' },
  { id: 'music', group: 6, levels: BOTH, key: 'ibc_music' },
  { id: 'visual-arts', group: 6, levels: BOTH, key: 'ibc_visual_arts' },
  { id: 'theatre', group: 6, levels: BOTH, key: 'ibc_theatre' },
  { id: 'film', group: 6, levels: BOTH, key: 'ibc_film' },
];

const COURSES = new Map(IB_COURSES.map((course) => [course.id, course]));
export const MATHS_FAMILY = 'maths';
export const courseById = (id) => COURSES.get(id) ?? null;
export const familyOf = (id) => COURSES.get(id)?.family ?? id;
export const courseLabel = (id) => (COURSES.has(id) ? t(COURSES.get(id).key) : id);

export const MAX_ENTRIES = 6;

// A student's entries as the checker needs them: [{ course, level, grade }],
// grade an integer 1-7 or null. An untouched blank row is ignored; anything
// started but invalid is an error, never guessed. Returns every error so an
// editor can show each one beside its row.
export function normalizeProfile(rows) {
  const entries = [];
  const errors = [];
  const families = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    // Only plain fields are read; nothing is converted with String() or
    // Number(), so an odd value is an error, never a guess or a crash.
    if (row === null || typeof row !== 'object' || Array.isArray(row)) { errors.push({ index, code: 'invalid' }); return; }
    const text = (value) => (value === undefined || value === null ? '' : typeof value === 'string' ? value.trim() : undefined);
    const course = text(row.course);
    const level = text(row.level);
    if (course === undefined || level === undefined) { errors.push({ index, code: 'invalid' }); return; }
    // A grade is blank (absent, null or ''), a whole number 1-7, or one of
    // the strings "1" to "7" a select gives.
    const raw = row.grade;
    const blank = raw === undefined || raw === null || raw === '';
    let grade = null;
    let gradeOk = blank;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 7) { grade = raw; gradeOk = true; }
    if (typeof raw === 'string' && /^[1-7]$/.test(raw)) { grade = raw.charCodeAt(0) - 48; gradeOk = true; }
    if (!course && !level && blank) return;
    if (!course || !level) { errors.push({ index, code: gradeOk ? 'incomplete' : 'grade' }); return; }
    const known = COURSES.get(course);
    if (!known) { errors.push({ index, code: 'unsupported' }); return; }
    if (!known.levels.includes(level)) { errors.push({ index, code: 'level' }); return; }
    if (!gradeOk) { errors.push({ index, code: 'grade' }); return; }
    const family = familyOf(course);
    if (families.has(family)) { errors.push({ index, code: 'duplicate' }); return; }
    families.add(family);
    entries.push({ course, level, grade });
  });
  if (entries.length > MAX_ENTRIES) errors.push({ index: MAX_ENTRIES, code: 'too-many' });
  if (!entries.length && !errors.length) errors.push({ index: 0, code: 'empty' });
  return { ok: errors.length === 0, entries, errors };
}

// ------------------------------------------------------------------ checker

// The five results. Exactly one per programme.
export const STATUS = {
  NO_CHECK: 'no-check',
  NEEDS: 'needs-checking',
  MEETS: 'meets',
  CONFLICT: 'conflicts',
  NO_RESTRICTIONS: 'no-restrictions',
};

// Their words, for My list (Phase 2). Every status carries SUBJECTS_ONLY.
export const STATUS_KEYS = {
  'no-check': 'subj_status_no_check',
  'needs-checking': 'subj_status_needs',
  meets: 'subj_status_meets',
  conflicts: 'subj_status_conflicts',
  'no-restrictions': 'subj_status_no_restrictions',
};
export const SUBJECTS_ONLY_KEY = 'subj_status_rider';
export const PREDICTED_KEY = 'subj_status_predicted';

// One clause against the student's entries:
//   met       an entry satisfies it (predicted: a predicted grade was needed)
//   excluded  documented incompatible: the source excludes what they take
//   open      not decided: a missing entry or grade, a low prediction, a level
//             or course the source does not mention, an exam or waiver
function clauseResult(clause, entries) {
  if (clause.type !== 'subject') return { clause, state: 'open', reason: { kind: clause.type } };
  const maths = entries.find((entry) => familyOf(entry.course) === MATHS_FAMILY);
  for (const course of clause.courses) {
    const entry = entries.find((e) => e.course === course);
    if (!entry || !clause.levels.includes(entry.level)) continue;
    if (clause.minGrade === null) return { clause, state: 'met', predicted: false, entry };
    if (entry.grade !== null && entry.grade >= clause.minGrade) return { clause, state: 'met', predicted: true, entry };
  }
  const perCourse = clause.courses.map((course) => {
    const entry = entries.find((e) => e.course === course);
    if (entry) {
      if (clause.excludeLevels.includes(entry.level)) return { state: 'excluded', reason: { kind: 'level-excluded', course, level: entry.level } };
      if (!clause.levels.includes(entry.level)) return { state: 'open', reason: { kind: 'level-unstated', course, level: entry.level } };
      if (entry.grade === null) return { state: 'open', reason: { kind: 'grade-missing', course, min: clause.minGrade } };
      return { state: 'open', reason: { kind: 'grade-below', course, min: clause.minGrade, grade: entry.grade } };
    }
    if (familyOf(course) === MATHS_FAMILY && maths) {
      // One maths course per student, so they do not take this one. The
      // course they do take decides the clause on its own entry, if listed.
      if (clause.courses.includes(maths.course)) return { state: 'excluded', reason: { kind: 'other-maths', course } };
      if (clause.excludeCourses.includes(maths.course)) return { state: 'excluded', reason: { kind: 'course-excluded', course: maths.course } };
      return { state: 'open', reason: { kind: 'course-unstated', course: maths.course } };
    }
    return { state: 'open', reason: { kind: 'add', course } };
  });
  if (perCourse.every((r) => r.state === 'excluded')) {
    const named = perCourse.find((r) => r.reason.kind !== 'other-maths') ?? perCourse[0];
    return { clause, state: 'excluded', reason: named.reason };
  }
  return { clause, state: 'open', reason: perCourse.find((r) => r.state === 'open').reason };
}

// The clauses a route must meet: its own plus every university-wide clause
// that governs it (all routes unless the clause names some).
// Whether a route may apply to this student: no scope of its own, or an IB
// Diploma scope with no condition → known; a condition the page cannot know →
// unknown; a cited scope for another qualification → inapplicable (the route
// is for someone else and counts neither for nor against).
export function routeApplicability(route) {
  if (!route.scope) return 'known';
  if (route.scope.qualification !== 'ib-diploma') return 'inapplicable';
  return route.scope.conditions.length ? 'unknown' : 'known';
}

function governing(rule, route) {
  return [...rule.general.filter((clause) => !clause.routes || clause.routes.includes(route.id)), ...route.clauses];
}

// evaluateSubjects(rule, entries) → { status, routes, next, predicted }
// rule: a usable reviewed rule (null: no rule). entries: normalizeProfile's.
// routes keeps every route's explanation, even when another one decides.
export function evaluateSubjects(rule, entries = []) {
  if (!rule) return { status: STATUS.NO_CHECK, routes: [], next: null, predicted: false };
  const scopeKnown = rule.scope.conditions.length === 0;
  if (rule.kind === 'explicit-no-restrictions') {
    return scopeKnown
      ? { status: STATUS.NO_RESTRICTIONS, routes: [], next: null, predicted: false }
      : { status: STATUS.NEEDS, routes: [], next: { kind: 'scope' }, predicted: false };
  }
  const routes = rule.routes.map((route) => {
    const clauses = governing(rule, route).map((clause) => clauseResult(clause, entries));
    const scope = routeApplicability(route);
    const applicable = scopeKnown && scope === 'known';
    const hasSubject = clauses.some((r) => r.clause.type === 'subject');
    let outcome = 'open';
    if (scope === 'inapplicable') outcome = 'not-for-you';
    else if (clauses.some((r) => r.state === 'excluded')) outcome = 'excluded';
    else if (applicable && hasSubject && clauses.every((r) => r.state === 'met')) outcome = 'met';
    return { id: route.id, outcome, applicable, clauses, predicted: clauses.some((r) => r.predicted) };
  });
  // Only routes that may be an IB Diploma route decide anything. With none,
  // there is no verdict at all (never a conflict "because every route failed").
  const candidates = routes.filter((route) => route.outcome !== 'not-for-you');
  if (!candidates.length) return { status: STATUS.NEEDS, routes, next: { kind: 'official' }, predicted: false };
  const complete = rule.kind === 'complete-restrictions';
  const met = candidates.filter((route) => route.outcome === 'met');
  if (complete && met.length) {
    return { status: STATUS.MEETS, routes, next: null, predicted: met.every((route) => route.predicted) };
  }
  if (complete && scopeKnown && candidates.every((route) => route.outcome === 'excluded')) {
    return { status: STATUS.CONFLICT, routes, next: null, predicted: false };
  }
  return { status: STATUS.NEEDS, routes, next: nextStep(rule, routes, scopeKnown), predicted: false };
}

// The one thing to do next, from the first route still open.
function nextStep(rule, routes, scopeKnown) {
  if (!scopeKnown) return { kind: 'scope' };
  for (const route of routes) {
    if (route.outcome !== 'open') continue;
    const open = route.clauses.find((r) => r.state === 'open');
    if (open) return { route: route.id, ...open.reason };
    if (!route.applicable) return { route: route.id, kind: 'scope' };
  }
  return { kind: rule.kind === 'partial-restrictions' ? 'partial' : 'official' };
}

// --------------------------------------------------------- public wording

// Rule text is { en, sk }; Slovak falls back to English, marked as English.
export function pickText(text) {
  if (getLanguage() === 'sk' && text.sk) return { text: text.sk };
  return getLanguage() === 'en' ? { text: text.en } : { text: text.en, lang: 'en' };
}

const isoDate = dateFormatter({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate.format(new Date(Date.UTC(y, m - 1, d)));
};

const joinWith = (items, key) => items.join(t(key));

function subjectText(clause) {
  const courses = joinWith(clause.courses.map(courseLabel), 'rv_or');
  const levels = joinWith(clause.levels, 'rv_or');
  let text = clause.minGrade === null
    ? t('rv_subject', { courses, levels })
    : t('rv_subject_grade', { courses, levels, grade: clause.minGrade });
  if (clause.excludeLevels.length) text += ` ${t('rv_not_accepted', { value1: joinWith(clause.excludeLevels, 'rv_or') })}`;
  if (clause.excludeCourses.length) text += ` ${t('rv_not_accepted', { value1: joinWith(clause.excludeCourses.map(courseLabel), 'rv_or') })}`;
  return [{ text }];
}

const CLAUSE_PREFIX = { exam: 'rv_exam', waiver: 'rv_waiver', manual: 'rv_manual' };

// A clause as text parts: [{ text, lang? }].
function clauseParts(clause) {
  if (clause.type === 'subject') return subjectText(clause);
  const own = pickText(clause.text);
  return [{ text: `${t(CLAUSE_PREFIX[clause.type])} ` }, own];
}

function joinParts(groups, key) {
  return groups.flatMap((parts, i) => (i ? [{ text: t(key) }, ...parts] : parts));
}

// publicRuleView(rule) → { sample, lines, sources, meta }
// lines: [[{ text, lang? }]] in reading order; sources: [{ n, url, quote, lang }]
// in the order first cited. The same words go to the detail and Compare.
export function publicRuleView(rule) {
  const lines = [];
  const scope = pickText(rule.scope.label);
  lines.push([{ text: `${t('rv_scope')} ` }, scope]);
  for (const condition of rule.scope.conditions) lines.push([{ text: `${t('rv_scope_condition')} ` }, pickText(condition.text)]);
  if (rule.kind === 'explicit-no-restrictions') {
    lines.push([{ text: t('rv_none') }]);
  } else {
    const partial = rule.kind === 'partial-restrictions';
    if (partial) lines.push([{ text: `${t('rv_partial')} ` }, pickText(rule.partialNote)]);
    const many = rule.routes.length > 1;
    // A partial check lists what was recorded, never "any one is enough".
    if (partial) lines.push([{ text: t(many ? 'rv_partial_routes' : 'rv_partial_route') }]);
    else if (many) lines.push([{ text: t('rv_any_route') }]);
    rule.routes.forEach((route, i) => {
      const parts = joinParts(route.clauses.map(clauseParts), 'rv_and');
      const lead = many ? [{ text: `${t('rv_route', { n: i + 1 })} ` }] : [];
      lines.push([...lead, ...parts]);
      if (route.scope) {
        lines.push([{ text: `${t('rv_route_scope')} ` }, pickText(route.scope.label)]);
        for (const condition of route.scope.conditions) lines.push([{ text: `${t('rv_scope_condition')} ` }, pickText(condition.text)]);
      }
    });
    for (const clause of rule.general) {
      const which = clause.routes
        ? t('rv_some_routes', { routes: clause.routes.map((id) => rule.routes.findIndex((r) => r.id === id) + 1).join(', ') })
        : t(many ? 'rv_all_routes' : 'rv_also');
      lines.push([{ text: `${which} ` }, ...clauseParts(clause)]);
    }
  }
  const sources = [];
  const cite = (ids) => ids.forEach((id) => { if (!sources.some((s) => s.id === id)) sources.push({ id, ...rule.sources[id] }); });
  cite(rule.scope.sources);
  rule.scope.conditions.forEach((c) => cite(c.sources));
  cite(rule.absenceSources);
  for (const route of rule.routes) {
    if (route.scope) { cite(route.scope.sources); route.scope.conditions.forEach((c) => cite(c.sources)); }
    route.clauses.forEach((c) => cite(c.sources));
  }
  rule.general.forEach((c) => cite(c.sources));
  const meta = t('rv_meta', {
    intake: rule.intake, checked: formatIso(rule.checkedOn), reviewer: rule.reviewer,
    reviewed: formatIso(rule.reviewedOn), recheck: formatIso(rule.recheckBy),
  });
  return { sample: rule.sample === true, lines, sources: sources.map((s, i) => ({ ...s, n: i + 1 })), meta };
}
