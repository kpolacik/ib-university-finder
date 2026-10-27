// Wires the data layer to the filter state to the DOM.

import { loadData, applyToday } from './data.js';
import {
  createFilterState, applyFilters, sortRows, buildFacets, activeFilterCount, SORTS,
  parsePoints, parseFee, stateToParams, paramsToState, pointsSummaryParts,
} from './filters.js';
import { loadShortlist, saveShortlist, toCsv, downloadCsv } from './shortlist.js';
import {
  renderRows, renderSlot, renderPane, renderCount, renderChips, renderSortOptions, renderSourceLine, renderSourceBanner, renderIssues,
} from './render.js';

const dom = {
  banner: document.getElementById('source-banner'),
  form: document.getElementById('filter-form'),
  status: document.querySelector('.status'),
  listp: document.querySelector('.listp'),
  sortButtons: [...document.querySelectorAll('.cols [data-sort]')],
  dropdowns: [...document.querySelectorAll('.dropdown')],
  // Each count is the number plus a hidden " selected", so a screen reader
  // names the button "Subject area 2 selected" rather than "Subject area 2"
  // (A06). No hidden comma: the browser already puts a space between the label
  // and the count, so a comma read
  // "Subject area , 2 selected". Only the number is written; the box is hidden
  // at 0.
  subjectsCount: document.getElementById('dd-subjects-count'),
  countriesCount: document.getElementById('dd-countries-count'),
  languagesCount: document.getElementById('dd-languages-count'),
  subjectsCountNumber: document.getElementById('dd-subjects-count-number'),
  countriesCountNumber: document.getElementById('dd-countries-count-number'),
  languagesCountNumber: document.getElementById('dd-languages-count-number'),
  search: document.getElementById('f-search'),
  points: document.getElementById('f-points'),
  maths: document.getElementById('f-maths'),
  tuition: document.getElementById('f-tuition'),
  subjects: document.getElementById('f-subjects'),
  countries: document.getElementById('f-countries'),
  languages: document.getElementById('f-languages'),
  clear: document.getElementById('f-clear'),
  sort: document.getElementById('f-sort'),
  count: document.getElementById('result-count'),
  loading: document.getElementById('loading'),
  results: document.getElementById('results'),
  resultsSection: document.querySelector('section[aria-labelledby="results-h"]'),
  pane: document.getElementById('pane'),
  paneHeading: document.getElementById('pane-h'),
  paneBody: document.querySelector('.pane-body'),
  empty: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyHint: document.getElementById('empty-hint'),
  emptyClear: document.getElementById('empty-clear'),
  emptyTips: document.getElementById('empty-tips'),
  pointsError: document.getElementById('f-points-error'),
  tuitionError: document.getElementById('f-tuition-error'),
  shortlistBar: document.getElementById('shortlist-bar'),
  // The <p> holds an icon as well, so the text goes in its own span rather
  // than through textContent on the parent, which would wipe the icon.
  shortlistCount: document.getElementById('shortlist-count-text'),
  sourceLine: document.getElementById('source-line'),
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
// The "within / only with HL Maths 4+ / points unknown" split of the rows on
// screen, worked out in update() so a count-only refresh can reuse it.
let currentSummary = [];
const openIds = new Set();
const wideQuery = matchMedia('(min-width: 1024px)');
let selectedId = null;
let shownRows = new Map();
let appliedWide = null;
let paneId = null;
let crossingFocus = null;
// False until the data is in. The inputs are live from the start so nothing
// typed during loading is lost (S04), but update() must not draw anything
// before then: with no rows it would flash "No programmes match".
let loaded = false;
// The local date the deadline fields were last worked out for (S06).
let dataDay = localDay(new Date());

start();

async function start() {
  dom.banner.addEventListener('click', openIssuesFromLink);
  wireDropdowns();
  applyUrlFields();
  syncSort();
  wireInputs();
  dom.results.addEventListener('click', toggleRow);
  dom.results.addEventListener('keydown', rowKeydown);
  wideQuery.addEventListener('change', crossWide);
  document.addEventListener('focusin', rememberFocus);
  document.addEventListener('focusout', forgetFocus);
  dom.results.setAttribute('aria-busy', 'true');

  try {
    dataDay = localDay(new Date());
    const { programmes, meta } = await loadData();
    allRows = programmes;

    renderSourceBanner(dom.banner, meta);
    renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, meta.issues);
    renderSortOptions(dom.sort, SORTS, state.sort);
    syncSort();

    facets = buildFacets(allRows);
    applyUrlLists();
    drawChips();
    renderSourceLine(dom.sourceLine, allRows, meta);

    // Whatever was typed while the data loaded is in the fields, not yet in
    // the state, because update() ignored it until now.
    readFields();
    loaded = true;
    update();
  } catch (err) {
    showTotalFailure(err);
  } finally {
    dom.loading.hidden = true;
    dom.results.removeAttribute('aria-busy');
  }
}

// A shared or reloaded address brings its filters back (S03). The text and
// number fields are filled before loading starts, so anything typed while the
// data loads overwrites them and wins; readFields() picks up whichever is
// there. The sort is set now so the menu is built with it.
function applyUrlFields() {
  const fromUrl = paramsToState(location.search);
  dom.search.value = fromUrl.search;
  if (fromUrl.myIbPoints !== null) dom.points.value = String(fromUrl.myIbPoints);
  dom.maths.checked = fromUrl.hlMaths;
  if (fromUrl.maxTuition !== null) dom.tuition.value = String(fromUrl.maxTuition);
  state.sort = fromUrl.sort;
}

// Subjects, countries and languages can only be checked against the data,
// so they wait for it; a value not in the data is dropped.
function applyUrlLists() {
  const fromUrl = paramsToState(location.search, facets);
  fromUrl.subjectAreas.forEach((v) => state.subjectAreas.add(v));
  fromUrl.countries.forEach((v) => state.countries.add(v));
  fromUrl.languages.forEach((v) => state.languages.add(v));
}

// replaceState, not pushState: one history entry per keystroke would make the
// Back button step through every letter typed.
function keepAddress() {
  const query = stateToParams(state);
  const search = query ? `?${query}` : '';
  if (search === location.search) return;
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
}

// Nothing could be loaded, not even the saved copy (L07). The banner used to
// print the raw JavaScript error. Now it says what happened in one plain
// sentence, offers a Reload, and the reasons go to the problems panel for
// whoever maintains the Sheet. The filters and the empty Sort menu are
// hidden: there is nothing to filter or sort.
function showTotalFailure(err) {
  loaded = false;
  dom.pane.hidden = true;
  const alert = document.createElement('div');
  alert.className = 'bn bn-fail';
  alert.setAttribute('role', 'alert');
  const sentence = document.createElement('p');
  sentence.textContent = 'Could not load the programme list. Check your connection and reload the page.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn-p';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  alert.append(sentence, reload);
  dom.banner.replaceChildren(alert);
  dom.sourceLine.hidden = true;
  dom.banner.hidden = false;
  dom.form.hidden = true;
  dom.status.hidden = true;
  dom.listp.hidden = true;
  renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, err.reasons || [err.message]);
}

// The banner's "see the list" link points at #issues, a closed <details>.
// Following it opens the list, or the reader lands on a bare summary line (L06).
function openIssuesFromLink(event) {
  if (event.target.closest('a[href="#issues"]')) dom.issues.open = true;
}

function drawChips() {
  renderChips(dom.subjects, facets.subjectAreas, state.subjectAreas, toggle(state.subjectAreas));
  renderChips(dom.countries, facets.countries, state.countries, toggle(state.countries));
  renderChips(dom.languages, facets.languages, state.languages, toggle(state.languages));
}

function toggle(set) {
  return (value, checked) => {
    if (checked) set.add(value); else set.delete(value);
    update();
  };
}

// Reads the text and number fields into the state. Used by their handlers and
// once after loading, for anything typed while the data was on its way.
function readFields() {
  state.search = dom.search.value;
  state.myIbPoints = readNumber(dom.points, dom.pointsError, parsePoints,
    'Enter a whole number from 24 to 45.');
  state.hlMaths = dom.maths.checked;
  state.maxTuition = readNumber(dom.tuition, dom.tuitionError, parseFee,
    'Enter a whole number of euros, 0 or more.');
}

// An invalid number is never applied, and never treated as 0 or as empty: the
// field is marked invalid and says why (P05). A number field gives back '' for
// text the browser cannot parse ("abc", a lone "-"), so badInput is checked
// too, or that text would quietly count as an empty field.
function readNumber(input, message, parse, explanation) {
  const { value, valid } = parse(input.value);
  const ok = valid && !input.validity.badInput;
  if (ok) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true');
  const text = ok ? '' : explanation;
  if (message.textContent !== text) message.textContent = text;
  return ok ? value : null;
}

function wireInputs() {
  dom.search.addEventListener('input', debounce(() => {
    state.search = dom.search.value;
    update();
  }, 150));

  // Debounced like the search box: typing "3000" otherwise renders four times,
  // and the intermediate "under €3" and "under €30" states flash an empty list.
  dom.points.addEventListener('input', debounce(() => {
    state.myIbPoints = readNumber(dom.points, dom.pointsError, parsePoints,
      'Enter a whole number from 24 to 45.');
    update();
  }, 150));

  dom.maths.addEventListener('change', () => {
    state.hlMaths = dom.maths.checked;
    update();
  });

  dom.tuition.addEventListener('input', debounce(() => {
    state.maxTuition = readNumber(dom.tuition, dom.tuitionError, parseFee,
      'Enter a whole number of euros, 0 or more.');
    update();
  }, 150));

  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    syncSort();
    update();
  });

  for (const button of dom.sortButtons) {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sort === key) return;
      state.sort = key;
      syncSort();
      update();
    });
  }

  dom.clear.addEventListener('click', clearAll);
  dom.emptyClear.addEventListener('click', clearAll);

  // A tab left open overnight: work the deadlines out again when it comes
  // back into view on a new day. No timer; any input does the same (S06).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loaded && localDay(new Date()) !== dataDay) update();
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

function clearAll() {
  state.search = '';
  state.maxTuition = null;
  state.myIbPoints = null;
  state.subjectAreas.clear();
  state.countries.clear();
  state.languages.clear();

  dom.search.value = '';
  dom.points.value = '';
  dom.maths.checked = false;
  dom.tuition.value = '';
  readFields();
  // Re-render the chips rather than reaching into render.js's markup with a
  // selector — a class rename there would silently break unchecking here.
  drawChips();

  update();
}

function update() {
  if (!loaded) return;
  // A debounced filter can land after the viewport crosses 1024 but before the
  // change event. Finish the crossing first, or the pick stays in the hidden pane.
  if (appliedWide !== null && appliedWide !== wideQuery.matches) crossWide();

  const focus = snapshotFocus();

  // Deadlines are "today"-relative, so a new local day means working them out
  // again before filtering and sorting (S06).
  const now = new Date();
  if (localDay(now) !== dataDay) {
    applyToday(allRows, now);
    dataDay = localDay(now);
  }

  // Turning off an empty shortlist view belongs here, before rendering — not
  // as a side effect hidden inside the count update.
  if (state.shortlistOnly && shortlist.size === 0) {
    state.shortlistOnly = false;
    dom.shortlistOnly.checked = false;
  }

  const rows = sortRows(applyFilters(allRows, state, shortlist), state.sort);
  currentlyShown = rows.length;
  currentSummary = pointsSummaryParts(rows, state);

  renderRows(dom.results, rows, { state, shortlist, onToggleStar, wide: wideQuery.matches });
  shownRows = new Map(rows.map((row) => [row.id, row]));
  appliedWide = wideQuery.matches;
  if (appliedWide) {
    openIds.clear();
    decorateSelection();
    drawPane();
  } else {
    for (const id of openIds) if (!shownRows.has(id)) openIds.delete(id);
    for (const item of dom.results.children) {
      if (openIds.has(item.dataset.id)) openRow(item, shownRows.get(item.dataset.id));
    }
  }
  renderEmptyState(rows.length);
  restoreFocus(focus);
  renderCounts(rows.length);
  keepAddress();
}

function openRow(item, row) {
  const slot = renderSlot(row, state);
  item.append(slot);
  item.classList.add('is-open');
  const button = item.querySelector('button.open');
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', slot.id);
}

function toggleRow(event) {
  const goto = event.target.closest('a.goto');
  if (goto) {
    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      dom.pane.focus();
    }
    return;
  }
  const button = event.target.closest('button.open');
  if (!button) return;
  const item = button.closest('li.item');
  const id = item.dataset.id;
  if (wideQuery.matches) {
    selectRow(id);
  } else if (openIds.has(id)) {
    button.removeAttribute('aria-controls');
    item.querySelector('.expand').remove();
    item.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    openIds.delete(id);
    if (selectedId === id) selectedId = [...openIds].at(-1) ?? null;
  } else {
    openRow(item, shownRows.get(id));
    openIds.add(id);
    selectedId = id;
  }
}

function clearSelection() {
  const old = dom.results.querySelector('li.is-sel');
  if (!old) return;
  old.classList.remove('is-sel');
  old.querySelector('button.open').removeAttribute('aria-current');
  old.querySelector('a.goto')?.remove();
}

function selectedItem(id = selectedId) {
  return [...dom.results.children].find((item) => item.dataset.id === id);
}

function decorateSelection() {
  clearSelection();
  const item = selectedItem();
  if (!item) return;
  item.classList.add('is-sel');
  item.querySelector('button.open').setAttribute('aria-current', 'true');
  const goto = document.createElement('a');
  goto.className = 'goto';
  goto.setAttribute('href', '#pane');
  goto.textContent = 'Go to details';
  item.append(goto);
}

function drawPane() {
  const scroll = paneId === selectedId ? dom.pane.scrollTop : 0;
  const row = allRows.find((row) => row.id === selectedId) ?? null;
  renderPane({ pane: dom.pane, heading: dom.paneHeading, body: dom.paneBody }, row, shownRows.has(selectedId), state);
  paneId = selectedId;
  dom.pane.scrollTop = Math.max(0, Math.min(scroll, dom.pane.scrollHeight - dom.pane.clientHeight));
}

function selectRow(id) {
  const focus = snapshotFocus();
  selectedId = id;
  decorateSelection();
  drawPane();
  restoreFocus(focus);
}

function rowKeydown(event) {
  if (!wideQuery.matches || !event.target.matches('button.open') || event.isComposing
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const item = event.target.closest('li.item');
  const next = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
  if (!next) return;
  next.querySelector('button.open').focus();
  selectRow(next.dataset.id);
}

// Describe focus before removing a subtree: afterward activeElement can be body.
function snapshotFocus() {
  const active = document.activeElement;
  const item = active.closest('li.item');
  const id = item?.dataset.id;
  if (active.matches('button.open') && item) return { kind: 'row', id };
  if (active.matches('a.goto') && item) return { kind: 'goto', id };
  const inPane = dom.pane.contains(active);
  const inSlot = active.closest('.expand');
  if (!inPane && !inSlot) return null;
  const link = active.closest('a');
  return { kind: inPane ? 'pane' : 'slot', id: inPane ? paneId : id,
    href: link ? link.href || link.getAttribute('href') : null, text: link?.textContent };
}

function equivalentLink(root, focus) {
  return root && focus.href ? [...root.querySelectorAll('a')].find((link) =>
    (link.href || link.getAttribute('href')) === focus.href && link.textContent === focus.text) : null;
}

function focusResults() {
  (dom.listp.hidden ? dom.resultsSection : dom.results).focus({ preventScroll: true });
}

function restoreFocus(focus) {
  if (!focus) return;
  const item = selectedItem(focus.id);
  const button = item?.querySelector('button.open');
  let target;
  if (focus.kind === 'row') target = button;
  else if (focus.kind === 'goto') target = item?.querySelector('a.goto') ?? button;
  else if (wideQuery.matches) {
    target = focus.kind === 'pane' || focus.id === selectedId
      ? (focus.id === selectedId ? equivalentLink(dom.paneBody, focus) : null) ?? dom.pane
      : button;
  } else {
    target = equivalentLink(item?.querySelector('.expand'), focus) ?? button;
  }
  if (target) target.focus({ preventScroll: true });
  else focusResults();
}

// Chrome can clear focus when CSS hides the pane, before the change callback.
// Real focus moves or a blur within the current layout invalidate this record.
function rememberFocus() {
  crossingFocus = snapshotFocus();
}

function forgetFocus(event) {
  if (event.relatedTarget || appliedWide === wideQuery.matches) crossingFocus = null;
}

function crossWide() {
  const wide = wideQuery.matches;
  if (!loaded || appliedWide === wide) return;
  const focus = snapshotFocus() ?? (document.activeElement === document.body ? crossingFocus : null);
  clearSelection();
  if (wide) {
    for (const item of dom.results.children) {
      const button = item.querySelector('button.open');
      button.removeAttribute('aria-controls');
      item.querySelector('.expand')?.remove();
      item.classList.remove('is-open');
      button.removeAttribute('aria-expanded');
      button.setAttribute('aria-controls', 'pane');
    }
    openIds.clear();
    decorateSelection();
    drawPane();
  } else {
    for (const button of dom.results.querySelectorAll('button.open')) {
      button.removeAttribute('aria-controls');
      button.setAttribute('aria-expanded', 'false');
    }
    // Remove the full article before connecting its reduced slot form.
    renderPane({ pane: dom.pane, heading: dom.paneHeading, body: dom.paneBody }, null, false, state);
    paneId = null;
    openIds.clear();
    const item = selectedItem();
    if (item) {
      openRow(item, shownRows.get(selectedId));
      openIds.add(selectedId);
    }
  }
  appliedWide = wide;
  restoreFocus(focus);
  rememberFocus();
}

function syncSort() {
  const directions = { name: 'by university, A to Z', points: 'lowest first', deadline: 'soonest first', tuition: 'cheapest first' };
  dom.sort.value = state.sort;
  for (const button of dom.sortButtons) {
    const active = button.dataset.sort === state.sort;
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('.visually-hidden').textContent = `, ${active ? 'sorted' : 'sort'} ${directions[button.dataset.sort]}`;
    button.querySelector('.dir').hidden = !active;
    button.querySelector('svg').hidden = active;
  }
}

function renderCounts(shown) {
  const active = activeFilterCount(state);
  const scope = state.shortlistOnly ? ' in your shortlist' : '';

  const lead = active === 0 && !state.shortlistOnly
    ? `${shown} ${plural(shown)}`
    : `${shown} of ${allRows.length} ${plural(allRows.length)}${scope}`;
  // The count is a live region. Rewriting it with the same text on every
  // keystroke made a screen reader repeat it (A06), so only a change is written.
  renderCount(dom.count, lead, currentSummary);

  // Each pick-list button shows how many of its values are ticked, so a closed
  // drop-down still tells you it is narrowing the results.
  showCount(dom.subjectsCount, dom.subjectsCountNumber, state.subjectAreas.size);
  showCount(dom.countriesCount, dom.countriesCountNumber, state.countries.size);
  showCount(dom.languagesCount, dom.languagesCountNumber, state.languages.size);
  dom.clear.disabled = active === 0;

  const saved = shortlist.size;
  // Always hidden. The per-card save button was removed on 2026-10-24, so
  // nothing can be added to the shortlist any more; a list saved before then
  // would otherwise bring the bar back with no way to manage it. The shortlist
  // code is left in place so the feature can return by restoring the button.
  dom.shortlistBar.hidden = true;
  if (saved > 0) dom.shortlistCount.textContent = `${saved} saved ${plural(saved)}`;
}

function showCount(box, number, n) {
  box.hidden = n === 0;
  number.textContent = n || '';
}

function renderEmptyState(shown) {
  dom.listp.hidden = shown === 0;
  if (shown > 0) {
    dom.empty.hidden = true;
    return;
  }
  dom.empty.hidden = false;
  dom.emptyClear.hidden = true;
  dom.emptyTips.hidden = true;

  if (state.shortlistOnly && shortlist.size === 0) {
    dom.emptyTitle.textContent = 'Your shortlist is empty.';
    dom.emptyHint.textContent = 'Use the bookmark button on any programme to save it here.';
  } else if (activeFilterCount(state) === 0) {
    // The old hint told students to add rows to the spreadsheet, which they
    // never see (S05). With no filter set, the list itself is missing.
    dom.emptyTitle.textContent = 'No programmes to show.';
    dom.emptyHint.textContent = 'The programme list could not be loaded. Try reloading the page.';
  } else {
    // Name only the filters actually in use; the old fixed hint suggested the
    // tuition limit and countries even when neither was set (S05).
    dom.emptyTitle.textContent = 'No programmes match these filters.';
    dom.emptyHint.textContent = `Try changing ${listOf(filtersInUse())}.`;
    dom.emptyClear.hidden = false;
    dom.emptyClear.textContent = `Clear all (${activeFilterCount(state)})`;
    dom.emptyTips.hidden = false;
  }
}

function filtersInUse() {
  const used = [];
  if (state.search.trim()) used.push(`the search “${state.search.trim()}”`);
  if (state.myIbPoints !== null) used.push('your points');
  if (state.hlMaths) used.push('HL Maths 4+');
  if (state.maxTuition !== null) used.push('the fee limit');
  if (state.subjectAreas.size) used.push('the subject areas');
  if (state.countries.size) used.push('the countries');
  if (state.languages.size) used.push('the languages');
  return used;
}

function listOf(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// The pick-lists are native <details>, so they open and close from the keyboard
// with no help. This adds what <details> does not do on its own: only one open
// at a time, and closing on a click outside, on Tab out, or on Escape.
function wireDropdowns() {
  const closeAll = (except) => {
    for (const d of dom.dropdowns) if (d !== except) d.open = false;
  };
  for (const d of dom.dropdowns) {
    d.addEventListener('toggle', () => { if (d.open) closeAll(d); });
    // Tabbing past the last option left the panel open over the next control
    // (A06). A null relatedTarget is left alone: Safari does not focus a
    // clicked checkbox, so focus "leaves" to nothing on every tick.
    d.addEventListener('focusout', (event) => {
      if (d.open && event.relatedTarget && !d.contains(event.relatedTarget)) d.open = false;
    });
  }
  document.addEventListener('click', (event) => {
    if (!dom.dropdowns.some((d) => d.contains(event.target))) closeAll();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = dom.dropdowns.find((d) => d.open);
    if (!open) return;
    // Focus goes back to the button only from inside the list. Escape in
    // Search used to pull focus away to a dropdown button (A06).
    const wasInside = open.contains(document.activeElement);
    open.open = false;
    if (wasInside) open.querySelector('summary').focus();
  });
}

function plural(n) {
  return n === 1 ? 'programme' : 'programmes';
}

function localDay(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
