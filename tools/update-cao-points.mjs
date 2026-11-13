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
//   * the CAO sentence in deadline_notes ("2026 CAO cutoff: Round 1 …,
//     Round 2 …", "every qualified applicant got a place", "No 2026 cutoff
//     published") and the conversion sentences that go with it;
//   * ib_points_min, for every university except UCD, whose figure is UCD's
//     own stated minimum and not a conversion of the cutoff;
//   * a missing test requirement tag, if either round carries "#", keeping
//     every existing requirement.
//
// It never touches last_verified or verified_by: those belong to a person who
// checked the whole row.
//
// ib_points_min is converted from the latest round (Round 2 where the CAO
// published one), though the card's headline is Round 1. The latest round is
// the lower one on every current row, and a student who met last year's
// Round 2 cutoff did get a place, so filtering on Round 1 would hide a real
// option (plans/points-honesty.md, second interpretation call; Leon's Q4,
// 2026-10-26). check.mjs asserts the latest round is the lower one.
//
// The conversion is CAO's IB table for 2026 entry (js/points.js, TABLE):
// 45 and 44 → 600 … 24 → 350, plus 25 points for HL Maths at 4 or better
// where nothing else reaches the cutoff. The 2027 table is not published yet.
//
// When only the IB table changes (each November, when the CAO publishes the
// next EU/EFTA guide) the cutoffs have not moved, so there is nothing to
// fetch. Then run
//
//   node tools/update-cao-points.mjs --reconvert           (dry run: lists every change)
//   node tools/update-cao-points.mjs --reconvert --apply   (writes data/programmes.csv)
//
// which converts the cutoff already recorded in each row's CAO sentence again
// and changes only ib_points_min. It covers every Irish university in
// data/universities.csv, not only the seven above: MTU, SETU and TU Dublin
// were added by research (2026-11-12) with the same CAO sentence. It refuses
// a row whose conversion sentences would change too (a cutoff that crossed
// 600 or 625), because that needs the full refresh. UCD is left alone, as
// below.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';
import { BULLET, CAO_TEST } from '../js/data.js';
import { parseCaoSentence } from '../js/points.js';
import { convertCutoff, HPAT_CODES, HPAT_NOTE } from './lib/ireland.mjs';
import { fetchCaoPoints, caoNote, rebuildNote, hasCaoTest } from './lib/cao-points.mjs';

const IRISH = new Set(['tcd', 'ucd', 'ucc', 'galway', 'dcu', 'ul', 'maynooth']);
// Rows whose note no longer names the code, because it was rewritten by hand.
const CODE_BY_ID = { 'maynooth-bachelor-of-science': 'MH201' };

const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

if (process.argv.includes('--reconvert')) {
  const apply = process.argv.includes('--apply');
  const url = new URL('../data/programmes.csv', import.meta.url);
  const [head, ...rows] = parseCsv(readFileSync(url, 'utf8'));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const [uHead, ...uRows] = parseCsv(readFileSync(new URL('../data/universities.csv', import.meta.url), 'utf8'));
  const irish = new Set(uRows.filter((u) => u[uHead.indexOf('country')] === 'Ireland').map((u) => u[uHead.indexOf('university_id')]));
  const changes = [];
  const refused = [];
  let seen = 0;
  for (const r of rows) {
    if (!irish.has(r[col.university_id]) || r[col.university_id] === 'ucd') continue;
    const cao = parseCaoSentence(r[col.deadline_notes]);
    if (!cao) continue;
    seen++;
    const code = CODE_BY_ID[r[col.programme_id]] ?? cao.code;
    const latest = cao.rounds.at(-1);
    const points = !latest || latest.aqa ? null : latest.points;
    const hpat = HPAT_CODES.has(code);
    const test = r[col.other_requirements].split(BULLET).includes(CAO_TEST) || hpat;
    const conv = convertCutoff(points, { test, hpat, code });
    const missing = conv.notes.filter((s) => !r[col.deadline_notes].includes(s));
    const next = conv.ib === null ? '' : String(conv.ib);
    if (missing.length) { refused.push(`${r[col.programme_id]} (${code} ${points}): note lacks "${missing[0]}"`); continue; }
    if (next !== r[col.ib_points_min]) {
      changes.push({ id: r[col.programme_id], code, points, from: r[col.ib_points_min], to: next });
      r[col.ib_points_min] = next;
    }
  }
  for (const c of changes) console.log(`${c.id}\t${c.code}\tcutoff ${c.points}\t${c.from || '(blank)'} -> ${c.to || '(blank)'}`);
  console.log(`${seen} Irish rows (not UCD) with a CAO sentence; ib_points_min changes on ${changes.length}`);
  if (refused.length) {
    console.log(`${refused.length} row(s) need the full refresh instead, nothing written:\n  ${refused.join('\n  ')}`);
    process.exit(1);
  }
  if (apply) {
    writeFileSync(url, [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');
    console.log('written to data/programmes.csv');
  } else console.log('dry run: nothing written (add --apply to write)');
  process.exit(0);
}

// The sentences this rewrites are OLD_CAO_SENTENCES in lib/cao-points.mjs,
// shared with any one-off rewrite so the two can't disagree.

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
  const sentences = [caoNote(entry)];
  // One conversion for all three Irish writers (lib/ireland.mjs), called even
  // with no cutoff (AQA: points null), so HPAT Medicine always gets the CAO's
  // minimum and HPAT_NOTE.
  const conv = convertCutoff(entry.latest.aqa ? null : entry.latest.points, {
    test: hasCaoTest(entry) || HPAT_CODES.has(code), hpat: HPAT_CODES.has(code), code,
  });
  const ib = conv.ib;
  sentences.push(...conv.notes);
  // UCD's figure is UCD's own stated minimum, not a conversion, so a UCD note
  // keeps only the sentences on this list. It used to drop any sentence naming
  // Maths or 625, but the 601-625 test sentence names neither and would have
  // said "no IB figure is given" beside UCD's own figure.
  // HPAT_NOTE stays too: it describes the CAO's Medicine rule, not UCD's figure.
  // The figure on ucd-medicine (the CAO's 480-point minimum) was set by hand,
  // and this script never writes a UCD figure, so a refresh keeps it.
  const ucdKeep = new Set([sentences[0], HPAT_NOTE]);
  const fresh = (isUcd ? sentences.filter((s) => ucdKeep.has(s)) : sentences).join(' ');

  // The new block where the first old sentence was, every other old sentence
  // dropped, everything else (shared-code notes, Galway band notes,
  // hand-written notes) kept in place.
  r[col.deadline_notes] = rebuildNote(notes, fresh);

  // The browser reads the test marker from Other because the CAO sentence
  // omits "#". Do not lose a Round 1-only marker or replace other hurdles.
  const other = r[col.other_requirements].split(BULLET);
  if (hasCaoTest(entry) && !HPAT_CODES.has(code) && !other.includes(CAO_TEST)) {
    r[col.other_requirements] = [...other.filter(Boolean), CAO_TEST].join(BULLET);
  }

  if (!isUcd) {
    const next = ib === null ? '' : String(ib);
    if (next !== r[col.ib_points_min]) tally.ibChanged++;
    r[col.ib_points_min] = next;
  }
  // last_verified is left alone. It says when someone last checked the whole
  // row against the official page; this script checks only the CAO table, so
  // stamping today's date on 500+ rows claimed checks nobody made (audit T03).
  // The CAO sentence already carries its own year ("2026 CAO cutoff: …").
  tally.updated++;
}

writeFileSync(url, [head.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');
console.log(
  `updated ${tally.updated} Irish rows to ${year} cutoffs; IB figure changed on ${tally.ibChanged}\n`
  + `  ${tally.noCode} with no CAO code in their note (left alone)\n`
  + `  ${tally.notInTable.length} whose code is not in the ${year} table (left alone): ${tally.notInTable.join(', ')}`,
);
