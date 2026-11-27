// Which reviewed subject rules are current on this page right now (F01).
//
// The only authority is a fresh answer from data/ib-subject-rules.csv on this
// site. The catalogue may come from the CSVs, the Google Sheet or the saved
// copy; the rules never come from the saved copy, and never block or slow the
// catalogue. When the current answer cannot be established (the file is
// missing, empty, broken, slow, the browser is offline, or the last good
// answer is too old), the page shows no reviewed line at all and the
// catalogue's own wording stays. An old approval is never revived.
//
// Timing (plan R4): with any rule in force, the file is asked again 45 s
// after the last good answer, and the rules stop counting 60 s after it if no
// newer good answer came. Those 60 s are measured on a clock that only moves
// forward (performance.now), never the wall clock: setting the computer's
// clock back must not make an old answer current again. Once an answer is
// too old it is dropped, and only a new good answer brings rules back.
// A review must have happened by the current local day. Once its recheck
// date has passed for this answer, moving the clock or zone back cannot revive it.
// A header-only file is not polled; it is asked again when the tab comes back
// into view, after a reload, or when the browser comes back online.
//
// Validation is in subject-rules.js. This module keeps the state, timers and
// the "generation" that makes a late answer from an older request harmless.

import { readRuleRecords, acceptRule, combineRules, localDay, RULES_PATH } from './subject-rules.js';

export const RULES_TIMEOUT_MS = 3000;
export const REFRESH_AFTER_MS = 45_000;
export const MAX_AGE_MS = 60_000;
// Long timers are re-armed in steps: browsers cap setTimeout near 24.8 days,
// and a throttled tab may wake late anyway (every use rechecks the clock).
const MAX_TIMER_MS = 6 * 60 * 60 * 1000;

let s = null;

// startSubjectAuthority({ raw, onChange }) once the catalogue is in. raw is
// data.js's map of the exact catalogue rows the page loaded. onChange runs
// when the set of usable rules changes, never otherwise. The other options
// exist for tools/check.mjs; the page uses the defaults.
export function startSubjectAuthority({
  raw = new Map(), onChange = () => {}, url = RULES_PATH, timeoutMs = RULES_TIMEOUT_MS,
  now = () => Date.now(),
  elapsed = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
  fetchImpl = (...args) => globalThis.fetch(...args),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  online = () => globalThis.navigator?.onLine !== false,
  target = typeof window === 'undefined' ? null : window,
} = {}) {
  stopSubjectAuthority();
  s = {
    raw, onChange, url, timeoutMs, now, elapsed, fetchImpl, timers, online,
    generation: 0, records: null, answeredAt: null, inflight: null,
    refreshTimer: null, ageTimer: null, edgeTimer: null, shown: fingerprint(new Map()), cache: null, listeners: [],
  };
  if (target) {
    const on = (where, type, fn) => { where.addEventListener(type, fn); s.listeners.push(() => where.removeEventListener(type, fn)); };
    const doc = target.document;
    // Coming back to the tab or the page: drop anything too old at once, then ask.
    const resume = () => { settle(); refreshAuthority(); };
    if (doc) on(doc, 'visibilitychange', () => { if (doc.visibilityState !== 'hidden') resume(); });
    on(target, 'pageshow', resume);
    on(target, 'online', resume);
    on(target, 'offline', invalidate);
  }
  return refreshAuthority();
}

export function stopSubjectAuthority() {
  if (!s) return;
  for (const off of s.listeners) off();
  clearTimers();
  s = null;
}

// The usable rule for a programme, or null. Every caller asks at the moment it
// draws, so a rule that expired or aged out while timers slept is never shown.
export function reviewedRule(programmeId) {
  return usable().get(programmeId) ?? null;
}

// Check the clock now (before printing, on resume). Redraws only on a change.
export function recheckAuthority() {
  settle();
}

// Ask the file again. Requests are coalesced; a newer request or going
// offline makes an older answer count for nothing.
export function refreshAuthority() {
  if (!s) return Promise.resolve();
  if (s.inflight) return s.inflight;
  const state = s;
  const generation = ++state.generation;
  const run = (async () => {
    let text = null;
    try { text = await fetchText(state); } catch { text = null; }
    if (s !== state || generation !== state.generation) return;
    const read = text === null ? { ok: false, records: [] } : readRuleRecords(text);
    if (read.ok) {
      state.records = read.records;
      state.answeredAt = state.elapsed();
    } else {
      state.records = null;
      state.answeredAt = null;
    }
    state.cache = null;
    schedule();
    settle();
  })();
  const tracked = run.finally(() => { if (state.inflight === tracked) state.inflight = null; });
  state.inflight = tracked;
  return tracked;
}

// Offline: nothing current can be established, so nothing counts, and any
// answer still on its way belongs to an older generation.
function invalidate() {
  if (!s) return;
  s.generation++;
  s.inflight = null;
  s.records = null;
  s.answeredAt = null;
  s.cache = null;
  clearTimers();
  settle();
}

// The current answer is too old: drop it, so no later clock reading can
// bring it back. Mounted views are told on the next microtask.
function retire() {
  s.records = null;
  s.answeredAt = null;
  s.cache = null;
  for (const name of ['refreshTimer', 'ageTimer']) {
    if (s[name] !== null) s.timers.clear(s[name]);
    s[name] = null;
  }
  const state = s;
  queueMicrotask(() => { if (s === state) settle(); });
}

async function fetchText(state) {
  const controller = new AbortController();
  const timer = state.timers.set(() => controller.abort(), state.timeoutMs);
  try {
    // A fixed same-origin address, no body, no cookies needed: the request
    // carries nothing about the student.
    const res = await state.fetchImpl(state.url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    state.timers.clear(timer);
  }
}

function usable() {
  if (!s || !s.records || s.answeredAt === null || !s.online()) return new Map();
  const age = s.elapsed() - s.answeredAt;
  // At 60 s the answer is no longer current (and a clock that ran backwards
  // proves nothing).
  if (s.records.length && (age >= MAX_AGE_MS || age < 0)) { retire(); return new Map(); }
  const today = new Date(s.now());
  const day = localDay(today);
  // Every new answer clears the cache. Only expiry keeps the furthest day;
  // a review that is back in the future must disappear immediately.
  if (s.cache?.day === day) return s.cache.rules;
  const expiryDay = s.cache && s.cache.expiryDay > day ? s.cache.expiryDay : day;
  const results = s.records.map((record) => acceptRule(record, { raw: s.raw, today, expiryDay }));
  const { rules } = combineRules(results);
  s.cache = { day, expiryDay, rules };
  return rules;
}

function fingerprint(rules) {
  return JSON.stringify([...rules].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function settle() {
  if (!s) return;
  const rules = usable();
  const key = fingerprint(rules);
  scheduleEdge(rules);
  if (key === s.shown) return;
  s.shown = key;
  s.onChange();
}

function clearTimers() {
  for (const name of ['refreshTimer', 'ageTimer', 'edgeTimer']) {
    if (s[name] !== null) s.timers.clear(s[name]);
    s[name] = null;
  }
}

// With rules in force: ask again at 45 s, stop counting them at 60 s.
function schedule() {
  for (const name of ['refreshTimer', 'ageTimer']) {
    if (s[name] !== null) s.timers.clear(s[name]);
    s[name] = null;
  }
  if (!s.records?.length || s.answeredAt === null) return;
  const age = s.elapsed() - s.answeredAt;
  s.refreshTimer = s.timers.set(() => { s && (s.refreshTimer = null); refreshAuthority(); }, Math.max(0, REFRESH_AFTER_MS - age));
  s.ageTimer = s.timers.set(() => { s && (s.ageTimer = null); settle(); }, Math.max(0, MAX_AGE_MS - age));
}

// The earliest recheck-by date in force ends at the next local midnight.
function scheduleEdge(rules) {
  if (s.edgeTimer !== null) s.timers.clear(s.edgeTimer);
  s.edgeTimer = null;
  if (!rules.size) return;
  const earliest = [...rules.values()].map((rule) => rule.recheckBy).sort()[0];
  const [y, m, d] = earliest.split('-').map(Number);
  const end = new Date(y, m - 1, d + 1).getTime();
  const wait = Math.min(Math.max(0, end - s.now()), MAX_TIMER_MS);
  s.edgeTimer = s.timers.set(() => { s && (s.edgeTimer = null); settle(); }, wait);
}
