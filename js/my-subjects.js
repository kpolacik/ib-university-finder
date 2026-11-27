// A student's own IB subjects in My list (F01 Phase 2): the one profile on
// this page, and the one optional copy remembered in this browser. No DOM;
// my-subjects-ui.js draws it. Nothing here runs unless js/config.js turns
// SHOW_MY_SUBJECTS on, and even then only once My list is opened.
//
// Privacy, as approved (f01-private-storage-ready.md, E1–E5):
// - By default the profile lives in this page's memory only. A reload or a
//   closed tab forgets it. Nothing is written anywhere.
// - Only "Remember in this browser" writes, and only to one IndexedDB record
//   (database DB_NAME, store 'profile', key 'current'): { version, revision,
//   entries }. Never localStorage, sessionStorage, the address, a request or
//   the console.
// - Every remembered write is a compare-and-set inside one readwrite
//   transaction: it reads the key (getKey) and the value (get) first and
//   writes only if they are exactly what this tab's draft started from. A
//   draft that started from "nothing stored" writes only while nothing is
//   stored; one that started from a remembered copy writes only while that
//   same revision (a random id, never a counter or a hash) is still there.
//   So a Save in a tab that missed another tab's Forget, a site-data clear or
//   a newer save is refused, even if no notification ever arrived.
// - Forget, Retry and switching back to page-only delete unconditionally,
//   and say "removed" only once the transaction has completed.
// - Another tab hears only a fixed word on a BroadcastChannel, never data,
//   and then reads the record itself.
// - A late callback (the database answered after we gave up, or after a newer
//   operation started) never writes or deletes anything.

import { normalizeProfile, MAX_ENTRIES } from './ib-subjects.js';

export const DB_NAME = 'ib-university-finder:my-subjects:v1';
export const DB_VERSION = 1;
export const STORE = 'profile';
export const KEY = 'current';
export const RECORD_VERSION = 1;
export const CHANNEL_NAME = 'ib-university-finder:my-subjects:v1';
// The only message ever posted: "the stored copy may have changed".
export const CHANNEL_TOKEN = 'changed';
// How long opening the database may take (including "blocked") before the
// operation reports failure. Once a transaction has started there is no
// timeout: its own complete or abort event decides.
export const OPEN_TIMEOUT_MS = 4000;

const REVISION = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

// The full v1 check of a stored record. Anything else (an old or future
// version, an extra field, a bad entry, a value of undefined) is "invalid":
// shown as an empty profile with a notice, never partly trusted, never
// overwritten by a remembered Save.
export function validRecord(value) {
  if (!isPlain(value)) return null;
  const keys = Object.keys(value).sort().join();
  if (keys !== 'entries,revision,version' || value.version !== RECORD_VERSION) return null;
  if (typeof value.revision !== 'string' || !REVISION.test(value.revision)) return null;
  const list = value.entries;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ENTRIES) return null;
  for (const entry of list) {
    if (!isPlain(entry) || Object.keys(entry).sort().join() !== 'course,grade,level') return null;
    if (typeof entry.course !== 'string' || typeof entry.level !== 'string') return null;
    if (!(entry.grade === null || (Number.isInteger(entry.grade) && entry.grade >= 1 && entry.grade <= 7))) return null;
  }
  const checked = normalizeProfile(list);
  if (!checked.ok || checked.entries.length !== list.length) return null;
  if (checked.entries.some((e, i) => e.course !== list[i].course || e.level !== list[i].level || e.grade !== list[i].grade)) return null;
  return { revision: value.revision, entries: copyEntries(checked.entries) };
}

export const copyEntries = (entries) => entries.map(({ course, level, grade }) => ({ course, level, grade }));

// A fresh random revision for every write (E3). No crypto, no write.
export function newRevision(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID();
  if (typeof cryptoImpl?.getRandomValues === 'function') {
    const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('no random source');
}

// ------------------------------------------------------------ IndexedDB

// Opens the database for one operation. `create`: only a remembered Save may
// create it; a read or delete that finds no database at all stops the
// creation (aborts the upgrade) and reports "absent", so looking never leaves
// an empty database behind. `live()` is false once this operation timed out,
// was blocked, or a newer operation started: then every late callback closes
// or aborts and touches nothing (E2).
function openDb(env, { create }) {
  return new Promise((resolve) => {
    let settled = false;
    let gaveUp = false;
    let freshAbsent = false;
    let timer = null;
    const live = () => !gaveUp && env.isCurrent();
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== null) env.timers.clear(timer);
      resolve(result);
    };
    let request;
    try {
      if (!env.idb || typeof env.idb.open !== 'function') { done({ error: 'unavailable' }); return; }
      request = env.idb.open(DB_NAME, DB_VERSION);
    } catch { done({ error: 'unavailable' }); return; }
    timer = env.timers.set(() => { gaveUp = true; done({ error: 'timeout' }); }, env.timeoutMs);
    request.onblocked = () => { gaveUp = true; done({ error: 'blocked' }); };
    request.onupgradeneeded = (event) => {
      try {
        const fresh = (event?.oldVersion ?? 0) === 0;
        if (!live() || !create) {
          if (live() && fresh) freshAbsent = true;
          request.transaction.abort();
          return;
        }
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      } catch {
        try { request.transaction.abort(); } catch { /* already finished */ }
      }
    };
    request.onsuccess = () => {
      let db = null;
      try { db = request.result; } catch { done({ error: 'open' }); return; }
      if (!live() || settled) { try { db.close(); } catch { /* closed */ } return; }
      try {
        db.onversionchange = () => { try { db.close(); } catch { /* closed */ } };
        db.onclose = () => {};
      } catch { /* not supported */ }
      done({ db });
    };
    request.onerror = (event) => {
      try { event?.preventDefault?.(); } catch { /* fine */ }
      done(freshAbsent ? { absent: true } : { error: 'open' });
    };
  });
}

function closeQuietly(db) {
  try { db?.close(); } catch { /* already closed */ }
}

// One read of the stored record: { kind: 'absent' | 'remembered' | 'invalid'
// | 'error', revision?, entries? }. getKey tells "no record" from a record
// whose value is undefined (E1).
export async function readStored(env) {
  const opened = await openDb(env, { create: false });
  if (opened.absent) return { kind: 'absent' };
  if (!opened.db) return { kind: 'error', reason: opened.error };
  const { db } = opened;
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(STORE)) { closeQuietly(db); resolve({ kind: 'error', reason: 'schema' }); return; }
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keyRequest = store.getKey(KEY);
      const getRequest = store.get(KEY);
      tx.oncomplete = () => {
        closeQuietly(db);
        if (keyRequest.result === undefined) { resolve({ kind: 'absent' }); return; }
        const record = validRecord(getRequest.result);
        resolve(record ? { kind: 'remembered', ...record } : { kind: 'invalid' });
      };
      tx.onabort = () => { closeQuietly(db); resolve({ kind: 'error', reason: 'abort' }); };
      tx.onerror = (event) => { try { event?.preventDefault?.(); } catch { /* fine */ } };
    } catch {
      closeQuietly(db);
      resolve({ kind: 'error', reason: 'read' });
    }
  });
}

// The compare-and-set write (E1). base is the draft's observation:
// { kind: 'absent' } or { kind: 'remembered', revision }. Resolves only
// after the transaction completed ('ok') or aborted ('stale', 'failed').
export async function writeStored(env, base, entries) {
  if (base?.kind !== 'absent' && base?.kind !== 'remembered') return { result: 'refused' };
  let revision;
  try { revision = env.revision(); } catch { return { result: 'failed', reason: 'random' }; }
  const opened = await openDb(env, { create: true });
  if (!opened.db) return { result: 'failed', reason: opened.error ?? 'open' };
  const { db } = opened;
  return new Promise((resolve) => {
    let outcome = null;
    let tx;
    try {
      if (!db.objectStoreNames.contains(STORE)) { closeQuietly(db); resolve({ result: 'failed', reason: 'schema' }); return; }
      tx = db.transaction(STORE, 'readwrite');
    } catch {
      closeQuietly(db);
      resolve({ result: 'failed', reason: 'transaction' });
      return;
    }
    tx.oncomplete = () => {
      closeQuietly(db);
      resolve(outcome === 'put' ? { result: 'ok', revision } : { result: 'failed', reason: 'no-write' });
    };
    tx.onabort = () => {
      closeQuietly(db);
      resolve({ result: outcome === 'stale' ? 'stale' : 'failed', reason: outcome ?? tx.error?.name ?? 'abort' });
    };
    tx.onerror = (event) => { try { event?.preventDefault?.(); } catch { /* fine */ } };
    try {
      const store = tx.objectStore(STORE);
      const keyRequest = store.getKey(KEY);
      const getRequest = store.get(KEY);
      getRequest.onsuccess = () => {
        try {
          // A newer operation started meanwhile: write nothing (E2).
          if (!env.isCurrent()) { outcome = 'superseded'; tx.abort(); return; }
          const key = keyRequest.result;
          const fits = base.kind === 'absent'
            ? key === undefined
            : key !== undefined && validRecord(getRequest.result)?.revision === base.revision;
          if (!fits) { outcome = 'stale'; tx.abort(); return; }
          store.put({ version: RECORD_VERSION, revision, entries: copyEntries(entries) }, KEY);
          outcome = 'put';
        } catch {
          outcome = outcome === 'stale' ? outcome : 'failed';
          try { tx.abort(); } catch { /* already finished */ }
        }
      };
    } catch {
      outcome = 'failed';
      try { tx.abort(); } catch { /* already finished */ }
    }
  });
}

// The unconditional delete (E4). 'ok' only when the transaction completed
// (or there was no database at all); any schema or access problem is
// 'failed', and the page then says erasure could not be confirmed (E3).
export async function deleteStored(env) {
  const opened = await openDb(env, { create: false });
  if (opened.absent) return { result: 'ok' };
  if (!opened.db) return { result: 'failed', reason: opened.error ?? 'open' };
  const { db } = opened;
  return new Promise((resolve) => {
    let tx;
    let deleted = false;
    try {
      if (!db.objectStoreNames.contains(STORE)) { closeQuietly(db); resolve({ result: 'failed', reason: 'schema' }); return; }
      tx = db.transaction(STORE, 'readwrite');
    } catch {
      closeQuietly(db);
      resolve({ result: 'failed', reason: 'transaction' });
      return;
    }
    tx.oncomplete = () => { closeQuietly(db); resolve(deleted ? { result: 'ok' } : { result: 'failed', reason: 'no-delete' }); };
    tx.onabort = () => { closeQuietly(db); resolve({ result: 'failed', reason: tx.error?.name ?? 'abort' }); };
    tx.onerror = (event) => { try { event?.preventDefault?.(); } catch { /* fine */ } };
    try {
      if (!env.isCurrent()) { tx.abort(); return; }
      const store = tx.objectStore(STORE);
      store.delete(KEY);
      // Confirm in the same transaction that nothing is left under the key.
      const check = store.getKey(KEY);
      check.onsuccess = () => {
        if (check.result === undefined) deleted = true;
        else { try { tx.abort(); } catch { /* finished */ } }
      };
    } catch {
      try { tx.abort(); } catch { /* already finished */ }
    }
  });
}

// ------------------------------------------------------------ the profile

// createProfileStore() → the page's one profile and its remembered copy.
// Options exist for tools/check.mjs; the page passes none.
//   active:   null, or { entries, mode: 'page' | 'remembered', revision? }
//   observed: the last read of the stored record (null until first read)
//   warning:  'write-failed' | 'delete-failed' | 'invalid' | 'read-failed'
//             | 'removed-elsewhere' | 'changed-elsewhere' | null
export function createProfileStore({
  idb = () => globalThis.indexedDB,
  Channel = () => globalThis.BroadcastChannel,
  target = typeof window === 'undefined' ? null : window,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  timeoutMs = OPEN_TIMEOUT_MS,
  revision = () => newRevision(),
  onChange = () => {},
} = {}) {
  const s = {
    active: null, observed: null, warning: null, deleteFailed: false, writeFailed: false,
    busy: false, activated: false, generation: 0, queue: Promise.resolve(), channel: null,
    listeners: [], rereading: null, rereadAgain: false, drafts: new Set(),
  };
  const changed = () => onChange(snapshot());

  // One operation at a time in this tab (E2). Each takes the next
  // generation; anything still answering for an older one is ignored.
  const serial = (fn) => {
    const run = s.queue.then(() => {
      const generation = ++s.generation;
      const env = {
        idb: safeIdb(), timers, timeoutMs, revision,
        isCurrent: () => generation === s.generation,
      };
      return fn(env);
    });
    s.queue = run.catch(() => {});
    return run;
  };
  const safeIdb = () => { try { return idb(); } catch { return null; } };

  function snapshot() {
    return {
      active: s.active ? { mode: s.active.mode, entries: copyEntries(s.active.entries) } : null,
      warning: s.warning, deleteFailed: s.deleteFailed, writeFailed: s.writeFailed, busy: s.busy,
      observed: s.observed ? s.observed.kind : null, activated: s.activated,
    };
  }

  // Signalling: a fixed word only, and only once the change is committed.
  function openChannel() {
    if (s.channel) return;
    try {
      const C = Channel();
      if (typeof C !== 'function') return;
      s.channel = new C(CHANNEL_NAME);
      s.channel.onmessage = (event) => { if (event?.data === CHANNEL_TOKEN) reread(); };
    } catch { s.channel = null; }
  }
  function closeChannel() {
    try { s.channel?.close(); } catch { /* closed */ }
    s.channel = null;
  }
  function announce() {
    try { s.channel?.postMessage(CHANNEL_TOKEN); } catch { /* another tab rereads on focus */ }
  }

  // First use in My list: read the record and start listening. Browse and
  // Compare never get here, so they never open the database.
  function activate() {
    if (s.activated) return;
    s.activated = true;
    openChannel();
    if (target) {
      const on = (where, type, fn) => { where.addEventListener(type, fn); s.listeners.push(() => where.removeEventListener(type, fn)); };
      const doc = target.document;
      if (doc) on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'visible') reread(); });
      on(target, 'pageshow', () => { openChannel(); reread(); });
      on(target, 'focus', () => reread());
      on(target, 'pagehide', () => closeChannel());
    }
    reread();
  }

  // Read the record again (coalesced) and apply E4: an independent page-only
  // profile, a write-failure fallback and a forgotten profile waiting on a
  // retry are never replaced by what is stored.
  function reread() {
    if (!s.activated) return Promise.resolve();
    if (s.rereading) { s.rereadAgain = true; return s.rereading; }
    s.rereading = serial((env) => readStored(env)).then((observation) => {
      apply(observation);
    }).finally(() => {
      s.rereading = null;
      if (s.rereadAgain) { s.rereadAgain = false; reread(); }
    });
    return s.rereading;
  }

  function apply(observation) {
    const before = JSON.stringify(snapshot());
    s.observed = observation;
    for (const draft of s.drafts) if (draft.base === null) draft.base = baseOf(observation);
    if (s.deleteFailed) {
      if (observation.kind === 'absent') { s.deleteFailed = false; if (s.warning === 'delete-failed') s.warning = null; }
    } else if (s.writeFailed || s.active?.mode === 'page') {
      // Keep this tab's own entries.
    } else if (s.active?.mode === 'remembered') {
      if (observation.kind === 'remembered' && observation.revision !== s.active.revision) {
        s.active = { mode: 'remembered', revision: observation.revision, entries: observation.entries };
        s.warning = 'changed-elsewhere';
      } else if (observation.kind === 'absent') {
        s.active = null;
        s.warning = 'removed-elsewhere';
      } else if (observation.kind === 'invalid') {
        s.active = null;
        s.warning = 'invalid';
      }
    } else if (observation.kind === 'remembered') {
      s.active = { mode: 'remembered', revision: observation.revision, entries: observation.entries };
      if (s.warning === 'invalid' || s.warning === 'read-failed') s.warning = null;
    } else if (observation.kind === 'invalid') {
      s.warning = 'invalid';
    } else if (observation.kind === 'error') {
      s.warning = 'read-failed';
    } else if (s.warning === 'invalid' || s.warning === 'read-failed') {
      s.warning = null;
    }
    if (JSON.stringify(snapshot()) !== before) changed();
  }

  const baseOf = (observation) => {
    if (!observation) return null;
    return observation.kind === 'remembered' ? { kind: 'remembered', revision: observation.revision } : { kind: observation.kind };
  };

  // A draft remembers what it started from (E1): the remembered revision on
  // screen, or the last read. It never changes afterwards, so a Save can tell
  // if the stored copy moved under it. null: no read has finished yet; the
  // first one fills it in.
  function openDraft() {
    const base = s.active?.mode === 'remembered' ? { kind: 'remembered', revision: s.active.revision } : baseOf(s.observed);
    const draft = {
      base,
      entries: s.active ? copyEntries(s.active.entries) : [],
      remember: s.active?.mode === 'remembered' || s.writeFailed,
    };
    s.drafts.add(draft);
    return draft;
  }
  function closeDraft(draft) {
    s.drafts.delete(draft);
    // Leaving the editor after a refusal reads the record again, so the next
    // edit starts from what is really stored.
    if (draft?.refused) reread();
  }

  async function mutate(fn) {
    s.busy = true;
    changed();
    try { return await fn(); } finally { s.busy = false; changed(); }
  }

  // Save a validated draft. Returns { result } with result one of:
  //   'page'          kept on this page only (no storage touched)
  //   'page-removed'  kept on this page, the remembered copy deleted
  //   'page-kept'     kept on this page, but the delete failed (warning)
  //   'remembered'    written in this browser
  //   'stale'         refused: the stored copy changed under this draft
  //   'refused'       refused: nothing valid to compare with (unreadable copy)
  //   'write-failed'  kept on this page; the browser did not store it
  async function save(draft, entries, remember) {
    if (s.busy) return { result: 'busy' };
    const clean = copyEntries(entries);
    if (!remember) {
      const needsDelete = s.active?.mode === 'remembered' || s.writeFailed || s.deleteFailed;
      s.active = { mode: 'page', entries: clean };
      s.writeFailed = false;
      if (s.warning !== 'delete-failed') s.warning = null;
      if (!needsDelete) { s.drafts.delete(draft); changed(); return { result: 'page' }; }
      s.drafts.delete(draft);
      return mutate(async () => {
        const done = await serial((env) => deleteStored(env));
        if (done.result === 'ok') {
          s.deleteFailed = false; s.warning = null; s.observed = { kind: 'absent' };
          announce();
          return { result: 'page-removed' };
        }
        s.deleteFailed = true; s.warning = 'delete-failed';
        return { result: 'page-kept' };
      });
    }
    const base = draft.base;
    if (!base || base.kind === 'invalid' || base.kind === 'error') { draft.refused = true; return { result: 'refused', base: base?.kind ?? 'pending' }; }
    return mutate(async () => {
      const done = await serial((env) => writeStored(env, base, clean));
      if (done.result === 'ok') {
        s.active = { mode: 'remembered', revision: done.revision, entries: clean };
        s.observed = { kind: 'remembered', revision: done.revision, entries: clean };
        s.writeFailed = false; s.deleteFailed = false; s.warning = null;
        s.drafts.delete(draft);
        announce();
        return { result: 'remembered' };
      }
      if (done.result === 'stale') { draft.refused = true; return { result: 'stale' }; }
      // The browser did not store it: keep the entries here (E-write).
      s.active = { mode: 'page', entries: clean };
      s.writeFailed = true; s.warning = 'write-failed';
      s.drafts.delete(draft);
      return { result: 'write-failed' };
    });
  }

  // Forget: the profile goes from this page at once; the stored copy is
  // deleted unconditionally and called gone only once that is confirmed.
  async function forget() {
    if (s.busy) return { result: 'busy' };
    s.active = null;
    s.writeFailed = false;
    s.warning = null;
    for (const draft of s.drafts) draft.refused = true;
    return removeStored();
  }
  const retryDelete = () => (s.busy ? Promise.resolve({ result: 'busy' }) : removeStored());
  function removeStored() {
    return mutate(async () => {
      const done = await serial((env) => deleteStored(env));
      if (done.result === 'ok') {
        s.deleteFailed = false; if (s.warning === 'delete-failed' || s.warning === 'invalid' || s.warning === 'read-failed') s.warning = null;
        s.observed = { kind: 'absent' };
        announce();
        return { result: 'forgotten' };
      }
      s.deleteFailed = true; s.warning = 'delete-failed';
      return { result: 'delete-failed' };
    });
  }

  function dismissWarning() {
    if (s.warning === 'changed-elsewhere' || s.warning === 'removed-elsewhere') { s.warning = null; changed(); }
  }

  function stop() {
    for (const off of s.listeners) off();
    s.listeners = [];
    closeChannel();
  }

  return { activate, reread, openDraft, closeDraft, save, forget, retryDelete, dismissWarning, snapshot, stop,
    // For tools/check.mjs: wait until queued storage work is done.
    idle: () => s.queue };
}
