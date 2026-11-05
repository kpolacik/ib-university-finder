// Compare: up to four programmes side by side, kept in this browser in the
// order they were added. It is a set of its own, apart from My list (Leon,
// 2026-11-05: "I save 10 schools; that doesn't mean I want to compare them").
// Saving never adds to it and clearing the list never empties it.
//
// Like the saves, it is not in the address and never travels in a link.
// Ids no longer in the data are kept (the programme may come back) but never
// count toward the four. Pure, except the two storage functions.

import { MAX_COMPARE } from './compare.js';

export const COMPARE_KEY = 'ib-university-finder:compare:v1';

const unique = (ids) => [...new Set(ids)];

// The ids as stored right now, or null when storage cannot be read at all
// (private browsing). A corrupt value reads as an empty set.
export function readStoredCompare(storage) {
  let text;
  try {
    text = (storage ?? globalThis.localStorage).getItem(COMPARE_KEY);
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(text);
    return Array.isArray(raw) ? unique(raw.filter((id) => typeof id === 'string')) : [];
  } catch {
    return [];
  }
}

export function loadCompare(storage) {
  return readStoredCompare(storage) ?? [];
}

export function saveCompare(ids, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(COMPARE_KEY, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

// The first `max` known ids in stored order, plus every unknown one. A
// programme that was missing and comes back never becomes a fifth.
export function normalizeCompare(ids, known, max = MAX_COMPARE) {
  let room = max;
  return unique(ids).filter((id) => !known.has(id) || room-- > 0);
}

// Adds or removes one programme. A fifth is refused ('full') and the set is
// left as it was; a programme already in it is always removed.
export function toggleIn(ids, id, known, max = MAX_COMPARE) {
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id), result: 'removed' };
  if (ids.filter((x) => known.has(x)).length >= max) return { ids, result: 'full' };
  return { ids: [...ids, id], result: 'added' };
}

// Undo after an "x": the programme goes back where it was, if there is room.
// Already back (another tab, a second Undo): nothing changes.
export function restoreAt(ids, id, index, known, max = MAX_COMPARE) {
  if (ids.includes(id)) return { ids, result: 'restored' };
  if (ids.filter((x) => known.has(x)).length >= max) return { ids, result: 'full' };
  const at = Math.max(0, Math.min(index, ids.length));
  return { ids: [...ids.slice(0, at), id, ...ids.slice(at)], result: 'restored' };
}
