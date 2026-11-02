# Where this project is

Written so anyone — including a fresh session with no memory of the work — can
pick it up without re-deriving decisions. Update it when the state changes.

**Live:** https://kpolacik.github.io/ib-university-finder/
**Repo:** https://github.com/kpolacik/ib-university-finder

## State

1240 programmes · 35 universities · 5 countries · all checks passing.

| Country | Universities | Programmes | Notes |
|---|---|---|---|
| Netherlands | 13 | 197 | **Complete** — every Dutch research university |
| Ireland | 7 | 548 | **Complete** — every Irish university |
| Czechia | 5 | 424 | **The big five**, added 2026-10-24 — Czech- and English-taught |
| Italy | 5 | 46 | English-taught only — Bologna, Sapienza, Bocconi, PoliMi, PoliTo |
| Denmark | 5 | 25 | English-taught only — CBS, Aarhus, SDU, Aalborg, DTU |

Italy and Denmark were researched by a second model (CAS/verification/) and
merged on 2026-10-25 by `tools/merge-italy-denmark.mjs`, which records what
was re-checked and corrected. Italian rows are thin on purpose: no Italian
university publishes an IB minimum, 2027/28 round dates are not out, and
public fees depend on family income (ISEE), so deadlines and fees show "Not
published". The University of Copenhagen has no rows because it teaches every
bachelor in Danish.

**Four points the two runs disagreed on, re-fetched a third time
(2026-10-25):** VUT Architektura pozemních staveb closes **2 January** (the
faculty's date; the portal stays open to 4 January because the 2nd is a
Saturday). Galway's IB bands (26–36+) are published by its international
office, and its course pages send EU applicants through the CAO — kept the
CAO conversions, with a band note on the four rows below their band.
Maynooth MH201: CAO deadline 1 February; the 1 July on its page is the CAO
Change of Mind date (2027 Handbook). Denmark: IB applicants apply by 15 March
(CBS: "always 15 March, 12:00 noon"; DTU lists IB applicants under 15 March).

**Second-model verification (2026-10-25).** The same run checked all 1,181
existing rows. Every claimed error was re-checked against the official page
before it was applied; `tools/apply-verification-2026-10-25.mjs` lists each
change with its source, and the three claims that did not survive. Main
results: Dutch statutory fee is €2,771 for 2027/28 (was €2,694); Galway's
2027/28 Free Fees figure is €2,500/€2,700 on every course page; DCU's non-EU
fees all rose; seven Irish rows removed (Maynooth's discontinued MH601–603, a
dead Galway course, a part-time DCU course); Masaryk's importer was writing
"exam can be waived" where the page says "není možné" (19 rows fixed); Charles
CS's EU fee is €4,200, not the €7,500 headline. The Charles importer now keeps
each programme's id tied to its SIS record — a re-run had reshuffled the
ids of same-named programmes (five "General Medicine") between faculties.

Czechia breaks down as Charles 165, Masaryk 145, ČVUT 46, VUT 42, VŠE 26.
Full-time bachelor and long-cycle master's (medicine, law, pharmacy) only.

Every card now has an **Admission** line (added 2026-10-24, Jakub's call):
how the place is decided — open entry, numerus fixus, a selective
application, CAO points, or a Czech entrance exam. Irish rows inherit
`Places offered in order of CAO points` from `admission_default` on the
universities tab; Dutch rows were classified from their own
`other_requirements` (numerus fixus / selective / open), six left `?`
where nothing on record says; Czech rows come from each faculty's own
description of its entrance procedure.

Ireland breaks down as UCD 140, UL 87, Trinity 83, DCU 71, Maynooth 64,
UCC 56, Galway 54.

**Every row is `AI-DRAFT`.** Nobody has verified a single one against an
official page. The banner at the top tells readers to treat the site as a
starting point for research and to check every requirement, fee and deadline on
the official page — it is shown while any row is still `AI-DRAFT`. It used to say
it on every card too ("Gathered <date> · nobody has checked this yet"); that was
removed on 2026-10-24 as noise repeated 757 times. A card now shows a
provenance line only once someone signs it off — set the programme row's
`verified_by` to real initials and it reads "Checked <date> by <initials>", with
the date and initials from that programme row alone. The university row's
`AI-DRAFT` does not stop it (decided 2026-10-26, registry T01).

**Points (2026-10-26, plans/archive/points-honesty.md).** Each card says
whether its figure is a published minimum or the IB equivalent of last year's
CAO cutoff, with the round and year (Round 1 first). "My points" has an **HL
Maths 4+** tick, and the count splits the shown programmes into within your
points, only with HL Maths 4+, and points unknown. The tick changes labels and
counts, never which programmes are shown. The kind of figure (`pointsKind`) is
worked out in the browser from the university and the CAO sentence in the
note; a value-kind column written by the importers is to replace it
(plans/backlog/points-value-kind.md). Every string this added is listed in
plans/backlog/wording.md.

## The next obvious jobs, in order

1. **The redesign, then the wording and Slovak pass** (decided 2026-10-26).
   The visual direction is reopened: design interviews first, with Jakub, then
   the redesign in Claude Design (plans/backlog/redesign.md). It inherits the
   points work: minimum vs cutoff lines, one line per CAO round, the HL Maths
   4+ tick and the split count. After it, one pass over every label and help
   text, then Slovak (plans/backlog/wording.md, which lists the new strings).
2. **Sign off the rows that matter.** Pick the 15–20 programmes actually being
   applied to, open each official page, and replace `AI-DRAFT` with real
   initials. Do not attempt all 757.
3. **DCU's English requirement.** Its requirements page is live but publishes no
   IB equivalence at all, so its 71 rows show no English requirement.

   UCD's fees are no longer a hole, though its page is still broken: the "EU
   Undergraduate Fees 2026/27" page says *"Fees published for the Colleges
   below…"* and publishes nothing below, and the non-EU page is empty too. It
   does not matter, because the figure this cohort pays is the contribution plus
   levy, which UCD does publish. See the Free Fees entry below.


4. **Connect the Google Sheet.** *Not planned for now (decided 2026-10-25).*
   Two tabs, published to the web as CSV, URLs
   pasted into `js/config.js`. Until then the site reads `data/*.csv` from the
   repo and nobody can maintain it without Git.
5. **Czech deadlines that are still last year's.** On 2026-10-24 ČVUT's FSv,
   FEL, FJFI, FD and FBMI, and VŠE's FFÚ, FIS, NF and FM had not published their
   2027 round. Their rows carry no deadline and their admission line says
   `(2026 rules)`. Re-run `tools/import-cvut.mjs` and `tools/import-vse.mjs`
   after their pages update (usually by November), and fill the tables there.
6. **CAO cutoffs are 2026's** (refreshed 2026-10-25 by
   `tools/update-cao-points.mjs`, which updates Irish rows in place rather
   than re-running the importers; notes rewritten 2026-10-26 to quote both
   rounds, figures unchanged). Re-run it each August when the CAO
   replaces the table. The IB→points conversion is CAO's 2026 table (45/44 →
   600 … 24 → 350, +25 for HL Maths 4+), checked against the published image;
   the 2027 table is not out yet.
7. **Living costs.** Blank for all 35 universities. Nineteen numbers would
   improve the tuition filter more than anything else, because rent dwarfs
   tuition everywhere in this dataset.

## Known gaps

- **Czech gaps** (424 rows): 61 have no deadline — the faculties above plus
  English-taught programmes whose 2027 dates are not out (Masaryk's medicine,
  pharmacy and arts; four VŠE English bachelors). 7 English-taught rows have no
  fee (`?`). 10 have no admission line. Every Czech-taught row shows
  "Subjects: Not checked yet" — Czech faculties admit on their own exams, and
  no page was found that states an IB subject list per programme, which is not
  the same as stating there is none.
- **Three Czech deadlines fall before Christmas**: VUT Design and Volné umění
  (30 Nov 2026, portfolio by 3 Dec) and ČVUT Architektura a urbanismus (30 Nov).
- **Three Charles FTVS rows contradict themselves**: Fyzioterapie, Trenér and
  Kondiční trenér are listed as Czech-taught but carry a fee "za studium v
  cizím jazyce". Their fee is `?` and the note says so.
- 111 of 1240 programmes have no deadline: 61 Czech, 45 Italian and 5 Dutch.
  The Dutch ones are VU Law in Society, Leiden Archaeology, Leiden University
  College, and the two Utrecht colleges. Was 20 on the Dutch side — fourteen
  Leiden deadlines and Tilburg Psychology were recovered on 2026-08-21.
- 608 of 1240 say "Not checked yet" for the language requirement, counting the university default each
  programme inherits (Netherlands 173, Czechia 344, Italy 21). On the Irish side
  only DCU's 70 are missing, for the reason in job 3.
- 52 of 1240 show no tuition figure, after inheritance: 39 Italian rows (public
  fees depend on ISEE), 10 Czech, 2 Dutch and Trinity's Columbia dual
  degree, whose page does not say what each part costs. Was 147 on the Dutch and Irish rows alone — the Irish
  fees were re-based on the Free Fees Initiative on 2026-08-21, which both
  corrected them and filled UCD's 140.
  Galway no longer has a university default at all — its fees are per course,
  because only 1 of its 54 courses charged the figure that used to be the
  default. See the GLM re-check section.
- `student_life_url` is empty everywhere. Never invent these.
- Subject areas are keyword-mapped from course titles across all seven Irish
  universities, and a few are rough.
- **`baseline_requirement` is blank for all six new Irish universities.** UCD
  does state one — "24 or more total points and the award of the IB Diploma" —
  but only on a page headed "for international (non-EU/non-EEA) students only",
  and a Slovak applicant goes through the CAO as an EU applicant. Left blank
  rather than borrowed from the wrong audience. The per-course `ib_points_min`
  carries the number that actually matters anyway.
- **358 of the 548 Irish rows have a blank `ib_subjects`.** Only UCD and
  Trinity publish subject requirements per course; the other five do not, so
  blank here means "not checked", not "nothing to meet". A further 7 Trinity
  rows say `none`, and there that is verified: Trinity runs its "Admission
  Requirements" heading straight into "English Language Requirements" on those
  pages, which is how it says a course asks for no particular subjects.

## The look of it

**Rebuilt 2026-10-27 to 2026-11-01** (local branch `redesign`, not upstream
yet). Leon took it as the working direction on 2026-11-02; he has not been
through the built site in detail, so refinements will follow. The full build
brief is `plans/design-round1/design-spec.md` (with its 2026-10-28 amendment)
and the picture is `plans/design-round1/full/mockup.html`. Both are local to
the checkout that built it (`plans/` is not in git), so the rules that matter
are repeated here. This replaces the Playfair Display / pastel-panel look of
2026-10-24, which came from Jakub's reference images.

**The direction, so a later edit does not quietly undo it:**

- **One summary row per programme.** A row shows the title, university, a
  requirements line and three cells: points, deadline, EU fee. Below 1200 px a
  tap opens the detail in place under the row; from 1200 px the detail sits
  in a sticky pane on the right. Phones get compact rows, a "Filters" sheet
  and a count bar that sticks to the top. Phones are a real target, not an
  afterthought.
- **Colour only for a verdict.** A cell is filled only when it tells the
  student something they can act on: green "Within your points", amber "Only
  with HL Maths 4+", orange for a deadline within 60 days. A verdict is always
  a word, a mark and a fill, never colour alone. Plain facts are plain ink.
- **Unknown is a dashed box,** never a blank and never a reason to hide a row.
- **Blue only for interaction** (links, focus, the primary button, the
  selected row, active filters). **Red only** on the sample-data banner and
  the total-failure alert. Field errors and notes use ink and weight.
- **Identity is not status.** The lavender masthead and the country badges
  are the only other tints, and a badge always says the country's name in
  words. Flags appear only inside the Country filter.
- **One typeface: IBM Plex Sans,** self-hosted in `fonts/` (400, 600, 700;
  licence in `fonts/OFL.txt`). No Google Fonts request, so no visitor IPs go to
  Google and a slow font server can't block the page (L10). Tabular figures,
  no italics.
- **Every colour is a token** in the one `:root` block of `css/styles.css`;
  never put a hex value anywhere else. `node tools/check-contrast.mjs` checks
  every text and mark pair (65 today). Never lower its minimum.
- **Light only, no dark palette** (dropped 2026-10-24). `color-scheme: light`
  is declared in `:root`, and it has to be: without it a browser on a dark OS
  renders form controls, scrollbars and the canvas dark underneath a light page.
  `tools/check-contrast.mjs` throws if a `prefers-color-scheme: dark` block
  reappears.
- **Motion** is transform and opacity plus the one expand, 120–200 ms, and
  none at all under `prefers-reduced-motion`. No reordering animation.
- **Print** prints the filtered rows in order, ink on white (A08).
- **Speed.** The first screen of rows is drawn at once and the rest in short
  8 ms chunks after it, so a filter change paints quickly even with 1,240 rows
  (L09).

### Three traps this hit, all of which looked like working code

- **`[hidden]` loses to any author `display` rule.** The attribute is only
  `display: none` in the UA stylesheet, so `.skeletons { display: grid }` beat
  it and the "hidden" loading block kept its space — pushing the first card
  756px down, below the fold on a laptop. There is now a global
  `[hidden] { display: none !important }`.
- **`content-visibility: auto` skips style recalculation inside a card.** State
  expressed only as CSS on an attribute selector *inside* a card can paint
  stale; the card's own classes are fine, because the card is the containment
  root. That is why the save button swaps which `<symbol>` it references rather
  than only recolouring on `[aria-pressed]` — a content change always lands.
  The old `★`/`☆` swap was accidentally immune to this. Prefer content over
  style for anything that changes inside a card.
- **A CSS `transform` on an inline element in the summary resolved to identity**
  in testing, even set inline, while the same declaration on a `<div>` worked.
  The filter chevron therefore shows one of two icons instead of rotating one.

## Bugs found and fixed, so they are not reintroduced

- **A capped regex silently became "no requirement" (fixed 2026-08-16).**
  `import-tcd.mjs` captured the text after "International Baccalaureate:" with
  a 110-character limit. Trinity's requirements routinely run longer than that
  ("SL Grade 5 Mathematics HL Grade 5 in two of Physics, Chemistry, Biology,
  ..."), so the match failed outright and the code fell through to writing
  `none` — telling a student there was no subject requirement where Trinity
  demands several. **39 of 79 rows were wrong.** Trinity now states a real
  subject requirement on 66 rows where it managed 20 before.

  The lesson is not "the number 110 was too small". It is that the failure
  branch of a parser must never be the reassuring answer. Every importer here
  now writes blank — "not checked" — when it cannot read something, and only
  writes `none` on positive evidence that the university means none.

- **The same capped-regex bug, a second time (fixed 2026-08-21).**
  `import-ucd.mjs` capped its subject-requirement capture at 160 characters.
  UCD's Computer Science page states its maths requirement further from the next
  heading than that, so the match failed and the row was written with **no
  subject requirement at all** — the identical failure to Trinity's 110, found
  by a second model re-checking the data rather than by us. The cap is gone.

  Two importers made the same mistake independently. If a third capture needs a
  bound, bound it with a terminator, never a character count.

- **Stream courses inherit from a parent page.** Trinity's "Chemistry: Chemical
  Sciences" does not repeat the requirement; it links to the parent course that
  carries it. The importer follows that link once, which recovered 15 rows.

- **Graduate-entry courses got in, and a GAMSAT score became IB points (fixed
  2026-10-25).** UCC's "Medicine (Graduate Entry)" and Trinity's "Graduate
  Entry to Pharmacy" need a first degree, yet both were listed, and UCC's
  GAMSAT cutoff of 58 was run through the IB table as "24 IB points". Both rows
  are gone. `SKIP_TITLE` in `tools/lib/ireland.mjs` and Trinity's own title
  filter in `import-tcd.mjs` now drop "graduate entry", so a rerun can't bring
  them back. `update-cao-points.mjs` only edits rows that exist.

- **The HPAT was guessed from course titles (fixed 2026-10-25).** `otherFor()`
  wrote "HPAT admission test" on any title with "medicine" or "dental science",
  so Dental Science, Podiatric Medicine and Molecular Medicine claimed a test
  they don't have, while the real Medicine rows only said "Test, interview,
  portfolio or audition". The HPAT now comes from a list of CAO codes
  (`HPAT_CODES`, from ACER's own page), checked before the CAO marker in every
  Irish importer.

- **A one-off merge script could undo later fixes (guarded 2026-10-25).**
  `tools/merge-italy-denmark.mjs` rebuilds every Italian and Danish row, so a
  rerun would bring back the old Bocconi fees, the wrong World Bachelor
  deadline and the old DTU English note. It now refuses to run without
  `--rerun-one-off`, and `check.mjs` checks that by reading the file, never by
  running it.

- **A duplicate row inherited the wrong fee, and a `?` hid a published
  numerus fixus (fixed 2026-10-25).** The VU "Liberal Arts and Sciences" row is
  Amsterdam University College, the same college as the UvA entry, but it had a
  blank fee and so showed VU's own €2,771 instead of AUC's €5,580. It now carries
  AUC's name and fee. Leiden's English-taught International Relations and
  Organisations had `?` for its admission route although Leiden's page says it
  has a numerus fixus with a selection and placement procedure; it now says so.
  `check.mjs` guards both. Leon then dropped both duplicate rows on
  2026-10-25 (`vu-las`, and `lei-polsci`, whose English option is `lei-iro`).

- **A `?` admission route vanished from the card (fixed 2026-10-25).** `?` empties
  the admission list, so Leiden Archaeology, Leiden University College and
  University College Roosevelt showed no Admission row at all, as if there were no
  route. The card now shows "Admission: Not published" (`admissionUnknown` in
  `js/data.js`). `check.mjs` guards it.

- **Cutoffs of 602–625 were called "above the IB maximum" (fixed 2026-10-25).**
  A 45 converts to 600 and the HL Maths bonus adds 25, so UCC Dentistry, DCU
  Global Business (USA) and UL Architecture are reachable, only not by the IB
  total alone. UCC Dentistry and DCU now show the bonus figure (next entry). UL
  Architecture's cutoff carries the CAO test marker, so its note now says the
  cutoff may include test or portfolio marks, and it still gives no IB figure.
  The wording comes from `aboveIB` in `tools/lib/ireland.mjs`, which both Irish
  importers and `update-cao-points.mjs` share. Rows really above 625 are the
  next-but-one entry.

- **The HL Maths bonus figure depended on the course title (fixed 2026-10-25,
  registry P03).** The importers only tried the 25 bonus points on courses with
  a maths-sounding name, so Trinity Dental Science (625) showed 44 while UCC
  Dentistry (625) showed nothing. The CAO bonus counts for any course. All
  three Irish writers now share `convertCutoff` in `tools/lib/ireland.mjs`:
  every 601–625 cutoff without a test gets the bonus figure and the sentence
  "Only reachable with the 25 HL Maths bonus points.", and the card reads
  "44 IB points, needs HL Maths 4+". `check.mjs` ties the sentence to the
  figure.

- **Irish Medicine said "No minimum published" (fixed 2026-10-25, registry
  P02).** Its cutoffs (730–741) are points plus the HPAT test score, not points
  totals, and the CAO does publish a minimum: 480 points for every HPAT course
  (CAO, "Selection Criteria for Undergraduate Entry to Medicine for EU
  Applicants 2027"). The 5 Medicine rows now show 35 IB points (480 converted),
  and the card reads "35 IB points, then ranked with the HPAT". The other two
  cutoffs above 625 (Trinity Music Education, Galway Commerce International)
  include an audition or test, so they still give no figure and the card reads
  "Cutoff includes a test score". No row says "Above the 625-point IB maximum"
  any more. The sentences come from `convertCutoff` in `tools/lib/ireland.mjs`.

- **The CAO table was read by splitting on double spaces (fixed 2026-10-26,
  registry D29).** The table is fixed-width text, and `fetchCaoPoints` split
  each line wherever two or more spaces ran together. Some course titles have
  two spaces of their own ("Arts - Music - 3 years or 4 years  (BMus or …",
  CK104; "Post Primary Teacher Education -  Technology, …", DC015), so their
  Round 1 figure was read as Round 2, and a bare `#` (MH002) dropped the
  course. The figures on our rows happened to be right, because only the
  latest round was quoted, but quoting both rounds would have mislabelled
  them. `parseCaoTable` in `tools/lib/cao-points.mjs` now reads each value
  from the column under its "RND 1" / "RND 2" heading, and stops with "layout
  has changed" if the headings on the page disagree or a title runs into the
  figures. `check.mjs` runs it on a copy of those lines.

  Verification also caught a test marker being read from the latest round
  only. The importers and refresh now check both rounds, so a Round 1-only
  `#` keeps the course's test requirement and the stricter conversion. The
  refresh adds a missing test tag without replacing other requirements.
  Regression fixtures cover it; no data was changed or importer run.

- **"HL Maths 4+ adds 25 bonus points." went on courses by title (removed
  2026-10-26, registry D28).** 126 rows carried it because their name sounded
  mathematical, though the bonus applies to any course. The sentence is gone
  from the data and the tools (`OLD_CAO_SENTENCES` still strips it on a
  refresh); the "HL Maths 4+" tick next to My points says it once instead.

- **Passed-deadline cards were dimmed until unreadable (fixed 2026-10-26,
  registry A01).** A card whose deadline had gone was drawn at 65% opacity,
  which took its text to 2.7–3.6:1 contrast, below what anyone can read
  comfortably. The first one (Bocconi's World Bachelor, 1 November) would have
  dimmed on 2 November. The dimming is gone. Since the redesign the deadline
  cell says "Passed, check next cycle" over the struck-through date, in neutral
  ink, never red. `check.mjs` fails if a passed or selected row gets an opacity
  again.

- **Cards left out what nobody knew (fixed 2026-10-26, registry R01, R03, R04,
  T04).** A card with no language requirement had no Language row, so 608 cards
  looked as if there were nothing to meet; they now say "Not checked yet" (or
  "Not published" for `?`). The university's general requirement (the
  `baseline_requirement` column) only showed on a card with no other
  requirement at all, which no real row is, so it was never seen; every card now
  ends with a "General" row when its university has one. A `?` city showed only
  the country; it now says "City not published". And a blank `verified_by`
  read as "Checked" with no name; it now counts as not checked and is listed
  under the spreadsheet problems. `check.mjs` guards all four.

- **Search and the number filters misbehaved (fixed 2026-10-26, registry S01,
  S04, S05, S06, P05).** Search was one exact phrase, so "computer science
  netherlands" found nothing and "cs" matched "Physics". Now every word has to
  appear, in any order, words of three letters or fewer must start a word, and
  the subject areas are searched too. Anything typed while the list loaded was
  ignored; it now counts. My points and Max fee applied 46, −3 or 36.5 without a
  word, and the fee box rejected €2,771; a number that is not a whole number in
  range is now refused with a message under the box and not applied. The
  "nothing matches" hint named filters nobody had set; it now names the ones in
  use and has a Clear all button. A tab left open past midnight kept yesterday's
  deadline badges; they are worked out again on the next action or when the tab
  comes back into view. `check.mjs` guards each. Universities are also found by
  their short and native names (UvA, TCD, ČVUT, Univerzita Karlova; the
  `aliases` column on the universities tab), and Prague, Milan, Turin, Rome and
  The Hague by their local names.

- **A broken, empty or slow file loaded as an empty site (fixed 2026-10-26,
  registry L01–L07, X01, T04).** An empty or header-only programmes file, a
  login page served instead of the CSV, or a renamed column (`official_url`,
  `application_deadline`, `verified_by`, …) loaded as 0 programmes or as cards
  with no deadline. A request that never answered left the page loading for
  ever. Now each of those falls back to the saved copy (`data/fallback.json`),
  after 10 seconds for a request that hangs, and the banner says so and links
  to the problems list, which names the file and the column. If even the saved
  copy fails, the page says "Could not load the programme list" with a Reload
  button instead of a JavaScript error. A file that ends inside an open quote
  mark is reported (it used to swallow every row after it). Numbers are
  checked: IB points must be a whole number from 24 to 45, fees and living
  costs 0 or more, and a comma only separates thousands ("2771,00" used to read
  as 277,100). A blank `official_url` is listed as a problem, and a link with a
  user name in it (`https://www.ucd.ie@evil.example/`, which goes to
  evil.example) is refused. `check.mjs` guards each, and also fails when
  `data/fallback.json` no longer matches the CSVs field for field.

- **Keyboard, screen reader and phone problems (fixed 2026-10-26, registry
  A02–A07).** On a 320 px phone the open filter lists and the masthead count
  made the page wider than the screen; a list is now never wider than the
  screen (the last one opens to the left) and the count wraps. The text boxes and Sort had their focus outline
  replaced by a ring nobody could see; they now show the same blue outline as
  everything else. A filter list stayed open after tabbing out of it, and
  Escape in Search moved the cursor to a filter button; both fixed. A screen
  reader now hears "Subject area 2 selected" instead of "Subject area 2", the
  result count only when it changes, "Architektura a urbanismus, Bc." instead
  of the title and degree run together, Czech titles in Czech, the masthead
  without its decorative full stop, and each "Official admissions page" link
  with the programme's name and a note that it opens a new tab. The filter bar
  no longer sticks to the top on a phone held sideways (it took half the
  screen). Since the redesign nothing in the header sticks: only the count line
  below 600 px and the column header from 600 px, and "Skip to results", Tab
  and the arrow keys land below whichever one it is. `check.mjs` guards each.

- **Motion, print and the last screen-reader comma (fixed 2026-10-28, redesign
  stage 6, registry A05, A08, L09).** Traps worth knowing before touching them:
  - A slot added already "open" never animates: the browser's first look at it
    is the open style. app.js adds it closed, reads its style once, then opens
    it on the next frame. A close removes it when its own `grid-template-rows`
    transition ends, or after 250 ms if that never comes. A close or reopen,
    a rebuild, a 1024 crossing, print or reduced motion first cancels whatever
    the old slot had pending, so a late callback cannot remove the new one.
  - Reduced motion used to shorten every effect to 0.01ms. That is still a
    transition, with late events. It is now `none`, the scrim included, and a
    closing slot is removed at once.
  - Paper is narrower than the screen, so the 1024 and 600 px queries can fire
    while printing. Between `beforeprint` and `afterprint` nothing moves; a
    crossing or filter change still due runs afterwards.
  - A row named "World Bachelor in Business , BSc" in Chrome: the hidden ", "
    before the degree is clipped and absolute, so it counted as a block of its
    own. Inside a row button and the detail title it is now inline at font
    size 0. Size 0 alone kept the 20 px line height and made every row 5 px
    taller; `line-height: 0` puts the rows back to the exact pixel.
  - Clear all left focus on itself (now disabled) in the bar, and on the empty
    state's button after it hid. Focus now goes to Search, or to the sheet's
    heading inside the sheet.
  - The sheet's footer said "Show programmes", with no number, while the list
    loaded. It is now a disabled "Loading programmes…" until the first count.
  - Print was colour on paper, cut open details at page breaks and could print
    a half-closed slot. It now prints the rows on screen, in their order, ink
    on white, every open slot in full, the sample warning kept and the saved-copy
    and failure banners dropped.
  `check.mjs` guards each, and `plans/finish-review/` (not in git) has the browser
  evidence.

## Decisions already made, so they are not relitigated

- **A programme's own signature is enough** (Leon, 2026-10-26, registry T01).
  A card says "Checked <date> by <initials>" when its programme row is signed,
  even while its university row says `AI-DRAFT`; the date and initials come
  from the programme row only. Signing a programme means checking everything
  its card shows, including what it takes from the university row. Before, both
  rows had to be signed, and all 35 university rows are `AI-DRAFT`, so a
  programme sign-off could never show.

- **Both CAO rounds are shown, Round 1 as the headline** (Leon, 2026-10-26,
  registry Q4/P06). Each is labelled with its round and year ("Round 1 cutoff,
  2026") and keeps the CAO's markers. The points filter, the count and the sort
  use the lower round, which is Round 2 wherever the CAO published one (it is
  `ib_points_min`): a student who met last year's Round 2 cutoff did get a
  place, so hiding that course would lose a real option. Where Round 2 is what
  put a course within someone's points, the card says so ("Within your points
  on the Round 2 cutoff, not Round 1.").

- **An "HL Maths 4+" tick next to My points** (Leon, 2026-10-26, registry Q5;
  settles D28). The CAO's 25 bonus points apply to any Irish CAO course, so the
  tick applies them to every Irish cutoff, and the 126 notes that said "HL
  Maths 4+ adds 25 bonus points." by course title are gone. Read per student:
  unticked, a course this student reaches only with the bonus stays visible,
  says "only with HL Maths 4+" and is not counted as within their points;
  ticked, it counts as within. The tick changes labels and counts, never which
  courses are shown. It does not touch UCD (its figure is its own minimum) or
  HPAT Medicine (the CAO does not say whether the bonus counts toward its
  480-point minimum). Unknown and test-score rows never hide.

- **The count is split while My points is set** (Leon, 2026-10-26, registry
  Q3/P04): "N of 1240 programmes · 47 within your points · 7 only with HL
  Maths 4+ · 62 points unknown". It says "points unknown", not "publish none",
  because a blank figure often means nobody has checked.

- **Points wording now, a value-kind field later** (Leon, 2026-10-26, registry
  Q2/P01). The browser tells a minimum from a converted cutoff by the
  university and the CAO sentence in the note (`pointsKind` in `js/data.js`).
  A proper column, recording the meaning and the conversion separately, is in
  `plans/backlog/points-value-kind.md`.

- **Compare is a draft only** (Leon, 2026-10-26, registry Q9/F05). No code,
  hidden or not. `plans/backlog/compare-architecture.md` holds the sketch. Ask
  Jakub before building it.

- **The class's target programmes come later** (Leon, 2026-10-26, registry
  Q7). The human sign-off of 15–20 programmes (T02) waits for that list;
  `plans/backlog/data-research.md`.

- **The visual direction is reopened** (Leon, 2026-10-26, registry Q15). The
  redesign starts with design interviews and includes Jakub, whose reference
  images set the current look. "The look of it" below stays until the new
  direction replaces it; `plans/backlog/redesign.md`.

- **Deferred work lives in `plans/backlog/`, tracked in git** (Leon,
  2026-10-26, registry Q16). Items are named by their registry ID only; the
  registry (`plans/audit-issues.md`) stays the authoritative list and its State
  column points at the backlog file.

- **Card notes are short** (rewritten 2026-10-24, median 532 → 118 characters).
  The Free Fees explanation that sat on every Irish card is gone — the reason
  Irish fees are the contribution plus levy is recorded once, below, not on every
  card — and so is every other sentence explaining a fee. The repeated cutoff
  disclaimers are one short line each, and notes written before the August
  checks that contradicted them ("UNUSUALLY EARLY DEADLINE — 1 January" on
  Groningen rows that are now 1 May, "DEADLINE NOT YET GATHERED" on Leiden rows
  that now have one) were rewritten. The wording lives in `caoNote` in
  `tools/lib/cao-points.mjs` and the importers, so a re-run produces the short
  form. Leiden University College's fee is now `?` rather than the €2,694 default
  its note had warned was probably wrong.

- **No save button, no shortlist** (removed 2026-10-24 at Jakub's request). The
  per-card bookmark is gone, and with it the only way to add to the shortlist,
  so the shortlist bar, its CSV export and Print are hidden too. The shortlist
  code in `js/app.js` and `js/shortlist.js` is left in place: restoring the
  button in `js/render.js` brings the feature back. The Stage 2 "compare your
  shortlist side by side" view depended on it and needs a different way to pick
  programmes if it is still wanted.

- **One row per programme**, joined to a university by `university_id`. Two
  tabs, so university-level facts are typed once.
- **Unknown never hides a programme** from a filter. It is shown and labelled.
- **`none` and blank are different.** `none` means the university says there is
  no requirement; blank means nobody has checked. Blank defaults to "not
  checked" so a forgotten cell never reads as "nothing to meet".
- **`?` means "differs from the university default, value unknown"** and never
  inherits. Used where a university college charges more than the standard rate
  but the figure has not been confirmed.
- **Non-EU tuition is not collected.** Everyone using this site is an EU
  citizen. The columns still exist; nothing reads them. The Irish importers do
  fill `tuition_noneu` where a page happens to print it, because it costs
  nothing to keep.
- **The Irish fee recorded is the Free Fees figure: student contribution plus
  that university's levy.** This reverses what this file said until 2026-08-21,
  and the reversal matters more than most entries here.

  The earlier reasoning was that Free Fees needs three years' residency *in
  Ireland*. It does not. Every university states the same test — UCD: "ordinarily
  resident in the EU/EEA/UK/Swiss Confederation for a minimum of 3 of the 5 years
  prior to commencing", with place of residence deemed to be **place of
  education**; Trinity words it identically. A Slovak student who has been at
  school in Slovakia meets it. Galway says so plainly on every course page:
  "Most EU students applying through the CAO will be eligible for the Free Fees
  Initiative."

  So the State pays the tuition column, and the bill is:

  | | 2026/27 |
  |---|---|
  | Trinity | €2,814 (€2,500 + €314 SLC) |
  | UCD | €2,754 (€2,500 + €254 levy) |
  | UCC | €2,710 (€2,500 + €210 capitation) |
  | Maynooth | €2,650 (€2,500 + €150 levy) |
  | Galway | €2,640, and €2,840 on five courses whose levy is €340 |
  | UL | €2,604 (€2,500 + €104 levy) |
  | DCU | €2,543 |

  The larger "EU fee" each university also prints — Galway's "Total EU Fee",
  DCU's "EU Status Fee", UL's "EU fees per year" — is the rate for EU applicants
  who do *not* qualify. Recording those overstated the cost by three to five
  thousand euro a year and would have steered someone away from Ireland on a
  false comparison. **Do not take the larger number just because the page labels
  it "EU".**

  A useful side effect: this closed the UCD gap. UCD never publishes the full EU
  fee, but it does publish the contribution and the levy, which is all this
  cohort actually pays.
- **Irish points are last year's demand-driven cutoffs**, not minimums. The
  card says which a figure is (points-honesty batch, 2026-10-26): a published
  minimum reads "36 IB points" with "minimum" beside it; a converted cutoff
  reads "≈ 37 IB points" with "Round 1 cutoff, 2026" beside it, one line per
  CAO round. Conversions assume the HL Maths bonus only when nothing else
  reaches the cutoff (601–625, no test), and the card then says "with HL
  Maths 4+" (decided 2026-10-25). The one exception is UCD, which publishes an
  IB total it will accept, so UCD's numbers are real minimums and its cutoff
  sits in the note instead.
- **Irish cutoffs above 625 include a test score** (HPAT or audition), so they
  are never turned into an IB figure or used to hide a course. HPAT Medicine
  shows the CAO's 480-point minimum (35 IB) instead (decided 2026-10-25).
- **Cutoffs come from the CAO, not from the universities' own pages.** Only the
  CAO says what a cutoff *meant*: `AQA` (everyone qualified got in, so there was
  no cutoff at all), `#` (a test, interview, portfolio or audition also
  applied), `*` (not everyone on that score got a place — ties went to random
  selection). A bare number without those markers misleads. The CAO also
  publishes Round 2, which is lower than the Round 1 figure universities tend to
  advertise: UL's own page says 499 for Psychology, the CAO's Round 2 says 496.
  Both rounds are quoted now (decided 2026-10-26, below), Round 1 first.
- **Where several programmes share one CAO code, every row says so.** UL's
  LM116 is "Engineering (Common Entry)" and covers Civil, Biomedical and the
  rest; UL's LM002 Arts covers every Arts subject; UCD's DN250 covers three
  agriculture degrees. You apply to the code, not the programme, so the cutoff
  belongs to the code. 180 rows carry that sentence.
- **Graduate-entry courses are left out** (decided 2026-10-25). They need a
  first degree, and this site is for school-leavers, the same reasoning as
  dropping degrees that need Dutch. The Irish importers skip any title with
  "graduate entry".
- **A college or degree is listed once** (decided 2026-10-25). Amsterdam
  University College appears only as `uva-auc`; its note says it is run jointly
  by the UvA and VU Amsterdam. Leiden Political Science appears only as the
  English-taught `lei-iro`; the other track is Dutch-taught. The search no
  longer finds AUC under "VU" (an alias column, registry S01, would fix that).
- **UvA's headline deadline is the general 1 May date** (decided 2026-10-25).
  The 1 April date is only for EU/EEA students with a non-Dutch diploma who want
  UvA housing, so it sits in the note ("Want UvA housing? Apply by 1 April 2027
  instead.") rather than on the card's date. A nicer display of housing dates
  would be part of application milestones (registry F03).
- **The Google Sheet is not planned for now** (decided 2026-10-25). The site
  reads the two CSV files in `data/`. The Sheet instructions in
  MAINTENANCE.md describe how it would work if it is connected later.
- The **UK is excluded**: post-Brexit, EU students pay international fees of
  roughly £25,000–38,000, so it is not a realistic option for this cohort.

## Country notes worth keeping

- **Netherlands** admits on *subjects*, not totals — only 2 of 197 Dutch rows
  have a points minimum, and that is correct, not missing data.
- **The HPAT list goes stale each cycle.** `HPAT_CODES` in
  `tools/lib/ireland.mjs` holds the CAO codes of the courses ACER lists on
  hpat-ireland.acer.org (undergraduate Medicine only, checked 2026-10-25).
  Re-check it every year before trusting an importer rerun.
- **UCD Medicine (DN400) and UL Undergraduate Entry Medicine (LM301) are
  hand-added rows** (2026-10-25). UCD's DN400 page has no IB requirements
  block, so `import-ucd.mjs` skips it and a rerun would drop `ucd-medicine`;
  both rows leave `ib_subjects` blank because neither page states an IB subject
  list. Keep them when merging an importer run. `check.mjs` fails if a row for
  any `HPAT_CODES` code goes missing, and `update-cao-points.mjs` keeps their
  cutoffs current.
- **Ireland** publishes a CAO cutoff per course and an official IB conversion,
  which is why 542 of the 548 Irish rows have a number. It also issues **no
  conditional offers** — decisions arrive mid-August.
- **Where each Irish university hides its data**, since finding this again was
  most of the work: UCD's course list is drawn by JavaScript from an internal
  reporting endpoint and its plain HTML carries no list at all (the importer
  replays the query token the course browser itself sends, and fails loudly if
  UCD rotates it). UCC encodes the CAO code in the URL (`/en/ck101/`). Galway
  links every course twice, once under its title and once under its CAO code.
  UL's index mixes degree pages with subject pages; only the code separates
  them. UCD and Maynooth answer `403` to a bare Node fetch, so every request
  carries a browser user-agent.
- **And where each hides its fees**: UCC and Maynooth publish one schedule for
  every course, keyed by CAO code — UCC as an HTML table, Maynooth as a PDF
  (which is what `tools/lib/pdf.mjs` reads). DCU and UL print the fee on each
  course page. Galway prints one figure for all courses. UCD publishes nothing
  readable. Maynooth's PDF link carries a version and date in its filename and
  is discovered from the fees page, never hardcoded — it was already at V.2
  while search engines still pointed at V.1. Two rows in that PDF have parts
  that do not sum to their stated total, and those are skipped rather than
  recorded wrong.
- **Denmark** was investigated and set aside: the University of Copenhagen
  teaches every bachelor in Danish, and the English-taught undergraduate
  offering is thin and split across seven institutions.
- **Czechia** — added 2026-10-24, big five only. Czech-taught study at a
  public university is free, Slovaks included ("Na české vysoké škole neplatíš
  školné", Masaryk's page for Slovak applicants). English-taught study is
  charged, mostly in CZK; the importers convert at the ČNB rate on the day and
  keep the koruna figure in the note. Admission is by **faculty entrance exam**
  (Masaryk's TSP, Scio NSZ tests, subject tests), often waivable — so Czech rows
  have no `ib_points_min` and the `admission` column carries the real hurdle.
  Charles's English-taught medicine and science programmes waive the exam for
  strong IB results (e.g. 1st Faculty: IB 36+ with 13+ from two HL sciences);
  Masaryk ECON's English bachelors ask for IB 28+ with Maths 4+ but **only
  final results count**, so with a 30 April deadline an IB student needs a Scio
  test instead. A Slovak maturita is accepted as it is under the Czech–Slovak
  equivalence agreement; Masaryk also states an IB Diploma is submitted as is.
  Charles's Faculty of Arts and medical faculties ask for proof of Czech or
  Slovak — a Slovak-language maturita exam is the first route listed.
- **Where each Czech university keeps its data**: Masaryk — eleven category
  pages plus a uniform programme page with a `#prijimaci-rizeni` section.
  Charles — `nakarlovku.cz/search.php` (JSON, needs the session cookie its own
  page sets) and the SIS admissions record per programme, which has the
  deadline, places, fee and "Způsob ověření". VUT — its e-application lists
  what is open for 2027/28; a green "do" date is a deadline, a yellow "od" date
  only an opening. VŠE and ČVUT — no central source; one table per faculty in
  the importer. cvut.cz serves an incomplete certificate chain, so that importer
  runs with `node --use-system-ca`; prihlaska.cvut.cz did not answer at all.

## Running it

```bash
node tools/serve.mjs            # then open http://localhost:8765
node tools/check.mjs            # must end "All checks passed"
node tools/check-contrast.mjs   # every text colour vs its real background
node tools/make-snapshot.mjs    # rebuild data/fallback.json after data changes
```

**Use `tools/serve.mjs`, not `python -m http.server`.** Python's server sends no
`Cache-Control` header at all, only `Last-Modified`, and with no Cache-Control a
browser falls back to heuristic caching and can serve a stale file without
revalidating. That is not hypothetical: after the dark palette was deleted, the
server was serving the new stylesheet and Brave was still painting the old one.
Adding `?v=N` to the page URL does not help, because the stylesheet is a separate
request with its own cache entry. `serve.mjs` sends `no-store` on everything, so
a reload always shows what is on disk. It is a development server only — no-store
on every response would be wrong in production, and GitHub Pages sets its own
sensible headers. It listens on this computer only (127.0.0.1) and refuses
hidden paths such as `.git/`: the first version listened on every network
interface, so anyone on the same Wi-Fi could download the repository (X02). To
try the site on a phone, use the live site or a deliberate tunnel, not this.

Run `check-contrast.mjs` after **any** change to a colour token. It reads the
token blocks out of `css/styles.css` — so it cannot drift from the real palette
— and checks each foreground against the background it is genuinely painted on.
It caught `--save` at 3.63:1 on white the first time it ran, which a careful
manual sweep had missed because that element had only ever been measured against
the dark palette that no longer exists. If it fails, darken the foreground or
lighten its background; do not lower the minimum.

The importers are one-off and already run; their output is merged into
`data/programmes.csv`. Re-run one only to refresh a university:

```bash
node tools/import-ucd.mjs       # writes tools/ucd-rows.csv, does not merge
```

`tools/lib/cao-points.mjs` parses the CAO's Level 8 points table and is shared
by all seven. `tools/lib/pdf.mjs` is the PDF text extractor that used to be
`pdftext.mjs`; the command-line tool still works and now wraps it. `tools/lib/irish-import.mjs` is the whole flow for the five
cutoff-only universities, so `import-ucc.mjs` and its siblings are just a list
URL, a link pattern and a CAO-code pattern. Two stand alone: `import-ucd.mjs`,
because UCD publishes an IB minimum outright, and `import-tcd.mjs`, because
Trinity states a subject requirement per course and hides some of them on
parent pages.

Never open the CSVs in Excel — see MAINTENANCE.md.

**Speed (L09, still open).** The target is under 150 ms from a filter change to
the new rows on screen, on a laptop slowed four times. Measured 2026-10-28 on
an M1 MacBook Air, headless Chrome 156, 1280 × 900, the real 1240 rows: untick
Ireland so every row is redrawn, five warm-ups then 20 timed changes, before
and after in alternating blocks. `update()` alone took a median 748 ms before
and 600 ms after (every sample over 150 ms; the second animation frame after
it, a ceiling on the first paint, 972 and 954 ms). Two fixes went in: the pane
no longer forces a layout of all 1240 new rows by reading its scroll position
after they are drawn, and `points.js` is preloaded, so the CSVs are requested
one round trip sooner on a cold load. What is left is building and inserting
1240 rows, which needs a different approach (drawing only the rows on screen)
and its own plan. The harness rewrites app.js in flight to time it, so nothing
is added to the site: `plans/finish-review/l09.mjs`.

The October 28 visual revisions keep L09 open. A new paired run on the same
1240 rows in headless Chrome 156 at 4× CPU (20 samples per revision) compared
45907a1, before the filter changes, with the integrated revisions: synchronous
medians 517 → 383 ms; second-frame medians 816 → 622 ms. Every sample missed
150 ms. These are measurements, not a performance fix or final design approval;
raw timings and environment are in `plans/design-round2/phase3-l09.json`.

The October 31 fix is in, but L09 stays open: it met the strict target on one
day and missed parts of it on another (below). A filter change draws only the first screenful of rows (at
least 40) at once and adds the rest just after, so every row still ends up on
the page. Opening a row, the wide-screen pick, keyboard focus, switching between
narrow and wide, and printing all work as before. Printing first adds any rows
still waiting.

A follow-up on November 1 made two changes. Each batch of rows added after
the first screen now stops after 8 ms, however slow the machine, instead of
always adding 20 rows. And the first draw after a reload or Back draws every
row again, as before, so a reload halfway down the list comes back to the same
place (it had been landing near the top).

Measured on November 1 on an M1 MacBook Air with headless Chrome 156. Settings:
four times slower CPU, 20 timed changes per width, before and after in
alternating blocks, each block run only when the machine was quiet. The
numbers are the time until the new rows reach the screen (median / 95th
percentile):
- 1280 px: 127 / 153 ms in normal Chrome (one sample of 388 ms; the rest
  under 150), and 126 / 134 ms with Chrome's AI features turned off. Before:
  580 ms. A trace of the frames shows the first new screen at about 100 ms.
- 390 px: 129 / 133 ms, and 127 / 141 ms with AI off. Before: 573 ms.
- 1920 px: **157 / 176 ms, and 154 / 160 ms with AI off. This misses the
  target.** Before: 625 ms.

The same tests were run again on November 2, on the same laptop with the same
scripts and settings, but plugged in (on November 1 it was on battery, late at
night). Everything ran about 1.8 times faster, the old version too, so the
laptop itself was faster that day; the code was the same. This time every
case met the target, with no pause of 50 ms or more while the rest of the
rows went in (80 changes):
- 1280 px: 70 / 80 ms, and 68 / 73 ms with AI off. Before: 314 ms.
- 1920 px: 90 / 96 ms, and 86 / 92 ms with AI off. Before: 348 ms.
- Ticking Ireland (1,240 rows down to 548): 110-123 ms in normal Chrome and
  109-133 ms with AI off. Before: 198-223 ms.
The new version takes about a quarter of the old version's time on both days.
Whether L09 passes therefore depends on how fast the laptop happens to be
running, and nobody has yet decided which state counts.

What is still missing:
- **A fixed yardstick.** The target says "a laptop slowed four times", but the
  same laptop gave results 1.8 times apart. Before L09 can be closed, someone
  has to decide what to measure against (for example, plugged in, or a
  stronger slowdown that stands for a slow phone, or a limit relative to the
  old version).
- **1920 px on the slower day was over 150 ms.** Almost all of the time goes on
  removing the old rows from the page (about 85 ms at four times slower that
  day). Every way of removing them costs the same. The ways that avoid it
  either push that cost into a later pause of 94-272 ms, shift the page by
  16-96 px when you are deep in the list, or reuse old rows. Reusing rows
  risks showing an out-of-date points verdict, and the plan rejected it.
  Fixing this, if the yardstick needs it, needs a new plan.
- **Ticking a filter that removes many rows was well over 150 ms on the slower
  day.** For example, ticking Ireland takes 1,240 rows down to 548. It took
  about 280-320 ms in normal Chrome and 200-240 ms with AI off (before:
  357-420 ms), because it removes 1,240 rows. The target was only ever set for
  the other direction.
- **Short pauses while the rest of the rows go in, on the slower day.** About
  one change in ten had a pause of 54-96 ms (at four times slower). This is the
  browser's memory clean-up of the removed rows, which smaller batches cannot
  shorten. It still counts against the site.
  Rarely, the frame right after the last rows go in took 60-130 ms.
- **Chrome's own AI page reader** reads the whole page for 1.2-1.9 seconds
  about a second after every change. Leon decided on October 31 that this
  is Chrome's work and does not count against the site. It is still reported
  here. It happens only when Chrome's AI features are on.

Two small differences remain. When you change a filter at the very end of the
list, the page settles at a slightly different spot than before (sometimes
higher, sometimes lower). After pressing Down past the first screen, the list
ends a little higher than before. Raw timings, traces and scripts are in
`plans/l09-impl/` and `plans/l09-fix/`.

To watch the motion, open the site with `serve.mjs` and turn on "Reduce
motion" in the operating system: every effect must then happen at once. To
check print, use the browser's print preview with a few rows open.

## The GLM re-check (2026-08-20), verified 2026-08-21

A second model re-checked all 757 rows against official pages and left a report
here. It was worth having — most of it holds up. It was **not** taken on trust:
every claim it made about our own CSVs was checked against the CSVs, and the
claims worth acting on were checked against the university pages. This section
is what survived that, so nobody re-litigates it.

### Its one systematic error: the "unverifiable 403" tier

It reported UCD (140 rows), Maynooth (64) and Tilburg (9) as unreachable —
"fees pages return 403 to all automated access" — and set them aside. They are
not unreachable. They answer 403 to a bare fetch and **200 to a fetch carrying a
browser user-agent**, which is the trap already documented two sections up under
"Where each Irish university hides its data". Anything built on that tier should
be re-checked rather than believed.

The UCD fee gap is real anyway, but for the other reason in job 3: the page
loads fine and simply publishes nothing where it promises tables.

### Confirmed against the official pages, and fixed

- **Galway fees vary by course.** The single €5,738 / €19,890 default was right
  for exactly **1 of 54** courses. Every Galway course page carries its own fee
  table, and the parts sum to the stated total on all 53 that have one. Science
  €7,408, Law €6,733, Nursing €7,246, Allied Health €8,208, Arts/Commerce
  €5,738, and more. Per-course figures are now on the rows and the university
  default is blank, because no single figure is correct. (The report said "~26
  rows"; it is all of them.)
- **Groningen recorded the wrong intake's deadline.** `rug-dss`, `rug-grl` and
  `rug-ucg` carried the February-intake date. Groningen publishes a deadline per
  intake — 1 January for February, **1 May for September** — and September is
  the intake an IB student finishing school in May applies for. Fixed, with the
  distinction written into the note. `rug-psy` was already right at 15 January,
  because a numerus fixus programme has a single date.
- **Utrecht PPE charges €5,388**, not the €2,694 statutory fee it was
  inheriting. Stated outright on the programme page. Fixed.
- **Tilburg Psychology and Twente Psychology are numerus fixus** — 700 and 250
  places, both stated on their pages — so the statutory 15 January selection
  deadline applies. Tilburg's was blank and Twente's said 1 May. Both fixed.
  Tilburg's page also requires mathematics without giving IB levels, which is
  now recorded as such.
- **VU PPE**: the page gives 15 June for EU students, not the 15 January
  recorded. Changed, but flagged in the note — VU described it as an *extension*
  for the 2026 intake, so 2027 needs confirming.
- **DCU physics fees.** Three rows were blank; the other programmes under the
  same CAO code all publish €6,679 / €16,900, so the rows now carry it. (The
  report said six rows; two of the six already had fees.)
- **`vu-cis` really was a dead link.** The `/admissions` page 404s; the
  programme page without it resolves. Fixed.

### Wrong, and left alone

- **`uva-hgp` and `uva-sociology` are not broken.** Both return 200. Only
  `vu-cis` of the three was real.
- **Twente is worse than reported, not better.** It said 13 of 15 programmes
  carry 1 May; all 15 do.

### Chased down afterwards, with a browser

The remaining items were left open because the pages render their content with
JavaScript or block a bare fetch. Driving a real browser — and, for Leiden,
fetching from inside the page's own origin so its bot protection saw a normal
session — settled almost all of them.

- **Twente's deadline is 1 July, not 1 May.** Its table is by nationality, not
  by programme: 1 July for EEA nationals in the September intake, 1 May for
  non-EEA. Thirteen rows moved. Two exceptions are real: Technical Computer
  Science closes in Studielink on 1 May because matching is mandatory, and
  Psychology is 15 January. Advanced Technology and Mechanical Engineering are
  listed among the programmes with deviating deadlines but publish no separate
  EEA date, so they carry 1 July with that flagged in the note.
- **Fourteen Leiden deadlines recovered.** Leiden publishes one table per
  programme: 1 May for direct admission and for internationals who need no visa,
  1 April only for non-EU visa applicants. Psychology is 15 January, a numerus
  fixus. Archaeology's deadline page 404s and University College's did not
  render a table, so those two stay blank and say why.
- **UvA PPLE closes 1 February**, not 15 January — applications open 1 October.
- **Wageningen Tourism does require Mathematics.** The row said `none`. WUR's
  table of required subjects by programme lists it, and it is the same table
  every other Wageningen row here came from.
- **Erasmus University College required far more than `none`**: 30 points
  excluding TOK, EE and CAS; maths at AA HL 4 / AA SL 5 / AI HL 5, with AI SL
  accepted only alongside an OMPT-A test; English at A SL 5 / A HL 4 / B HL 5;
  and achieved grades only, no predicted grades.
- **The two Utrecht colleges were the other way round.** The report gave €4,845
  to University College Utrecht and €5,591 to Roosevelt. It is the reverse:
  Utrecht €5,591 (2026/27), Roosevelt €4,845 (still a 2025/26 figure). Taking
  the report at its word would have put the wrong fee on both.
- **University College Groningen** is €5,343 EU / €17,200 non-EU, as reported.

### One report claim that was itself wrong

**TU/e's non-EU fee should stay at €19,200.** The report called 19,200 an error
and asked for €18,600. TU/e's page publishes both: €18,600 for 2026-2027 and
**€19,200 for 2027-2028**. This dataset is for September 2027 entry, which is
the 2027-2028 academic year, so 19,200 is the right number and "fixing" it would
have introduced the error.

Worth knowing more generally: the Dutch statutory fee of €2,694 on every Dutch
row is the 2026/27 figure, because 2027/28 is still "t.b.a." on TU/e's page. The
EU numbers are therefore a year behind the non-EU one, and will rise.

### Still open

- **UCD's fees**, 140 rows, for the reason in job 3 — the page publishes nothing.
- **VU Law in Society's deadline.** The programme is selective and its admissions
  page carries no date at all.
- **Leiden Archaeology and Leiden University College deadlines**, above.
- **UL's fee oddities** — history €17,492 and music-and-dance €17,495 against
  €17,500 on their siblings, and Japanese blank. These are what the pages say;
  they look like UL's own rounding rather than a scraping fault.
- **TCD and UCC English A grades**, and the **non-EU tuition defaults** for
  Groningen, UvA, VU, Twente and Tilburg. Nothing reads the non-EU columns.
