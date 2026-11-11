// Drag a phone sheet down to close it (A12, PR 7). One helper for the Filters
// sheet (app.js) and the FAQ panel (faq.js), so the gesture's lifecycle lives
// in one place. Only the handle and the header start a drag, and only on a
// phone: the body scrolls, its controls take taps, and a side panel from
// 600 px never moves. touch-action:none on those two regions only
// (styles.css) stops the browser from turning the finger into a scroll.
// Chrome still read a fast flick there as a scroll gesture that ends in a
// fling, and spent the next tap on stopping that fling: the tap reached the
// page as touch and pointer events but never became a click (seen on Linux
// Chrome 156, 2026-11-11, for about 0.3 s after the release). So the regions
// also cancel touchmove while a drag is on, which leaves no gesture to fling.
//
// While the finger is down the sheet follows it directly (an inline
// transform, its CSS transition off). On release it either closes through the
// owner's normal close, so focus, the scrim, the scroll lock and the paused
// rows behave as for Done, or it glides back with the sheet's own open
// transition. No spring engine: the CSS curve does the settling. Under
// Reduce Motion the finger is still tracked; the CSS makes the settle instant.

// Dismiss once dragged min(120 px, a quarter of the sheet), or on a
// deliberate downward flick of at least 0.5 px/ms that also moved 24 px.
const DRAG_DISTANCE = 120;
const DRAG_FLICK = 0.5;
const DRAG_FLICK_TRAVEL = 24;
// The speed is read over the last 80 ms only, so a finger that held still
// before lifting has no speed left. Fewer than three samples, or fewer than
// two estimates spanning 20 ms each, is not enough to call a flick.
const DRAG_WINDOW = 80;
const DRAG_MIN_SPAN = 20;
const DRAG_INTERACTIVE = 'button,a[href],input,select,textarea,summary,label';

// samples: [{ t, y }] oldest first, the last one taken at release. Speed is
// measured end to end over the window, and again without its newest and
// without its oldest sample; the slowest of those counts, so one noisy sample
// can only weaken a flick, never invent one. Browsers deliver pointermove
// once a frame, so a quick flick may have only a few samples.
export function dragVelocity(samples) {
  const last = samples.at(-1);
  if (!last) return 0;
  const recent = samples.filter((s) => last.t - s.t <= DRAG_WINDOW);
  if (recent.length < 3) return 0;
  const speed = (a, b) => (b.t - a.t >= DRAG_MIN_SPAN ? (b.y - a.y) / (b.t - a.t) : null);
  const options = [speed(recent[0], last), speed(recent[0], recent.at(-2)), speed(recent[1], last)].filter((v) => v !== null);
  if (options.length < 2) return 0;
  return Math.min(...options);
}

// A finger moving back up (as fast as a flick) always settles back.
export function shouldDismiss(offset, height, velocity) {
  if (velocity <= -DRAG_FLICK) return false;
  const distance = Math.min(DRAG_DISTANCE, height > 0 ? height * 0.25 : DRAG_DISTANCE);
  return offset >= distance || (velocity >= DRAG_FLICK && offset >= DRAG_FLICK_TRAVEL);
}

// The sheet's current translateY, so a grab during the opening slide starts
// where the sheet is, not where it is heading.
function currentOffset(sheet) {
  const transform = globalThis.getComputedStyle?.(sheet).transform;
  if (!transform || transform === 'none' || typeof DOMMatrixReadOnly !== 'function') return 0;
  return Math.max(0, new DOMMatrixReadOnly(transform).m42);
}

// sheet: the dialog. regions: selector for where a drag may start.
// enabled(): open and on a phone. hold()/release(): the owner pauses row
// mounting while a finger holds the sheet (no timer: a long hold is fine) and
// hands over to its own bounded pause on release. close(): the normal close.
// Returns reset(), which the owner calls on any other close, on reopen and on
// a breakpoint change: the sheet lets go of the finger and stays put for the
// owner's own transition, and a late pointer event finds nothing to do.
export function wireSheetDrag(sheet, { regions, enabled, hold, release, close }) {
  let drag = null;

  // Each frame's pointermove may stand for several finger positions; the
  // coalesced ones, where the browser has them, make the speed steadier.
  const track = (event) => {
    drag.offset = Math.max(0, drag.base + event.clientY - drag.y);
    const points = event.getCoalescedEvents?.() ?? [];
    for (const point of points.length ? points : [event]) drag.samples.push({ t: point.timeStamp, y: point.clientY });
    while (drag.samples.length > 24) drag.samples.shift();
    sheet.style.transform = `translateY(${drag.offset}px)`;
  };

  // Restore the CSS transition and drop the inline transform first, then
  // close in the same task: the closing transition starts from where the
  // finger left the sheet, as the style before the change is the dragged one.
  const end = (dismiss) => {
    const gesture = drag;
    drag = null;
    try { if (sheet.hasPointerCapture?.(gesture.id)) sheet.releasePointerCapture(gesture.id); } catch { /* already released */ }
    sheet.style.removeProperty('transition');
    sheet.style.removeProperty('transform');
    release();
    if (dismiss) close();
  };

  sheet.addEventListener('pointerdown', (event) => {
    if (drag || !event.isPrimary || event.button > 0 || !enabled()) return;
    const region = event.target?.closest?.(regions);
    if (!region || !sheet.contains(region) || event.target.closest(DRAG_INTERACTIVE)) return;
    drag = { id: event.pointerId, y: event.clientY, base: currentOffset(sheet), offset: 0, samples: [],
      height: sheet.getBoundingClientRect().height };
    try { sheet.setPointerCapture?.(event.pointerId); } catch { /* the pointer is already gone */ }
    sheet.style.transition = 'none';
    hold();
    track(event);
  });
  sheet.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.id) track(event);
  });
  sheet.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    track(event);
    end(shouldDismiss(drag.offset - drag.base, drag.height, dragVelocity(drag.samples)));
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    sheet.addEventListener(type, (event) => { if (drag && event.pointerId === drag.id) end(false); });
  }
  // No scroll gesture, so no fling to eat the next tap (see the top of this
  // file). Only on the drag regions, so the body's own scrolling never waits
  // for a listener, and only while a drag is on, so their buttons keep taps.
  for (const region of sheet.querySelectorAll?.(regions) ?? []) {
    region.addEventListener('touchmove', (event) => { if (drag && event.cancelable) event.preventDefault(); }, { passive: false });
  }
  // A rotation or a breakpoint change mid-drag: let go and settle back.
  globalThis.addEventListener?.('resize', () => { if (drag) end(false); });

  return { reset() { if (drag) end(false); }, get active() { return drag !== null; } };
}
