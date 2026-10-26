// The CAO's IB → points conversion, and the CAO sentence in deadline_notes.
//
// This lives in js/ rather than tools/ because both sides need it. The browser
// needs the table to work out what a student's own IB total is worth in CAO
// points (the "HL Maths 4+" tick adds 25 to that), and the importers and the
// CAO refresh need it to turn a cutoff into an IB figure. tools/ can import
// from js/ (tools/check.mjs already imports js/csv.js), but the browser cannot
// import from tools/, so the one copy sits here and tools/lib/ireland.mjs
// imports it. Two copies would drift.
//
// Pure functions only, no DOM, so Node can import this file.

// CAO's official IB conversion, from the 2026 EU/EFTA guidelines document.
// The 2027 table is not published yet; re-check it each cycle.
export const TABLE = [[45, 600], [44, 600], [43, 594], [42, 577], [41, 565], [40, 553], [39, 541], [38, 520],
  [37, 508], [36, 497], [35, 481], [34, 466], [33, 453], [32, 442], [31, 430], [30, 412],
  [29, 400], [28, 389], [27, 379], [26, 368], [25, 359], [24, 350]];

// The 25 CAO bonus points for HL Mathematics at grade 4 or better. They apply
// to any course, not only to maths-sounding ones (registry P03, D28).
export const MATHS_BONUS_POINTS = 25;

/** Lowest IB total whose CAO equivalent still reaches `need` points, or null. */
export const lowestIB = (need) => {
  const ok = TABLE.filter(([, p]) => p >= need).map(([ib]) => ib);
  return ok.length ? Math.min(...ok) : null;
};

/** CAO points for an IB total (24–45), or null outside the table. */
export const caoPointsFor = (ib) => {
  const hit = TABLE.find(([n]) => n === ib);
  return hit ? hit[1] : null;
};

/**
 * The IB figure for one CAO cutoff: { ib, bonusOnly }.
 *
 * A cutoff a 45 or less reaches gets the lowest IB total that reaches it. A
 * 601–625 cutoff without a test is reachable only with the 25 bonus points
 * (45 converts to 600), so it gets lowestIB(cutoff − 25) and bonusOnly (Leon,
 * Q13, 2026-10-25). With a test (the CAO "#" marker, or HPAT) the cutoff may
 * include test marks, so it is not a points total and gets no bonus figure.
 * convertCutoff in tools/lib/ireland.mjs calls this, so the tools and the
 * browser can't disagree.
 */
export function ibForCutoff(points, { test = false } = {}) {
  if (points === null || points === undefined) return { ib: null, bonusOnly: false };
  const ib = lowestIB(points);
  if (ib === null && points <= 600 + MATHS_BONUS_POINTS && !test) {
    const withBonus = lowestIB(points - MATHS_BONUS_POINTS);
    return { ib: withBonus, bonusOnly: withBonus !== null };
  }
  return { ib, bonusOnly: false };
}

// The CAO sentence caoNote() in tools/lib/cao-points.mjs writes. Shapes:
//   2026 CAO cutoff: Round 1 510 points, Round 2 495 points (code TR028).
//   2026 CAO cutoff: Round 1 495 points, Round 2 every qualified applicant got a place (code TR028).
//   … followed by "Some applicants on that score missed out in Round 2 (random draw)."
//     ("in Round 1", "in both rounds")
//   2026: every qualified applicant got a place (code TR028) — no cutoff.
//   No 2026 cutoff published (code TR028).
// and the one-round shape written before 2026-10-26, which one row still has
// (MH002, a 2025 figure): "2025 CAO cutoff: 544 points (code MH002)." Its round
// was not recorded, so `round` is null.
const ROUNDS_RE = /(\d{4}) CAO cutoff: ((?:Round [12] (?:\d+ points|every qualified applicant got a place)(?:, )?)+) \(code ([A-Z]{2}\d{3})\)\.(?: Some applicants on that score missed out in (Round [12]|both rounds) \(random draw\)\.)?/;
const LEGACY_RE = /(\d{4}) CAO cutoff: (\d+) points \(code ([A-Z]{2}\d{3})\)\.(?: Changes yearly — not a guaranteed minimum\.)?( Some applicants on that score missed out \(random draw\)\.)?/;
const AQA_RE = /(\d{4}): every qualified applicant got a place \(code ([A-Z]{2}\d{3})\) — no cutoff\./;
const NONE_RE = /No (\d{4}) cutoff published \(code ([A-Z]{2}\d{3})\)\./;

/**
 * The CAO sentence in a row's notes, read back:
 * { year, code, aqa, rounds: [{ round, points, aqa, notAll }] }, or null.
 * `aqa` on the whole result means no round had a cutoff. The CAO "#" (test)
 * marker is not in the sentence; the row's other_requirements carries it.
 */
export function parseCaoSentence(notes) {
  const text = notes || '';
  let m = text.match(ROUNDS_RE);
  if (m) {
    const drawn = m[4];
    const rounds = m[2].split(', ').map((part) => {
      const [, round, points] = part.match(/^Round ([12]) (?:(\d+) points|every qualified applicant got a place)$/);
      const name = `Round ${round}`;
      return {
        round: Number(round),
        points: points ? Number(points) : null,
        aqa: !points,
        notAll: drawn === name || drawn === 'both rounds',
      };
    });
    return { year: Number(m[1]), code: m[3], aqa: false, rounds };
  }
  m = text.match(LEGACY_RE);
  if (m) {
    return {
      year: Number(m[1]), code: m[3], aqa: false,
      rounds: [{ round: null, points: Number(m[2]), aqa: false, notAll: Boolean(m[4]) }],
    };
  }
  m = text.match(AQA_RE);
  if (m) return { year: Number(m[1]), code: m[2], aqa: true, rounds: [] };
  m = text.match(NONE_RE);
  if (m) return { year: Number(m[1]), code: m[2], aqa: false, rounds: [] };
  return null;
}

/**
 * What a card's Points row says, as plain data, so the card (js/render.js) and
 * the dormant CSV export (js/shortlist.js) can't say different things (R05).
 * One { number, unit, qualifier } per line; `number` is null on a line with no
 * IB figure, which then says why in `qualifier`.
 *
 * A published minimum and last year's cutoff are different promises (P01, Q2
 * interim, 2026-10-26): a minimum is a floor the university states, a cutoff
 * is what the last place offered went for and moves with demand every year.
 * So a cutoff line says which round and year it comes from, carries "≈" (it is
 * an IB equivalent of a CAO points figure, not an IB number anyone published),
 * and Round 1 comes first (Q4: Round 1 is the headline, Round 2 is what the
 * CAO's later offers went down to).
 */
export function pointsLines(row) {
  if (row.ibPointsMin === null) {
    // "There is no points threshold" is news to an IB student who assumes
    // every university has one. An Irish cutoff above 625 that includes test
    // or audition marks is not a points total, so it gives no figure (Q12 C).
    return [{ number: null, unit: null,
      qualifier: row.pointsPlusTest ? 'Cutoff includes a test score' : 'No minimum published' }];
  }
  if (row.pointsKind === 'cutoff' && row.cao) return row.cao.rounds.map((r) => roundLine(r, row.cao));
  if (row.rankedWithHpat) {
    // HPAT Medicine: the figure is the CAO's 480-point minimum, and places
    // then go on points plus the HPAT (Q12 C, 2026-10-25).
    return [{ number: String(row.ibPointsMin), unit: 'IB points', qualifier: 'then ranked with the HPAT' }];
  }
  return [{ number: String(row.ibPointsMin), unit: 'IB points', qualifier: 'minimum' }];
}

function roundLine(r, cao) {
  // The pre-2026-10-26 one-round sentence did not record its round.
  const when = r.round === null ? `cutoff, ${cao.year}` : `Round ${r.round} cutoff, ${cao.year}`;
  if (r.aqa) {
    return { number: null, unit: null,
      qualifier: `${r.round === null ? '' : `Round ${r.round}, `}${cao.year}: every qualified applicant got a place` };
  }
  if (r.ib !== null) {
    // A 601–625 cutoff is only reachable with the 25 HL Maths bonus points
    // (Q13, 2026-10-25), so the line says so.
    return { number: `≈ ${r.ib}`, unit: 'IB points', qualifier: r.bonusOnly ? `${when}, with HL Maths 4+` : when };
  }
  // Above 600 with a test, or above 625: no IB total converts to it.
  return { number: null, unit: null,
    qualifier: `${when}: ${cao.test ? 'not an IB figure (includes a test score)' : 'above what any IB total can reach'}` };
}

/** One pointsLines line as text: "≈ 37 IB points, Round 1 cutoff, 2026". */
export const pointsLineText = (line) => (line.number === null
  ? line.qualifier
  : `${line.number} ${line.unit}, ${line.qualifier}`);
