# Wording pass

Registry: S08, S09. One pass over every label and help text, then a Slovak
pass (the cohort is Slovak; the site is English only today).

## Known issues

- **S08:** filter help is only in `title` tooltips, which phones never show;
  "Max fee" does not say it is the EU fee.
- **S09:** one idea, several labels (fee / tuition, points / IB points /
  score, language / taught in, subjects / IB subjects).

## Strings added or changed by the points-honesty batch (2026-10-26)

Filled in by each phase, so the wording pass has the full list. Exact wording
is provisional.

Phase 2 (the CAO sentence in `deadline_notes`, written by
`tools/lib/cao-points.mjs`):

- `2026 CAO cutoff: Round 1 495 points (code TR028).` (one round)
- `2026 CAO cutoff: Round 1 510 points, Round 2 495 points (code TR028).`
- `2026 CAO cutoff: Round 1 420 points, Round 2 every qualified applicant got
  a place (code TR028).` (a round with the CAO's AQA; none of our rows today)
- `Some applicants on that score missed out in Round 1 (random draw).` (also
  "in Round 2", "in both rounds")
- Removed: "HL Maths 4+ adds 25 bonus points." (126 rows, D28)

Phase 3 (the card's Points row, from `pointsLines` in `js/points.js`; the
CSV export joins the same lines with "; "):

- `36 IB points, minimum` (was "36 IB points")
- `≈ 37 IB points, Round 1 cutoff, 2026` / `≈ 36 IB points, Round 2 cutoff,
  2026`; `≈ 40 IB points, cutoff, 2025` (the one row with the old one-round
  sentence)
- `…, with HL Maths 4+` on a bonus-only round (was "44 IB points, needs HL
  Maths 4+")
- `Round 1 cutoff, 2026: not an IB figure (includes a test score)` and
  `Round 1 cutoff, 2026: above what any IB total can reach` (a round with no IB
  figure; none of our rows today)
- `Round 2, 2026: every qualified applicant got a place` (AQA round; none of
  our rows today)
- Unchanged: "35 IB points, then ranked with the HPAT", "No minimum
  published", "Cutoff includes a test score"
- "My points" `title`: "Hides programmes whose minimum or last year’s cutoff
  your IB total does not reach" (was "Shows programmes asking for this many IB
  points or fewer")

Planned for Phase 4: "HL Maths 4+" (checkbox) and "Adds the 25 CAO bonus
points on Irish courses"; "within your points" / "only with HL Maths 4+" /
"points unknown" in the count; "Shown despite your points: points unknown.";
"Shown despite your points: the cutoff includes a test, interview or
audition."; "Within your points only with HL Maths 4+."; "Within your points on
the Round 2 cutoff, not Round 1."
