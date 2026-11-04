# Comprehensive repository audit — Sol

## Audit context and coverage

- **Audit date:** 25 October 2026 (Europe/Bratislava).
- **Repository and report destination:** [Leonsalner/ib-university-finder](https://github.com/Leonsalner/ib-university-finder), Leon's fork of `kpolacik/ib-university-finder`.
- **Audited branch and application commit:** `main`, `88be059e3365de1c1b590ba308d452db203efbc7`. A fresh checkout had no existing user changes. `origin` was verified as `https://github.com/Leonsalner/ib-university-finder.git` for fetch and push. No upstream writes were performed.
- **Instructions:** no applicable `AGENTS.md` was found. Read `README.md`, `STATUS.md`, `MAINTENANCE.md`, configuration, application modules, styles, checks, and relevant import/maintenance scripts before judging behavior. No independent Opus report was read. `plans/scan/sol.md` did not exist before this audit.
- **Models actually selected for workers:** six `gpt-6.1-sol` / medium workers (UX; accessibility; product; bugs/data; security/reliability; importer regressions), one `gpt-6.1-sol` / high worker (official-source verification), one `gpt-6-luna` / high worker (UI/responsive), and one `gpt-6-luna` / medium worker (breadth/consistency). These configurations were accepted by the orchestration tools. Work was queued around the concurrency limit. Workers returned findings in conversation and made no file changes or commits.
- **Driver limitation:** the requested driver was Sol 6.1 / high. The already-running Codex driver cannot switch or independently verify its own model/effort through the available interface; that exact driver configuration is therefore unverified, rather than claimed. The driver reviewed, consolidated, challenged priorities, and independently reproduced important findings.

### Architecture and actual product

This is a dependency-free static website, not a backend application. `index.html` is the single screen. `js/app.js` wires controls to state; `filters.js` implements filtering/sorting; `data.js` fetches and joins university/programme rows; `csv.js` parses CSV; `render.js` constructs DOM safely with text nodes. `shortlist.js` and hidden shortlist controls remain, but saving, shortlist export/print, and comparison are **not available through the current UI**. Shortlisting was intentionally removed on 24 October; comparison was not implemented. Their absence is not classified as a regression.

The configured source is the repository's two CSV files: both Google Sheet URLs in `js/config.js` are empty. A committed JSON snapshot is the network-failure fallback. Import scripts gather and transform external university data; they are maintenance tools, not browser code. There is no package manifest, lockfile, runtime library dependency tree, account system, database, or application API.

Actual loaded inventory, calculated using the application's loader:

| Country | Universities | Programmes |
|---|---:|---:|
| Ireland | 7 | 548 |
| Czechia | 5 | 424 |
| Netherlands | 13 | 199 |
| Italy | 5 | 46 |
| Denmark | 5 | 25 |
| **Total** | **35** | **1,242** |

All 1,242 rows are `AI-DRAFT`. After inheritance, 921 have unknown subject prerequisites, 686 have no numeric points value, 112 have no headline deadline, and 51 have no EU fee. These counts are **coverage statistics, not counts of incorrect data**: an unpublished total score is normal in several admissions systems. All 35 universities lack living-cost figures. Of English-taught programmes, 312 have no rendered English-requirement information.

### Checks performed and outcomes

| Check | Outcome and limits |
|---|---|
| Documented local startup | `node tools/serve.mjs 8765` starts successfully; local HTTP server works. No install or build is needed. |
| Existing application checks | `node tools/check.mjs` passes, loading 1,242 programmes/35 universities. This validates selected parser, inheritance, sorting, export and dataset invariants; it does not establish admissions accuracy. |
| Existing contrast checks | `node tools/check-contrast.mjs` passes all 44 configured pairs. Composited expired-card states and control boundaries are outside those checks. |
| Snapshot parity | Parsed snapshot university/programme arrays match the current CSV arrays, including order and values. No stale-snapshot defect was found. |
| Desktop runtime | Inspected the published upstream GitHub Pages site at 1,363 × 936 CSS pixels. Both repository heads were at the audited SHA. Separately fetched and compared all 12 served files: HTML, CSS, seven JS modules and three active data files all matched the checkout byte for byte. This public site was inspected read-only; the report is written only to Leon's fork. |
| Representative UI tasks | Initial discovery; programme/country compound search and zero results; points filtering; combined Denmark + English + zero-fee filters (25 results); reset; missing tuition retained with explanation; WBB inspection; invalid points entry; reload persistence; dropdown Escape dismissal and returned focus. |
| Adversarial data fixtures | Read-only, in-memory loader/parser probes: empty/header-only/HTML/malformed CSV, unterminated quoted final field, out-of-domain numbers, missing required fields. No tracked fixture or application file was changed. |
| Security/privacy inspection | Reviewed rendering sinks, URL validation, external links, storage, fetch boundaries, public configuration, dependency footprint and local-server scope. No confirmed exploitable application vulnerability or exposed private credential was established. |
| Official programme checks | Targeted cases across all five countries: Irish standard/exceptional/graduate routes, Bocconi WBB, DTU General Engineering, Delft CSE, and Charles English Computer Science. Findings cite official URLs and access dates below. This is a purposive risk sample, not statistical validation of the entire catalogue. |

### Coverage gaps

The cloud browser could not connect to the container's `localhost` (`ERR_CONNECTION_REFUSED`); identical published files supplied desktop runtime coverage instead. Its supported interface did not expose viewport resizing: **no narrow mobile viewport, real touch device, or mobile Safari was tested**. Responsive CSS was inspected, but mobile overflow/focus hypotheses remain follow-up checks. No screen-reader application was run, and no formal WCAG conformance claim is made. Network failure fixtures were exercised at the loader level, not with browser request interception. No controlled device-performance benchmark, full link crawl, dependency vulnerability scan, or production hosting/header audit was performed. There is no runtime dependency graph for a package scanner to assess. No real forms, accounts, messages, remote data mutations, upgrades or automatic fixes were used.

## Executive assessment

The project is a useful discovery prototype with an appropriate architecture for a small student team. It has meaningful safeguards: a real distinction between unknown prerequisites and no prerequisites, programme-specific overrides, explanations when unknown fees survive filters, official links, safe text rendering, accent-insensitive search, deadline sorting, and a current fallback snapshot. The visual design is coherent and the desktop layout works for browsing dense records.

Its largest weakness is **admissions meaning and research assurance**, rather than missing visual polish. The same field represents published minima and historical competition cutoffs; importers infer consequential rules from titles; exceptional programmes inherit ordinary university routes and fees. The targeted checks found an imminent published deadline missing from the app, graduate admission data represented as an IB school-leaver option, and misleading test requirements. These are sufficient reasons to correct the high-priority records and verify a focused cohort of programmes before classmates rely on the finder for application decisions.

The product should be presented as a discovery aid, not an eligibility or offer predictor. Meeting a recorded requirement, meeting all official requirements, and receiving an offer are separate outcomes. The existing Admission line helps, but cannot repair a hard filter that has already hidden an option or a wrong programme-specific route. A global disclaimer also cannot compensate for a concrete false deadline or fee.

There is no justified P0 finding. The current site can support exploratory research with clear limitations. It is not ready to function as a dependable application-planning source without the P1 corrections and focused human checking. Greater country coverage, accounts and elaborate matching would be lower-value than making the current data intelligible and dependable.

## Prioritised findings index

Priorities reflect practical consequence and reach, not implementation convenience. Effort is a rough engineering/content estimate: XS, S, M, L, XL; research time and schema migrations can dominate. `Confirmed` can mean source/probe confirmation; browser confirmation is stated separately. Proposed enhancements are deliberately distinct from defects.

| ID | Priority | Area | Finding | Status/confidence | Estimated effort |
|---|---|---|---|---|---|
| [SOL-001](#sol-001) | P1 | Admissions/deadlines | WBB's published 1 November deadline and special application route are missing | Confirmed; high | S |
| [SOL-002](#sol-002) | P1 | Dataset scope | Graduate routes appear as school-leaver choices; GAMSAT becomes IB24 | Confirmed; high | S–M |
| [SOL-003](#sol-003) | P1 | Points/filtering | Historical CAO cutoffs act as hard minima; Maths bonus handling loses options | Confirmed; high | M |
| [SOL-004](#sol-004) | P1 | Admissions/fees | Columbia dual degree inherits ordinary CAO selection and a misleading annual fee | Confirmed; high | S–M |
| [SOL-005](#sol-005) | P1 | Admissions tests | Title heuristics invent HPAT requirements | Confirmed mechanism; high, with stated Galway qualification | S |
| [SOL-006](#sol-006) | P1 | Requirements UI | University baseline eligibility is suppressed on every real card | Confirmed; high | S |
| [SOL-027](#sol-027) | P1 | Research assurance | Verify a focused programme cohort and preserve field-level evidence | Proposed enhancement; high value | M, research dependent |
| [SOL-007](#sol-007) | P2 | Subject filtering | Inconsistent taxonomy hides relevant programmes from broad subjects | Confirmed; high | M |
| [SOL-008](#sol-008) | P2 | IB/language data | DTU entry claims omit available mappings and add unsupported alternatives | Confirmed mismatch; high | S |
| [SOL-009](#sol-009) | P2 | Search UX | Compound programme/country searches produce false empty results | Confirmed in browser/source; high | S |
| [SOL-012](#sol-012) | P2 | Reliability | Unusable successful CSV responses bypass the valid fallback | Confirmed probes; high | S |
| [SOL-015](#sol-015) | P2 | Data assurance | Required source/verification fields can disappear without a loader issue | Confirmed probes/source; high | S–M |
| [SOL-016](#sol-016) | P2 | Reliability | Stalled requests have no bounded fallback path | Confirmed control flow; high; frequency unmeasured | S |
| [SOL-013](#sol-013) | P2 | CSV parser | An unclosed final quoted field silently absorbs later records | Confirmed probe; high | S |
| [SOL-014](#sol-014) | P2 | Data validation | Finite but impossible values become admissions/fee facts | Confirmed probes; high | S |
| [SOL-017](#sol-017) | P2 | Requirement completeness | Missing English requirements disappear rather than remaining visibly unknown | Confirmed; high | S |
| [SOL-010](#sol-010) | P2 | Startup UX | Input entered before loading completes is not applied | Confirmed source; high | S |
| [SOL-011](#sol-011) | P2 | Filter usability | Invalid numeric values apply without an explanation | Confirmed browser/source; high | S |
| [SOL-021](#sol-021) | P2 | Import maintenance | Reusing the Italy merge can undo corrected Bocconi fees | Confirmed assignments; conditional rerun | S |
| [SOL-022](#sol-022) | P2 | Verification freshness | A CAO-only refresh advances whole-record verification dates | Confirmed source; future signed-row risk | S–M |
| [SOL-026](#sol-026) | P2 | Deadline reliability | A tab left open overnight keeps yesterday's urgency/status | Confirmed source; rollover UI untested | S |
| [SOL-018](#sol-018) | P2 | Accessibility | Default form-control boundaries have insufficient contrast | Confirmed CSS/calculation; high | S |
| [SOL-019](#sol-019) | P2 | Accessibility | Expired-card opacity defeats otherwise passing text colours | Confirmed CSS/calculation; currently no expired rows | S |
| [SOL-028](#sol-028) | P2 | Product opportunity | Pilot explicit IB subject compatibility without predicting offers | Proposed enhancement | L, research dependent |
| [SOL-029](#sol-029) | P2 | Product opportunity | Model actionable milestones separately from one headline deadline | Proposed enhancement | M |
| [SOL-030](#sol-030) | P2 | Product opportunity | Add sourced living-cost context before a total-budget filter | Proposed enhancement | M, research dependent |
| [SOL-031](#sol-031) | P2 | Product opportunity | Make searches restorable and shareable | Proposed enhancement; current reset confirmed | S–M |
| [SOL-032](#sol-032) | P2 | Product opportunity | Offer a small, explicit comparison workflow if stakeholders want it | Proposed enhancement; intentionally absent today | M |
| [SOL-020](#sol-020) | P3 | Documentation | Current inventory and maintenance instructions contradict implementation | Confirmed; high | S |
| [SOL-023](#sol-023) | P3 | Identity maintenance | Encounter-order IDs can change the identity of existing programmes | Confirmed in-memory; current shortlist inactive | M |
| [SOL-024](#sol-024) | P3 | Accessibility | Repeated official links have no programme identity in link navigation | Confirmed markup; high | S |
| [SOL-025](#sol-025) | P3 | Empty-state UX | Recovery advice names filters the user did not apply | Confirmed browser/source; high | XS–S |

## Detailed findings by area

### Functionality and data correctness

<a id="sol-001"></a>
### SOL-001 — WBB's published deadline is one week away, but the app says it is unpublished

- **Type/status:** data defect; confirmed against official source and rendered card. **Priority:** P1 because a student can miss an imminent application. **Confidence:** high. **Effort:** S, including checking the importer and snapshot.
- **Affected journey:** an IB student researching Bocconi World Bachelor in Business for 2027/28.
- **Location/evidence:** `data/programmes.csv:1201` (`bocconi-wbb`) has no deadline, says 2027/28 dates are unavailable, uses ordinary Bocconi rounds/admission, and inherits `Direct (Bocconi online application)`. `tools/merge-italy-denmark.mjs:94`, `:111`, `:128` apply generic notes while only partially overriding WBB. Browser search `World Bachelor` shows the contradiction between a roughly 50-person cohort in Other and roughly 3,000 places in Admission.
- **Official verification:** [Bocconi WBB admissions](https://www.unibocconi.it/en/applying-bocconi/bachelor-and-law-programs/application-and-admissions/admission-world-bachelor-business), accessed **2026-10-25**, explicitly publishes the **2027/28 ED and EA deadline of 1 November 2026**. Application is via USC on CommonApp, WBB first choice, code 1485. Selection is a joint profile review for a cohort of 45–50, not the ordinary Bocconi test/GPA route.
- **Reproduction:** open the site, search `World Bachelor`, inspect Deadline, Admission and Apply via; compare with that official page. Unknown tuition correctly remains visible under a zero-fee filter, so do not mistake that deliberate behavior for a bug.
- **Recommended change:** override WBB's deadline, application system, selection process and notes with programme-specific facts; preserve its distinct tuition uncertainty. Fix the transformation as well as the record to avoid recurrence.
- **Acceptance:** WBB sorts under 1 November 2026 with an urgent countdown on this audit date; USC/CommonApp and the correct selection/round information are visible; standard Bocconi facts do not bleed into WBB. Related: SOL-021 and SOL-029.

<a id="sol-002"></a>
### SOL-002 — Graduate-entry routes are mixed into direct IB options, including a false 24-point threshold

- **Type/status:** dataset-scope and score-scale defect; confirmed. **Priority:** P1: eligibility and affordability are materially wrong. **Confidence:** high. **Effort:** S to exclude the two routes; M if intentionally supporting graduate entry.
- **Evidence:** `data/programmes.csv:468`, `ucc-medicine-graduate-entry`, stores IB24 from a cutoff of 58 and inherits UCC's €2,710 fee (`data/universities.csv:17`). `lowestIB(58)` returns 24 (`tools/lib/ireland.mjs:53`–`:60`). The importer/refresh applies an IB conversion to a numeric score without a test-scale discriminator. `SKIP_TITLE` at `tools/lib/ireland.mjs:155` misses graduate entry; Trinity's separate exclusions at `tools/import-tcd.mjs:36`–`:45` do too. `data/programmes.csv:268`, `tcd-pharmacy---graduate-entry-to-p`, is another graduate route with ordinary inherited admission and no prior-degree requirement.
- **Official verification:** [UCC CK791](https://www.ucc.ie/en/ck791/), accessed **2026-10-25**, identifies 58 as a **GAMSAT** score, requires a prior honours bachelor degree at the stated grade, and excludes this route from Free Tuition Fees. Its displayed fee example is for 2024/25, so it must not be substituted as a current fee. [Trinity graduate pharmacy](https://www.tcd.ie/study/apply/alternative-paths-to-trinity/graduate-entry-to-pharmacy/), accessed **2026-10-25**, requires graduate qualifications, chemistry, a supplementary application in addition to CAO, and interview shortlisting.
- **Verify/reproduce:** search `Graduate Entry`; inspect the cards. Compare CK791's IB24 with its official test label. A pure call to `lowestIB(58)` reproduces the invalid conversion.
- **Impact:** school-leavers see routes they cannot directly enter; a graduate test result is presented as an IB threshold; a materially inapplicable fee default makes the course look affordable.
- **Recommended change:** exclude graduate routes from this school-leaver dataset, or explicitly model prerequisite qualification, admission route, score scale and fee eligibility. Prevent GAMSAT/combined test scores entering the IB converter. If retained, override the UCC fee to unknown until a current applicable fee is sourced.
- **Acceptance:** neither route appears as direct IB entry; no graduate test score produces an IB minimum; fees and selection are specific to the route. Add regression coverage using these actual exceptions. Related: SOL-003, SOL-015, SOL-027.

<a id="sol-003"></a>
### SOL-003 — Historical CAO equivalents are treated as hard IB minima, while bonus logic excludes plausible options

- **Type/status:** confirmed model/filter defect. **Priority:** P1 because it affects core discovery and the interpretation of admissions chances. **Confidence:** high. **Effort:** M; schema, importer, UI and filtering must agree.
- **Evidence:** `js/filters.js:55`–`:57` excludes rows above `myIbPoints`; `js/render.js:121`–`:130` renders all numbers as IB points; `index.html:124`–`:127` describes what programmes ask for. Yet `tools/update-cao-points.mjs:59`–`:95` writes converted historical cutoffs into the same `ib_points_min` field as published requirements. There are 396 numeric non-UCD Irish records using that conversion model.
- **Concrete failure:** `data/programmes.csv:221`, Trinity Computer Science/TR033, stores 37 from historical CAO498. Using the repository's own conversion, IB35 gives 481 and an eligible HL Maths bonus gives 506. The row itself requires HL Maths5 and mentions the bonus, but `My points = 35` hides it before the student sees that information. Browser `Computer Science` gives 23 results; adding 35 gives 22 and removes TR033.
- **Related arithmetic defect:** `data/programmes.csv:466`, UCC Dentistry/CK702, describes 625 as above the 625-point IB maximum. Its title fails the Maths-title heuristic, so the converter never considers the bonus. This is not proof of an offer at 625; it is proof the current conversion/status is internally inconsistent.
- **Official context:** [Trinity admission requirements](https://www.tcd.ie/study/apply/admission-requirements/undergraduate/), accessed **2026-10-25**, confirms an HL Maths grade-4+ bonus and distinguishes competitive admission from minimum requirements. Its indicative conversion table differs from the repository's claimed 2026 CAO table; revalidate the exact cohort-specific conversion before implementation. [Trinity's 2026 final points](https://www.tcd.ie/study/assets/pdfs/2026-cao-minimum-entry-points-round-final.pdf), accessed **2026-10-25**, supports TR033's historical 498 and indicates that not everyone at that level received an offer.
- **Recommended change:** separate published IB minimum, historical CAO cutoff/year/round, score scale and any indicative equivalent. Make bonus eligibility an explicit student input/rule, not a title inference. Historical competition data should provide context or a soft research filter, not silently assert eligibility. Retain unknowns and the existing Admission line.
- **Acceptance:** an IB35 student with eligible HL Maths can still discover TR033; the card labels the historical basis and year; true minima remain distinct; 625 is not called greater than 625; no status predicts an offer from meeting a threshold. Related: SOL-002, SOL-028.

<a id="sol-004"></a>
### SOL-004 — Trinity–Columbia inherits ordinary selection and one annual fee for a two-institution degree

- **Type/status:** confirmed programme-default exception. **Priority:** P1: it can misdirect an application and seriously understate later-year cost. **Confidence:** high. **Effort:** S–M.
- **Evidence:** `data/programmes.csv:219` leaves admission and fee blank, so `js/data.js:148`, `:198` inherit Trinity's CAO-points-only admission and €2,814. Runtime shows only Apply via CAO and €2,814/year, without separate dual-degree application or US-year fee context.
- **Official verification:** [Trinity programme page](https://www.tcd.ie/courses/undergraduate/courses/columbia-dual-degree/), [Columbia EU applicant instructions](https://tcd.gs.columbia.edu/content/european-applicants), and [Columbia fees](https://tcd.gs.columbia.edu/content/tuition-fees), all accessed **2026-10-25**. The route includes a joint selective application; EU-status applicants additionally need CAO entry. Tuition follows Trinity in years 1–2 and Columbia GS in years 3–4. Columbia independently lists 2 January; do not claim the recorded date is wrong merely because Trinity's page references an older cycle.
- **Recommended change:** override admission/application instructions; make the fee scope and institution change explicit, using unknown for a single all-years number until the model supports year-specific costs.
- **Acceptance:** the card makes both applications discoverable and cannot be read as a four-year course costing €2,814 each year. Official links support the exceptional rules. Related: SOL-002, SOL-030.

<a id="sol-005"></a>
### SOL-005 — Course-title matching creates unsupported HPAT requirements

- **Type/status:** confirmed inference defect; strong official corroboration, with the Galway caveat below. **Priority:** P1 because a named admissions test is a consequential instruction. **Effort:** S.
- **Evidence:** `tools/lib/ireland.mjs:92`–`:97` returns HPAT for a word match on medicine or dental science. It produces the three explicit HPAT tags at `data/programmes.csv:223` (Trinity Dental Science), `:256` (Trinity Molecular Medicine), and `:497` (Galway Podiatric Medicine). Calling `otherFor()` with those titles reproduces the result without consulting a programme policy.
- **Verification:** [ACER's participating-course list](https://hpat-ireland.acer.org/) and [Trinity's 2026 final-entry table](https://www.tcd.ie/study/assets/pdfs/2026-cao-minimum-entry-points-round-final.pdf), accessed **2026-10-25**, distinguish undergraduate Medicine from these programmes. Trinity's table flags Medicine with HPAT and does not flag Dental Science or Biological/Biomedical Sciences. [Galway's programme requirements](https://www.universityofgalway.ie/courses/undergraduate-courses/podiatry.html), accessed **2026-10-25**, do not substantiate the recorded HPAT rule. Galway's case is supported by its absence from ACER's participating-course list and the absence of an HPAT requirement on Galway's programme page, not an explicit sentence saying no HPAT is required.
- **Impact:** a student may register/pay for an unnecessary test or rule out a course unnecessarily. A generic disclaimer cannot make an unsupported named test safe to present as a fact.
- **Recommended change:** use sourced programme/code-specific requirements, never title heuristics for admissions obligations. Treat unconfirmed requirements as unknown. Review the neighboring veterinary/audition heuristics too, without presuming they are all wrong.
- **Acceptance:** every named test has programme-specific evidence; these three tags are removed or replaced after verification; importer reruns cannot regenerate them from the title alone. Related: SOL-002, SOL-027.

<a id="sol-006"></a>
### SOL-006 — Stored university eligibility is never visible on the real programme cards

- **Type/status:** confirmed rendering omission. **Priority:** P1: the visible Requirements block can omit an entire eligibility layer. **Confidence:** high. **Effort:** S.
- **Evidence:** `js/render.js:97`–`:109` displays `baselineRequirement` only when there are no points, admissions, English or other requirements and subjects are explicitly none. Of 777 real records with a baseline, **zero satisfy that display condition**. `js/data.js:179` carries the value, so this is not simply missing research.
- **Example:** Trinity's baseline in `data/universities.csv:15` includes the full diploma and a general HL/SL grade profile. Trinity Computer Science displays only programme-specific Maths, points, English and admission information. The general university requirements disappear. The official [Trinity admissions page](https://www.tcd.ie/study/apply/admission-requirements/undergraduate/), accessed **2026-10-25**, separately specifies a general subject/grade profile; the stored baseline should itself be rechecked for completeness when surfaced.
- **Reproduction:** inspect a built TR033 row's `baselineRequirement`, then its card; inspect the `nothingAtAll` condition or count how many dataset rows can enter it.
- **Recommended change:** show a compact General eligibility line or disclosure whenever the baseline exists, alongside rather than instead of course-specific rules. Avoid representing the displayed subset as a full eligibility verdict.
- **Acceptance:** TR033 exposes both general and course-specific rules; other countries retain their own baseline wording; missing baseline data remains unknown. Related: SOL-028.

<a id="sol-007"></a>
### SOL-007 — Subject categories fragment across imports and sometimes misclassify a course entirely

- **Type/status:** confirmed filtering/data-quality defect. **Priority:** P2: ordinary subject discovery silently loses relevant options. **Effort:** M including taxonomy review.
- **Evidence:** facets are taken literally from data (`js/filters.js:111`–`:132`), with exact membership in `applyFilters`. The current dataset creates 46 subject values despite the documented controlled vocabulary. `tools/lib/ireland.mjs:63`–`:90` falls back to Liberal Arts for unmatched titles. `data/programmes.csv:466` labels UCC Dentistry as Liberal Arts; a real `Medicine & Health` filter excludes it. Italian Architecture rows such as `polito-arch` (`data/programmes.csv:1188`) use only `Design & Architecture`, so Architecture excludes them. `sdu-mech` (`:1235`) uses Mechanical Engineering without Engineering; Bocconi Finance uses Finance without Business & Management.
- **Reproduction:** filter Medicine & Health, Architecture or Engineering and search for those named records; compare their subject arrays. These are separate from intentionally shared CAO-entry programmes.
- **Recommended change:** define canonical broad subjects, optional subsubjects and reviewed alias/mapping rules. Keep narrow labels if useful, but make broad filters include their child subjects. Classify unmatched imports as Unclassified/requires review rather than asserting Liberal Arts.
- **Acceptance:** Dentistry is discoverable under health, mechanical engineering under engineering, and architecture under architecture across countries; ingestion reports unexpected labels; reviewed exceptions survive reruns.

<a id="sol-008"></a>
### SOL-008 — DTU's recorded requirements omit available IB mappings and contain unsupported alternatives

- **Type/status:** confirmed mismatch with linked official evidence. **Priority:** P2: affects subject and English-test planning for one programme. **Confidence:** high on the mismatch; alternative-route claims need their own source if retained. **Effort:** S.
- **Evidence:** `data/programmes.csv:1230`, `dtu-ge`, says IB/IELTS/TOEFL equivalences were not available and adds Geoscience/Biotechnology alternatives. [DTU's linked requirements page](https://www.dtu.dk/english/education/undergraduate/general-engineering/admission-and-deadlines/admission-requirements), accessed **2026-10-25**, provides an IB conversion link, named tests, and qualified IB exemptions, while its specific list states Maths A, English B, Physics B and Chemistry B. The linked [IB conversion table](https://www.dtu.dk/english/-/media/dtu-endk/education/bsc-programmes/general-engineering/ib-levels_2025.pdf), accessed **2026-10-25** by the official-source worker, supplies the usable subject mappings.
- **Impact:** students must repeat research already available from the recorded source; an unsupported alternative can create false confidence about their subject combination.
- **Recommended change:** record the published IB mappings and exemption conditions, distinguish a Danish subject level from an English-language test, and remove alternatives unless independently sourced for this specific programme. Do not rewrite the supported IB24/deadline merely because other fields are weak.
- **Acceptance:** AA/AI and HL/SL mappings have official evidence; an IB student's English exemption is conditional and correctly explained; no unsupported subject substitution appears. Related: SOL-027, SOL-028.

<a id="sol-013"></a>
### SOL-013 — An unterminated final quoted field can silently swallow subsequent rows

- **Type/status:** parser defect confirmed with a pure probe. **Priority:** P2; current valid data is unaffected, but a malformed publication can corrupt records silently. **Effort:** S.
- **Evidence:** `js/csv.js:19`–`:49` reaches end-of-file without checking `inQuotes`; column-width validation at `:69`–`:80` cannot detect every such case.
- **Reproduction:** `csvToObjects('id,name\n1,"unfinished\n2,normal\n', 'Probe')` returns one accepted record whose name contains `unfinished\n2,normal`, with `issues: []`. This uses the actual parser, not a hypothetical alternate implementation.
- **Impact:** later programmes can disappear into a previous field while the spreadsheet panel reports no problem. Existing tests cover a different malformed-quote position that happens to create a width mismatch.
- **Recommended change:** detect unclosed quotes and invalid quote placement, report the logical record and reject it; retain support for legal multiline quoted fields.
- **Acceptance:** this probe reports malformed CSV and never accepts the merged record; valid comma/escaped quote/multiline cases continue passing. Related: SOL-012.

<a id="sol-014"></a>
### SOL-014 — Numeric parsing accepts impossible scores, negative fees and ambiguous decimal formats

- **Type/status:** confirmed validation gap; no negative current fee was found. **Priority:** P2 for future spreadsheet edits/import errors. **Effort:** S.
- **Evidence:** `js/data.js:284`–`:293` accepts any finite value for all numeric columns and strips every comma. An in-memory row with `ib_points_min=99` and `tuition_eu=-100` loads both with no issue. A quoted monetary value `2771,00` becomes 277100 rather than a European decimal amount.
- **Impact:** plausible-looking cards and budget exclusions can be based on nonsense input. A generic number parser cannot enforce the different score/currency domains.
- **Recommended change:** apply column-specific validators: valid IB integer domain, nonnegative fees/living costs, and explicit documented numeric formatting. Reject ambiguous locale values with an actionable column-specific issue rather than guessing.
- **Acceptance:** out-of-domain numbers become unknown or rejected records with a visible issue; zero remains a valid free fee; valid 24–45 IB totals and documented fee formats retain their intended value. Related: SOL-011, SOL-015.

<a id="sol-015"></a>
### SOL-015 — The loader does not enforce its promised source and verification fields

- **Type/status:** confirmed record/schema validation gap. **Priority:** P2; prospective spreadsheet maintenance risk, not a claim current links are missing. **Effort:** S–M.
- **Evidence:** `MAINTENANCE.md:6`–`:9` promises no card without an official link and verification date. `js/csv.js:66`–`:79` checks widths but not required/duplicate headers. `js/data.js:165` adds a valid-ID/joined record even if its URL/date is missing. Blank URLs/dates return null without issues (`:311`–`:324`), and `older()` can hide a missing programme date by using the university date. `js/render.js:177` treats any non-AI-labelled dated row as checked, even without a genuine signature. Current data passes the separate official-link check in `tools/check.mjs:180`.
- **Reproduction:** load a small valid university/programme fixture with a renamed or omitted `official_url` header and empty programme verification fields. The row still renders; the missing-link fallback message is not a substitute for a loader quality issue. An in-memory fixture with only ID, university, name, score and fee produced no loader issues.
- **Recommended change:** validate required headers and core record fields explicitly; distinguish programme and university verification. Missing signer/date must not imply human checking. Decide whether incomplete rows are quarantined or shown conspicuously as incomplete, and align the maintenance contract with that behavior.
- **Acceptance:** renamed/missing/duplicate required headers generate clear diagnostics; absent evidence cannot become a clean checked record; intentionally unknown admissions facts remain supported. Related: SOL-012, SOL-022, SOL-027.

<a id="sol-017"></a>
### SOL-017 — Missing English requirements vanish from cards rather than staying visibly unknown

- **Type/status:** confirmed presentation gap. **Priority:** P2; relevant to international applicants planning tests or exemptions. **Effort:** S for presentation; research is separate.
- **Evidence:** `js/render.js:147`–`:150` omits the language-requirement row entirely when its array is empty. By contrast, missing subjects explicitly say Not checked yet. After inheritance, 312 English-taught programmes have an empty English requirement, including DCU's 70 current courses (the documented gap in `STATUS.md` retains an older count). `js/render.js:73` still correctly states teaching language; that is a different fact.
- **Reproduction:** search a DCU programme and compare its Requirements block with a Trinity card. Taught in English is present, but the test/exemption requirement is absent without an unknown marker.
- **Impact:** readers may confuse missing research with no English-proof obligation, especially when all other requirements appear under a confident heading.
- **Recommended change:** add a compact English proof: Not checked / see official requirements state, and retain the distinction from teaching language. Add a specific source when subsequently researched; do not infer an exemption from IB attendance.
- **Acceptance:** missing proof requirements remain visibly unknown; known exemptions/tests remain precise; Czech-language requirements are not mislabeled as English tests. Related: SOL-008, SOL-027.

### UX and journeys

<a id="sol-009"></a>
### SOL-009 — A programme and country typed together yield a false empty search

- **Type/status:** confirmed source and browser behavior. **Priority:** P2; common discovery path. **Effort:** S.
- **Evidence:** `js/filters.js:34`–`:39` requires one literal full-query substring in `searchBlob`; `js/data.js:225`–`:227` concatenates programme, full university, city and country. Runtime `computer science` returns 23; `computer science netherlands` returns zero, despite Dutch computer-science cards being present. Reversing the terms also returns zero in the actual pure filter.
- **Impact:** the placeholder promises programme/country search but an ordinary compound query appears to prove there are no options.
- **Recommended change:** normalize/split query tokens and require each token across the searchable fields, with documented semantics. A separate optional improvement is curated familiar university/native-name aliases: `TU Delft`, `UCD`, `ČVUT` and `CVUT` currently return zero, while `Delft` returns four. Alias support is additive, not a broken promise of an implemented feature.
- **Acceptance:** both country/programme word orders find the relevant Dutch courses; accent folding remains; multiword programme searches work; unrelated matches do not appear merely because one token matches.

<a id="sol-010"></a>
### SOL-010 — Typing while the data loads leaves visible controls out of sync with results

- **Type/status:** confirmed control flow; not browser-throttled. **Priority:** P2; depends on slow startup, not every visit. **Effort:** S.
- **Evidence:** `index.html:118`–`:134` exposes enabled text/numeric inputs immediately. `js/app.js:59` awaits loading before `wireInputs()` at `:70`; the first update reads the empty in-memory state, not existing input values.
- **Verification/reproduction:** delay a CSV response, type Prague or a budget before completion, then wait without further edits. The input event has no listener; the field can remain populated while the first results ignore it. The same issue can affect browser-restored input values.
- **Recommended change:** wire state before loading and apply it when data arrives, or disable controls with an announced loading state until ready; explicitly hydrate current values.
- **Acceptance:** first results always reflect all visible controls, including pre-load input; loading/completion is understandable with assistive technology. Related: SOL-016.

<a id="sol-011"></a>
### SOL-011 — Invalid points and fee inputs still filter the catalogue silently

- **Type/status:** confirmed in browser/source. **Priority:** P2. **Effort:** S.
- **Evidence:** `index.html:125`–`:134` declares bounds/steps; `js/app.js:280`–`:284` accepts all finite numbers and does not inspect validity. Browser entry 46 gives `validity.valid=false` but applies the filter, displaying 1242 of 1242, with no error. Negative/decimal points and negative fees follow the same finite-number path. Fee `step=500` additionally marks useful budgets such as 2771 invalid despite the application accepting them.
- **Impact:** mistyped values silently generate credible-looking output and there is no clear correction path.
- **Recommended change:** validate meaningful constraints before applying state, associate concise errors with fields, and use a fee step appropriate to arbitrary euro budgets. Do not treat invalid input as an implicit zero.
- **Acceptance:** invalid score/fee values show readable, announced guidance and do not silently govern results; valid budgets need not be multiples of 500. Related: SOL-014.

<a id="sol-025"></a>
### SOL-025 — Zero-result advice is disconnected from the filters actually in use

- **Type/status:** confirmed minor usability defect. **Priority:** P3. **Effort:** XS–S.
- **Evidence:** `js/app.js:249`–`:250` always suggests raising tuition or removing a country. In the reproduced search-only empty state for `computer science netherlands`, neither a tuition limit nor a country selection existed.
- **Impact:** the recovery hint sends a student toward nonexistent constraints rather than helping them revise the actual query.
- **Recommended change:** tailor recovery advice to active controls, include the current search when applicable, and retain the Clear all action. This does not replace fixing compound search.
- **Acceptance:** search-only, points-only, tuition-only and combined empty states each recommend an action the user can actually take. Related: SOL-009.

### UI, responsive design, usability and accessibility

The desktop visual system is consistent with the documented design: serif display headings, sans-serif data, country-tinted cards, full light palette and restrained motion. There is no evidence-based reason here to demand a redesign or dark mode. Native labels, checkbox labels, details menus, Escape focus restoration, a skip target, polite result counts and reduced-motion support are strengths. Narrow-screen concerns are explicitly unverified below.

<a id="sol-018"></a>
### SOL-018 — Default control boundaries are too close in colour to their surroundings

- **Type/status:** confirmed CSS/calculated non-text contrast issue; no formal whole-page conformance assessment. **Priority:** P2. **Effort:** S.
- **Evidence:** `css/styles.css:300`–`:310` and `:387`–`:394` use `--line` around white controls on the filter surface. The source-colour ratios are approximately 1.20:1 for the border against the surface and 1.08:1 for fill against that surface. `tools/check-contrast.mjs:16`–`:19` explicitly excludes non-text contrast. Focus styling is stronger, but does not solve default identification.
- **Affected users:** users with low vision identifying search, numeric, sort and dropdown controls.
- **Recommended change:** introduce an identifiable control-boundary colour meeting the applicable 3:1 contrast requirement; decorative card separators need not become equally dark.
- **Acceptance:** enabled controls remain visually identifiable at default/hover/focus states and high zoom; add the relevant non-text pairs to verification.

<a id="sol-019"></a>
### SOL-019 — Whole-card opacity lowers expired text and links below their checked contrast

- **Type/status:** confirmed CSS and compositing calculation; **conditional state** because there are zero past-deadline rows on the audit date. **Priority:** P2 when this state occurs. **Effort:** S.
- **Evidence:** `css/styles.css:540`–`:541` applies opacity 0.65 to an entire expired card, restoring it only on hover; `js/render.js:31` adds that state. Compositing against the white page reduces muted text to roughly 2.76–3.03:1 and official links to roughly 2.72–2.99:1 across country tints, below 4.5:1 for normal text. The 44-pair checker does not account for this parent opacity.
- **Reproduction:** load a past-date fixture or advance the loader's `today` argument; inspect an unhovered past card. This was calculated from source, not falsely claimed as a current rendered past card.
- **Recommended change:** keep text at full opacity and distinguish expiry with the existing passed badge/surface styling. Test composited states rather than only raw tokens.
- **Acceptance:** past-card text and links meet normal contrast without hover, including keyboard/touch use. Related: SOL-026.

<a id="sol-024"></a>
### SOL-024 — Link navigation gives every admissions destination the same name

- **Type/status:** confirmed markup; accessibility enhancement, not an asserted automatic conformance failure. **Priority:** P3. **Effort:** S.
- **Evidence:** `js/render.js:186`–`:204` gives every source link the same accessible text; external icons are hidden from accessibility APIs. Sequential card reading provides context, but a screen-reader link list does not identify which of hundreds of programmes a link belongs to.
- **Recommended change:** include programme and university in the accessible name, keeping concise visible text if desired; communicate new-tab behavior accessibly.
- **Acceptance:** navigating links independently identifies the destination programme without reading preceding card content; visible layout stays compact.

### Performance and reliability

<a id="sol-012"></a>
### SOL-012 — Successful but unusable CSV responses prevent fallback and empty the catalogue

- **Type/status:** confirmed with in-memory `loadData()` probes. **Priority:** P2: a publication/edit failure defeats the advertised recovery mechanism. **Effort:** S.
- **Evidence:** `js/data.js:26`–`:43` returns successfully after parsing; `:231` only throws if parsed programme rows existed but none survived. `js/csv.js:62`–`:80` permits zero data rows and does not validate schema.
- **Reproductions:** supply valid universities and each of: empty programme text; programme headers only; single-line HTML with HTTP200; a sole row with an invalid column count. All return zero programmes and source `sample` (the internal name for configured local CSV), with no snapshot request. Header-only and HTML cases return no issues. The real valid snapshot remains unused.
- **Impact:** a broken feed looks like an empty finder instead of a recoverable outage. This applies now to a bad published local CSV response and to future Google Sheet use.
- **Recommended change:** validate required schema and usable catalogue data before declaring source success; distinguish intentionally empty setup from a previously populated catalogue failure. Use the snapshot with a warning for unusable primary responses.
- **Acceptance:** all four cases reach a valid saved copy or a clear fatal data-quality state, never a clean zero-catalogue success; one malformed record in an otherwise usable feed remains a reported partial issue. Related: SOL-013, SOL-015, SOL-016.

<a id="sol-016"></a>
### SOL-016 — A request that never settles leaves the app loading without attempting the snapshot

- **Type/status:** confirmed control-flow gap and pending-fetch probe; real-world frequency unmeasured. **Priority:** P2. **Effort:** S.
- **Evidence:** `js/data.js:26`–`:29`, `:52`, `:74`–`:77` have no timeout/AbortSignal. One stalled CSV holds `Promise.all` pending; the saved-copy branch and `js/app.js:75`–`:79` cleanup are not reached. The snapshot fetch is unbounded too.
- **Verification:** an in-memory never-settling CSV fetch receives no abort signal and causes no snapshot request. Browser-level delay/failure routing remains untested.
- **Recommended change:** define bounded primary-source and snapshot fetch times; abort stalled requests and attempt the saved copy; eventually expose the existing error state if both paths cannot complete. A retry control can reuse the load workflow.
- **Acceptance:** a delayed primary request produces usable saved data and a warning within the defined bound; a delayed snapshot eventually yields a readable failure, not indefinite skeletons. Related: SOL-010, SOL-012.

<a id="sol-026"></a>
### SOL-026 — Deadlines and countdowns remain frozen when a tab crosses into another day

- **Type/status:** confirmed source behavior; browser clock rollover not simulated. **Priority:** P2 for users leaving research tabs open. **Effort:** S.
- **Evidence:** `js/data.js:157`–`:217` calculates `daysUntilDeadline`, `deadlinePassed`, `isUrgent` and staleness once. `js/app.js` loads data only at startup; subsequent filters/sorts reuse those properties. There is no midnight, focus or visibility refresh.
- **Reproduction:** open a fixture with a deadline today, leave the tab until tomorrow, then change a filter. It still uses the original today/passed state and deadline-sort rank until reload. A time-specified noon cutoff also needs the richer model in SOL-029; a daily refresh alone does not solve that.
- **Recommended change:** derive time-relative status from the current date during updates or refresh it when the day changes/tab becomes visible, using an explicit timezone policy.
- **Acceptance:** yesterday's deadline becomes passed and sorts accordingly after day rollover without manual reload; countdowns and urgency agree with the current date. Related: SOL-019, SOL-029.

### Security and privacy

No confirmed P0/P1 security exposure was found. Data strings use `textContent`/text nodes, not HTML insertion; URLs are parsed and restricted to HTTP(S); external links use `noopener noreferrer`. There are no application credentials, account passwords, upload endpoints, or runtime package dependencies in the inspected app. A token-like UCD catalogue query is documented as part of a public reporting request and was not established as a private credential; no value is reproduced here.

Filters are processed locally. The dormant shortlist code uses this browser's localStorage, not a remote profile. Google Fonts causes third-party requests (`index.html:15`–`:17`); self-hosting could simplify privacy/offline behavior, but there is no basis for reporting a data breach or demanding a generic cookie banner. The public Sheet must never contain private notes, as the maintenance documentation already explains.

The development server listens without an explicit loopback host (`tools/serve.mjs:75`) and serves project files. Binding it to `127.0.0.1` would be sensible local-development hardening on untrusted networks. This is not a GitHub Pages production vulnerability, and no sensitive-file retrieval or intrusive network probing was attempted. Likewise, dormant CSV export formula handling should be assessed if that feature is restored, not presented as a currently exposed export exploit.

### Maintenance, documentation and data lifecycle

<a id="sol-021"></a>
### SOL-021 — The Italy merge still contains assignments that undo seven corrected Bocconi fees

- **Type/status:** confirmed transformation defect, conditional on reusing its external inputs. **Priority:** P2; not an active browser failure. **Effort:** S.
- **Evidence:** current `data/programmes.csv:1194`–`:1200` contains seven €17,700 standard Bocconi fees. `tools/merge-italy-denmark.mjs:94` restores an obsolete fee/date note; `:112` replaces all Bocconi fees with `?`; `:142` replaces imported university programme rows. Lines16–19 acknowledge the correction happened outside this script. The WBB exception at `:128` is different and must remain distinct.
- **Qualification:** the expected `../../verification/` draft inputs are absent from this checkout. The script was not run and cannot currently be reproduced end to end from this repository alone. The overwriting assignments are nevertheless explicit.
- **Impact:** restoring the expected drafts and reusing the merge would erase known current fees and restore misleading notes; future WBB corrections are also vulnerable to generic replacement.
- **Recommended change:** encode approved corrections in the transformation or clearly retire it as a historical one-off, with reproducible maintained inputs for any supported rerun. Review other documented import reruns against hand corrections before reuse.
- **Acceptance:** a dry/in-memory merge preserves the seven corrected fees and WBB's distinct fee/route; a maintainer knows which commands are safe current workflows. Related: SOL-001.

<a id="sol-022"></a>
### SOL-022 — Refreshing only CAO points advances the whole row's verification date

- **Type/status:** confirmed source; future trust risk for signed records. **Priority:** P2. **Effort:** S–M.
- **Evidence:** `tools/update-cao-points.mjs:9`–`:15` explicitly limits its scope to cutoff notes and score conversion, but `:97` sets `last_verified` to today. `js/render.js:177`–`:180` describes non-AI rows as checked on the resulting date. University date inheritance can cap this today, but it is not a reliable field-level guarantee.
- **Impact:** after human sign-off, an automated points-only refresh could make old subject, fee or deadline data look freshly checked. Currently every row is AI-DRAFT, so this is not a claim that a current human signature has already been falsified.
- **Recommended change:** track field-specific update/check dates or do not advance human verification when only an automated field changes. Keep gathered/updated and personally verified distinct.
- **Acceptance:** refreshing CAO data cannot silently renew human assurance for untouched fields; stale fees/deadlines remain identifiable. Related: SOL-015, SOL-027.

<a id="sol-020"></a>
### SOL-020 — Current inventory and maintenance guidance contain stale or contradictory claims

- **Type/status:** confirmed documentation defect. **Priority:** P3; lower than wrong user-facing admissions facts. **Effort:** S.
- **Evidence:** `STATUS.md:11`–`:19` says 1,245 programmes and 202 Dutch rows; loader/checks show 1,242 and 199. Gap sections around `STATUS.md:80`, `:126`–`:145` retain 757-era denominators. `README.md` describes per-card verification/AI badges and shortlist behavior that the current renderer intentionally removed. `MAINTENANCE.md` uses the old `ib_hl_requirements` column name in later instructions, while the active schema uses `ib_subjects`, and claims maintenance happens in a Sheet despite both Sheet URLs being empty (`js/config.js:8`–`:11`). `STATUS.md` more accurately records these decisions elsewhere, leaving readers to reconcile contradictions.
- **Impact:** a new student maintainer may edit the wrong column, expect a nonexistent UI feature or misunderstand completeness and how to publish data.
- **Recommended change:** provide a single current workflow, separate historical notes from current claims, derive inventory/completeness summaries from the data, and explicitly state that the configured source is Git-managed CSV until the Sheet is connected. Do not restore intentionally removed features merely to satisfy old prose.
- **Acceptance:** counts match the loader, every denominator has a scope/date, schema names are current, and maintenance instructions describe the actual configured source. Related: SOL-015, SOL-021.

<a id="sol-023"></a>
### SOL-023 — Encounter-order ID generation can silently assign an old identifier to another course

- **Type/status:** confirmed in-memory maintenance behavior. **Priority:** P3 today because shortlist saving is inactive; increases if sharing/comparison/persistence returns. **Effort:** M.
- **Evidence:** `tools/lib/ireland.mjs:143`–`:150` makes a 44-character title slug, adding encounter-order suffixes. UCD uses it at `tools/import-ucd.mjs:108`; shared Irish imports at `tools/lib/irish-import.mjs:112`. Reversing the current UCD Mathematics source rows moves `ucd-mathematics` from MMS1 to MSJ2 and swaps the suffixed ID. Galway French/German/Spanish commerce titles also collide after truncation. Unique-ID checks still pass.
- **Impact:** future reruns can change what existing local IDs, research links or restored saved selections mean. Old shortlist IDs are still present in some browsers, even though the current UI hides them.
- **Recommended change:** preserve existing IDs against stable source identity (UCD source record ID; canonical programme/CAO route identity elsewhere), following the already-fixed Charles mapping approach. Do not regenerate all published IDs as a cleanup.
- **Acceptance:** reorder, rename and remove unrelated input rows without changing the identity of surviving published programmes. Related: SOL-031, SOL-032.

### Product opportunities and new features

These are proposals grounded in the current workflow. They are not assertions that every missing capability is a bug, and they do not override the recorded decision to remove saving.

<a id="sol-027"></a>
### SOL-027 — Establish a checked cohort with field-level evidence before expanding the catalogue

- **Type/status:** proposed research-assurance workflow; **P1 expected value**, not a new critical software exposure. **Effort:** M with ongoing human research.
- **Motivation/evidence:** all 1,242 records remain AI-DRAFT; `STATUS.md:67`–`:80` already recommends signing off 15–20 priority programmes. SOL-001 through SOL-008 show why links and an initial automated pass are not enough. One `official_url` and one row-wide date cannot explain a fee, historical cutoff, language exemption and deadline derived from different documents.
- **First version:** select the programmes classmates actually intend to research. For each consequential field, record source URL, application/fee year, checked date and whether it is published, inferred, unavailable, or not checked. Ask a person to verify the actual relevant policies before signing. Use a compact card-level status/details affordance, not repeated long warnings on every line. Distinguish not researched from the stronger claim that a university has not published a value.
- **Benefit:** makes a small subset dependable and exposes exactly what still needs research; enables focused maintenance when one policy changes.
- **Acceptance:** the selected cohort has source-backed deadlines, fee eligibility, subject/English rules and correct admission routes; blank signer is never verified; known unknowns remain explicit; a later automated import does not erase evidence or imply a new human check. Related: SOL-015, SOL-022.

<a id="sol-028"></a>
### SOL-028 — Pilot subject compatibility with an explicit unknown outcome

- **Type/status:** proposed enhancement. **Priority:** P2; valuable after correcting the current model/data. **Effort:** L including manual rules and validation.
- **Motivation:** `js/data.js:183`–`:193` stores unstructured prerequisites, and `js/filters.js:33`–`:59` cannot consider AA/AI, HL/SL, grade alternatives or combinations. Dutch programmes often have no total-score minimum, so My points alone provides limited help.
- **First version:** manually structure rules for the checked 15–20-programme cohort. Let a student enter relevant subjects/levels/grades locally. Show recorded requirements met, recorded requirement not met, or needs checking, retaining original text and sources. Do not automatically parse all 921 unknown-subject rows into a reassuring answer.
- **Acceptance:** AA and AI, HL and SL, alternative combinations and unknown rules stay distinct; a partial record cannot receive a complete eligibility verdict; meeting recorded requirements never implies likely admission. Related: SOL-003, SOL-006, SOL-027.

<a id="sol-029"></a>
### SOL-029 — Add application milestones instead of relying on one date and prose notes

- **Type/status:** proposed enhancement. **Priority:** P2; pilot urgent programmes first. **Effort:** M.
- **Motivation/evidence:** `js/data.js:152`, `:204`–`:205` models one deadline; `js/render.js:54`–`:63` gives it the only countdown. Current notes already contain separate obligations: VUT portfolio after its application, Danish noon cutoffs/document delivery, DTU's IB-coordinator instruction, AAU's signed page. These are not captured by the main sort/countdown.
- **First version:** optional milestone records with task, date, officially stated time/timezone, applicable applicant group and source. Keep the headline date but expose additional tasks in a compact details view. Include an individual calendar download only after date/time semantics are sound; accounts/reminders are not necessary for an initial version.
- **Acceptance:** application, portfolio/test, document and coordinator deadlines remain distinct; noon deadlines are not treated as end of day; unknown future rounds are not guessed from last year; sources and application year are visible. Related: SOL-001, SOL-026.

<a id="sol-030"></a>
### SOL-030 — Put tuition in a sourced affordability context

- **Type/status:** proposed enhancement. **Priority:** P2. **Effort:** M, primarily research.
- **Motivation/evidence:** all 35 `living_cost_monthly` fields are empty, although `js/render.js:70`–`:72` already supports them. The current budget filter compares tuition only. This is honestly labeled Max fee, but cannot answer whether studying in Dublin, Prague or Milan is affordable. Some displayed EU figures also assume a specific residency/Free Fees status; nationality alone is not always sufficient.
- **First version:** source city living-cost ranges for the checked cohort, display fee conditions and academic year, and show a transparent annual illustration using an explicit 10- or 12-month assumption. Keep tuition, living costs, mandatory extras and possible one-off costs separate. Multi-institution programmes require year/location-specific treatment. Add a total-budget filter only when coverage is meaningful.
- **Acceptance:** unknown rent/cost never means zero; estimates state source/date/assumptions; tuition eligibility can be checked; joint degrees cannot imply a single fee/city for every year. Related: SOL-002, SOL-004, SOL-027.

<a id="sol-031"></a>
### SOL-031 — Make a research search survive reload and be shareable with a parent or counsellor

- **Type/status:** proposed enhancement; current reset behavior confirmed. **Priority:** P2. **Effort:** S–M.
- **Evidence:** `js/app.js:46` creates in-memory state; `js/filters.js:6`–`:17` resets defaults; input handlers do not serialize it. Browser search Delft shows four programmes, then reload returns an empty query and 1,242 programmes. The URL does not describe a selected view or individual programme.
- **First version:** encode existing filters/sort in URL parameters with predictable Back/Forward behavior, and add stable per-programme anchors. A Copy search link action should explain that it contains points/budget if included; use opt-in sharing and keep private notes out of the URL. No accounts are required.
- **Acceptance:** a copied link recreates the intended view, malformed/obsolete parameters fail safely, reload preserves it, and stable identifiers survive importer reorder. Related: SOL-023.

<a id="sol-032"></a>
### SOL-032 — If stakeholders want comparison, start with a small explicit selection rather than rebuilding accounts

- **Type/status:** proposed enhancement requiring product agreement; no current defect. **Priority:** P2 expected value. **Effort:** M.
- **Motivation:** the purpose includes comparison, but actual use is scrolling cards and opening source tabs. Two courses cannot be held side by side with aligned admission basis, subjects, fees and unknowns. Shortlisting was deliberately removed (`STATUS.md` decision section; `js/render.js:44`, `js/app.js:226`–`:231`), so restoring its old controls without revisiting the decision would be inappropriate.
- **Sensible first version:** temporary Compare selection for two to four programmes, independent of saved favourites. Align general eligibility, course subjects, historical-versus-minimum score basis, admission method, language proof, applicable fee and deadlines. Preserve unknowns and source links. Group shared CAO routes so multiple streams are not mistaken for independent applications.
- **Acceptance:** comparisons show source/basis/year, never rank offer probability from points alone; removals and mobile layout are usable; selection uses stable IDs and does not reactivate broken legacy saving implicitly. Dependencies: SOL-003, SOL-006, SOL-007, SOL-023, stakeholder decision.

## Unverified questions and follow-up checks

1. **Mobile dropdown positioning and sticky focus:** inspect 375/390px and 720/768px viewports, a short landscape screen, and zoom. `css/styles.css:339`–`:346` left-aligns an absolute panel with a 15rem minimum, which may spill when a menu is near the right edge; wrapping can change the result. Check Country and Language specifically. At 720px+, verify the sticky filter (`:852`) does not obscure the skip target or focused card links. These are hypotheses, not reproduced failures.
2. **Performance on a modest device:** the full desktop document had 46,126 DOM elements. `js/app.js:203`–`:206` and `js/render.js:16`–`:17` rebuild matching cards after each update. `content-visibility:auto` reduces offscreen layout/paint but not DOM construction. No controlled latency was measured, so this is not labeled a confirmed performance defect. Measure startup, broad-query edits and checkbox changes on a midrange phone before choosing pagination, chunking or incremental rendering.
3. **Live Sheet and total network failure:** the Sheet is unconfigured. Before enabling it, test delayed requests, invalid publication/HTML, missing one tab, partial edits, stale snapshot and failed snapshot in a browser. Verify warnings and accessibility announcements, including SOL-010/012/016.
4. **Irish conversion policy for the intended cohort:** the repository claims a 2026 CAO table; Trinity's current indicative page has different figures. Confirm the official 2027 conversion and bonus treatment when published. Do not silently change all scores from one contradictory general page. SOL-003's confirmed historical/minimum conflation and ignored bonus do not depend on resolving every conversion value today.
5. **Programme coverage and exceptional routes:** verify remaining named tests, graduate/direct/dual routes, and fee exceptions after the identified failures. Review course pages that share CAO codes and potential duplicate/stream records before deduplicating; a repeated code or university admissions URL is not by itself a duplicate programme.
6. **Official-check limits:** Charles's linked SIS URL was inaccessible through the search retrieval tool, but the faculty's [2027/28 English CS requirements](https://www.mff.cuni.cz/en/admissions/admission-requirements-for-bachelor-s-programmes-in-english/2027-2028), accessed **2026-10-25**, corroborated IB Maths AA HL6 or AI HL6 as one accepted reasoning qualification, IB English6 as one accepted language qualification, and the 30 April 2027 application deadline. These are accepted qualification routes rather than universally mandatory IB subjects. This was not a complete Czech fee/nostrification review. Delft's linked page corroborated selection/VWO context and a January numerus-fixus deadline; its detailed IB AA/AI mapping and 2027 capacity were not independently reverified. Do not treat those sampled supporting checks as whole-row sign-off.
7. **Data freshness and years:** many programme notes mix 2026 fee/cutoff rules and 2027 application dates. Check per-field cohort/year explicitly rather than treating the latest row date as proof everything applies to 2027/28. Never automatically roll forward a deadline without official support.
8. **Accessibility:** run actual screen-reader link/form navigation, mobile touch targets, high zoom, forced colours, focus visibility and keyboard traversal through open dropdowns. The static colour checker passing does not settle these questions.
9. **Hosting/security perimeter:** production response headers, GitHub Pages configuration, Google Sheet publication permissions and account security were not audited. No exposed credential or applicable dependency CVE was established. Do not infer either safety certification or a vulnerability from that limited scope.

## Coverage checklist

| Area | Checked | Remaining |
|---|---|---|
| Repository identity, main, clean starting state | Yes; correct fork/origin/SHA; latest origin/main fetched and safely integrated before report commit | No application divergence found |
| Instructions and product decisions | README/STATUS/MAINTENANCE; intentional removals respected | Resolve conflicting historical documentation |
| Architecture/routes/components/data | Single-screen app, every JS module, relevant CSS and import tools | No hidden backend assumed |
| Search/filter/sort/reset | Source, existing checks, representative desktop interaction | More browser combinations and mobile |
| Requirements/admission meaning | Source and high-risk official samples | Full dataset and future cohort policies |
| Language/fees/deadlines | Data coverage, exceptions, unknown handling | Full field-level research and secondary milestones |
| Shortlist/compare/persistence | Confirmed inactive UI; legacy code reviewed; reload tested | Stakeholder decision; no restored feature tested |
| Loading/empty/error/fallback | Source and in-memory corrupt/pending feed probes; snapshot parity | Browser routing/failure/slow-load tests |
| UI/responsiveness | Desktop visual inspection; responsive source review | Narrow/mobile/Safari/real touch not tested |
| Accessibility | Labels/details/Escape/result count/source contrast checks | Screen-reader and comprehensive WCAG testing |
| Security/privacy/dependencies | DOM sinks, URLs, storage, public config, external requests, dependency-free architecture | Production hosting/account perimeter; intrusive testing excluded |
| Performance | Rendering strategy, dataset/DOM scale | Controlled mobile/desktop latency benchmark |
| Existing checks | Both Node check commands pass | Regression cases recommended in findings are not implemented |
| Independence and write boundary | Opus report not read; workers read-only; application unchanged | Only this report is authorised for commit |

This audit intentionally leaves implementation to a subsequent task. The prioritised action sequence is provided in the accompanying chat, not duplicated here.
