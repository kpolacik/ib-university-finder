import { t, facetLabel } from './i18n.js';
import { FILTER_KEY, ONBOARDING_KEY, validateFilters, hasSetupAnswers } from './saved-state.js';
import { dataValue } from './render.js';
import { syncSlider, showToast } from './round2.js';

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
  let draft = null, step = 1, trigger = null;
  const progress = el('div', 'ob-bar'), fill = el('i'); progress.append(fill);
  const body = el('div', 'ob-body'), foot = el('div', 'ob-foot');
  dialog.append(progress, body, foot);
  const close = (applied = false) => {
    draft = null; dismiss(applied ? 'completed' : 'dismissed'); dialog.close();
    if (applied) results.focus({ preventScroll: true });
    else if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else document.getElementById('f-search').focus({ preventScroll: true });
  };
  const showFaq = () => {
    const faq = document.getElementById('faq');
    faq.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    faq.querySelector('summary').focus({ preventScroll: true });
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
    if (step === 1) {
      // The FAQ sits at the very bottom of the page, where few people scroll
      // (Leon, 2026-11-05). On step 1 nothing is answered yet, so leaving here
      // is a plain dismissal, as Skip setup: no draft is lost and "Edit my
      // answers" reopens setup later.
      const faq = el('a', 'ob-faq', t('r2_ob_faq')); faq.href = '#faq';
      faq.addEventListener('click', (event) => { event.preventDefault(); close(); showFaq(); });
      section.append(el('p', 'note', t('r2_ob1n')), faq);
    }
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
    const next = button(step === 1 ? 'r2_start' : step === 5 ? 'r2_show_mine' : 'r2_next', 'btn btn-p', () => {
      if (step < 5) { step++; draw(); return; }
      const answers = validateFilters(draft, facets); apply(answers); close(true);
      if (hasSetupAnswers(answers)) showToast(t('r2_answers_applied'), t('r2_edit_short'), () => open(document.querySelector('[data-edit]')));
    });
    foot.replaceChildren(skip, spacer, previous, next); heading.focus({ preventScroll: true });
  };
  const open = (from) => {
    if (dialog.open) return;
    trigger = from; closeSheet(); draft = validateFilters(state, facets); step = 1; dialog.showModal(); draw();
  };
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.addEventListener('click', (event) => { const button = event.target.closest('[data-edit]'); if (button) open(button); });
  if (firstVisit) open(null);
  return { open };
}
