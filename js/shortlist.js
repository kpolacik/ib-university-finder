// The starred list, kept in localStorage. No accounts, no server — it lives in
// this browser on this device, and that is the whole design.
//
// Entries are keyed by programme_id, which is why that column must never be
// edited once a row exists: change it and everyone's saved star points at
// nothing. Ids that no longer exist in the sheet are simply ignored on load.

import { BULLET } from './data.js';

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
  ['Degree', (r) => r.degreeType],
  ['City', (r) => (r.cityUnknown ? 'not published' : r.city)],
  ['Country', (r) => r.country],
  ['Deadline', (r) => (r.deadline ? r.deadline.toISOString().slice(0, 10) : '')],
  ['Deadline notes', (r) => r.deadlineNotes],
  ['Admission', (r) => (r.admissionUnknown ? 'not published' : r.admission.join(BULLET))],
  ['IB points', points],
  ['Subject requirements', (r) => (r.noSubjectsRequired ? 'none required' : (r.ibSubjects || 'not checked'))],
  ['Other requirements', (r) => r.otherRequirements.join(BULLET)],
  ['Language', (r) => (r.englishUnknown ? 'not published' : r.englishRequirement.join(BULLET))],
  ['Tuition EU per year', (r) => (r.tuitionEu === null ? 'not published' : String(r.tuitionEu))],
  ['Apply via', (r) => r.applicationSystem],
  ['Official page', (r) => r.officialUrl || ''],
  ['Last checked', (r) => (r.lastVerified ? r.lastVerified.toISOString().slice(0, 10) : 'never')],
  ['Checked by', (r) => r.verifiedBy],
];

function points(r) {
  if (r.ibPointsMin === null) return r.pointsPlusTest ? 'cutoff includes a test score' : 'not published';
  if (r.needsHlMaths) return `${r.ibPointsMin}, needs HL Maths 4+`;
  if (r.rankedWithHpat) return `${r.ibPointsMin}, then ranked with the HPAT`;
  return String(r.ibPointsMin);
}

export function toCsv(rows) {
  const lines = [EXPORT_COLUMNS.map(([heading]) => escapeCsv(heading)).join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map(([, read]) => escapeCsv(read(row))).join(','));
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
