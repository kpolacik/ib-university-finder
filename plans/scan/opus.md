# Comprehensive repository audit — Opus

## Audit context and coverage

| | |
|---|---|
| Date | 2026-10-25 |
| Repository | `Leonsalner/ib-university-finder` (GitHub reports it as a fork of `kpolacik/ib-university-finder`) |
| Audited branch / commit | `main` @ `88be059e3365de1c1b590ba308d452db203efbc7` ("Correct the Bocconi fee comment in the merge script") |
| Scope | Read-only product and technical audit. No application code, data, docs or config were changed; this report is the only tracked change. |

**Agents used.** One driver plus eight read-only worker agents, run in parallel. Two were large-tier, two mid-tier and four small-tier; the small-tier ones ran at medium or high effort, the rest at medium. The exact model allocation is recorded in the session conversation rather than in this file.

| Worker | Ownership |
|---|---|
| Mid-tier A | UX, core journeys and product opportunities |
| Mid-tier B | Bugs, data correctness, dataset profile and flagship-row verification |
| Large-tier A | Accessibility, UI and responsive design |
| Large-tier B | Security, privacy, performance and reliability |
| Small-tier ×4 | Docs and terminology consistency; dataset completeness profile; official-source spot checks; edge-case runtime states |

The driver re-ran or re-read every finding rated P1 or P2 that rests on one worker's evidence (marked "driver-verified" below), resolved contradictions between workers, and downgraded several worker severities.

**Incident disclosure.** One worker accidentally ran `node tools/make-snapshot.mjs --help`. The script ignores its arguments and rewrote `data/fallback.json`. The rewrite was byte-identical, and the worker also ran `git checkout -- data/fallback.json`. The driver confirmed `git status --porcelain` was empty afterwards, so the repository state is unaffected.

**What the application actually is.** A static, no-build, vanilla-JS single page (`index.html`, `css/styles.css`, `js/*.js`).
- **Data and loading:**
  - It loads `data/universities.csv` and `data/programmes.csv` and joins them in `js/data.js`, with inheritance rules: a blank cell takes the university default, and `?` means unknown.
  - It renders **one long list of 1,242 programme cards** from 35 universities in 5 countries:

    | Country | Programmes | Universities |
    |---|---|---|
    | Netherlands | 199 | 13 |
    | Ireland | 548 | 7 |
    | Czechia | 424 | 5 |
    | Italy | 46 | 5 |
    | Denmark | 25 | 5 |

  - If the live source fails it falls back to `data/fallback.json`. `js/config.js` has the Google Sheet URLs empty, so the repository CSVs are what loads today.
- **Filters:** free-text search, "My points", "Max fee €/yr" (EU fee), and subject area / country / language checkbox lists.
- **Sort:** four options (deadline, tuition, IB points, university).
- **Banners:** one always visible ("starting point for research…"), because every row is `AI-DRAFT`.
- **Not available:** shortlisting, comparison, a compare view, URL state, accounts or persistence. Shortlist code exists, but its UI was deliberately removed on 2026-10-24 (`js/app.js:231`, STATUS.md) and nothing can add to it.

**Journeys inspected.** All were walked in Chromium via Playwright at 1280×800 and 375×812; accessibility and UI checks also covered 320, 768 and 1440.
- A 34-point student wanting Computer Science / Economics / Psychology, taught in English, for ≤ €3,000.
- Search discovery: names, cities, aliases, accents and multi-word queries.
- Combined filters, zero results, Clear all, every sort, reload, back/forward.
- Reading a card, especially Irish, Dutch numerus fixus and Czech entrance-exam cards.
- Print.
- Failure states: CSV 404, total failure, truncated CSV, HTML-at-200, slow network, renamed headers, blocked or hanging Google Fonts.
- A simulated future clock (2027-02-15) for past-deadline rendering.

**Checks run and outcomes**

| Check | Outcome |
|---|---|
| `node tools/check.mjs` | Passes (49 `ok` lines, "1242 programmes across 35 universities") |
| `node tools/check-contrast.mjs` | Passes (44 pairs). It does not model opacity; see [OPUS-017](#opus-017) |
| axe-core 4.10.2 (8 runs: 2 viewports × 4 states) | 0 violations; colour-contrast "incomplete" only where elements overlap |
| Console errors on load (desktop and mobile) | None |
| Performance (CDP, desktop and 4× CPU / 1.6 Mb/s mobile) | See [OPUS-011](#opus-011) and [OPUS-016](#opus-016) |
| Dataset profile (whole dataset, using the site's own loader) | See the "Dataset profile" appendix |
| `fallback.json` vs CSV parity | Identical today (1,242 / 35 rows, 0 cell differences, `generated_at` 2026-10-25), but nothing enforces it |
| Secret scan of the full git history (32 commits) | 0 hits; no dependencies, no `package.json` |
| Dev server traversal tests (localhost only) | Traversal blocked; `.git/` is served; see [OPUS-034](#opus-034) |
| Official-source verification | 25 rows across all 5 countries, accessed 2026-10-25; see [OPUS-005](#opus-005) and the verification appendix |

**Coverage gaps and limitations**
- **Browsers and devices:** Chromium only. No real screen reader (NVDA, JAWS, VoiceOver), no Safari/iOS or Firefox, no forced-colours mode, no real phone. Throttling was emulated through CDP.
- **Google Sheets:** the integration is not configured, so its real behaviour is inferred: what an unpublished sheet returns, CORS, 304 support, and Google's cache.
- **Verification sample:** 25 rows out of 1,242. It shows a discrepancy *rate*, not a full error inventory.
- **Not checked:** the CAO's 2027 closing date (university pages restate "1 February" but the CAO page didn't state it); Dutch 2027/28 statutory fee on TU Delft's page (other Dutch pages confirm €2,771); the CAO IB conversion table itself.
- **Deadlines:** no deadline has passed yet (earliest is 2026-11-30), so the "passed" state was exercised only with a simulated clock.
- **Excluded:** legal assessment of the GDPR point, and who will hold edit rights on the planned Sheet.

---

## Executive assessment

**Strengths.**
- The engineering is careful and honest for a student project.
- Rendering is XSS-safe throughout (`textContent` only). Links are restricted to http(s) and open with `rel="noopener noreferrer"`. There are no dependencies and no tracking.
- The code is documented with the reasoning behind decisions.
- Unknown values are labelled rather than hidden, and the loader reports bad rows instead of crashing.
- The dataset is large: 1,242 programmes, every one with an on-domain official link. Sampled Dutch, Danish, Czech and Bocconi facts largely match their official pages.
- The project already knows many of its own gaps (STATUS.md).

**Most important weaknesses.** The site is good at *listing* programmes but does not yet support the decision a student is trying to make: "can I realistically get in, and what must I do by when?" Four themes stand out.

1. **The points number misleads more than it informs.**
   - In Ireland (44% of the data), "36 IB points" sometimes means UCD's stated minimum and sometimes a conversion of last year's Round-2 CAO cutoff. Both render identically under "Requirements".
   - The explanation sits under the *Deadline* row.
   - The most competitive courses (Medicine at TCD, UCC and Galway; Dentistry; Architecture) show "No minimum published" and survive any points filter.
   - The "My points" filter tests only 556 of 1,242 rows and never checks subjects or HL levels. The most common reason an IB applicant is ineligible is Maths AA vs AI, or HL grades, and that is never checked.
   - So the filter reads as an eligibility check without being one. See [OPUS-001](#opus-001)–[003](#opus-003).
2. **Data trust is asserted, not earned.**
   - All 1,242 rows are `AI-DRAFT`.
   - The sign-off path STATUS.md names as job #1 is broken in code: a programme signed off on its own never shows as checked.
   - The 25-row source sample found material discrepancies: a Groningen row whose note contradicts its own date and wrongly says numerus fixus, Trinity's English threshold, and missing English requirements.
   - Internal "CONFIRM" notes and stale promises are shown to students.
   - Half the dataset (610 rows) shows no language requirement in a way indistinguishable from "none". That breaks the project's own "blank ≠ none" principle. See [OPUS-004](#opus-004), [005](#opus-005), [007](#opus-007), [008](#opus-008).
3. **Core navigation is heavy.**
   - Search fails on natural queries ("uva economics", "TU Delft", "UCD").
   - Filter state is lost on reload and cannot be shared.
   - All 1,242 cards render at once: a 427,000 px page on desktop, 854,000 px on mobile, and about 0.5 s per filter change on a throttled phone.
   - The subject facet has 46 values, 23 of them one-off variants. See [OPUS-006](#opus-006), [010](#opus-010), [011](#opus-011), [014](#opus-014).
4. **The planned Google Sheet would remove the safety net.**
   - Once the Sheet is live, a renamed column silently blanks every official link or deadline.
   - An empty or truncated CSV is shown as complete, and a hanging fetch never falls back.
   - Anyone with edit rights can point "Official admissions page" at any domain. See [OPUS-012](#opus-012) and [OPUS-029](#opus-029).

**Readiness.**
- **Reasonable as:** a browsing aid for classmates who will verify everything themselves. The banner says so.
- **Not ready to be relied on** for "where can I get in" decisions until the Irish points semantics, the points-filter framing and the sign-off workflow are fixed.
- **Before connecting the Google Sheet:** add schema, row-count and timeout guards first.
- **Accessibility:** solid at baseline (axe clean, keyboard-operable). The issues are second-order, except reflow on phones and a contrast failure that will affect about half the cards from February 2027.

---

## Prioritised findings index

Ordered by practical importance. **Status:** C = confirmed, S = suspected / requires verification, E = proposed enhancement. **Effort:** XS < ½ day, S ≈ 1 day, M ≈ 2–4 days, L ≈ 1–2 weeks, XL > 2 weeks. Effort covers engineering and data work, not legal or policy decisions.

| ID | Priority | Area | Finding | Status | Effort |
|---|---|---|---|---|---|
| [OPUS-001](#opus-001) | P1 | Data / UX | Irish "IB points" mixes stated minimums and converted prior-year Round-2 cutoffs; shown unqualified as a requirement, with the qualifier under Deadline | C | M |
| [OPUS-002](#opus-002) | P1 | Data | Points conversion breaks at both ends: Medicine and other 600+ cutoffs show "No minimum published"; sub-350 cutoffs and graduate-entry Medicine show "24"; "above 625" note wrong | C | S |
| [OPUS-003](#opus-003) | P1 | UX / Functionality | "My points" reads as eligibility but tests 45% of rows, merges unknowns into the count, ignores subjects/HL, and accepts out-of-range input | C | M |
| [OPUS-004](#opus-004) | P1 | Data trust | 0 of 1,242 rows verified, and a programme-level sign-off can never display (gated on the university row) | C | XS (code) + ongoing data |
| [OPUS-005](#opus-005) | P2 | Data correctness | Source sampling found material discrepancies (Groningen UCG, Trinity English, missing English requirements, hidden ČVUT fee, DTU, Sapienza link) | C (sampled) | M |
| [OPUS-006](#opus-006) | P2 | UX / Functionality | Search is one contiguous substring over four fields: no subject area, no aliases, word order matters | C | S |
| [OPUS-007](#opus-007) | P2 | Data / UX | Missing requirement data reads as "nothing needed": 610 rows with no language row, 298 Czech-taught rows silent on Czech proficiency, `?` admission dropped | C | S (code) + M (data) |
| [OPUS-008](#opus-008) | P2 | Data | Internal or contradictory notes shown to students ("CONFIRM", a past "by 1 October 2026", housing date as headline deadline, "not yet published" next to a date) | C | S |
| [OPUS-009](#opus-009) | P2 | Data / UX | Irish fee is a single Free Fees figure with no eligibility condition or academic year; official sources disagree on 2027/28 | C / S | S |
| [OPUS-010](#opus-010) | P2 | UX | No URL or persisted state: reload loses all filters; nothing can be shared or bookmarked | C | S |
| [OPUS-011](#opus-011) | P2 | Performance / UX | 1,242 cards render at once (46k elements, 427k px page); ~0.4–0.54 s per filter change on throttled mobile | C | M |
| [OPUS-012](#opus-012) | P2 | Reliability | No guard against a degraded live sheet: renamed header, empty or truncated CSV, hung fetch; issues hidden in a collapsed footer | C | M |
| [OPUS-013](#opus-013) | P2 | UI / A11y | At 320–375 px the dropdown panels overflow the viewport and the page scrolls sideways (WCAG 1.4.10) | C (driver-verified) | XS |
| [OPUS-014](#opus-014) | P2 | Data / Filters | Subject taxonomy fragmented (46 facets, 23 singletons, "Liberal Arts" catch-all, Dentistry misfiled) | C | S |
| [OPUS-015](#opus-015) | P2 | UX / Data | Indistinguishable duplicate cards (e.g. 5× Charles "General Medicine", 3 shown as Prague) | C (driver-verified) | S |
| [OPUS-016](#opus-016) | P2 | Performance / Privacy | Google Fonts stylesheet blocks rendering (8 s blank page when it hangs) and sends visitor IPs to Google | C | S |
| [OPUS-017](#opus-017) | P2 | A11y | Past-deadline cards dimmed to 0.65 opacity fail contrast (2.7:1); will hit ~587 cards by mid-February 2027 | C (simulated clock) | XS |
| [OPUS-018](#opus-018) | P2 | Functionality | Input typed while data is loading is silently ignored; the UI shows a filter that isn't applied | C | XS |
| [OPUS-019](#opus-019) | P2 | Usability / A11y | Filter instructions only in `title` tooltips; "EU fee" not in the visible label | C | XS |
| [OPUS-020](#opus-020) | P3 | Reliability / UX | Total-failure state shows a raw JS error; controls stay live; snapshot fetch lacks `res.ok` | C | S |
| [OPUS-021](#opus-021) | P3 | UX copy | Empty-state hints are generic or reference removed features or the Google Sheet | C | XS |
| [OPUS-022](#opus-022) | P3 | Code health | Dead shortlist path; Ctrl+P prints every visible card (680 pages unfiltered); title colours leak into print | C | S |
| [OPUS-023](#opus-023) | P3 | A11y | Sticky filter bar hides the skip-link target; takes 46% of a landscape phone | C | XS |
| [OPUS-024](#opus-024) | P3 | A11y | Dropdowns stay open on Tab-out; global Escape steals focus; count unlabelled; live region re-announces unchanged text | C | S |
| [OPUS-025](#opus-025) | P3 | A11y | Accessible-name artefacts: h1 full stop, title+degree run-on, uppercase names, empty `<dt>`, 1,242 identical link names, no `lang` on Czech titles | C | S |
| [OPUS-026](#opus-026) | P3 | A11y / UI | Weak focus ring on inputs and select (1.04:1); control borders 1.2–1.3:1 | C | XS |
| [OPUS-027](#opus-027) | P3 | Data | Scraped boilerplate in Trinity subject requirements (11 rows, up to 900 chars); no clamping of long text | C | S |
| [OPUS-028](#opus-028) | P3 | Data | Official-link precision: 112 rows share 20 faculty-level or index URLs; 1 `http:` URL; error message contradicts the rule | C | S |
| [OPUS-029](#opus-029) | P3 → P2 when Sheet live | Security | Any Sheet editor can point official links at lookalike domains (userinfo, homograph and suffix tricks accepted) | C | S |
| [OPUS-030](#opus-030) | P3 | UI copy | Same concept, different labels (fee, points, language, subjects); degree type blank on 538 rows | C | XS |
| [OPUS-031](#opus-031) | P3 | UX | Default "deadline" sort opens on Czech-taught portfolio programmes; massive date ties; no language default | C | S |
| [OPUS-032](#opus-032) | P3 | Docs | Documentation drift: counts, run instructions, removed features, a non-existent column | C | S |
| [OPUS-033](#opus-033) | P3 | Reliability | No CI; `check.mjs` lacks schema, fallback, parity, URL edge-case and DOM coverage | C | S |
| [OPUS-034](#opus-034) | P3 | Security (dev) | Dev server serves `.git/` and listens on all interfaces | C | XS |
| [OPUS-035](#opus-035) | P3 | Security (dormant) | CSV export does not neutralise spreadsheet formulas | C | XS |
| [OPUS-036](#opus-036) | P3 | Tooling | Importers spoof a browser UA with no delay or robots check | C | XS |
| [OPUS-037](#opus-037) | Enh. – high | Feature | Structured "My subjects" eligibility check (HL/SL, Maths AA/AI, grades) | E | L |
| [OPUS-038](#opus-038) | Enh. – high | Feature | Per-country "how admission works" explainer: cutoffs vs minimums, predicted vs final grades, offer timing | E | S |
| [OPUS-039](#opus-039) | Enh. – high | Feature / Process | Maintainer data lint (note-vs-field contradictions, "CONFIRM", domain allowlist, facet vocabulary, required headers) | E | M |
| [OPUS-040](#opus-040) | Enh. – med | Feature | Pin-and-compare view encoded in the URL (replaces the removed shortlist) | E | M |
| [OPUS-041](#opus-041) | Enh. – med | Feature | Deadline timeline with grouping and `.ics` export | E | M |
| [OPUS-042](#opus-042) | Enh. – med | Feature / Data | Total yearly cost (living costs blank for all 35 universities) | E | S (data) |
| [OPUS-043](#opus-043) | Enh. – med | Feature | "Languages I can study in" profile, including the Slovak/Czech route to Czech-taught programmes | E | M |
| [OPUS-044](#opus-044) | Enh. – med | Feature / Data | Intake-year labelling and a cycle-rollover process | E | S |
| [OPUS-045](#opus-045) | Enh. – low | Feature | Non-EU fee toggle (deliberately excluded today; not recommended now) | E | S |

---

## Detailed findings by area

### Functionality and data correctness

<a id="opus-001"></a>
### OPUS-001 — Irish "IB points" mixes stated minimums with converted prior-year cutoffs, rendered as an unqualified requirement

- **Type/status:** Confirmed defect (data semantics and presentation). Driver-verified.
- **Priority:** P1. This is the core "can I get in?" signal for 548 Irish rows (44% of the dataset). Two different meanings share one label, and the "My points" filter acts on it.
- **Confidence:** High.
- **Effort:** M. A data column, a render change and a filter change; the importers already know which kind each value is.
- **Affected:** every student using the Irish rows or the points filter or sort.
- **Location/evidence:**
  - **Rendering:** `js/render.js:121-131` renders every non-null `ibPointsMin` the same way: a large serif number plus "IB points", under the "Requirements" heading.
  - **UCD (140 rows):** the value is UCD's own stated IB minimum. Example: `ucd-commerce` = 33, matching "General Entry Requirements (IB) 33" on https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?p_tag=COURSE&MAJR=BSS1&AUDIENCE=audienceEU (accessed 2026-10-25).
  - **Other six Irish universities (396 rows):** the value is `lowestIB()` of the 2026 CAO **Round-2** cutoff (`tools/lib/ireland.mjs:58-61`, `tools/update-cao-points.mjs:62-72`). Round 2 is chosen deliberately because it is lower (`tools/lib/cao-points.mjs`, comment on `latest`).
  - **Example:** Trinity Computer Science shows **37**. CAO 2026 lists TR033 as R1 519 / R2 498*, which convert to 38 and 37. The 37 is the post-acceptance second-round figure, and it was decided partly by random draw.
  - **Where the explanation lives:** only in `deadline_notes` ("2026 CAO cutoff: 495 points (code TR028)…"). `js/render.js:63` prints it as a sub-line under the **Deadline** row.
  - **What was removed:** the "Changes yearly — not a guaranteed minimum" sentence (STATUS.md; comment in `tools/lib/cao-points.mjs`, `caoNote`).
  - **Mismatch:** 93 of 114 checked UCD rows have a stated minimum at least 5 IB points below what their own CAO cutoff implies. Example: `ucd-computer-science` shows 33 while its 2026 cutoff of 509 implies ~37. Driver's script found 110 UCD rows more than 2 points below.
- **Current behaviour:** with My points = 36, UCD Computer Science (33, a *minimum*) appears as reachable and Trinity Computer Science (37, a *cutoff*) is hidden, although the two are in the same competitive class. Nothing on either card says which kind of number it is.
- **Reproduction:**
  1. Open `/` and search "computer science".
  2. Compare the UCD and Trinity cards: both say "N IB points".
  3. Find the cutoff sentence under "Deadline".
  4. Set My points = 36 and observe which one survives.
- **Impact:** students read a demand-driven, previous-year, partly lottery-decided figure as a requirement. They either rule out reachable courses or treat a UCD minimum as a realistic target. This is exactly the "meets published requirements vs likely to receive an offer" distinction the product exists to make.
- **Recommended change:**
  1. Add a value-kind field, e.g. `ib_points_kind` = `minimum | cutoff_last_year | baseline`, written by the importers.
  2. Render by kind:
     - **Minimum:** "Minimum 33 IB points (UCD)".
     - **Cutoff:** "Last year's cutoff ≈ 37 IB points (CAO 2026, round 2; changes yearly; ties drawn by lot)". Keep the CAO points figure next to it.
  3. Move the cutoff sentence out of the Deadline block.
  4. Decide, and document, Round 1 vs Round 2. Round 2 understates what most offer-holders needed; consider showing both.
  5. Make the points filter label which kind it compares (see [OPUS-003](#opus-003)).
- **Acceptance criteria:**
  - No card shows a bare "N IB points" for a cutoff-derived value.
  - The Deadline row contains only date information.
  - The points filter help states whether it compares minimums, cutoffs or both.
  - A `check.mjs` test asserts that every Irish row has a kind.
- **Related:** [OPUS-002](#opus-002), [OPUS-003](#opus-003), [OPUS-038](#opus-038).

<a id="opus-002"></a>
### OPUS-002 — Points conversion breaks at both extremes: Medicine shows "No minimum published", sub-350 cutoffs and graduate-entry Medicine show "24"

- **Type/status:** Confirmed defect. Driver-verified with a script over `data/programmes.csv`.
- **Priority:** P1. It hits the highest-stakes courses, and the result is the opposite of the truth.
- **Confidence:** High.
- **Effort:** S.
- **Location/evidence:**
  - **Top of the scale:** `lowestIB()` (`tools/lib/ireland.mjs:58-61`) returns `null` when a cutoff exceeds 600, leaving `ib_points_min` blank. `js/render.js:122-125` then prints **"Points: No minimum published"**, and `js/filters.js:55-57` keeps the row for *any* points value. Rows affected (12 blank Irish rows in total):
    - `tcd-medicine` (741)
    - `ucc-medicine` (735)
    - `galway-bachelor-of-medicine-mb-of-surgery-bc` (730)
    - `galway-bachelor-of-commerce-in-international` (706)
    - `tcd-music-education` (657)
    - `ucc-dentistry` (625)
    - `ul-architecture-barch` (625)
    - `dcu-ba-global-business-usa` (602)
  - **Bottom of the scale:** any cutoff ≤ 350 converts to 24, the table floor. 39 non-UCD rows show "24". These include `ucc-arts` (cutoff 300) and **`ucc-medicine-graduate-entry`**, whose CAO figure is a GAMSAT-scaled "58" for a course requiring a prior degree. Its card says "24 IB points" (driver-verified row).
  - **Wrong note:** `tools/update-cao-points.mjs:72` and `tools/lib/irish-import.mjs:104` write "Above the 625-point IB maximum". It is wrong for 602 (DCU) and for exactly 625 (UCC Dentistry, UL Architecture).
  - **Inconsistent conversion:** `tcd-dental-science` with the same 625 cutoff is converted to 44 via the HL-Maths-bonus path (`tools/import-tcd.mjs:115-118`), while `ucc-dentistry` is not.
  - **Misfiled subject:** `ucc-dentistry` is classified "Liberal Arts" because the subject regex matches `dental` but not `dentist` (`tools/lib/ireland.mjs`, `SUBJ`).
- **Reproduction:** enter My points = 24 and search "medicine". TCD, UCC and Galway Medicine appear with "No minimum published" and the note "Shown despite the points filter".
- **Impact:**
  - A 24-point student is shown undergraduate Medicine as having no points bar.
  - A school leaver sees graduate-entry Medicine as "24 IB points".
- **Recommended change:**
  - Represent "above the IB scale" explicitly, e.g. `ib_points_kind = above_scale`, rendered as "Last year's cutoff exceeded the maximum IB conversion (plus HPAT)". Exclude these from points-filter matches unless the user's points are 45.
  - Write `null` plus a note for cutoffs below 350.
  - Skip IB conversion for graduate-entry courses.
  - Fix the 600/625 wording, apply the bonus rule consistently, and add `dentist` to the regex.
- **Acceptance criteria:**
  - No row with a CAO cutoff above 600 renders "No minimum published".
  - No row with a cutoff below 350 shows 24.
  - `ucc-medicine-graduate-entry` shows no IB figure.
  - Add tests for these three cases.
- **Related:** [OPUS-001](#opus-001), [OPUS-014](#opus-014).

<a id="opus-003"></a>
### OPUS-003 — "My points" reads as an eligibility check but tests 45% of rows, ignores subjects and HL levels, and accepts any number

- **Type/status:** Confirmed defect (product semantics) plus input-validation defect.
- **Priority:** P1. It is the primary filter for the target user, and its output is read as "programmes I qualify for".
- **Confidence:** High.
- **Effort:** M.
- **Location/evidence:**
  - **Pass-through:** `js/filters.js:55-57` passes every row whose `ibPointsMin` is null. That is 686 of 1,242 rows:

    | Country | Rows with no points value |
    |---|---|
    | Netherlands | 197 of 199 |
    | Czechia | 422 of 424 |
    | Italy | 46 of 46 |
    | Ireland | 12 |
    | Denmark | 9 |

  - **Result count:** `js/app.js:213-217` prints "N of 1242 programmes" with matched and unknown rows merged.
  - **Per-card note:** the only qualifier is "Shown despite the points filter — no published minimum" (`js/render.js:82-84`), repeated on up to 686 cards.
  - **Subjects:** subject requirements are free text (`js/render.js:134-140`) and never evaluated.
  - **Validation:** `index.html:125` declares `min=24 max=45`, but `wholeNumber()` (`js/app.js:280-285`) accepts any finite number. There is no `:invalid` style in `css/styles.css` and no `aria-invalid`.
- **Reproduction:**
  - Journey (34 points, Computer Science/Economics/Psychology, English, ≤ €3,000): 109 results.
    - 62 (57%) have no points figure at all (48 Dutch, 10 Italian, 3 Danish, 1 Czech).
    - The first screen is Dutch cards reading "No minimum published".
  - Points = 10, 0 or −5 → "686 of 1242". Points = 50 or 99 → all 1,242. No message is shown in any of these cases.
- **Impact:**
  - The student believes "109 programmes fit my 34 points" when 47 were actually compared.
  - Dutch eligibility, which hinges on Maths AA vs AI and HL (e.g. TU Delft: "only accepts … Analysis & Approaches HL"), is invisible to the filter.
- **Recommended change:**
  1. Rename and explain the filter, e.g. "Hide programmes whose published points figure is above mine".
  2. Split the count: "47 within your points · 62 publish no points figure".
  3. Offer a "hide unknown" toggle and collapse the per-card note into one line above the results.
  4. Clamp or flag values outside 24–45 inline.
  5. Longer term: the subject check in [OPUS-037](#opus-037).
- **Acceptance criteria:**
  - With points set, the count distinguishes compared rows from unknown rows.
  - Out-of-range input shows a visible message and sets `aria-invalid`.
  - No copy implies eligibility.
- **Related:** [OPUS-001](#opus-001), [OPUS-019](#opus-019), [OPUS-037](#opus-037), [OPUS-038](#opus-038).

<a id="opus-004"></a>
### OPUS-004 — No row is human-verified, and a programme-level sign-off can never be displayed

- **Type/status:** Confirmed defect (code) plus a data-trust gap. Driver-verified in code.
- **Priority:** P1. STATUS.md's job #1 ("Sign off the rows that matter") is the project's route to trustworthy data, and the code silently defeats it. The source sampling in [OPUS-005](#opus-005) shows why sign-off matters.
- **Confidence:** High.
- **Effort:** XS for the code; sign-off itself is ongoing data work.
- **Location/evidence:**
  - `js/data.js:155` joins the university's and programme's `verified_by` into one string. `js/data.js:223` sets `needsHumanCheck = verifiedBy.includes('AI-DRAFT')`. `js/render.js:177-181` only prints "Checked <date> by <initials>" when `!needsHumanCheck`.
  - All 35 university rows are `AI-DRAFT`, so a programme signed off on its own still contains "AI-DRAFT" after the join and stays unchecked.
  - Data: 1,242 of 1,242 programme rows and 35 of 35 university rows are `AI-DRAFT`.
  - Several rows stamped `last_verified 2026-10-25` contradict their official pages ([OPUS-005](#opus-005)), so the date alone does not mean the row was checked.
- **Reproduction (by a worker using a scratch copy):**
  1. Set `tud-cse` to `2026-10-20,JK` with `tu-delft` still `AI-DRAFT`. The footer shows only the official link.
  2. Also sign the `tu-delft` row. "Checked 20 October 2026 by JK" appears.
- **Impact:**
  - Maintainers following STATUS.md see no effect from signing off the 15–20 programmes that matter, and may conclude it is broken or pointless.
  - Students can never see which specific rows a person checked.
  - The stale badge ("may be out of date") is unreachable as a side effect.
- **Recommended change:**
  - Compute programme provenance from the programme row; show university provenance separately if needed.
  - Keep the global banner until coverage is meaningful, but let checked rows say so.
  - Optionally add a "Checked by a person" filter.
- **Acceptance criteria:**
  - A single signed programme row renders "Checked … by …" while its university row is still `AI-DRAFT`.
  - A `check.mjs` test covers this.
- **Related:** [OPUS-005](#opus-005), [OPUS-032](#opus-032) (README and MAINTENANCE describe badges that don't exist), [OPUS-039](#opus-039).

<a id="opus-005"></a>
### OPUS-005 — Official-source sampling found material discrepancies

- **Type/status:** Confirmed for the listed rows, by sampling. These are row-level errors, not systemic proof.
- **Priority:** P2. They are individually fixable, but about a third of the 25 sampled rows had at least one materially wrong or missing student-facing fact, which supports [OPUS-004](#opus-004).
- **Confidence:** High where a quote is given; medium where noted.
- **Effort:** M (fix the rows and re-sample by country).
- **Evidence:** all accessed 2026-10-25; the full table is in the appendix.

| programme_id | Dataset | Official source | Assessment |
|---|---|---|---|
| `rug-ucg` (`data/programmes.csv`, deadline 2027-05-01) | Note: "Deadline 15 January, not 1 May … the February intake closes 1 January". `other_requirements` "Numerus fixus" and admission "Numerus fixus: limited places" | https://www.rug.nl/bachelors/liberal-arts-and-sciences/ : "Although we are not a numerus fixus programme, we are a selective programme… For the February intake, the deadline is 1 November. The deadline for the September is 1 May." | Date field correct; note, February date and admission type **wrong**. Driver-verified. |
| Trinity, all 83 rows (university default) | English requirement "IB English A 3 HL or 4 SL · English B 4 HL or 6 SL · just 4 at either level if you sat the IB in English" | https://www.tcd.ie/study/english-language-requirements/ : "English A1, A2 or B: SL4 if presenting IB through English, HL5 if presenting through French or Spanish." | Dataset is **more lenient** than Trinity for non-English-medium IB; the "A 3 HL" clause is not on the page. Driver-verified. |
| `rug-history` (and Groningen generally) | No English requirement | Page: "IELTS (Academic): overall min. score 6.5 (min. 6.0 in every category)"; TOEFL iBT 90 | Requirement **missing** (see [OPUS-007](#opus-007)). |
| `dtu-ge` | English note says DTU's IELTS/TOEFL equivalences "were not on the verified page"; subjects include "Physics B or Geoscience A; Chemistry B or Biotechnology A" | Admission-requirements page lists IELTS 6.5, C1 180, TOEFL 88, and "Mathematics A-level, English B-level, Physics B-level, Chemistry B-level" | Note is wrong; the subject alternatives are **unverified** (they may come from DTU's conversion table, which was not fetched). |
| `cvut-informatics` | EU fee `?` (renders "Not published") | https://fit.cvut.cz/en/applicants/admissions-procedure/bachelor-study-program : "tuition fee of CZK 64,000 (approx. EUR 2,600 …) for the first semester" | A published figure is hidden. |
| `sapienza-bioinfo` (and 9 other Sapienza rows) | `official_url` = the generic call index | Programme facts are in a separate PDF call (`…/12952_bioinformatics_en_0.pdf`) | Link is not programme-specific ([OPUS-028](#opus-028)). |
| `tud-cse` | `official_url` is a VWO-oriented page | The IB-specific statement ("only accepts … Analysis & Approaches HL") is on `…/bsc-international-diploma/admission-requirements/specific-diploma-requirements` | Fact is correct but the link does not show it. |
| `muni-en-economics-and-public-policy` | Fee labelled "Tuition (EU)" €4,110 | Page gives one fee, 100,000 CZK, with no EU/non-EU split; there is also a February intake closing 31 Oct 2026 | Labelling only. The February intake is irrelevant to May IB graduates. Low. |

  - **Matched (selection):**
    - Dutch statutory fee €2,771 (UvA, RUG, Twente).
    - Deadlines: TU Delft 15 Jan and Maths AA HL; UvA EBE 15 Jan and 550 places.
    - Charles 1st Faculty Medicine: 30 Apr 2027, €24,250, IB waiver wording.
    - Bocconi €17,700 and ~3,000 places; CBS 15 March, 24 points, subject list.
    - AU Cognitive Science subjects and Danish-switch warning; DTU 24 points.
    - VŠE €6,000; ČVUT 31 March and maths test; MUNI IB 28+ Maths 4+.
    - UL LM125 433; UCC, Galway and UL 1 Feb CAO dates.
  - **Worker claims rejected by the driver:**
    - CAO "differences" such as UCC 541 vs 543 and Galway 530 vs 534 are Round-2 vs Round-1 by design (raised in [OPUS-001](#opus-001)).
    - The Trinity fee "difference" reflects the Free Fees design and is handled in [OPUS-009](#opus-009).
- **Impact:** a student told "numerus fixus" for Groningen UCG prepares for a lottery-style process that does not exist. One taking IB in French or Spanish could under-prepare English.
- **Recommended change:** correct the rows above, then re-sample about 10 rows per university family, prioritising high-traffic programmes and university-level defaults (one Trinity default affects 83 rows).
- **Acceptance criteria:** the listed rows match their sources, and a dated re-sampling log is recorded in STATUS.md.
- **Related:** [OPUS-004](#opus-004), [OPUS-007](#opus-007), [OPUS-008](#opus-008), [OPUS-039](#opus-039).

<a id="opus-007"></a>
### OPUS-007 — Missing requirement data reads as "nothing needed"

- **Type/status:** Confirmed (data and render logic).
- **Priority:** P2. The project's own rule ("blank must never read as nothing to meet", MAINTENANCE.md, ib_subjects) is applied to subjects but not to language or admission.
- **Effort:** S (render) plus M (data).
- **Location/evidence:**
  - `js/render.js:147-150` only renders the "Language" row when `englishRequirement` is non-empty. There is no "Not checked yet" state, unlike subjects at `js/render.js:138-140`.
  - **No language row at all: 610 of 1,242 cards.**
    - 312 English-taught rows (all 70 DCU rows, 28 RUG, 24 UvA, 23 VU, 22 Maastricht, 18 Leiden, …). Only TU Delft and WUR have a Dutch university default.
    - 298 Czech-taught rows with no Czech-proficiency statement (MUNI 132, Charles 84, VUT 37, ČVUT 33, VŠE 12). By contrast, 76 Czech rows *do* say e.g. "Proof of Czech or Slovak, e.g. a Slovak-language maturita exam".
    - Three Czech-taught VŠE rows say "No Czech certificate required" (`vse-ekonomie`, `vse-narodni-hospodarstvi`, `vse-verejna-sprava-a-regionalni-rozvoj`). Requires verification.
  - **Admission `?`:** `inheritText()` (`js/data.js:274-278`) turns `?` into an empty string, so the Admission line silently disappears. Four rows: `lei-archaeology`, `lei-iro`, `lei-luc`, `uu-ucr`.
  - **Latent:** an English `?` combined with `ib_subjects=none` would print "No requirements beyond <baseline>" (`js/render.js:97-110`). No row hits this today.
- **Impact:**
  - An applicant sees no English requirement on a Groningen card although Groningen requires IELTS 6.5 ([OPUS-005](#opus-005)).
  - A non-Slovak IB student sees Czech-taught programmes with no hint that Czech/Slovak proof is required.
- **Recommended change:**
  - Render "Language requirement: not checked yet" when it is blank.
  - Render `?` as "Unknown — check the official page" for admission and English, matching tuition.
  - Fill university-level English defaults for the 11 Dutch universities, a single cell each.
  - Add a default Czech-proficiency line to the Czech universities for Czech-taught rows.
- **Acceptance criteria:**
  - Every card shows a language-requirement state.
  - A `?` cell never makes a row disappear.
  - A `check.mjs` test covers the latent "No requirements beyond" case.
- **Related:** [OPUS-005](#opus-005), [OPUS-043](#opus-043).

<a id="opus-008"></a>
### OPUS-008 — Internal or self-contradictory notes are shown to students

- **Type/status:** Confirmed. Detectable offline, with no network check needed.
- **Priority:** P2. These are on deadline-adjacent text, which a student reads as authoritative.
- **Effort:** S (fix the rows and add a lint, [OPUS-039](#opus-039)).
- **Evidence (`data/programmes.csv`):**
  - **`rug-ucg` (line 86):** the note contradicts the date field ([OPUS-005](#opus-005)).
  - **18 UvA rows (e.g. `uva-hgp`, line 100):** the Deadline field shows **1 April 2027**. The note explains this applies only to applicants wanting UvA housing and that the general deadline is 1 May. Official UvA page (Business Analytics, accessed 2026-10-25): "UvA Housing 1 April 2027 / not applying for housing 1 May 2027". This is conservative, but it hides the real deadline.
  - **`uva-auc` (line 101):** a date of 1 Feb 2027 alongside "2027 dates not yet published."
  - **13 TU/e rows (e.g. `tue-am`, line 46):** the note promises TU/e "will confirm by 1 October 2026" — a date already past on 2026-10-25 — and says the deadline may move to 15 January. The field says 1 May.
  - **"CONFIRM" visible in notes:** `uu-ppe` (line 198: "CONFIRM which one is the application deadline"), `vu-las` (line 133), `lei-iro`, `lei-polsci`. Overall, 4 notes contain uppercase "CONFIRM" and 39 contain "confirm" in some form, e.g. `eur-ibhistory`: "the History page doesn't state a date — confirm."
  - **`vu-ppe`:** "Early-bird 14 February" vs field 1 May (requires verification).
- **Impact:** maintainer to-dos read as hedged advice, and contradictory dates force the student to guess.
- **Recommended change:** resolve each row. Separate an internal `maintainer_notes` column, never rendered, from the student-facing `deadline_notes`. Add a lint that fails on "CONFIRM", on past "by <date>" promises, and on notes naming a different deadline date than the field.
- **Acceptance criteria:** none of these patterns remain, and the lint runs in `check.mjs`.
- **Related:** [OPUS-039](#opus-039), [OPUS-044](#opus-044).

<a id="opus-009"></a>
### OPUS-009 — Irish fee is one Free Fees figure with no eligibility condition or academic year, and the year basis is inconsistent

- **Type/status:** Confirmed (presentation); suspected / requires verification (which 2027/28 figure is correct).
- **Priority:** P2. Cost drives decisions. The amounts in question are small (about €150) where the student is eligible for Free Fees, and large (about €3,000–4,800) where they are not.
- **Effort:** S.
- **Evidence:**
  - **Fee basis by design:** STATUS.md records the "contribution + levy" basis deliberately, with a 2026/27 table (e.g. Trinity €2,814 = €2,500 + €314).
  - **Trinity's own 2027/28 table:** "EU Student Contribution €2,350.00" on every course (https://www.tcd.ie/courses/undergraduate/fees/, driver-verified 2026-10-25).
  - **The dataset mixes bases:**
    - Galway uses €2,500 (= €2,350 + €150, 2027/28 basis per its course pages).
    - The other six universities use €2,500 + levy.
  - **UCC's sources disagree.** Its 2027/28 schedule example gives "overall fee of €2,714" (€2,500 + €214), while the dataset has €2,710, the 2026/27 figure. https://www.ucc.ie/en/financeoffice/fees/schedules/euundergraduatefees202728/
  - **Official sources disagree on the 2027/28 contribution** (€2,350 at Trinity vs €2,500 at UCC). This needs a human check against the HEA or Department source.
  - **Non-Free-Fees totals are much higher:**
    - UL: "Students with EU fee status not in receipt of a grant … Total €7,366".
    - Galway: "Total EU Fee €5,748".
    - Trinity Biomedical Engineering: €7,332 total.

    The card says only "Tuition (EU) €2,814 / year" (`js/render.js:64-68`).
- **Impact:** students who don't meet the three-of-five-years EU residence test are shown a fee several thousand euro below what they would pay. A Slovak student schooled in Slovakia normally qualifies, so the realistic risk is to unusual residence histories. Every student also compares fees from mixed academic years.
- **Recommended change:**
  - Label the figure: "€2,814 / year if eligible for Irish Free Fees (most EU students), 2026/27".
  - Add a one-line link to the eligibility rule.
  - Record `fee_year` per row or university and display it.
  - Re-base all seven universities to one academic year once the contribution amount is confirmed.
- **Acceptance criteria:**
  - Irish fee cards state the condition and the year.
  - All Irish rows share one fee year.
- **Related:** [OPUS-042](#opus-042), [OPUS-044](#opus-044).

<a id="opus-014"></a>
### OPUS-014 — Subject-area taxonomy is fragmented, so subject filters miss programmes

- **Type/status:** Confirmed.
- **Priority:** P2. The subject filter is a primary discovery tool.
- **Effort:** S.
- **Evidence:**
  - **46 distinct facet values; 23 are used by 1–7 rows.** Most came from the Italy/Denmark merge (`tools/merge-italy-denmark.mjs`). Variants:

    | One-off value | Rows | Canonical value it duplicates | Rows |
    |---|---|---|---|
    | "Business" | 1 | "Business & Management" | 143 |
    | "Languages" | 1 | "Languages & Literature" | 130 |
    | "Anthropology" | 1 | "Sociology & Anthropology" | 52 |
    | "Software Engineering", "Artificial Intelligence", "Mechatronics", "Industrial Electronics", "Energy/Chemical/Electrical/Mechanical Engineering" | 1–2 each | — | — |
    | "Social Sciences" | 7 | — | — |
    | "Humanities" | 5 | — | — |
    | "Finance" | 3 | — | — |
    | "Design & Architecture" | 3 | — | — |

  - **Catch-all:** the Irish keyword map falls back to "Liberal Arts" (`tools/lib/ireland.mjs`, `SUBJ`, final fallback). 49 rows use it, including "Science", "Animal Science", "Dentistry" (UCC), "Cyber Security and IT Forensics" and "Irish Dance".
  - **Out of date:** `index.html:108` still says "23 subject areas", and MAINTENANCE.md lists 22.
- **Impact:** a student filtering "Computer Science" misses a programme tagged only "Software Engineering", and one filtering "Biology & Life Sciences" misses Irish science degrees filed under Liberal Arts.
- **Recommended change:**
  - Define a closed vocabulary (the 22–23 documented areas) in one place.
  - Map the one-off values onto it.
  - Make `check.mjs` reject unknown values.
  - Improve the keyword map and remove the Liberal Arts catch-all, leaving unknowns visibly "Unclassified".
- **Acceptance criteria:** the facet list matches the documented vocabulary exactly, and no science or dentistry course is filed under Liberal Arts.

<a id="opus-015"></a>
### OPUS-015 — Indistinguishable duplicate cards

- **Type/status:** Confirmed (driver-verified for Charles Medicine).
- **Priority:** P2.
- **Effort:** S (add a `faculty`/`campus`/`variant` column and render it).
- **Evidence:**
  - **17 groups and 45 rows share a programme name within one university.**
  - **Charles "General Medicine" ×5:**
    - `-2`, `-3` and `-4` render as "General Medicine · Charles University · Prague, Czechia".
    - `-3` and `-4` have no deadline.
    - The faculty (1st, 2nd, 3rd) is not shown.
    - Only `cuni-general-medicine` (Plzeň) and `-5` (Hradec Králové) differ by city.
  - **Same pattern elsewhere:**
    - Charles: Všeobecné lékařství ×5, Dentistry ×3, Zubní lékařství ×3, Fyzioterapie ×4.
    - MUNI: Psychology ×2, Physiotherapy ×2.
    - UCD: "Information & Communication Studies" ×2 (different majors), plus "Computer Science" vs "Computer Science Course" (same CAO code DN201).
- **Impact:** students cannot tell which card is which faculty and may think the list is buggy. Faculty matters here, because entrance exam, fee and deadline differ.
- **Recommended change:** add and render a faculty/campus line, and collapse same-CAO-code variants or label them "shared CAO code DN201".
- **Acceptance criteria:** no two cards from the same university have identical title, university and place lines.

<a id="opus-027"></a>
### OPUS-027 — Scraped boilerplate inside Trinity subject requirements

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** S.
- **Evidence:**
  - 23 rows have `ib_subjects` longer than 250 characters (up to 900).
  - 11 Trinity rows contain non-subject text. Examples: `tcd-dental-science` includes health screening, Garda vetting, "you can learn more here ." and a dental-kit purchase; nursing and midwifery rows are 850–900 characters.
  - The Subjects row renders it verbatim (`js/render.js:136-137`).
  - The subject text of TCD science rows also lost punctuation ("SL Grade 5 Mathematics HL Grade 5 in two of …").
- **Fix:** trim in the importer and move non-subject conditions to `other_requirements`. Clamp long text to about 3 lines with "Show more".
- **Acceptance:** no `ib_subjects` cell contains "learn more here", and no cell is over 300 characters without review.

<a id="opus-028"></a>
### OPUS-028 — Official-link precision

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** S.
- **Evidence:**
  - 1,150 distinct URLs serve 1,242 rows. 20 URLs are shared by 112 rows: VUT FEKT ×11, ČVUT FJFI ×11, VUT FME ×10, the Sapienza call index ×10, PoliTo ×6.
  - `vse-en-economics-of-markets-and-organization` points at a homepage.
  - One URL is `http:` (`vut-fundamentals-of-mechanical-engineering`, CSV line 1065). It redirects to https.
  - `safeUrl()` accepts `http:` (`js/data.js:305`), while its own error message says links "must start with https://" (`js/data.js:316`), as do MAINTENANCE.md lines 77 and 294–295.
- **Fix:** point to programme-level pages where they exist; reject or upgrade `http:` and make the message match.
- **Acceptance:** 0 `http:` links, the message matches the rule, and shared URLs are reviewed.

### UX and journeys

<a id="opus-006"></a>
### OPUS-006 — Search is one contiguous substring over four fields

- **Type/status:** Confirmed.
- **Priority:** P2. Search is the first control, and natural queries return nothing. The filters provide a workaround, so this is not P1.
- **Effort:** S.
- **Location:** `js/data.js:225-227` builds `searchBlob` from programme, university, city and country only. `js/filters.js:34,39` does `blob.includes(needle)`.
- **Reproduction:**

  | Query | Results | Why |
  |---|---|---|
  | "uva economics", "trinity computer science", "psychology amsterdam", "medicine prague" | 0 | Words must appear in this order, contiguously ("computer science trinity" → 1) |
  | "TU Delft", "UvA", "UCD", "TCD", "Praha", "Holland", "maths", "nurse" | 0 | No aliases or stems |
  | "medicine" | 17 | Subject area not searched; the "Medicine & Health" area has 150 rows |
  | "cs" | 182 | Matches inside "Physics" / "Economics" |
  | "é" | all 1,242 | Folds to "e" |

  Accent folding otherwise works ("VŠE" finds 10).
- **Impact:** students conclude the site lacks programmes it has, and the empty state blames tuition or country ([OPUS-021](#opus-021)).
- **Recommended change:**
  - Tokenise and AND the tokens in any order.
  - Add subject areas, degree type and language to the blob.
  - Add an `aliases` column on universities (UvA, TU Delft, UCD, TCD, CBS, DTU, ČVUT/CTU, MUNI) and a small city alias map (Praha/Prague).
  - Require word boundaries for tokens of three characters or fewer.
- **Acceptance criteria:**
  - "uva economics", "trinity computer science", "tu delft", "ucd" and "praha" each return relevant rows.
  - "cs" does not return Physics.

<a id="opus-010"></a>
### OPUS-010 — No URL or persisted state: reload loses everything, and nothing can be shared

- **Type/status:** Confirmed (no `location`, `history` or `URLSearchParams` usage in `js/`).
- **Priority:** P2. The audience works in pairs and with parents and counsellors. Losing a 6-filter setup on an accidental refresh is costly, and STATUS.md notes the compare view needs "a different way to pick programmes".
- **Effort:** S.
- **Reproduction:** set points, fee and subjects, then reload. Everything resets, and Back leaves the site.
- **Recommended change:** serialise filters and sort into `location.search` with `history.replaceState`, read them on load, and validate unknown values.
- **Acceptance criteria:** reload restores the filtered view, and a copied URL reproduces it in a fresh browser.
- **Related:** [OPUS-040](#opus-040).

<a id="opus-011"></a>
### OPUS-011 — All 1,242 cards render at once

- **Type/status:** Confirmed by measurement.
- **Priority:** P2. Mobile responsiveness and navigability.
- **Effort:** M.
- **Location:** `js/render.js:16-18` (`container.replaceChildren(...rows.map(card))`), called on every debounced input from `js/app.js:206`.
- **Measurements:**

  | Metric | Value |
  |---|---|
  | DOM elements | 46,125 |
  | Page height | 426,875 px desktop / 854,449 px mobile (~1,050 phone screens) |
  | Mobile, 4× CPU: clearing a filter or typing "a" | 244–362 ms script, 406–540 ms to next frame, long tasks up to 322 ms |
  | Desktop, same action | 112–137 ms to next frame |
  | First card on throttled mobile, live GitHub Pages | 2.3 s |

  `content-visibility: auto` (`css/styles.css:511`) is doing essential work. With it forced off, a full re-render took 5,040 ms on mobile.
- **Impact:**
  - Laggy filtering on phones.
  - The footer disclaimer and the "Spreadsheet problems" panel sit after 1,242 cards and are effectively unreachable.
  - Scanning 100+ dense cards is slow.
- **Recommended change:** render the first ~50 cards and add more on scroll or with "Show more"; cache built card nodes by id instead of rebuilding them. Consider a compact list/table view and moving footer content up.
- **Acceptance criteria:** initial DOM under ~5,000 elements, and keystroke-to-frame under 100 ms on 4× CPU.
- **Related:** [OPUS-022](#opus-022) (print of everything).

<a id="opus-031"></a>
### OPUS-031 — The default sort steers the opening screen away from the typical journey

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** S.
- **Evidence:**
  - **Deadline sort:** "Deadline — soonest first" (`js/filters.js:14`, comparator `:81-87`) opens on VUT Design, VUT Volné umění and ČVUT Architektura a urbanismus. These are Czech-taught portfolio programmes due 30 Nov 2026, and the only "urgent" rows.
  - **Date ties:** 813 rows share 1 Feb 2027 (CAO), so "soonest first" is effectively a country sort.
  - **Tuition sort:** opens on 396 rows at €0 (371 Czech-taught, 25 Danish).
  - **Points sort:** ties 90 rows at 24.
  - **Language:** 374 of 1,242 rows are Czech-taught, and nothing asks which languages the student can study in.
- **Fix:** ask for or remember study languages ([OPUS-043](#opus-043)), group deadlines by band ([OPUS-041](#opus-041)), and add secondary sort keys.

<a id="opus-021"></a>
### OPUS-021 — Empty-state copy is generic, stale or meant for editors

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** XS.
- **Evidence:**
  - `js/app.js:250` always says "Try raising the tuition limit, or removing a country", even for a search typo, a subject+language combination, or a points filter.
  - `js/app.js:247` tells students "Add some rows to the Google Sheet and reload."
  - `js/app.js:244` refers to a bookmark button that no longer exists. It is unreachable today.
  - There is no Clear-all action inside the empty state.
- **Fix:** derive the hint from the active filters (e.g. "0 with this search; 12 if you remove 'Language: English'"), add a Clear button inside the empty state, and give students their own copy.

<a id="opus-022"></a>
### OPUS-022 — Dead shortlist path, and print is no longer scoped

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** S.
- **Evidence:**
  - `js/app.js:231` always hides `#shortlist-bar`. The handlers at `js/app.js:145-176`, `js/shortlist.js`, `index.html:184-203`, the bookmark sprites, and `loadShortlist()` at start-up remain.
  - The print handler comment (`js/app.js:156-157`) assumes shortlist scoping. Ctrl+P now prints whatever is visible: unfiltered, that is 1,242 cards and about 680 A4 pages (7.2 MB PDF).
  - The printout does not state the filters or the count.
  - `.card-title { color:#000 }` (`css/styles.css:919`) loses to `.c-czechia .card-title` (`:532`), so titles print in tint colours.
- **Fix:** either delete the dead code or keep it behind a flag with a test. Print a header line with the count and active filters, warn above about 50 cards, and raise the print selector's specificity.
- **Related:** [OPUS-035](#opus-035), [OPUS-040](#opus-040).

### UI and responsive design

<a id="opus-013"></a>
### OPUS-013 — Dropdown panels overflow the viewport on phones

- **Type/status:** Confirmed (driver-verified at 375×812).
- **Priority:** P2. This is a core control on the likely device, and it fails WCAG 1.4.10 Reflow.
- **Effort:** XS.
- **Location:**
  - `css/styles.css:339-347`: `.dropdown-panel { left: 0; width: max-content; min-width: 15rem; max-width: min(22rem, calc(100vw - 2.5rem)) }`. The max-width ignores the summary's horizontal offset.
  - `css/styles.css:186-195`: `.masthead-stat { white-space: nowrap }`.
- **Reproduction:**
  - At 375×812, open Country. The panel spans x = 185 → 425 and `scrollWidth` becomes 425, so the page scrolls sideways.
  - At 320×640, `scrollWidth` is already 352 with nothing open (the masthead stat is clipped "…5 COUNT"), and the Language panel reaches 395.
- **Fix:** right-align panels that would overflow, or use a full-width sheet below 720 px; let the stat wrap.
- **Acceptance criteria:** at 320 and 375 px, `scrollWidth === innerWidth` with each dropdown open.

<a id="opus-030"></a>
### OPUS-030 — The same concept carries different labels

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** XS.
- **Evidence:**

  | Concept | Labels in use |
  |---|---|
  | Fee | "Max fee €/yr" (`index.html:131`), "Tuition (EU) … / year" (`js/render.js:64-68`), "Tuition — cheapest first" (`js/filters.js:67`) |
  | Points | "My points" (`index.html:124`), "IB points" (`js/render.js:129`, `js/filters.js:68`) |
  | Subject area vs requirement | "Subject area" filter vs "Subjects" requirement row: two different concepts, one word |
  | Language | "Language" filter (language of instruction); "Taught in" card row; "Language" requirement row (English proficiency). A card reads "Taught in: English … Language: IELTS 6.5". |

  - `degree_type` is blank on 538 rows (409 Irish), so most Irish cards show no degree.
  - Counts are not thousands-separated (`js/app.js:94`, `:217`).
  - Notes mix date formats ("23.10.2026", "1 Oct 2026").
- **Fix:** use one term per concept, e.g. "EU tuition / year", "IB points", "Field of study" vs "Subject requirements", and "Language of instruction" vs "Language requirement".

### Usability and accessibility

<a id="opus-017"></a>
### OPUS-017 — Past-deadline cards are dimmed into a contrast failure

- **Type/status:** Confirmed with a simulated clock. Latent today (0 past deadlines).
- **Priority:** P2. With the clock at 2027-02-15, **587 of 1,242** cards are dimmed. The first deadline passes on 2026-11-30. WCAG 1.4.3.
- **Effort:** XS.
- **Location:** `css/styles.css:540` (`.card.is-past { opacity: 0.65 }`) and `:541` (only `:hover` restores it). The class is set in `js/render.js:31`.
- **Measured (blended over white):**

  | Element | Contrast |
  |---|---|
  | Labels and sub-notes | 2.75–2.87:1 |
  | "Official admissions page" link | 2.72–2.84:1 |
  | Red "passed" date | 3.47–3.63:1 |

  `tools/check-contrast.mjs` does not model opacity, and keyboard focus does not restore it.
- **Also:** there is no "hide passed" control and no intake-year label. After February, half the list will say "passed — check the next cycle" (see [OPUS-044](#opus-044)).
- **Fix:** remove the opacity and rely on the existing "passed" badge, optionally with a muted title colour that stays at 4.5:1 or above. Add a "Hide passed deadlines" toggle and extend the contrast tool to the past state.
- **Acceptance criteria:** with the clock set past a deadline, all text in a past card is at least 4.5:1.

<a id="opus-018"></a>
### OPUS-018 — Input typed while data is loading is ignored

- **Type/status:** Confirmed.
- **Priority:** P2. On a throttled phone the first card arrives after 2–4 s, and the UI then shows a filter that isn't applied.
- **Effort:** XS.
- **Location:** `js/app.js:70`. `wireInputs()` runs only after `loadData()` resolves, yet the inputs (`index.html:118-135`) are enabled from first paint, and `update()` reads the in-memory `state`, not the DOM.
- **Reproduction:** delay the CSVs by 3 s and type "law" into Search. After load the field still shows "law", but the page reports "1242 programmes".
- **Fix:** read the input values into `state` before the first `update()`, or disable the inputs until data arrives.
- **Acceptance criteria:** text typed during load is reflected in the first results.

<a id="opus-019"></a>
### OPUS-019 — Filter instructions live only in tooltips

- **Type/status:** Confirmed. **Priority:** P2. **Effort:** XS.
- **Location:** `index.html:127` (`title="Shows programmes asking for this many IB points or fewer"`) and `index.html:134` (`title="The EU-student fee"`).
- **Impact:** touch users never see these (WCAG 3.3.2). "Max fee €/yr" does not say it is the EU fee.
- **Fix:** give short visible helper text linked with `aria-describedby`, and use the label "Max EU tuition €/yr". Input validation is covered in [OPUS-003](#opus-003).

<a id="opus-023"></a>
### OPUS-023 — The sticky filter bar obscures content

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** XS.
- **Location:** `css/styles.css:852`. The bar is sticky at widths ≥ 720 px, with no height condition.
- **Reproduction:**
  - "Skip to results" scrolls `#results` to y = 0 under the 111 px bar, hiding the first card's title.
  - At 812×375 (landscape phone) the bar takes 46% of the viewport.
- **Fix:** set `scroll-padding-top` to the bar height, and add `(min-height: 600px)` to the sticky media query.

<a id="opus-024"></a>
### OPUS-024 — Dropdown and live-region keyboard and screen-reader rough edges

- **Type/status:** Confirmed behaviour. Screen-reader effects are inferred from the Chromium accessibility tree.
- **Priority:** P3. **Effort:** S.
- **Evidence:**
  - **Tab-out:** a panel stays open when focus Tabs out of it (`js/app.js:257-273` closes only on outside click or Escape).
  - **Escape:** the global Escape listener moves focus to the open summary even when focus is in Search.
  - **Unlabelled count:** the summary's accessible name is "Subject area 2" (`index.html:141,151,161`).
  - **Live region:** `#result-count` (`aria-live`) is rewritten on every debounce. Typing "engineering" produced 11 updates, 8 of them with identical text (`js/app.js:215-217`).
- **Fix:**
  - Close the panel on `focusout` outside the dropdown.
  - Scope the Escape handler to open dropdowns.
  - Add visually hidden text such as "2 selected".
  - Write the live region only when its text changes.

<a id="opus-025"></a>
### OPUS-025 — Accessible-name and semantics artefacts

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** S.
- **Evidence:**
  - **Card title:** the h2 reads "Architektura a urbanismusBc.", with no separator between the title and the degree (`js/render.js:37-39`).
  - **h1:** the accessible name includes the `::after` full stop. The comment at `css/styles.css:175-177` claims otherwise.
  - **Labels:** uppercase via `text-transform` leaks into names ("MY POINTS").
  - **Facts list:** empty `<dt>` elements from `fact(facts, '', …)` (`js/render.js:61,63`).
  - **Links:** 1,242 identically named "Official admissions page" links, which open new tabs without saying so.
  - **Cards:** `<article>` elements have no accessible name.
  - **Language of parts:** no `lang` on 424 Czech titles (WCAG 3.1.2).
  - **Degree badge:** inherits the serif face against the STATUS.md design rule.
- **Fix:**
  - Add a separator or hidden ", " before the degree.
  - Use `content: "." / ""` for the full stop.
  - Put notes inside the Deadline `dd`.
  - Add hidden link text naming the programme and "(opens in new tab)".
  - Add `aria-labelledby` from each article to its title.
  - Add `lang="cs"` to Czech-taught titles.

<a id="opus-026"></a>
### OPUS-026 — Weak focus indicator on text inputs and select

- **Type/status:** Confirmed values. **Priority:** P3. **Effort:** XS.
- **Location:** `css/styles.css:400-404`. `outline: none` is replaced by a 1 px rose border and a 3 px `--accent-soft` ring, which is 1.04:1 against `--surface`.
- **Context:** links, buttons, summaries and checkboxes use a 2 px blue outline at 5.3:1 or better. Idle control borders (`#e6e2da`) are 1.2–1.3:1 (suspected WCAG 1.4.11).
- **Fix:** use the 2 px blue `:focus-visible` outline everywhere, and give control borders at least 3:1.

### Security and privacy

<a id="opus-029"></a>
### OPUS-029 — Any Sheet editor can point official links at lookalike domains

- **Type/status:** Confirmed mechanism.
- **Priority:** P3 today; P2 once the Google Sheet is live. Practical risk depends on who has edit rights.
- **Effort:** S.
- **Location:** `safeUrl()` (`js/data.js:300-309`) accepts any http(s) URL, and the link label is fixed text with no hostname shown (`js/render.js:198-206`).
- **Evidence:**
  - **Accepted:**
    - `https://www.ucd.ie@evil.example/` (userinfo)
    - `https://www.ucd.ie.evil.example/` (lookalike suffix)
    - an IDN homograph (`ucdі.ie` with a Cyrillic і)
  - **Correctly rejected:** `javascript:`, `data:`, `vbscript:`, `blob:`, protocol-relative URLs, and control characters.
  - **Current data:** all 1,242 URLs are on 37 university-owned registrable domains.
- **Impact:** an editor (or a compromised editor account) could send applicants to a phishing "application portal" carrying the site's endorsement.
- **Fix:**
  - Add an `official_domains` column on universities and report any programme URL outside it as an issue.
  - Reject URLs with userinfo.
  - Optionally show the hostname next to the link.
  - Document that Sheet edit access is limited to named accounts.
- **Acceptance criteria:** the three examples above are rejected and reported, and current data passes with 0 issues.

<a id="opus-016"></a>
### OPUS-016 — Google Fonts blocks rendering and shares visitor IPs with Google

- **Type/status:** Confirmed.
- **Priority:** P2. Performance and reliability on filtered or slow school networks, plus a privacy consideration.
- **Effort:** S.
- **Location:** `index.html:17` is a render-blocking stylesheet. The comment at `index.html:10-14` says the page "still renders immediately" if fonts are slow, which is incorrect.
- **Measured:**

  | Fonts CSS state | First Contentful Paint |
  |---|---|
  | Aborted | 80 ms |
  | Hanging 8 s | **8,072 ms** (blank page) |
  | Normal | Fonts CSS takes 354–502 ms |

- **Privacy:**
  - Every visit sends the visitor's IP to fonts.googleapis.com and fonts.gstatic.com. The audience is EU students, many of them minors.
  - LG München I (3 O 17493/20, 20 Jan 2022) held that remotely embedding Google Fonts without consent unlawfully disclosed IP addresses. This is a consideration, not legal advice.
  - Otherwise: no analytics, no cookies, and no other third parties.
- **Fix:** self-host the three woff2 files (~99 KB) with `font-display: swap`. This removes both problems and simplifies a CSP.
- **Acceptance criteria:** with Google hosts hanging, FCP is under 1 s, and no third-party request happens on load.

<a id="opus-034"></a>
### OPUS-034 — The dev server serves `.git/` and listens on all interfaces

- **Type/status:** Confirmed (localhost tests). **Priority:** P3 (development only). **Effort:** XS.
- **Location:** `tools/serve.mjs`.
  - Traversal is correctly blocked (`:60-66`). `/../../etc/passwd` and the encoded variants return 404 or 403.
  - `/.git/config` and `/.git/HEAD` return 200.
  - `.listen(port, …)` at `:75` has no host argument, so Node binds all interfaces. This is inferred from Node's defaults and not confirmed with a socket listing.
  - A malformed escape returns a 500.
- **Impact:** on school Wi-Fi, a running dev server exposes the repository and its history to the local network.
- **Fix:** `.listen(port, '127.0.0.1')`, and refuse dot-segments.

<a id="opus-035"></a>
### OPUS-035 — CSV export does not neutralise spreadsheet formulas

- **Type/status:** Confirmed in code. Dormant: the export button is unreachable ([OPUS-022](#opus-022)).
- **Priority:** P3. **Effort:** XS.
- **Location:** `js/shortlist.js:62-64` quotes only `" , \r \n`. Cells starting with `= + - @` are exported as-is. No current data cell starts that way.
- **Fix:** prefix `'` to such cells if export returns.

<a id="opus-036"></a>
### OPUS-036 — Importer etiquette

- **Type/status:** Confirmed. **Priority:** P3. **Effort:** XS.
- **Evidence:**
  - `tools/lib/ireland.mjs` and `tools/import-cuni.mjs` send a Chrome user-agent, because some sites 403 Node's default.
  - The importers make sequential requests with no delay and no robots.txt check, at about 200 pages per university.
  - The UCD importer's long `p_parameters` value (`tools/import-ucd.mjs:28`) is, per its comment, a public course-browser query rather than a credential. Its value is not reproduced here.
  - `--use-system-ca` still verifies TLS.
  - A full-history secret scan found nothing.
- **Fix:** use an honest UA with a contact address, add a small delay, and respect robots.txt.

### Performance and reliability

<a id="opus-012"></a>
### OPUS-012 — No guard against a degraded live sheet

- **Type/status:** Confirmed by request interception (`page.route`).
- **Priority:** P2. Dormant today because `SHEET_CSV_URLS` is empty, but it blocks STATUS.md job #3 (connect the Sheet). Once live, one student edit can silently blank site-wide data.
- **Effort:** M.
- **Evidence:**
  - **Renamed headers:** `csvToObjects` keys cells by whatever header exists (`js/csv.js:66,79`). With `official_url` and `application_deadline` renamed, all 1,242 cards said "No official link on file" and "Not published", with 0 issues reported and no banner.
  - **Empty or HTML programmes CSV:** a 200 with a one-line HTML body, or a header-only CSV, gives 0 cards and "No programmes in the spreadsheet yet". There is no snapshot fallback, because `js/data.js:231-233` throws only when rows existed and all failed.
  - **Truncated CSV:** 579 of 1,242 cards, and "579 programmes" in the masthead. The only signal is a collapsed "1 spreadsheet problem" panel after the last card (`index.html:221-225`).
  - **No timeout:** `fetch(url, { cache: 'no-cache' })` at `js/data.js:75` has none. A slow response leaves skeletons on screen indefinitely, and the snapshot is never tried.
  - **Works correctly:** 404s, aborted requests and multi-line HTML bodies fall back to the snapshot with a clear banner.
- **Fix:**
  - Check required headers per tab and throw if any is missing, which triggers the fallback and records an issue.
  - Treat 0 data rows, or a non-CSV body, as a failure.
  - Fall back, or show a loud banner, if the row count drops below ~50% of the snapshot's.
  - Set `AbortSignal.timeout(8000)` on live fetches.
  - Raise a visible banner whenever issues exist.
- **Acceptance criteria:** each scenario above ends in either the snapshot plus banner or a visible warning, never a quiet partial page. `check.mjs` covers each.
- **Related:** [OPUS-020](#opus-020), [OPUS-033](#opus-033).

<a id="opus-020"></a>
### OPUS-020 — The total-failure state is technical and leaves dead controls

- **Type/status:** Confirmed. **Priority:** P3 (rare path). **Effort:** S.
- **Location:**
  - `js/data.js:52`: `await (await fetch(SNAPSHOT_URL)).json()` has no `res.ok` check.
  - `js/app.js:72-75` interpolates `err.message`.
- **Reproduction:** with the CSVs and `fallback.json` all returning 404 HTML, the banner reads: `Could not load any university data (Unexpected token '<', "<h1>404</h1>" is not valid JSON). Try reloading.`
  - The original CSV failure reasons are lost.
  - The filters stay enabled but inert: the Sort select has 0 options, the dropdowns are empty, and Clear all is enabled.
  - There is no empty state and no Retry action.
  - The banner is `role=status` (polite).
- **Fix:**
  - Check `res.ok`.
  - Use plain-language copy with a Retry button and `role="alert"`.
  - Disable or hide the filters.
  - Keep the failure list in the issues panel.

<a id="opus-033"></a>
### OPUS-033 — No CI, and `check.mjs` coverage gaps

- **Type/status:** Confirmed (there is no `.github/` directory). **Priority:** P3. **Effort:** S.
- **Gaps in `check.mjs`:**
  - required headers
  - empty, HTML and truncated responses
  - the fetch-failure → snapshot path
  - `fallback.json` ↔ CSV parity (in sync today, but unenforced)
  - `safeUrl` handling of userinfo, `http:` and IDN
  - formula escaping
  - subject-area vocabulary
  - note-vs-field contradictions
  - any DOM or render test
- **Fix:** a GitHub Actions workflow running `node tools/check.mjs` and `node tools/check-contrast.mjs` on push and PR, plus the tests named in the related findings.

### Documentation

<a id="opus-032"></a>
### OPUS-032 — Documentation drift

- **Type/status:** Confirmed. **Priority:** P3. These docs are explicitly written for non-coders taking the project over, so drift has a real cost. **Effort:** S. Better still, generate the counts with a script.
- **Evidence:**
  - **Counts in STATUS.md:**

    | Location | Says | Actual |
    |---|---|---|
    | STATUS.md:11 | 1,245 programmes | 1,242 |
    | STATUS.md:15 | Netherlands 202 | 199 |
    | Several places | "555 Irish rows" | 548 |
    | STATUS.md:72, 80, 126, 136, 171, 442 | 757 | — (stale; pre-Czechia NL+IE count) |
    | STATUS.md:398 | 45 checks | 49 |
    | STATUS.md:195 | 29 pairs | 44 |
    | STATUS.md:136 | 19 rows with no deadline | 5 (contradicts STATUS.md:123) |
    | STATUS.md:343 | 1 Dutch points row | 2 |

  - **Run instructions conflict:** README.md:14 says to use `python -m http.server`, while STATUS.md:403 says "Use `tools/serve.mjs`, not python".
  - **Removed features still described:**
    - Dark mode (README.md:87).
    - The shortlist and star (README.md:93, MAINTENANCE.md:184-185).
    - The "nobody has checked this yet" badge and "every card shows `last_verified`" (README.md:128-133, MAINTENANCE.md:199). Neither is true today.
    - An automatic stale badge (MAINTENANCE.md:238-239, `js/config.js:25`), unreachable per [OPUS-004](#opus-004).
  - **Non-existent column:** `ib_hl_requirements` (MAINTENANCE.md:192-193, 227).
  - **MAINTENANCE.md out of date:**
    - Lists UCAS as an application system.
    - Gives a 22-value subject list against 46 used.
    - Says Czech `ib_points_min` is always blank, but 2 rows are not.
  - **Comments:** `js/config.js:5-6` and the `kind: 'sample'` label in `js/data.js:19` call the real data "sample files". `index.html:108` says "23 subject areas".
- **Fix:** correct each statement, and print the counts from `check.mjs` instead of hard-coding them.

---

### Product opportunities and new features

These are proposed enhancements, not defects. They are ordered by expected value for an IB applicant researching European bachelors.

<a id="opus-037"></a>
### OPUS-037 — Structured "My subjects" eligibility check

- **User problem:** Dutch, Irish and Danish eligibility turns on subjects and levels: Maths AA vs AI, HL grades, a lab science. The site shows these as free text and lets a student pass every filter while being ineligible ([OPUS-003](#opus-003)). 921 rows are "Not checked yet".
- **Evidence:**
  - TU Delft "only accepts … Analysis & Approaches HL".
  - Trinity: "HL Grade 5 Mathematics".
  - CBS: English B ≥ 6.0 + Mathematics B.
  - 40+ textual variants of the same Maths requirement exist in the data.
- **First version:**
  - A "My subjects" panel: six subjects, HL/SL, Maths AA/AI, predicted grade.
  - Each card gets a three-state chip: Meets / Doesn't meet / Not checked.
  - Seed structured requirements (`subject`, `level`, `min_grade`, `maths_route`) for the highest-traffic set first: Dutch numerus fixus programmes, Trinity and UCD (UCD and Trinity publish per-course subject requirements; STATUS.md).
- **Benefit:** this removes the largest false-positive class, and "Not checked" becomes a visible, honest third state.
- **Effort:** L, mostly data. **Depends on** [OPUS-039](#opus-039) for vocabulary checks.

<a id="opus-038"></a>
### OPUS-038 — Per-country "how admission works" explainer

- **User problem:** the same number means different things by country:
  - Ireland: prior-year CAO cutoff, with ties broken by lottery.
  - Netherlands: subject-based eligibility; numerus fixus selection by 15 January.
  - Czechia: faculty entrance exams, often waivable.
  - Denmark: quota 1 GPA conversion.
  - Italy: TOLC / CEnT-S tests.

  Applicants also apply on *predicted* grades. Every deadline in the data except about 26 Dutch and VŠE June–July rows falls before July IB results. Offer conditions differ: MUNI ECON states "Predicted grades do not meet the academic competence requirement"; STATUS.md notes Ireland issues no conditional offers.
- **First version:** five short expandable explainers covering what the number means, when decisions arrive, and predicted vs final grades. Link them from the masthead and from each card's Admission line.
- **Benefit:** makes the points and admission information safe to read. It is cheap and text-only.
- **Effort:** S. **Related:** [OPUS-001](#opus-001), [OPUS-003](#opus-003).

<a id="opus-039"></a>
### OPUS-039 — Maintainer data lint

- **Problem:** most data defects found here were detectable offline: notes contradicting fields, "CONFIRM" text, past "by <date>" promises, off-vocabulary subject areas, `http:` links, off-domain URLs, missing headers, duplicate titles, and scraped boilerplate. The project's own maintenance relies on non-coders editing a Sheet.
- **First version:** a `tools/lint-data.mjs`, run by `check.mjs` and CI, that prints row-level problems in plain English. Optionally render a maintainer-only view behind `?debug`.
- **Benefit:** prevents regressions once the Sheet is live, and makes sign-off ([OPUS-004](#opus-004)) faster.
- **Effort:** M.

<a id="opus-040"></a>
### OPUS-040 — Pin-and-compare view encoded in the URL

- **User problem:** students narrow to 5–10 options and need a side-by-side view of points kind, subjects, fee, deadline and admission. They also need to share it with a parent or counsellor. The bookmark shortlist was removed at the maintainer's request, and STATUS.md says compare needs "a different way to pick programmes".
- **First version:** an explicit "Compare" pin per card, capped at 4. Pinned ids live in the URL ([OPUS-010](#opus-010)), not localStorage, which answers the objection to a persistent shortlist. A compact comparison table shows the pinned rows, and the URL is copyable.
- **Effort:** M. **Depends on** [OPUS-010](#opus-010).

<a id="opus-041"></a>
### OPUS-041 — Deadline timeline and calendar export

- **User problem:** IB applicants juggle Czech portfolio deadlines (30 Nov), Dutch numerus fixus (15 Jan), CAO (1 Feb), Denmark (15 Mar) and Czech/Dutch spring dates, all alongside IB internal deadlines. A flat "soonest first" list with 813 ties on 1 Feb conveys little.
- **First version:** group results into date bands (Nov–Jan / Feb / Mar–Jul / Unknown) with counts, and offer an `.ics` download for the filtered or compared set, with the official link in each event.
- **Effort:** M.

<a id="opus-042"></a>
### OPUS-042 — Total yearly cost

- **User problem:** the fee filter compares €0 (Czech-taught, Denmark) with €2,771 (Netherlands) while rent dominates. STATUS.md job #6 says the 35 living-cost numbers "would improve the tuition filter more than anything else". `living_cost_monthly` is blank for all 35, so the render code at `js/render.js:70-72` never fires.
- **First version:** fill 35 sourced city figures, display "Tuition + living ≈ €X / year", and add a sort on it.
- **Effort:** S (about a day of sourced data work).

<a id="opus-043"></a>
### OPUS-043 — "Languages I can study in" profile

- **User problem:** 374 programmes are Czech-taught. For a Slovak student these can be realistic: Charles and others accept "a Slovak-language maturita exam" as proof. For an IB student without a Slovak maturita, or for non-Slovak classmates, they are noise or a trap ([OPUS-007](#opus-007)).
- **First version:** a first-visit choice ("I can study in: English / Czech or Slovak"), remembered in the URL. It filters by language of instruction and shows a one-line "what proof of Czech/Slovak you need" note on Czech-taught cards.
- **Effort:** M (the copy needs care; verify the IB-holder route per faculty).

<a id="opus-044"></a>
### OPUS-044 — Intake-year labelling and cycle rollover

- **User problem:** figures mix cycles:
  - Irish fees span 2026/27 and 2027/28 ([OPUS-009](#opus-009)).
  - Czech rows marked "(2026 rules)".
  - UniBo pages are still the 2026/27 edition.
  - TU/e notes are past due ([OPUS-008](#opus-008)).

  From February 2027 more than half the cards will read "passed" ([OPUS-017](#opus-017)).
- **First version:** add an `intake` field (e.g. "Sept 2027") and show it once per card. Add a "Hide passed deadlines" toggle, and a STATUS.md checklist for rolling the dataset to the next cycle.
- **Effort:** S.

<a id="opus-045"></a>
### OPUS-045 — Non-EU fee toggle (not recommended now)

- **Rationale:** deliberately excluded because the cohort is EU (STATUS.md), and the columns are only partly filled. It is useful only for dual-nationality or non-EU classmates. Adding it would create a second fee column to keep accurate across 1,242 rows. Revisit only if the audience broadens.
- **Effort:** S (UI) plus ongoing data.

---

## Unverified questions and follow-up checks

| Question | Why it matters | How to resolve |
|---|---|---|
| What is the 2027/28 Irish student contribution: €2,350 (Trinity's 2027/28 table, Galway's figures) or €2,500 (UCC's 2027/28 example)? | Determines all 548 Irish fee figures ([OPUS-009](#opus-009)) | Check the HEA / Department of Further and Higher Education announcement; re-read each university's 2027/28 schedule |
| Is CAO Round 2 the right single figure to convert, given that universities and most offer-holders reference Round 1? | Systematically optimistic points ([OPUS-001](#opus-001)) | Product decision; consider showing both rounds |
| Is the CAO IB conversion table in `tools/lib/ireland.mjs:53` current for 2027 entry? | Underlies 396 rows | Re-fetch the CAO / IUA EU-EFTA guidelines document |
| Do DTU's "Physics B or Geoscience A" and "Chemistry B or Biotechnology A" alternatives hold for IB? | Possible false eligibility | DTU's IB conversion table |
| Do VŠE's three Czech-taught rows really require no Czech certificate? | Contradicts the language of instruction | VŠE admissions pages |
| Is Groningen's 15 January statement on other RUG rows also stale? | `rug-ucg` was wrong | Re-check all 28 RUG rows' notes against rug.nl |
| What does a published Google Sheet return when unpublished, rate-limited or redirected? Does it support CORS and 304? | Reliability of the planned live source ([OPUS-012](#opus-012)) | Test with a real published Sheet before switching `js/config.js` |
| Does `tools/serve.mjs` bind to all interfaces on the maintainers' machines? | LAN exposure ([OPUS-034](#opus-034)) | `ss -ltnp` while it runs |
| Real screen-reader behaviour for the dropdowns, live region and card headings | [OPUS-024](#opus-024), [OPUS-025](#opus-025) are inferred from the Chromium accessibility tree | NVDA + Firefox and VoiceOver + Safari pass |

---

## Coverage checklist

| Area | Checked | Not checked / partial |
|---|---|---|
| Architecture, routes, data flow, docs | All JS/CSS/HTML, README, STATUS, MAINTENANCE, `tools/` importers and libs | Line-by-line review of every importer (sampled the shared libs and the Irish path) |
| Core journeys, desktop and mobile | Search, filters, combinations, zero results, Clear all, sorts, reload, back, card reading, print | Real devices |
| Edge cases | Out-of-range numbers, long strings, script injection text, accents, empty/truncated/HTML/renamed-header data, slow and hung fetches, fonts blocked/hung, simulated future clock | Real passed deadlines (none exist yet) |
| Accessibility | axe (8 runs), keyboard, accessibility tree, contrast measurements, reflow 320–1440, reduced motion, 200% zoom (simulated), touch targets | Screen readers, forced colours, text-spacing override, non-Chromium |
| Data | Whole-dataset profile; 25-row official-source sample across 5 countries; fallback parity | The remaining ~1,217 rows against sources |
| Security / privacy | Every sheet-to-DOM sink, URL validation, external links, CSV export, dev server, secrets in history, third-party requests | Live Sheet permissions; legal review |
| Performance | Desktop and throttled mobile, localhost and live GitHub Pages, DOM size, re-render cost | Real-device INP; long-session memory |
| Tests | `check.mjs`, `check-contrast.mjs` | No other test suites exist |

---

## Appendix A — Dataset profile (effective values after inheritance, 2026-10-25)

| Country | Rows | IB points set | Subjects text / `none` / not checked | Language-requirement row | EU fee numeric (of which €0) | Deadline set |
|---|---|---|---|---|---|---|
| Netherlands | 199 | 2 | 95 / 16 / 88 | 24 | 197 (0) | 194 |
| Ireland | 548 | 536 | 183 / 7 / 358 | 478 | 548 (0) | 548 |
| Czechia | 424 | 2 | 4 / 0 / 420 | 80 | 414 (371) | 363 |
| Italy | 46 | 0 | 0 / 0 / 46 | 25 | 7 (0) | 0 |
| Denmark | 25 | 16 | 16 / 0 / 9 | 25 | 25 (25) | 25 |
| **Total** | **1,242** | **556** | **298 / 23 / 921** | **632** | **1,191 (396)** | **1,130** |

- **Verification:** `verified_by` is `AI-DRAFT` on 1,242 of 1,242 programme rows and 35 of 35 universities. `last_verified` runs from 2026-08-13 to 2026-10-25.
- **Deadlines:** 0 passed; 3 before 2026-12-01; 1,127 in 2027. The 112 missing are Italy 46, Czechia 61 and Netherlands 5.
- **Language of instruction:** English 868, Czech 374. No programme lists both.
- **Coverage:** `living_cost_monthly` 0 of 35; `student_life_url` 0 of 35; `degree_type` blank on 538 rows.
- **Links:** 1,241 `https:` and 1 `http:`; 0 off-domain.
- **Ids:** 15 truncated `programme_id`s end in "-".

## Appendix B — Official-source verification sample (accessed 2026-10-25)

Verdicts: ✔ matches, ✖ differs, ○ page silent or could not verify, ◐ partial.

| programme_id | Field | Verdict | Source |
|---|---|---|---|
| tud-cse | Deadline 15 Jan; Maths AA HL | ✔ | tudelft.nl …/bsc-international-diploma/dates-deadlines; …/specific-diploma-requirements |
| tud-cse | 2027/28 fee €2,771 | ○ (page shows 2025/26 only) | tudelft.nl CSE tuition page |
| uva-ebe | 15 Jan; 550 places | ✔ | uva.nl Economics & Business Economics page |
| uva-banalytics | 1 Apr (housing) / 1 May; €2,771 | ✔ (headline-date issue, OPUS-008) | uva.nl application-and-admission; tuition-fees |
| rug-history | Deadline, fee | ✔ | rug.nl/bachelors/history/ |
| rug-history | English requirement | ✖ missing (IELTS 6.5) | same |
| rug-ucg | Note, admission type, Feb date | ✖ (driver-verified) | rug.nl/bachelors/liberal-arts-and-sciences/ |
| ut-bit | 1 Jul deadline; €2,771 | ✔ | utwente.nl BIT enrolment pages |
| tcd-computer-science | Subjects | ✔ | tcd.ie CS course page |
| tcd-computer-science | 37 IB points (CAO R2 498) | ◐ (cutoff, not a minimum) | www2.cao.ie/points/l8.php |
| tcd-* (default) | English requirement | ✖ (driver-verified) | tcd.ie/study/english-language-requirements/ |
| tcd-* (default) | Fee basis €2,500 + levy | ✖ / requires verification (2027/28 shows €2,350) | tcd.ie/courses/undergraduate/fees/ (driver-verified) |
| ucd-commerce | IB 33; Maths SL6/HL4; €2,754 (2026/27) | ✔ | hub.ucd.ie BSS1; ucd.ie studentcontribution |
| ucc-applied-psychology | 1 Feb | ✔ | ucc.ie/en/ck120/ |
| ucc-applied-psychology | Fee €2,710 vs 2027/28 €2,714 | ✖ (year basis) | ucc.ie 2027/28 schedule |
| ul-applied-physics-bsc | CAO 433; €2,604 for Free Fees students | ✔ / ◐ (non-FFI €7,366) | ul.ie LM125 and fees pages |
| galway-bachelor-of-science-psychology | 1 Feb; €2,500 for FFI students | ✔ / ◐ (non-FFI €5,748) | universityofgalway.ie course page |
| cuni-general-medicine-2 | 30 Apr 2027; €24,250; IB waiver | ✔ | is.cuni.cz detail_obor 37448 |
| muni-en-economics-and-public-policy | IB 28+ Maths 4+; 30 Apr; 100,000 CZK | ✔ (EU label ◐) | econ.muni.cz application-requirements; muni.cz programme page |
| cvut-informatics | 31 Mar; maths test; B2 | ✔ | fit.cvut.cz bachelor admissions |
| cvut-informatics | Fee `?` | ✖ (CZK 64,000 / semester published) | same |
| vse-en-economic-data-science | €6,000; 28 Feb / 30 Apr | ✔ | fis.vse.cz programme page |
| bocconi-fin | €17,700; ~3,000 places | ✔ | unibocconi.it bachelor-and-law-programs |
| unibo-6661 | Deadline / fee blank | ○ (page is the 2026/27 edition; ISEE-based fee) | unibo.it programme 6661 |
| sapienza-bioinfo | Test details; B2 | ✔ (URL is the generic index) | uniroma1.it call index and PDF 12952 |
| cbs-ibp | 15 Mar; 24 points; subjects; GPA 10.7 | ✔ | cbs.dk application-and-admission; IBP page |
| au-cog | 15 Mar; subjects; Danish switch | ✔ | bachelor.au.dk/en/cognitivescience/ |
| dtu-ge | 15 Mar; IB 24; €0 EU | ✔ | dtu.dk General Engineering admission pages |
| dtu-ge | English note; subject alternatives | ✖ / ○ | same |
