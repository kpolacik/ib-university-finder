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
    myMaths: null,
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
  if (state.myMaths !== null) n++;
  return n;
}

export function applyFilters(rows, state, shortlist) {
  const needle = foldAccents(state.search.trim()).toLowerCase();

  return rows.filter((row) => {
    if (state.shortlistOnly && !shortlist.has(row.id)) return false;

    if (needle && !row.searchBlob.includes(needle)) return false;

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

    // Same rule: a programme whose maths requirement nobody has checked stays.
    if (state.myMaths !== null &&
        row.mathsAccepted !== null &&
        !row.mathsAccepted.includes(state.myMaths)) return false;

    return true;
  });
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
