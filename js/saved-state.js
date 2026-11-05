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
  return out;
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
