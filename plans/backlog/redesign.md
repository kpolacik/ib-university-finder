# Redesign

Registry: Q15 and the VIS items below. Decided 2026-10-26 (Leon): the visual
direction is reopened entirely.

## How it starts

- Design interviews first: what students and the teacher actually look for on
  a card, on a phone and on a laptop.
- Include Jakub. The current look came from reference images he supplied
  (STATUS, "The look of it"), so he should be part of replacing it.
- When the new direction is decided, replace the STATUS section "The look of
  it" with it, and update the line in `CLAUDE.md` that points there.
- Keep `node tools/check-contrast.mjs` passing; never lower its minimum.

## Items folded into it

- **S07:** the default sort opens on Czech portfolio courses; 813 rows tie on
  date.
- **S08:** filter help lives only in `title` tooltips; "Max fee" doesn't say it
  is the EU fee (wording half in `wording.md`).
- **L09:** all ~1,240 cards render at once, slow on a cheap phone.
- **L10:** Google Fonts blocks first paint and sends visitor IP addresses to
  Google.
- **A03 (rest):** control borders are about 1.2:1 against the page. The focus
  outline was fixed in b914ded.
- **A05 (rest):** empty `<dt>`, uppercase names read letter by letter, the
  degree in the serif face.
- **A08:** printing prints every visible card (680 pages), and titles print
  tinted.

## What the redesign inherits from the points batch

The points-honesty batch (2026-10-26) adds card lines and controls the new
design has to place: minimum vs cutoff wording, one line per CAO round, the
"HL Maths 4+" tick next to "My points", and a count split into within / only
with HL Maths 4+ / points unknown. The full string list is in `wording.md`.
