# CLAUDE.md — IB University Finder

## What this is

A single-page static site that helps IB students find European bachelor
programmes, filtering on entry requirements, deadlines, tuition and language.
The users are a Slovak school cohort of about 30, all EU citizens, so EU fees
are the only fees shown and the UK is left out. Each programme has one row in
`data/programmes.csv`, joined to `data/universities.csv` by `university_id`.
The browser loads the CSVs (or the published Google Sheet once
`js/config.js` has the URLs), and falls back to `data/fallback.json` if those
fail. Someone may plan a real application around what this site says. When a
fact is wrong, the student pays for it.

**No build, no dependencies.** It is plain ES modules plus Node scripts that
use only built-ins. Ask before adding a framework, a bundler, `package.json`
or any npm package. Somebody who doesn't code has to be able to maintain it.

Read these first: `STATUS.md` (current state, known gaps, decisions, past bugs),
`MAINTENANCE.md` (the column rules, written for non-coders), `README.md`.

## Commands (all local; there is no CI)

```bash
node tools/serve.mjs [port]     # dev server, no-store caching; default http://localhost:8765
node tools/check.mjs            # must end "All checks passed"
node tools/check-contrast.mjs   # run after any colour-token change; never lower the minimum
node tools/make-snapshot.mjs    # REWRITES data/fallback.json from the CSVs
```

- Use `serve.mjs` instead of `python -m http.server`. Python's server lets
  the browser serve stale CSS (see STATUS.md, "Running it").
- `make-snapshot.mjs` ignores every argument, so `--help` will also rewrite
  `fallback.json`. Run it on purpose after a data change and commit the
  result with it, so the snapshot matches the CSVs.
- Testing happens only on this machine. This fork has no Pages site.

## Data rules you must not break

The column rules are in MAINTENANCE.md and the parsing is in `js/data.js`.
`tools/check.mjs` tests most of these rules.

- **Blank / `?` / value** (`inheritNumber`, `inheritText` in `js/data.js`).
  A blank cell inherits the university default. `?` means "differs from the
  university, value unknown" and **never inherits** (the card shows "Not
  published"). A value overrides the default. This applies to `tuition_eu`,
  `tuition_noneu`, `english_requirement`, `admission` and `city`.
- **Blank is not zero.** `0` tuition is a real "No tuition fee" claim.
- **`ib_subjects`: `none` ≠ blank** (`js/data.js` ~L185, MAINTENANCE.md).
  `none` means the university says there are no subject requirements. Blank
  means nobody has checked. An importer that can't parse a page must write
  blank. Write `none` only when there is positive evidence (the Trinity/UCD
  capped-regex bugs in STATUS.md). If a capture needs a bound, end it at a
  terminator, never at a character count.
- **`ib_points_min` is a number only**, and only what the university
  publishes (or the CAO, for Irish rows). Never take it from comparison
  sites. Czech rows leave it blank (admission is by entrance exam).
- **Irish points are last year's CAO cutoffs (converted), not minimums.**
  UCD is the exception: its figure is UCD's published IB minimum. All
  conversion goes through `convertCutoff` in `tools/lib/ireland.mjs`:
  - A plain 601–625 cutoff assumes the 25-point HL Maths bonus. The card
    says "needs HL Maths 4+" (decision Q13).
  - HPAT Medicine shows the CAO's 480-point minimum (35 IB), ranked with
    the HPAT (decision Q12).
  - A cutoff above 625 that includes a test stays blank and says so.
  Cutoffs come from the CAO, with its `AQA`/`#`/`*` markers
  (`tools/lib/cao-points.mjs`, STATUS.md decisions).
- **Irish fee = Free Fees figure** (student contribution plus levy). Don't use
  the bigger "EU fee" a page prints (STATUS.md).
- **Unknown never hides a programme.** Filters show unknown values and label
  them (`js/filters.js`, README "Design decisions").
- **Every row has an `official_url`** that passes `safeUrl` (http(s) only).
  A row that fails is reported, not quietly dropped. `check.mjs` asserts this
  on the real data.
- **`verified_by` is a human signature.** `AI-DRAFT` means it was gathered
  automatically and nobody has checked it (every row is AI-DRAFT today).
  `SAMPLE` means invented fixture data and triggers a red banner. Never put
  initials there for someone. Don't load `data/sample-*.csv` as real data.
- **Never change a `programme_id` or `university_id`** after the row exists.
- Lists use ` · ` (`BULLET`); `subject_area`/`language` use `;` with the
  fixed subject vocabulary in MAINTENANCE.md. Dates are `YYYY-MM-DD`.
- Don't invent scores or rankings. `student_life_url` is only ever a link.
- Never open or save the CSVs in Excel (it mangles dates and `€ — ·`).

## Importers and maintenance scripts

- `tools/import-*.mjs` write `tools/<uni>-rows.csv` and **rebuild rows from
  scratch**, which undoes hand corrections made since. Only re-run one to
  refresh a university, then merge by hand and diff carefully.
- `tools/update-cao-points.mjs` updates Irish rows **in place**. Use it, not
  the Irish importers, for the yearly CAO refresh.
- `tools/merge-italy-denmark.mjs` and `tools/apply-verification-2026-10-25.mjs`
  are one-off records. **Don't re-run them.** A merge re-run would undo the
  corrected Bocconi fees (registry D12).
- ČVUT importer needs `node --use-system-ca`.
- **Every bug fix gets a regression check in `tools/check.mjs`.**
- Jakub commits to upstream often, mostly to `data/programmes.csv`. Sync
  before any large data edit to avoid conflicts. There is no upstream remote:
  use `git fetch https://github.com/kpolacik/ib-university-finder main`, then
  merge `FETCH_HEAD`.

## Plans and the issue registry

`/plans` holds agent plans. `plans/audit-issues.md` is the issue registry
(IDs like D01, P01, L01), merged from the two audits in `plans/scan/`. Plans
use registry IDs, never their own numbering, and update the `State` column
when work is planned, fixed or dropped. Items marked `decision` are product
calls: wait for the user.

## Decisions already made

See STATUS.md "Decisions already made, so they are not relitigated". Don't
reopen any of them unless the user asks. The most load-bearing:

- One row per programme, two tabs joined by `university_id`
- Unknown never hides a programme
- `none` and blank are different; `?` never inherits
- Irish fee is the Free Fees figure (contribution + levy)
- Irish points are CAO cutoffs, UCD the exception; cutoffs come from the CAO
- No save button / shortlist (code kept on purpose); UK excluded; non-EU tuition not collected

The visual direction (two typefaces, country tints, light only, no dark
palette) is under STATUS.md "The look of it".

## Workflow profile

Default exposure: Local
Local scope: editing files, running checks, the local server, and commits on local branches in this checkout (`Leonsalner/ib-university-finder` fork).
Shared boundaries: pushing branches to the fork `origin` (`Leonsalner/ib-university-finder`). Students can't see it, and you can recover by deleting the branch or force-pushing a feature branch. Never rewrite fork `main`.
Consequential boundaries: opening or updating PRs or issues on `kpolacik/ib-university-finder` (fixes go upstream later in one large batch PR, only with the user's explicit approval); anything that changes the live GitHub Pages site (upstream `main`); messaging Jakub (maintainer); rewriting fork history on `main`.

## Style

- Docs are plain language, written for a successor who doesn't code. Update
  STATUS.md when the state changes. Don't copy its content into new files.
- Comments explain **why** (what went wrong, what a source page says, which
  trap it avoids), following the existing header comments in `tools/` and `js/`.
- Commit messages: follow the existing history (`git log --oneline -20`).
  That means a plain sentence-case imperative summary, often naming the
  university or row ("Drop the Italian track from…", "Bocconi: 2027/28 fee
  is published…"). Don't use Conventional Commits prefixes (`feat:`, `docs:`).
