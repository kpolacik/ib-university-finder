// The starred list, kept in localStorage. No accounts, no server — it lives in
// this browser on this device, and that is the whole design.
//
// Entries are keyed by programme_id, which is why that column must never be
// edited once a row exists: change it and everyone's saved star points at
// nothing. Ids that no longer exist in the sheet are simply ignored on load.

import { BULLET } from './data.js';
import { pointsLines, pointsLineText } from './points.js';
import { yearlyCost, FLOOR_LABEL, UNKNOWN_REASON, poundNote } from './cost.js';

const STORAGE_KEY = 'ib-university-finder:shortlist:v1';

export function loadShortlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
  } catch {
    // Corrupt value, or storage blocked in private browsing. Start empty
    // rather than break the page — the shortlist is a convenience, not the site.
    return new Set();
  }
}

export function saveShortlist(shortlist) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...shortlist]));
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
