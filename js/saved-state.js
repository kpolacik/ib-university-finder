import { createFilterState, paramsToState, parsePoints, parseEuros } from './filters.js';

export const FILTER_KEY = 'ibuf.filters.v1';
export const ONBOARDING_KEY = 'ibuf.onboarding.v1';
export const FACET_FIELDS = ['subjectAreas', 'countries', 'languages', 'degreeTypes', 'cities'];
const PARAMS = ['q', 'points', 'maths', 'mymaths', 'exam', 'fee', 'budget', 'living', 'subject', 'country', 'lang', 'degree', 'city', 'deadline', 'sort', 'dir', 'list'];

export function hasFilterParams(query) {
  const params = new URLSearchParams(query);
  return PARAMS.some((key) => params.has(key));
}

// Only these fourteen fields cross the storage boundary. The existing URL
// parser validates enum values; numbers must also have the correct JSON type.
export function validateFilters(raw, facets = null) {
  const out = createFilterState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (typeof raw.search === 'string') out.search = raw.search;
  out.hlMaths = raw.hlMaths === true;
  for (const [key, parse] of [['myIbPoints', parsePoints], ['maxTuition', parseEuros], ['maxBudget', parseEuros], ['myLiving', parseEuros]]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && parse(value).valid) out[key] = value;
  }
  const enums = paramsToState(new URLSearchParams({ mymaths: typeof raw.myMaths === 'string' ? raw.myMaths : '', exam: typeof raw.exam === 'string' ? raw.exam : '', deadline: typeof raw.deadlineWindow === 'string' ? raw.deadlineWindow : '' }));
  for (const key of ['myMaths', 'exam', 'deadlineWindow']) out[key] = enums[key];
  for (const key of FACET_FIELDS) {
    const values = raw[key] instanceof Set ? [...raw[key]] : Array.isArray(raw[key]) ? raw[key] : [];
    out[key] = new Set(values.filter((v) => typeof v === 'string' && v && (!facets || (facets[key] || []).includes(v))));
  }
  // Sort is never written to preferences, but validate older/incoming snapshots.
  const order = paramsToState(new URLSearchParams({ sort: typeof raw.sort === 'string' ? raw.sort : '', dir: raw.dir === 'desc' ? 'desc' : '', points: out.myIbPoints ?? '' }));
  out.sort = order.sort; out.dir = order.dir;
  return out;
}

// True when the setup answers set at least one of its own five questions.
// Clicking through setup without choosing anything applies nothing, so the
// "Your answers are now filters" toast would be wrong (Leon, 2026-11-05).
// Filters setup does not ask about (city, search…) do not count.
export function hasSetupAnswers(answers) {
  return answers.myIbPoints !== null || answers.hlMaths === true || answers.maxBudget !== null
    || ['subjectAreas', 'countries', 'languages'].some((key) => answers[key].size > 0);
}

export function storedFilters(state, facets) {
  const clean = validateFilters(state, facets);
  const { shortlistOnly, sort, dir, ...filters } = clean;
  for (const key of FACET_FIELDS) filters[key] = [...filters[key]];
  return { version: 1, filters };
}

export function restoration(query, stored, dismissed = false) {
  if (hasFilterParams(query)) return { source: 'url', state: paramsToState(query), onboarding: false };
  const valid = stored?.version === 1 && stored.filters && typeof stored.filters === 'object' && !Array.isArray(stored.filters);
  return { source: valid ? 'saved' : 'defaults', state: validateFilters(valid ? stored.filters : null), onboarding: !valid && !dismissed };
}

// Validate the current sets, rather than reapplying the snapshot: any changes
// made while loading survive, and only values absent from the real data go.
export function validateLoadedFacets(state, facets) {
  const clean = validateFilters(state, facets);
  for (const key of FACET_FIELDS) {
    state[key].clear();
    for (const value of clean[key]) state[key].add(value);
  }
  return state;
}
