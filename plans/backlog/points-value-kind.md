# Points: a value-kind field, and the points questions still open

Registry: P01, Q2 (and P04, D27). Decided 2026-10-26 (Leon, after Opus and Sol
review): fix the card wording now, add the field later.

## Why

`ib_points_min` holds figures that mean different things: a university's
published minimum (non-Irish rows, UCD), the CAO's HPAT Medicine minimum, and
the lowest IB total that converts to last year's CAO cutoff (the other Irish
rows). The points-honesty batch tells them apart in the browser
(`pointsKind` in `js/data.js`, worked out from the university and the CAO
sentence in `deadline_notes`). That is an interim fix: it depends on parsing a
note, which breaks quietly if someone rewrites the note by hand.

## What the field should record

Two separate things (Sol's point), so a later change of conversion does not
change the meaning:

- **Meaning:** `minimum | cutoff | above_scale | none`.
- **Conversion:** which table (for example "CAO IB table, 2026 entry"), which
  round (Round 1, Round 2), and whether the HL Maths bonus was assumed.

The importers and `tools/update-cao-points.mjs` write it; the browser reads it
and stops deriving `pointsKind`; MAINTENANCE.md explains it in plain words.
`check.mjs` asserts every row with a figure has a meaning.

## Points questions parked here

- **P04 (subject half):** "My points" does not check subjects. That belongs to
  F01 ("My subjects"), not here.
- **D27:** Irish cutoffs at or below 600 that carry the CAO `#` marker (a test,
  interview, portfolio or audition also counted) are still converted as if they
  were points totals.
- **HPAT and the HL Maths bonus:** the CAO brochure (UGMedEntry2027.pdf) does
  not say whether the 25 bonus points count toward the 480-point Medicine
  minimum. Until someone finds out, the HL Maths tick does not touch HPAT rows.
- **UCD's stated minimum:** for a course with a high cutoff (DN230: minimum 42,
  cutoff 602) the stated minimum may itself assume the bonus. Not investigated.
