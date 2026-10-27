// Wires the data layer to the filter state to the DOM.

import { loadData } from './data.js';
import {
  createFilterState, applyFilters, sortRows, buildFacets, activeFilterCount, SORTS,
} from './filters.js';
import { loadShortlist, saveShortlist, toCsv, downloadCsv } from './shortlist.js';
import {
  renderCards, renderChips, renderSortOptions, renderSourceBanner, renderIssues,
} from './render.js';

const dom = {
  banner: document.getElementById('source-banner'),
  dropdowns: [...document.querySelectorAll('.dropdown')],
  subjectsCount: document.getElementById('dd-subjects-count'),
  countriesCount: document.getElementById('dd-countries-count'),
  languagesCount: document.getElementById('dd-languages-count'),
  search: document.getElementById('f-search'),
  points: document.getElementById('f-points'),
  tuition: document.getElementById('f-tuition'),
  maths: document.getElementById('f-maths'),
  exam: document.getElementById('f-exam'),
  subjects: document.getElementById('f-subjects'),
  countries: document.getElementById('f-countries'),
  languages: document.getElementById('f-languages'),
  clear: document.getElementById('f-clear'),
  sort: document.getElementById('f-sort'),
  count: document.getElementById('result-count'),
  loading: document.getElementById('loading'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyHint: document.getElementById('empty-hint'),
  shortlistBar: document.getElementById('shortlist-bar'),
  // The <p> holds an icon as well, so the text goes in its own span rather
  // than through textContent on the parent, which would wipe the icon.
  shortlistCount: document.getElementById('shortlist-count-text'),
  mastheadStat: document.getElementById('masthead-stat'),
  shortlistOnly: document.getElementById('f-shortlist-only'),
  exportCsv: document.getElementById('export-csv'),
  print: document.getElementById('print-shortlist'),
  clearShortlist: document.getElementById('clear-shortlist'),
  issues: document.getElementById('issues'),
  issuesSummary: document.getElementById('issues-summary'),
  issuesList: document.getElementById('issues-list'),
};

const state = createFilterState();
const shortlist = loadShortlist();
let allRows = [];
let facets = { subjectAreas: [], countries: [], languages: [] };
let currentlyShown = 0;

start();

async function start() {
  wireDropdowns();
  dom.results.setAttribute('aria-busy', 'true');

  try {
    const { programmes, meta } = await loadData();
    allRows = programmes;

    renderSourceBanner(dom.banner, meta);
    renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, meta.issues);
    renderSortOptions(dom.sort, SORTS, state.sort);

    facets = buildFacets(allRows);
    drawChips();
    renderMastheadStat();

    wireInputs();
    update();
  } catch (err) {
    dom.banner.className = 'banner banner-danger';
    dom.banner.textContent = `Could not load any university data (${err.message}). Try reloading.`;
    dom.banner.hidden = false;
  } finally {
    dom.loading.hidden = true;
    dom.results.removeAttribute('aria-busy');
  }
}

function drawChips() {
  renderChips(dom.subjects, facets.subjectAreas, state.subjectAreas, toggle(state.subjectAreas));
  renderChips(dom.countries, facets.countries, state.countries, toggle(state.countries));
  renderChips(dom.languages, facets.languages, state.languages, toggle(state.languages));
}

// The scale of the dataset, stated once in the masthead. Counted from the rows
// actually loaded, so it can never drift from what the page is showing.
function renderMastheadStat() {
  const universities = new Set(allRows.map((r) => r.university)).size;
  const countries = new Set(allRows.map((r) => r.country).filter(Boolean)).size;
  dom.mastheadStat.textContent =
    `${allRows.length} programmes · ${universities} universities · ${countries} countries`;
}

function toggle(set) {
  return (value, checked) => {
    if (checked) set.add(value); else set.delete(value);
    update();
  };
}

function wireInputs() {
  dom.search.addEventListener('input', debounce(() => {
    state.search = dom.search.value;
    update();
  }, 150));

  // Debounced like the search box: typing "3000" otherwise renders four times,
  // and the intermediate "under €3" and "under €30" states flash an empty list.
  dom.points.addEventListener('input', debounce(() => {
    state.myIbPoints = wholeNumber(dom.points.value);
    update();
  }, 150));

  dom.tuition.addEventListener('input', debounce(() => {
    state.maxTuition = wholeNumber(dom.tuition.value);
    update();
  }, 150));

  dom.maths.addEventListener('change', () => {
    state.myMaths = dom.maths.value || null;
    update();
  });

  dom.exam.addEventListener('change', () => {
    state.exam = dom.exam.value || null;
    update();
  });

  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    update();
  });

  dom.clear.addEventListener('click', () => {
    state.search = '';
    state.maxTuition = null;
    state.myIbPoints = null;
    state.myMaths = null;
    state.exam = null;
    state.subjectAreas.clear();
    state.countries.clear();
    state.languages.clear();

    dom.search.value = '';
    dom.points.value = '';
    dom.tuition.value = '';
    dom.maths.value = '';
    dom.exam.value = '';
    // Re-render the chips rather than reaching into render.js's markup with a
    // selector — a class rename there would silently break unchecking here.
    drawChips();

    update();
  });

  dom.shortlistOnly.addEventListener('change', () => {
    state.shortlistOnly = dom.shortlistOnly.checked;
    update();
  });

  dom.exportCsv.addEventListener('click', () => {
    const rows = sortRows(allRows.filter((r) => shortlist.has(r.id)), state.sort);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`my-shortlist-${stamp}.csv`, toCsv(rows));
  });

  // Printing is scoped to the shortlist by the print stylesheet, so this only
  // has to make sure the starred cards are the ones on screen.
  dom.print.addEventListener('click', () => {
    if (!state.shortlistOnly) {
      state.shortlistOnly = true;
      dom.shortlistOnly.checked = true;
      update();
    }
    window.print();
  });

  dom.clearShortlist.addEventListener('click', () => {
    const total = shortlist.size;
    if (total === 0) return;
    if (!window.confirm(`Remove all ${total} saved ${plural(total)} from your shortlist?`)) return;
    shortlist.clear();
    saveShortlist(shortlist);
    state.shortlistOnly = false;
    dom.shortlistOnly.checked = false;
    update();
  });
}

// Returns the new starred state so the card can update itself in place.
function onToggleStar(id) {
  const starred = !shortlist.has(id);
  if (starred) shortlist.add(id); else shortlist.delete(id);

  if (!saveShortlist(shortlist)) {
    dom.shortlistCount.textContent =
      'Your browser is blocking storage, so this list will disappear when you close the tab.';
    return starred;
  }

  // Only a full rebuild when the row has to leave the list.
  if (state.shortlistOnly) update(); else renderCounts(currentlyShown);
  return starred;
}

function update() {
  // Turning off an empty shortlist view belongs here, before rendering — not
  // as a side effect hidden inside the count update.
  if (state.shortlistOnly && shortlist.size === 0) {
    state.shortlistOnly = false;
    dom.shortlistOnly.checked = false;
  }

  const rows = sortRows(applyFilters(allRows, state, shortlist), state.sort);
  currentlyShown = rows.length;

  renderCards(dom.results, rows, { state, shortlist, onToggleStar });
  renderEmptyState(rows.length);
  renderCounts(rows.length);
}

function renderCounts(shown) {
  const active = activeFilterCount(state);
  const scope = state.shortlistOnly ? ' in your shortlist' : '';

  dom.count.textContent = active === 0 && !state.shortlistOnly
    ? `${shown} ${plural(shown)}`
    : `${shown} of ${allRows.length} ${plural(allRows.length)}${scope}`;

  // Each pick-list button shows how many of its values are ticked, so a closed
  // drop-down still tells you it is narrowing the results.
  dom.subjectsCount.textContent = state.subjectAreas.size || '';
  dom.countriesCount.textContent = state.countries.size || '';
  dom.languagesCount.textContent = state.languages.size || '';
  dom.clear.disabled = active === 0;

  const saved = shortlist.size;
  // Always hidden. The per-card save button was removed on 2026-10-24, so
  // nothing can be added to the shortlist any more; a list saved before then
  // would otherwise bring the bar back with no way to manage it. The shortlist
  // code is left in place so the feature can return by restoring the button.
  dom.shortlistBar.hidden = true;
  if (saved > 0) dom.shortlistCount.textContent = `${saved} saved ${plural(saved)}`;
}

function renderEmptyState(shown) {
  if (shown > 0) {
    dom.empty.hidden = true;
    return;
  }
  dom.empty.hidden = false;

  if (state.shortlistOnly && shortlist.size === 0) {
    dom.emptyTitle.textContent = 'Your shortlist is empty.';
    dom.emptyHint.textContent = 'Use the bookmark button on any programme to save it here.';
  } else if (activeFilterCount(state) === 0) {
    dom.emptyTitle.textContent = 'No programmes in the spreadsheet yet.';
    dom.emptyHint.textContent = 'Add some rows to the Google Sheet and reload.';
  } else {
    dom.emptyTitle.textContent = 'No programmes match these filters.';
    dom.emptyHint.textContent = 'Try raising the tuition limit, or removing a country.';
  }
}

// The pick-lists are native <details>, so they open and close from the keyboard
// with no help. This adds what <details> does not do on its own: only one open
// at a time, and closing on a click outside or on Escape.
function wireDropdowns() {
  const closeAll = (except) => {
    for (const d of dom.dropdowns) if (d !== except) d.open = false;
  };
  for (const d of dom.dropdowns) {
    d.addEventListener('toggle', () => { if (d.open) closeAll(d); });
  }
  document.addEventListener('click', (event) => {
    if (!dom.dropdowns.some((d) => d.contains(event.target))) closeAll();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = dom.dropdowns.find((d) => d.open);
    if (!open) return;
    open.open = false;
    open.querySelector('summary').focus();
  });
}

function plural(n) {
  return n === 1 ? 'programme' : 'programmes';
}

function wholeNumber(value) {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
