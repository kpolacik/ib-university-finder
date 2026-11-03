# Looking after this site

You do not need to know how to code. Everything below happens in a Google
Sheet, in your browser.

**Today the Google Sheet is not connected, and there is no plan to connect it for
now.** The data is the two CSV files in the `data/` folder, edited in a plain
text editor (never Excel) and saved with Git. The sections below describe how
the Sheet would work if it is connected later.

If you take one thing from this document: **this site is only as trustworthy as
the person who last checked it.** Somebody may plan their application around a
deadline on this page. That is the whole reason for the `last_verified` and
`official_url` columns, and why the site refuses to show a card without them.

> **Before you commit**
>
> Run `node tools/check.mjs` and `node tools/lint-data.mjs`. Fix every error;
> read each warning and leave it only if the data is right. Add `--all` to see
> every row, or `--against ORIG_HEAD` after a merge to compare with the fork's
> previous ids. The lint only reads files. For the browser smoke test, see
> [Rebuilding the offline copy](#rebuilding-the-offline-copy) below.

---

## The Sheet

Two tabs. Everything else follows from this.

| Tab | One row per | Why |
|---|---|---|
| `universities` | university | City, country, living cost, default tuition — typed once |
| `programmes` | programme | The degree itself, its requirements and its deadline |

Charles faculty names come from the official SIS link; every Charles card shows the faculty; same-name cards elsewhere show, where the recorded facts do not distinguish entries, a catalogue-entry number to help readers compare official pages.

Country badges use a named tint for each of the 11 data countries in `css/styles.css` (pairs checked by `tools/check-contrast.mjs`); any new country gets a neutral badge automatically, and its full name always stays visible.

A programme is linked to its university by putting the university's
`university_id` in the programme row. Get that wrong and the row will not
appear — the site will tell you, at the bottom of the page.

### Set this up before typing anything

Select the `application_deadline` and `last_verified` columns on both tabs and
choose **Format → Number → Plain text**.

If you skip this, Google rewrites `2027-01-15` into whatever date format your
account uses and exports `15/01/2027`. The site copes, but it will nag you at
the bottom of the page until you fix it. Easier to never create the problem.

---

## Adding a university

Only if it is not already on the `universities` tab.

| Column | What to put | Example |
|---|---|---|
| `university_id` | Short, lowercase, no spaces. **Never change this later.** | `tu-delft` |
| `name` | Full official name | `Delft University of Technology` |
| `city`, `country` | | `Delft`, `Netherlands` |
| `application_system` | How you apply | `Studielink`, `UCAS`, `CAO`, `direct` |
| `living_cost_min`, `living_cost_max` | Monthly living costs in EUR, rent included, as a range. One figure? Put it in `min` and leave `max` blank. Leave both blank if unsure | `900`, `1200` |
| `living_cost_source` | A few words saying whose estimate it is — the card shows it after the range | `university's estimate` |
| `tuition_eu_default` | Normal EU fee, in EUR | `2694` |
| `tuition_noneu_default` | Non-EU fee. **Optional** — nothing on the site reads it | `20200` |
| `baseline_requirement` | What any diploma must clear here, before programme-specific rules | `a school diploma equivalent to Dutch VWO` |
| `english_requirement_default` | The usual requirement here | `IELTS 6.5` |
| `admission_default` | How places are decided, **only if it is the same for every course** here. Otherwise blank | `Places offered in order of CAO points` |
| `student_life_url` | Student union page or city subreddit | |
| `last_verified` | Today's date, `YYYY-MM-DD` | `2026-09-14` |
| `verified_by` | Your initials | `JP` |
| `aliases` | Short names and native names people search for, separated by ` · `. **Only names the university uses itself** on its own site. Search reads it; the card does not show it. Can be blank | `UvA · Universiteit van Amsterdam` |

## Adding a programme

| Column | What to put |
|---|---|
| `programme_id` | Short, lowercase, unique. **Never change this later.** e.g. `tud-cse` |
| `university_id` | Must match a row on the `universities` tab exactly |
| `city` | **Leave blank** unless this programme is taught somewhere other than the university's home city |
| `programme` | The degree name as the university writes it |
| `degree_type` | `BSc`, `BA`, `LLB`, `MD` |
| `subject_area` | From the list below. Several allowed, separated by `;` |
| `language` | Language of teaching. Several allowed, separated by `;` |
| `ib_points_min` | **A number only**, or blank. Never `34-36`, never `34 (typical)` |
| `ib_subjects` | Subject requirements only. Type `none` if the university says there are none. **Leave blank if you haven't checked** |
| `ib_maths` | Which IB maths courses the programme accepts, separated by ` · `, from `AA HL`, `AA SL`, `AI HL`, `AI SL`. `none` = no maths requirement. `?` or blank = not known. Drives the "My maths" filter. See below |
| `other_requirements` | Anything else you must do, separated by ` · `. See below |
| `admission` | How places are decided, separated by ` · `. Blank uses the university's `admission_default`; `?` means unknown. See below |
| `entrance_exam` | `yes`, `waivable`, `no`, or `?`/blank for not known. Drives the "Entrance exam" filter. See below |
| `application_system` | **Leave blank** unless this programme is applied for some other way than the rest of the university. `?` means unknown. It is the last column in the sheet. See below |
| `tuition_eu` | **Leave blank** unless this programme differs from the university default |
| `tuition_noneu` | Optional — the site does not display it. Skip it unless someone asks for non-EU fees |
| `english_requirement` | Leave blank unless it differs from the university default |
| `application_deadline` | `YYYY-MM-DD` |
| `deadline_notes` | Anything that makes the date make sense |
| `official_url` | Direct link to the admissions page. Must start with `https://` |
| `last_verified`, `verified_by` | Today's date and your initials |

### The requirement columns

A card shows five kinds of requirement, and only the ones that apply:

| Column | Example |
|---|---|
| `admission` | `Entrance exam: TSP aptitude test · Exam can be waived on set criteria` |
| `ib_points_min` | `30` — most Dutch universities publish nothing here, which is fine |
| `ib_subjects` | `Maths AA HL + Physics HL required` |
| `ib_maths` | `AA HL` |
| `other_requirements` | `Numerus fixus (440 places) · Selection exam` |
| `english_requirement` | `IELTS 6.5 · or English B HL 6` |

**`ib_subjects` has three states, and mixing two of them up is the worst
mistake you can make on this site:**

| Cell | Card shows | Means |
|---|---|---|
| `none` | "None required" | The university states there are no subject requirements |
| *(blank)* | "Not checked yet" | Nobody has looked — **not** the same thing |
| text | the text | These are the requirements |

Blank means "not checked" on purpose. If you forget to fill a cell in, the card
admits it rather than telling someone there is nothing to meet.

**`ib_maths`** is the machine-readable half of the maths line in `ib_subjects`,
so the "My maths" filter can hide what a student's course doesn't qualify for.
List every course that is accepted, not just the minimum:

| `ib_subjects` says | `ib_maths` |
|---|---|
| Maths AA HL | `AA HL` |
| Maths AA SL/HL or AI HL | `AA HL · AA SL · AI HL` |
| Maths HL 5 (any course) | `AA HL · AI HL` |
| Maths SL 4 or HL 3 (any course) | `AA HL · AA SL · AI HL · AI SL` |
| no maths requirement | `none` |
| "Mathematics required", no IB course given | `?` |
| HL Maths is one of several options ("Chemistry plus Biology, Physics or Maths at HL") | `?` |

Write `none` only when maths isn't needed at all. Keep `none` when maths is
just recommended, only lets you skip an entrance exam, only counts as a GCSE
equivalent, or applies only to one sub-subject. `node tools/lint-data.mjs`
warns when `none` sits next to a named maths course.

Grades stay in `ib_subjects`; `ib_maths` is only about the course and level.
`?` and blank never hide a programme — the card says so instead. A misspelt
course shows up under "spreadsheet problems" and is treated as unknown.

**`entrance_exam`** answers one question: will I have to sit something?

| Cell | Card shows | Means |
|---|---|---|
| `yes` | "Entrance exam or test" | Every applicant sits one: a selection test (online or not), Scio/TSP, CEnT-S/TOLC/SAT, HPAT, a talent exam or an audition |
| `waivable` | "Entrance exam — some IB applicants can skip it" | There is one, but it can be waived on IB points or grades, or only applies if your maths falls short |
| `no` | "No entrance exam" | Grades, documents, letters, interviews, portfolios, matching or a lottery only |
| `?` or blank | "Not checked yet" | Nobody has checked — never hidden by the filter |

Interviews, portfolios, motivation videos and matching are not exams. A test
you can only sit to *add* to your chances (SDU's uniTEST for IB holders, who
already compete on converted grades) is `no`. Write the exam itself in
`admission` or `other_requirements` as before; this column is only the yes/no.

**`other_requirements`** is for hurdles beyond grades — separate each with ` · `
and keep them short, they render as chips:

`Numerus fixus (330 places)` · `Selection exam` · `Motivation letter` ·
`Interview` · `Entrance exam` · `Application fee` · `Matching form (mandatory)` ·
`Places allocated by unweighted lottery`

Leave it blank when there is nothing extra — most programmes have nothing.

**`admission`** says how the place is actually decided, which is not the same
in every country and changes what every other number on the card means. Keep to
the wording already in use so the cards read alike:

`Open entry: meet the requirements, get a place` · `Numerus fixus: limited places` ·
`Selective: assessed on your application` · `Places offered in order of CAO points`
(set once on each Irish university) · `Entrance exam: …` · `Scio test` ·
`Exam can be waived on set criteria`

Czech universities admit by entrance exam, not IB points, so a Czech row's
`ib_points_min` is blank and `admission` carries the real hurdle. Mark anything
that comes from last year's rules with `(2026 rules)`.

**`application_system`** on a programme row is for the rare course you apply
to some other way than the rest of its university. Bocconi's World Bachelor in
Business, for example, goes through the Common App (choose USC, then WBB), not
Bocconi's own portal. Blank uses the university's `application_system`, the way
blank `admission` uses `admission_default`. `?` means "it differs, but we don't
know how", and the card then leaves out "Apply via" rather than guess.

**Put IB English grades in `english_requirement`, not `ib_subjects`.** A student
looking for "what English do I need" looks at the language line.

### Subject areas

Pick from this list so the filters stay tidy. Use `;` between several.

`Engineering` · `Computer Science` · `Mathematics` · `Physics` · `Chemistry` ·
`Biology & Life Sciences` · `Environmental Sciences` · `Medicine & Health` ·
`Psychology` · `Economics` · `Business & Management` · `Law` ·
`Politics & International Relations` · `Sociology & Anthropology` · `History` ·
`Philosophy` · `Languages & Literature` · `Media & Communication` ·
`Art & Design` · `Architecture` · `Education` · `Liberal Arts` · `Sports Science`

`Liberal Arts` is for university-college programmes where you build your own
curriculum, so no single subject describes them. Never use it as a guess.

A blank cell shows as Unclassified. An unknown word is flagged in the page's
issues list and shown as Unclassified; these rows stay visible under any
subject filter. Old names such as Finance are translated automatically, but
use the list above for new rows.

Set these as a dropdown: select the column, **Data → Data validation**, paste
the whole list, including Sports Science. It helps prevent typos.

---

## The rules that matter

**Blank is not zero.** A blank tuition cell means "use the university's
default". A `0` means the course genuinely has no fee. The site shows these
differently — "No tuition fee" is a real statement — and getting them backwards
is misleading in a way that matters.

**UK rows hold the international fee.** `tuition_eu` is what an EU student pays.
For the UK that is the international fee, not the Home fee, because EU students
have paid it since August 2021 (Irish citizens and settled status are the
exceptions; say so in the note). The sterling figure stays in the note.

**Use `?` when the default is wrong but you don't know the right number.**
There are three things a tuition cell can say:

| Cell | Meaning |
|---|---|
| *(blank)* | Same as the university's default |
| `?` | **Different** from the university, but we haven't found the figure |
| a number | This programme's own fee |

This matters most for university colleges. University College Maastricht
charges €4,465 against Maastricht's standard €2,694 — but University College
Venlo charges the standard rate, so you cannot assume. If you know a programme
is an exception and haven't checked the number, put `?` and the card will say
"Not published" instead of confidently showing a fee that is nearly half the
real one. `?` works the same way in `tuition_noneu` and `english_requirement`.

**`baseline_requirement` is per country, so it lives on the universities tab.**
When a programme is confirmed to have no IB subject requirements and no other
requirements are recorded, the card says "No IB subject requirements. General
requirement: ___. Language requirement not checked yet." It fills the blank
from this column, capitalising the first letter. The Netherlands measures every
foreign diploma against VWO; other countries do not, so adding a German or Czech
university means writing its own baseline there. Leave it empty and the card
falls back to "a qualifying secondary school diploma", which is true anywhere.

**Fill in `city` only for satellite campuses.** Most programmes are taught in
the university's home city, so leave it blank. But University College Roosevelt
is in Middelburg, not Utrecht; Leiden teaches three programmes in The Hague;
Groningen teaches two in Leeuwarden. Put the real city there and the card — and
the search box — will use it.

**Never edit an `id` once the row exists.** The id is how the two tabs are
joined and how a programme is referred to elsewhere (every student's saved
list, and every shared `?list=` link, stores programmes by id). Change one and anything pointing
at it silently points at nothing. Renaming a university is fine. Fixing a typo in
a name is fine. Changing the id is not.

**Only write in `ib_points_min` what the university actually publishes.** Many
do not publish a number at all — this is normal, especially in the Netherlands,
where admission runs on required subjects rather than a total score. Leave it
blank and put the real requirement in `ib_subjects`. The card will say
"Points not published", which is honest and useful. A number copied from a
commercial university-comparison site is not a fact, and it is exactly the kind
of thing that makes someone apply for a course they cannot get into. The one
exception is HPAT Medicine in Ireland: there the figure is the CAO's published
480-point minimum (35 IB points), which applies to every HPAT course.

**The CAO sentence in Irish notes is written by the refresh, not by hand.**
"2026 CAO cutoff: Round 1 510 points, Round 2 495 points (code TR028)." means
the CAO's cutoff was 510 points in its first round of offers and 495 in its
second (later, lower) round; a course with no second round names only Round 1.
"Some applicants on that score missed out in Round 2 (random draw)." means not
everyone on exactly that score got a place in that round. The IB figure is the
conversion of the latest round. `tools/update-cao-points.mjs` rewrites these
sentences each August, so don't edit them; anything else in the note is kept.

**Some Irish notes contain a sentence the card reads.** When an Irish row's
`deadline_notes` contains exactly "Only reachable with the 25 HL Maths bonus
points.", its figure assumes the 25 bonus points, and the card's cutoff line
for that round ends "with HL Maths 4+". That sentence belongs only on rows whose figure assumes the 25 bonus points (a
CAO cutoff of 601 to 625 with no test). Two more work the same way:
"The CAO minimum for Medicine is 480 points; places then go on points plus the
HPAT test, so last year's cutoff is not an IB figure." makes the card say "35 IB
points, then ranked with the HPAT", and "Above what any IB total can reach,
because the cutoff includes test or audition marks, so no IB figure is given."
(with `ib_points_min` blank) makes it say "Cutoff includes a test score". Keep
all three word for word: `check.mjs` complains if one is changed, missing or on
the wrong row.

**Keep `Test, interview, portfolio or audition` in an Irish row's
`other_requirements`**, even when a more specific label sits next to it
("Audition · Test, interview, portfolio or audition"). It is not a duplicate:
it is the CAO's "#" mark, and the site reads that exact tag to know a cutoff
may include test marks, which decides the IB figure and the HL Maths bonus.
The CAO refresh (`tools/update-cao-points.mjs`) writes it.

**The card says what kind of points figure it is.** You do not fill this in;
the site works it out:

- An Irish course (not UCD, not HPAT Medicine) whose note has the CAO sentence
  shows last year's cutoff, one line per round, Round 1 first: "≈ 37 IB points,
  Round 1 cutoff, 2026". "≈" because it is the IB equivalent of a CAO points
  figure, not a number the university published. A round no IB total reaches
  says why instead ("Round 1 cutoff, 2026: not an IB figure (includes a test
  score)").
- Every other row with a figure shows it as a minimum: "36 IB points, minimum".
  That includes UCD (its own published IB minimum) and HPAT Medicine ("35 IB
  points, then ranked with the HPAT").
- A row with `ib_points_min` blank says "No minimum published" (or "Cutoff
  includes a test score", as above).

A later column will say this directly (plans/backlog/points-value-kind.md).

**`verified_by` is a signature.** Put your initials there only if you personally
opened `official_url` and read it. If a row says `AI-DRAFT`, it was gathered
automatically and nobody has confirmed it — the site says so in a banner at the top
and shows no "checked" line on that card.
Replacing `AI-DRAFT` with your initials is how you sign it off.
Signing a programme means you checked everything its card shows, including the
values it takes from the university row. The card's "Checked" line uses the
programme row's own date and initials, whatever the university row says.
A signed row with an empty `last_verified` shows no line and is listed as a problem.

**Do not invent scores.** No "student life: 8/10", no rankings we made up.
`student_life_url` is a link so people can judge for themselves. A number we
cannot source honestly would undermine the data that *is* real.

**The Sheet is public.** Anyone with the link can read it. Do not add private
notes, opinions about schools, or anything you would not put on a poster.

**Never open the CSV files in Excel.** Editing happens in the Google Sheet; the
files in `data/` are only what the Sheet exports. If you open one in Excel and
save it, Excel rewrites every ISO date into its own format — the exact problem
the Plain text setting exists to prevent — and can mangle the `€`, `—` and `·`
characters. Excel also locks the file while it is open, which stops anything
else from writing to it. If you need to look at a CSV, use a text editor.

---

## The autumn job, every year

Do this in **September or early October**, before applications open. It is the
single most important task in this document, and it takes an afternoon shared
between two people.

1. **Open the site and sort by deadline.** Anything marked "passed" is last
   year's date and needs rolling forward.
2. **Work down the `programmes` tab.** For each row, open `official_url` and
   check three things: the deadline, `ib_points_min` / `ib_subjects`,
   and the tuition fee.
3. **Update `application_deadline` to next year's date.** Most are the same date
   each year — 15 January is common across the Netherlands for capped courses —
   but confirm rather than assume. Universities do move them.
4. **Put today's date in `last_verified` and your initials in `verified_by`.**
   Even if nothing changed. That is the point of the column.
5. **Fix anything the site complains about.** Scroll to the bottom of the page:
   if there is an amber box, it lists exactly which row and column is wrong.
6. **Rebuild the offline copy** (see below).

Anything a person signed off and has not re-checked for six months shows a "may
be out of date" badge automatically, so you can see at a glance what has been missed.

## Before each application season

- Sort by deadline and check nothing urgent is marked as unverified.
- Check the tuition figures. Many countries set fees for the coming year in
  spring, so a fee entered in autumn may already be slightly out.
- Spot-check five random rows against their official pages. If more than one is
  wrong, the whole sheet needs another pass.

---

## Rebuilding the offline copy

`data/fallback.json` is what visitors see if Google is unreachable. It does not
update itself. If it is old, the site says so in a banner — but old is still
worse than current.

This is the one task that needs a computer with [Node.js](https://nodejs.org)
and the project files:

```bash
node tools/make-snapshot.mjs
```

Then commit and push. Do it after the autumn pass, and any time the Sheet
changes a lot. While the site reads the CSVs in the repo, `node tools/check.mjs`
fails when `data/fallback.json` no longer matches them: run the command above
and commit the result with the CSVs.

While you are there, this checks that nothing is broken:

```bash
node tools/check.mjs
```

It should end with "All checks passed". If it does not, whatever it names is
worth fixing before the next application season.

If Google Chrome is installed, also run `node tools/smoke.mjs`. It opens the
real page invisibly, clicks through it the way a student would, and should end
with "Smoke test passed". Without Chrome it just says SKIP.

---

## When something looks wrong

**My edit is not showing.** Google caches the published CSV for a few minutes.
Wait five, then hard-refresh (`Ctrl+Shift+R`, or `Cmd+Shift+R` on a Mac).

**A row has vanished.** Look at the bottom of the page for the amber box. The
usual causes are a `university_id` that does not match any university row, a
duplicate `programme_id`, or a stray `"` somewhere in the row.

**Every row has vanished and there is a warning banner.** The site cannot reach
the Sheet and is showing the offline copy. Check that the Sheet is still
published: **File → Share → Publish to web**. Republishing it fixes this.

**The dates are all wrong by a bit.** The date columns are not set to Plain
text. Fix the format, re-enter the dates, and the warning goes away.

**A link does nothing.** `official_url` must start with `https://`. A bare
`tudelft.nl` is rejected — the site tells you which row.
