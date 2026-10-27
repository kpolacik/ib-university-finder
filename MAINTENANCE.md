# Looking after this site

You do not need to know how to code. Everything below happens in a Google
Sheet, in your browser.

If you take one thing from this document: **this site is only as trustworthy as
the person who last checked it.** Somebody may plan their application around a
deadline on this page. That is the whole reason for the `last_verified` and
`official_url` columns, and why the site refuses to show a card without them.

---

## The Sheet

Two tabs. Everything else follows from this.

| Tab | One row per | Why |
|---|---|---|
| `universities` | university | City, country, living cost, default tuition — typed once |
| `programmes` | programme | The degree itself, its requirements and its deadline |

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

**Put IB English grades in `english_requirement`, not `ib_subjects`.** A student
looking for "what English do I need" looks at the language line.

### Subject areas

Pick from this list so the filters stay tidy. Use `;` between several.

`Engineering` · `Computer Science` · `Mathematics` · `Physics` · `Chemistry` ·
`Biology & Life Sciences` · `Environmental Sciences` · `Medicine & Health` ·
`Psychology` · `Economics` · `Business & Management` · `Law` ·
`Politics & International Relations` · `Sociology & Anthropology` · `History` ·
`Philosophy` · `Languages & Literature` · `Media & Communication` ·
`Art & Design` · `Architecture` · `Education` · `Liberal Arts`

`Liberal Arts` is for university-college programmes where you build your own
curriculum, so no single subject describes them.

Set these as a dropdown: select the column, **Data → Data validation**, paste
the list. It stops typos splitting one subject into two filter buttons.

---

## The rules that matter

**Blank is not zero.** A blank tuition cell means "use the university's
default". A `0` means the course genuinely has no fee. The site shows these
differently — "No tuition fee" is a real statement — and getting them backwards
is misleading in a way that matters.

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
When a programme has no requirements at all, the card says "No requirements
beyond ___" and fills the blank from this column. The Netherlands measures every
foreign diploma against VWO; other countries do not, so adding a German or Czech
university means writing its own baseline there. Leave it empty and the card
falls back to "a qualifying secondary school diploma", which is true anywhere.

**Fill in `city` only for satellite campuses.** Most programmes are taught in
the university's home city, so leave it blank. But University College Roosevelt
is in Middelburg, not Utrecht; Leiden teaches three programmes in The Hague;
Groningen teaches two in Leeuwarden. Put the real city there and the card — and
the search box — will use it.

**Never edit an `id` once the row exists.** Students star programmes to build a
shortlist, saved in their own browser against these ids. Change one and their
saved star silently points at nothing. Renaming a university is fine. Fixing a
typo in a name is fine. Changing the id is not.

**Only write in `ib_points_min` what the university actually publishes.** Many
do not publish a number at all — this is normal, especially in the Netherlands,
where admission runs on required subjects rather than a total score. Leave it
blank and put the real requirement in `ib_hl_requirements`. The card will say
"Points not published", which is honest and useful. A number copied from a
commercial university-comparison site is not a fact, and it is exactly the kind
of thing that makes someone apply for a course they cannot get into.

**`verified_by` is a signature.** Put your initials there only if you personally
opened `official_url` and read it. If a row says `AI-DRAFT`, it was gathered
automatically and nobody has confirmed it — the site marks those with a badge.
Replacing `AI-DRAFT` with your initials is how you sign it off.

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
   check three things: the deadline, `ib_points_min` / `ib_hl_requirements`,
   and the tuition fee.
3. **Update `application_deadline` to next year's date.** Most are the same date
   each year — 15 January is common across the Netherlands for capped courses —
   but confirm rather than assume. Universities do move them.
4. **Put today's date in `last_verified` and your initials in `verified_by`.**
   Even if nothing changed. That is the point of the column.
5. **Fix anything the site complains about.** Scroll to the bottom of the page:
   if there is an amber box, it lists exactly which row and column is wrong.
6. **Rebuild the offline copy** (see below).

Anything not checked for six months shows a "may be out of date" badge
automatically, so you can see at a glance what has been missed.

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
changes a lot.

While you are there, this checks that nothing is broken:

```bash
node tools/check.mjs
```

It should end with "All checks passed". If it does not, whatever it names is
worth fixing before the next application season.

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
