// Refresh every Irish row to the CAO's latest points table, in place.
//
//   node tools/update-cao-points.mjs
//
// Why not re-run the seven importers: they rebuild every Irish row from
// scratch, which would undo corrections made since (Galway's and DCU's fees,
// rows removed as discontinued), and their name-based ids are only stable as
// long as each university lists its courses in the same order. This touches
// only what the CAO table decides:
//
//   * the CAO sentence in deadline_notes ("2026 CAO cutoff: …", "every
//     qualified applicant got a place", "No 2026 cutoff published") and the
//     HL Maths bonus sentences that go with it;
//   * ib_points_min, for every university except UCD, whose figure is UCD's
//     own stated minimum and not a conversion of the cutoff.
//
// The conversion is CAO's IB table for 2026 entry (tools/lib/ireland.mjs,
// TABLE): 45 and 44 → 600 … 24 → 350, plus 25 points for HL Maths at 4 or
// better. The 2027 table is not published yet.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';
import { convertCutoff, HPAT_CODES } from './lib/ireland.mjs';
import { fetchCaoPoints, caoNote } from './lib/cao-points.mjs';

const IRISH = new Set(['tcd', 'ucd', 'ucc', 'galway', 'dcu', 'ul', 'maynooth']);
// Rows whose note no longer names the code, because it was rewritten by hand.
const CODE_BY_ID = { 'maynooth-bachelor-of-science': 'MH201' };

// Every sentence the importers wrote from the CAO table. Removed and rebuilt.
const OLD = [
  /\d{4} CAO cutoff: \d+ points \(code [A-Z]{2}\d{3}\)\.( Changes yearly — not a guaranteed minimum\.)?( Some applicants on that score missed out \(random draw\)\.)?/,
  /\d{4}: every qualified applicant got a place \(code [A-Z]{2}\d{3}\) — no cutoff\./,
  /No \d{4} cutoff published \(code [A-Z]{2}\d{3}\)\./,
  /UCD lists a \d+ point CAO cutoff for \d{4}( under code [A-Z]{2}\d{3})?\./,
  /HL Maths 4\+ adds 25 bonus points\./,
  /Only reachable with the 25 HL Maths bonus points\./,
  /Above the 625-point IB maximum, so no IB equivalent\./,
  /Above the 600 points a 45 converts to; reachable only with the 25 HL Maths bonus points, so no IB figure is given\./,
  /Above the 600 points a 45 converts to, and the cutoff may include test or portfolio marks, so no IB figure is given\./,
];
const MATHS_TITLE = /engineer|mathemat|physic|comput|actuarial|financ|econom/i;

const cao = await fetchCaoPoints();
const year = cao.values().next().value.year;
console.log(`CAO table: ${cao.size} courses, ${year} entry`);

const url = new URL('../data/programmes.csv', import.meta.url);
const [head, ...rows] = parseCsv(readFileSync(url, 'utf8'));
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const tally = { updated: 0, ibChanged: 0, noCode: 0, notInTable: [] };

for (const r of rows) {
  if (!IRISH.has(r[col.university_id])) continue;
  const notes = r[col.deadline_notes];
  const code = CODE_BY_ID[r[col.programme_id]] ?? (notes.match(/code ([A-Z]{2}\d{3})/) || [])[1];
  if (!code) { tally.noCode++; continue; }
  const entry = cao.get(code);
  if (!entry) { tally.notInTable.push(`${r[col.programme_id]} (${code})`); continue; }

  // The figure, the way the importers worked it out.
  const isUcd = r[col.university_id] === 'ucd';
  const needsMaths = MATHS_TITLE.test(r[col.programme]) || /mathemat/i.test(r[col.ib_subjects]);
  const sentences = [caoNote(entry)];
  let ib = null;
  if (!entry.latest.aqa && entry.latest.points !== null) {
    // One conversion for all three Irish writers (lib/ireland.mjs).
    const conv = convertCutoff(entry.latest.points, { test: entry.latest.test || HPAT_CODES.has(code), needsMaths });
    ib = conv.ib;
    sentences.push(...conv.notes);
  }
  // UCD's figure is UCD's own stated minimum, not a conversion, so a UCD note
  // keeps only the sentences on this list. It used to drop any sentence naming
  // Maths or 625, but the 601-625 test sentence names neither and would have
  // said "no IB figure is given" beside UCD's own figure.
  const ucdKeep = new Set([sentences[0]]);
  const fresh = (isUcd ? sentences.filter((s) => ucdKeep.has(s)) : sentences).join(' ');

  // Rebuild the note: the new block where the first old sentence was, every
  // other old sentence dropped, everything else (shared-code notes, Galway
  // band notes, hand-written notes) kept in place.
  let out = notes;
  let at = -1;
  for (const re of OLD) {
    const m = out.match(re);
    if (!m) continue;
    if (at < 0 || m.index < at) at = m.index;
    out = out.replace(re, '\u0000');
  }
  out = at < 0
    ? `${fresh} ${out}`
    : out.replace('\u0000', fresh).replace(/\u0000/g, '');
  r[col.deadline_notes] = out.replace(/\s{2,}/g, ' ').trim();

  if (!isUcd) {
    const next = ib === null ? '' : String(ib);
    if (next !== r[col.ib_points_min]) tally.ibChanged++;
    r[col.ib_points_min] = next;
  }
  r[col.last_verified] = new Date().toISOString().slice(0, 10);
  tally.updated++;
}

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
writeFileSync(url, [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');
console.log(
  `updated ${tally.updated} Irish rows to ${year} cutoffs; IB figure changed on ${tally.ibChanged}\n`
  + `  ${tally.noCode} with no CAO code in their note (left alone)\n`
  + `  ${tally.notInTable.length} whose code is not in the ${year} table (left alone): ${tally.notInTable.join(', ')}`,
);
