# Where this project is

Written so anyone — including a fresh session with no memory of the work — can
pick it up without re-deriving decisions. Update it when the state changes.

**Live:** https://kpolacik.github.io/ib-university-finder/
**Repo:** https://github.com/kpolacik/ib-university-finder

## State

**Design round 2 (2026-11-05)** is on the branch `redesign-round2-only`, a
PR for `main` without the Supabase switch-over. It ships the white 56 px
header (also 56 px when compact), two filter rows with custom sliders, a
filter-summary detail pane, saved filters and five-step onboarding. The
progress bar is hidden at step 1, then shows 25/50/75/100%, while the label
stays "Step n of 5". Column headings are sort buttons; the phone keeps its
Sort select. The switch and unset slider thumb use a softer contrast outline.
The footer says "Data comes from the universities' official pages and the
CAO; living costs are estimates." Data
still loads from the CSVs, then `data/fallback.json`, as before. Rules and
sources are under *The look of it*; the sort cycles and Leon's decisions are
under *Decisions*.

**SK/EN infrastructure (2026-11-03).** English is the default (Jakub, 2026-11-04; it was Slovak until then). The EN/SK buttons
switch in place, preserving filters, selection and scroll. URL `ui=sk|en`
wins over this browser's stored choice. `lang=` stays the teaching-language
filter only (`lang` was taken, hence `ui`). Share-list links never carry the UI language. All UI
wording is keyed in `js/i18n.js`. The Slovak UI table is filled (AI-DRAFT: Opus 5.5 translated it,
Sol checked the meaning; a missing entry falls back to English). The 660
AI-DRAFT data translations are in `data/i18n/sk.csv` and the offline snapshot.
Rows and Compare show translated data or plain English without EN markers.
In Slovak details, one “Zobraziť originál v angličtine” button reveals all
translated originals beneath their Slovak text (it then reads “Skryť originál”). Its state survives re-renders
per programme and resets on an interface-language change. Equal SK/EN values
stay plain. Each detail section containing untranslated data has one quiet
“V angličtine, ako to uvádza univerzita.” line; English text keeps lang="en". Exact field + whitespace-normalised English
lookup runs after parsing and inheritance; whole cells win, then list items.
`tools/i18n-missing.mjs` reports missing/orphan rows without writes.

Decisions: informal **ty**, English default (changed from Slovak by Jakub on 2026-11-04), decimal dots kept in data wording
(IELTS 6.5), quoted official text stays English. Data parsing, filtering,
sorting, points and costs keep English source values; search matches both
languages. CSV headings follow the language, data cells stay English.
IB subjects, deadline notes and other requirements remain English for the
later data-translation pass. A later Gemini meaning check remains an owner
follow-up from the translation plan.


2,915 programmes · 159 universities · 11 countries, counted from `data/*.csv` on 2026-11-02, right after the upstream merge (the table below is the same count by country). Recount with a small node script if you need the figure again; don't trust this line after a data change.

`node tools/lint-data.mjs` checks maintainer edits before a commit (T05) and detects swapped, renamed or missing ids against HEAD, or `--against ORIG_HEAD` after a merge (M02). Reciprocal swaps and chains of shifted ids (an importer meeting one more row first) are errors; other identity changes need a human review. A mistyped `--against` ref stops with exit 2. Importer id preservation is still open.

**FAQ one tap away** (Leon, 2026-11-09: "someone looking for faq has to scroll through all rows"). The header has a "?" button (named "FAQ" / "Časté otázky" for screen readers) between Compare and SK/EN. It opens the questions in a panel: a sheet from the bottom on phones, like Filters, and a side panel from the right from 600 px. (Since the same day the panel is the FAQ's only home; see the next-but-one entry.) The panel works like the Filters sheet (`show()`, its own scrim, focus trap, Escape, no page-wide inert, same 280/220 ms curve), can be reopened mid-close, fades in 120 ms with reduced motion, and only locks page scrolling on phones (from 600 px a wheel over the scrim is stopped instead). Setup's "Read the FAQ" now opens this panel and closing it returns to the list; the old scroll-to-the-footer jump and its re-aiming are gone. On a 600-700 px touch screen the header buttons sit 4 px apart so Search keeps 160 px. Checks: `check.mjs` section "FAQ panel"; smoke `--faq-only`. Known gap: on phones the header scrolls away, so "?" is only at the top of the page; and opening it during the first 2-3 s while rows are still being added took ~1 s in Chrome on a phone width (about 0.3 s once they are in).

**FAQ text rewritten** (Leon, 2026-11-09): 12 questions in EN and SK, ending with a contact link to ibuniversityfinder@gmail.com; quoted button and badge names are checked against the real labels (`check.mjs` "FAQ text, twelve questions").

**FAQ moved from the footer to the "?" panel** (Leon, 2026-11-09). The twelve questions now live only in the panel's markup in `index.html`; the footer keeps "Check before you apply", the source line and a "FAQ" button that opens the panel (focus returns to it). The FAQ no longer prints. From 1024 px the header's "?" also says "FAQ" / "Časté otázky". The panel shares the Filters sheet's motion tokens (`--ease-sheet`, `--t-sheet-in` 280 ms, `--t-sheet-out` 220 ms), is laid out once before its first open, and rows pause while it slides. Answers grow open over 260 ms with the "+" turning in step (Chrome; Safari opens them at once). Questions are 16 px in 44 px rows, answers 14 px in the secondary grey, no line under the last one, and neither sheet has a shadow (the scrim separates them). Setup's done screen adds "Reopen the FAQ any time with ? at the top." Setup's two hints ("Discards these answers", the HL Maths bonus) sit closer under their labels, so the dialog is a little shorter. Checks: `check.mjs` "FAQ panel"; smoke `--faq-only` and `--setup-only` (LP-S5).

**My list** (2026-11-03, Leon reversed the 2026-10-24 removal): every row has a save star (a bookmark) and the detail a "Save to my list" button. The saves live in this browser's storage (`js/shortlist.js`), keyed by `programme_id`. A bar under the count says "N saved · M shown" and offers "Show all saves" when the filters hide some. "Open my list" shows only the saves, with the page's filters still applied (or switched off with "Show all saves"), grouped by deadline month, by My IB points (within / only with HL Maths 4+ / above / can't be compared, from `pointsBucket`) or by country. From the list: **Share** a link `?list=id,id` (plus `points=` only when "Include my IB points" is ticked; no other filter travels), Export CSV, Print and Clear my list. An incoming `?list=` link opens a "Shared list" view of the programmes that still exist, says how many no longer do, and changes the saves only on "Save these to my list" (which adds, never replaces). `list` stays in the address only while that view is open.

**Compare** (batch 3, Leon 2026-11-05: "comparing something and saving something is not really the same intent") is its own set of up to four programmes, kept in this browser (`js/compare-set.js`, key `ib-university-finder:compare:v1`), independent of the saves, the filters and the address. Every row, phone card and detail has a scales toggle beside the save star; a fifth add changes nothing and says why, with "Open compare". On phones (and short windows) a bottom tray says "Compare n of 4 · Open"; from 600 px a header button beside My list does. The view works at any count (an empty state at 0, a prompt at 1); each column has a Save toggle and an "x" with Undo. "Show only differences" never hides a fact that is unknown for any of them; on a phone two columns show at a time, with a "Programmes 1–2 of 3" line, arrows and an edge fade (`js/compare.js`).

**Saves belong to one web address.** Browser storage is kept per site origin (scheme, host and port). Saves made on a test address (`localhost`, a preview host, Leon's old fork) are not on the live site at `kpolacik.github.io`, and the other way round; a different browser or device has its own list too. To move a list, use Share and open the link on the other address, then "Save these to my list".

**Yearly cost** (2026-11-03): each row shows the monthly living cost under the EU fee, the detail adds "Fee + 12 months' living (estimate)", and two filters sit beside Max EU fee: Max yearly cost (`budget` in the address) and My living costs (`living`). The sum lives in `js/cost.js`; living costs from a visa or residence-permit rule (Germany, Norway, Sweden, the UK visa figure) are labelled "national minimum, not a full budget" and always count as "may exceed" against a budget.

Subject filters now use 23 fixed names, including Sports Science, with old names mapped in code (S02). Unclassified rows stay visible and labelled. Importers leave unmatched titles blank and no longer mistake Physical Education for Physics or tělesná for forestry (D30, D31); existing CSV rows are unchanged.

| Country | Universities | Programmes | Notes |
|---|---|---|---|
| Netherlands | 13 | 196 | **Complete** — every Dutch research university |
| Ireland | 7 | 548 | **Complete** — every Irish university |
| Czechia | 5 | 424 | **The big five**, added 2026-10-24 — Czech- and English-taught |
| Italy | 15 | 99 | English-taught only — Bologna, Sapienza, Bocconi, PoliMi, PoliTo, Padova, Milan Statale, Trento, Pavia, Milano-Bicocca, Ca' Foscari, Turin, Tor Vergata, Luiss, Cattolica |
| Denmark | 7 | 31 | English-taught only — CBS, Aarhus, SDU, Aalborg, DTU, ITU, Roskilde |
| Sweden | 25 | 95 | English-taught only — every bachelor universityadmissions.se lists for autumn 2027, added 2026-10-27 |
| United Kingdom | 25 | 883 | **Shown since 2026-11-02** (see Decisions). Russell Group and other leading universities: 19 researched by Jakub (CAS/verification/uk, on his machine), merged 2026-10-29; Liverpool, Newcastle, Nottingham, QMUL, York and Queen's Belfast added 2026-10-29. Cardiff missing (blocks this machine) |
| Austria | 7 | 92 | English-taught bachelors at public universities and CEU, plus every German-taught bachelor at Vienna, TU Wien and WU, added 2026-10-29 |
| Germany | 38 | 474 | English-taught university bachelors from the DAAD database (61), plus German-taught bachelors at TUM, LMU, Heidelberg (140, 2026-10-29) and KIT, RWTH, TU Berlin, FU Berlin, Freiburg, Tübingen (273, 2026-10-30). HU Berlin missing (bot check blocks this machine) |
| Norway | 5 | 14 | English-taught bachelors at universities on Study in Norway's list, added 2026-10-27 |
| Finland | 12 | 59 | English-taught university bachelors on Studyinfo.fi for autumn 2027 (most are bachelor + master), added 2026-10-27 |

**Upstream merge (2026-11-02).** The fork's redesign merged Jakub's `main`
(c7b5495). Leon's rule: Jakub's data and choices win. So Jakub's two CSVs
are the base, and the fork's own data fixes were then re-applied **cell by
cell, only where Jakub had not changed that cell** since the two sides split.
The tally: 585 fork cells applied (584 programme cells, 1 university cell),
34 conflicts kept as Jakub's (33 + 1), and 2 fork-only rows added back,
`ucd-medicine` and `ul-undergraduate-entry-medicine-bmbs`. Those two rows
have no `ib_subjects`, `ib_maths` or `entrance_exam` yet. The fork's own
columns (`application_system` on programmes, `aliases` on universities) were
kept. Of the 34 conflicts, 29 were only `last_verified` dates; the others
were `tue-ds` deadline notes (the fork's "no selection" fact survives as open
entry in `admission`), `rug-ucg` notes and other requirements (settled below)
and `lei-iro` other requirements and notes (Jakub's text quotes Leiden's page).
The full cell log was a one-off working file and is not kept.

Jakub's three features now work in the redesigned page: the **My maths**
filter (`ib_maths`), the **Entrance exam** filter (`entrance_exam`) and the
**living-cost range** (`living_cost_min`, `living_cost_max`,
`living_cost_source`), shown as "Living costs" in each programme's Applying
section. The UK is shown (Leon, 2026-11-02; see Decisions). Jakub's notes on
each country follow, then his 2026-10-26 additions for Denmark and Italy.

Found while finishing the merge:
- **The CAO "#" tag.** Irish courses with a test, interview, portfolio or
  audition carry `Test, interview, portfolio or audition` in
  `other_requirements`; the site, `update-cao-points.mjs` and the checks read
  that tag to know a cutoff may include test marks (Q12, D27). Jakub's data
  replaced it with specific labels ("Audition", "Interview (adds points)"), so
  the CAO refresh put the tag back after his label on 19 rows. Keep it, even
  next to a more specific label. The 11 D27 rows now show no IB figure.
- **MH002** (Maynooth) has no 2026 cutoff: the CAO table lists it as a bare
  "#", so the row shows "No 2026 cutoff published" and no figure.
- **Dropped again:** vu-las (AUC listed twice, Q10/D22) and the two
  graduate-entry rows (UCC CK791, Trinity graduate pharmacy). Jakub's edits to
  them were bulk column fills, not a decision to keep them.
- **UCG:** Jakub's "Early Bird deadline 15 January 2027" is right (rug.nl);
  the February intake closes 1 November for a non-Dutch diploma, not 1 January.
- **`?` in `entrance_exam` and `ib_maths`** means "not known" and is allowed
  by the lint, as in Jakub's MAINTENANCE.

**Sweden** (`tools/add-sweden-2026-10-27.mjs`, which quotes every page). The
list is UHR's: universityadmissions.se's search API, autumn 2027, bachelor
level, all English-taught. Subject lines are converted with UHR's own IB table
(Maths 3c = any IB maths course, AI SL with a 4; Maths 4 = AA SL 4+ or any HL;
Civics 1b is met by the IB Diploma itself). Deadline 15 January 2027 for the
international round; EU citizens can also use the 15 April round where a
programme is still offered. Selection is on grades (merit rating); the SweSAT
the pages mention is optional and in Swedish, so it counts as no exam. Music
auditions, Gothenburg's admission tests and SSE's SAT/ACT/ITB-Business are
`yes`. Gaps: Linnaeus University (10 rows) and Mid Sweden University (1) block
this machine, so their subjects and exam are "not checked"; Halmstad's Applied
AI and LiU's Experimental Biomedicine show no specific requirements on their
pages; living costs are one national floor (Migration Agency, SEK 10,656 →
€957) rather than each university's own figure.

**Finland** (`tools/add-finland-2026-10-27.mjs`, which quotes every page). The
list is Studyinfo.fi's (national portal API): university bachelors whose
teaching language is English only. Universities of applied sciences are left
out, as everywhere else. IB holders mostly go through certificate-based
admission: IB grades scored with the national tables on yliopistovalinnat.fi,
whose IB thresholds are on the cards (technology: advanced maths and chemistry
or physics, 2+ in both and 4 in one; business: maths 2+; Aalto's own: advanced
maths 6+). Deadlines: joint application 21 January 2027, Aalto round B 22
January, Helsinki group 2 (IB) 23 March, LUT rolling until 30 April. LUT's
entrance exam is `waivable` (a maths test only if your maths falls short).
Exams (`yes`): Aalto Design and Media, three UEF programmes, two at
Jyväskylä (one by SAT/ACT), Uniarts Global Music. Gaps: Vaasa's 2027 round
isn't on Studyinfo yet; UEF Lifelong Learning's threshold wasn't found; LUT's
IB table is still headed "2026"; English requirements are filled only for
Aalto, LUT and UEF.

**United Kingdom** (`tools/merge-uk-2026-10-29.mjs`, then
`tools/fix-uk-2026-10-29.mjs`). Merged from Jakub's research. Three things
were corrected on 2026-10-29: tuition_eu held the Home fee, but EU students
have paid the international fee since August 2021 (GOV.UK eligibility rules;
Irish citizens and settled status excepted, as most UK cards say); pounds were
stored as euros (now converted at the ECB rate of 29 October 2026, the pound
figure kept in the note); living costs mixed monthly, weekly-rent and annual
figures (now monthly, with the GOV.UK student-visa amount where only rent is
published). Subject areas were mapped onto the site's list and
other_requirements onto " · ". The quoted evidence (CAS/verification/uk/
sources) is on Jakub's machine, not in the repo. Oxbridge, medicine,
dentistry and vet deadlines (15 October 2026) have already passed.

`tools/add-uk-russell-2026-10-29.mjs` adds the other Russell Group members:
Liverpool 33, Newcastle 39, Nottingham 38, QMUL 33, York 34, Queen's Belfast
36 core programmes, each from its 2027 course page (IB offer, international
fee, IELTS). Cardiff refuses this machine (403), so it is still missing.
Newcastle's IELTS comes from its course-data service and QMUL's from its
per-school English bands (filled 2026-10-30). Liverpool Medicine and three QUB pages print no IB offer. Queen's charges EU
students its "EU Other" fee (= international); the £4,985 NI fee applies to
Irish citizens living in Ireland.

**Austria** (`tools/add-austria-2026-10-29.mjs`). English-taught: JKU 6,
Klagenfurt 5, Leoben 3, WU's BBE, Vienna's Data Science and English and
American Studies, CEU 3. German-taught (best universities only, as asked):
all 57 other University of Vienna bachelors, 15 at TU Wien, WU's WiSo. The
national database (studienwahl.at) refuses this machine. Deadlines: 5
September (the statutory end of the admission period); programmes with an
entrance procedure register in spring, and their 2027 dates aren't out, so
those rows show 2026's dates in the note and no deadline. German-taught
programmes need C1 German.

**Germany** (`tools/add-germany-2026-10-29.mjs`). English-taught: every
bachelor at a university in the DAAD's International Programmes database (TUM's
Singapore degrees aside); each official_url matches DAAD's "Course website"
link. German-taught (best universities only, as asked): TUM 31, LMU 58,
Heidelberg 51, from each university's own course finder. The IB counts under
the KMK agreement (15.06.2023): with Maths SL the entry is subject-restricted
and excludes STEM unless the school is in the KMK annex, so STEM rows ask for
Maths HL. Deadlines are mostly 15 July (TUM's foreign-certificate VPD via
uni-assist, LMU's International Office, Heidelberg's restricted subjects);
Heidelberg's unrestricted subjects run to 31 October. German-taught rows need
C1 German (DSH-2 or equivalent). Exam values were settled on 2026-10-30 from
the admission statutes: Heidelberg Chemistry, Physics and Computer Science
are grades plus an interview (no), English Studies has a written test (yes);
LMU Anglistik has a written language test (yes). Only LMU's two art degrees
stay "?" (a three-stage Eignungsprüfung that starts with a portfolio; the
later stages aren't described).
Living costs fall back to the German student-visa figure (€992) where a
university gives none.

Part 3 (2026-10-30) adds every current German-taught bachelor at KIT 33,
RWTH 35, TU Berlin 40, FU Berlin 56, Freiburg 46, Tübingen 63, each from the
university's own course finder (three are taught in English per their pages: FU
Englische Philologie and Nordamerikastudien, Tübingen Interdisciplinary American
Studies); HU Berlin's site sits behind a bot check this
machine can't pass. Deadlines follow each university's international-applicant
rules (KIT: EU 15 July or 15 September per programme; RWTH: open 20 October,
NC 15 July; TU and FU: 2026's windows, the FU decides NC status each summer;
Freiburg: each programme's window; Tübingen: NC 15 July, open 30 September).
Exam "?" for KIT Architektur (a "Praxisbezogene Aufgabe"), KIT Sport, RWTH and
Freiburg Psychology (test not said to be optional / statute not checked);
Tübingen Sport needs the Sporteingangsprüfung (yes), Freiburg Sport can be
met with school Sport grades (waivable). Ten Tübingen pages don't state BA or
BSc, so their degree is blank.

**Norway** (`tools/add-norway-2026-10-27.mjs`). The list is Study in Norway's
"full degree programmes taught in English", bachelor level (31), kept to
universities: Agder 4, Nord 5, BI 3, NMBU 1, Oslo 1. Applicants with a
non-Nordic diploma apply to each university directly (Samordna opptak asks for
Norwegian), so deadlines differ: 1 December 2026 (NMBU, UiO), 15 December
(UiA music), 1 March 2027 (UiA, BI priority), 15 April (Nord). BI is private
(NOK 106,400 a year, €10,178). Left out: Stavanger's Dance (uis.no blocks this
machine), the Academy of Music (mainly Norwegian), Nord Animal Science
(Norwegian-language route). Living costs: UDI's NOK 15,488/month = €1,481.

Italy and Denmark were researched by a second model (CAS/verification/) and
merged on 2026-10-25 by `tools/merge-italy-denmark.mjs`, which records what
was re-checked and corrected. Italian rows are thin on purpose: no Italian
university publishes an IB minimum, 2027/28 round dates are not out, and
public fees depend on family income (ISEE), so deadlines and fees show "Not
published". The University of Copenhagen has no rows because it teaches every
bachelor in Danish.

**Missing English bachelors, 2026-10-26** (`tools/add-programmes-2026-10-26.mjs`,
which quotes the page behind every row). Denmark +6: Aarhus Data Science, SDU
Interactive Technology Engineering (Vejle; English per the Danish page, uniTEST
dates for April 2027), ITU Data Science, and Roskilde's three international
bachelors (Global Humanities, Natural Sciences, Social Sciences). ITU and
Roskilde are new universities. Looked for and **not added**:

- *Aalborg IT, Communication and New Media (Copenhagen)* — not offered. Neither
  aau.dk's nor en.aau.dk's sitemap lists it; AAU's English bachelors are only
  Applied Industrial Electronics, Chemical Engineering and Biotechnology,
  Economics and Business Administration and Energy Engineering (all here), plus
  Language and International Studies, English, whose page gives "Language:
  Danish" and requires Danish A.
- *SDU Economics and Business Administration (Sønderborg, English)* — not
  offered. SDU's English programme list has twelve programmes and no
  economics/business one; its business degree (HA) is Danish-taught.
- *ITU Global Business Informatics* — taught in English, but requires "Dansk på
  A-niveau" (passed), so it is not open to a Slovak IB applicant without Danish.
- ITU's English site (en.itu.dk) resets most connections from the cloud
  machine. The facts were first read on the Danish site www.itu.dk; on a later
  retry the English page answered too, so ITU's row now links to it.
- *Aarhus Cognitive Science* stays, but AU expects to switch it **from English
  to Danish** for the 2027 intake (decision around 1 December 2026; Danish A
  would then be required). The card says so. Re-check after 1 December.

Italy, Padova +9 (new university): seven English bachelors plus the two
English medicine degrees (Venice; MedTech in Padua). Padova is the first
Italian university here with a 2027/28 date: its application portal gives the
EU call as 15 March – 7 April 2027 for every bachelor (formal calls still
"TBD"), so those rows carry 7 April. Medicine has no 2027/28 call yet; its
note gives the 2026/27 dates. Not added: *Italian Medieval and Renaissance
Studies* (first three semesters in English, the rest in Italian), and four
bachelors Padova lists as "new programme 2027/2028 - to be approved" with no
programme page yet (Management, Finance and Business Analytics; Physics for
Technology; Food Safety for Global Health; Innovative Technologies in
Agriculture) — add them once approved. Biology of Human and Environmental
Health is the joint degree already listed under Bologna; it now has a Padova
row too, because you apply to each university separately.

Italy, Milan Statale +4 (new university): IPLE, Economics: Behavior, Data and Policy,
Ancient Civilizations for the Contemporary World (joint with Ca' Foscari,
applied for through Milan) and the International Medical School. Its pages
still show the 2026/27 calls, so no deadline; each note gives last year's
window. Artificial Intelligence, also on Milan's list, is administered by
Pavia and is listed there.

Italy, Trento +4 (new university): CEILS (law, all English) and the English
tracks of Computer Science, Computer, Communications and Electronic
Engineering, and Economics and Management. Its pages show only the 2026/27
calls, so no deadline. Not added: *Biomolecular Sciences and Technology* —
listed as "English Italian" with no separate English track and no English page.

Italy, Pavia +3 (new university): Artificial Intelligence (joint with Milan
Statale and Milano-Bicocca, run from Pavia), Social Sciences for Global
Challenges (open access) and the Harvey medical course. No 2027/28 calls yet.
Not added: *Ingegneria Edile-Architettura*, listed as English and Italian but
taught in Italian in the first year.

Italy, Milano-Bicocca +3 (new university): Economics and Science for
Environmental Sustainability, Physical Sciences for Innovative Technologies
(joint with Pavia, blended) and the English School of Medicine and Surgery in
Bergamo. Bicocca publishes no general entry baseline on these pages, so its
university row leaves it blank (the card falls back to "a qualifying secondary
school diploma").

Italy, Ca' Foscari +7 (new university): Business Administration and
Management, Digital Management (Roncade), Economics and Business, Computer
Science's English Data Science curriculum (Mestre), Hospitality Innovation and
e-Tourism, Italian and Mediterranean Studies, and Philosophy, International and
Economic Studies. Worth knowing: for the TOLC-E programmes Ca' Foscari states
"English TOLC-E tests will not be considered" — the cards say so. Ancient
Civilizations is the Milan-run joint degree, listed under Milan.

Italy, Turin +4 (new university): Business & Management (SAT-based),
Economics and Finance with Data Science, Global Law and Transnational Legal
Studies, and Medicine and Surgery (Orbassano). Economics and Finance with Data
Science's course page contradicts itself ("Local programmed" in its header,
"accesso non programmato" in its text); UniTo's admissions page settles it —
limited access on the SAT, one call and timetable with Business & Management.
Not added: nine bachelors
UniTo tags "English Italian" — Italian-taught degrees admitted on the Italian
TOLC-E with English modules, and no English track on their pages.

Italy, Tor Vergata +5 (new university): Business Administration and
Economics, Engineering Sciences, Global Governance, Medicine and Surgery and
Pharmacy. **en.uniroma2.it refused every connection from the cloud machine**
and catalogocorsi.uniroma2.it returned 503, so these come from the Italian
site web.uniroma2.it, whose programme pages state "Lingua: Inglese". A retry
on 2026-10-26 still got no answer from en.uniroma2.it. Global Governance and
Pharmacy are filled in from their 2026/27 calls: Global Governance selects on
CV and school record plus an English interview over four rounds (the first
opened in November 2025, so watch for the 2027/28 one); Pharmacy ranks on
CEnT-S with an English interview.

Italy, existing universities re-checked. Bologna's catalogue filtered to
English lists 15 programmes, PoliMi's lists 7 English/ITA-ENG bachelors — both
match what is here. Sapienza +4: Applied Computer Science and Artificial
Intelligence, Nursing (Sant'Andrea hospital), Medicine and Surgery "F" and
Dentistry, all "Language English" in corsidilaurea.uniroma1.it. Not added:
Environmental Engineering for Sustainable Development and Oriental languages
and civilizations ("Italian, English", no English track found).

**Three Sapienza rows removed (Italian-taught).** `sapienza-econ-innov`,
`sapienza-econ-online` and `sapienza-econ-law` came from the 2026-10-25 merge,
which read the English translation of the Economics faculty call (14613) as
meaning English-taught. The call itself says only Business Administration and
Management and Economics and Finance "offer both an Italian-language
curriculum and an English-language curriculum"; Sapienza's catalogue gives the
other three (courses 34173, 34176, 34174 — the last is now "Management and
Corporate Law") as "Language Italian".

Italy, Luiss +5 (new, private): Business Administration, Economics and
Business, Global Law, Management and Artificial Intelligence, and Politics:
Philosophy and Economics. **Luiss is the one Italian university here that
publishes an IB figure**: direct admission with IB 36/45, predicted grades
accepted (apply by 24 March 2027), as an alternative to the Luiss Test (apply
by 10 February 2027). The rows carry 10 February and keep `ib_points_min`
blank, because 36 is the bar for one route, not for admission. Fee: €15,000
for the first year in 2027/28 (Luiss's admissions FAQ), €5,000 of it due by
4 May 2027 to hold the place.
Not added: Economics and Management and Political Science, partly English.

Italy, Cattolica +8 (new, private): Business and Finance (Brescia),
Communication Management, Criminology, Economics and Management, International
Business Management (Piacenza), International Relations and Global Affairs,
Psychology, and Medicine and Surgery (Rome). Cattolica publishes 2027/28 dates
— Round 1 closes **17 February 2027** — and a flat **€6,632** fee for families
with EU income under €150,000 (€11,500 otherwise; medicine €18,150), so these
rows carry a real deadline and fee. Not added: Finance, Food Production
Management and Medicine (Bolzano), which are on Cattolica's English list but
have no programme page yet.

**Italian 2027/28 calls re-checked 2026-10-26.** The admission pages of Milan
Statale, Trento, Pavia, Milano-Bicocca, Ca' Foscari, Turin, Tor Vergata and
Sapienza, and Padova's medicine page, still show only 2026/27 calls. Those rows
keep a blank deadline with last year's window in the note. Padova (bachelors),
Luiss and Cattolica have 2027/28 dates and carry them.

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

**Same-name programmes (D14).** Charles entries show the faculty in Applying, in search and on every row's sub-line (U2, 2026-11-02). Where the displayed facts still leave entries indistinguishable, stable catalogue-entry numbers and a note point readers to the official pages. Other unique-title rows keep their existing layout. The note that Czech-taught study at public universities is free for any nationality, and that each university sets its own language requirement, is no longer in the Language filter (Leon, 2026-11-05: "so it's like the rest"). It now sits in a programme's details, in the Language row, and only on Czech-taught programmes at Czech universities whose EU fee is 0 (`js/render.js`, text `r2_czech_free`; U5 checks the filter has no note).

Every card now has an **Admission** line (added 2026-10-24, Jakub's call):
how the place is decided — open entry, numerus fixus, a selective
application, CAO points, or a Czech entrance exam. Irish rows inherit
`Places offered in order of CAO points` from `admission_default` on the
universities tab; Dutch rows were classified from their own
`other_requirements` (numerus fixus / selective / open), six left `?`
where nothing on record says; Czech rows come from each faculty's own
description of its entrance procedure.

Ireland breaks down as UCD 141, UL 88, Trinity 82, DCU 70, Maynooth 59,
UCC 55, Galway 53 (counted at the 2026-11-02 merge, after the two
graduate-entry rows were dropped again).

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
CAO cutoff, with the round and year (Round 1 first). "My IB points" has an **HL
Maths 4+** tick, and the count splits the shown programmes into within your
IB points, only with HL Maths 4+, and programmes that can’t be compared. The tick
changes labels and counts, never which programmes are shown. The kind of figure (`pointsKind`) is
worked out in the browser from the university and the CAO sentence in the
note; a value-kind column written by the importers is to replace it
(plans/backlog/points-value-kind.md). Every string this added is listed in
plans/backlog/wording.md.

**English wording (S08/S09, 2026-11-02).** Filters, counts and details now use
IB points, EU fee, subject area, IB subjects and language requirement consistently.
Points help is visible on phones; shared help in the extra filters explains
that unknown figures, fees and deadlines stay visible. Irish detail fees say
"Student contribution + levy". The footer says "Always check the university's
official page before you apply. Requirements, fees and deadlines can change.
Students maintain this site." (Jakub's wording, 2026-11-04; it used to call the
site "a starting point for research, not a source of truth". Design round 2
moved the warning from the masthead into the footer, and the source line there
says only "Data comes from the universities' official pages."). Data prose, saved snapshots and CAO
marker sentences were left for after the upstream merge (done 2026-11-02, so they can be reworded now); Slovak remains disabled. See
plans/backlog/wording.md for the translation queue.

## The next obvious jobs, in order

1. ~~Merge Jakub's upstream~~ — done 2026-11-02 (see *Upstream merge* under State). Next: the Supabase question (Q17), then the Slovak translation behind the reserved EN/SK toggle (`plans/backlog/wording.md`). Run `node tools/lint-data.mjs --against ORIG_HEAD` straight after a merge to see which ids moved.
2. ~~Groningen and Wageningen IB maths~~ — done 2026-10-26 from Groningen's IB
   diploma table and Wageningen's 2027 Diploma Eligibility List, along with
   RSM (Erasmus IBA), Radboud's non-Dutch diploma page and UL's subject pages.
3. **Sign off the rows that matter.** Pick the 15–20 programmes actually being
   applied to, open each official page, and replace `AI-DRAFT` with real
   initials. Do not attempt them all.
4. ~~DCU's English requirement~~ — filled 2026-10-26. DCU's own pages give no
   IB English grade, but its entry-requirements page points EU applicants to
   the CAO's *Agreed Entry Requirements for EU/EFTA/UK* guide, which sets IB
   English A 3 HL / 4 SL, English B or Ab Initio 4 HL / 6 SL (4 at either level
   if the IB was taken through English) — the same rule UCD, UCC and Trinity
   carry. DCU's IELTS line (6.5, no component below 6.0) is added alongside.
   The guide is the 2026-entry edition and DCU says it is under review.

   UCD's fees are no longer a hole, though its page is still broken: the "EU
   Undergraduate Fees 2026/27" page says *"Fees published for the Colleges
   below…"* and publishes nothing below, and the non-EU page is empty too. It
   does not matter, because the figure this cohort pays is the contribution plus
   levy, which UCD does publish. See the Free Fees entry below.


5. **Connect the Google Sheet.** *Not planned for now (decided 2026-10-25).*
   Two tabs, published to the web as CSV, URLs
   pasted into `js/config.js`. Until then the site reads `data/*.csv` from the
   repo and nobody can maintain it without Git.
6. **Czech deadlines that are still last year's.** On 2026-10-24 ČVUT's FSv,
   FEL, FJFI, FD and FBMI, and VŠE's FFÚ, FIS, NF and FM had not published their
   2027 round. Their rows carry no deadline and their admission line says
   `(2026 rules)`. Re-run `tools/import-cvut.mjs` and `tools/import-vse.mjs`
   after their pages update (usually by November), and fill the tables there.
7. **CAO cutoffs are 2026's** (refreshed 2026-10-25 by
   `tools/update-cao-points.mjs`, which updates Irish rows in place rather
   than re-running the importers; notes rewritten 2026-10-26 to quote both
   rounds, figures unchanged). Re-run it each August when the CAO
   replaces the table. The IB→points conversion is CAO's 2026 table (45/44 →
   600 … 24 → 350, +25 for HL Maths 4+), checked against the published image;
   the 2027 table is not out yet.
8. ~~Living costs~~ — filled on 2026-10-26 for the 47 universities of the time
   (see *Living costs* under Decisions); every university added since carries
   a figure too. Re-check them each autumn with the rest.
9. **The entrance-exam unknowns** (`entrance_exam` = `?`; 19 outside Sweden at
   the 2026-11-02 merge). Jakub rechecked them on 2026-10-30 (16 others were
   settled that day: VUT FEEC, Ca' Foscari IMS, TU Wien Architecture and
   Spatial Planning, JKU and Klagenfurt IB, Regensburg, WHU, Saarland ×2, LMU
   Anglistik, Heidelberg ×4, York Music). Still open: five VŠE English
   bachelors (its admissions page points to a 2024 leaflet) and Masaryk's
   Informatika ve vzdělávání (no admission conditions published), Radboud
   Psychology (its four-part Matching Assignment may or may not include a
   test), UL Music and Dance, Maynooth MH002, UCD Veterinary Nursing, Bologna
   6653 (open access, names no entry check), LMU Kunst und Multimedia and
   Kunstpädagogik (portfolio first, later stages not described), the four
   German rows named under Germany above (KIT Architektur, KIT Sport, RWTH
   Psychology, Freiburg Psychology), and the two fork-added Irish medicine
   rows (see *Upstream merge*).
10. ~~Finland and Norway~~ — added 2026-10-27. Norway has few English-taught
   bachelors (14 here); its Norwegian maths codes (R1, S1+S2) have no IB
   equivalent on the programme pages, so two rows show maths as unknown.
11. **Swedish gaps**: open the Linnaeus and Mid Sweden pages from a normal
   browser and fill their 11 rows; replace the national living-cost floor with
   each university's own estimate.

## Known gaps

- **L09 timing, round 2 (measured 2026-11-05).** Paired run, live a6fed60 vs
  round 2 90f71e1, 2,915 rows, AC power, gated load, 4× CPU, 20 samples each:
  every forward filter change is under 150 ms on both (round 2 71–107 ms
  medians); the reverse change (all to 548 rows) is about the same on both
  and misses at 1920 px with the default Chrome (157 vs 164 ms). No
  measurable round 2 regression. Batch 3's row Compare toggle adds about
  1.6 ms to `update()` and 6–12 ms to the second frame (the builder's own
  paired run, not independently repeated). Raw data: `/tmp/l09-r2/out` (local).

- **Landscape phones lose the logo once scrolled.** At 844 x 390 the header
  stops sticking (by design, to save height), so "home" is off screen after a
  scroll. A sticky row with the IB tile would cost about 57 of 390 px; Leon
  kept it this way (2026-11-07).

- **Rolling admission and "Not passed yet".** 21 of the 22 programmes whose notes
  mention rolling or ongoing admission also have a recorded deadline, so they drop
  out of that filter once the date passes. The filter's note says so truthfully;
  the data backfill fixes the dates (Leon, 2026-11-05).

- **Czech gaps** (424 rows): 61 have no deadline — the faculties above plus
  English-taught programmes whose 2027 dates are not out (Masaryk's medicine,
  pharmacy and arts; four VŠE English bachelors). 7 English-taught rows have no
  fee (`?`). 10 have no admission line. Subjects were filled on 2026-10-26:
  every programme's admission section was searched and none sets a school
  subject, so the cards say "No particular IB subjects" (see *IB subject
  requirements* under Decisions).
- **The Czech fee note assumes a public university.** It says Czech-taught
  study at a *public* university is free, but the code only checks country,
  teaching language and a zero EU fee. That is true today: all 371 rows that get
  the note are at the five public universities (Charles, Masaryk, ČVUT, VUT,
  VŠE). Whoever adds a private Czech university must make sure the note can't
  appear on it (a free private programme would be wrongly explained).
- **Three Czech deadlines fall before Christmas**: VUT Design and Volné umění
  (30 Nov 2026, portfolio by 3 Dec) and ČVUT Architektura a urbanismus (30 Nov).
- **Three Charles FTVS rows contradict themselves**: Fyzioterapie, Trenér and
  Kondiční trenér are listed as Czech-taught but carry a fee "za studium v
  cizím jazyce". Their fee is `?` and the note says so.
- 176 of 2,915 programmes have no deadline (counted 2026-11-02): 78 Italian
  (2027/28 calls not out yet), 61 Czech, 30 Austrian (entrance-procedure
  dates not out), 3 Dutch, 2 German, 1 Finnish and 1 Norwegian. The Dutch ones
  are VU Law in Society, Leiden University College (Early Bird 1 December; its
  regular deadline isn't on the how-to-apply page) and University College
  Utrecht; Leiden Archaeology and UCR got theirs on 2026-10-27. Was 20 on the
  Dutch side — fourteen Leiden deadlines and Tilburg Psychology were recovered
  on 2026-08-21.
- 618 of 2,915 say "Not checked yet" for the language requirement, counting
  the university default each programme inherits (Czechia 344, Netherlands
  172, Italy 51, Finland 25, Germany 13, Norway 6, Denmark 4, UK 2, Austria 1).
  No Irish row is missing one: DCU's were filled on 2026-10-26 (job 4).
- 92 of 2,915 show no tuition figure, after inheritance: 79 Italian rows (public
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
- **Subject requirements and `ib_maths` are filled almost everywhere.** At
  the 2026-11-02 merge, 20 programmes have a blank `ib_subjects` (Sweden 13,
  UK 4, Ireland 2, Finland 1) and 23 an unknown `ib_maths` (Sweden 14, UK 4,
  Norway 2, Ireland 2, Finland 1). The two Irish ones are the fork-added
  medicine rows. Blank means "not checked", never "none". Two official pages
  contradict each other and the card says so:
  Groningen's Global Politics & Sustainability (its IB table asks for maths,
  its programme page says maths isn't required since 2023) and Radboud's
  Artificial Intelligence (programme PDF: AA SL/HL or AI HL; general diploma
  page: AA HL only). Neither changes what the maths filter hides much, but a
  student applying to either should ask the university.
- **Maths contradiction pass done 2026-11-03.** 438 rows with `ib_maths`
  `none` whose text (or university text) mentions maths were checked. 43 UK
  science rows changed to `?`, because HL maths there is one of several
  subjects that meet a requirement. The other 395 stay `none`; none became a
  course list. `tools/lint-data.mjs` now warns (`maths-none`) if it recurs.
- **Duplicates merged 2026-10-26** (`tools/merge-duplicates-2026-10-26.mjs`):
  `lei-polsci` into `lei-iro` (Leiden teaches Political Science in English
  only as IRO) and `tb-datascience` into `tue-ds` (TU/e runs the joint degree's
  admission). The same script corrected TU/e: every row said numerus fixus,
  but for 2027-28 only Architecture, Computer Science and Engineering,
  Mechanical Engineering and the English track of Chemical Engineering and
  Chemistry select (deadline 15 January); the other nine are open entry.
  Re-running an old Leiden, Tilburg or TU/e importer would bring the removed
  rows back — delete them again if you ever do.

## The look of it

**Sort survives reload (2026-11-09):** Picks from the Sort menu are saved,
including Deadline when points are set. Reloading a link or saved preferences
keeps that choice. Clear all forgets the sort too; entering points afterwards
selects Best match again. A Best match link without points still starts in
Deadline order and switches to Best match once points are entered.

**One Tab stop per programme (2026-11-09, backlog a):** Each programme
summary has one Tab stop. Left/Right moves between its title, Compare and Save;
Up/Down moves to the same control in the neighbouring programme, mounting it
when needed. On wide screens it also selects that programme in the details
pane; on narrow screens it leaves open details unchanged. Save, Compare,
rebuilds and breakpoint changes keep focus. Detail links retain normal Tab.

**Windowed results (2026-11-09, local `lp-window3`):** Only the viewport
and two screens on either side stay mounted. Spacers reserve the full list
length, using measured heights for visited rows and breakpoint estimates for
unseen ones. Expanded state and the wide selection survive eviction; a focused
row stays mounted. Print temporarily mounts all results and then restores the
window. Returning from print rebuilds only nearby rows before measuring
the screen again and keeps the measured heights, so your place stays put. Browser Find
searches only mounted rows; the site's Search still
searches every programme (Leon's accepted tradeoff).

WebKit clamps scrolling when a layout read sees the list with its spacers
removed. Window updates now hold the list's height until the replacement gaps
are sized. Corrections use the starting scroll position and run only when
heights above the visible anchor change; changing rows below it does not call
scrollTo. During the logo's scroll home, rows keep being measured but height
corrections pause until scrolling ends or the student interrupts it with a
touch, wheel, pointer or key: an instant correction used to cancel
the smooth scroll partway up. Filters and the chosen sort stay unchanged.

Review fixes (2026-11-09, `lp-fix-window`): a change made while Compare was
open (a filter, the language, the list in another tab) left the list blank or
back near the top when Compare closed; Close now draws the rows at the old
place. Switching language keeps the programme at the top of the list where it
was on screen (Slovak rows are taller, so the old pixel offset showed a
different one). Printing at the very end of the list no longer jumps the page
back up (by thousands of pixels on desktop): the position is read before print
and the phone tray's room is kept while it prints. Escape in the details pane
returns focus to the picked row even when it had scrolled out of the window.
Coming back from "No programmes match" measures the rows at their shown width.
Above the list only the points summary line changes height, and only together
with a filter change that replaces the list, so nothing there needs anchoring.
The old full-list slices, parked lists and near-row marking are gone.
Focused WebKit 26 and Chrome 157 probes cover large jumps, expansion above the
viewport, eviction, rebuild focus and print. Physical iPhone momentum and
VoiceOver remain untested; these are local browser checks.

**Phone Filters slide (2026-11-09, local `fu-sheet-anim`):** Keep both
slides, now 280 ms up / 220 ms down with `cubic-bezier(.32,.72,0,1)`.
The old 150/140 ms curve left too little visible travel after the first
frame; the longer tail lets the sheet settle, with a faster close. The
sheet contains layout and paint. The sheet and scrim request separate
transform/opacity layers only while moving, then release them (also on
reduced motion, widening or a cancelled tap). Closing now pauses row slices
until the transform ends, instead of resuming the long list under the slide.
The lost-event fallback is 500 ms to allow the longer slide and its first
frame. Hidden prewarming, focus, Tab/Escape and scroll locking stay intact.

Three fresh WebKit 26 contexts per case at 390 x 844 @3x: median open
first frame is 60 -> 52 ms settled, 75 -> 70 ms early (500 ms after the
first rows paint). Fully shown is 189 -> 280 ms and 126 -> 251 ms:
within the intentional 130 ms duration increase. Early-close missed-frame
median is 4 -> 1, worst frame 88 -> 38 ms. These are two-rAF paint proxies,
not iPhone measurements. Timeline shows initial style/layout/compositing
work and row work between slides, not repeated content painting in WebKit.
Three paired Chrome 157 runs at 4x CPU put the early-close missed-frame
median at 4 -> 0 and worst gap at 49 -> 19 ms. Early open first frame is
72 -> 86 ms; fully shown is 222 -> 358 ms (the 130 ms duration change plus
6 ms of measured overhead). Chrome confirms accelerated transform and
opacity layers; the scrim and scrolling-content layers retain their paint. Chrome still records shallow
outer-sheet layout/paint updates, so this is not a claim of zero per-frame
paint work in that engine.

`check.mjs` pins containment, temporary promotion, the curve, both durations,
instant reduced motion and row-pause cleanup. Smoke `--sheet-pacing-only`
bounds each slide at Chrome 4x (390 and 320 px @3x, settled and early):
no gap of 50 ms or more and at most two missed 60 Hz frames. The old
150/140 ms pins were updated deliberately; the cold-open total budget grows
by exactly 130 ms, while its first-frame budget stays unchanged. All 14
focused `--sheet-only` checks pass (behavior, cold timing and pacing).
Restoring the old CSS/JS makes three source checks and all four pacing
checks fail; the candidate files were then restored byte-for-byte. The full
smoke suite and physical iPhone Safari were not run.

**Phone Filters first open (2026-11-08, local `fu-sheet2`):** The results
list is a flex column so WebKit does not revisit every previous row on each
append. Row slices pause from finger-down through the opening slide, with a
400 ms fallback; closing, widening and reduced motion release them, and print
still flushes all rows. After the last slice and two frames, the closed phone
sheet prepares its layout while hidden and untappable, without opening or
focusing it. There is no one-second timer or dependency on Safari idle callbacks.
Opening is 150 ms; closing stays 140 ms. Setup is unchanged.

Local WebKit 26 measurements at 390 x 844 (three fresh contexts per delay)
put first-frame medians at 72/93/98 ms for taps 0.5/1/2 seconds after the
first rows paint; fully shown at 130/120/161 ms. A settled first open is
91/159 ms (first frame/fully shown), versus 138/191 ms on `42fee75`.
One early first-frame sample was 133 ms, above the roughly 120 ms target.
Chrome 4x also takes longer to finish mounting under repeated early taps:
at the 0.5-second starting delay, 3,106 -> 3,558 ms; at one second,
2,869 -> 3,483 ms, with a slower second open in that busy window.
Separate paired no-tap runs put median mounting at 3,131 -> 2,090 ms in
WebKit and 3,353 -> 3,321 ms in Chrome; first-row paint is 350 -> 343 ms
and 823 -> 823 ms respectively. These are local headless measurements,
not real-iPhone acceptance or an L09 result. The remaining timing tradeoff
needs review before calling the performance task complete. A separate settled
WebKit Setup-close probe still took 541 ms to its next painted-frame proxy
(744 ms on the baseline, one sample each); Setup remains modal.

Focused checks: `tools/smoke.mjs --sheet-only` covers first frames, focus,
scroll lock, reduced motion and sheet printing; `--sheet-list-only` covers
expanded rows, the wide pane, keyboard scroll targets, list accessibility,
Safari-model row drawing and print. The full smoke suite was not run.

**Compare and header, round 2 (2026-11-06, local `compare-header-r2`):**
Leon's second look. On phones, while Compare is open, the count row (an IB
tile and Filters over an empty gap, since the count hides in Compare) is
gone: Compare starts 12 px from the top, its Close is the way back and the
header's logo above it still goes home. From 600 px the footer sits 24 px
under an open Compare instead of 48 (the footer heading is 44 px below it,
was 68); under the list the gap is unchanged. "Close compare" has 8 px
corners at every width, like "Show the original". On phones My list is in
the count row just before Filters (the header scrolls away; that row
sticks): its bookmark and saved count, 44 px, the words kept for screen
readers. It is the same button, moved by `placeFilters` in `js/app.js`, so
the header has no copy below 600 px and Search gets the room. Rules: CSS section "Compare and
header, round 2, 2026-11-06"; checks: check.mjs section of the same name,
smoke `runCompareHeaderR2`.

**Phone My list and Compare (2026-11-06, local `fix-phone-mylist-compare`):**
Leon, on an iPhone 16 (393 x 852), found the phone My list box took half the
screen and Compare looked rough. My list's box is now Back with a "More" /
"Viac" button beside it, the title and count, and Group by (146 px, was
330). More shows Share, Export, Print and Clear in the old 2 x 2 grid plus
both footnotes; a shared or empty list has no More; from 600 px nothing
changes. In phone Compare each fact's name is a line above its values (an
aria-hidden copy; the row header stays for screen readers at zero width),
Save and the "x" share one line under the programme's name, and Close and
the arrows have the header buttons' hairline and 8 px corners. Rules: CSS
section "Phone My list and Compare, 2026-11-06"; checks: check.mjs section
of the same name, smoke `runPhoneMyListCompare`.

**Alignment review (2026-11-05, local `align-fix-chrome-setup`):** Search
keeps its short hint if canvas measurement is unavailable. On phones the
setup footer's keyboard order follows its new layout: Next, Skip, Back.
Crossing 600 px restores the desktop order and keeps a focused Next button.
Regression checks cover both cases.

**Batch 3 Compare review (2026-11-05, local `batch3-a-compare`):** Compare
has its own stored set of up to four programmes, separate from saves and URL
filters. The header opens it on tall desktop windows; phones and short windows
use the bottom tray. The old My list picker is retired. Row Compare and Save
targets are both at least 44 px, including with a mouse. Comparison column
headers are explicitly named by programme and university so their controls do
not become part of the header name. Hovering a toast during its exit cancels
that exit, just as focusing it does. These review fixes have regression checks.

**Alignment fixes, list, detail and Compare (2026-11-05, local
`align-fix-list-compare`):** a long degree wraps inside the row and pane; row
labels start with their values and the row toggles centre on the title's first
line. The detail's Save and Compare never break inside a word and stack when
they do not fit side by side (Slovak needs about 450 px, English 330). In
Compare every Save sits on one line at the foot of the header, one width for
Save and Saved; below 1024 px the "x" has its own strip so names do not break
beside it; the fact names are 6.5rem up to 1023 px; Close, Save and Browse are
44 px; the count is hidden while Compare is open. At 320 px a word wider than
its column still has to break (this Chrome hyphenates Slovak, Czech and German,
not English). Rules: CSS section "Alignment fixes · list, detail, Compare";
checks: smoke `runAlignListCompare`, check.mjs section of the same name.
The independent review also keeps Charles faculty words whole in the summary
row; regression checks cover EN/SK from 320 to 1440 px.

**Round 2 (2026-11-05):** branch `redesign-round2-only` (a PR for `main`,
without the Supabase switch-over) includes the approved white 56 px header,
two filter rows, custom budget sliders,
filter-summary pane, toast actions, footer FAQ, saved filters and five-step
onboarding. The mockup/spec live in the main checkout's excluded
`plans/design-round2/`: `proposal.md` is the spec, `mockup.html` is v4, and
`review-r2.md` records the later outline decision. Later Leon decisions win
over the mockup. The progress bar uses fourths (0/25/50/75/100%).
`ui` remains the interface-language parameter and `lang` the teaching-language
filter. Preferences use `ibuf.filters.v1`, separate from `ibuf.onboarding.v1`
and the existing saved list. Any recognised URL filter/sort parameter or
`?list=` uses URL state plus defaults, never merged with saved filters. A URL
with only `?ui=` still restores saved filters. URL hydration leaves stored
preferences alone; later explicit edits save validated filters and a
hand-picked sort (since 2026-11-09), not selection or list/compare/panel state. Clear all removes saved filters but
keeps the separate onboarding flag, so setup does not replay. Full programme
requirements remain in opened details; summary rows are compact. The phone
Sort select and all My list tools remain available. Local source checks,
contrast checks and Chrome smoke tests cover the change; this is not a
merge into `main`, hosted test or human/device acceptance.


The final Round 2 pass keeps the visible compact header and its offsets at
56 px. Only the wordmark/Filters slot cross-fades; focused controls never
move or disappear. The header sticks from 600 px wide, except at viewport
heights of 500 px or less. Column headings sit below its visible height;
the pane starts 12 px below it and its maximum height allows for the header.
Skip and arrow targets clear the header plus column headings plus 8 px;
below 600 px they clear the sticky count bar plus 8 px (A07). The build
matches the 85dvh phone sheet (now 280 ms open / 220 ms close), 180 ms help reveal, right-edge
popover origin, FAQ rotation and toast exit, and keeps closed help out of zoomed
page overflow. The phone maths control uses the mockup's native select.
Onboarding headings return to the top of each step after scrolling the real
subject vocabulary. Browser checks also exercise reduced motion, invalid
answers, blocked preference storage and the 200% layout. Smoke tests check
settled widening/narrowing of the country filter on all 2,915 rows. They do
not certify L09 performance: the original yardstick remains AC power, a quiet
machine and 4× CPU slowdown, with settled samples between country changes.
The previous 1× CPU / three-HL-toggle timing claim did not meet that yardstick.
The paired baseline versus Round 2 build measurement was deferred by Leon on
2026-11-05 because AC power was unavailable.
No new L09 numbers or performance acceptance are claimed. EN/SK review-fix
screenshots and viewport measurements are in the local review artifact folder
`scratchpad/design-round2/fix-r1/`; real catalogue rows and existing uncertainty
wording are preserved, rather than substituted with the mockup's sample data.

**Round 2 fixes, batches 1 and 2 (2026-11-05,** local branches
`redesign-batch2` and `batch2-followup`, not yet in `main`). What changed for
students, and where each rule lives:

- *Setup (batch 1).* The points stepper is centred and Skip setup lines up with
  Back and Next. The "Your answers are now filters" toast appears only when an
  answer was actually chosen. The first step links to the FAQ
  (`js/onboarding.js`).
- *Help (batch 1).* On phones the inline help opens and closes with the same
  small slide and fade as the desktop bubble, and the sheet's Budget, Subject
  area… rows open with a short height animation. Browsers that can't animate
  to an automatic height (Safari, so iPhones, as of 2026-11; not tested on a device) fade the help in and open those
  rows at once; Leon kept it that way. The desktop help bubble is now only as wide as its
  text (up to 260 px). CSS: the `@supports (interpolate-size…)` block.
- *My list on phones (batch 1)* is one even toolbar joined to the list.
- *Header (batch 2 A).* On phones and touch screens the logo tile is 44 px, as
  tall as Search (36 px with a mouse from 600 px; Leon, 2026-11-07), and stays off Search. The logo has a translated name and
  takes you back to the top without changing filters or the address. Up to
  700 px wide the "University Finder" heading is hidden visually but still read by
  screen readers. From 600 to 700 px the compact header's Filters button is
  an icon (with the filter count on its corner), because the labelled button
  did not fit beside Search; screen readers still hear "Filters". Rules: CSS
  section "Batch 2 · A", `wireCompactHeader` in `js/round2.js`.
- *Filter rows (batch 2 A).* Budget is the last control of the second row;
  controls wrap whole, with one 8 px gap. Two rows at 1024 px wide is the aim,
  more rows are fine for Slovak, long selections and zoom. The count and "Edit
  my answers" sit on one line at one size. The "Not passed yet" deadline
  option says it goes by the recorded dates (Known gaps: rolling admission).
  The Slovak living-costs placeholder is "Podľa školy", since "Podľa
  univerzity" was cut off in its 112 px field.
- *Copy link (batch 2 B).* The buttons say what they copy ("Copy link to these
  filters", "Copy share link"). The message after copying is built from the
  same state as the link and says what it includes: filters, IB points, a
  shared list; saved programmes are never in a filter link. A failed copy
  never says it worked and says what to do instead. On phones the message
  shows inside the Filters sheet. Rules: `copyLink()` in `js/app.js`.
- *Compare (batch 2 B).* Replaced by batch 3: the hint, "Compare (n)" and the
  My list picker are gone (see My list, above, and batch 3 below).
- *Details (batch 2 C).* The official page and save buttons are an even pair,
  side by side when there is room and stacked when not. On wide screens
  (1200 px and up) clicking a row that is already open moves the keyboard
  focus into its details; narrower, it closes the row as before. It never
  opens the university's site by itself.
- *Batch 3 (2026-11-05, branch `redesign-batch3`).* Compare is its own set
  (above). The detail's official page link is full width, with Save and
  Compare as a pair below it (stacked when they do not fit). On phones the
  main view no longer shows a My list box; the header's "My list (n)" is the
  way in (since 2026-11-06 it sits in the count row instead, see above). The phone My list toolbar has "Back to all programmes" top-left and
  Share, Export CSV, Print and Clear my list as an even 2 x 2 grid, Clear
  outlined. An empty My list opens with "Your list is empty", how to save and
  a way back. Setup ends with Finish and a done screen ("Your answers are now
  filters", the count, a large "Show my programmes" and an outlined "Read the
  FAQ"); Skip never shows it, and step 1 no longer links to the FAQ. The logo
  always goes home: it leaves My list, a shared list or Compare, drops
  `list=`, keeps filters, search, sort, saves and the Compare set, and scrolls
  to the top. The IB tile stays visible when scrolled (beside Filters from
  600 px, in the stuck count row on phones). On phones the logo travels
  into the count row (Leon, 2026-11-08, option C of the handover mockups,
  after the tile came in late, pushed the count right and showed beside the
  returning header logo on his iPhone): the header logo holds its spot while
  the header slides away, shrinks to 36 px (its tap area stays 44 px) and
  lands where the row's tile sits; the moment the row sticks, the tile takes
  over at the same pixel. At the top the count starts at the page margin and
  glides 50 px right in the first 16 px of scroll; its box keeps one width,
  so its lines never change. All of it runs on the scroll itself, so a late
  frame never shows two logos. Safari before 26 has no scroll timelines and
  gets option B instead, frame by frame (the logo fades out, the count
  slides, the tile fades in), never a logo moved by script. Reduced motion:
  no glide or shrink; the count stays one tile in and the tile appears when
  the row sticks. Phone Compare hides the row, so there the logo just
  scrolls away. Rules: CSS sections "Batch 3 · A/B/C" and `wireLogoHandover`
  in round2.js; checks in check.mjs (B3C2–B3C2d) and smoke `runBatch3A/B/C`.
- *Alignment audit (2026-11-05).* Five read-only Chrome audits (header, list
  and detail, Compare, My list, setup and footer; EN and SK, 320 to 1440 px
  and 844 x 390) found 2 high, 21 medium and about 38 low problems; all high
  and medium ones are fixed except the landscape logo (Known gaps). Header,
  My list and setup: Search shows its long hint only where it fits whole;
  "Edit my answers" is first in the phone Filters sheet; the setup switch
  label wraps; on phones setup's Next/Finish has its own full-width row with
  Skip and Back below; all setup buttons are 44 px; desktop Clear my list is
  an outlined button like Export; the CSV note is its own line and hides on a
  shared list; Slovak "Clear my list" is "Vymazať zoznam" so phone labels fit
  (Leon to confirm). Rules: CSS sections "Alignment fixes · header, My list,
  setup" and "· list, detail, Compare"; smoke `runAlignChromeSetup`,
  `runAlignListCompare`.
- *Logo and corners (Leon, 2026-11-06).* The logo is "Bookmark IB": a
  lilac tile with a violet bookmark in the header, the plum version as the tab
  icon and apple-touch-icon. The tile is as tall as Search (44 px on phones,
  36 px with a mouse from 600 px). Panels have 16 px corners (`--r-panel`),
  with Sort and My list inset 8 px so the corners stay concentric.
- *Review of PR 1 (2026-11-07) and its verification (2026-11-08).* Three
  read-only reviews from different models (Astra, Opus, Sol) found 28 issues;
  five fix branches fixed them, and a second Opus pass checked each fix and
  found 11 smaller ones, also fixed. Rows with no IB figure now say why: "Test
  in cutoff" / "Hranica s testom", "Entrance exam" / "Prijímacia skúška" (any
  row whose `entrance_exam` is `yes`, whatever the admission wording), "No IB
  figure" / "Bez údaja v IB", and "Not published" only when the university
  publishes nothing (Leon approved the wording, 2026-11-07). The HL Maths help
  says the CAO adds the 25 points for grade 4 or above, on Irish courses only.
  At under 360 px the column labels count toward their tile's width, so a fee
  whose Slovak label is wider than the fee moves to its own line instead of
  overlapping "Termín". Done in the list-performance round (2026-11-09): removing a
  Compare column with the keyboard moves focus to the toast's Undo, which waits
  while it holds focus (Escape closes it and focus goes back to the next
  column's "x"); the points line under the count groups thousands like the
  count and the Setup done screen ("1,512" / "1 512"; the done screen used to
  re-format those numbers and print "1,33" for 1,033); the language buttons read
  "SK (slovenčina)" to screen readers again (the hidden text lost its leading
  space whenever the page re-applied the language); the dead `.src-more` print
  rule is gone; and the smoke test runs on GitHub's pull requests (see
  "Running it").

Round 1 corrections cover subject translations in setup and the pane, draft
application and dismissal focus, cross-tab saves and Undo, compact unknowns,
value-first row cells, status actions, phone help and 44 px controls, facet
search/counts, selected rows, the pane close button, and the approved sort
cycles. Programme sorts by its title; the third click restores deadline soonest.
The phone select, URL parameters, sort arrows and announced next state agree.

**Rebuilt 2026-10-27 to 2026-11-01** (branch `redesign`, live since Jakub
merged PR #2 on 2026-11-04). Leon took it as the working direction on 2026-11-02; he has not been
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
  student something they can act on: green "Within your IB points", amber "Only
  with HL Maths 4+", orange for a deadline within 60 days. A verdict is always
  a word, a mark and a fill, never colour alone. Plain facts are plain ink.
- **Unknown is a dashed box,** never a blank and never a reason to hide a row.
- **Blue only for interaction** (links, focus, the primary button, the
  selected row, active filters). **Red only** on the sample-data banner and
  the total-failure alert. Field errors and notes use ink and weight.
- **Identity is not status.** The header uses the panel colour; row country badges
  are grey and always say the country's name in words. Flags appear only inside
  the Country filter. The logo keeps its plum identity in dark mode.
- **One typeface: IBM Plex Sans,** self-hosted in `fonts/` (400, 600, 700;
  licence in `fonts/OFL.txt`). No Google Fonts request, so no visitor IPs go to
  Google and a slow font server can't block the page (L10). Tabular figures,
  no italics.
- **Every colour is a token** in the light `:root` block or the single approved
  `:root[data-theme="dark"]` override inside its own `@media screen` wrapper in
  `css/styles.css`; never put a colour literal anywhere else.
  `node tools/check-contrast.mjs` checks all 74 text and mark pairs per theme and
  seven surface-separation floors per theme. Never lower a minimum. The global
  `--edge-soft` token is a 1 px grey border only on the off switch and unset
  slider thumb: at least 3:1 on the active panel in either theme. No grey border
  when on/set; the accent fill/ring takes over. The checker also rejects any
  other `data-theme` selector and any `prefers-color-scheme` query, because a
  rule keyed to the system setting would override a saved Light choice.
- **Light and dark, following System by default.** The gear beside the current
  EN/SK code opens Settings, with native language and System / Light / Dark
  radios. Choices apply at once and the panel stays open; Escape closes it and
  returns focus. Appearance is saved in this browser only, separately from
  filters and language. System removes the saved override and follows changes
  live. Clear all keeps it. Theme never enters a URL or shared link.
  An inline head script resolves the palette and canvas before CSS first paint.
  Print always uses the light tokens, even while the screen is dark.
- **Motion** follows round 2's approved timings (for example 250 ms popovers
  and dialog, 280 ms step slides), with transform and opacity preferred.
  None at all under `prefers-reduced-motion`. No reordering animation.
- **Print** prints the filtered rows in order, ink on white (A08).
- **Speed.** The first screen of rows is drawn at once and the rest in short
  8 ms chunks after it, so a filter change paints quickly (L09). A change also
  hides the old list at once and deletes it in the same short chunks
  afterwards, because removing 2,915 rows in one go froze the page for about
  half a second. Re-measured on the 2,915 rows on 2026-11-03 (see L09 below).

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
  refresh); the "HL Maths 4+" tick next to My IB points says it once instead.

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
  ends with a "General requirement" row when its university has one. A `?` city showed only
  the country; it now says "City not published". And a blank `verified_by`
  read as "Checked" with no name; it now counts as not checked and is listed
  under Data problems. `check.mjs` guards all four.

- **Search and the number filters misbehaved (fixed 2026-10-26, registry S01,
  S04, S05, S06, P05).** Search was one exact phrase, so "computer science
  netherlands" found nothing and "cs" matched "Physics". Now every word has to
  appear, in any order, words of three letters or fewer must start a word, and
  the subject areas are searched too. Anything typed while the list loaded was
  ignored; it now counts. My IB points and Max EU fee applied 46, −3 or 36.5 without a
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
  copy fails, the page says "Could not load the latest data" with a Reload
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
  screen). Round 2 adds a sticky 56 px header from 600 px, disabled at viewport
  heights of 500 px or less; below 600 px only the count bar sticks.
  "Skip to results", Tab and the arrow keys clear the visible sticky bands
  (see *The look of it*). `check.mjs` guards each.

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

- **The phone Filters sheet stalled before it moved (fixed 2026-11-06).** A
  tap on Filters or Done froze the page for about 580 ms (Chrome, 393 px, 4×
  CPU slowdown) before the sheet started to slide. `showModal()` makes the
  whole page inert, and in Chrome every such page-wide style change rebuilt
  all 2,915 rows. That happens only while the rows keep the `<li>` default
  `display: list-item` and `content-visibility` has never drawn them. The
  rows are now `display: block`. They look the same, because the list has
  no bullets, and Chrome's accessibility tree still lists them as list items. Tap to motion
  is now about 150 ms at 4× (about 4× faster in paired runs). Most of what
  is left is the inert update itself, spread over every mounted row. The
  slide is also shorter: 240 ms up, 200 ms down (it was 320 ms both ways),
  and reduced motion is still instant. Never give `.item` another display
  value. `check.mjs` and smoke A10 guard this.

- **Compare would not scroll down on a phone (fixed 2026-11-08).** Leon, on
  an iPhone: "couldn't scroll down" in Compare. The table's sideways scroll
  box (`.cmp-scroll`) had only `overflow-x: auto`, which makes the vertical
  axis `auto` too. The phone tap padding of the "Official page" links in the
  last row reaches 2 px below the table, so the box could also scroll 2 px
  down. On a phone the table fills nearly the whole screen, and a vertical
  swipe that started over it went to that 2 px box, not the page (headless
  Chrome with touch: the page moved 0 px). The box now has
  `overflow-y: hidden`. Never let a sideways scroller scroll vertically, and
  never give it `touch-action: pan-x`. `check.mjs` and smoke "CMP touch
  scroll" guard this.
- **Rows popped in while scrolling on an iPhone (fixed 2026-11-08).** Safari
  draws a `content-visibility: auto` row only once it is already on screen
  (WebKit's observer has no margin; Chrome's reaches half a screen further),
  and Safari before 27 has no scroll anchoring. Each row therefore scrolled in
  as an empty placeholder, then drew and shrank, and the rows under it jumped.
  The placeholders were also 40-60% too tall: 260 px for phone rows that
  average 186 px at 390 px. Now the placeholders are the measured average row
  at each width (180, 240 below 360 px, 152 from 600 px, 90 for a list of
  800 px or more). While the page scrolls, rows within 1.5 screens of the
  window get `.near`, which draws them early. In Chrome with Safari's
  behaviour imitated (4× CPU, 390 px), frames with a blank row went from 94 of
  161 to 0 and layout shift from 1.10 to 0.004. Chrome itself showed no
  change in scroll or filter-change timing. Two traps: an IntersectionObserver
  on all 2,915 rows cost about 1 s of main thread per scroll at 4×, so a
  binary search once a frame finds the rows instead. And `.near` must keep
  `contain: layout style paint`: without it, each toggle made Chrome restyle
  the rows after it (1.9 s of style work per scroll). Scrolling *up* after a
  long jump still shifts a little in Safari, because rows not yet drawn
  differ from the average. Only scroll anchoring or exact sizes would fix
  that. Not yet checked on a real iPhone. `check.mjs` and smoke ROW guard
  this.
- **Three iPhone motion problems (2026-11-08).**
  - The bar's pick-lists, Sort included, faded in but snapped shut. Their
    close relied on a `::details-content` transition, which Safari ignores.
    `holdDropdownClose` in `js/round2.js` now keeps `[open]` for a 150 ms
    fade under `.closing`. During the fade `.open` already reads false, and
    the fading panel takes no taps. The lists inside the phone sheet still
    close at once.
  - The Filters sheet now takes 180 ms to open and 140 ms to close. In
    Chrome at 4× slowdown, the time from tap to fully shown went from 460 to
    341 ms, and to fully hidden from 406 to 292 ms. **That motion-only change
    left Safari slow; the slide length was not the cause.** In WebKit (Playwright's
    WebKit 26, on a Mac with no slowdown), each `showModal()` and `close()` blocks
    for about 500 ms. The browser makes the whole page inert, so it restyles all
    116,000 elements in the 2,915 rows. Unlike Chrome, WebKit does not skip
    rows that `content-visibility` has not drawn. A non-modal `show()` takes
    about 30 ms. No CSS fix was found. Leon approved the non-modal sheet
    below, keeping the complete results list.
  - After a tap, Filters showed a focus ring. iOS never focuses a tapped
    button, so `showModal()`'s own focus of the heading counted as keyboard
    focus, and the focus return after closing inherited the ring. Both
    focus calls now pass `focusVisible`, true only when the last input was a
    key. The same rule remains with `show()` below.
  `check.mjs` and smoke PMO guard all three.

- **Non-modal phone Filters sheet (2026-11-08, local `fu-sheet`).** Leon
  approved replacing the browser's modal machinery to avoid WebKit's inert
  restyle. `show()` opens the labelled native dialog with `aria-modal="true"`;
  `app.js` traps Tab/Shift+Tab, redirects stray focus inside, gives inner
  pick-lists/help the first Escape, then closes the sheet on Escape. Done,
  Show programmes and a tap on the scrim close it too. Focus goes to the heading
  on open and Filters on close, keeping the tap/keyboard ring rule. A class
  on `html` locks background scrolling; sheet and scrim stack above the
  header, Compare tray and toasts. The scrim keeps the old colour and fade;
  the 180/140 ms slide, instant reduced motion, print hiding and widening
  cleanup remain. Setup now uses the same non-modal pattern after closing
  Filters (see below).
  - `aria-hidden` on the background was measured, not adopted: on WebKit,
    applying it to the few body-level ancestors, including the results,
    took about 440 ms, removing it about 379 ms (116,642 result descendants).
    `aria-modal`, focus management and the scrim avoid that work. A screen
    reader that ignores `aria-modal` may still browse the background. Real
    iPhone Safari and VoiceOver remain unverified; desktop engine automation
    does not establish their behavior.
  - WebKit 26 at 390 px, no CPU slowdown, five paired samples on the same
    machine: median tap-to-fully-open 733 → 234 ms; fully closed 640 → 188 ms.
    The ~250 ms target is met for repeated opens/closes. First opens remain
    variable: 305 ms at 390 px and 275 ms at 320 px in the behavior run, with
    one 540 ms first-open outlier in the paired run. This does not certify
    L09 performance or a physical iPhone. Chrome at 4× CPU on the same
    390 px page: median open 326 → 306 ms, closed 275 → 244 ms (five taps).
  - Checks: `check.mjs` guards non-modal opening, semantics, stacking, Tab
    cycling, handled Escape, focus return, scroll-lock/scrim cleanup and
    queued close/reopen. Old assertions for the browser's `::backdrop` were
    changed to the explicit scrim because non-modal dialogs have no backdrop.
    Smoke `--sheet-only` runs only NMS at 390×844 and 320×640: touch timing
    at Chrome 4× CPU, accessibility-tree modal dialog semantics, keyboard
    cycling, nested Escape, focus rings, wheel/touch scroll blocking, scrim
    hit tests, widening, reduced motion, printing and Setup handover. All
    eight focused smoke checks and the source checks pass. Restoring the
    three original product files made 11 source checks and all eight smoke
    checks fail; the edited files were then restored byte-for-byte. The full
    smoke suite was not run on this shared machine.


- **Non-modal Setup (2026-11-08, local `fu-onboard`).** Leon approved the
  same replacement for the first-visit Setup dialog: WebKit's modal inert
  update stalled its first painted frame on close and delayed a Filters tap.
  `onboarding.js` now uses `show()` with `aria-modal="true"`, an explicit
  scrim above the sheet/header/tray/toasts, Tab/Shift+Tab cycling, stray-focus
  redirection and Escape handling. Scroll locking uses `html.onboarding-open`,
  with no inert or background `aria-hidden` walk. The old `html:has(.ob[open])`
  rule is removed too; it overrode the print scroll unlock.
  - Skip/Escape still discard the draft; Finish applies once and shows the
    done screen; Escape there keeps the answers. Results/FAQ keep their
    existing focus destinations. Edit from the phone sheet returns to Filters,
    since its Edit button is hidden after handover, including during the
    sheet's closing fade. Every focus move respects tap versus keyboard rings.
    First-visit and stored-flag rules are unchanged. Setup/scrim open in 180 ms,
    close in 140 ms, stop intercepting taps as soon as closed, hide for print
    and are instant with reduced motion. The Filters implementation is unchanged.
  - The motion/print source checks now target `.ob-scrim`, since `show()` does
    not create a native `::backdrop`. New source checks cover non-modal opening,
    semantics, stacking, focus cycling/return, Escape and queued-close cleanup.
    Smoke `--setup-only` selects the new NMO checks and the existing Setup
    sections; `--onboarding-only` selects just NMO for the reverted-code check.
  - Timing: Playwright WebKit 26 (no CPU slowdown) and Chrome 157 at 4×,
    390×844, three fresh contexts per flow, Setup never pre-dismissed. The
    initial open happens during boot; the other measurements wait for all
    2,915 rows, including the new list after Finish. Paint means two animation
    frames, not transitionend. Open starts at show/showModal; close starts at
    the closing click. Filters is tapped immediately after Skip or the done
    screen's Show programmes, with no wait for Setup's fade.

    | Median milliseconds | WebKit before → after | Chrome 4× before → after |
    | --- | ---: | ---: |
    | First-visit open → paint | 97 → 88 | 49 → 44 |
    | Edit open → paint | 549 → 69 | 218 → 118 |
    | Skip → paint | 653 → 140 | 139 → 32 |
    | Done: Show programmes → paint | 656 → 72 | 127 → 22 |
    | Skip → immediate Filters paint | 656 → 140 | 351 → 166 |
    | Done: Show programmes → immediate Filters paint | 689 → 107 | 316 → 125 |

  - `check.mjs` passes. All six new Chrome NMO smoke checks pass at 390×844
    and 320×640; restoring the original three product files makes all six
    fail, including the 120 ms close-frame median bound (130/125 ms before,
    25/23 ms after). Four new source checks and the two updated motion/print
    checks fail with the originals too; final files were restored byte-for-byte.
    WebKit behavior checks at 320, 390 and 1280 px pass Tab/Shift+Tab, Escape,
    tap focus return without a ring, done-screen Escape, reduced motion and
    print, with zero page errors.
  - The complete focused Setup run has 34/38 passes: R2M's FAQ scroll fails
    at 390 and 1280 px, then the uncleared answers make the following R2B
    checks fail. A separate before/after Playwright reproduction proves the
    FAQ miss also exists with the original `bb042fa` product files: after six
    seconds it is still about 13,000 px below the viewport on phones and
    20,000 px on desktop. That unrelated bug and its existing assertions are
    preserved. An independent R2A/R2J/R2B rerun passes all six checks,
    including persistence at both widths.
    The full smoke suite was not run. Real iPhone Safari and VoiceOver remain
    unverified; a reader that ignores aria-modal may still browse the background.

## Decisions already made, so they are not relitigated

- **Dark mode** (Leon: order 2026-11-08, palette and settings 2026-11-10): after
  PR #6, before the Supabase switch-over. Palette D, grey row badges, gear and
  EN/SK button, System default and per-browser choice. Settings radios replace
  the language pill; tapping the shown language no longer flips it. Asking the
  language in setup is backlog work, not part of this change.

- **Round 2 choices** (Leon, 2026-11-05; `plans/design-round2/proposal.md`,
  “Decided” and “Later changes vs mockup v4”):
  - **Pane option (c):** reserve the pane from 1200 px; before a pick, show
    the filter summary (or guidance) and verdict legend. Never auto-select a
    programme: that would look like a recommendation.
  - **Skip discards answers.** Onboarding edits a draft; only “Show my
    programmes” applies it. Skip/Esc records dismissal without applying it.
  - **Custom sliders:** thin track, white thumb, light-blue `--accent-tint`
    when unset, accent fill/ring when set. Typed numbers remain authoritative:
    blank is no limit, zero is valid, and values beyond the slider range work.
  - **Interface language:** URL, then saved choice, then English (Jakub
    made English the default on 2026-11-04, replacing round 2's Slovak
    default). Points placeholder stays “napr. 36” / “e.g. 36”.
  - **Progress in fourths:** step 1 has no bar, then 25/50/75/100%; the label
    remains “Step n of 5”.
  - **Compact stays 56 px:** only the wordmark/Filters cross-fade changes;
    search spacing and sticky offsets keep the full header height.
  - **Heading sort cycles:** Programme A–Z → Z–A → default; IB points and EU
    fee lowest first → highest first → default. Default is deadline soonest
    first; Deadline alternates soonest → latest → soonest. The default stays
    out of the URL; other orders use `sort`/`dir`. Keep the phone Sort select,
    arrows and accessible current/next-sort wording in sync.
  - **One global soft outline** (`review-r2.md`, “Decided after round 2”):
    `--edge-soft` reaches at least 3:1 on white, only for the off switch and
    unset thumb. The grey border disappears when on/set; accent takes over.
    Never lower the contrast check's minimum.
  - **Footer data wording:** “Data comes from the universities' official
    pages.” Do not claim weekly updates: the weekly job is not built.

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
  put a course within someone's points, the card says so ("Within your IB points
  on the Round 2 cutoff, not Round 1.").

- **An "HL Maths 4+" tick next to My IB points** (Leon, 2026-10-26, registry Q5;
  settles D28). The CAO's 25 bonus points apply to any Irish CAO course, so the
  tick applies them to every Irish cutoff, and the 126 notes that said "HL
  Maths 4+ adds 25 bonus points." by course title are gone. Read per student:
  unticked, a course this student reaches only with the bonus stays visible,
  says "only with HL Maths 4+" and is not counted as within their points;
  ticked, it counts as within. The tick changes labels and counts, never which
  courses are shown. It does not touch UCD (its figure is its own minimum) or
  HPAT Medicine (the CAO does not say whether the bonus counts toward its
  480-point minimum). Unknown and test-score rows never hide.

- **The count is split while My IB points is set** (Leon, 2026-10-26, registry
  Q3/P04): "N of 1240 programmes · 47 within your IB points · 7 only with HL
  Maths 4+ · 62 can’t be compared". This covers missing figures and cutoffs
  that may include a test, interview, portfolio or audition.

- **Points wording now, a value-kind field later** (Leon, 2026-10-26, registry
  Q2/P01). The browser tells a minimum from a converted cutoff by the
  university and the CAO sentence in the note (`pointsKind` in `js/data.js`).
  A proper column, recording the meaning and the conversion separately, is in
  `plans/backlog/points-value-kind.md`.

- **Compare is built, on the saved list** (replaced on 2026-11-05 by the batch
  3 call below; kept for the history) (Leon, 2026-11-03, superseding his
  2026-10-26 "draft only, ask Jakub first", registry Q9/F05). Pick 2 to 4
  saved programmes; the table uses the detail's own wording (`js/compare.js`,
  which `js/render.js` imports for the exam line, the countdown and the yearly
  estimate). The compare view is not in the address; the shared list is.
  `plans/backlog/compare-architecture.md` is the old sketch.

- **Design round 2, batch 2 calls** (Leon, 2026-11-05). Copy link has no
  pop-up window: the button copies at once and the message says truthfully
  what the link holds, or that copying failed. Compare stays at 2 to 4
  programmes (replaced in batch 3: Compare is its own set of up to 4), made easier to find with the hint and "Compare (n)", which
  pre-ticks all saves when there are 2 to 4. Passed deadlines stay visible;
  the "Not passed yet" option carries a note instead, and rolling admission is
  fixed in the data, not the filter. A second click on an open row focuses
  its details on wide screens. The phone help keeps its height animation;
  iPhones get the fade only. The Czech fee note left the Language filter for
  the programme details. Slovak "Podľa školy" for the living-costs
  placeholder. "Edit my answers" stays permanently.

- **Design round 2, batch 3 calls** (Leon, 2026-11-05). Compare is fully
  independent of My list: its own set, at most 4, with a compare toggle on
  every programme and a Save toggle and "x" in each Compare column. Phones
  reach it through a bottom tray, wider screens through a header button. The
  main-view My list box is hidden on phones. The detail's official link is
  full width with Save and Compare below. Setup ends on a done screen with
  "Show my programmes" and "Read the FAQ". The logo always goes home.

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

- **Entrance exams, and the exam filter** (2026-10-27,
  `tools/add-entrance-exam-2026-10-27.mjs`, which quotes the page behind every
  hand-checked row). The survey asked for an exam filter. `entrance_exam` is
  `yes` / `waivable` / `no` / `?`; the picker offers "No exam" and "None or
  skippable" (Jakub's "No exam, or one I can skip", shortened 2026-11-02 so the
  select is no wider than its neighbours), and unknown rows are never hidden. Most rows follow from the
  sourced `admission` text (Czech "can be waived on set criteria" is
  `waivable`, unless the only waiver is Czech/Slovak school grades; Irish CAO
  points are `no` unless HPAT/GAMSAT, a music test or an audition is named;
  Italian tests are `yes`, Luiss's IB 36+ route `waivable`). Every Dutch
  selective and numerus fixus programme was read on its 2027-28 selection page.
  A conditional maths test (Erasmus Econometrics with AA SL, RSM IBA) is
  `waivable`. Denmark is `no`: SDU's uniTEST page says convertible grades are
  assessed in quota 1, and every Danish row has a quota 1 route.

  Checking the selection pages turned up wrong admission data, fixed in
  `tools/fix-admission-2026-10-27.mjs`: Groningen's AI, Computing Science and
  UCG are not numerus fixus (Groningen has five for 2027-28: Medicine,
  International Business 400, Psychology NL 390 and EN 225, Dentistry); the six
  Tilburg international bachelors marked "selective" are open entry with
  mandatory matching, deadline 1 May; Erasmus IBEB has 500 places, not 700; and
  a dozen Irish "audition or portfolio" labels were wrong (Galway Drama: "not
  required to audition or submit portfolios"; TCD Music and five UCD
  music/drama courses list grades only). Leiden Archaeology, LUC and UCR got
  their admission lines and the 1 May deadlines their pages give.

- **IB subject requirements, and the maths filter** (2026-10-26,
  `tools/add-ib-subjects-2026-10-26.mjs`, which carries the source of every
  row). The survey of 53 IB students put HL subject requirements among the most
  wanted filters, and 974 of 1,301 rows said "Not checked yet". Now none do. The
  script's header says how each country was read; in short:
  - *Netherlands* — each university's own IB table (UvA's diploma finder,
    Leiden's science PDF, Twente's IB page, Tilburg's maths page, VU's IB PDF,
    Radboud's per-programme PDFs). Twente, Tilburg, UvA PPLE and VU PPE rows
    that already had vaguer text were rewritten from those tables.
  - *Ireland* — the course page's Leaving Certificate subject line converted
    with the CAO's IB table in the *Agreed Entry Requirements* guide (H4/H5 =
    HL 5, O6 = SL 4 and so on), which UCC's own worked IB example applies.
    English stays in `english_requirement`. NUI universities waive Irish for
    applicants born and living outside Ireland, and the cards say so.
  - *Denmark* — Danish levels converted with Aalborg's and SDU's own IB
    tables; a level they don't cover stays in Danish terms.
  - *Italy* — no school subjects anywhere; every card states the national IB
    rule (24+ points, 12 from HL, TOK/CAS/EE passed — MUR circular 2026-27).
    Cattolica asks Maths SL 5 / HL 4 for its economics programmes and 31 points
    at the end of DP Year 1 for several schools; both are on its cards.
  - *Czechia* — no school subjects; four Charles programmes waive the
    entrance exam for set IB HL subjects, and those waivers are written out.

  `ib_maths` lists the maths courses each programme accepts (`AA HL · AA SL ·
  AI HL · AI SL`, `none`, or `?`) and drives the "My maths" picker. A programme
  whose maths is unknown is never hidden, the same rule as points and fees.
  The picker answers "can I apply with my course?", not "is my grade enough" —
  grades stay in the subjects text. The 327 rows that already had subjects got
  `ib_maths` read off their existing wording.

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

- **Living costs are a monthly range with a source** (2026-10-26). The
  columns are `living_cost_min`, `living_cost_max` and `living_cost_source`;
  the card shows one line, e.g. "€1,000–1,200 / month · university's
  estimate". Rent included, tuition excluded. Sources in order: the
  university's own figure; another university in the same city ("estimate from
  …, same city"); an official national portal ("national estimate (Study in
  NL)" / "(Study in Denmark)"). Nothing crowd-sourced. Where a university gives
  only items, the range is the sum of what it lists; where it says "+
  utilities" with no figure, the card adds "bills extra". Figures dated before
  2021 count as not published. Every number is quoted with its URL in
  `tools/add-living-costs-2026-10-26.mjs`. Worth knowing:
  - Borrowed figures: TU Delft and Aalborg/CBS/ITU (national portals —
    Delft and CBS point there themselves; ITU's own figure is from 2019),
    Galway (ATU), ČVUT (VŠE), Milan Statale and Milano-Bicocca (PoliMi;
    Bicocca's own is from 2017-18), Turin (PoliTo; UniTo's page did not load).
  - Probably low: VUT's €300–600 comes from an undated faculty page whose
    dorm price is below today's. Bologna, Padova and Trento exclude bills.
  - Milan's universities disagree widely: PoliMi €650–1,100, Bocconi €1,670,
    Cattolica €1,500–2,200. All are as published.

- **The save button and the list are back** (Leon, 2026-11-03, reversing the
  2026-10-24 removal made at Jakub's request). A star on each row, "Save to my
  list" in the detail, the My list view with groups, Compare and Share (see
  "My list" under State). Unsaving inside the list view leaves the row in place
  until the list is next drawn, so focus stays put and a slip is undone with
  one more click. Saves are per browser and per web address (State).

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
- **A lower "#" cutoff is converted only when the test is a separate step**
  (registry D27, decided 2026-11-02). The CAO's `#` says a course also has a
  test, interview, portfolio or audition, not that its marks are in the
  cutoff. Where the course's own page says the marks are added (UCC Theatre
  CK112, Galway Business International GY261, DCU Jazz DC014: `TEST_IN_CUTOFF`
  in `js/points.js`), the card shows no figure and says "Cutoff includes a
  test score". Where no page confirms it (UCC Youth Work CK114 and seven UL
  music, dance, design and architecture courses: `TEST_UNVERIFIED`), it says
  "Assessment required; IB equivalent unverified". The other `#` courses
  (TCD Drama and Nursing, UCC Music, UL Paramedic, UCD Veterinary) have a
  separate pass/fail step and keep their figure. The browser reads the code,
  so these cards are right even where the CSV still holds an older figure;
  the next `update-cao-points.mjs` run blanks those figures and writes the
  matching note. Evidence: `plans/archive/d27-test-marked-cutoffs.md`.
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
- **Jakub's data and choices win** (Leon, 2026-11-02, when merging upstream).
  Where the fork's older fix and Jakub's cell disagreed, Jakub's cell stayed;
  the fork's fix went in only where Jakub had not touched the cell. See
  *Upstream merge* under State for the counts.
- **The UK is shown** (Leon, 2026-11-02). This reverses the fork's earlier
  "UK excluded" (post-Brexit, EU students pay international fees of roughly
  £25,000–38,000, so it looked unrealistic for this cohort). Jakub researched
  the UK, it is on the site (25 universities, 883 programmes), and the fee on
  each card is honest about the cost. EU fees are still the only fees shown,
  and for the UK the "EU fee" is the international fee EU students have paid
  since August 2021 (Jakub's `fix-uk-2026-10-29` note, under State; Irish
  citizens and settled status are the exceptions, which most UK cards say). The
  country count is therefore 11, not the five the fork used to say.

## Country notes worth keeping

- **Netherlands** admits on *subjects*, not totals — only 7 of 196 Dutch rows
  have a points minimum, and that is correct, not missing data.
- **The HPAT list goes stale each cycle.** `HPAT_CODES` in
  `tools/lib/ireland.mjs` holds the CAO codes of the courses ACER lists on
  hpat-ireland.acer.org (undergraduate Medicine only, checked 2026-10-25).
  Re-check it every year before trusting an importer rerun. The same goes for
  `TEST_IN_CUTOFF` and `TEST_UNVERIFIED` in `js/points.js` (D27, checked
  2026-11-02): UL's added-points rules for 2027 may settle the UL codes.
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

## Smarter sorting (2026-11-09)

Setting My IB points in Setup or Filters selects Best match unless the student
has already chosen a sort. Best match puts programmes within their points first,
then those needing HL Maths 4+, then those that cannot be compared. Each group
uses deadline order, then the closest points figure and name. Clearing points
returns Best match to deadline order. Best match has one direction.
Without points, Best match stays visible but disabled with a hint to enter IB points first.
Total yearly cost orders the low yearly estimate and uses My living costs when
set; unknown costs stay last in either direction. Other sorts break ties by
deadline, then name. A sort the student picks is saved with their filters
(Leon, 2026-11-09), so a reload keeps it and setting points later does not
replace it with Best match; a sort the page chose for them is not saved. Clear
all removes the saved sort with the saved filters. URL sorts remain shareable
and URL state never merges with saved filters.

## Running it

```bash
node tools/serve.mjs            # then open http://localhost:8765
node tools/check.mjs            # must end "All checks passed"
node tools/smoke.mjs            # real Chrome, phone + desktop; must end "Smoke test passed"
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

`smoke.mjs` needs **Node 22 or newer** (it uses the built-in WebSocket). It
opens the real page in an invisible Chrome with a temporary profile
(never yours), clicks through it at phone and desktop widths, then deletes the
profile; without Chrome it prints SKIP and changes nothing (L08).

`.github/workflows/checks.yml` runs `check.mjs` and `check-contrast.mjs` on
GitHub for every push and pull request, with no secrets. Since 2026-11-09 a
second job, `smoke`, runs `smoke.mjs --require-chrome --keep` on **pull requests
only** (Ubuntu with its preinstalled Chrome, Node 26, 40-minute limit, public
repository so the minutes are free). On a failure it uploads the screenshots
(`/tmp/ib-*/`) and Chrome's log as the artifact `smoke-screenshots-and-chrome-log`
(7 days). If it fails with Chrome's "No usable sandbox", the step before it
(`sysctl ... apparmor_restrict_unprivileged_userns=0`) did not take, and the fix
is there, not a retry.

Its first run (PR #6, 2026-11-09) failed 22 of 684 checks. No site bug was
found behind them; the test itself is fixed on branch `lp-ci-smoke` (not yet run on GitHub
again). Two things differ on GitHub's Linux Chrome: it says the computer has no
mouse (`pointer:none`), so `smoke.mjs` now starts Chrome with a setting that
says it has one; and its scripted "scroll gesture" moved nothing, so the tests
now drag a finger with touch events (`touchSwipe` in `smoke.mjs`), the kind of
event whose taps already worked there. Why one "NMS scroll" tap missed the
scrim is not known; that check now drags more slowly and says what the scrim
saw if it fails again. The FAQ reduced-motion check also read the panel mid-fade; it now
waits. `node tools/smoke.mjs --only=runRowScroll,runFaqPanel` runs just the
named sections. On a Mac in Low Power Mode Chrome is held to 30 frames a
second, so the "sheet pacing" frame-timing checks fail there; that is the Mac,
not the site.

The second run (PR #6) failed one check, "NMO timing": the Filters tap right
after Setup's "Show my programmes" opened nothing at 390 px. Not a site bug
either. Show sits exactly where Finish was, and the test tapped it soon enough
after Finish for Chrome to count a double-tap; Show ignores the second tap of
a double-tap on purpose (so a double-tap on Finish can't close the done screen
unread), so Setup stayed open and the Filters tap landed on its scrim. The test
now waits 0.8 s after Finish and says so if a close tap is ever counted as a
double-tap. The closing Setup does not block taps: Chrome stops hitting its
fading scrim the moment it closes, and the check still fails if a tap after
close is swallowed.

A failure that is just slowness shows up as
"timed out in <step>": `smoke.mjs` has one 120 s watchdog, refreshed at the
start of each section (`WATCHDOG_MS`), so a runner much slower than a Mac could
trip it inside one long section; raise it only after seeing the real timings in
the job log, and a test that fails for no real reason teaches people to ignore
the red mark.

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

**Speed (L09, closed 2026-11-02).** The target is under 150 ms from a filter change to
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
Whether L09 passed therefore depended on how fast the laptop happened to be
running. On November 2 Leon picked the yardstick: plugged in, four times
slower CPU, a quiet machine, one confirming run. That run (November 2,
afternoon, the same scripts, every block run only when the machine was quiet,
on AC power throughout) measured the current code (d3d12ec) and passed every
case, with no pause of 50 ms or more while the rest of the rows went in:
- 1280 px: 73 ms, and 74 ms with AI off. Before: 350-356 ms.
- 1920 px: 95 ms, and 97 ms with AI off. Before: 370-378 ms.
- 390 px: 72 ms. Before: 343 ms.
- Ticking Ireland: 121-138 ms in normal Chrome and 122-140 ms with AI off.
  Before: 224-241 ms.
- A reload halfway down the list still comes back to the same place (within
  about 1%).
**Re-measured 2026-11-03 on the 2,915 rows after the upstream merge** (same
yardstick: AC power, 4× slower, quiet machine; before = the 1,240-row
version). Unticking Ireland (548 → 2,915 rows) still passes: median 139 ms at
1920 (pane open), 99 ms at 1280, 104 ms at 390; with AI off 111 and 86 ms.
Ticking Ireland (2,915 → 548) did not: 514-540 ms, because removing 2,915 old
rows at once took about 430 ms. The fix (park the old list, delete it in
chunks) brings it to 133 ms at 1280 and 151 ms at 1920 (AI off 127 and 149 ms):
1920 sits right at the limit. With AI off, 3 of 20 changes at 1280 and 6 of 20
at 1920 had one 51-100 ms pause while the rows went in (the memory clean-up
below; it was there before the fix too). An earlier battery run in Low Power
Mode made the new code look four times slower; it was the battery, not the
code. Scripts and raw numbers: `/tmp/l09-2915` (temporary).

So L09 is closed. The slower-day results below are kept as known limits: they
do not count against the yardstick, but they are where to look first if the
list ever feels slow on a weak machine.

Known limits (from the slower day):
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
