import { t, facetLabel, formatCount } from './i18n.js';
import { FILTER_KEY, ONBOARDING_KEY, validateFilters, hasSetupAnswers } from './saved-state.js';
import { dataValue } from './render.js';
import { syncSlider } from './round2.js';

export function readSaved() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY)); } catch { return null; }
}
export function readDismissed() {
  try { return ['dismissed', 'completed'].includes(localStorage.getItem(ONBOARDING_KEY)); } catch { return false; }
}
export function writeSaved(value) {
  try {
    if (value === null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, JSON.stringify(value));
  } catch { /* Filters still work when storage is unavailable. */ }
}
function dismiss(value) {
  try { localStorage.setItem(ONBOARDING_KEY, value); } catch { /* Dismissal still works for this visit. */ }
}

const el = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
};
const button = (label, className, action) => {
  const node = el('button', className, t(label)); node.type = 'button'; node.addEventListener('click', action); return node;
};

export function setupOnboarding({ state, facets, flags, apply, results, closeSheet, firstVisit }) {
  const dialog = document.getElementById('onboarding');
  // done: Finish has applied the answers and the "you're set" screen is up. From
  // then on every way out (Show, FAQ, Esc) keeps them; Skip is gone.
  let draft = null, step = 1, trigger = null, done = false;
  const progress = el('div', 'ob-bar'), fill = el('i'); progress.append(fill);
  const body = el('div', 'ob-body'), foot = el('div', 'ob-foot');
  dialog.append(progress, body, foot);
  const phone = matchMedia('(max-width: 599.98px)');
  const orderFooter = () => {
    if (!draft || done) return;
    const primary = foot.querySelector('.btn-p'), active = document.activeElement;
    // CSS puts Next above Skip on phones; DOM order must follow it for Tab.
    if (phone.matches) foot.insertBefore(primary, foot.children[0]);
    else foot.append(primary);
    if (active === primary) primary.focus({ preventScroll: true });
  };
  phone.addEventListener('change', orderFooter);
  const close = (applied = false) => {
    if (!done) dismiss(applied ? 'completed' : 'dismissed');
    draft = null; done = false; dialog.close();
    if (applied) results.focus({ preventScroll: true });
    else if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else document.getElementById('f-search').focus({ preventScroll: true });
  };
  const showFaq = () => {
    const faq = document.getElementById('faq'), behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    faq.scrollIntoView({ block: 'start', behavior });
    faq.querySelector('summary').focus({ preventScroll: true });
    // Finish has just applied the answers, and the list fills in for a while
    // after that (0.4 s on a fast laptop, more on a slow phone), pushing the FAQ
    // down while the page scrolls to it. Once the list stops growing, aim once
    // more if it grew. Not every frame: each new smooth scroll starts slow again
    // and never arrives. The reader scrolling first cancels it.
    const list = document.getElementById('results');
    let rows = list.children.length, grew = false, still = 0, frames = 0, frame;
    const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    const stop = () => { cancelAnimationFrame(frame); for (const type of inputs) document.removeEventListener(type, stop, true); };
    const watch = () => {
      if (list.children.length !== rows) { rows = list.children.length; grew = true; still = 0; } else still++;
      if (still >= 6 || ++frames > 300) { stop(); if (grew) faq.scrollIntoView({ block: 'start', behavior }); } else frame = requestAnimationFrame(watch);
    };
    for (const type of inputs) document.addEventListener(type, stop, true);
    frame = requestAnimationFrame(watch);
  };
  const chips = (field, values, country = false) => {
    const box = el('div', 'chips');
    for (const value of values) {
      const chip = el('button', 'chip'); chip.type = 'button'; chip.setAttribute('aria-pressed', String(draft[field].has(value)));
      if (country && flags[value]) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'flag'); svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#${flags[value]}`); svg.append(use); chip.append(svg);
      }
      chip.append(field === 'subjectAreas' ? dataValue('subject_area', value) : field === 'degreeTypes' ? dataValue('degree_type', value) : document.createTextNode(facetLabel(value)));
      chip.addEventListener('click', () => {
        if (draft[field].has(value)) draft[field].delete(value); else draft[field].add(value);
        chip.setAttribute('aria-pressed', String(draft[field].has(value)));
      }); box.append(chip);
    }
    return box;
  };
  const draw = (back = false) => {
    fill.style.transform = `scaleX(${(step - 1) / 4})`; progress.hidden = step === 1;
    const label = el('p', 'ob-n', t('r2_step', { step }));
    const section = el('section', `ob-step on${back ? ' back' : ''}`);
    const heading = el('h2', '', t(`r2_ob${step}h`)); heading.id = 'ob-title'; heading.tabIndex = -1;
    section.append(heading, el('p', '', t(`r2_ob${step}p`)));
    if (step === 1) section.append(el('p', 'note', t('r2_ob1n')));
    if (step === 2) {
      const points = el('div', 'big-pts'), input = el('input');
      input.id = 'ob-points'; input.type = 'number'; input.min = '24'; input.max = '45'; input.step = '1'; input.inputMode = 'numeric'; input.placeholder = '—'; input.value = draft.myIbPoints ?? ''; input.setAttribute('aria-label', t('my_ib_points_2'));
      const error = el('p', 'err'); error.id = 'ob-points-error'; error.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', error.id);
      const read = () => {
        const clean = validateFilters({ myIbPoints: input.value === '' ? null : Number(input.value) });
        const valid = input.value === '' && !input.validity.badInput || clean.myIbPoints !== null;
        input.setAttribute('aria-invalid', String(!valid)); error.textContent = valid ? '' : t('enter_a_whole_number_from_24_to_45');
        draft.myIbPoints = clean.myIbPoints; next.disabled = !valid;
      };
      input.addEventListener('input', read);
      for (const delta of [-1, 1]) {
        const control = button(delta < 0 ? 'r2_less' : 'r2_more', 'btn', () => { input.value = Math.min(45, Math.max(24, (Number(input.value) || 36) + delta)); read(); });
        control.setAttribute('aria-label', control.textContent); control.textContent = delta < 0 ? '−' : '+';
        points.append(control); if (delta < 0) points.append(input);
      }
      const label = el('label', 'switch'); const check = el('input'); check.type = 'checkbox'; check.checked = draft.hlMaths;
      check.addEventListener('change', () => { draft.hlMaths = check.checked; }); label.append(check, document.createTextNode(t('r2_ob2m')));
      section.append(points, error, label, el('p', 'ob-hint', t('r2_ob2i')));
    }
    if (step === 3) section.append(chips('subjectAreas', facets.subjectAreas));
    if (step === 4) {
      section.append(chips('countries', facets.countries, true));
      section.append(el('p', 'ob-language', t('language')), chips('languages', facets.languages));
    }
    if (step === 5) {
      const wrap = el('div', 'rng'), top = el('div', 'rng-top'), label = el('label', '', t('r2_up_to')), input = el('input', 'inp');
      label.htmlFor = 'ob-budget'; input.id = 'ob-budget'; input.type = 'number'; input.min = '0'; input.step = '1'; input.inputMode = 'numeric'; input.placeholder = t('r2_no_limit'); input.value = draft.maxBudget ?? '';
      const slider = el('input'); slider.id = 'ob-range'; slider.type = 'range'; slider.min = '0'; slider.max = '40000'; slider.step = '500'; slider.setAttribute('aria-label', t('max_yearly_cost_2'));
      const error = el('p', 'err'); error.id = 'ob-budget-error'; error.setAttribute('aria-live', 'polite'); input.setAttribute('aria-describedby', error.id);
      const read = () => {
        const clean = validateFilters({ maxBudget: input.value === '' ? null : Number(input.value) });
        const valid = input.value === '' && !input.validity.badInput || clean.maxBudget !== null;
        error.textContent = valid ? '' : t('enter_a_whole_number_of_euros_0_or_more'); input.setAttribute('aria-invalid', String(!valid)); next.disabled = !valid;
        draft.maxBudget = clean.maxBudget; syncSlider(slider, draft.maxBudget);
      };
      input.addEventListener('input', read); slider.addEventListener('input', () => { input.value = slider.value; read(); });
      syncSlider(slider, draft.maxBudget); top.append(label, input); wrap.append(top, slider, error); section.append(wrap);
    }
    body.replaceChildren(label, section); body.scrollTop = 0;
    const skip = el('div', 'skipwrap'); skip.append(button('r2_skip', 'btn btn-q', () => close()), el('small', '', t('r2_skip_sub')));
    const spacer = el('span', 'sp');
    const previous = button('r2_back', 'btn', () => { step--; draw(true); }); previous.hidden = step === 1;
    const next = button(step === 1 ? 'r2_start' : step === 5 ? 'r3_ob_finish' : 'r2_next', 'btn btn-p', () => {
      if (step < 5) { step++; draw(); return; }
      if (done) return;
      const answers = validateFilters(draft, facets); done = true;
      const shown = apply(answers); dismiss('completed'); drawDone(answers, shown);
    });
    foot.replaceChildren(skip, spacer, previous, next); orderFooter(); heading.focus({ preventScroll: true });
  };
  // Setup ends here, not on step 5 (Leon, 2026-11-05): the answers are already
  // filters, so it says so, how many programmes that leaves, and offers the
  // list or the FAQ, which sits at the very bottom where few people scroll.
  // It replaces the toast setup used to end with, and step 1's FAQ link.
  const drawDone = (answers, shown) => {
    fill.style.transform = 'scaleX(1)'; progress.hidden = false;
    const any = hasSetupAnswers(answers);
    const section = el('section', 'ob-step on ob-done');
    const heading = el('h2', '', t(any ? 'r2_answers_applied' : 'r3_ob_done_h_none')); heading.id = 'ob-title'; heading.tabIndex = -1;
    // t() picks the plural from the number; only the number on screen is
    // formatted ("2,915"), as the count line does.
    const count = t(any ? 'r3_ob_done_count' : 'r3_ob_shown_count', { count: shown }).replace(/\d+/g, (value) => formatCount(Number(value)));
    // Without answers the count is whatever the page's own filters (search,
    // city…) leave, so it must not claim those rows match anything.
    section.append(heading, el('p', 'ob-count', count), el('p', '', t(any ? 'r3_ob_done_p' : 'r3_ob_done_p_none')));
    body.replaceChildren(section); body.scrollTop = 0;
    // The primary comes first, so it is first in tab order and on top on phones;
    // from 600 px the row is reversed to put it on the right, as Next was.
    // detail > 1 is the second click of a double-click on Finish, which would
    // otherwise land on this button and close the screen before it is read.
    const show = button('r2_show_mine', 'btn btn-p', (event) => { if (event?.detail > 1) return; close(true); });
    const faq = button('r3_ob_faq', 'btn', () => { close(true); showFaq(); });
    foot.classList.add('ob-done-foot'); foot.replaceChildren(show, faq, el('span', 'sp'));
    heading.focus({ preventScroll: true });
  };
  const open = (from) => {
    if (dialog.open) return;
    trigger = from; closeSheet(); draft = validateFilters(state, facets); step = 1; done = false; foot.classList.remove('ob-done-foot'); dialog.showModal(); draw();
  };
  // Esc on the done screen leaves the answers applied: they already are.
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(done); });
  document.addEventListener('click', (event) => { const button = event.target.closest('[data-edit]'); if (button) open(button); });
  if (firstVisit) open(null);
  return { open };
}
