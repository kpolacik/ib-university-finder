# Wording pass

Registry: S08, S09. One pass over every label and help text, then a Slovak
pass (the cohort is Slovak; the site is English only today).

## English pass completed locally (2026-11-02)

- **S08:** search, HL Maths and IB points help is visible, including on phones.
  Shared help moves into the phone sheet with the extra filters: "Programmes
  with an unknown figure, fee or deadline always stay visible." Inputs retain
  both their help and error descriptions. The fee label is "Max EU fee".
- **S09:** the English UI uses IB points, EU fee, subject area, IB subjects,
  language and language requirement consistently. Compact rows retain "Taught
  in". Irish detail fees explain "Student contribution + levy". The masthead
  sentence "This site is a starting point for research, not a source of truth."
  stays; a site-wide unchecked count remains a question for Leon.
- Counts, errors, detail notes, saved-copy/sample warnings and the dormant
  shortlist export use the reviewed wording. The shortlist remains off and SK
  stays disabled. No admissions values or filtering rules changed.
- D14's duplicate note now says "This list has … Differences beyond the facts
  shown here are not recorded." Its stable "Same-name entry n of N · compare
  official pages" label stays: it describes the recorded ambiguity accurately.

## After the upstream merge / Slovak pass

- Review every CSV prose field, fallback.json and sample CSV wording together:
  programme/university names, subject and other requirements, admission and its
  default, language requirements and defaults, baseline, application system,
  deadline notes. They are frozen in this English UI pass.
- Keep the generated CAO sentence and exact marker sentences frozen until their
  parser, writer, stored notes and checks can change together.
- Translation inventory: plurals in app.js (programme counts), render.js
  (source counts, data problems and sample warnings); fragment-built sentences
  in points.js (round qualifiers), render.js (empty pane, points lines, place,
  provenance, sample warnings), app.js (count leads and filter lists).
- Replace English list joining in app.js with locale-aware lists in that pass.
  Review render.js's en-IE/en-GB formatters and renderCountShort's leading-number
  regex, CSS-generated "· active", and facet display labels separately from
  canonical URL/data values. The CAO parser and data.js markers treat prose as
  data. No translation framework was added.

## Strings added or changed by the points-honesty batch (2026-10-26)

The full list (final, 2026-10-26; commits fe8c1aa, 2bdad70, 6f3374c). Historical
wording below records that batch; the completed English pass above supersedes
UI labels and messages. The CAO sentence
must keep round-tripping through `parseCaoSentence` (js/points.js), so change
it there, in `caoNote` (tools/lib/cao-points.mjs) and in check.mjs together.

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

Phase 4 (the HL Maths 4+ tick, the split count and the card notes; filters.js
`pointsSummary` / `pointsNote`, index.html):

- Checkbox `HL Maths 4+`, help (tooltip and hidden text) `Adds the 25 CAO
  bonus points on Irish courses`
- Count, while My points is set: `N of 1240 programmes · 410 within your points
  · 41 only with HL Maths 4+ · 679 points unknown` (a zero bucket other than
  "within" is left out)
- Card notes: `Shown despite your points: points unknown.` (replaces "Shown
  despite the points filter — no published minimum."); `Shown despite your
  points: the cutoff includes a test, interview or audition.`; `Within your
  points only with HL Maths 4+.`; `Within your points on the Round 2 cutoff,
  not Round 1.`
- Empty state: "Try changing … HL Maths 4+" (filtersInUse)
- Note for the wording pass: "points unknown" counts the 678 rows with no
  figure (mostly Czech entrance-exam rows), so it dominates the count; the
  word may need to say "no IB figure" instead.
