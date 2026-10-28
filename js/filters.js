// Pure functions: given rows and a filter state, give back the rows that match,
// in the requested order. No DOM in here, so this stays easy to reason about.

import { foldAccents } from './data.js';
import { caoPointsFor, MATHS_BONUS_POINTS } from './points.js';

export function createFilterState() {
  return {
    search: '',
    subjectAreas: new Set(),
    countries: new Set(),
    languages: new Set(),
    degreeTypes: new Set(),
    cities: new Set(),
    deadlineWindow: 'any',
    maxTuition: null,
    myIbPoints: null,
    // "HL Maths 4+": adds the 25 CAO bonus points on Irish cutoff rows. It
    // changes labels and counts, never which rows are shown (pointsBucket).
    hlMaths: false,
    shortlistOnly: false,
    sort: 'deadline',
    dir: 'asc',
  };
}

// The sort and the shortlist toggle are not counted: they change the order or
// the scope, not which universities you are considering, and "Clear all
// filters" should not silently throw away a shortlist view.
export function activeFilterCount(state) {
  let n = 0;
  if (state.search.trim()) n++;
  if (state.subjectAreas.size) n++;
  if (state.countries.size) n++;
  if (state.languages.size) n++;
  if (state.degreeTypes.size) n++;
  if (state.cities.size) n++;
  if (state.deadlineWindow !== 'any') n++;
  if (state.maxTuition !== null) n++;
  if (state.myIbPoints !== null) n++;
  if (state.hlMaths) n++;
  return n;
}

export function applyFilters(rows, state, shortlist) {
  const tokens = searchTokens(state.search);

  return rows.filter((row) => {
    if (state.shortlistOnly && !shortlist.has(row.id)) return false;

    if (!tokensMatch(row.searchBlob, tokens)) return false;

    if (state.subjectAreas.size &&
        !row.subjectAreas.some((a) => state.subjectAreas.has(a))) return false;

    if (state.countries.size && !state.countries.has(row.country)) return false;

    if (state.languages.size &&
        !row.languages.some((l) => state.languages.has(l))) return false;

    if (state.degreeTypes.size && row.degreeType && row.degreeType !== '?' &&
        !state.degreeTypes.has(row.degreeType)) return false;
    if (state.cities.size && !row.cityUnknown && row.city && row.city !== '?' &&
        !state.cities.has(row.city)) return false;
    if (state.deadlineWindow !== 'any' && row.daysUntilDeadline !== null) {
      const days = row.daysUntilDeadline;
      if (days < 0 || (state.deadlineWindow !== 'open' && days > Number(state.deadlineWindow))) return false;
    }

    // An unknown value is never a reason to hide a programme. We show it and
    // mark it on the card, so nobody loses an option to a blank spreadsheet cell.
    if (state.maxTuition !== null &&
        row.tuitionEu !== null &&
        row.tuitionEu > state.maxTuition) return false;

    if (pointsBucket(row, state) === 'hidden') return false;

    return true;
  });
}

// ---------------------------------------------------------------- my points

// Where a row stands against "My points" (and the HL Maths 4+ tick):
//   'within'   reached
//   'maths'    an Irish cutoff reached only with the 25 HL Maths bonus points,
//              while the tick is off
//   'unknown'  shown because we cannot tell: no figure, or a cutoff that
//              includes a test, interview or audition (Q5: those never hide)
//   'hidden'   not reached
// or null while My points is empty.
//
// A minimum (non-Irish, UCD, HPAT Medicine) is compared in IB points, as
// before. An Irish cutoff is compared in CAO points: the student's total
// through the CAO table, plus 25 if ticked, against the lower published round.
// The lower round, not Round 1 (the card's headline), because a student who
// met last year's Round 2 cutoff did get a place, and hiding that course would
// lose a real option; on our rows it is also the latest round, which
// ib_points_min comes from (check.mjs asserts it). pointsNote says when Round 2
// decided it.
//
// The bonus is read per student (plans/points-honesty.md, interpretation call
// 1): unticked, a cutoff the student reaches only with +25 stays visible and is
// labelled, not counted as within. So for every total, unticked shows at least
// what the old "ibPointsMin <= my" rule showed, and ticked shows exactly the
// same rows as unticked.
export function pointsBucket(row, state) {
  const my = state.myIbPoints;
  if (my === null) return null;
  if (row.ibPointsMin === null) return 'unknown';
  if (row.pointsKind !== 'cutoff' || !row.cao) return row.ibPointsMin <= my ? 'within' : 'hidden';
  const mine = caoPointsFor(my);
  const lower = lowerRound(row.cao).points;
  if (mine + (state.hlMaths ? MATHS_BONUS_POINTS : 0) >= lower) return 'within';
  if (mine + MATHS_BONUS_POINTS >= lower) return 'maths';
  return row.cao.test ? 'unknown' : 'hidden';
}

// The round with the lowest published cutoff (rounds with no figure, the
// CAO's "every qualified applicant got a place", give no number). On a tie the
// later round, the one ib_points_min was converted from.
export function lowerRound(cao) {
  return cao.rounds.filter((r) => r.points !== null)
    .reduce((low, r) => (r.points <= low.points ? r : low));
}

// The note a card prints while My points is set, or null. Pure, so check.mjs
// can test every sentence without a DOM.
export function pointsNote(row, state) {
  const bucket = pointsBucket(row, state);
  if (bucket === null || bucket === 'hidden') return null;
  if (bucket === 'unknown') {
    return row.ibPointsMin === null
      ? 'Shown despite your points: points unknown.'
      : 'Shown despite your points: the cutoff includes a test, interview or audition.';
  }
  const parts = [];
  if (bucket === 'maths') parts.push('Within your points only with HL Maths 4+.');
  if (roundTwoOnly(row, state)) parts.push('Within your points on the Round 2 cutoff, not Round 1.');
  return parts.length ? parts.join(' ') : null;
}

// The row and the full note must agree when only the later round is reached.
export function roundTwoOnly(row, state) {
  const bucket = pointsBucket(row, state);
  if (!['within', 'maths'].includes(bucket) || row.pointsKind !== 'cutoff' || !row.cao) return false;
  const first = row.cao.rounds.find((r) => r.round === 1 && r.points !== null);
  const bonus = bucket === 'maths' || state.hlMaths ? MATHS_BONUS_POINTS : 0;
  return Boolean(first && caoPointsFor(state.myIbPoints) + bonus < first.points);
}

// The split after the count while My points is set (Q3, P04): how many of the
// shown rows are within, only with HL Maths 4+, or unknown. A zero bucket other
// than "within" is left out. "points unknown", not "publish none": a cutoff
// with a test has a figure, just not one we can compare. Empty when My points
// is empty.
export function pointsSummary(rows, state) {
  return pointsSummaryParts(rows, state).map((p) => p.text).join(' · ');
}

export function pointsSummaryParts(rows, state) {
  if (state.myIbPoints === null) return [];
  const n = { within: 0, maths: 0, unknown: 0 };
  for (const row of rows) {
    const bucket = pointsBucket(row, state);
    if (bucket in n) n[bucket]++;
  }
  const parts = [{ kind: 'fit', text: `${n.within} within your points` }];
  if (n.maths) parts.push({ kind: 'cond', text: `${n.maths} only with HL Maths 4+` });
  if (n.unknown) parts.push({ kind: 'unk', text: `${n.unknown} points unknown` });
  return parts;
}

// ------------------------------------------------------------------- search

// The search used to be one substring over the whole blob, so "computer science
// netherlands" found nothing (the words are in different fields) and "cs"
// matched "Physics" (S01). Now every word must appear, in any order. A word of
// three letters or fewer must start a word in the blob ("cs", "uva", "law"),
// a longer one may appear anywhere. A hyphen or other punctuation starts a new
// word, so "eco" finds "Socio-economic". The exact query token "cs" expands
// to both full words before matching, without changing any row's search blob.
export function matchesSearch(blob, query) {
  return tokensMatch(blob, searchTokens(query));
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SHORT_TOKEN = 3;

function searchTokens(query) {
  return foldAccents(String(query || '')).toLowerCase().split(/\s+/)
    // Leading and trailing punctuation goes ("law," is "law"). A token that is
    // only punctuation, like "&", is dropped rather than failing every row.
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .flatMap((token) => token === 'cs' ? ['computer', 'science'] : [token]);
}

function tokensMatch(blob, tokens) {
  return tokens.every((token) => (token.length > SHORT_TOKEN
    ? blob.includes(token)
    : startsAWord(blob, token)));
}

function startsAWord(blob, token) {
  for (let at = blob.indexOf(token); at !== -1; at = blob.indexOf(token, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(blob[at - 1])) return true;
  }
  return false;
}

// ------------------------------------------------------------- number fields

// My points and Max fee. Anything that is not a whole number in range is
// refused: the filter is not applied and the field says why (P05). It used to
// apply 46, -3 or 36.5 silently, and a typo must never read as 0.
// Returns { value, valid }: value is null when the field is empty or invalid.
export function parsePoints(raw) {
  return wholeNumberIn(raw, 24, 45);
}

export function parseFee(raw) {
  return wholeNumberIn(raw, 0, Infinity);
}

function wholeNumberIn(raw, min, max) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (trimmed === '') return { value: null, valid: true };
  if (!/^\d+$/.test(trimmed)) return { value: null, valid: false };
  const n = Number(trimmed);
  return n >= min && n <= max ? { value: n, valid: true } : { value: null, valid: false };
}

// ----------------------------------------------------------------- address

// The filters live in the address, so a reload keeps them and a filtered view
// can be shared as a link (S03). Short, stable names; a list repeats its name
// (subject=Law&subject=Medicine). The default sort and empty filters are left
// out, so the plain page keeps its plain address.
const DEFAULT_SORT = 'deadline';

export function stateToParams(state) {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.myIbPoints !== null) params.set('points', String(state.myIbPoints));
  if (state.hlMaths) params.set('maths', '1');
  if (state.maxTuition !== null) params.set('fee', String(state.maxTuition));
  for (const v of state.subjectAreas) params.append('subject', v);
  for (const v of state.countries) params.append('country', v);
  for (const v of state.languages) params.append('lang', v);
  for (const v of state.degreeTypes) params.append('degree', v);
  for (const v of state.cities) params.append('city', v);
  if (state.deadlineWindow !== 'any') params.set('deadline', state.deadlineWindow);
  if (state.dir === 'desc') params.set('dir', 'desc');
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  return params.toString();
}

// The reverse, trusting nothing: an address can be edited by hand or be old.
// A number that is not valid, a sort that does not exist, or a subject,
// country or language that is not in the data is dropped, never applied.
// Without facets (before the data has loaded) the lists come back empty.
export function paramsToState(query, facets = null) {
  const params = new URLSearchParams(query);
  const points = parsePoints(params.get('points'));
  const fee = parseFee(params.get('fee'));
  const known = (name, values) => new Set(facets ? params.getAll(name).filter((v) => (values || []).includes(v)) : []);
  const sort = params.get('sort');
  return {
    search: params.get('q') || '',
    myIbPoints: points.valid ? points.value : null,
    // Only "1": a hand-edited "maths=yes" is ignored, like any other bad value.
    hlMaths: params.get('maths') === '1',
    maxTuition: fee.valid ? fee.value : null,
    subjectAreas: known('subject', facets && facets.subjectAreas),
    countries: known('country', facets && facets.countries),
    languages: known('lang', facets && facets.languages),
    degreeTypes: known('degree', facets && facets.degreeTypes),
    cities: known('city', facets && facets.cities),
    deadlineWindow: Object.hasOwn(DEADLINE_WINDOWS, params.get('deadline')) ? params.get('deadline') : 'any',
    dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    sort: Object.hasOwn(SORTS, sort) ? sort : DEFAULT_SORT,
  };
}

// ------------------------------------------------------------------- sorting

export const SORTS = {
  deadline: 'Deadline — soonest first',
  tuition: 'Tuition — cheapest first',
  points: 'IB points — lowest first',
  name: 'University — A to Z',
};

export const REVERSE_SORTS = {
  deadline: 'Deadline — latest first',
  tuition: 'Tuition — highest first',
  points: 'IB points — highest first',
  name: 'University — Z to A',
};

export const DEADLINE_WINDOWS = {
  any: 'Any', open: 'Still open', '30': 'Next 30 days', '60': 'Next 60 days',
};

export function sortRows(rows, key, dir = 'asc') {
  const direction = dir === 'desc' ? -1 : 1;
  const compare = COMPARATORS[key] || COMPARATORS.deadline;
  // Copy first: sort mutates, and the caller owns the full dataset.
  return [...rows].sort((a, b) => compare(a, b, direction) || byName(a, b));
}

const COMPARATORS = {
  // Keep actionable, passed and unknown buckets in that order in both directions.
  deadline(a, b, direction) {
    const rank = (r) => (r.deadline === null ? 2 : r.deadlinePassed ? 1 : 0);
    const difference = rank(a) - rank(b);
    if (difference !== 0) return difference;
    return a.deadline && b.deadline ? (a.deadline - b.deadline) * direction : 0;
  },
  tuition: numericNullsLast('tuitionEu'),
  points: numericNullsLast('ibPointsMin'),
  name: (a, b, direction) => byName(a, b) * direction,
};

// Unknowns stay last even when the known values are reversed.
function numericNullsLast(key) {
  return (a, b, direction) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * direction;
  };
}

function byName(a, b) {
  return a.university.localeCompare(b.university) ||
         a.programme.localeCompare(b.programme);
}

// ------------------------------------------------------------------- facets

// Option lists are built once from the full dataset, so checkboxes never
// disappear underneath you as you narrow things down.
export function buildFacets(rows) {
  const subjectAreas = new Set();
  const countries = new Set();
  const languages = new Set();
  const degreeTypes = new Set();
  const cities = new Set();

  for (const row of rows) {
    row.subjectAreas.forEach((a) => subjectAreas.add(a));
    row.languages.forEach((l) => languages.add(l));
    if (row.country) countries.add(row.country);
    if (row.degreeType && row.degreeType !== '?') degreeTypes.add(row.degreeType);
    if (!row.cityUnknown && row.city && row.city !== '?') cities.add(row.city);
  }

  const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));
  return {
    subjectAreas: sorted(subjectAreas),
    countries: sorted(countries),
    languages: sorted(languages),
    degreeTypes: sorted(degreeTypes),
    cities: sorted(cities),
  };
}
