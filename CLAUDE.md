# CLAUDE.md — IB University Finder

A static single-page site where IB students filter European bachelor
programmes by entry requirements, deadlines, tuition and language. The users
are a Slovak school cohort, all EU citizens. A student may plan a real
application around a fact shown here, so a wrong fact costs them: show an
unknown as unknown, never as a guess.

No build and no dependencies: plain ES modules, and Node scripts that use only
built-ins. Ask before adding a framework, bundler, `package.json` or npm
package, because someone who doesn't code has to maintain this.

The fuller record: `STATUS.md` (state, known gaps, decisions, past bugs; row
counts under "State"), `MAINTENANCE.md` (every column's rules, for non-coders),
`README.md`.

## What is live, and who decides

- `origin` is Jakub's repo, `kpolacik/ib-university-finder`, and its `main` is
  the live GitHub Pages site. Local branches are staging; branches pushed to
  `origin` carry PRs for Jakub. Nothing reaches students until a PR merges.
- Product and display choices are Leon's alone; don't hold them for Jakub.
  Registry items marked `decision` wait for Leon.
- Don't reopen anything under STATUS.md "Decisions already made, so they are
  not relitigated" unless Leon asks. Jakub's data and choices win over the old
  fork's decisions (Leon, 2026-11-02, at the upstream merge).

## Where the data lives

- `data/universities.csv` and `data/programmes.csv` are the source, joined by
  `university_id`. The page loads them (or the published Google Sheet, once
  `js/config.js` has its URLs) and falls back to `data/fallback.json` if
  those fail. `data/i18n/sk.csv` holds the Slovak text for data values.
- Agents change these CSVs with a script that lists every change, never by
  hand. Jakub commits to `main` often, mostly to `data/programmes.csv`, so
  `git fetch origin` and merge `origin/main` before a large data edit.
- `data/fallback.json` is written by `tools/make-snapshot.mjs`; don't
  hand-edit it.
- Never open or save a CSV in Excel: it mangles dates and `€ — ·`.
- `data/sample-*.csv` are invented fixtures for `check.mjs`, never real data.

## Commands

```bash
node tools/serve.mjs [port]     # dev server, http://localhost:8765, nothing cached
node tools/check.mjs            # must end "All checks passed."
node tools/check-contrast.mjs   # after any colour change; scores both themes
node tools/lint-data.mjs        # data mistakes and changed ids against HEAD
node tools/smoke.mjs --only=runFaqPanel   # real Chrome, one section; Node 22+
node tools/make-snapshot.mjs    # rewrites data/fallback.json from the CSVs
```

- `smoke.mjs` runs the whole suite (about 19 minutes) on any argument it
  doesn't recognise, `--help` included. Pick sections with `--only=runA,runB`
  (function names; a wrong name lists the valid ones) or a `--…-only` flag
  from its header comment. Without Chrome it prints SKIP unless
  `--require-chrome`.
- `make-snapshot.mjs` ignores its arguments, so `--help` rewrites
  `fallback.json` too. Run it after a CSV change and commit both together.
- Use `serve.mjs`, not `python -m http.server`, which lets the browser show
  stale CSS.
- GitHub (`.github/workflows/checks.yml`) runs `check.mjs` and
  `check-contrast.mjs` on every push and PR, and the full smoke on PRs only.

## Data rules

MAINTENANCE.md has every column's rules; `js/data.js` parses them and
`tools/check.mjs` tests most of them.

- **Blank, `?`, value** (`inheritNumber`, `inheritText` in `js/data.js`). Blank
  inherits the university default. `?` means "differs from the university,
  value unknown": it never inherits and the card says "Not published". A value
  overrides. Applies to `tuition_eu`, `tuition_noneu`, `english_requirement`,
  `admission`, `city` and `application_system`.
- **Blank is not zero.** `0` tuition is a real "No tuition fee" claim.
- **`none` is not blank** in `ib_subjects` and `ib_maths`. `none` means the
  university says there is no requirement; blank means nobody has checked. An
  importer that can't parse a page writes blank; write `none` only on positive
  evidence. A regex capture that needs a bound ends at a terminator, not a
  character count (the Trinity and UCD bugs in STATUS.md).
- **Unknown never hides a programme.** Every filter shows unknown values and
  labels them (`js/filters.js`). In `ib_maths` and `entrance_exam`, `?` and
  blank are both unknown.
- **`ib_points_min`** is a number, and only what the university publishes (or
  the CAO, for Irish rows), never a comparison site's figure. Czech rows leave
  it blank: admission is by entrance exam.
- **Irish points are last year's CAO cutoffs, converted, not minimums.** UCD
  is the exception: its figure is UCD's published IB minimum. Every conversion
  goes through `convertCutoff` in `tools/lib/ireland.mjs`; cutoffs and their
  `AQA`/`#`/`*` markers come from the CAO (`tools/lib/cao-points.mjs`).
  - A plain 601–625 cutoff assumes the 25-point HL Maths bonus, and the card
    says it needs HL Maths 4+ (Q13).
  - HPAT Medicine shows the CAO's 480-point minimum (Q12).
  - A cutoff above 625 that includes a test stays blank and says so.
  - A `#` cutoff stays blank when its CAO code is in `TEST_IN_CUTOFF` or
    `TEST_UNVERIFIED` (`js/points.js`, D27); other `#` courses convert.
- **Irish fee is the Free Fees figure** (student contribution plus levy), not
  the larger "EU fee" a page prints.
- **UK `tuition_eu` is the international fee**, which EU students pay there.
  Only EU fees are shown; non-EU tuition is not collected.
- **Every row has an `official_url`** that passes `safeUrl` (http(s) only). A
  row that fails is reported, never quietly dropped.
- **`verified_by` is a person's signature.** `AI-DRAFT` means gathered
  automatically and unchecked; an agent writes only that, never initials.
  `SAMPLE` marks invented fixture rows and triggers a red banner.
- **Never change a `programme_id` or `university_id`** once the row exists.
- Don't invent scores or rankings. `student_life_url` is only ever a link.
- Lists use ` · ` (`BULLET`). `subject_area` and `language` use `;`, with the
  fixed subject vocabulary in MAINTENANCE.md. Dates are `YYYY-MM-DD`.

## Importers and scripts

- `tools/import-*.mjs` rebuild a university's rows from scratch into
  `tools/<uni>-rows.csv`, which undoes hand corrections made since. Re-run one
  only to refresh that university, merge its rows into the CSV with a script
  that lists every change, and read that list before writing. ČVUT's needs
  `node --use-system-ca`.
- `tools/update-cao-points.mjs` updates Irish rows in place. Use it, not the
  Irish importers, for the yearly CAO refresh. Dry run unless `--apply`.
- `tools/merge-italy-denmark.mjs` and `tools/apply-verification-2026-10-25.mjs`
  are one-off records. Don't re-run them: the merge would undo the corrected
  Bocconi fees (D12).
- Every bug fix gets a regression check in `tools/check.mjs`.

## Design rules

Full rules: STATUS.md "The look of it".

- Colours live only in the light `:root` tokens in `css/styles.css` and the
  one approved screen-only dark override. Colour is for verdicts and blue is
  for interaction (STATUS.md has the country-identity exception).
- Never lower a minimum in `check-contrast.mjs`. `--edge-soft` (3:1 in both
  themes) is only for the off switch and the unset slider thumb.
- Saved state (`js/saved-state.js`): any recognised filter or sort parameter,
  or `?list=`, means URL state plus defaults, never merged with storage.
  `?ui=` alone still restores saved filters. Opening a URL must not overwrite
  saved preferences. Clear all keeps the separate onboarding flag.

## Plans and the issue registry

`plans/audit-issues.md` is the issue registry (IDs such as D01, P01, L01).
Plans use its IDs, never their own numbering, and update its `State` column
when work is planned, fixed or dropped. Only `plans/scan/` and
`plans/backlog/` are in git; the rest of `plans/` exists only in Leon's
checkout, so anything that must outlive it goes in STATUS.md.

## Workflow profile

Default exposure: Local
Local scope: editing files, running checks, the local server, and commits on local branches in this checkout (staging).
Shared boundaries: pushing non-`main` branches to `origin` (`kpolacik/ib-university-finder`) and opening or updating draft PRs there (Leon, 2026-11-03: "local = staging, pr = for jakub, main = live"). Jakub can see them; students can't. Recover by pushing a fix or closing the PR. Never force-push a branch someone else has pushed to.
Consequential boundaries: merging into or pushing to `main` (the live GitHub Pages site); marking a PR ready or merging it; issues or comments addressed to Jakub outside a PR description; rewriting history on `main`; deleting a repository.

## Style

- Docs are plain language for a successor who doesn't code. Update STATUS.md
  when the state changes; don't copy its content into new files.
- Comments explain why (what went wrong, what a source page says, which trap
  the code avoids), like the header comments in `tools/` and `js/`.
- Commit messages: a plain sentence-case imperative summary, often naming the
  university or row ("Drop the Italian track from…"). No Conventional Commits
  prefixes (`feat:`, `docs:`).
