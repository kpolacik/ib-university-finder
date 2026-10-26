# Data research

Rows and fields that need someone to read official pages. Details and
evidence for each ID are in the registry (`plans/audit-issues.md`) and the two
audits in `plans/scan/`.

## Human sign-off

- **T02 / Q7:** sign off a cohort of 15–20 programmes with field-level
  evidence, so some cards say "Checked … by …" honestly. Leon decided on
  2026-10-26 to do this later, once the class says which programmes it is
  targeting. Every row is `AI-DRAFT` today.
- **T03:** the CAO-only refresh (`tools/update-cao-points.mjs`) moves the
  whole row's `last_verified` to today, though it only checked the points.

## Rows and columns

- **D13:** scraped boilerplate in 11 Trinity `ib_subjects` cells (up to 900
  characters).
- **D14:** cards that look identical (Charles General Medicine ×5; the faculty
  is not shown).
- **D15 / X01:** 112 rows share 20 index pages as their official link; one
  `http:` link; an `official_domains` column on universities would let the
  loader reject lookalike domains.
- **D16:** Irish fee: no Free Fees condition or academic year on the card;
  2026/27 and 2027/28 figures mixed.
- **D17:** VŠE "No Czech certificate required" on three rows; a MUNI fee
  labelled EU.
- **D18:** English requirement missing for most Dutch universities (RUG needs
  IELTS 6.5) and DCU.
- **D19:** 298 Czech-taught rows say nothing about Czech/Slovak proficiency
  proof.
- **D20:** `degree_type` blank on 538 rows (409 Irish).
- **D26:** `galway-bachelor-of-commerce-in-international` is titled "…
  International Hotel Management", which looks wrong for GY262.
- **D27:** Irish cutoffs at or below 600 with the CAO `#` marker are converted
  as if they were points totals (also in `points-value-kind.md`).
