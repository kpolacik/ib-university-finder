# Where this project is

Written so anyone — including a fresh session with no memory of the work — can
pick it up without re-deriving decisions. Update it when the state changes.

**Live:** https://kpolacik.github.io/ib-university-finder/
**Repo:** https://github.com/kpolacik/ib-university-finder

## State

2643 programmes · 156 universities · 11 countries · all checks passing.

| Country | Universities | Programmes | Notes |
|---|---|---|---|
| Netherlands | 13 | 197 | **Complete** — every Dutch research university |
| Ireland | 7 | 548 | **Complete** — every Irish university |
| Czechia | 5 | 424 | **The big five**, added 2026-10-24 — Czech- and English-taught |
| Italy | 15 | 99 | English-taught only — Bologna, Sapienza, Bocconi, PoliMi, PoliTo, Padova, Milan Statale, Trento, Pavia, Milano-Bicocca, Ca' Foscari, Turin, Tor Vergata, Luiss, Cattolica |
| Denmark | 7 | 31 | English-taught only — CBS, Aarhus, SDU, Aalborg, DTU, ITU, Roskilde |
| Sweden | 25 | 95 | English-taught only — every bachelor universityadmissions.se lists for autumn 2027, added 2026-10-27 |
| United Kingdom | 25 | 883 | Russell Group and other leading universities: 19 researched by Jakub (CAS/verification/uk, on his machine), merged 2026-10-29; Liverpool, Newcastle, Nottingham, QMUL, York and Queen's Belfast added 2026-10-29. Cardiff missing (blocks this machine) |
| Austria | 7 | 92 | English-taught bachelors at public universities and CEU, plus every German-taught bachelor at Vienna, TU Wien and WU, added 2026-10-29 |
| Germany | 35 | 201 | English-taught university bachelors from the DAAD database (61), plus German-taught bachelors at TUM, LMU Munich and Heidelberg (140), added 2026-10-29 |
| Norway | 5 | 14 | English-taught bachelors at universities on Study in Norway's list, added 2026-10-27 |
| Finland | 12 | 59 | English-taught university bachelors on Studyinfo.fi for autumn 2027 (most are bachelor + master), added 2026-10-27 |

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
Irish citizens and settled status excepted, as each card says); pounds were
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
provenance line only once someone signs it off — set `verified_by` to real
initials and it reads "Checked <date> by <initials>".

## The next obvious jobs, in order

1. ~~Groningen and Wageningen IB maths~~ — done 2026-10-26 from Groningen's IB
   diploma table and Wageningen's 2027 Diploma Eligibility List, along with
   RSM (Erasmus IBA), Radboud's non-Dutch diploma page and UL's subject pages.
2. **Sign off the rows that matter.** Pick the 15–20 programmes actually being
   applied to, open each official page, and replace `AI-DRAFT` with real
   initials. Do not attempt all 757.
3. ~~DCU's English requirement~~ — filled 2026-10-26. DCU's own pages give no
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


4. **Connect the Google Sheet.** Two tabs, published to the web as CSV, URLs
   pasted into `js/config.js`. Until then the site reads `data/*.csv` from the
   repo and nobody can maintain it without Git.
5. **Czech deadlines that are still last year's.** On 2026-10-24 ČVUT's FSv,
   FEL, FJFI, FD and FBMI, and VŠE's FFÚ, FIS, NF and FM had not published their
   2027 round. Their rows carry no deadline and their admission line says
   `(2026 rules)`. Re-run `tools/import-cvut.mjs` and `tools/import-vse.mjs`
   after their pages update (usually by November), and fill the tables there.
6. **CAO cutoffs are 2026's** (refreshed 2026-10-25 by
   `tools/update-cao-points.mjs`, which updates Irish rows in place rather
   than re-running the importers). Re-run it each August when the CAO
   replaces the table. The IB→points conversion is CAO's 2026 table (45/44 →
   600 … 24 → 350, +25 for HL Maths 4+), checked against the published image;
   the 2027 table is not out yet.
7. ~~Living costs~~ — filled for all 47 universities on 2026-10-26 (see
   *Living costs* under Decisions). Re-check them each autumn with the rest.
8. **The 13 entrance-exam unknowns** outside Sweden (`entrance_exam` = `?`),
   rechecked 2026-10-30 (16 others were settled that day: VUT FEEC, Ca'
   Foscari IMS, TU Wien Architecture and Spatial Planning, JKU and Klagenfurt
   IB, Regensburg, WHU, Saarland ×2, LMU Anglistik, Heidelberg ×4, York
   Music): five VŠE English bachelors (its admissions page points to a 2024
   leaflet) and Masaryk's Informatika ve vzdělávání (no admission conditions
   published), Radboud Psychology (its four-part Matching Assignment may or
   may not include a test), UL Music and Dance, Maynooth MH002, UCD Veterinary
   Nursing, Bologna 6653 (open access, names no entry check), LMU Kunst und
   Multimedia and Kunstpädagogik (portfolio first, later stages not described).
9. ~~Finland and Norway~~ — added 2026-10-27. Norway has few English-taught
   bachelors (14 here); its Norwegian maths codes (R1, S1+S2) have no IB
   equivalent on the programme pages, so two rows show maths as unknown.
10. **Swedish gaps**: open the Linnaeus and Mid Sweden pages from a normal
   browser and fill their 11 rows; replace the national living-cost floor with
   each university's own estimate.

## Known gaps

- **Czech gaps** (424 rows): 65 have no deadline — the faculties above plus
  English-taught programmes whose 2027 dates are not out (Masaryk's medicine,
  pharmacy and arts; four VŠE English bachelors). 7 English-taught rows have no
  fee (`?`). 10 have no admission line. Subjects were filled on 2026-10-26:
  every programme's admission section was searched and none sets a school
  subject, so the cards say "No particular IB subjects" (see *IB subject
  requirements* under Decisions).
- **Three Czech deadlines fall before Christmas**: VUT Design and Volné umění
  (30 Nov 2026, portfolio by 3 Dec) and ČVUT Architektura a urbanismus (30 Nov).
- **Three Charles FTVS rows contradict themselves**: Fyzioterapie, Trenér and
  Kondiční trenér are listed as Czech-taught but carry a fee "za studium v
  cizím jazyce". Their fee is `?` and the note says so.
- 3 programmes have no deadline: VU Law in Society, Leiden University College
  (Early Bird 1 December; its regular deadline isn't on the how-to-apply page)
  and University College Utrecht. Leiden Archaeology and UCR got theirs on
  2026-10-27. Was 20 — fourteen Leiden
  deadlines and Tilburg Psychology were recovered on 2026-08-21.
- 249 of 757 show no English requirement, counting the university default each
  programme inherits. Almost all are Dutch. DCU's 70 were filled on
  2026-10-26 (job 2), so no Irish row is missing one now.
- 3 of 757 show no tuition figure, after inheritance: Galway Pharmacy, whose
  page carries no fee table, and two Dutch rows. Was 147 — the Irish fees were
  re-based on the Free Fees Initiative on 2026-08-21, which both corrected them
  and filled UCD's 140.
  Galway no longer has a university default at all — its fees are per course,
  because only 1 of its 54 courses charged the figure that used to be the
  default. See the GLM re-check section.
- 19 of 757 have no deadline.
- `student_life_url` is empty everywhere. Never invent these.
- Subject areas are keyword-mapped from course titles across all seven Irish
  universities, and a few are rough.
- **`baseline_requirement` is blank for all six new Irish universities.** UCD
  does state one — "24 or more total points and the award of the IB Diploma" —
  but only on a page headed "for international (non-EU/non-EEA) students only",
  and a Slovak applicant goes through the CAO as an EU applicant. Left blank
  rather than borrowed from the wrong audience. The per-course `ib_points_min`
  carries the number that actually matters anyway.
- **Every programme now has subject requirements and `ib_maths`** (no `?`
  left). Two official pages contradict each other and the card says so:
  Groningen's Global Politics & Sustainability (its IB table asks for maths,
  its programme page says maths isn't required since 2023) and Radboud's
  Artificial Intelligence (programme PDF: AA SL/HL or AI HL; general diploma
  page: AA HL only). Neither changes what the maths filter hides much, but a
  student applying to either should ask the university.
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

Redesigned 2026-08-16, then redirected 2026-10-24 from reference images Jakub
supplied (a product-design portfolio: serif display type, white page, content in
large tinted rounded panels, rose brand accent, blue links, arrow motif).

**The direction, so a later edit does not quietly undo it:**

- **Two faces.** `Playfair Display` for display — the masthead, every card title,
  the points number — and `DM Sans` for everything else. Serif is for display
  only; it never carries UI text, labels or dense data. Both load from Google
  Fonts with full system stacks behind them, so a blocked font costs character
  and nothing else.
- **White page, tinted panels.** Content sits in large soft-cornered panels
  (`--r-xl`, 26px) with **no borders and almost no shadow** — separation comes
  from tint and space, as in the reference. This inverts the old design, where
  white cards with grey hairlines sat on a grey page.
- **The panel tint carries information.** The reference gives each project card
  its own pastel; with 757 cards arbitrary pastels would be noise, so the tint is
  the **country**: Netherlands periwinkle (`--tint-nl`), Ireland mint
  (`--tint-ie`). Each card's title and points number take the darker ink of its
  own tint. The class comes from `row.country` in `js/render.js`, so a new
  country needs a tint pair in `css/styles.css` and nothing else — Czechia would
  just get a third.
- **The requirements block inverted** to a white inset (`--inset`) inside the
  tinted panel, the reverse of the old tinted block on a white card.
- **Rose brands, blue links.** `--accent` (rose) appears only *outside* cards —
  the masthead's full stop, a checked filter, the active-filter count — because
  inside a card the country tint already does the colour work. `--link` (blue) is
  for interactive text. Amber and red stay semantic and never decorate.
- **Motion** is transform and opacity only, first ten cards only, and stops
  entirely under `prefers-reduced-motion`.
- **Light only, no dark palette** (dropped 2026-10-24). `color-scheme: light` is
  declared in `:root`, and it has to be: without it a browser on a dark OS
  renders form controls, scrollbars and the canvas dark underneath a light page.
  `tools/check-contrast.mjs` throws if a `prefers-color-scheme: dark` block
  reappears, so nobody can add one back and leave its pairs unchecked.
- **Desktop is the design target**, but the responsive CSS stays. It is written,
  verified at 375/768/1280 and costs nothing to keep, and the ~30 classmates
  browsing will not all be at a desk. "Desktop only" means no further mobile
  polish, not ripping out working breakpoints.
- **Contrast is measured, not eyeballed.** `node tools/check-contrast.mjs` —
  29 pairs, every foreground against the background it is genuinely painted on.

**What was deliberately not taken from the reference.** It is a portfolio with
six elements on a screen and enormous type. This is a data tool where one card
carries a points total, subject requirements, a fee, a deadline, provenance and
two links. The character transferred; the density did not. Serif stays out of the
body text, padding is tighter than the reference, and the per-card pastel became
a per-country system.

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

## Decisions already made, so they are not relitigated

- **Entrance exams, and the exam filter** (2026-10-27,
  `tools/add-entrance-exam-2026-10-27.mjs`, which quotes the page behind every
  hand-checked row). The survey asked for an exam filter. `entrance_exam` is
  `yes` / `waivable` / `no` / `?`; the picker offers "No exam" and "No exam, or
  one I can skip", and unknown rows are never hidden. Most rows follow from the
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
  The Free Fees explanation that sat on all 555 Irish cards is gone — the reason
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
- **Irish points are last year's demand-driven cutoffs**, not minimums, and the
  cards say so. Conversions never assume the HL Maths bonus. The one exception
  is UCD, which publishes an IB total it will accept, so UCD's numbers are real
  minimums and its cutoff sits in the note instead.
- **Cutoffs come from the CAO, not from the universities' own pages.** Only the
  CAO says what a cutoff *meant*: `AQA` (everyone qualified got in, so there was
  no cutoff at all), `#` (a test, interview, portfolio or audition also
  applied), `*` (not everyone on that score got a place — ties went to random
  selection). A bare number without those markers misleads. The CAO also
  publishes Round 2, which is lower than the Round 1 figure universities tend to
  advertise: UL's own page says 499 for Psychology, the CAO's Round 2 says 496.
- **Where several programmes share one CAO code, every row says so.** UL's
  LM116 is "Engineering (Common Entry)" and covers Civil, Biomedical and the
  rest; UL's LM002 Arts covers every Arts subject; UCD's DN250 covers three
  agriculture degrees. You apply to the code, not the programme, so the cutoff
  belongs to the code. 180 rows carry that sentence.
- The **UK is excluded**: post-Brexit, EU students pay international fees of
  roughly £25,000–38,000, so it is not a realistic option for this cohort.

## Country notes worth keeping

- **Netherlands** admits on *subjects*, not totals — only 1 of 202 Dutch rows
  has a points minimum, and that is correct, not missing data.
- **Ireland** publishes a CAO cutoff per course and an official IB conversion,
  which is why 542 of the 555 Irish rows have a number. It also issues **no
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
node tools/check.mjs            # 45 checks, must end "All checks passed"
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
sensible headers.

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

The UCD fee gap is real anyway, but for the other reason in job 2: the page
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

- **UCD's fees**, 140 rows, for the reason in job 2 — the page publishes nothing.
- **VU Law in Society's deadline.** The programme is selective and its admissions
  page carries no date at all.
- **Leiden Archaeology and Leiden University College deadlines**, above.
- **UL's fee oddities** — history €17,492 and music-and-dance €17,495 against
  €17,500 on their siblings, and Japanese blank. These are what the pages say;
  they look like UL's own rounding rather than a scraping fault.
- **TCD and UCC English A grades**, and the **non-EU tuition defaults** for
  Groningen, UvA, VU, Twente and Tilburg. Nothing reads the non-EU columns.
