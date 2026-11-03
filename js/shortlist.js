// The starred list, kept in localStorage. No accounts, no server — it lives in
// this browser on this device, and that is the whole design.
//
// Entries are keyed by programme_id, which is why that column must never be
// edited once a row exists: change it and everyone's saved star points at
// nothing. Ids that no longer exist in the sheet are simply ignored on load.

import { BULLET } from './data.js';
import { pointsLines, pointsLineText } from './points.js';
import { yearlyCost, FLOOR_LABEL, UNKNOWN_REASON, poundNote } from './cost.js';

// Exported so app.js can tell this list's `storage` events from other keys'.
export const SHORTLIST_KEY = 'ib-university-finder:shortlist:v1';

export function loadShortlist() {
  // Storage blocked in private browsing: start empty rather than break the
  // page — the shortlist is a convenience, not the site.
  return new Set(readStoredShortlist() ?? []);
}

// The ids as stored right now, or null when storage cannot be read at all.
// A corrupt value reads as an empty list. Every change re-reads this first,
// because another tab may have saved or unsaved since this one loaded.
export function readStoredShortlist() {
  let text;
  try {
    text = localStorage.getItem(SHORTLIST_KEY);
  } catch {
    return null;
  }
  try {
    const raw = JSON.parse(text);
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveShortlist(shortlist) {
  try {
    localStorage.setItem(SHORTLIST_KEY, JSON.stringify([...shortlist]));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- export

// Each column says what the card says, qualifiers included: a bare "37" for a
// figure that needs HL Maths 4+, or a blank for a "?" city, would tell the
// student less than the page did (R05).
const EXPORT_COLUMNS = [
  ['University', (r) => r.university],
  ['Programme', (r) => r.programme],
  ['Degree type', (r) => r.degreeType],
  ['City', (r) => (r.cityUnknown ? 'Not published' : r.city)],
  ['Country', (r) => r.country],
  ['Deadline', (r) => (r.deadline ? r.deadline.toISOString().slice(0, 10) : '')],
  ['Deadline notes', (r) => r.deadlineNotes],
  ['Admission', (r) => (r.admissionUnknown ? 'Not published' : r.admission.join(BULLET))],
  ['IB points', points],
  ['IB subjects', (r) => (r.noSubjectsRequired ? 'None required' : (r.ibSubjects || 'Not checked yet'))],
  ['Other requirements', (r) => r.otherRequirements.join(BULLET)],
  ['Language requirement', (r) => (r.englishUnknown ? 'Not published' : (r.englishRequirement.join(BULLET) || 'Not checked yet'))],
  ['EU fee (EUR/year)', (r) => (r.tuitionEu === null ? 'Not published' : String(r.tuitionEu))],
  // The yearly estimate is yearlyCost (js/cost.js), the same sum the page
  // shows, so the student's own living figure replaces the university's here too.
  ['Living costs (EUR/month)', (r, c) => (c.monthlyMin === null ? 'Not published'
    : c.monthlyMax > c.monthlyMin ? `${c.monthlyMin}–${c.monthlyMax}` : String(c.monthlyMin))],
  ['Living costs source', (r, c) => (c.personal ? 'Your own figure' : r.livingCostSource)],
  ['Fee + 12 months living, lowest (EUR)', (r, c) => (c.known ? String(c.low) : 'Not known')],
  ['Fee + 12 months living, highest (EUR)', (r, c) => (c.known ? String(c.high) : 'Not known')],
  ['Yearly estimate note', (r, c) => (c.known
    ? [c.floor && FLOOR_LABEL, poundNote(r)].filter(Boolean).join('; ')
    : UNKNOWN_REASON[c.reason])],
  ['Apply via', (r) => r.applicationSystem],
  ['Official admissions page', (r) => r.officialUrl || ''],
  ['Last updated', (r) => (r.lastVerified ? r.lastVerified.toISOString().slice(0, 10) : 'Not recorded')],
  ['Signed by', (r) => r.verifiedBy],
];

// The card's Points lines, joined (pointsLines in js/points.js), so the export
// says "minimum" or "Round 1 cutoff, 2026" exactly where the card does.
function points(r) {
  return pointsLines(r).map(pointsLineText).join('; ');
}

// myLiving: the student's "My living costs" (euros a month), or null.
export function toCsv(rows, { myLiving = null } = {}) {
  const lines = [EXPORT_COLUMNS.map(([heading]) => escapeCsv(heading)).join(',')];
  for (const row of rows) {
    const cost = yearlyCost(row, myLiving);
    lines.push(EXPORT_COLUMNS.map(([, read]) => escapeCsv(read(row, cost))).join(','));
  }
  return lines.join('\r\n');
}

function escapeCsv(value) {
  let text = value == null ? '' : String(value);
  // Any student can type into the Sheet, and a spreadsheet runs a cell that
  // starts with = + - @ (or a tab or carriage return) as a formula when the
  // file is opened. A leading ' makes it plain text (X03).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename, csv) {
  // The BOM is what makes Excel open this as UTF-8 instead of mangling
  // "Kraków" into "KrakÃ³w".
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------------- share

// A share link carries the list and nothing else: `?list=id,id`, plus
// `points=` only when the student ticks "Include my IB points". It is built
// from the saved ids, never from the page address, so a search, a fee limit or
// any other filter the student has set does not leak into the link.
// programme_ids are lowercase letters, digits and hyphens, so the commas stay
// readable; anything else is percent-encoded, a comma included.
export function shareQuery(ids, { points = null, includePoints = false } = {}) {
  const parts = [`list=${encodeList(ids)}`];
  if (includePoints && Number.isInteger(points)) parts.push(`points=${points}`);
  return parts.join('&');
}

function encodeList(ids) {
  return [...ids].map((id) => encodeURIComponent(id)).join(',');
}

// An incoming `?list=`, checked against the loaded data. Null when the
// address has no list. Otherwise { raw, ids, unknown }: raw is the value as it
// stands in the address, ids the known programmes in link order with repeats
// removed, unknown the ids the data does not have (renamed or removed rows, or
// a mistyped link), also de-duplicated. The value is split on its literal
// commas before decoding, so an encoded comma (%2C) stays inside its id.
// It never touches the saved list: saving the shared programmes is a separate
// click (mergeIntoShortlist).
export function readSharedList(query, knownIds) {
  const raw = rawParam(query, 'list');
  if (raw === null) return null;
  const seen = new Set();
  const ids = [];
  const unknown = [];
  for (const part of raw.split(',')) {
    const id = decodePart(part).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    (knownIds.has(id) ? ids : unknown).push(id);
  }
  return { raw, ids, unknown };
}

// The first `name=` value in a query string, still percent-encoded, or null.
function rawParam(query, name) {
  for (const pair of String(query || '').replace(/^\?/, '').split('&')) {
    const at = pair.indexOf('=');
    if (decodePart(at < 0 ? pair : pair.slice(0, at)) === name) return at < 0 ? '' : pair.slice(at + 1);
  }
  return null;
}

// A form-encoded piece ("+" is a space). A broken escape such as "%E0" is kept
// as typed, so it is reported as an unknown id rather than stopping the page.
function decodePart(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

// "2 programmes in this link no longer exist", or null when none are missing.
export function unknownIdsText(count) {
  if (!count) return null;
  return count === 1 ? '1 programme in this link no longer exists.' : `${count} programmes in this link no longer exist.`;
}

// Adds the shared programmes to the saved list, keeping everything already
// saved. Returns how many were new.
export function mergeIntoShortlist(shortlist, ids) {
  let added = 0;
  for (const id of ids) {
    if (!shortlist.has(id)) { shortlist.add(id); added++; }
  }
  return added;
}

// ------------------------------------------------------------------- groups

// Inside the list view, one control groups the rows. Pure, so check.mjs can
// test every bucket. Rows keep their sorted order inside a group.
export const GROUP_BY = { none: 'No grouping', deadline: 'Deadline', points: 'My IB points', country: 'Country' };

const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// The points groups use pointsBucket (js/filters.js), the test the filter and
// the row verdicts use, with the row's own words. 'hidden' is a figure above
// the student's points, which shows only while "Show all saves" is on.
const POINT_GROUPS = [
  ['within', 'Within your IB points'],
  ['maths', 'Only with HL Maths 4+'],
  ['hidden', 'Above your IB points'],
  ['unknown', 'Can’t be compared'],
];

// groupRows(rows, by, state, bucketOf) → [{ key, label, rows }], empty groups
// left out. label is null for the one group of an ungrouped list: "none", or
// "points" while My IB points is empty (the page then asks for the points).
// bucketOf is pointsBucket, passed in so this file needs no filters.js.
export function groupRows(rows, by, state, bucketOf) {
  if (by === 'deadline') {
    const months = new Map();
    const passed = [];
    const none = [];
    for (const row of rows) {
      if (!row.deadline) none.push(row);
      else if (row.deadlinePassed) passed.push(row);
      else {
        const key = row.deadline.toISOString().slice(0, 7);
        if (!months.has(key)) months.set(key, { key, label: monthYear.format(row.deadline), rows: [] });
        months.get(key).rows.push(row);
      }
    }
    return [...[...months.values()].sort((a, b) => a.key.localeCompare(b.key)),
      { key: 'passed', label: 'Deadline passed', rows: passed },
      { key: 'none', label: 'No date', rows: none }].filter((g) => g.rows.length);
  }
  if (by === 'points' && state.myIbPoints !== null) {
    const groups = POINT_GROUPS.map(([key, label]) => ({ key, label, rows: [] }));
    for (const row of rows) groups.find((g) => g.key === bucketOf(row, state)).rows.push(row);
    return groups.filter((g) => g.rows.length);
  }
  if (by === 'country') {
    const countries = new Map();
    for (const row of rows) {
      const key = row.country || '';
      if (!countries.has(key)) countries.set(key, { key, label: key || 'Country not recorded', rows: [] });
      countries.get(key).rows.push(row);
    }
    return [...countries.values()].sort((a, b) => (!a.key) - (!b.key) || a.key.localeCompare(b.key));
  }
  return rows.length ? [{ key: 'all', label: null, rows }] : [];
}

// The heading each group's first row carries: "March 2027 · 2". A map from
// programme_id to its text, or empty when the list is not grouped.
export function groupHeadings(groups) {
  return new Map(groups.filter((g) => g.label !== null).map((g) => [g.rows[0].id, `${g.label} · ${g.rows.length}`]));
}

// The page address: the shared list first while its view is open, exactly as
// it came in, then the filters (stateToParams). Nothing adds `list` otherwise, so closing the view
// drops it and the plain page keeps its plain address.
export function addressQuery(filterQuery, sharedList) {
  return [sharedList ? `list=${sharedList.raw}` : '', filterQuery].filter(Boolean).join('&');
}
