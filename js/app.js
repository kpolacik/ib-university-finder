import { initTheme, getThemeChoice, setThemeChoice } from './theme.js';
import { restoration, storedFilters, validateLoadedFacets, FACET_FIELDS } from './saved-state.js';
import { readSaved, readDismissed, writeSaved, setupOnboarding } from './onboarding.js';
import { onFaqSlide } from './faq.js';
import { wireSheetDrag } from './sheet-drag.js';
import { wireRound2, syncRound2, showToast, wireCompactHeader, wireLogoHandover, syncSegments } from './round2.js';
import { t, initLanguage, setLanguage, getLanguage, formatCount, languageQuery, applyLanguage, setDataTranslations } from './i18n.js';
// Wires the data layer to the filter state to the DOM.

import { loadData, applyToday } from './data.js';
import {
  createFilterState, setMyPoints, applyFilters, sortRows, buildFacets, activeFilterCount, SORTS, REVERSE_SORTS, DEADLINE_WINDOWS, EXAM_OPTIONS,
  parsePoints, parseFee, parseEuros, stateToParams, paramsToState, pointsSummaryParts, pointsBucket, linkContents,
} from './filters.js';
import {
  loadShortlist, saveShortlist, readStoredShortlist, SHORTLIST_KEY, toCsv, downloadCsv, shareQuery, readSharedList, unknownIdsText, mergeIntoShortlist,
  groupRows, groupHeadings, addressQuery,
} from './shortlist.js';
import { compareTable, MIN_COMPARE } from './compare.js';
import { loadCompare, readStoredCompare, saveCompare, normalizeCompare, toggleIn, restoreAt, COMPARE_KEY } from './compare-set.js';
import {
  appendRows, renderSlot, renderPane, renderCount, renderCountShort, renderChips, showSelectedFirst, renderAppliedChips, renderSortOptions, renderSourceLine, renderSourceBanner, renderIssues,
  setSaved, setInCompare, renderCompare,
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
  budget: document.getElementById('f-budget'),
  living: document.getElementById('f-living'),
  subjects: document.getElementById('f-subjects'),
  countries: document.getElementById('f-countries'),
  languages: document.getElementById('f-languages'),
  deadline: document.getElementById('f-deadline'),
  myMaths: document.getElementById('f-mymaths'),
  exam: document.getElementById('f-exam'),
  degrees: document.getElementById('f-degrees'),
  cities: document.getElementById('f-cities'),
  degreesCount: document.getElementById('dd-degrees-count'),
  degreesCountNumber: document.getElementById('dd-degrees-count-number'),
  citiesCount: document.getElementById('dd-cities-count'),
  citiesCountNumber: document.getElementById('dd-cities-count-number'),
  applied: document.getElementById('applied-filters'),
  clear: document.getElementById('f-clear'),
  sort: document.getElementById('f-sort'),
  count: document.getElementById('result-count'),
  countShort: document.querySelector('.cshort'),
  countSummary: document.getElementById('count-summary'),
  stuckMark: document.querySelector('.stuck-mark'),
  copy: document.getElementById('f-copy'),
  copyHelp: document.getElementById('f-copy-help'),
  copyStatus: document.getElementById('f-copy-status'),
  copyStatusFrame: null,
  more: document.getElementById('f-more'),
  moreFilters: document.querySelector('.more-filters'),
  sheet: document.getElementById('filter-sheet'),
  sheetScrim: document.getElementById('sheet-scrim'),
  sheetHeading: document.getElementById('sheet-h'),
  sheetDone: document.getElementById('sheet-done'),
  sheetBody: document.querySelector('.sheet-b'),
  sheetFoot: document.querySelector('.sheet-f'),
  sheetShow: document.getElementById('sheet-show'),
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
  emptyBack: document.getElementById('empty-back'),
  headerList: document.getElementById('header-list'),
  emptyTips: document.getElementById('empty-tips'),
  pointsError: document.getElementById('f-points-error'),
  tuitionError: document.getElementById('f-tuition-error'),
  budgetError: document.getElementById('f-budget-error'),
  livingError: document.getElementById('f-living-error'),
  shortlistBar: document.getElementById('shortlist-bar'),
  // The <p> holds an icon as well, so the text goes in its own span rather
  // than through textContent on the parent, which would wipe the icon.
  shortlistCount: document.getElementById('shortlist-count-text'),
  sourceLine: document.getElementById('source-line'),
  shortlistOnly: document.getElementById('f-shortlist-only'),
  shortlistOnlyText: document.getElementById('f-shortlist-only').querySelector('.ml-open-t'),
  exportCsv: document.getElementById('export-csv'),
  print: document.getElementById('print-shortlist'),
  clearShortlist: document.getElementById('clear-shortlist'),
  listTitle: document.getElementById('ml-title'),
  listShowAll: document.getElementById('ml-show-all'),
  listSaveShared: document.getElementById('ml-save-shared'),
  listNote: document.getElementById('ml-note'),
  listTools: document.getElementById('ml-tools'),
  listOrigin: document.getElementById('ml-origin'),
  listMore: document.getElementById('ml-more'),
  groupBy: document.getElementById('ml-group'),
  share: document.getElementById('ml-share'),
  sharePoints: document.getElementById('ml-share-points'),
  sharePointsHelp: document.getElementById('ml-share-points-help'),
  shareUrl: document.getElementById('ml-share-url'),
  shareCopy: document.getElementById('ml-share-copy'),
  split: document.querySelector('.split'),
  compare: document.getElementById('compare'),
  compareHeading: document.getElementById('cmp-h'),
  compareDiff: document.getElementById('cmp-diff'),
  compareDiffLabel: document.getElementById('cmp-diff-label'),
  compareClose: document.getElementById('cmp-close'),
  compareNote: document.getElementById('cmp-note'),
  compareOne: document.getElementById('cmp-one'),
  compareBody: document.getElementById('cmp-body'),
  compareEmpty: document.getElementById('cmp-empty'),
  compareBrowse: document.getElementById('cmp-browse'),
  headerCompare: document.getElementById('header-compare'),
  headerCompareCount: document.getElementById('header-compare-count'),
  tray: document.getElementById('cmp-tray'),
  trayText: document.getElementById('cmp-tray-text'),
  trayOpen: document.getElementById('cmp-tray-open'),
  compareStatus: document.getElementById('cmp-status'),
  issues: document.getElementById('issues'),
  issuesSummary: document.getElementById('issues-summary'),
  issuesList: document.getElementById('issues-list'),
};

const state = createFilterState();
let explicitSort = false;
const shortlist = loadShortlist();
// The list view (state.shortlistOnly) shows the saved programmes, or a shared
// link's. shared is readSharedList's { raw, ids, unknown } while a ?list= link
// is open, else null; it is kept apart from the saves, which change only on
// "Save these to my list". None of these go in the address except `list`.
let shared = null;
let restored = null;
let preferencesDirty = false;
const editedFacets = new Set();
const persistPreferences = debounce(() => {
  if (!loaded || !preferencesDirty) return;
  writeSaved(storedFilters(state, facets, explicitSort)); preferencesDirty = false;
}, 300);
// "Show all saves": the list view without the page's filters.
let listAll = false;
let groupBy = 'deadline';
// Phones: whether My list's More is open (Share, Export, Print, Clear and the
// footnotes; styles.css hides them otherwise). Closed again on leaving the list.
let listMoreOpen = false;
// Ids of the programmes in the list view, the rows on screen that carry a
// group heading, and whether the last save failed.
let listIds = [];
let listHeadings = new Map();
let listShown = 0;
let saveFailed = false;
// Compare: whether its view is open, "Show only differences", and where it was
// opened from ({ trigger, scrollY }), so closing can go back there.
let compareOpen = false;
let onlyDifferences = false;
let compareFrom = null;
// The compare set (js/compare-set.js): up to four programme ids in the order
// they were added, apart from the saves. compareFailed: the last write failed.
let compareIds = loadCompare();
let compareFailed = false;
// One line after a shared list was saved ("3 programmes added to your list.").
let sharedNote = null;
let allRows = [];
let facets = buildFacets([]);
let currentlyShown = 0;
// The "within / only with HL Maths 4+ / points unknown" split of the rows on
// screen, worked out in update() so a count-only refresh can reuse it.
let currentSummary = [];
const openIds = new Set();
// The pane shows from 1200 px (redesign revisions; it was 1024). Same query as
// the CSS. Where the facts sit inside a row is a CSS container query on the
// list, never measured here.
const wideQuery = matchMedia('(min-width: 1200px)');
// From 600 px every filter sits in the bar; below it the fee, the pick-lists,
// Clear all and Copy link live in the Filters sheet. Sort sits on the list. Same query as the CSS.
const barQuery = matchMedia('(min-width: 600px)');
// Its own record, never one of the layout queries: turning it on settles every
// effect at once, turning it off only affects later actions.
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
// Paper is narrower than the screen, so both layout queries can fire while
// printing. Between beforeprint and afterprint nothing moves (A08).
const printQuery = matchMedia('print');
// Where the header does not stick (phones, and any width at 500 px tall or
// less) Compare's entry is the tray at the bottom instead of the header
// button. The same query as the CSS.
const trayQuery = matchMedia('(max-width: 599.98px), (max-height: 500px)');
let printing = false;
let printFlushed = false;
// Where the page was before print: the full list is shorter than the
// estimates near its end, so the browser clamps the position while it shows.
let printScrollY = 0;
let updateAfterPrint = false;
// Slot motion owned by each slot: its pending frame, transitionend listener and
// 250 ms fallback. Kept per node so a late callback only ever touches its own
// slot, and cancelled before anything rebuilds or moves the rows.
const slotWork = new Map();
let appliedBar = null;
// The last focused filter control, kept only across a pending 600 crossing:
// CSS can clear focus (hide the control) before the change callback runs.
let filterFocus = null;
let returnFocusOnClose = true;
// Whether the last input was a key, for the sheet's scripted focus. iOS never
// focuses a tapped button, so the heading focused on open matched
// :focus-visible, and the Filters button inherited it on close: a blue ring
// after a tap (Leon, 2026-11-08). The ring now follows the input.
let keyboardInput = false;
let sentinelAbove = false;
// Only the viewport and two screens on either side are mounted. The offsets
// include measured rows and CSS breakpoint estimates for every unseen row.
const WINDOW_SCREENS = 2;
let windowRows = [];
let rowHeights = [];
let rowOffsets = [0];
let windowFrame = 0;
let windowWidth = 0;
let scrollingHome = false;
const rowObserver = new ResizeObserver(() => scheduleWindow());
let sheetWarmScheduled = false;
let sheetSlideTimer;
// A12: a finger is dragging the sheet down. Rows wait, with no timer, until
// it lets go; sheetDrag.reset() lets go on any other close or reopen.
let sheetDragHold = false, sheetDrag = null;
// True while the FAQ panel slides (js/faq.js): rows wait, as for the sheet.
let faqSliding = false;
// Flags only inside the Country options; any other country gets text only.
const COUNTRY_FLAGS = {
  Austria: 'f-at', Czechia: 'f-cz', Denmark: 'f-dk', Finland: 'f-fi', Germany: 'f-de', Ireland: 'f-ie',
  Italy: 'f-it', Netherlands: 'f-nl', Norway: 'f-no', Slovakia: 'f-sk', Sweden: 'f-se', 'United Kingdom': 'f-gb',
};
// Language pick-list flags (Leon, 2026-11-06): the flag of the country most
// associated with the language, only as a visual cue beside its name.
const LANGUAGE_FLAGS = { English: 'f-gb', Czech: 'f-cz', German: 'f-de', French: 'f-fr', Italian: 'f-it', Slovak: 'f-sk' };
let selectedId = null;
let shownRows = new Map();
let appliedWide = null;
let paneId = null;
let crossingFocus = null;
// A My list tool that holds focus, for the 600 px crossing: CSS hides More
// from 600 px, and the tools below 600 px unless More is open, and Chrome can
// drop focus from a node that goes hidden before the change callback runs.
let listFocus = null;
// The same for a focused Compare arrow, which CSS hides from 600 px.
let compareNavFocus = null;
// False until the data is in. The inputs are live from the start so nothing
// typed during loading is lost (S04), but update() must not draw anything
// before then: with no rows it would flash "No programmes match".
let loaded = false;
let sourceMeta = null;
// The local date the deadline fields were last worked out for (S06).
let dataDay = localDay(new Date());
// The Sort pick-list's key handling is wired once; whether the last radio
// change came from an arrow key (sortPick).
let sortKeysWired = false;
let sortByArrow = false;

start();

async function start() {
  initLanguage(location.search);
  applyLanguage();
  initTheme();
  wireSettings();
  dom.banner.addEventListener('click', openIssuesFromLink);
  crossBar();
  barQuery.addEventListener('change', crossBar);
  wireSheet();
  onFaqSlide((on) => { faqSliding = on; if (on) cancelRows(); else scheduleWindow(); });
  wireStuck();
  wireDropdowns();
  applyUrlFields();
  syncSort();
  wireInputs();
  wireRound2(dom);
  wireCompactHeader(dom, { goHome });
  wireLogoHandover(dom);
  for (const type of ['input', 'change']) document.addEventListener(type, (event) => {
    const fields = [dom.search, dom.points, dom.maths, dom.tuition, dom.budget, dom.living, dom.deadline, dom.myMaths, dom.exam, dom.sort];
    const boxes = [dom.subjects, dom.countries, dom.languages, dom.degrees, dom.cities];
    if (fields.includes(event.target) || (event.target.type === 'checkbox' && boxes.some((box) => box.contains(event.target)))) {
      preferencesDirty = true; persistPreferences();
    }
  });
  dom.results.addEventListener('click', toggleRow);
  window.addEventListener('scroll', scheduleWindow, { passive: true });
  window.addEventListener('resize', scheduleWindow);
  document.getElementById('pane-close').addEventListener('click', () => {
    const id = selectedId; clearSelection(); selectedId = null; drawPane();
    mountRow(id)?.querySelector('button.open')?.focus({ preventScroll: true });
  });
  // The pane's "Save to my list" and compare button.
  dom.pane.addEventListener('click', (event) => {
    const save = event.target.closest('button[data-save-id]');
    if (save) onToggleStar(save.getAttribute('data-save-id'));
    const compare = event.target.closest('button[data-compare-id]');
    if (compare) onToggleCompare(compare.getAttribute('data-compare-id'));
  });
  dom.results.addEventListener('keydown', rowKeydown);
  wideQuery.addEventListener('change', crossWide);
  document.addEventListener('focusin', rememberFocus);
  document.addEventListener('focusout', forgetFocus);
  motionQuery.addEventListener('change', () => { if (motionQuery.matches) { settleSlots(); resumeSheetRows(); } });
  // Print needs every filtered row (A08). The print media query changes only
  // after Chrome's print snapshot, so beforeprint is the one place to flush.
  window.addEventListener('beforeprint', () => {
    printing = true;
    settleSlots();
    printFlushed = !compareOpen;
    printScrollY = window.scrollY;
    if (printFlushed) flushRows();
    syncTray();
  });
  window.addEventListener('afterprint', afterPrint);
  // Input also releases Home on engines that do not send scrollend.
  window.addEventListener('scrollend', (event) => { if (event.target === document) scrollingHome = false; });
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    window.addEventListener(type, () => { scrollingHome = false; }, { capture: true, passive: true });
  }
  wireTray();
  dom.results.setAttribute('aria-busy', 'true');

  try {
    dataDay = localDay(new Date());
    const { programmes, meta, translations } = await loadData();
    setDataTranslations(translations);
    sourceMeta = meta;
    allRows = programmes;

    renderSourceBanner(dom.banner, meta);
    renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, meta.issues);
    renderSortOptions(dom.sort, SORTS, state.sort, state.dir, state);
    syncSort();

    facets = buildFacets(allRows);
    // Only in memory: the next change writes the tidied set (compare-set.js).
    compareIds = normalizeCompare(compareIds, knownIds());
    applyUrlLists();
    // An incoming share link opens its own list view, never the saves (S03).
    shared = readSharedList(location.search, new Set(allRows.map((row) => row.id)));
    if (shared) state.shortlistOnly = true;
    drawChips();
    renderSourceLine(dom.sourceLine, allRows, meta);

    // Whatever was typed while the data loaded is in the fields, not yet in
    // the state, because update() ignored it until now.
    readFields();
    loaded = true;
    update();
    scheduleSheetWarm();
    setupOnboarding({ state, facets, flags: COUNTRY_FLAGS, closeSheet, results: dom.resultsSection, firstVisit: restored?.onboarding === true,
      // Compare covers the results, so "Show my programmes" closes it first.
      // The Compare set stays (review of PR 1, 2026-11-07).
      closeCompare: () => closeCompare(false),
      apply(answers) {
        // "Show all saves" ignores the filters, so My list kept showing (and
        // the done screen counted) saves the answers rule out, like a 42-point
        // programme for 24 points. The answers are filters: they apply here.
        listAll = false;
        setMyPoints(state, answers.myIbPoints, explicitSort);
        for (const key of Object.keys(storedFilters(answers, facets).filters)) state[key] = answers[key];
        fillFields(state); drawChips(); preferencesDirty = true; update();
        // Setup's done screen says how many programmes this leaves, how they
        // stand against the IB points (the count line's own parts) and whether
        // any filter is on at all. On phones Search sits in the header, not in
        // Filters, so there the note counts the sheet's filters only, as the
        // Filters (n) button does (verification of PR 1).
        const active = activeFilterCount(state);
        return { shown: currentlyShown, summary: currentSummary.map((part) => part.text),
          filtered: active > 0, sheetFiltered: active - (state.search.trim() ? 1 : 0) > 0 };
      },
    });
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
  restored = restoration(location.search, readSaved(), readDismissed());
  const fromUrl = restored.state;
  for (const key of FACET_FIELDS) state[key] = new Set(fromUrl[key]);
  fillFields(fromUrl);
  const params = new URLSearchParams(location.search);
  // A saved sort was hand-picked (storedFilters keeps only those), so setting
  // points later leaves it alone, as it would have before the reload.
  explicitSort = fromUrl.sort !== 'best' && (restored.sortPicked
    || (params.has('sort') && params.get('sort') !== 'best') || params.has('dir') || fromUrl.sort !== 'deadline');
  state.sort = fromUrl.sort;
  state.dir = fromUrl.dir;
  setMyPoints(state, fromUrl.myIbPoints, explicitSort);
}

function fillFields(fromUrl) {
  dom.points.value = dom.tuition.value = dom.budget.value = dom.living.value = '';
  dom.search.value = fromUrl.search;
  if (fromUrl.myIbPoints !== null) dom.points.value = String(fromUrl.myIbPoints);
  dom.maths.checked = fromUrl.hlMaths;
  if (fromUrl.maxTuition !== null) dom.tuition.value = String(fromUrl.maxTuition);
  if (fromUrl.maxBudget !== null) dom.budget.value = String(fromUrl.maxBudget);
  if (fromUrl.myLiving !== null) dom.living.value = String(fromUrl.myLiving);
  dom.deadline.value = fromUrl.deadlineWindow;
  dom.myMaths.value = fromUrl.myMaths ?? '';
  dom.exam.value = fromUrl.exam ?? '';
}

// Subjects, countries and languages can only be checked against the data,
// so they wait for it; a value not in the data is dropped.
function applyUrlLists() {
  if (restored?.source === 'saved') { validateLoadedFacets(state, facets); return; }
  const fromUrl = paramsToState(location.search, facets);
  for (const key of FACET_FIELDS) {
    if (editedFacets.has(key)) continue;
    state[key].clear(); for (const value of fromUrl[key]) state[key].add(value);
  }
}

// A11: the panel fades and grows from the gear in 200 ms and shuts in 140 ms
// (Reduce Motion: a short fade only). A Web Animation, not a transition, so
// a reopen mid-exit starts from the opacity and scale on screen, and its end
// is known even where the global reduced-motion rule removes transitions.
// open is the logical state: the moment it is false, the panel is inert
// (no Tab stop, no taps; styles.css lets taps through) while it fades, and
// Escape, outside taps and focusout treat it as closed. Only the latest exit
// may hide it.
const SETTINGS_SHOWN = { opacity: 1, transform: 'none' };
function wireSettings() {
  const button = document.getElementById('settings-open');
  const panel = document.getElementById('settings-panel');
  const wrapper = button.parentElement;
  let open = false, motion = null;
  const play = (show) => {
    const reduce = motionQuery.matches;
    const hidden = { opacity: 0, transform: reduce ? 'none' : 'translateY(-4px) scale(.97)' };
    const now = motion ? getComputedStyle(panel) : null;
    const from = now ? { opacity: now.opacity, transform: now.transform } : show ? hidden : SETTINGS_SHOWN;
    motion?.cancel();
    const animation = motion = panel.animate([from, show ? SETTINGS_SHOWN : hidden],
      { duration: reduce ? 100 : show ? 200 : 140, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    animation.onfinish = () => {
      if (motion !== animation) return;
      motion = null;
      if (!open) { panel.hidden = true; panel.removeAttribute('inert'); }
      animation.cancel();
    };
  };
  const close = (focus = false) => {
    if (!open) return;
    open = false;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
    panel.setAttribute('inert', '');
    if (typeof panel.animate === 'function') play(false);
    else { panel.hidden = true; panel.removeAttribute('inert'); }
  };
  for (const radio of panel.querySelectorAll('[data-theme-choice]')) {
    radio.checked = radio.dataset.themeChoice === getThemeChoice();
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      setThemeChoice(radio.dataset.themeChoice);
      syncSegments(true);
    });
  }
  for (const radio of panel.querySelectorAll('[data-language]')) radio.addEventListener('change', () => {
    if (radio.checked) switchLanguage(radio.dataset.language);
  });
  button.addEventListener('click', () => {
    // Safari does not focus a clicked button: a focused radio would be lost.
    if (open) { close(panel.contains(document.activeElement)); return; }
    open = true;
    panel.removeAttribute('inert');
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    syncSegments(true);
    if (typeof panel.animate === 'function') play(true);
    panel.querySelector('[data-language]:checked')?.focus();
  });
  document.addEventListener('pointerdown', (event) => { if (open && !wrapper.contains(event.target)) close(); });
  wrapper.addEventListener('focusout', (event) => {
    if (open && event.relatedTarget && !wrapper.contains(event.relatedTarget)) close();
  });
  // Capture first: one Escape must not also dismiss a selected programme.
  // A panel that is already shutting has let Escape go.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopImmediatePropagation(); close(true);
  }, true);
}

// replaceState, not pushState: one history entry per keystroke would make the
// Back button step through every letter typed.
// A shared list's `list` stays in the address while its view is open, so a
// reload brings the same view back; no other view ever adds it.
function switchLanguage(language) {
  const x = window.scrollX;
  const y = window.scrollY;
  // Slovak rows are taller, so the old pixel offset lands on another
  // programme. Keep the one at the top of the list where it was instead.
  const anchor = loaded && !compareOpen && !dom.listp.hidden ? topRow() : null;
  const paneScroll = dom.pane.scrollTop;
  if (language !== getLanguage()) state.englishOriginals = new Set();
  setLanguage(language);
  applyLanguage();
  syncSegments(true);
  closeSheet();
  cancelAnimationFrame(dom.copyStatusFrame);
  dom.copyStatus.textContent = '';
  if (loaded) {
    renderSourceBanner(dom.banner, sourceMeta);
    renderSourceLine(dom.sourceLine, allRows, sourceMeta);
    renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, sourceMeta.issues);
    renderSortOptions(dom.sort, SORTS, state.sort, state.dir, state);
    syncSort();
    drawChips();
    paneId = null;
    readFields();
    update();
    dom.pane.scrollTop = paneScroll;
  }
  keepAddress();
  const item = anchor && mountRow(anchor.id);
  if (item) window.scrollBy(0, item.getBoundingClientRect().top - anchor.top);
  else window.scrollTo(x, y);
}

// The first drawn row not hidden under the sticky header (its scroll margin
// is the header's height), with its place on screen.
function topRow() {
  for (const item of dom.results.querySelectorAll('li.item')) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > parseFloat(getComputedStyle(item).scrollMarginTop)) return { id: item.dataset.id, top: rect.top };
  }
  return null;
}

function keepAddress() {
  const query = languageQuery(addressQuery(stateToParams(state), shared));
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
  // An open sheet would hold its controls over an empty page. Its focus goes
  // to Reload below, never back to the Filters button that is about to hide.
  const sheetHadFocus = dom.sheet.open && dom.sheet.contains(document.activeElement);
  settleSlots();
  cancelRows();
  closeSheet(false);
  dom.pane.hidden = true;
  const alert = document.createElement('div');
  alert.className = 'bn bn-fail';
  alert.setAttribute('role', 'alert');
  const sentence = document.createElement('p');
  sentence.textContent = t('could_not_load_the_latest_data_check_your_connection_and_reload_the');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn btn-p';
  reload.textContent = t('reload');
  reload.addEventListener('click', () => location.reload());
  alert.append(sentence, reload);
  dom.banner.replaceChildren(alert);
  dom.sourceLine.hidden = true;
  dom.shortlistBar.hidden = true;
  dom.compare.hidden = true;
  dom.banner.hidden = false;
  dom.form.hidden = true;
  dom.status.hidden = true;
  dom.listp.hidden = true;
  renderIssues(dom.issues, dom.issuesSummary, dom.issuesList, err.reasons || [err.message]);
  if (sheetHadFocus) reload.focus();
}

// The banner's "see the list" link points at #issues, a closed <details>.
// Following it opens the list, or the reader lands on a bare summary line (L06).
function openIssuesFromLink(event) {
  if (event.target.closest('a[href="#issues"]')) dom.issues.open = true;
}

function drawChips() {
  const counts = (field) => {
    const out = new Map();
    for (const row of allRows) for (const value of new Set(Array.isArray(row[field]) ? row[field] : [row[field]])) out.set(value, (out.get(value) ?? 0) + 1);
    return out;
  };
  renderChips(dom.subjects, facets.subjectAreas, state.subjectAreas, toggle(state.subjectAreas), { field: 'subject_area', counts: counts('subjectAreas') });
  renderChips(dom.countries, facets.countries, state.countries, toggle(state.countries), { flags: COUNTRY_FLAGS, forceSearch: true, counts: counts('country') });
  renderChips(dom.languages, facets.languages, state.languages, toggle(state.languages), { flags: LANGUAGE_FLAGS, counts: counts('languages') });
  renderChips(dom.degrees, facets.degreeTypes, state.degreeTypes, toggle(state.degreeTypes), { field: 'degree_type', counts: counts('degreeType') });
  renderChips(dom.cities, facets.cities, state.cities, toggle(state.cities), { counts: counts('city') });
}

function toggle(set) {
  return (value, checked) => {
    for (const key of FACET_FIELDS) if (state[key] === set) editedFacets.add(key);
    if (checked) set.add(value); else set.delete(value);
    update();
  };
}

// Reads the text and number fields into the state. Used by their handlers and
// once after loading, for anything typed while the data was on its way.
function readFields() {
  state.search = dom.search.value;
  state.deadlineWindow = dom.deadline.value;
  state.myMaths = dom.myMaths.value || null;
  state.exam = dom.exam.value || null;
  setMyPoints(state, readNumber(dom.points, dom.pointsError, parsePoints,
    t('enter_a_whole_number_from_24_to_45')), explicitSort);
  state.hlMaths = dom.maths.checked;
  state.maxTuition = readNumber(dom.tuition, dom.tuitionError, parseFee,
    t('enter_a_whole_number_of_euros_0_or_more'));
  state.maxBudget = readNumber(dom.budget, dom.budgetError, parseEuros,
    t('enter_a_whole_number_of_euros_0_or_more'));
  state.myLiving = readNumber(dom.living, dom.livingError, parseEuros,
    t('enter_a_whole_number_of_euros_a_month_0_or_more'));
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
  // Filters apply as you type, so the form is never submitted. Below 600 px
  // placeFilters moves every other field out of it, leaving Search as its
  // only text field, and Enter then did an implicit submit: the page reloaded
  // to ?q=…, dropping the language and a shared ?list= view.
  dom.form.addEventListener('submit', (event) => event.preventDefault());

  dom.search.addEventListener('input', debounce(() => {
    state.search = dom.search.value;
    update();
  }, 150));

  // Debounced like the search box: typing "3000" otherwise renders four times,
  // and the intermediate "under €3" and "under €30" states flash an empty list.
  dom.points.addEventListener('input', debounce(() => {
    setMyPoints(state, readNumber(dom.points, dom.pointsError, parsePoints,
      t('enter_a_whole_number_from_24_to_45')), explicitSort);
    update();
  }, 150));

  dom.maths.addEventListener('change', () => {
    state.hlMaths = dom.maths.checked;
    update();
  });

  dom.tuition.addEventListener('input', debounce(() => {
    state.maxTuition = readNumber(dom.tuition, dom.tuitionError, parseFee,
      t('enter_a_whole_number_of_euros_0_or_more'));
    update();
  }, 150));

  dom.budget.addEventListener('input', debounce(() => {
    state.maxBudget = readNumber(dom.budget, dom.budgetError, parseEuros,
      t('enter_a_whole_number_of_euros_0_or_more'));
    update();
  }, 150));

  dom.living.addEventListener('input', debounce(() => {
    state.myLiving = readNumber(dom.living, dom.livingError, parseEuros,
      t('enter_a_whole_number_of_euros_a_month_0_or_more'));
    update();
  }, 150));

  dom.deadline.addEventListener('change', () => {
    state.deadlineWindow = dom.deadline.value;
    update();
  });

  dom.myMaths.addEventListener('change', () => {
    state.myMaths = dom.myMaths.value || null;
    update();
  });

  dom.exam.addEventListener('change', () => {
    state.exam = dom.exam.value || null;
    update();
  });

  dom.sort.addEventListener('change', () => {
    [state.sort, state.dir] = dom.sort.value.split(':');
    explicitSort = state.sort !== 'best';
    preferencesDirty = true;
    syncSort();
    update();
  });

  for (const button of dom.sortButtons) {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      explicitSort = true; preferencesDirty = true;
      if (state.sort === key && state.dir === 'desc' && key !== 'deadline') {
        state.sort = 'deadline'; state.dir = 'asc';
      } else {
        state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
        state.sort = key;
      }
      syncSort();
      update();
    });
  }

  dom.clear.addEventListener('click', () => clearAllFrom(dom.clear));
  dom.emptyClear.addEventListener('click', () => clearAllFrom(dom.emptyClear));
  dom.copy.addEventListener('click', copyLink);

  // A tab left open overnight: work the deadlines out again when it comes
  // back into view on a new day. No timer; any input does the same (S06).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loaded && localDay(new Date()) !== dataDay) update();
  });

  wireList();

  dom.exportCsv.addEventListener('click', () => {
    const rows = sortRows(allRows.filter((r) => shortlist.has(r.id)), state.sort, state.dir, state);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`my-shortlist-${stamp}.csv`, toCsv(rows, { myLiving: state.myLiving }));
  });

  // Printing is scoped to the shortlist by the print stylesheet, so this only
  // has to make sure the starred cards are the ones on screen.
  dom.print.addEventListener('click', () => {
    if (!state.shortlistOnly) {
      state.shortlistOnly = true;
      update();
    }
    window.print();
  });

  dom.clearShortlist.addEventListener('click', () => {
    const total = shortlist.size;
    if (total === 0) return;
    if (!window.confirm(t('remove_all_saved_from_your_list', { value1: total, value2: plural(total) }))) return;
    changeShortlist((set) => set.clear());
    state.shortlistOnly = false;
    listAll = false;
    closeCompare(false);
    update();
  });
}

// Saves or unsaves one programme and brings every save button for it (the
// row's star, the pane's or the slot's "Save to my list") to the new state in
// place. Unsaving inside the list view leaves the row where it is until the
// list is next drawn, so focus stays put and a slip can be undone with one
// more click.
function onToggleStar(id) {
  const starred = !shortlist.has(id);
  changeShortlist((set) => { if (starred) set.add(id); else set.delete(id); });
  for (const button of document.querySelectorAll(`[data-save-id="${id}"]`)) setSaved(button, starred);
  syncListToSaves();
  renderCounts(currentlyShown);
  if (selectedId === null) drawPane();
  showToast(t(starred ? 'r2_saved' : 'r2_removed'), t('r2_undo'), () => {
    changeShortlist((set) => { if (starred) set.delete(id); else set.add(id); });
    for (const button of document.querySelectorAll(`[data-save-id="${id}"]`)) setSaved(button, !starred);
    syncListToSaves(); renderCounts(currentlyShown); if (selectedId === null) drawPane();
    (compareOpen ? dom.compareBody : document).querySelector(`${compareOpen ? 'th' : '.row'} [data-save-id="${id}"]`)?.focus({ preventScroll: true });
  });
  return starred;
}

// Applies one change to the list as it is stored now, then writes it. Another
// tab may have saved or unsaved since this one loaded, and writing this tab's
// old copy back would undo that (save B here, C in a second tab: B was lost).
// When storage cannot be read, or the last write failed (private browsing),
// this tab's copy is all there is, so the change goes on that as before.
function changeShortlist(change) {
  const stored = saveFailed ? null : readStoredShortlist();
  if (stored) {
    shortlist.clear();
    for (const id of stored) shortlist.add(id);
  }
  change(shortlist);
  saveFailed = !saveShortlist(shortlist);
}

// Another tab changed the saves or the compare set: take its copy, then bring
// the buttons and counts here up to date. key null (storage cleared) is both.
// The list view is drawn again, as it would be for any change made from
// outside it. Other keys are not ours.
function onStorage(event) {
  if (event.key === null || event.key === COMPARE_KEY) {
    const stored = readStoredCompare();
    if (stored) {
      compareIds = normalizeCompare(stored, knownIds());
      if (loaded) syncCompareControls();
    }
  }
  if (event.key === null || event.key === SHORTLIST_KEY) savesFromStorage();
}

function savesFromStorage() {
  const stored = readStoredShortlist();
  if (!stored) return;
  shortlist.clear();
  for (const id of stored) shortlist.add(id);
  if (!loaded) return;
  if (state.shortlistOnly) { update(); return; }
  for (const button of document.querySelectorAll('[data-save-id]')) setSaved(button, shortlist.has(button.getAttribute('data-save-id')));
  renderCounts(currentlyShown);
  if (selectedId === null) drawPane();
}

// The ids of every programme in the data, worked out again only when the
// rows change (ids are unique, so the count follows the rows).
let knownRows = null;
let knownSet = new Set();
function knownIds() {
  if (knownRows !== allRows || knownSet.size !== allRows.length) { knownRows = allRows; knownSet = new Set(allRows.map((row) => row.id)); }
  return knownSet;
}

// The compare ids that are in the data, in the order they were added.
function shownCompare() {
  const known = knownIds();
  return compareIds.filter((id) => known.has(id));
}

// One change to the compare set as it is stored now, then written; the same
// rule as changeShortlist, so another tab's add survives this tab's. A refused
// fifth writes nothing. Returns toggleIn's or restoreAt's result.
function changeCompare(change) {
  const stored = compareFailed ? null : readStoredCompare();
  if (stored) compareIds = normalizeCompare(stored, knownIds());
  const { ids, result } = change(compareIds);
  if (result === 'full') return result;
  compareIds = ids;
  compareFailed = !saveCompare(compareIds);
  return result;
}

// A compare toggle on a row, its slot or the pane: in or out of the set. A
// fifth is refused with a toast that says why; the button is never disabled.
function onToggleCompare(id) {
  const result = changeCompare((ids) => toggleIn(ids, id, knownIds()));
  syncCompareControls();
  compareFeedback(result);
  return result;
}

// One announcement per change, never two. On phones the tray's count changes
// by the thumb, so only screen readers hear it (#cmp-status); on desktop the
// header is far from the row, so a toast says it. The limit says so anywhere.
// A toast that offers "Open compare" goes once Compare opens by any route:
// left up, it still said "Added to compare (3 of 4) · Open compare" over the
// open comparison.
let dismissCompareToast = null;
function compareFeedback(result) {
  const count = shownCompare().length;
  if (result === 'full') dismissCompareToast = showToast(t('r3_cmp_full'), t('r3_cmp_open_label'), () => openCompare(null));
  else if (trayQuery.matches) announceCompare(t(result === 'added' ? 'r3_cmp_added_sr' : 'r3_cmp_removed', { count }));
  else if (result === 'added') dismissCompareToast = showToast(t('r3_cmp_added', { count }), t('r3_cmp_open_label'), () => openCompare(null));
  else showToast(t('r3_cmp_removed'));
}

// Cleared, then written on the next frame, so the same words twice are
// still read; a newer change cancels the one still waiting.
let compareStatusFrame;
function announceCompare(text) {
  cancelAnimationFrame(compareStatusFrame);
  dom.compareStatus.textContent = '';
  compareStatusFrame = requestAnimationFrame(() => { dom.compareStatus.textContent = text; });
}

// Brings everything that shows the compare set up to date, in place, and
// draws the compare view again if it is open.
function syncCompareControls() {
  const inSet = new Set(compareIds);
  for (const button of document.querySelectorAll('[data-compare-id]')) setInCompare(button, inSet.has(button.getAttribute('data-compare-id')));
  syncCompareEntry();
  drawCompare();
}

// The header button's count and pressed state, and the tray.
function syncCompareEntry() {
  const count = String(shownCompare().length);
  if (dom.headerCompareCount.textContent !== count) dom.headerCompareCount.textContent = count;
  dom.headerCompare.setAttribute('aria-pressed', String(compareOpen));
  syncTray();
}

// The tray shows on phones (trayQuery) once a programme is in Compare. It
// hides while Compare is open, while a field that brings up the on-screen
// keyboard has focus, while a dialog is open, while a pick-list floats open
// from outside the Filters sheet and while printing. That is every pick-list
// in the bar on a short, wide window (a phone on its side), and Sort above the
// list on a portrait phone; with 390 px of height the tray covered Budget's
// first field and Sort's list (review of PR 1), and there is no room below
// them to give the list instead.
// body.has-tray reserves its height at the end of the page; the height itself
// comes from the ResizeObserver in wireTray, never read here, since a layout
// read after the rows are rebuilt costs a full layout of the list (L09).
function syncTray(focused = document.activeElement) {
  const count = shownCompare().length;
  const show = loaded && count > 0 && !compareOpen && trayQuery.matches && !printing && !opensKeyboard(focused)
    && ![...document.querySelectorAll('dialog')].some((dialog) => dialog.open)
    && !dom.dropdowns.some((d) => d.open && !dom.sheet.contains(d));
  const text = t('r3_tray_text', { count });
  if (dom.trayText.textContent !== text) dom.trayText.textContent = text;
  if (dom.tray.hidden === show) dom.tray.hidden = !show;
  document.body.classList.toggle('has-tray', show);
}

function opensKeyboard(node) {
  const tag = node?.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  return tag === 'input' && !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(node.type);
}

// The tray follows focus (the keyboard), the phone query and every dialog. Its
// measured height (safe area included) becomes --tray-h: the page's bottom
// padding, the root's scroll-padding-bottom (so Tab never lands under it) and
// the toasts' lift. 0 while hidden.
function wireTray() {
  document.addEventListener('focusin', (event) => syncTray(event.target));
  document.addEventListener('focusout', (event) => syncTray(event.relatedTarget));
  trayQuery.addEventListener('change', () => syncTray());
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => syncTray());
  for (const d of dom.dropdowns) d.addEventListener('toggle', () => syncTray());
  if (typeof ResizeObserver !== 'function') return;
  new ResizeObserver((entries) => {
    const height = Math.ceil(entries.at(-1).borderBoxSize?.[0]?.blockSize ?? dom.tray.offsetHeight);
    // Print hides the tray only for the paper: keeping its room means the
    // page is as long after print, so the position restored there holds.
    if (height) document.documentElement.style.setProperty('--tray-h', `${height}px`);
    else if (!printing) document.documentElement.style.removeProperty('--tray-h');
  }).observe(dom.tray);
}

// The list view's ids and counts from the saves as they are now, without
// drawing the rows again. An unsaved row stays where it is (onToggleStar), but
// the bar follows the real list at once. Same scope as update(). Compare is
// its own set, so nothing here touches it; its Save buttons change in place.
function syncListToSaves() {
  if (!state.shortlistOnly || shared) return;
  const inScope = allRows.filter((row) => shortlist.has(row.id));
  const filtered = applyFilters(allRows, state, shortlist);
  const onScreen = listAll ? inScope : filtered;
  listIds = sortRows(inScope, 'name').map((row) => row.id);
  listShown = filtered.length;
  currentlyShown = onScreen.length;
  currentSummary = pointsSummaryParts(onScreen, state);
}

// The list bar's buttons and pickers. Everything here changes the view, never
// the filters.
function wireList() {
  window.addEventListener('storage', onStorage);
  dom.shortlistOnly.addEventListener('click', () => {
    const leaving = state.shortlistOnly;
    if (leaving) {
      // Back to all programmes; a shared link's view closes for good.
      shared = null;
      state.shortlistOnly = false;
    } else state.shortlistOnly = true;
    listAll = false;
    closeCompare(false);
    update();
    // Back hides with the list view and focus fell to the page (review of PR 1,
    // 2026-11-07), so it goes to My list, as the empty list's own way back does.
    if (leaving && !canShow(dom.shortlistOnly)) dom.headerList.focus();
  });
  // The empty list's own way back. The list exit restores no focus, and this
  // button disappears with the empty state, so focus goes to the header's My list.
  dom.emptyBack.addEventListener('click', () => {
    dom.shortlistOnly.click();
    dom.headerList.focus();
  });
  dom.listShowAll.addEventListener('click', () => {
    listAll = state.shortlistOnly ? !listAll : true;
    state.shortlistOnly = true;
    update();
  });
  dom.listSaveShared.addEventListener('click', () => {
    if (!shared) return;
    let added = 0;
    changeShortlist((set) => { added = mergeIntoShortlist(set, shared.ids); });
    for (const id of shared.ids) {
      for (const button of document.querySelectorAll(`[data-save-id="${id}"]`)) setSaved(button, true);
    }
    dom.listSaveShared.textContent = t('saved_to_my_list');
    sharedNote = t('added_list_count', { count: added });
    renderCounts(currentlyShown);
  });
  dom.groupBy.addEventListener('change', () => {
    groupBy = dom.groupBy.value;
    update();
  });
  dom.listMore.addEventListener('click', () => {
    listMoreOpen = !listMoreOpen;
    // An open Share panel would otherwise show again with the next More.
    if (!listMoreOpen) dom.share.open = false;
    syncListMore();
  });
  dom.compareClose.addEventListener('click', () => closeCompare(true));
  // A column's Save and "x"; Browse sits outside the table, in the empty state.
  dom.compareBody.addEventListener('click', (event) => {
    const save = event.target.closest('button[data-save-id]');
    if (save) { onToggleStar(save.getAttribute('data-save-id')); return; }
    const remove = event.target.closest('button[data-compare-remove]');
    // detail 0 is a click from the keyboard (Enter or Space), not a pointer.
    if (remove) removeFromCompare(remove.getAttribute('data-compare-remove'), event.detail === 0);
  });
  dom.compareBrowse.addEventListener('click', () => closeCompare(true));
  // The header button (from 600 px) opens Compare, and closes it when open;
  // the tray (phones) only opens it.
  dom.headerCompare.addEventListener('click', () => {
    if (compareOpen) closeCompare(true); else openCompare(dom.headerCompare);
  });
  dom.trayOpen.addEventListener('click', () => openCompare(dom.trayOpen));
  window.addEventListener('resize', syncCompareCue);
  dom.compareDiff.addEventListener('change', () => {
    onlyDifferences = dom.compareDiff.checked;
    drawCompare();
  });
  dom.share.addEventListener('toggle', syncShare);
  dom.sharePoints.addEventListener('change', syncShare);
  dom.shareCopy.addEventListener('click', copyShareLink);
}

// The share link for the saved programmes that still exist, in the order they
// were saved; points only with the tick (shareQuery in js/shortlist.js).
function shareLink() {
  const known = new Set(allRows.map((row) => row.id));
  const ids = [...shortlist].filter((id) => known.has(id));
  const base = location.href.split(/[?#]/)[0];
  return `${base}?${shareQuery(ids, { points: state.myIbPoints, includePoints: dom.sharePoints.checked })}`;
}

function syncShare() {
  const points = state.myIbPoints;
  dom.sharePoints.disabled = points === null;
  if (points === null) dom.sharePoints.checked = false;
  const help = points === null ? t('enter_your_ib_points_above_to_include_them') : t('adds_your_points_to_the_link', { value1: points });
  if (dom.sharePointsHelp.textContent !== help) dom.sharePointsHelp.textContent = help;
  dom.shareUrl.value = shareLink();
}

// Keep the result tied to the link at the click, even if the list changes meanwhile.
async function copyShareLink() {
  syncShare();
  const url = dom.shareUrl.value;
  const known = new Set(allRows.map((row) => row.id));
  const ids = [...shortlist].filter((id) => known.has(id));
  const count = ids.length;
  const withPoints = dom.sharePoints.checked && state.myIbPoints !== null;
  const success = t(count === 1
    ? (withPoints ? 'r2_list_copied_points_one' : 'r2_list_copied_one')
    : (withPoints ? 'r2_list_copied_points' : 'r2_list_copied'), { count });
  const failure = t('r2_copy_failed_list');
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Select the link that failed, even if the list changed while copying.
    dom.shareUrl.value = url;
    dom.shareUrl.select();
    showToast(failure);
    return;
  }
  showToast(success);
}

// Opens the compare view at any count, from wherever the student is (the
// list, My list or a shared list), which stays as it was underneath.
function openCompare(trigger) {
  if (!loaded) return;
  if (!compareOpen) compareFrom = { trigger, scrollY: window.scrollY };
  compareOpen = true;
  dismissCompareToast?.();
  dismissCompareToast = null;
  syncCompareControls();
  dom.compare.scrollIntoView?.({ block: 'start' });
  dom.compareHeading.focus({ preventScroll: true });
}

// The compare set's programmes from the whole data, never the filtered list:
// a filter never drops a column and a passed deadline still shows. Drawn again
// on every change (a filter changes the points verdicts); focus and the
// sideways scroll survive it (compareFocus).
function drawCompare() {
  if (!compareOpen) return;
  const focus = compareFocus();
  const scroller = dom.compareBody.querySelector('.cmp-scroll');
  const scrollLeft = scroller ? scroller.scrollLeft : 0;
  const byId = new Map(allRows.map((row) => [row.id, row]));
  const rows = compareIds.map((id) => byId.get(id)).filter(Boolean);
  const n = rows.length;
  dom.compareHeading.textContent = n ? t('r3_cmp_heading', { count: n }) : t('compare_2');
  dom.compareDiff.checked = onlyDifferences;
  dom.compareDiffLabel.hidden = n < MIN_COMPARE;
  dom.compareOne.hidden = n !== 1;
  dom.compareEmpty.hidden = n !== 0;
  const note = compareFailed ? t('r3_cmp_failed') : '';
  if (dom.compareNote.textContent !== note) dom.compareNote.textContent = note;
  dom.compareNote.hidden = !note;
  // Shown before drawing: a hidden box can neither take back its scroll nor
  // be measured for the phone cue.
  dom.compare.hidden = false;
  dom.split.hidden = true;
  dom.shortlistBar.hidden = true;
  if (n) {
    renderCompare(dom.compareBody, rows, compareTable(rows, state), { onlyDifferences: onlyDifferences && n >= MIN_COMPARE, saved: shortlist });
    const next = dom.compareBody.querySelector('.cmp-scroll');
    if (next && scrollLeft) next.scrollLeft = scrollLeft;
    wireCompareCue(next);
  } else dom.compareBody.replaceChildren();
  if (focus) restoreCompareFocus(focus, rows.map((row) => row.id));
}

// The phone cue for columns off to the side: "Programmes 1–2 of 3", the
// arrows (each moves one column, off at its end) and the trailing fade. Its
// listeners live on the scroll box, so a redraw drops them with it; a resize
// is the one window listener (wireList).
let compareCueFrame = 0;
function wireCompareCue(box) {
  const nav = dom.compareBody.querySelector('.cmp-nav');
  if (nav) {
    const step = (dir) => {
      const column = box.querySelector('th.cmp-p');
      const width = column ? column.getBoundingClientRect().width : 0;
      box.scrollBy({ left: dir * width, behavior: motionQuery.matches ? 'instant' : 'smooth' });
    };
    nav.querySelector('.cmp-prev').addEventListener('click', () => step(-1));
    nav.querySelector('.cmp-next').addEventListener('click', () => step(1));
  }
  box.addEventListener('scroll', () => {
    if (compareCueFrame) return;
    compareCueFrame = requestAnimationFrame(() => { compareCueFrame = 0; syncCompareCue(); });
  }, { passive: true });
  box.addEventListener('scrollend', syncCompareCue);
  syncCompareCue();
}

// Which programmes are in view, measured right of the sticky fact column: a
// column counts once at least half of it shows.
function syncCompareCue() {
  const box = dom.compareBody.querySelector('.cmp-scroll');
  if (!compareOpen || !box) return;
  const frame = box.parentElement;
  const atStart = (box.scrollLeft ?? 0) <= 1;
  const atEnd = (box.scrollLeft ?? 0) + (box.clientWidth ?? 0) >= (box.scrollWidth ?? 0) - 1;
  frame.classList.toggle('at-start', atStart);
  frame.classList.toggle('at-end', atEnd);
  const nav = dom.compareBody.querySelector('.cmp-nav');
  if (!nav) return;
  const columns = [...box.querySelectorAll('th.cmp-p')];
  const outer = box.getBoundingClientRect();
  const left = outer.left + (box.querySelector('.cmp-c')?.getBoundingClientRect().width ?? 0);
  const shown = columns.map((th, i) => {
    const r = th.getBoundingClientRect();
    return Math.min(r.right, outer.right) - Math.max(r.left, left) >= r.width / 2 - 1 ? i + 1 : 0;
  }).filter(Boolean);
  const total = columns.length;
  const [from, to] = shown.length ? [shown[0], shown.at(-1)] : [1, Math.min(2, total)];
  const text = t(total === 4 ? 'r3_cmp_range_zo' : 'r3_cmp_range', { from, to, total });
  const range = nav.querySelector('.cmp-range');
  if (range.textContent !== text) range.textContent = text;
  const prev = nav.querySelector('.cmp-prev'), next = nav.querySelector('.cmp-next');
  // A disabled button drops focus to the page, so focus crosses to the other arrow first.
  if (atStart && document.activeElement === prev) next.focus({ preventScroll: true });
  if (atEnd && document.activeElement === next) prev.focus({ preventScroll: true });
  prev.disabled = atStart;
  next.disabled = atEnd;
}

// Where focus is in the compare view, as something a redraw cannot break: a
// column's control by programme and kind (and its column, in case it goes),
// a link by its address, or the sideways scroll box.
function compareFocus() {
  const active = document.activeElement;
  if (!active || !dom.compareBody.contains(active)) return null;
  const head = active.closest('th');
  const id = head?.getAttribute('data-id');
  if (id) {
    const ids = [...dom.compareBody.querySelectorAll('th')].map((th) => th.getAttribute('data-id')).filter(Boolean);
    return { id, kind: active.matches('[data-save-id]') ? 'save' : 'remove', index: ids.indexOf(id) };
  }
  const link = active.closest('a');
  if (link) return { kind: 'link', href: link.getAttribute('href') };
  return { kind: 'box' };
}

// The same control if its programme is still there; after an "x", the next
// column's "x", else the previous one's, else Browse in the empty state.
function restoreCompareFocus(focus, ids) {
  const removeOf = (id) => dom.compareBody.querySelector(`[data-compare-remove="${id}"]`);
  let target = null;
  if (focus.kind === 'save' || focus.kind === 'remove') {
    if (ids.includes(focus.id)) {
      target = focus.kind === 'save' ? dom.compareBody.querySelector(`th [data-save-id="${focus.id}"]`) : removeOf(focus.id);
    } else {
      const at = Math.min(focus.index, ids.length);
      target = ids.length ? removeOf(ids[at] ?? ids[at - 1]) : dom.compareBrowse;
    }
  } else if (focus.kind === 'link') {
    target = [...dom.compareBody.querySelectorAll('a')].find((link) => link.getAttribute('href') === focus.href) ?? null;
  }
  target ??= dom.compareBody.querySelector('.cmp-scroll') ?? (ids.length ? null : dom.compareBrowse);
  (target ?? dom.compareHeading).focus({ preventScroll: true });
}

// The column's "x": out of Compare, with Undo putting it back in its place,
// before the programmes that came after it (another may have gone meanwhile),
// or the limit toast if four have been added since.
function removeFromCompare(id, fromKeyboard = false) {
  const later = compareIds.slice(compareIds.indexOf(id) + 1);
  changeCompare((ids) => ({ ids: ids.filter((x) => x !== id), result: 'removed' }));
  syncCompareControls();
  showToast(t('r3_cmp_removed'), t('r2_undo'), () => {
    const result = changeCompare((ids) => {
      const at = ids.findIndex((x) => later.includes(x));
      return restoreAt(ids, id, at < 0 ? ids.length : at, knownIds());
    });
    if (result === 'full') {
      if (compareOpen) dom.compareHeading.focus({ preventScroll: true });
      showToast(t('r3_cmp_full'), t('r3_cmp_open_label'), () => openCompare(null));
      return;
    }
    syncCompareControls();
    // Focus moves to the programme it brought back before the toast goes.
    const back = compareOpen ? dom.compareBody.querySelector(`[data-compare-remove="${id}"]`)
      : document.querySelector(`.row [data-compare-id="${id}"]`);
    back?.focus({ preventScroll: true });
  }, { focusAction: fromKeyboard });
}

// returnFocus true (Close, Browse, the header button): back where Compare was
// opened, at the same scroll, focus on the button that opened it or the next
// best entry. false (another view takes over): hide it and restore nothing.
function closeCompare(returnFocus) {
  if (!compareOpen) return;
  compareOpen = false;
  const from = compareFrom;
  compareFrom = null;
  dom.compare.hidden = true;
  dom.split.hidden = false;
  dom.compareBody.replaceChildren();
  renderListBar();
  syncCompareControls();
  // An update while Compare was open (a filter, the language, another tab)
  // left the list empty: renderWindow draws nothing under Compare. Hold the
  // full length so the old position is reachable, then draw the rows there.
  // Estimates read while the list was hidden used its zero width and no
  // container query (180 px rows on a 90 px desktop): read them again first.
  if (dom.results.getBoundingClientRect().width !== windowWidth) resetRowHeights();
  dom.results.style.minHeight = `${rowOffsets.at(-1)}px`;
  if (returnFocus) window.scrollTo(window.scrollX, from.scrollY);
  renderWindow();
  dom.results.style.minHeight = '';
  if (!returnFocus) return;
  const target = [from.trigger, document.getElementById('header-compare'), document.getElementById('cmp-tray-open')].find(canShow) ?? dom.resultsSection;
  target.focus({ preventScroll: true });
}

// In the page and not hidden by itself, an ancestor or the stylesheet.
function canShow(node) {
  if (!node || !document.body.contains(node)) return false;
  for (let n = node; n; n = n.parentElement) if (n.hidden) return false;
  return typeof node.getClientRects !== 'function' || node.getClientRects().length > 0;
}

// The logo goes home (Leon, 2026-11-05): the main list, out of My list, a
// shared list or Compare. Filters, search, sort, saves, the Compare set and the
// pane's pick all stay. update() then drops list= from the address. The logo's
// handler (wireCompactHeader) scrolls to the top and moves focus.
function goHome() {
  scrollingHome = true;
  closeCompare(false);
  shared = null;
  state.shortlistOnly = false;
  listAll = false;
  for (const panel of document.querySelectorAll('.ml-pop,.dropdown')) if (panel.open) panel.open = false;
  update();
}

function clearAll() {
  preferencesDirty = false; writeSaved(null);
  for (const key of FACET_FIELDS) editedFacets.add(key);
  state.search = '';
  state.maxTuition = null;
  state.maxBudget = null;
  state.myLiving = null;
  state.myIbPoints = null;
  state.sort = 'deadline'; state.dir = 'asc'; explicitSort = false;
  state.subjectAreas.clear();
  state.countries.clear();
  state.languages.clear();
  state.degreeTypes.clear();
  state.cities.clear();
  dom.deadline.value = 'any';
  dom.myMaths.value = '';
  dom.exam.value = '';

  dom.search.value = '';
  dom.points.value = '';
  dom.maths.checked = false;
  dom.tuition.value = '';
  dom.budget.value = '';
  dom.living.value = '';
  readFields();
  // Re-render the option lists to clear their local searches as well as ticks.
  // Re-render the chips rather than reaching into render.js's markup with a
  // selector — a class rename there would silently break unchecking here.
  drawChips();

  update();
}

// Clear all disables itself, and the empty state's copy hides once rows come
// back, so focus left on either fell to the page. Where it was is read before
// clearing changes anything. In the sheet it goes to the heading; from the bar
// or the empty state to Search, the first filter.
function clearAllFrom(button) {
  const inSheet = dom.sheet.open && dom.sheet.contains(button);
  clearAll();
  if (inSheet) dom.sheetHeading.focus();
  else dom.search.focus({ preventScroll: true });
}

function update() {
  if (!loaded) return;
  syncSort();
  if (preferencesDirty) persistPreferences();
  // Rebuilt rows while printing would take the paper's layout. Run it after.
  if (printing) { updateAfterPrint = true; return; }
  settleSlots();
  // A debounced filter can land after the viewport crosses 1200 but before the
  // change event. Finish the crossing first, or the pick stays in the hidden pane.
  if (appliedWide !== null && appliedWide !== wideQuery.matches) crossWide();
  // After the crossing, which needs the whole old list; every rebuild starts
  // with nothing pending.
  cancelRows();

  const focus = snapshotFocus();

  // Deadlines are "today"-relative, so a new local day means working them out
  // again before filtering and sorting (S06).
  const now = new Date();
  if (localDay(now) !== dataDay) {
    applyToday(allRows, now);
    dataDay = localDay(now);
  }

  // An empty list view stays open (batch 3 B3): its empty state says how to
  // save. It used to turn itself off, so "My list (0)" did nothing.
  if (!state.shortlistOnly) listAll = false;

  // The list view: the saved (or shared) programmes, with the page's filters
  // unless "Show all saves" is on, sorted, then grouped (groupRows).
  const scope = shared ? new Set(shared.ids) : shortlist;
  const inScope = state.shortlistOnly ? allRows.filter((row) => scope.has(row.id)) : [];
  const filtered = applyFilters(allRows, state, scope);
  let rows = sortRows(state.shortlistOnly && listAll ? inScope : filtered, state.sort, state.dir, state);
  listIds = sortRows(inScope, 'name').map((row) => row.id);
  listShown = state.shortlistOnly ? filtered.length : 0;
  listHeadings = new Map();
  if (state.shortlistOnly) {
    const groups = groupRows(rows, groupBy, state, pointsBucket);
    rows = groups.flatMap((group) => group.rows);
    listHeadings = groupHeadings(groups);
  }
  // Read before the rows are rebuilt: afterwards it forces a layout of the
  // whole new list (about 120 ms at 4x CPU throttling, L09).
  const paneScroll = appliedWide ? dom.pane.scrollTop : 0;
  currentlyShown = rows.length;
  currentSummary = pointsSummaryParts(rows, state);

  rowObserver.disconnect();
  // Shown before measuring: coming back from "No programmes match", a hidden
  // list read zero width and the 180 px estimate (no container query).
  dom.listp.hidden = rows.length === 0;
  // Keep the old scroll range during the layout read for the new estimates.
  dom.results.style.minHeight = `${rowOffsets.at(-1)}px`;
  dom.results.replaceChildren();
  windowRows = rows;
  resetRowHeights();
  shownRows = new Map(rows.map((row) => [row.id, row]));
  appliedWide = wideQuery.matches;
  if (appliedWide) {
    openIds.clear();
    drawPane({ scroll: paneScroll });
  } else {
    for (const id of openIds) if (!shownRows.has(id)) openIds.delete(id);
  }
  renderWindow(focus?.id);
  dom.results.style.minHeight = '';
  if (rows.length > 40) scheduleSheetWarm();
  renderEmptyState(rows.length);
  restoreFocus(focus);
  renderCounts(rows.length);
  syncCompareEntry();
  drawCompare();
  keepAddress();
}

function resetRowHeights() {
  windowWidth = dom.results.getBoundingClientRect().width;
  const estimate = parseFloat(getComputedStyle(dom.results).getPropertyValue('--row-estimate')) || 180;
  rowHeights = windowRows.map((row) => estimate + (listHeadings.has(row.id) ? 40 : 0));
  indexRowHeights();
}

function indexRowHeights() {
  rowOffsets = [0];
  for (const height of rowHeights) rowOffsets.push(rowOffsets.at(-1) + height);
}

// The row containing this offset (also clamps a restored scroll position).
function rowAt(offset) {
  let lo = 0, hi = windowRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rowOffsets[mid + 1] <= offset) lo = mid + 1; else hi = mid;
  }
  return Math.min(lo, Math.max(0, windowRows.length - 1));
}

function scheduleWindow() {
  if (loaded && !windowFrame && !isPrinting() && sheetSlideTimer === undefined && !sheetDragHold && !faqSliding) {
    windowFrame = requestAnimationFrame(() => { windowFrame = 0; renderWindow(); });
  }
}

function cancelRows() {
  cancelAnimationFrame(windowFrame);
  windowFrame = 0;
}

function renderWindow(keepId, all = false) {
  if (!windowRows.length || (compareOpen && !all)) return;
  const scrollX = window.scrollX, scrollY = window.scrollY;
  const box = dom.results.getBoundingClientRect();
  // WebKit clamps scrollY if any layout read sees the list without its gaps.
  // Hold its height until the replacement rows and sized gaps are all in place.
  const minHeight = dom.results.style.minHeight;
  dom.results.style.minHeight = `${box.height}px`;
  // Width changes invalidate wrapping heights, including the 800px container
  // breakpoint. Preserve the visible programme and its offset while reflowing.
  let top = -box.top;
  const anchor = rowAt(Math.max(0, top));
  const oldOffset = rowOffsets[anchor];
  if (!all && box.width !== windowWidth) {
    resetRowHeights();
    top += rowOffsets[anchor] - oldOffset;
  }
  const view = document.documentElement.clientHeight;
  const start = all ? 0 : rowAt(Math.max(0, top - WINDOW_SCREENS * view));
  const end = all ? windowRows.length : Math.min(windowRows.length, rowAt(top + (1 + WINDOW_SCREENS) * view) + 1);
  const indices = new Set(Array.from({ length: end - start }, (_, i) => start + i));
  // A focused control survives a fling, even outside the visible window. A
  // separate gap holds its place; it never pulls thousands of rows into DOM.
  const focusedId = document.activeElement.closest?.('li.item')?.dataset.id;
  for (const id of [keepId, focusedId]) {
    const i = windowRows.findIndex((row) => row.id === id);
    if (i >= 0) indices.add(i);
  }
  const wanted = [...indices].sort((a, b) => a - b);
  const existing = new Map([...dom.results.querySelectorAll('li.item')].map((item) => [item.dataset.id, item]));
  const wantedIds = new Set(wanted.map((i) => windowRows[i].id));
  for (const [id, item] of existing) if (!wantedIds.has(id)) {
    for (const slot of item.querySelectorAll('.expand')) cancelSlotWork(slot);
    rowObserver.unobserve(item);
    item.remove();
  }
  for (const spacer of dom.results.querySelectorAll('.row-space')) spacer.remove();
  let cursor = dom.results.children[0] ?? null;
  const place = (node) => {
    if (cursor === node) cursor = cursor.nextElementSibling;
    else dom.results.insertBefore(node, cursor);
  };
  const gaps = [];
  const gap = (from, to) => {
    if (to <= from) return;
    const node = document.createElement('li');
    node.className = 'row-space';
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('role', 'presentation');
    place(node);
    gaps.push({ node, from, to });
  };
  let previous = 0;
  for (const i of wanted) {
    gap(previous, i);
    const row = windowRows[i];
    let item = existing.get(row.id);
    if (!item) {
      const holder = document.createElement('ul');
      [item] = appendRows(holder, [row], { state, shortlist, compare: new Set(compareIds), wide: appliedWide, headings: listHeadings });
      arrive([item]);
    }
    item.setAttribute('aria-posinset', String(i + 1));
    item.setAttribute('aria-setsize', String(windowRows.length));
    place(item);
    if (!all) rowObserver.observe(item);
    previous = i + 1;
  }
  gap(previous, windowRows.length);
  const sizeGaps = () => { for (const { node, from, to } of gaps) node.style.height = `${rowOffsets[to] - rowOffsets[from]}px`; };
  sizeGaps();
  if (all) { dom.results.style.minHeight = minHeight; return; }
  let changed = false;
  for (const i of wanted) {
    const height = selectedItem(windowRows[i].id).getBoundingClientRect().height;
    if (height > 0 && Math.abs(height - rowHeights[i]) > 0.25) { rowHeights[i] = height; changed = true; }
  }
  if (changed) { indexRowHeights(); sizeGaps(); }
  dom.results.style.minHeight = minHeight;
  // Native anchoring is disabled for this page: otherwise Chrome applies the
  // same correction twice, while Safari applies none. Never anchor above list.
  const correction = top > 0 ? rowOffsets[anchor] - oldOffset : 0;
  // A correction is an instant scroll, which cancels the logo's smooth trip
  // home. Keep measuring the rows, then resume anchoring when it ends.
  if (scrollingHome && scrollY === 0) scrollingHome = false;
  if (correction && !scrollingHome) window.scrollTo(scrollX, scrollY + correction);
}

function mountRow(id) {
  if (!shownRows.has(id)) return null;
  renderWindow(id);
  return selectedItem(id);
}

// Print is the one exception: synchronously mount the complete filtered list.
function flushRows() {
  cancelRows();
  rowObserver.disconnect();
  renderWindow(null, true);
}

// A row that arrives gets the state it had before the rebuild: its slot open
// (narrow, no motion) or the selection marks (wide).
function arrive(items) {
  for (const item of items) {
    const id = item.dataset.id;
    if (!appliedWide && openIds.has(id)) openRow(item, shownRows.get(id));
    else if (appliedWide && id === selectedId) markSelected(item);
  }
}

// animate is only for a direct narrow toggle. Rebuilds and 1200 crossings put
// the slot back fully open with no motion (spec §7, §8).
function openRow(item, row, { animate = false } = {}) {
  const move = animate && !motionQuery.matches;
  // A slot still closing is reused and turned back; its old cleanup is cancelled
  // so it cannot remove the reopened slot.
  let slot = item.querySelector('.expand');
  if (slot) {
    cancelSlotWork(slot);
    slot.inert = false;
    slot.setAttribute('data-state', 'open');
  } else {
    slot = renderSlot(row, state, { saved: shortlist.has(row.id), inCompare: compareIds.includes(row.id) });
    if (move) slot.setAttribute('data-state', 'closed');
    item.append(slot);
    if (move) {
      // Without this read the first frame resolves straight to the open style
      // and nothing animates.
      getComputedStyle(slot).gridTemplateRows;
      const frame = requestAnimationFrame(() => {
        slotWork.delete(slot);
        slot.setAttribute('data-state', 'open');
      });
      slotWork.set(slot, { kind: 'open', frame });
    } else slot.setAttribute('data-state', 'open');
  }
  item.classList.add('is-open');
  const button = item.querySelector('button.open');
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', slot.id);
}

// The row's state changes at once; only the slot's exit waits for its
// transition (or 250 ms if transitionend never comes, spec §8).
function closeRow(item) {
  const id = item.dataset.id;
  const button = item.querySelector('button.open');
  item.classList.remove('is-open');
  button.setAttribute('aria-expanded', 'false');
  openIds.delete(id);
  if (selectedId === id) selectedId = [...openIds].at(-1) ?? null;
  const slot = item.querySelector('.expand');
  if (!slot) return;
  const pending = cancelSlotWork(slot);
  // Focus would otherwise be left inside an inert, vanishing region.
  if (slot.contains(document.activeElement)) button.focus({ preventScroll: true });
  // Closed before its first frame: it never grew, so no transition will end.
  if (motionQuery.matches || pending?.kind === 'open') {
    removeSlot(slot);
    return;
  }
  slot.setAttribute('data-state', 'closed');
  slot.inert = true;
  const done = () => { cancelSlotWork(slot); removeSlot(slot); };
  // Only the slot's own row track; a child's or the opacity transition ending
  // says nothing about the height.
  const end = (event) => { if (event.target === slot && event.propertyName === 'grid-template-rows') done(); };
  slot.addEventListener('transitionend', end);
  slotWork.set(slot, { kind: 'close', end, timer: setTimeout(done, 250) });
}

function cancelSlotWork(slot) {
  const work = slotWork.get(slot);
  if (!work) return null;
  slotWork.delete(slot);
  if (work.frame !== undefined) cancelAnimationFrame(work.frame);
  if (work.timer !== undefined) clearTimeout(work.timer);
  if (work.end) slot.removeEventListener('transitionend', work.end);
  return work;
}

function removeSlot(slot) {
  const item = slot.parentElement;
  // A rebuilt list has already dropped it; never touch a detached row.
  if (!item || !dom.results.contains(item)) return;
  slot.remove();
  const button = item.querySelector('button.open');
  if (button.getAttribute('aria-controls') === slot.id) button.removeAttribute('aria-controls');
}

// Finish every slot effect now: opening slots open, closing slots go. Before a
// rebuild or a 1200 move, for print, on failure and when reduced motion is
// turned on.
function settleSlots() {
  for (const slot of [...slotWork.keys()]) {
    const work = cancelSlotWork(slot);
    if (work.kind === 'open') slot.setAttribute('data-state', 'open');
    else removeSlot(slot);
  }
}

function toggleRow(event) {
  // A save star on a row or the slot's "Save to my list": never opens the row.
  const save = event.target.closest('button[data-save-id]');
  if (save) {
    onToggleStar(save.getAttribute('data-save-id'));
    return;
  }
  // The compare toggle (row or slot) never opens the row either.
  const compare = event.target.closest('button[data-compare-id]');
  if (compare) {
    onToggleCompare(compare.getAttribute('data-compare-id'));
    return;
  }
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
    if (id === selectedId && paneId === id) {
      dom.pane.focus({ preventScroll: true });
      return;
    }
    selectRow(id);
  } else if (openIds.has(id)) {
    closeRow(item);
  } else {
    openRow(item, shownRows.get(id), { animate: true });
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
  if (item) markSelected(item);
}

function markSelected(item) {
  item.classList.add('is-sel');
  item.querySelector('button.open').setAttribute('aria-current', 'true');
  const goto = document.createElement('a');
  goto.className = 'goto';
  goto.setAttribute('href', '#pane');
  goto.textContent = t('go_to_details');
  item.append(goto);
}

// fade: a user picked a different programme. Only the new content fades in,
// by CSS on fresh nodes (.fade-in), so no callback can reach a later pick.
// Refreshes, filtering and breakpoint moves stay instant (spec §8).
// scroll: the pane's scrollTop as update() read it before rebuilding the rows.
function drawPane({ fade = false, scroll } = {}) {
  const changed = paneId !== selectedId;
  const current = scroll ?? dom.pane.scrollTop;
  const row = allRows.find((row) => row.id === selectedId) ?? null;
  const mode = renderPane({ pane: dom.pane, heading: dom.paneHeading, body: dom.paneBody }, row, shownRows.has(selectedId), state,
    { saved: row ? shortlist.has(row.id) : undefined, inCompare: row ? compareIds.includes(row.id) : undefined, savedCount: shortlist.size });
  if (fade && changed && mode === 'content') dom.paneBody.children[0].classList.add('fade-in');
  paneId = selectedId;
  // Same pick keeps its place, clamped to the new content; a new pick starts
  // at the top. An unscrolled pane needs neither, and is left alone (L09).
  if (current > 0) dom.pane.scrollTop = changed ? 0 : Math.max(0, Math.min(current, dom.pane.scrollHeight - dom.pane.clientHeight));
}

function selectRow(id) {
  const focus = snapshotFocus();
  selectedId = id;
  decorateSelection();
  drawPane({ fade: true });
  restoreFocus(focus);
}

// Each summary has one Tab stop. Focus (including a mouse click or a restore)
// moves that stop between its native controls; detail links keep normal Tab.
const ROW_CONTROLS = 'button.open, button.cmpi, button.star';
function rowTabStop(target) {
  if (!target.matches(ROW_CONTROLS) || !dom.results.contains(target)) return;
  const item = target.closest('li.item');
  for (const control of item.querySelectorAll(ROW_CONTROLS)) {
    control.setAttribute('tabindex', control === target ? '0' : '-1');
  }
}

function rowKeydown(event) {
  if (!event.target.matches(ROW_CONTROLS) || event.isComposing
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const item = event.target.closest('li.item');
  const controls = [...item.querySelectorAll(ROW_CONTROLS)];
  const column = controls.indexOf(event.target);
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    controls[column + (event.key === 'ArrowLeft' ? -1 : 1)]?.focus({ preventScroll: true });
    return;
  }
  const i = windowRows.findIndex((row) => row.id === item.dataset.id);
  const row = windowRows[i + (event.key === 'ArrowUp' ? -1 : 1)];
  const next = row && mountRow(row.id);
  if (!next) return;
  next.querySelectorAll(ROW_CONTROLS)[column].focus({ preventScroll: true });
  if (wideQuery.matches) selectRow(next.dataset.id);
  revealRow(next);
}

// Bring the whole new pick into view under the sticky column header (its
// scroll-margin). Default focus scrolling showed only the title and left up to
// 63 px of the row below the fold. A row taller than the room shows its top.
function revealRow(item) {
  const style = getComputedStyle(item);
  const room = document.documentElement.clientHeight - parseFloat(style.scrollMarginTop) - parseFloat(style.scrollMarginBottom);
  item.scrollIntoView({ block: item.getBoundingClientRect().height <= room ? 'nearest' : 'start' });
}

// Describe focus before removing a subtree: afterward activeElement can be body.
function snapshotFocus() {
  const active = document.activeElement;
  const item = active.closest('li.item');
  const id = item?.dataset.id;
  if (active.matches('button.open') && item) return { kind: 'row', id };
  if (active.matches('a.goto') && item) return { kind: 'goto', id };
  if (item && active.closest('.row')) {
    if (active.matches('[data-save-id]')) return { kind: 'save', id };
    if (active.matches('[data-compare-id]')) return { kind: 'compare', id };
  }
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
  const item = selectedItem(focus.id) ?? mountRow(focus.id);
  const button = item?.querySelector('button.open');
  let target;
  if (focus.kind === 'save') target = item?.querySelector('button.star');
  else if (focus.kind === 'compare') target = item?.querySelector('button.cmpi');
  else if (focus.kind === 'row') target = button;
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
  rowTabStop(document.activeElement);
  crossingFocus = snapshotFocus();
  listFocus = isListTool(document.activeElement) ? document.activeElement : null;
  filterFocus = isFilterControl(document.activeElement) ? document.activeElement : null;
  compareNavFocus = isCompareNav(document.activeElement) ? document.activeElement : null;
}

function forgetFocus(event) {
  if (event.relatedTarget || appliedWide === wideQuery.matches) crossingFocus = null;
  if (event.relatedTarget || appliedBar === barQuery.matches) { filterFocus = null; listFocus = null; compareNavFocus = null; }
}

// Compare's phone arrows ("Previous/Next programme"), hidden from 600 px.
function isCompareNav(node) {
  return !!node && !!node.closest?.('.cmp-nav') && dom.compareBody.contains(node);
}

function isListTool(node) {
  return !!node && node !== document.body && (node === dom.listMore || dom.listTools.contains(node));
}

function isFilterControl(node) {
  return !!node && node !== document.body && (dom.form.contains(node) || dom.sheet.contains(node) || node === dom.copy || node === dom.more);
}

function crossWide() {
  const wide = wideQuery.matches;
  // While printing the query follows the paper; afterPrint() runs any crossing
  // still due from the restored screen.
  if (!loaded || appliedWide === wide || isPrinting()) return;
  // Mounted rows change now; later arrivals use appliedWide.
  const focus = snapshotFocus() ?? (document.activeElement === document.body ? crossingFocus : null);
  settleSlots();
  clearSelection();
  if (wide) {
    for (const item of dom.results.querySelectorAll('li.item')) {
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
    if (selectedId && shownRows.has(selectedId)) openIds.add(selectedId);
    const item = selectedItem();
    if (item) {
      openRow(item, shownRows.get(selectedId));
      openIds.add(selectedId);
    }
  }
  appliedWide = wide;
  renderWindow(focus?.id);
  restoreFocus(focus);
  // Only the row/pane record: a 600 crossing may still be pending.
  crossingFocus = snapshotFocus();
}

// Moves the one copy of each control between the bar and the sheet (§6.3).
// Nothing is cloned, so values, ticks and open lists come along. A node
// already in place is not touched: moving a focused node drops its focus.
function placeFilters() {
  const bar = barQuery.matches;
  if (appliedBar === bar) return;
  const active = document.activeElement;
  const was = active && active !== document.body ? active : filterFocus;
  const listWas = isListTool(active) ? active : listFocus;
  const compareWas = isCompareNav(active) ? active : compareNavFocus;
  const moved = !!was && (dom.moreFilters.contains(was) || was === dom.clear || was === dom.copy);
  let target = null;
  if (moved) target = bar ? was : dom.more;
  // Widening from the sheet or the Filters button, which both disappear.
  else if (bar && was && (dom.sheet.contains(was) || was === dom.more)) target = dom.tuition;
  if (bar) {
    closeSheet(false);
    cancelAnimationFrame(dom.copyStatusFrame);
    dom.copyStatus.textContent = '';
  }
  const put = (parent, node, before = null) => {
    if (node.parentElement !== parent || node.nextElementSibling !== before) parent.insertBefore(node, before);
  };
  // My list: on phones the header scrolls away, so the button sits in the
  // sticky count row beside Filters (Leon, 2026-11-06); from 600 px it goes
  // back before Compare in the header. One button, so its count, pressed state
  // and handlers need no syncing. Moving a focused node drops its focus.
  const listFocused = active === dom.headerList;
  const headerRight = dom.headerCompare?.parentElement;
  if (headerRight) {
    if (bar) put(headerRight, dom.headerList, dom.headerCompare);
    else put(dom.status, dom.headerList, dom.more);
    if (listFocused && document.activeElement !== dom.headerList) dom.headerList.focus({ preventScroll: true });
  }
  if (bar) {
    put(dom.form, dom.moreFilters);
    put(dom.status, dom.clear, dom.copy.parentElement === dom.status ? dom.copy : null);
    put(dom.status, dom.copy, dom.copyHelp.parentElement === dom.status ? dom.copyHelp : null);
    put(dom.status, dom.copyHelp, dom.copyStatus.parentElement === dom.status ? dom.copyStatus : null);
    put(dom.status, dom.copyStatus);
  } else {
    put(dom.sheetBody, dom.copy, dom.copyHelp.parentElement === dom.sheetBody ? dom.copyHelp : null);
    put(dom.sheetBody, dom.copyHelp, dom.copyStatus.parentElement === dom.sheetBody ? dom.copyStatus : null);
    put(dom.sheetBody, dom.copyStatus);
    put(dom.sheetBody, dom.moreFilters, dom.copy);
    put(dom.sheetFoot, dom.clear, dom.sheetShow);
  }
  appliedBar = bar;
  if (target) target.focus({ preventScroll: true });
  else if (listWas) keepListFocus(listWas, bar);
  else if (compareWas) keepCompareFocus(compareWas, bar);
  filterFocus = isFilterControl(document.activeElement) ? document.activeElement : null;
}

// Widening past 600 px hides Compare's arrows, and a focused arrow dropped
// focus to the page (review of PR 1, 2026-11-07). The comparison's scroll box
// is what the arrows move, and it stays shown and focusable.
function keepCompareFocus(was, bar) {
  if (!bar || !compareOpen || was.getClientRects().length) return;
  dom.compareBody.querySelector('.cmp-scroll')?.focus({ preventScroll: true });
}

// Crossing 600 px hides the control that had focus in My list: More from 600
// px up (focus goes to the first tool still shown, Back or Group by), and
// Share, Export and Print below 600 px while More is closed (More opens so the
// tool stays; it takes focus back if the browser already dropped it).
function keepListFocus(was, bar) {
  if (bar) {
    if (was !== dom.listMore || dom.listMore.getClientRects().length) return;
    const next = [dom.shortlistOnly, dom.groupBy].find((node) => node.getClientRects().length);
    next?.focus({ preventScroll: true });
  } else if (was !== dom.listMore && !listMoreOpen && !dom.listMore.hidden) {
    listMoreOpen = true;
    syncListMore();
    if (document.activeElement !== was) was.focus({ preventScroll: true });
  }
}

function crossBar() {
  if (isPrinting()) return;
  placeFilters();
  // Narrowing while scrolled: the observer may not call back again, so read
  // where the mark is now.
  if (!barQuery.matches) sentinelAbove = dom.stuckMark.getBoundingClientRect().bottom <= 0;
  syncStuck();
}

function isPrinting() {
  return printing || printQuery.matches;
}

function afterPrint() {
  printing = false;
  // The tray's room at the foot of the page first, or the restored position
  // is clamped by its height on phones. A tray that stays hidden gives the
  // room back (wireTray keeps it during print).
  syncTray();
  if (dom.tray.hidden) document.documentElement.style.removeProperty('--tray-h');
  // Drop the printed catalogue before reading screen geometry, retaining the
  // measured offsets so the same programme stays in view.
  if (printFlushed) {
    printFlushed = false;
    const focus = snapshotFocus();
    dom.results.style.minHeight = `${rowOffsets.at(-1)}px`;
    dom.results.replaceChildren();
    window.scrollTo(window.scrollX, printScrollY);
    renderWindow(focus?.id);
    dom.results.style.minHeight = '';
    restoreFocus(focus);
  }
  crossBar();
  crossWide();
  if (updateAfterPrint) {
    updateAfterPrint = false;
    update();
  }
}

// Safari restyles all 116,000 result elements when a modal makes them inert
// (~500 ms). aria-hidden on their ancestor costs ~440 ms too. aria-modal,
// a scrim and managed focus avoid both; VoiceOver on a real iPhone still needs QA.
function wireSheet() {
  document.addEventListener('keydown', () => { keyboardInput = true; }, true);
  document.addEventListener('pointerdown', () => { keyboardInput = false; }, true);
  // Pause window updates at finger-down, before the browser synthesises the click.
  // A cancelled tap is released by the same bounded fallback as a lost end.
  dom.more.addEventListener('pointerdown', () => { if (!barQuery.matches) pauseSheetRows(); });
  dom.more.addEventListener('click', openSheet);
  dom.sheetDone.addEventListener('click', () => closeSheet());
  // Filters apply live, so "Show N programmes" only closes the sheet.
  dom.sheetShow.addEventListener('click', () => closeSheet());
  dom.sheetScrim.addEventListener('click', () => closeSheet());
  // Bubble phase: round2.js first gives Escape to an inner pick-list/help.
  document.addEventListener('keydown', (event) => {
    if (!dom.sheet.open || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeSheet();
    } else if (event.key === 'Tab') {
      const controls = [...dom.sheet.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]')]
        .filter((node) => !node.disabled && node.tabIndex >= 0 && canShow(node));
      const first = controls[0] ?? dom.sheetHeading, last = controls.at(-1) ?? dom.sheetHeading;
      const active = document.activeElement;
      if (!controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ focusVisible: true });
      }
    }
  });
  document.addEventListener('focusin', (event) => {
    if (dom.sheet.open && !dom.sheet.contains(event.target)) dom.sheetHeading.focus({ preventScroll: true, focusVisible: keyboardInput });
  });
  // A12: the handle and header drag the sheet down; Done's close path ends it.
  sheetDrag = wireSheetDrag(dom.sheet, { regions: '.grab,.sheet-h', enabled: () => dom.sheet.open && !barQuery.matches,
    hold: holdSheetRows, release: releaseSheetRows, close: () => closeSheet() });
  dom.sheet.addEventListener('close', finishSheetClose);
  dom.sheet.addEventListener('transitionend', (event) => {
    if (event.target === dom.sheet && event.propertyName === 'transform') resumeSheetRows();
  });
}

// WebKit's long list layouts compete with either direction of the slide.
// Resume window updates when it ends; print still mounts all rows. The timer covers a cancelled/missing transition.
function pauseSheetRows() {
  if (motionQuery.matches) return;
  cancelRows();
  clearTimeout(sheetSlideTimer);
  dom.sheet.classList.add('is-sliding');
  dom.sheetScrim.classList.add('is-sliding');
  // Allow the 280 ms slide plus its first-frame work at 4x CPU.
  sheetSlideTimer = setTimeout(resumeSheetRows, 500);
}

// A finger holds the sheet: no time limit, and a stray transitionend or the
// open slide's timer cannot resume rows under it.
function holdSheetRows() {
  sheetDragHold = true;
  clearTimeout(sheetSlideTimer);
  sheetSlideTimer = undefined;
  cancelRows();
  dom.sheet.classList.add('is-sliding');
  dom.sheetScrim.classList.add('is-sliding');
}

// Let go: the settle or the close slides, so the bounded pause takes over.
function releaseSheetRows() {
  if (!sheetDragHold) return;
  sheetDragHold = false;
  if (!motionQuery.matches) { pauseSheetRows(); return; }
  dom.sheet.classList.remove('is-sliding');
  dom.sheetScrim.classList.remove('is-sliding');
  scheduleWindow();
}

function resumeSheetRows() {
  if (sheetSlideTimer === undefined) return;
  clearTimeout(sheetSlideTimer);
  sheetSlideTimer = undefined;
  dom.sheet.classList.remove('is-sliding');
  dom.sheetScrim.classList.remove('is-sliding');
  scheduleWindow();
}

// Prepare the closed layout after the visible window has painted. Safari
// need not support requestIdleCallback. Hidden controls never receive focus or open a dialog.
function scheduleSheetWarm() {
  if (sheetWarmScheduled || barQuery.matches) return;
  sheetWarmScheduled = true;
  requestAnimationFrame(() => requestAnimationFrame(warmSheet));
}

function warmSheet() {
  if (dom.sheet.open || barQuery.matches || isPrinting()) return;
  dom.sheet.classList.add('is-warm');
}

function openSheet() {
  if (dom.sheet.open || barQuery.matches) return;
  sheetDrag?.reset();
  returnFocusOnClose = true;
  pauseSheetRows();
  dom.sheet.show();
  document.documentElement.classList.add('sheet-open');
  dom.sheetScrim.classList.add('is-open');
  dom.more.setAttribute('aria-expanded', 'true');
  // show() has already focused the heading, its first focusable element,
  // with the browser's own guess at a ring, and focusing a focused element
  // changes nothing, so it lets go first.
  if (document.activeElement === dom.sheetHeading) dom.sheetHeading.blur();
  dom.sheetHeading.focus({ focusVisible: keyboardInput });
}

// returnFocus false: widening or total failure, where Filters is hidden.
function closeSheet(returnFocus = true) {
  if (!dom.sheet.open) return;
  sheetDrag?.reset();
  returnFocusOnClose = returnFocus;
  dom.sheet.close();
  finishSheetClose();
}

function finishSheetClose() {
  // close is queued: it must not undo a reopen or repeat synchronous cleanup.
  if (dom.sheet.open || !document.documentElement.classList.contains('sheet-open')) return;
  sheetDrag?.reset();
  // Closing used to resume mounting immediately, stalling the downward slide.
  if (barQuery.matches || motionQuery.matches) resumeSheetRows();
  else pauseSheetRows();
  cancelAnimationFrame(dom.copyStatusFrame);
  dom.copyStatus.textContent = '';
  document.documentElement.classList.remove('sheet-open');
  dom.sheetScrim.classList.remove('is-open');
  dom.more.setAttribute('aria-expanded', 'false');
  // iOS does not focus a tapped button, so the browser's own return can miss.
  if (returnFocusOnClose && !barQuery.matches && !dom.form.hidden) dom.more.focus({ preventScroll: true, focusVisible: keyboardInput });
  returnFocusOnClose = true;
}

// Phone only: the count line is stuck once the mark above it has scrolled out
// of the top of the window. Below the window is not stuck. No scroll handler.
function wireStuck() {
  if (typeof IntersectionObserver !== 'function') return;
  new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    sentinelAbove = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds ? entry.rootBounds.top : 0);
    syncStuck();
  }).observe(dom.stuckMark);
}

function syncStuck() {
  dom.status.classList.toggle('is-stuck', sentinelAbove && !barQuery.matches);
}

// Flush typed fields, then snapshot the address and its description together.
// A modal sheet owns its live feedback; otherwise the toast announces the result.
async function copyLink() {
  const before = stateToParams(state);
  readFields();
  if (stateToParams(state) !== before) update();
  else keepAddress();
  const params = stateToParams(state);
  const kind = linkContents(state, { shared: Boolean(shared) });
  const query = languageQuery(addressQuery(params, shared));
  const url = location.origin + location.pathname + (query ? `?${query}` : '');
  const inSheet = dom.sheet.open && dom.sheet.contains(dom.copy);
  const success = t(`r2_copied_${kind}`);
  const failSheet = t('r2_copy_failed_sheet'), failDesktop = t('r2_copy_failed_desktop');
  let message = success;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Texts in the click's language; which one is chosen when the copy settles: if the sheet closed meanwhile, "close
    // Filters first" would be wrong (batch 2 B review).
    const stillInSheet = inSheet && dom.sheet.open && dom.sheet.contains(dom.copy);
    message = stillInSheet ? failSheet : failDesktop;
  }
  if (inSheet && dom.sheet.open && dom.sheet.contains(dom.copy)) {
    dom.copyStatus.textContent = '';
    cancelAnimationFrame(dom.copyStatusFrame);
    dom.copyStatusFrame = requestAnimationFrame(() => { dom.copyStatus.textContent = message; });
  } else showToast(message);
}

// The visible sort control: a filter-style pick-list mirroring the hidden
// select's options. Rebuilt from the select, so language changes and
// renderSortOptions need nothing extra beyond calling this.
function sortPick() {
  const box = document.getElementById('sort-options');
  const details = document.getElementById('dd-sort');
  const current = document.getElementById('sort-current');
  if (!box || !details || !current) return;
  const options = [...(dom.sort.options ?? [])];
  const chosen = options.find((option) => option.selected);
  if (current.textContent !== (chosen?.textContent ?? '')) current.textContent = chosen?.textContent ?? '';
  const close = () => {
    details.open = false;
    details.querySelector('summary').focus();
  };
  // Arrow keys move through the radios and check each one, so each press
  // sorts, but the list stays open: closing on every change sent the
  // keyboard back to the button after one step. Enter, Space and Escape
  // (round2.js) close it; a click or tap still picks and closes. Wired once:
  // the radios below are rebuilt on every sort change.
  if (!sortKeysWired) {
    sortKeysWired = true;
    box.addEventListener('pointerdown', () => { sortByArrow = false; });
    box.addEventListener('keydown', (event) => {
      sortByArrow = event.key.startsWith('Arrow');
      if (event.key === 'Enter') { event.preventDefault(); close(); }
    });
    // Space on the radio already chosen fires no change, so it closes here.
    // On keyup, like the click it would make: closing on keydown let the
    // keyup reach the button and open the list again.
    box.addEventListener('keyup', (event) => {
      if (event.key === ' ' && event.target.checked) { event.preventDefault(); close(); }
    });
  }
  box.replaceChildren(...options.map((option) => {
    const label = document.createElement('label');
    label.className = 'option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'sort-pick';
    input.value = option.value;
    input.checked = option.selected;
    input.disabled = option.disabled;
    input.addEventListener('change', () => {
      if (input.disabled) return;
      const arrow = sortByArrow;
      sortByArrow = false;
      dom.sort.value = input.value;
      dom.sort.dispatchEvent(new Event('change'));
      // The change rebuilt the radios, so focus goes to the new copy.
      if (arrow) [...box.querySelectorAll('input')].find((node) => node.value === input.value)?.focus();
      else close();
    });
    const text = document.createElement('span');
    text.textContent = option.textContent;
    label.append(input, text);
    return label;
  }));
}

function syncSort() {
  setMyPoints(state, state.myIbPoints, explicitSort);
  renderSortOptions(dom.sort, SORTS, state.sort, state.dir, state);
  dom.sort.value = `${state.sort}:${state.dir}`;
  sortPick();
  for (const button of dom.sortButtons) {
    const key = button.dataset.sort;
    const active = key === state.sort;
    const current = active && state.dir === 'desc' ? REVERSE_SORTS[key] : SORTS[key];
    const next = active && state.dir === 'desc' && key !== 'deadline' ? t('r2_default_order')
      : active && state.dir === 'asc' ? REVERSE_SORTS[key] : SORTS[key];
    button.setAttribute('aria-pressed', String(active));
    if (key === 'name') button.querySelector('.sort-label').textContent = active && state.dir === 'desc' ? t('r2_programme_desc') : t('r2_programme_asc');
    button.querySelector('.visually-hidden').textContent = active
      ? t('sorted_activate_to_sort', { value1: current, value2: next }) : t('sort', { value1: next });
    // One mark box per heading, always present; only its symbol changes, so no
    // label moves. Up is the natural order (soonest, cheapest, lowest, A–Z).
    const mark = active ? (state.dir === 'desc' ? '#i-chevron' : '#i-chevron-up') : '#i-sort';
    const use = button.querySelector('.sm use');
    if (use.getAttribute('href') !== mark) use.setAttribute('href', mark);
    button.setAttribute('data-direction', active ? state.dir : '');
  }
}

// One chip per value, while counts remain one per active group.
function drawAppliedChips() {
  const chips = [];
  const scalar = (key, label, active) => { if (active) chips.push({ key, label }); };
  scalar('search', t('search', { value1: state.search.trim() }), state.search.trim());
  scalar('myIbPoints', t('my_ib_points', { value1: state.myIbPoints }), state.myIbPoints !== null);
  scalar('hlMaths', t('hl_maths_4'), state.hlMaths);
  scalar('maxTuition', t('max_eu_fee_year', { value1: state.maxTuition }), state.maxTuition !== null);
  scalar('maxBudget', t('max_yearly_cost', { value1: state.maxBudget }), state.maxBudget !== null);
  scalar('myLiving', t('my_living_costs_month', { value1: state.myLiving }), state.myLiving !== null);
  scalar('deadlineWindow', t('deadline_2', { value1: DEADLINE_WINDOWS[state.deadlineWindow] }), state.deadlineWindow !== 'any');
  scalar('myMaths', t('my_maths', { value1: state.myMaths }), state.myMaths !== null);
  scalar('exam', t('entrance_exam_2', { value1: EXAM_OPTIONS[state.exam] }), state.exam !== null);
  for (const [key, label] of [['subjectAreas', t('subject_area')], ['countries', t('country')], ['languages', t('language')], ['degreeTypes', t('degree_type')], ['cities', t('city')]]) {
    for (const value of state[key]) chips.push({ key: `${key}:${value}`, label: `${label}: ${value}` });
  }
  renderAppliedChips(dom.applied, chips, removeChip);
}

function removeChip(key) {
  preferencesDirty = true;
  const before = [...dom.applied.children];
  const at = before.findIndex((button) => button.getAttribute('data-chip') === key);
  const inSheet = dom.sheet.open && dom.sheet.contains(dom.applied);
  const colon = key.indexOf(':');
  if (colon >= 0) {
    const group = key.slice(0, colon), value = key.slice(colon + 1);
    state[group].delete(value);
    const box = { subjectAreas: dom.subjects, countries: dom.countries, languages: dom.languages, degreeTypes: dom.degrees, cities: dom.cities }[group];
    for (const input of box.querySelectorAll('input')) if (input.type === 'checkbox') input.checked = state[group].has(input.value);
  } else {
    const input = { search: dom.search, myIbPoints: dom.points, hlMaths: dom.maths, maxTuition: dom.tuition, maxBudget: dom.budget, myLiving: dom.living, deadlineWindow: dom.deadline, myMaths: dom.myMaths, exam: dom.exam }[key];
    if (key === 'hlMaths') input.checked = false;
    else input.value = key === 'deadlineWindow' ? 'any' : '';
    readFields();
  }
  update();
  const remaining = [...dom.applied.children];
  const target = remaining[at] || remaining[at - 1] || (inSheet ? dom.sheetHeading : dom.search);
  target.focus({ preventScroll: true });
}

function renderCounts(shown) {
  const active = activeFilterCount(state);
  const listTotal = listIds.length;

  // Whole phrases, not "X of Y" + a plural noun: after "z" Slovak needs the
  // genitive ("2 z 3 uložených programov"), which no stand-alone noun form gives.
  const rawLead = state.shortlistOnly
    ? t(shared ? 'count_of_link' : 'count_of_saved', { shown, count: listTotal })
    : active === 0
      ? `${shown} ${plural(shown)}`
      : t('count_of_all', { shown, count: allRows.length });
  // The count is a live region. Rewriting it with the same text on every
  // keystroke made a screen reader repeat it (A06), so only a change is written.
  const lead = rawLead.replace(/\d+/g, (value) => formatCount(Number(value)));
  renderCount(dom.count, lead, currentSummary);
  renderCount(dom.countSummary, '', currentSummary);
  dom.countSummary.hidden = currentSummary.length === 0;
  renderCountShort(dom.countShort, lead, currentSummary);

  // Each pick-list button shows how many of its values are ticked, so a closed
  // drop-down still tells you it is narrowing the results.
  showCount(dom.subjectsCount, dom.subjectsCountNumber, state.subjectAreas.size);
  showCount(dom.countriesCount, dom.countriesCountNumber, state.countries.size);
  showCount(dom.languagesCount, dom.languagesCountNumber, state.languages.size);
  showCount(dom.degreesCount, dom.degreesCountNumber, state.degreeTypes.size);
  showCount(dom.citiesCount, dom.citiesCountNumber, state.cities.size);
  drawAppliedChips();
  dom.clear.disabled = active === 0;
  dom.clear.textContent = active ? t('clear_all', { value1: active }) : t('clear_all_2');
  // Filters (n) counts only what lives in the sheet, one per group (§6.3):
  // every filter but Search, which stays in the header. IB points and HL
  // Maths moved into the sheet, and leaving them out showed "Filters (1)"
  // beside "Clear all (2)".
  const inSheet = active - (state.search.trim() ? 1 : 0);
  dom.more.querySelector('span').textContent = inSheet ? t('filters', { value1: inSheet }) : t('filters_2');
  dom.more.classList.toggle('is-on', inSheet > 0);
  // index.html starts it disabled as "Loading programmes…": until the first
  // count there is no number to show.
  dom.sheetShow.textContent = t('show', { value1: formatCount(shown), value2: plural(shown) });
  dom.sheetShow.disabled = false;
  markSet(dom.search, state.search.trim() !== '');
  markSet(dom.points, state.myIbPoints !== null);
  markSet(dom.tuition, state.maxTuition !== null);
  markSet(dom.budget, state.maxBudget !== null);
  markSet(dom.living, state.myLiving !== null);
  markSet(dom.deadline, state.deadlineWindow !== 'any');
  markSet(dom.myMaths, state.myMaths !== null);
  markSet(dom.exam, state.exam !== null);
  for (const [box, set] of [[dom.subjects, state.subjectAreas], [dom.countries, state.countries], [dom.languages, state.languages], [dom.degrees, state.degreeTypes], [dom.cities, state.cities]]) {
    box.closest('.dropdown').classList.toggle('is-set', set.size > 0);
  }

  renderListBar();
  syncRound2(dom, state, active, shortlist.size);
}

// The My list bar. Outside the list view: "3 saved · 2 shown", and "Show all
// saves" when the filters hide some. Inside it: the same counts for the list,
// the grouping, Compare, Share and the export. Saves whose programme is no
// longer in the data are not counted (they are kept, in case it comes back).
function renderListBar() {
  const known = new Set(allRows.map((row) => row.id));
  const saved = [...shortlist].filter((id) => known.has(id)).length;
  const mode = !state.shortlistOnly ? 'main' : shared ? 'shared' : 'mine';
  // Compare hides the bar while it is open, whatever else changes.
  dom.shortlistBar.hidden = compareOpen || (mode === 'main' && saved === 0 && !saveFailed);
  dom.shortlistBar.classList.toggle('is-list', mode !== 'main');
  dom.listTitle.textContent = mode === 'shared' ? t('shared_list') : t('my_list');
  const helpKey = shared ? 'r2_copy_help_shared' : 'r2_copy_help';
  dom.copyHelp.setAttribute('data-i18n', helpKey);
  dom.copyHelp.textContent = t(helpKey);

  let total, shown;
  if (mode === 'main') {
    total = saved;
    shown = [...shownRows.keys()].filter((id) => shortlist.has(id)).length;
  } else {
    total = listIds.length;
    shown = listShown;
  }
  const hidden = total - shown;
  // An empty My list shows only its title and "0 saved"; the empty card below
  // says how to save and has the way back (B3).
  const emptyMine = mode === 'mine' && listIds.length === 0;
  const parts = [mode === 'shared' ? t('in_this_link', { value1: total }) : t('saved_2', { value1: total })];
  if (emptyMine) { /* nothing is shown or hidden */ } else if (listAll && mode !== 'main') parts.push(t('all_shown_your_filters_are_off_here'));
  else {
    parts.push(t('shown', { value1: shown }));
    if (hidden > 0) parts.push(t('hidden_by_your_filters', { value1: hidden }));
  }
  const text = parts.join(' · ');
  if (dom.shortlistCount.textContent !== text) dom.shortlistCount.textContent = text;

  const filtersOff = listAll && mode !== 'main';
  dom.listShowAll.hidden = emptyMine || (!filtersOff && hidden <= 0);
  dom.listShowAll.textContent = filtersOff ? t('apply_my_filters') : mode === 'shared' ? t('show_all_in_this_link') : t('show_all_saves');
  dom.listSaveShared.hidden = mode !== 'shared';
  // The text has its own span so the back chevron survives (batch 3 B2).
  dom.shortlistOnlyText.textContent = mode === 'main' ? t('open_my_list') : mode === 'shared' ? t('close_shared_list') : t('back_to_all_programmes');

  const notes = [];
  if (saveFailed) notes.push(t('your_browser_could_not_save_your_list_it_may_be_lost_when_you_leave'));
  if (mode === 'shared') {
    const missing = unknownIdsText(shared.unknown.length);
    if (missing) notes.push(missing);
    if (sharedNote) notes.push(sharedNote);
  }
  if (mode !== 'main' && !emptyMine && groupBy === 'points' && state.myIbPoints === null) notes.push(t('enter_your_ib_points_to_group_the_list_by_them'));
  const note = notes.join(' ');
  if (dom.listNote.textContent !== note) dom.listNote.textContent = note;
  dom.listNote.hidden = note === '';

  dom.listTools.hidden = mode === 'main' || emptyMine;
  // An empty My list keeps one way back, the empty card's button: the bar's
  // own back button said the same thing beside it (alignment audit).
  dom.shortlistOnly.hidden = emptyMine;
  dom.listOrigin.hidden = mode !== 'mine' || emptyMine;
  for (const node of dom.listTools.querySelectorAll('.ml-mine')) node.hidden = mode !== 'mine';
  dom.share.hidden = mode !== 'mine';
  if (dom.groupBy.value !== groupBy) dom.groupBy.value = groupBy;
  if (mode === 'mine' && dom.share.open) syncShare();
  // More holds only the own list's tools, so a shared or empty list has none.
  dom.listMore.hidden = mode !== 'mine' || emptyMine;
  if (dom.listMore.hidden) listMoreOpen = false;
  syncListMore();
}

function syncListMore() {
  dom.listMore.setAttribute('aria-expanded', String(listMoreOpen));
  dom.shortlistBar.classList.toggle('ml-more-open', listMoreOpen);
}

// The "set" look on a field whose value is in force: valid, so fee 0 counts and
// an invalid number does not.
function markSet(input, set) {
  (input.closest('.fld') || input.closest('.dropdown')).classList.toggle('is-set', set);
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
  dom.emptyBack.hidden = true;
  dom.emptyTips.hidden = true;

  if (state.shortlistOnly && listIds.length === 0 && shared) {
    dom.emptyTitle.textContent = t('none_of_the_programmes_in_this_link_are_listed_any_more');
    dom.emptyHint.textContent = t('close_the_shared_list_to_see_every_programme');
  } else if (state.shortlistOnly && listIds.length === 0) {
    // An empty My list says how to save, with a way back (B3).
    dom.emptyTitle.textContent = t('your_list_is_empty');
    dom.emptyHint.textContent = t('r3_list_empty_hint');
    dom.emptyBack.hidden = false;
    dom.emptyBack.textContent = t('back_to_all_programmes');
  } else if (activeFilterCount(state) === 0) {
    // The old hint told students to add rows to the spreadsheet, which they
    // never see (S05). With no filter set, the list itself is missing.
    dom.emptyTitle.textContent = t('no_programmes_are_available');
    dom.emptyHint.textContent = t('the_programme_list_could_not_be_loaded_try_reloading_the_page');
  } else {
    // Name only the filters actually in use; the old fixed hint suggested the
    // tuition limit and countries even when neither was set (S05).
    dom.emptyTitle.textContent = t('no_programmes_match_your_filters');
    dom.emptyHint.textContent = t('try_changing', { value1: listOf(filtersInUse()) });
    dom.emptyClear.hidden = false;
    dom.emptyClear.textContent = t('clear_all', { value1: activeFilterCount(state) });
    dom.emptyTips.hidden = false;
  }
}

function filtersInUse() {
  const used = [];
  if (state.search.trim()) used.push(t('the_search', { value1: state.search.trim() }));
  if (state.myIbPoints !== null) used.push(t('your_ib_points'));
  if (state.hlMaths) used.push(t('hl_maths_4'));
  if (state.maxTuition !== null) used.push(t('the_eu_fee_limit'));
  if (state.maxBudget !== null) used.push(t('the_yearly_cost_limit'));
  if (state.myLiving !== null) used.push(t('your_living_costs'));
  if (state.subjectAreas.size) used.push(t('the_subject_areas'));
  if (state.countries.size) used.push(t('the_countries'));
  if (state.languages.size) used.push(t('the_languages'));
  if (state.deadlineWindow !== 'any') used.push(t('the_deadline_window'));
  if (state.myMaths !== null) used.push(t('your_maths_course'));
  if (state.exam !== null) used.push(t('the_entrance_exam_choice'));
  if (state.degreeTypes.size) used.push(t('the_degree_types'));
  if (state.cities.size) used.push(t('the_cities'));
  return used;
}

function listOf(items) {
  if (items.length <= 1) return items.join('');
  return t('or', { value1: items.slice(0, -1).join(', '), value2: items[items.length - 1] });
}

// The pick-lists are native <details>, so they open and close from the keyboard
// with no help. This adds what <details> does not do on its own: only one open
// at a time, and closing on a click outside, on Tab out, or on Escape.
function wireDropdowns() {
  const closeAll = (except) => {
    for (const d of dom.dropdowns) if (d !== except) d.open = false;
  };
  for (const d of dom.dropdowns) {
    // Ticked options go to the top as the list opens, never while it is open.
    // The click runs before the browser opens it, so there is no flash of the
    // old order; the toggle covers opening by find-in-page or a script. Only
    // the five tick-lists are reordered: Sort's order carries meaning and the
    // single-value lists have no ticks, so both are left alone.
    // `sorted` is true from the sort until the list is seen closed, so a toggle
    // event that arrives late (it is queued, not instant) never reorders a list
    // someone has already started ticking.
    let sorted = false;
    const ticked = () => {
      sorted = true;
      const box = [dom.subjects, dom.countries, dom.languages, dom.degrees, dom.cities].find((list) => d.contains(list));
      if (box) showSelectedFirst(box);
    };
    d.querySelector('summary')?.addEventListener('click', () => { if (!d.open) ticked(); });
    d.addEventListener('change', () => { sorted = true; });
    d.addEventListener('toggle', () => {
      if (!d.open) { sorted = false; return; }
      if (!sorted) ticked();
      closeAll(d);
    });
    // Tabbing past the last option left the panel open over the next control
    // (A06). A null relatedTarget is left alone: Safari does not focus a
    // clicked checkbox, so focus "leaves" to nothing on every tick.
    // In the sheet the lists are inline accordions: only the floating panels
    // in the bar close on Tab out or an outside click.
    d.addEventListener('focusout', (event) => {
      if (d.open && event.relatedTarget && !d.contains(event.relatedTarget) && !dom.sheet.contains(d)) d.open = false;
    });
  }
  document.addEventListener('click', (event) => {
    if (dom.dropdowns.some((d) => d.contains(event.target))) return;
    for (const d of dom.dropdowns) if (!dom.sheet.contains(d)) d.open = false;
  });
  document.addEventListener('keydown', (event) => {
    // In the open sheet Escape belongs to the dialog: it closes the sheet.
    if (event.key !== 'Escape' || dom.sheet.open) return;
    const open = dom.dropdowns.find((d) => d.open);
    if (!open) {
      if (!selectedId || document.querySelector('dialog[open]')) return;
      // The pick may be far off screen and not drawn (the pane keeps it).
      const item = mountRow(selectedId);
      if (wideQuery.matches) { selectedId = null; decorateSelection(); drawPane(); }
      else if (item) closeRow(item);
      item?.querySelector('button.open')?.focus({ preventScroll: true });
      return;
    }
    // Focus goes back to the button only from inside the list. Escape in
    // Search used to pull focus away to a dropdown button (A06).
    const wasInside = open.contains(document.activeElement);
    open.open = false;
    if (wasInside) open.querySelector('summary').focus();
  });
}

function plural(n) {
  return t('programme_count', { count: n });
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
