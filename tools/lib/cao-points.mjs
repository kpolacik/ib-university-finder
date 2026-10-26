// The CAO's own points table for Level 8 (honours bachelor) courses.
//
//   https://www2.cao.ie/points/l8.php
//
// Every Irish university page quotes its own cutoffs, but only the CAO says
// what a cutoff *means*. Three of its markers change the answer entirely:
//
//   AQA  every qualified applicant was offered a place — there was no cutoff,
//        so the real requirement is the university's matriculation minimum
//   #    entry also needed a test, interview, portfolio or audition, so the
//        number alone never decided the offer
//   *    not everyone on that score got a place — ties were broken by random
//        selection, so the number is a floor that was not sufficient
//
// A row that quotes "432 points" without saying which of these applied is
// telling an IB applicant something close to false. That is why this file
// exists rather than trusting each university's own number on its own.

import { getHtml } from './ireland.mjs';

const SOURCE = 'https://www2.cao.ie/points/l8.php';

/** One points value: the number plus whatever the CAO flagged about it. */
function parseValue(raw) {
  if (!raw) return null;
  const token = raw.trim();
  if (!token) return null;
  // "#AQA" (a test, and every qualified applicant got a place) and a bare "#"
  // (a test, no figure published: MH002) used to come back as nothing, which
  // dropped the course from the table.
  const test = token.includes('#');
  if (/^#?AQA$/i.test(token)) return { points: null, aqa: true, test, notAll: false, newComp: false };
  if (/^v$/i.test(token)) return { points: null, aqa: false, test: false, notAll: false, newComp: true };
  if (token === '#') return { points: null, aqa: false, test: true, notAll: false, newComp: false };
  const num = token.match(/(\d{2,4})/);
  if (!num) return null;
  return {
    points: Number(num[1]),
    aqa: false,
    test,
    notAll: token.includes('*'),
    newComp: token.includes('v'),
  };
}

/**
 * Reads the table's text into Map<caoCode, entry>. Pure, so check.mjs can run
 * it on a fixture (with a lower `minCourses`); fetchCaoPoints does the
 * network part.
 *
 * `entry.latest` is Round 2 where the CAO published one and Round 1 otherwise —
 * Round 2 is the lower, later cutoff, and quoting the higher Round 1 number
 * would overstate what an applicant actually needed. Both rounds are kept
 * (`round1`, `round2`) and both go in the note.
 *
 * Read by column, not by splitting on runs of spaces (registry D29). Course
 * titles are cut to fit a fixed-width column and some contain two spaces of
 * their own ("Arts - Music - 3 years or 4 years  (BMus or …", CK104), which
 * shifted every value one column left: CK104's and DC015's Round 1 figures
 * were read as Round 2, and MH002 was dropped. The "RND 1" and "RND 2"
 * headings sit exactly above the first character of each value (columns 82
 * and 91 on 2026-10-26), and the heading repeats on every block of the page,
 * so every heading line has to agree or the layout has changed.
 */
export function parseCaoTable(html, { minCourses = 500 } = {}) {
  // The table is plain fixed-width text inside <PRE> blocks, unchanged in shape
  // for years. Parsing the text is steadier here than parsing markup.
  const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  const map = new Map();

  // The table is replaced in place each August, so the year is read off its
  // heading ("Points Required for Entry to 2026 Level 8 Courses") rather than
  // assumed. Every note says which year's cutoff it quotes.
  const year = Number((text.match(/Points Required for Entry to (\d{4})/) || [])[1]);
  if (!year) throw new Error('CAO points table has no year in its heading — its layout has changed.');

  const lines = text.split('\n');
  const heads = lines.filter((l) => l.includes('RND 1'));
  if (!heads.length) throw new Error('CAO points table has no "RND 1" heading — its layout has changed.');
  const c1 = heads[0].indexOf('RND 1');
  const c2 = heads[0].indexOf('RND 2');
  if (c2 <= c1 || heads.some((h) => h.indexOf('RND 1') !== c1 || h.indexOf('RND 2') !== c2)) {
    throw new Error('CAO points table headings are not all in the same columns — its layout has changed.');
  }

  for (const line of lines) {
    const m = line.match(/^([A-Z]{2}\d{3})\s/);
    if (!m) continue;
    const code = m[1];
    const cell1 = line.slice(c1, c2).trim();
    const cell2 = line.slice(c2).trim();
    // A title that ran into the Round 1 column, or a value with a space in
    // it, means the columns are no longer where the heading says.
    if ((line.length > c1 && line[c1 - 1] !== ' ') || /\s/.test(cell1) || /\s/.test(cell2)) {
      throw new Error(`CAO points table line for ${code} does not fit its columns — its layout has changed.`);
    }
    const r1 = parseValue(cell1);
    const r2 = parseValue(cell2);
    const latest = r2 ?? r1;
    if (!latest) continue;
    map.set(code, { code, year, title: line.slice(m[0].length, c1).trim(), round1: r1, round2: r2, latest });
  }

  if (map.size < minCourses) {
    throw new Error(`CAO points table parsed only ${map.size} courses — its layout has changed.`);
  }
  return map;
}

/** Fetches the table and returns Map<caoCode, entry> (see parseCaoTable). */
export async function fetchCaoPoints() {
  return parseCaoTable(await getHtml(SOURCE));
}

/**
 * The sentence that goes in deadline_notes for a CAO-entry course, given what
 * the CAO published about it. Returns null where there is nothing to say.
 * js/points.js parseCaoSentence reads it back; check.mjs tests every shape.
 */
// Kept short on purpose (2026-10-24): it appears on 500-odd cards, and the long
// version made every card a paragraph. A course needing a test or interview
// gets no sentence here, because the importers already tag it under "Other".
//
// Both rounds since 2026-10-26 (Leon, Q4): Round 1 is the card's headline, and
// Round 2, where the CAO published one, is the lower, later figure. Each round
// keeps its own CAO markers. A round with only a test marker and no figure is
// left out.
export function caoNote(entry) {
  if (!entry) return null;
  const { year } = entry;
  const rounds = [[1, entry.round1], [2, entry.round2]]
    .filter(([, v]) => v && (v.points !== null || v.aqa));

  if (!rounds.some(([, v]) => v.points !== null)) {
    return rounds.length
      ? `${year}: every qualified applicant got a place (code ${entry.code}) — no cutoff.`
      : `No ${year} cutoff published (code ${entry.code}).`;
  }

  // "Changes yearly — not a guaranteed minimum" used to follow on every card;
  // removed 2026-10-25 at Jakub's request as noise repeated 500 times.
  const said = rounds.map(([n, v]) => (v.aqa
    ? `Round ${n} every qualified applicant got a place`
    : `Round ${n} ${v.points} points`));
  const parts = [`${year} CAO cutoff: ${said.join(', ')} (code ${entry.code}).`];
  const drawn = rounds.filter(([, v]) => v.notAll).map(([n]) => n);
  if (drawn.length) {
    const which = drawn.length === 2 ? 'both rounds' : `Round ${drawn[0]}`;
    parts.push(`Some applicants on that score missed out in ${which} (random draw).`);
  }
  return parts.join(' ');
}

/**
 * Every sentence the tools have written from the CAO table, in any version.
 * rebuildNote removes them all and puts the fresh block in their place. Add a
 * pattern here whenever a sentence's wording changes, or a refresh leaves the
 * old one beside the new one. The first pattern matches the cutoff sentence in
 * both its one-round (before 2026-10-26) and two-round shapes.
 */
export const OLD_CAO_SENTENCES = [
  /\d{4} CAO cutoff: [^()]*\(code [A-Z]{2}\d{3}\)\.( Changes yearly — not a guaranteed minimum\.)?( Some applicants on that score missed out( in (Round [12]|both rounds))? \(random draw\)\.)?/,
  /\d{4}: every qualified applicant got a place \(code [A-Z]{2}\d{3}\) — no cutoff\./,
  /No \d{4} cutoff published \(code [A-Z]{2}\d{3}\)\./,
  /UCD lists a \d+ point CAO cutoff for \d{4}( under code [A-Z]{2}\d{3})?\./,
  /HL Maths 4\+ adds 25 bonus points\./,
  /Only reachable with the 25 HL Maths bonus points\./,
  /Above the 625-point IB maximum, so no IB equivalent\./,
  /Above the 600 points a 45 converts to; reachable only with the 25 HL Maths bonus points, so no IB figure is given\./,
  /Above the 600 points a 45 converts to, and the cutoff may include test or portfolio marks, so no IB figure is given\./,
  /The CAO minimum for Medicine is \d+ points; places then go on points plus the HPAT test, so last year's cutoff is not an IB figure\./,
  /Above what any IB total can reach, because the cutoff includes test or audition marks, so no IB figure is given\./,
];

/**
 * A row's notes with the CAO block replaced by `fresh`: the new block goes
 * where the first old sentence was, every other old sentence is dropped, and
 * everything else (shared-code notes, Galway band notes, hand-written notes)
 * stays where it was. With no old sentence, the block goes first.
 */
export function rebuildNote(notes, fresh) {
  let out = notes;
  let at = -1;
  for (const re of OLD_CAO_SENTENCES) {
    const m = out.match(re);
    if (!m) continue;
    if (at < 0 || m.index < at) at = m.index;
    out = out.replace(re, '\u0000');
  }
  out = at < 0
    ? `${fresh} ${out}`
    : out.replace('\u0000', fresh).replace(/\u0000/g, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}
