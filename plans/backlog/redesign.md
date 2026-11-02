# Redesign

Registry: Q15 and the VIS items below. Decided 2026-10-26 (Leon): the visual
direction is reopened entirely. Built and described in STATUS.md (2026-11-02);
further refinements come after Leon has been through the built site.

## How it starts

- Design interviews first: what students and the teacher actually look for on
  a card, on a phone and on a laptop.
- Include Jakub. The current look came from reference images he supplied
  (STATUS, "The look of it"), so he should be part of replacing it.
- When the new direction is decided, replace the STATUS section "The look of
  it" with it, and update the line in `CLAUDE.md` that points there.
- Keep `node tools/check-contrast.mjs` passing; never lower its minimum.

## Items folded into it

Built 2026-10-27 to 2026-11-01 on the local `redesign` branch; STATUS.md "The
look of it" describes the result (2026-11-02).

- **S07:** dropped (Leon, 2026-11-02): soonest deadline stays the default sort.
- **S08:** done (Stage 5): visible filter help, "Max EU fee".
- **L09:** first screen drawn at once, the rest in 8 ms chunks; closes after
  one confirming measurement (Leon, 2026-11-02, yardstick (a)).
- **L10:** done (Stage 1): IBM Plex Sans self-hosted, no Google Fonts.
- **A03 (rest):** done (Stage 5): control borders on `--edge`, 4.00:1.
- **A05 (rest):** done.
- **A08:** done (Stage 6): prints the filtered rows, ink on white.

## What the redesign inherits from the points batch

The points-honesty batch (2026-10-26) adds card lines and controls the new
design has to place: minimum vs cutoff wording, one line per CAO round, the
"HL Maths 4+" tick next to "My points", and a count split into within / only
with HL Maths 4+ / points unknown. The full string list is in `wording.md`.
