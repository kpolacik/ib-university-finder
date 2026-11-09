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

let wired = false, keyboardInput = false, returnTo = null;
let panel = null, scrim = null, heading = null, opener = null, body = null;
// While the panel slides, app.js stops mounting rows (onFaqSlide), as for the
// Filters sheet: WebKit's long list layouts stall the slide otherwise.
let onSlide = null, slideTimer, sliding = false;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
      // and Shift+Tab from Close went nowhere (2026-11-09).
      const controls = [...panel.querySelectorAll('button,summary,a[href],[tabindex]')]
        .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length && (node.checkVisibility?.() ?? true));
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
  // A question's own height transition ends on its <details>, not here.
  panel.addEventListener('transitionend', (event) => {
    if (event.target === panel && event.propertyName === 'transform') settle();
  });
  warmLater();
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
  if (!sliding) return;
  clearTimeout(slideTimer);
  sliding = false;
  panel.classList.remove('is-sliding');
  scrim.classList.remove('is-sliding');
  onSlide?.(false);
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
  slide();
  panel.show();
  document.documentElement.classList.add('faq-open');
  scrim.classList.add('is-open');
  opener.setAttribute('aria-expanded', 'true');
  focus(heading);
}

export function closeFaq() {
  if (!panel?.open) return;
  panel.close();
  finish();
}

function finish() {
  if (panel.open || !document.documentElement.classList.contains('faq-open')) return;
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
