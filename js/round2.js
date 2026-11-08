import { t, getLanguage } from './i18n.js';

// The existing fields remain authoritative: steppers, segments and sliders
// dispatch their normal events, so validation and debouncing have one owner.
let controls;
let segments = [];
let radios = [];
let searchPlaceholder = () => {};
// The Search hint, "Programme, university or city", only where it fits whole;
// otherwise "Search". From 600 to about 950 px, and at 1024 px in Slovak, the
// long one was cut off mid-letter (alignment audit, 2026-11-05). Measured in
// the field's own font, so it holds in both languages, on touch (16 px) and
// when zoomed. If measurement is unavailable, keep the short hint.
let measurer;
function longHintFits(input) {
  try {
    measurer ??= document.createElement('canvas').getContext('2d');
    const style = getComputedStyle(input);
    measurer.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // offsetWidth, not clientWidth: Chrome's clientWidth of a search field
    // already leaves out its padding.
    const { borderLeftWidth, borderRightWidth, paddingLeft, paddingRight } = style;
    const room = input.offsetWidth - [borderLeftWidth, borderRightWidth, paddingLeft, paddingRight].reduce((sum, side) => sum + parseFloat(side), 0);
    return measurer.measureText(t('r2_searchph')).width <= room;
  } catch { return false; }
}
export function wireRound2(dom) {
  controls = { maths: [...document.querySelectorAll('[data-maths]')], sliders: [...document.querySelectorAll('[data-number]')] };
  segments = [...document.querySelectorAll('.hd .lang,#maths-seg')].map((group) => {
    const thumb = document.createElement('span'); thumb.className = 'segment-thumb'; thumb.setAttribute('aria-hidden', 'true'); group.prepend(thumb);
    return { group, thumb, key: null };
  });
  window.addEventListener('resize', () => { for (const segment of segments) segment.key = null; syncSegments(); });
  syncSegments();
  searchPlaceholder = () => {
    const key = innerWidth >= 600 && longHintFits(dom.search) ? 'r2_searchph' : 'search_2';
    if (dom.search.dataset.i18nAttr !== `placeholder:${key}`) dom.search.dataset.i18nAttr = `placeholder:${key}`;
    if (dom.search.placeholder !== t(key)) dom.search.placeholder = t(key);
  };
  searchPlaceholder(); window.addEventListener('resize', searchPlaceholder);
  // The field's width also changes without a window resize: the header buttons
  // grow with a language switch or a count, and the font arrives late.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => searchPlaceholder()).observe(dom.search);
  document.fonts?.ready?.then(() => searchPlaceholder());
  document.getElementById('header-list').addEventListener('click', () => dom.shortlistOnly.click());
  for (const button of document.querySelectorAll('[data-points-step]')) button.addEventListener('click', () => {
    dom.points.value = String(Math.min(45, Math.max(24, (Number(dom.points.value) || 36) + Number(button.dataset.pointsStep))));
    dom.points.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const button of controls.maths) button.addEventListener('click', () => {
    dom.myMaths.value = button.dataset.maths;
    dom.myMaths.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (const slider of controls.sliders) {
    const input = document.getElementById(slider.dataset.number);
    slider.addEventListener('input', () => {
      input.value = slider.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('input', () => syncSlider(slider, input.value));
  }
  document.querySelector('.budget-panel').append(document.getElementById('f-budget-help'));
  // Deadline and Entrance exam show radios (design §4). The select stays the one
  // source of truth: a radio sets it and fires its normal change event, and
  // syncRound2 paints the radios back from it after every update.
  radios = [dom.deadline, dom.exam].map((select) => {
    const box = document.createElement('div'); box.className = 'options'; box.setAttribute('role', 'radiogroup');
    for (const name of ['aria-label', 'aria-describedby', 'data-i18n-attr']) box.setAttribute(name, select.getAttribute(name));
    const inputs = [...select.options].map((option) => {
      const label = document.createElement('label'); label.className = 'option';
      const input = document.createElement('input'); input.type = 'radio'; input.name = `${select.id}-radio`; input.value = option.value;
      input.addEventListener('change', () => { select.value = input.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
      const text = document.createElement('span'); text.dataset.i18n = option.dataset.i18n; text.textContent = t(option.dataset.i18n);
      label.append(input, text); box.append(label);
      // Beside the label, not in it, so the radio's name stays "Not passed yet". It
      // says "recorded dates" because a rolling programme with a date drops out once
      // that date passes; the note must not claim rolling admission stays visible.
      if (input.value === 'open') {
        const note = document.createElement('small'); note.className = 'opt-note'; note.id = 'f-deadline-open-note';
        note.dataset.i18n = 'r2_deadline_open_note'; note.textContent = t(note.dataset.i18n);
        input.setAttribute('aria-describedby', note.id); box.append(note);
      }
      return input;
    });
    select.hidden = true; select.before(box);
    return { select, inputs, box };
  });
  for (const d of dom.dropdowns) {
    const summary = d.querySelector('summary'), panel = d.querySelector('.dropdown-panel');
    summary.setAttribute('role', 'button');
    summary.setAttribute('aria-controls', panel.id = `${d.id}-panel`);
    summary.setAttribute('aria-expanded', 'false');
    const footer = document.createElement('div'); footer.className = 'pop-f';
    const hint = document.createElement('span'); hint.dataset.i18n = d.id === 'dd-budget' ? 'r2_unknown_costs' : 'unknown_values_never_hide_a_programme'; hint.textContent = t(hint.dataset.i18n);
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-q'; clear.dataset.i18n = 'r2_reset'; clear.textContent = t(clear.dataset.i18n);
    clear.addEventListener('click', () => {
      for (const input of panel.querySelectorAll('input:not([type=range],[type=radio]),select')) {
        if (input.type === 'checkbox') { if (!input.checked) continue; input.checked = false; }
        else input.value = input === dom.deadline ? 'any' : '';
        input.dispatchEvent(new Event(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
      }
    });
    // Sort always has a value, so it gets no Clear and no unknown-values note.
    if (d.id !== 'dd-sort') { footer.append(hint, clear); panel.append(footer); }
    const position = () => {
      if (!d.open || dom.sheet.contains(d)) return;
      const box = summary.getBoundingClientRect();
      panel.classList.toggle('right', box.left + panel.offsetWidth > document.documentElement.clientWidth - 12);
      panel.style.maxHeight = `${Math.max(120, innerHeight - box.bottom - 18)}px`;
    };
    new ResizeObserver(position).observe(summary);
    window.addEventListener('resize', position);
    holdDropdownClose(d, () => dom.sheet.contains(d));
    d.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(d.open));
      position();
      if (d.open && !dom.sheet.contains(d) && matchMedia('(pointer:fine)').matches) panel.querySelector('input[type=search]')?.focus({ preventScroll: true });
    });
  }
  for (const box of [dom.subjects, dom.countries, dom.languages, dom.degrees, dom.cities, ...radios.map((group) => group.box)]) {
    const cue = () => box.classList.toggle('at-end', box.scrollTop + box.clientHeight >= box.scrollHeight - 4);
    box.addEventListener('scroll', cue);
    new ResizeObserver(cue).observe(box);
  }
  let help = null;
  const closeHelp = (focus = true) => {
    if (!help) return false;
    const button = help; help = null;
    button.setAttribute('aria-expanded', 'false');
    document.getElementById(button.getAttribute('aria-controls')).classList.remove('is-open');
    if (focus) button.focus();
    return true;
  };
  for (const button of document.querySelectorAll('.info')) {
    const tip = document.getElementById(button.getAttribute('aria-controls')); tip.classList.add('tip');
    button.closest('.fld').after(tip);
    button.addEventListener('click', () => {
      const was = help === button; closeHelp(false); if (was) return;
      help = button; button.setAttribute('aria-expanded', 'true'); tip.classList.add('is-open');
      // A wrapped bubble stays max-width wide, leaving a gap beside its
      // longest line (the two-line HL Maths help, verification of PR 1), so
      // it is narrowed to that line. CSS cannot shrink-wrap wrapped text.
      tip.style.width = '';
      const lines = document.createRange(); lines.selectNodeContents(tip);
      const pad = parseFloat(getComputedStyle(tip).paddingLeft) + parseFloat(getComputedStyle(tip).paddingRight);
      const text = lines.getBoundingClientRect().width;
      if (text > 0 && text + pad < tip.getBoundingClientRect().width - 1) tip.style.width = `${Math.ceil(text + pad) + 1}px`;
      if (!dom.sheet.open) {
        const box = button.getBoundingClientRect(), parent = tip.offsetParent.getBoundingClientRect();
        tip.style.left = `${Math.min(box.left, innerWidth - 280) - parent.left}px`;
        tip.style.top = `${box.bottom + 8 - parent.top}px`;
      }
    });
  }
  document.addEventListener('click', (event) => {
    if (help && !event.target.closest('.info,.tip')) closeHelp(false);
  });
  // Capture Escape before the row and dialog handlers. Native cancel must not
  // also close the sheet when Escape just dismissed an inner surface.
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.target.closest('input,textarea,select,[contenteditable=true]') && !document.querySelector('dialog[open]')) {
      event.preventDefault(); dom.search.focus();
    }
    if (event.key !== 'Escape' || document.getElementById('onboarding')?.open) return;
    // A list fading shut keeps [open] for 150 ms; it must not swallow the
    // next Escape (holdDropdownClose).
    const panel = document.querySelector('.dropdown[open]:not(.closing),.ml-pop[open]');
    if (panel) {
      event.preventDefault(); event.stopImmediatePropagation(); panel.open = false; panel.querySelector('summary').focus();
    } else if (help) { event.preventDefault(); event.stopImmediatePropagation(); closeHelp(); }
  }, true);
}

// iPhone (Leon, 2026-11-08): a pick-list in the bar, Sort above the list too,
// faded in but snapped shut. A closed <details> hides its content at once.
// Chrome held it for a ::details-content content-visibility transition, but
// Safari does not transition content-visibility (Playwright's WebKit 26 hides
// it at once), so the fade never showed there. Closing now keeps [open] for
// the fade under .closing, while d.open already reads false: every caller
// (Escape, an outside click, Tab out, one-at-a-time, Sort's pick) sees a
// closed list at once, and the toggle event fires when the fade ends. Not in
// the phone sheet, where the lists are inline rows, nor under reduced motion.
export const DROPDOWN_CLOSE_MS = 150;
export function holdDropdownClose(d, inSheet) {
  if (typeof HTMLDetailsElement !== 'function' || !(d instanceof HTMLDetailsElement)) return;
  const native = Object.getOwnPropertyDescriptor(HTMLDetailsElement.prototype, 'open');
  let timer = 0;
  const stop = () => { clearTimeout(timer); timer = 0; d.classList.remove('closing'); };
  Object.defineProperty(d, 'open', {
    configurable: true,
    get() { return !timer && native.get.call(d); },
    set(value) {
      value = Boolean(value);
      if (timer) {
        if (!value) return;
        // Reopened mid-fade: [open] never went, so no toggle event would run
        // the open handlers (one at a time, aria-expanded).
        stop(); d.dispatchEvent(new Event('toggle')); return;
      }
      if (value || !native.get.call(d) || inSheet() || matchMedia('(prefers-reduced-motion: reduce)').matches) { native.set.call(d, value); return; }
      d.classList.add('closing');
      d.querySelector('summary').setAttribute('aria-expanded', 'false');
      timer = setTimeout(() => { stop(); native.set.call(d, false); }, DROPDOWN_CLOSE_MS);
    },
  });
  // A tap or Enter on the button of an open list would close it natively, at once.
  d.querySelector('summary').addEventListener('click', (event) => {
    if (!native.get.call(d)) return;
    event.preventDefault();
    d.open = !d.open;
  });
}

export function syncSlider(slider, value) {
  const set = value !== '' && value !== null;
  slider.value = set ? String(value) : slider.dataset.number === 'f-living' ? slider.min : slider.max;
  const fraction = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
  slider.style.setProperty('--p', `${100 * fraction}%`);
  slider.classList.toggle('set', set);
  // Without this a screen reader read the bare thumb position: "20000" for
  // a fee with no limit, "0" for living costs nobody set. A typed amount
  // past the slider's end is read as typed, not as the end.
  const living = slider.dataset.number === 'f-living';
  const amount = set ? new Intl.NumberFormat(getLanguage() === 'sk' ? 'sk-SK' : 'en-IE').format(Number(value)) : '';
  slider.setAttribute('aria-valuetext', set ? t(living ? 'r4_slider_month' : 'r4_slider_year', { amount })
    : t(living ? 'r4_slider_unset' : 'r2_no_limit'));
}

export function syncRound2(dom, state, active, saved) {
  document.getElementById('header-list-count').textContent = saved;
  document.getElementById('header-list').setAttribute('aria-pressed', String(state.shortlistOnly));
  document.getElementById('compact-count').textContent = active;
  document.getElementById('compact-count').hidden = active === 0;
  dom.clear.hidden = active === 0;
  for (const button of controls.maths) button.setAttribute('aria-pressed', String(button.dataset.maths === (state.myMaths || '')));
  for (const slider of controls.sliders) syncSlider(slider, document.getElementById(slider.dataset.number).value);
  const amounts = [state.maxTuition, state.maxBudget, state.myLiving].filter((v) => v !== null);
  document.getElementById('budget-value').textContent = amounts.length > 1 ? `· ${amounts.length}` : amounts.length ? t(state.myLiving !== null ? 'r2_budget_living' : 'r2_budget_ceiling', { amount: new Intl.NumberFormat(getLanguage() === 'sk' ? 'sk-SK' : 'en-IE').format(amounts[0]) }) : '';
  document.getElementById('dd-budget').classList.toggle('is-set', amounts.length > 0);
  syncSegments();
  searchPlaceholder();
  for (const { select, inputs } of radios) for (const input of inputs) input.checked = input.value === select.value;
  for (const [id, on] of [['deadline', state.deadlineWindow !== 'any'], ['exam', state.exam !== null]]) {
    const facet = document.getElementById(`dd-${id}`); facet.classList.toggle('is-set', on); facet.querySelector('.scalar-count').textContent = on ? '· 1' : '';
  }
}

// Batch 3 · A. Each toast keeps its own timer (6 s), paused while it is
// hovered or holds focus. A new toast replaces the old ones, except one that
// holds focus (its Undo, say): that stays, and the new one goes beside it, at
// most two. A toast whose action has been used goes at once.
const TOAST_MS = 6000;
const toastState = new WeakMap();
function holdsFocus(toast) {
  return toast.contains(document.activeElement);
}
function timeToast(toast) {
  const state = toastState.get(toast);
  clearTimeout(state.timer);
  if (state.hover || holdsFocus(toast)) return;
  state.timer = setTimeout(() => retireToast(toast), TOAST_MS);
}
// Leaves with its 160 ms exit, unless focus arrives first (then it stays).
function retireToast(toast, { used = false } = {}) {
  const state = toastState.get(toast);
  clearTimeout(state.timer);
  if (!used && (state.hover || holdsFocus(toast))) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { toast.remove(); return; }
  toast.classList.add('out');
  state.exit = setTimeout(() => toast.remove(), 160);
}
export function showToast(message, actionLabel, action) {
  const region = document.getElementById('toasts');
  const toast = document.createElement('div'); toast.className = 'toast';
  const state = { timer: undefined, exit: undefined, hover: false };
  toastState.set(toast, state);
  const text = document.createElement('span'); text.textContent = message; toast.append(text);
  if (action) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = actionLabel;
    button.addEventListener('click', () => { action(); retireToast(toast, { used: true }); }); toast.append(button);
  }
  toast.addEventListener('mouseenter', () => {
    state.hover = true; clearTimeout(state.timer); clearTimeout(state.exit);
    toast.classList.remove('out');
  });
  toast.addEventListener('mouseleave', () => { state.hover = false; timeToast(toast); });
  toast.addEventListener('focusin', () => {
    clearTimeout(state.timer); clearTimeout(state.exit);
    toast.classList.remove('out');
  });
  toast.addEventListener('focusout', (event) => { if (!toast.contains(event.relatedTarget)) timeToast(toast); });
  const kept = [...region.children].filter(holdsFocus).slice(-1);
  for (const old of [...region.children]) {
    if (kept.includes(old)) continue;
    clearTimeout(toastState.get(old)?.timer); clearTimeout(toastState.get(old)?.exit);
    old.remove();
  }
  region.append(toast);
  timeToast(toast);
  // For a caller whose toast goes stale before its timer, such as "Open
  // compare" once Compare is open.
  return () => retireToast(toast, { used: true });
}

export function wireCompactHeader(dom, { goHome } = {}) {
  const header = document.querySelector('.hd'), compactButton = document.getElementById('compact-filters'), mark = header.querySelector('.mark');
  let pastFilters = false;
  // A focused header control must not move or vanish, so the header waits for
  // it to lose focus. The logo is the exception: its tile shows in both states
  // (batch 3), and after going home it holds focus at the top of the page.
  const sync = () => {
    const allowed = innerWidth >= 600 && innerHeight > 500;
    if (header.contains(document.activeElement) && document.activeElement !== mark) return;
    document.body.classList.toggle('compact', allowed && pastFilters);
    compactButton.tabIndex = allowed && pastFilters ? 0 : -1;
  };
  const offsets = () => {
    const headings = document.querySelector('.cols');
    const visible = (node) => getComputedStyle(node).display !== 'none' ? node.getBoundingClientRect().height : 0;
    document.body.style.setProperty('--columns-height', `${visible(headings)}px`);
    document.body.style.setProperty('--count-height', `${visible(dom.status)}px`);
    sync();
  };
  new ResizeObserver(offsets).observe(dom.status);
  new ResizeObserver(offsets).observe(document.querySelector('.cols'));
  new IntersectionObserver((entries) => {
    if (entries[0].boundingClientRect.bottom < 0) pastFilters = true;
    sync();
  }).observe(document.querySelector('.fslot'));
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) pastFilters = false;
    sync();
  }).observe(document.getElementById('top-marker'));
  window.addEventListener('resize', offsets);
  header.addEventListener('focusout', () => requestAnimationFrame(sync));
  compactButton.addEventListener('click', () => {
    document.getElementById('top-marker').scrollIntoView({ block: 'start' });
    dom.points.focus({ preventScroll: true });
  });
  // The logo, and the phone tile in the stuck count row, go home (Leon,
  // 2026-11-05): the main list at the top, filters kept. Not by following
  // #top-marker: keepAddress keeps the hash, so it would leak into every link
  // copied afterwards. Focus moves to the logo at once, before the scroll: the
  // phone tile hides when the row unsticks on the way up, and focus on a hidden
  // node is lost. With nothing left to do after the scroll, an interrupted
  // scroll leaves nothing stale. A modified click keeps the browser's own
  // behaviour.
  const home = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goHome?.();
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    mark.tabIndex = 0;
    mark.focus({ preventScroll: true });
  };
  for (const link of [mark, ...document.querySelectorAll('[data-home]')]) link.addEventListener('click', home);
  document.addEventListener('click', (event) => { if (event.target.closest('[data-open-list]')) dom.shortlistOnly.click(); });
  offsets();
}

function syncSegments() {
  for (const segment of segments) {
    const selected = segment.group.querySelector('button[aria-pressed=true]');
    if (!selected || segment.key === selected || !segment.group.offsetWidth) continue;
    segment.key = selected;
    segment.thumb.style.width = `${selected.offsetWidth}px`;
    segment.thumb.style.transform = `translateX(${selected.offsetLeft}px)`;
  }
}
