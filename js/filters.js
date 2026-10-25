// Pure functions: given rows and a filter state, give back the rows that match,
// in the requested order. No DOM in here, so this stays easy to reason about.

import { foldAccents } from './data.js';

export function createFilterState() {
  return {
    search: '',
    subjectAreas: new Set(),
    countries: new Set(),
    languages: new Set(),
    maxTuition: null,
    myIbPoints: null,
    shortlistOnly: false,
    sort: 'deadline',
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
  if (state.maxTuition !== null) n++;
  if (state.myIbPoints !== null) n++;
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

    // An unknown value is never a reason to hide a programme. We show it and
    // mark it on the card, so nobody loses an option to a blank spreadsheet cell.
    if (state.maxTuition !== null &&
        row.tuitionEu !== null &&
        row.tuitionEu > state.maxTuition) return false;

    if (state.myIbPoints !== null &&
        row.ibPointsMin !== null &&
        row.ibPointsMin > state.myIbPoints) return false;

    return true;
  });
}

// ------------------------------------------------------------------- search

// The search used to be one substring over the whole blob, so "computer science
// netherlands" found nothing (the words are in different fields) and "cs"
// matched "Physics" (S01). Now every word must appear, in any order. A word of
// three letters or fewer must start a word in the blob ("cs", "uva", "law"),
// a longer one may appear anywhere. A hyphen or other punctuation starts a new
// word, so "eco" finds "Socio-economic".
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
    .filter(Boolean);
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

// ------------------------------------------------------------------- sorting

export const SORTS = {
  deadline: 'Deadline — soonest first',
  tuition: 'Tuition — cheapest first',
  points: 'IB points — lowest first',
  name: 'University — A to Z',
};

export function sortRows(rows, key) {
  const compare = COMPARATORS[key] || COMPARATORS.deadline;
  // Copy first: sort mutates, and the caller owns the full dataset.
  return [...rows].sort((a, b) => compare(a, b) || byName(a, b));
}

const COMPARATORS = {
  // A date you can still act on is worth more than one you cannot, so passed
  // deadlines sink below every live one instead of dominating the top.
  deadline(a, b) {
    const rank = (r) => (r.deadline === null ? 2 : r.deadlinePassed ? 1 : 0);
    const difference = rank(a) - rank(b);
    if (difference !== 0) return difference;
    if (a.deadline && b.deadline) return a.deadline - b.deadline;
    return 0;
  },
  tuition: numericNullsLast('tuitionEu'),
  points: numericNullsLast('ibPointsMin'),
  name: () => 0,
};

// "Not published" sorts last rather than as zero — otherwise every unknown fee
// would masquerade as the cheapest option in the list.
function numericNullsLast(key) {
  return (a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
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

  for (const row of rows) {
    row.subjectAreas.forEach((a) => subjectAreas.add(a));
    row.languages.forEach((l) => languages.add(l));
    if (row.country) countries.add(row.country);
  }

  const sorted = (set) => [...set].sort((a, b) => a.localeCompare(b));
  return {
    subjectAreas: sorted(subjectAreas),
    countries: sorted(countries),
    languages: sorted(languages),
  };
}
