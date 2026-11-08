# IB University Finder

**Live site: <https://kpolacik.github.io/ib-university-finder/>**

A single-page site for finding European bachelor programmes by what IB students
need: IB points and subjects, deadlines, EU tuition, living costs and language.
It covers 11 countries: the Netherlands, Ireland, Czechia, Italy, Denmark,
Sweden, Finland, Norway, Austria, Germany and the United Kingdom (counts are in
STATUS.md). English by default, with Slovak one tap away.

Static files only: no build, no dependencies, no accounts, nothing paid.

## Running it locally

Browsers will not load the page's modules over `file://`, so double-clicking
`index.html` shows a blank page. Serve it instead:

```bash
node tools/serve.mjs        # then open http://localhost:8765
```

This server tells the browser not to cache, so a CSS change shows straight
away; Python's `http.server` does not.

## Checking you have not broken anything

```bash
node tools/check.mjs          # must end "All checks passed"
node tools/check-contrast.mjs # after any colour change
node tools/smoke.mjs          # clicks through the real page in an invisible Chrome (Node 22+)
```

`check.mjs` needs no libraries. It covers CSV parsing, the blank / `?` / value
rules, bad input being reported rather than swallowed, sorting, filters, My
list, Compare, share links, both languages, and that every real programme loads
with a link to its official page.

## The data

Two CSV files in `data/`, joined by `university_id`:

- `universities.csv`: one row per university (city, country, living costs as a
  monthly range with its source, default tuition)
- `programmes.csv`: one row per programme, which can override the university's
  city, tuition, English requirement or admission

A programme cell has three states:

| Cell | Meaning |
|---|---|
| *(blank)* | Same as the university |
| `?` | Differs from the university, value unknown; never inherits |
| a value | This programme's own value |

`data/fallback.json` is an offline copy, rebuilt by `tools/make-snapshot.mjs`;
the page uses it, with a warning, if the CSVs fail to load. The column rules,
written for someone who does not code, are in [MAINTENANCE.md](MAINTENANCE.md).
Never open the CSVs in Excel: it mangles dates and the `€ — ·` characters.

## Deploying

GitHub Pages serves `main` from the root (Settings → Pages). There is no build
step; `.nojekyll` stops GitHub running Jekyll. Anything merged into `main` is
live for students.

## Design decisions worth knowing

- **Unknown never hides a programme.** A programme with no fee recorded still
  shows under "max €3,000", with a line saying why. My maths and Entrance exam
  hide only programmes that state they don't fit; one nobody has checked stays
  and says it was not filtered.
- **Your IB points don't hide anything either.** With My IB points set, each
  row says whether it is within your points, only with HL Maths 4+, or can't be
  compared, and the count line adds them up.
- **A minimum and a cutoff are said differently.** A published minimum is a
  floor ("36, minimum"). Irish courses show the IB equivalent of last year's
  CAO cutoff ("≈ 37, Round 1"), which moves every year; UCD publishes its own
  IB minimum, so its rows say "minimum".
- **Fees are what an EU student pays.** In the UK that is the international
  fee, which EU students have paid since 2021.
- **Max yearly cost** adds the EU fee to 12 months of living costs and hides a
  programme only when even the lowest estimate is over budget.
- **`verified_by` means a person looked.** `AI-DRAFT` rows were gathered
  automatically (the banner says so); only a person's initials show
  "Checked by …". `SAMPLE` rows are invented and show a red banner.
- **Every row links to its official page**, and the site never claims to be
  the final word: a wrong deadline could cost someone an application.
- **One bad edit cannot take the page down.** Malformed rows are skipped and
  listed at the bottom, naming the row and column.
- **No invented rankings or scores.** `student_life_url` is only ever a link.

## My list and Compare

The bookmark on a row saves the programme in this browser. My list shows the
saves, grouped by deadline month, IB points or country, and can be shared as a
link (`?list=…`), exported as CSV or printed. Compare is a separate set of up
to 4 programmes, added with the scales button on any row. Opening a shared
link saves nothing until you press "Save these to my list".

Filters live in the page address, so reloading keeps them and a filtered view
can be shared (`?q=law&country=Ireland&points=36`).

## Site language

`?ui=en` or `?ui=sk` picks the interface language; otherwise the page uses the
last choice in this browser, then English. `lang=` is the teaching-language
filter, not the interface. `js/i18n.js` holds the interface text (`UI.en`,
`UI.sk`, with Slovak plural forms); data translations come from
`data/i18n/sk.csv`. `node tools/i18n-missing.mjs` lists missing ones. Details
are in MAINTENANCE.md.

## Files

```
index.html          markup and filter controls
css/styles.css      all styling, including print (light only)
js/data.js          fetch, join, validate; all parsing lives here
js/filters.js       rows + filter state → rows, and sorting
js/render.js        everything that touches the page
js/app.js           wiring and event handlers
js/i18n.js          English and Slovak interface text
data/               the CSVs, fallback.json and Slovak data translations
tools/              checks, the dev server and data scripts
```

Current state, known gaps and past decisions: [STATUS.md](STATUS.md).
