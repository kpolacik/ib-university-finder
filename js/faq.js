// The FAQ one tap away (Leon, 2026-11-09). It used to live only in the
// footer, below ~2,900 rows, so "someone looking for faq has to scroll
// through all rows". The header's "?" opens it in a panel: a sheet from the
// bottom on phones, a side panel from the right from 600 px. Since the same
// day the panel is its only home: the questions are in its markup in
// index.html, and the footer has just a "FAQ" button that opens it. Their
// data-i18n spans are translated with the rest of the page.
//
// Like the Filters sheet and Setup, the panel opens with show(), never
// showModal(), and nothing else on the page is made inert: WebKit restyles
// all ~116,000 result elements for that (~500-650 ms, STATUS.md). aria-modal,
// its own scrim, a focus trap and Escape do the modal's work instead.

import { wireSheetDrag } from './sheet-drag.js';

let wired = false, keyboardInput = false, returnTo = null;
let panel = null, scrim = null, heading = null, opener = null, body = null;
// While the panel slides, app.js stops mounting rows (onFaqSlide), as for the
// Filters sheet: WebKit's long list layouts stall the slide otherwise. held:
// a finger is dragging the sheet (A12); rows wait, with no timer, until it lets go.
let onSlide = null, slideTimer, sliding = false, held = false, drag = null;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const phone = () => globalThis.matchMedia?.('(max-width: 599.98px)').matches ?? false;

// The answers (A10, PR 7). The CSS height:auto transition ran only in Chrome
// and could not reverse, so Safari snapped. Now script owns them: exactly one
// answer is open in logic (current), opening one shuts the other in the same
// tap, and each grows or shuts with a Web Animation of its measured height,
// which Safari 16.4 has. A tap mid-way reverses from the height on screen.
// A shutting answer keeps its <details> open only so it can be seen to shut:
// its question already says collapsed, and its content is inert and
// aria-hidden at once, so no link in it is a Tab stop or read out.
// 260 ms and the curve are --t-answer and --ease-out in styles.css.
const ANSWER_MS = 260;
const ANSWER_EASE = 'cubic-bezier(.22,1,.36,1)';
let questions = [], current = null, viewFrame = 0;
const motion = new Map();

// Whether the last input was a key: a tap must not leave a focus ring on the
// heading or on "?" afterwards (iOS, Leon 2026-11-08, as in app.js).
const focus = (node) => {
  // show()/close() may already have focused it with the browser's own guess.
  if (document.activeElement === node) node.blur();
  node.focus({ preventScroll: true, focusVisible: keyboardInput });
};
const visible = (node) => !!node?.isConnected && node.getClientRects().length > 0;

export function wireFaq() {
  if (wired) return;
  panel = document.getElementById('faq-panel');
  if (!panel) return;
  wired = true;
  scrim = document.getElementById('faq-scrim');
  heading = document.getElementById('faq-h');
  opener = document.getElementById('faq-open');
  body = panel.querySelector('.faqp-b');

  document.addEventListener('keydown', () => { keyboardInput = true; }, true);
  document.addEventListener('pointerdown', () => { keyboardInput = false; }, true);
  // Pause rows at finger-down, before the browser synthesises the click.
  opener.addEventListener('pointerdown', () => { if (!panel.open) slide(); });
  opener.addEventListener('click', () => openFaq());
  // The footer's "FAQ" gets focus back itself when the panel closes.
  const footer = document.getElementById('faq-foot');
  footer?.addEventListener('click', () => openFaq(footer));
  panel.querySelector('.faqp-x').addEventListener('click', () => closeFaq());
  scrim.addEventListener('click', () => closeFaq());
  // From 600 px the page keeps its scrollbar (hiding a classic one would
  // re-lay out every row), so a wheel over the scrim, or over a panel with
  // nothing to scroll, must not move the list behind it.
  for (const node of [scrim, panel]) {
    node.addEventListener('wheel', (event) => {
      if (!body.contains(event.target) || body.scrollHeight <= body.clientHeight) event.preventDefault();
    }, { passive: false });
  }
  // Bubble phase, after Setup's and the sheet's own handlers, which only act
  // while their dialog is open.
  document.addEventListener('keydown', (event) => {
    if (!panel.open || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeFaq();
    } else if (event.key === 'Tab') {
      // A link in a closed answer still has client rects in Chrome (the
      // closed content is content-visibility:hidden, not display:none), so
      // without checkVisibility the hidden mailto link became the last stop
      // and Shift+Tab from Close went nowhere (2026-11-09). Safari before
      // 17.4 has no checkVisibility; a shutting answer is inert (A10).
      const controls = [...panel.querySelectorAll('button,summary,a[href],[tabindex]')]
        .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length && (node.checkVisibility?.() ?? true) && !node.closest('[inert]') && (!node.closest('.a') || node.closest('details').open));
      const first = controls[0] ?? heading, last = controls.at(-1) ?? heading;
      const active = document.activeElement;
      if (!controls.includes(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ focusVisible: true });
      }
    }
  });
  document.addEventListener('focusin', (event) => {
    if (panel.open && !panel.contains(event.target)) focus(heading);
  });
  // close is queued: after a quick reopen it must change nothing.
  panel.addEventListener('close', finish);
  // A question's "+" stroke transition ends on that stroke, not here.
  panel.addEventListener('transitionend', (event) => {
    if (event.target === panel && event.propertyName === 'transform') settle();
  });
  questions = [...panel.querySelectorAll('.faqp-b details')];
  current = questions.find((d) => d.open) ?? null;
  for (const details of questions) {
    const summary = details.querySelector('summary');
    summary.setAttribute('aria-expanded', String(details === current));
    // Enter and Space on a summary arrive here as a click too.
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      setAnswer(details, current !== details);
    });
    details.addEventListener('toggle', () => adopt(details));
  }
  // A resize or a new language changes every answer's height: stop any that
  // is moving and show the logical state at its natural size.
  globalThis.addEventListener?.('resize', () => { if (motion.size) reconcile(); });
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (motion.size) reconcile(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  drag = wireSheetDrag(panel, { regions: '.grab,.faqp-h', enabled: () => panel.open && phone(), hold, release, close: () => closeFaq() });
  warmLater();
}

// Only the answers' own subtree is ever made inert, never the page behind
// (that stalls WebKit, see the top of this file).
function expose(answer, shown) {
  if (shown) { answer.removeAttribute('inert'); answer.removeAttribute('aria-hidden'); }
  else { answer.setAttribute('inert', ''); answer.setAttribute('aria-hidden', 'true'); }
}

function setAnswer(details, open) {
  const previous = current;
  if (open) {
    current = details;
    if (previous && previous !== details) moveAnswer(previous, false);
    moveAnswer(details, true);
  } else if (previous === details) {
    current = null;
    moveAnswer(details, false);
  }
  keepInView(details.querySelector('summary'));
}

function moveAnswer(details, open) {
  const summary = details.querySelector('summary'), answer = details.querySelector('.a');
  summary.setAttribute('aria-expanded', String(open));
  if (!open && answer.contains(document.activeElement)) focus(summary);
  // The height on screen now, mid-animation included, before letting go of it.
  const from = details.open ? details.getBoundingClientRect().height : null;
  stopAnswer(details);
  if (typeof details.animate !== 'function' || reducedMotion()) {
    details.open = open;
    expose(answer, true);
    return;
  }
  expose(answer, open);
  details.open = true;
  const full = details.getBoundingClientRect().height;
  const shut = full - answer.getBoundingClientRect().height;
  const start = from ?? shut, end = open ? full : shut;
  if (Math.abs(start - end) < 1) { finishAnswer(details); return; }
  details.style.overflow = 'hidden';
  const animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration: ANSWER_MS, easing: ANSWER_EASE, fill: 'forwards' });
  motion.set(details, animation);
  // Only the latest animation of this answer may finish it.
  animation.onfinish = () => { if (motion.get(details) === animation) finishAnswer(details); };
}

function stopAnswer(details) {
  const animation = motion.get(details);
  if (!animation) return;
  motion.delete(details);
  animation.cancel();
  details.style.removeProperty('overflow');
}

// The logical state at its natural size: shut answers close for real.
function finishAnswer(details) {
  stopAnswer(details);
  details.open = details === current;
  details.querySelector('summary').setAttribute('aria-expanded', String(details === current));
  expose(details.querySelector('.a'), true);
}

function reconcile() {
  for (const details of questions) finishAnswer(details);
}

// The browser opened or shut a <details> itself (find in page, or a script):
// make that the logical state. Our own changes already match it.
function adopt(details) {
  if (details.open && current !== details && !motion.has(details)) setAnswer(details, true);
  else if (!details.open && (current === details || motion.has(details))) {
    if (current === details) current = null;
    finishAnswer(details);
  }
}

// Keep the tapped question inside the panel's scrolling body while answers
// above it shut: scroll the body only as far as it overflows, never the page.
function keepInView(summary) {
  if (viewFrame) cancelAnimationFrame(viewFrame);
  const fix = () => {
    if (!panel.open) return;
    const box = body.getBoundingClientRect(), r = summary.getBoundingClientRect();
    if (r.top < box.top) body.scrollTop -= box.top - r.top;
    else if (r.bottom > box.bottom) body.scrollTop += Math.min(r.bottom - box.bottom, r.top - box.top);
  };
  fix();
  const step = () => { fix(); viewFrame = motion.size ? requestAnimationFrame(step) : 0; };
  if (motion.size) viewFrame = requestAnimationFrame(step);
}

// app.js passes (true) when a slide starts and (false) when it has ended.
export function onFaqSlide(fn) { onSlide = fn; }

function slide() {
  if (reducedMotion()) return;
  clearTimeout(slideTimer);
  panel.classList.add('is-sliding');
  scrim.classList.add('is-sliding');
  if (!sliding) { sliding = true; onSlide?.(true); }
  // The 280 ms slide plus its first frame's work; covers a missing transitionend.
  slideTimer = setTimeout(settle, 500);
}

function settle() {
  if (!sliding || held) return;
  clearTimeout(slideTimer);
  sliding = false;
  panel.classList.remove('is-sliding');
  scrim.classList.remove('is-sliding');
  onSlide?.(false);
}

// A finger on the sheet (A12): rows wait with no time limit. On release the
// usual bounded pause takes over, so a missing transitionend still ends it.
function hold() {
  clearTimeout(slideTimer);
  held = true;
  panel.classList.add('is-sliding');
  scrim.classList.add('is-sliding');
  if (!sliding) { sliding = true; onSlide?.(true); }
}

function release() {
  held = false;
  if (reducedMotion()) settle(); else slide();
}

// The first open used to lay the panel out cold, during its slide. Like the
// Filters sheet, it is laid out once the page has painted, hidden and
// untouchable (.is-warm in styles.css), so the first slide is as smooth as the
// rest. Nothing in it can take focus until it is open.
function warmLater() {
  const warm = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!panel.open) panel.classList.add('is-warm');
  }));
  if (document.readyState === 'complete') warm();
  else globalThis.addEventListener?.('load', warm, { once: true });
}

// back: where focus goes on close; "?" unless the caller names a visible
// element (Setup's done screen hands over the results list, the footer's
// "FAQ" itself).
export function openFaq(back = null) {
  wireFaq();
  if (!panel || panel.open) return;
  returnTo = back;
  drag.reset();
  reconcile();
  slide();
  panel.show();
  document.documentElement.classList.add('faq-open');
  scrim.classList.add('is-open');
  opener.setAttribute('aria-expanded', 'true');
  focus(heading);
}

export function closeFaq() {
  if (!panel?.open) return;
  drag.reset();
  panel.close();
  finish();
}

function finish() {
  if (panel.open || !document.documentElement.classList.contains('faq-open')) return;
  drag.reset();
  reconcile();
  slide();
  document.documentElement.classList.remove('faq-open');
  scrim.classList.remove('is-open');
  opener.setAttribute('aria-expanded', 'false');
  const back = visible(returnTo) ? returnTo : opener;
  returnTo = null;
  // iOS does not focus a tapped button, so the browser's own return can miss.
  focus(back);
}

// Module scripts run after the page is parsed. Node (tools/check.mjs) has no
// document and wires a stand-in page itself.
if (typeof document !== 'undefined') wireFaq();
