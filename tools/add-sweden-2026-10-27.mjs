// One-off: add Sweden's English-taught bachelor programmes, checked 2026-10-27.
//
//   node tools/add-sweden-2026-10-27.mjs
//
// The list. universityadmissions.se (UHR, the national admissions service) is
// the one place every Swedish university publishes its English-taught
// programmes. Its search API (POST /intl/api/sok, {"termin":"30","sokfilter":
// {"grundniva":true,"program":true}}, term 30 = "Autumn 2027") returned 111
// bachelor-level programmes, all "undervisningssprak":"English". Left out:
// Jönköping's three "Pathway" years (preparatory, not degrees), and duplicate
// entries for the second admission round. Karolinska's "First intake" and
// "Second intake" of Biomedicine are one row; Mälardalen's four Chamber Music
// instrument tracks share one page and are one row.
//
// National rules, all from universityadmissions.se:
//   Dates (/en/key-dates-and-deadlines/autumn-semester-dates/): first round
//   "16 October 2026 Application round opens", "15 January 2027 Application
//   deadline"; the first round "is specifically for international students".
//   Second round: "15 March 2027 Application round opens", "15 April
//   Application deadline"; "many courses and programmes taught in English are
//   no longer available for application" in it.
//   Selection (/en/selection-and-admissions-results/selection-process-
//   bachelors/): "Places are offered based on eligible applicants' merit
//   ratings … based on the upper secondary grades you submitted".
//   General entry (/en/entry-requirements/bachelors-requirements/): completed
//   upper secondary education plus English 6.
//   IB (/en/apply-to-bachelors/provide-application-documents-bachelors/ib-
//   studies/for-ib-diplomas-2021-and-later/): "You can meet the general entry
//   requirements … with an International Baccalaureate Diploma that lists
//   subjects taken. A Non-regular IB Diploma is also accepted." English 6 =
//   "English B, SL with language of instruction other than English"; English 7
//   = "English A, HL/SL and English B, HL". "A minimum grade of 4 is required";
//   grade 3 is accepted at HL in Biology, Chemistry and Physics, and "AI HL and
//   AA HL are equivalent to Matematik 4", "AA SL is equivalent to Matematik
//   3c", "AI SL is equivalent to Matematik 2a" at grade 3. Its table: Matematik
//   2a ← MYP maths grade 5, 3c ← AI SL, 4 ← AA SL, 5 ← AI HL, specialisering ←
//   AA HL; Fysik 2 ← Physics SL/HL; Kemi 2 ← Chemistry SL/HL; Biologi 2 ←
//   Biology SL/HL; Naturkunskap 2 ← "Environmental Systems, SL, or two of the
//   subjects Chemistry, Physics and Biology, SL/HL"; Samhällskunskap 1b ← "IB
//   Exam" (the Diploma itself); Moderna språk 3 ← "Language Ab initio".
//   English tests (/en/entry-requirements/english-language-requirements/):
//   IELTS "an overall score of 6.5 and no section below 5.5"; TOEFL iBT "Score
//   of 20 (scale 0-30) in written test, total score of 90".
//
// So, for the subject lines below: Maths 2 is met by any IB maths course; Maths
// 3b/3c by any IB maths course (AI SL with a 4, the others with a 3); Maths 4
// by AA SL with a 4 or AI HL / AA HL with a 3. Swedish requirements in Civics
// (Social studies) 1b are met by the IB Diploma itself.
//
// Living costs: the Swedish Migration Agency's maintenance requirement for
// students applying in 2026, "SEK 10,656 per month" (migrationsverket.se,
// study permit page), at the ECB reference rate of 26 October 2026 (SEK
// 11.1385 to the euro) = €957. A national floor, not a university estimate;
// university figures were not collected for Sweden yet.
//
// Each programme's requirement and selection lines are quoted next to it.
// Linnaeus University (lnu.se) and Mid Sweden University (miun.se) answer 403
// to this machine, so their rows carry only what UHR's listing gives and say
// "not checked". Halmstad's Applied AI page names no specific requirements.
//
// Re-runnable: rows are replaced by id, not appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-27';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

// ------------------------------------------------------------ universities

const SE = {
  country: 'Sweden',
  application_system: 'universityadmissions.se',
  living_cost_min: '957',
  living_cost_source: 'national estimate (Migration Agency)',
  tuition_eu_default: '0',
  baseline_requirement: 'an IB Diploma (a Non-regular IB Diploma is also accepted)',
  english_requirement_default: 'IB English B SL (if you were taught in another language), or English A or English B HL · or IELTS Academic 6.5 with no section below 5.5 · or TOEFL iBT 90 (writing 20)',
  admission_default: 'Ranked on school grades (merit rating)',
};
const UNIS = [
  ['uppsala', 'Uppsala University', 'Uppsala'],
  ['lund', 'Lund University', 'Lund'],
  ['gothenburg', 'University of Gothenburg', 'Gothenburg'],
  ['stockholm-uni', 'Stockholm University', 'Stockholm'],
  ['kth', 'KTH Royal Institute of Technology', 'Stockholm'],
  ['ki', 'Karolinska Institutet', 'Solna'],
  // hhs.se international-applicant page: "January 15, 2027 - International
  // application deadline"; the BSc page: "no tuition fees apply to citizens of
  // the EU/EEA, Switzerland, or Ukraine". Applications go through SSE's own
  // portal, linked from that page.
  ['sse', 'Stockholm School of Economics', 'Stockholm', { application_system: 'Direct (SSE application portal)' }],
  ['umea', 'Umeå University', 'Umeå'],
  ['ltu', 'Luleå University of Technology', 'Luleå'],
  ['lnu', 'Linnaeus University', 'Växjö'],
  ['malmo', 'Malmö University', 'Malmö'],
  ['mdu', 'Mälardalen University', 'Västerås'],
  ['kau', 'Karlstad University', 'Karlstad'],
  ['jonkoping', 'Jönköping University', 'Jönköping'],
  ['skovde', 'University of Skövde', 'Skövde'],
  ['hkr', 'Kristianstad University', 'Kristianstad'],
  ['dalarna', 'Dalarna University', 'Falun'],
  ['halmstad', 'Halmstad University', 'Halmstad'],
  ['gavle', 'University of Gävle', 'Gävle'],
  ['liu', 'Linköping University', 'Linköping'],
  ['bth', 'Blekinge Institute of Technology', 'Karlskrona'],
  ['miun', 'Mid Sweden University', 'Sundsvall'],
  ['slu', 'Swedish University of Agricultural Sciences', 'Uppsala'],
  ['university-west', 'University West', 'Trollhättan'],
  ['boras', 'University of Borås', 'Borås'],
].map(([university_id, name, city, extra]) => ({ ...SE, university_id, name, city, ...extra }));

// ------------------------------------------------------------- programmes

// Subject lines, converted with UHR's IB table (header).
const M2 = 'Maths: any IB maths course';
const M3 = 'Maths 3c: any IB maths course (AI SL needs a 4, the others a 3)';
const M4 = 'Maths 4: AA SL 4+, or AI HL or AA HL 3+';
const PHY = 'Physics SL 4+ or HL 3+';
const CHE = 'Chemistry SL 4+ or HL 3+';
const BIO = 'Biology SL 4+ or HL 3+';
const NAT = 'Science: two of Biology, Chemistry and Physics, or ESS SL';
const CIV = 'Social studies: met by the IB Diploma itself';
const ALL_MATHS = 'AA HL · AA SL · AI HL · AI SL';
const M4_MATHS = 'AA HL · AA SL · AI HL';
const subj = (...items) => items.join(' · ');

const SE_NOTE = 'First (international) round closes 15 January 2027. EU citizens may also apply in the second round, 15 March to 15 April, if the programme is still offered there.';
const AUDITION = 'Audition decides selection';
const TESTS = 'Admission tests decide selection';
const WORK = 'Work samples and an interview decide selection';

const P = (programme_id, university_id, programme, subject_area, fields) => ({
  programme_id, university_id, programme, subject_area, language: 'English',
  application_deadline: '2027-01-15', deadline_notes: SE_NOTE, entrance_exam: 'no', ...fields,
});
const UNCHECKED = { ib_subjects: '', ib_maths: '?', entrance_exam: '?' };

const PROGS = [
  // mdu.se RMV20: "Basic eligibility … English 6, Mathematics 4 or Mathematics
  // D"; "selected on their upper secondary grades and … Swedish Scholastic
  // Aptitude Test results".
  P('mdu-analytical-finance', 'mdu', 'Analytical Finance', 'Economics; Mathematics',
    { ib_subjects: M4, ib_maths: M4_MATHS, official_url: 'https://www.mdu.se/utbildning/program/RMV20?l=en' }),
  // hh.se: no specific requirements on the page ("Questions about entry
  // requirements, selection and admissions: admissions@hh.se").
  P('halmstad-applied-ai', 'halmstad', 'Applied Artificial Intelligence', 'Computer Science',
    { ib_subjects: '', ib_maths: '?', official_url: 'https://www.hh.se/rest-api/redirect-education-url/en/a1577d14-4868-11f1-893a-1e48d5ed4256' }),
  P('lnu-applied-mathematics', 'lnu', 'Applied Mathematics', 'Mathematics',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/NGMAR/20272/F3536' }),
  // umu.se Architecture: "General entry requirements and Mathematics 3b or 3c
  // …, Science Studies 2/level 2, Civics 1b … Science Studies can be replaced
  // by Chemistry 1/level 1 and Physics 1a"; "Arkitektprovet is a test used for
  // selection among eligible applicants. Up to a third of the seats … are
  // assigned to those who have taken part" — optional, so no exam.
  P('umea-architecture', 'umea', 'Architecture', 'Architecture',
    { degree_type: 'Integrated master', ib_subjects: subj(M3, NAT, CIV), ib_maths: ALL_MATHS,
      other_requirements: 'Five-year programme leading to a Master of Architecture · Optional architecture test (Arkitektprovet) for up to a third of the places',
      official_url: 'https://www.umu.se/en/education/programmes-and-courses/dc380cb5-4471-11f1-9bfb-c8fd9ca940c5' }),
  // kau.se TGKAI: "General entry requirements + Mathematics 3c/D".
  P('kau-ai', 'kau', 'Artificial Intelligence (Computer Science)', 'Computer Science',
    { degree_type: 'BSc', ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.kau.se/en/education/programmes-and-courses/programmes/TGKAI?occasion=80961' }),
  // ju.se KU103/KU101/KU102: "General entry requirements and Mathematics 3b or
  // 3c, Civics 1b or 1a1+1a2, English 6".
  P('jonkoping-international-economics', 'jonkoping', 'International Economics', 'Economics',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/international-economics-autumn-2027-ku103.html' }),
  P('jonkoping-international-management', 'jonkoping', 'International Management', 'Business & Management',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/international-management-autumn-2027-ku101.html' }),
  P('jonkoping-international-marketing', 'jonkoping', 'International Marketing', 'Business & Management',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/international-marketing-autumn-2027-ku102.html' }),
  // gu.se Academy of Music and Drama: "Special qualifications in the form of
  // musical knowledge and skills is assessed at the admission test. The
  // admission test is also the basis for the selection of eligible
  // applicants".
  P('gothenburg-contemporary-traditions-music', 'gothenburg', 'Contemporary Traditions in Music', 'Art & Design',
    { degree_type: 'BFA', ib_subjects: 'none', ib_maths: 'none', admission: TESTS, entrance_exam: 'yes',
      official_url: 'https://www.gu.se/en/study-gothenburg/947f1387-a208-11f1-9d7c-ef3a652c4209' }),
  P('gothenburg-opera', 'gothenburg', 'Opera', 'Art & Design',
    { degree_type: 'BFA', ib_subjects: 'none', ib_maths: 'none', admission: TESTS, entrance_exam: 'yes',
      official_url: 'https://www.gu.se/en/study-gothenburg/c665c7cb-bd6d-11f1-8941-72343ec54b14' }),
  // his.se: "Further requirements: Physics 2, Chemistry 1, Mathematics 3c or
  // Mathematics D"; "Grade 67%, Swedish Scholastic Aptitude Test 33%".
  P('skovde-industrial-informatics', 'skovde', 'Engineering – Industrial Informatics', 'Engineering; Computer Science',
    { degree_type: 'BSc', ib_subjects: subj(M3, PHY, CHE), ib_maths: ALL_MATHS, official_url: 'https://www.his.se/en/industrial-informatics-180' }),
  // mdu.se GHV03: "Basic eligibility and Physics 2, Chemistry 1, Mathematics 3c
  // or Mathematics D".
  P('mdu-environmental-engineering', 'mdu', 'Environmental Engineering within Planetary Boundaries', 'Engineering; Environmental Sciences',
    { degree_type: 'BSc', ib_subjects: subj(M3, PHY, CHE), ib_maths: ALL_MATHS, official_url: 'https://www.mdu.se/utbildning/program/GHV03?l=en' }),
  // hig.se: "Mathematics 2a or 2b or 2c · Social studies 1 b or 1a1+1a2 ·
  // English 6"; "Grade/Swedish Scholastic Aptitude Test: 60/40 %".
  P('gavle-international-social-work', 'gavle', 'Social Work – International Social Work', 'Sociology & Anthropology',
    { degree_type: 'BSc', ib_subjects: subj(M2, CIV), ib_maths: ALL_MATHS, official_url: 'https://edu.hig.se/web/en/1fe584f0-c6e2-11f1-ac2a-e1d4d46c4fe3' }),
  // hhs.se international-applicant page: "We require a university admission
  // test score from all applicants (SAT or ACT or ITB-Business)", minimums SAT
  // 1300, ACT 28, ITB-Business 112; "IB Score of 31 (out of 45) required no
  // matter which country you have studied in", 39+ usually needed; "Passed
  // English B SL"; "Passed Applications and interpretation SL"; predicted
  // grades accepted.
  P('sse-business-economics', 'sse', 'Business and Economics', 'Business & Management; Economics',
    { degree_type: 'BSc', ib_points_min: '31', ib_subjects: 'Maths: AI SL or above (passed) · English B SL or above (passed)', ib_maths: ALL_MATHS,
      admission: 'Grades plus an SAT, ACT or ITB-Business score', entrance_exam: 'yes',
      other_requirements: 'SAT 1300, ACT 28 or ITB-Business 112 minimum · IB 39+ usually needed · Predicted grades accepted',
      deadline_notes: 'International round closes 15 January 2027; late applications are not accepted. Last ACT date for this intake: 12 December 2026; ITB-Business: 14 January 2027.',
      official_url: 'https://www.hhs.se/en/Education/BSc/BE/' }),
  P('sse-retail-management', 'sse', 'Retail Management', 'Business & Management',
    { degree_type: 'BSc', ib_points_min: '31', ib_subjects: 'Maths: AI SL or above (passed) · English B SL or above (passed)', ib_maths: ALL_MATHS,
      admission: 'Grades plus an SAT, ACT or ITB-Business score', entrance_exam: 'yes',
      other_requirements: 'SAT 1300, ACT 28 or ITB-Business 112 minimum · IB 39+ usually needed · Predicted grades accepted',
      deadline_notes: 'International round closes 15 January 2027; late applications are not accepted. Last ACT date for this intake: 12 December 2026; ITB-Business: 14 January 2027.',
      official_url: 'https://www.hhs.se/en/Education/BSc/RM/' }),
  // lu.se SGUTV: "English 6/English level 2 and Social Studies 1b or 1a1+1a2".
  P('lund-development-studies', 'lund', 'Development Studies', 'Politics & International Relations; Sociology & Anthropology',
    { degree_type: 'BSc', ib_subjects: CIV, ib_maths: 'none', official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-SGUTV/80410' }),
  // umu.se Life Science: "Biology 2/level 2, Chemistry 2/level 2, Mathematics
  // 3c … or Mathematics D"; "Grade point average (66%) - Swedish Scholastic
  // Aptitude Test (34%)".
  P('umea-life-science', 'umea', 'Life Science', 'Biology & Life Sciences',
    { degree_type: 'BSc', ib_subjects: subj(M3, BIO, CHE), ib_maths: ALL_MATHS, official_url: 'https://www.umu.se/en/education/programmes-and-courses/ac9ca49b-47b7-11f1-893a-1e48d5ed4256' }),
  // ltu.se TKSDG / TKDSG: "English 6, Mathematics 2a or 2b or 2c"; TKDPG:
  // "English 6, Mathematics 3b or Mathematics 3c"; TKHMG: "English 6, Physics
  // 2, Chemistry 1, Mathematics 4 or Mathematics E"; all "The selection is
  // based on final school grades or Swedish Scholastic Aptitude Test".
  P('ltu-computer-game-design', 'ltu', 'Computer Game Design', 'Computer Science; Art & Design',
    { city: 'Skellefteå', ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.ltu.se/en/education/programme/tksdg-bachelor-programme-in-computer-game-design' }),
  P('ltu-game-development-programming', 'ltu', 'Computer Game Development and Programming', 'Computer Science',
    { city: 'Skellefteå', ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.ltu.se/en/education/programme/tkdpg-computer-game-development-and-programming' }),
  P('ltu-computer-graphics', 'ltu', 'Computer Graphics for Games and Film', 'Computer Science; Art & Design',
    { city: 'Skellefteå', ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.ltu.se/en/education/programme/tkdsg-bachelor-programme-in-computer-graphics-for-games-and-film' }),
  // hkr.se TBIT4: "Physics 2, Chemistry 1 or Natural Sciences 2, Mathematics 3c
  // or Mathematics D".
  P('hkr-intelligent-systems', 'hkr', 'Computer Science and Engineering – Intelligent Systems', 'Computer Science; Engineering',
    { ib_subjects: subj(M3, PHY, `${CHE} (or ${NAT.replace('Science: ', '')})`), ib_maths: ALL_MATHS, official_url: 'https://www.hkr.se/en/program/TBIT4' }),
  // lu.se EGESO: "English 6/English level 2, Mathematics 3b or 3c …, and Social
  // Studies 1b".
  P('lund-economy-society', 'lund', 'Economy and Society', 'Economics; History',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-EGESO/80400' }),
  // umu.se Industrial Design: "General entry requirements and approved work
  // samples and approved interview"; shortlisted applicants "will be contacted
  // for an interview at the Institute of Design in Umeå".
  P('umea-industrial-design', 'umea', 'Industrial Design', 'Art & Design; Engineering',
    { ib_subjects: 'none', ib_maths: 'none', admission: 'Work samples, then an interview for those shortlisted',
      official_url: 'https://www.umu.se/en/education/programmes-and-courses/d1e05874-4471-11f1-9bfb-c8fd9ca940c5' }),
  // lu.se EGIBU: "English 6/English level 2, Mathematics 3b or 3c … and Social
  // Studies 1b".
  P('lund-international-business', 'lund', 'International Business', 'Business & Management',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-EGIBU/80405' }),
  // su.se HLASK/PORT: "English course 6 or English level 2"; HLASK/SPAN:
  // "English course 6, Spanish course 3 … can also be met by Spanish -
  // Preparatory Course"; both "grade point average … 67 %, the Swedish national
  // university aptitude test 33 %".
  P('stockholm-uni-latin-american-portuguese', 'stockholm-uni', 'Latin American Studies (Portuguese)', 'Languages & Literature; Politics & International Relations',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://su.se/coursecatalogue/HLASK/PORT?semester=HT2027&eventcode=07160' }),
  P('stockholm-uni-latin-american-spanish', 'stockholm-uni', 'Latin American Studies (Spanish)', 'Languages & Literature; Politics & International Relations',
    { ib_subjects: 'Spanish ab initio or above', ib_maths: 'none', official_url: 'https://su.se/coursecatalogue/HLASK/SPAN?semester=HT2027&eventcode=07159' }),
  P('ltu-mineral-resource-engineering', 'ltu', 'Mineral Resource Engineering', 'Engineering',
    { ib_subjects: subj(M4, PHY, CHE), ib_maths: M4_MATHS, official_url: 'https://www.ltu.se/en/education/programme/tkhmg-bachelor-programme-in-mineral-resource-engineering' }),
  // kau.se HGMSK: "General eligibility + passing the entrance exam".
  P('kau-music', 'kau', 'Music', 'Art & Design',
    { city: 'Arvika', ib_subjects: 'none', ib_maths: 'none', admission: 'Entrance exam', entrance_exam: 'yes',
      official_url: 'https://www.kau.se/en/education/programmes-and-courses/programmes/HGMSK?occasion=80899' }),
  // ltu.se KKMUG: "+ passed audition. The audition includes … a music theory
  // exam"; Composition: "Part 1: Composition samples (scores and recordings)
  // Part 2: Music theory exam, score listening test".
  P('ltu-church-music', 'ltu', 'Music – Church Music', 'Art & Design',
    { city: 'Piteå', ib_subjects: 'none', ib_maths: 'none', admission: 'Audition with a music theory exam', entrance_exam: 'yes',
      official_url: 'https://www.ltu.se/en/education/programme/kkmug-bachelor-programme-in-music' }),
  P('ltu-classical-musician', 'ltu', 'Music – Classical Musician', 'Art & Design',
    { city: 'Piteå', ib_subjects: 'none', ib_maths: 'none', admission: 'Audition with a music theory exam', entrance_exam: 'yes',
      official_url: 'https://www.ltu.se/en/education/programme/kkmug-bachelor-programme-in-music' }),
  P('ltu-composition', 'ltu', 'Music – Composition', 'Art & Design',
    { city: 'Piteå', ib_subjects: 'none', ib_maths: 'none', admission: 'Composition samples, then a music theory exam', entrance_exam: 'yes',
      official_url: 'https://www.ltu.se/en/education/programme/kkmug-bachelor-programme-in-music' }),
  // hkr.se TBSE4: "General entry requirements and Mathematics 2a or 2b or 2c".
  P('hkr-software-development', 'hkr', 'Software Development', 'Computer Science',
    { ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.hkr.se/en/program/TBSE4' }),
  // lu.se MGBIM: "Biology 2/Biology level 2, Chemistry 2/Chemistry level 2 and
  // Mathematics 4".
  P('lund-biomedicine', 'lund', 'Biomedicine', 'Biology & Life Sciences; Medicine & Health',
    { ib_subjects: subj(M4, BIO, CHE), ib_maths: M4_MATHS, official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-MGBIM/80500' }),
  // education.ki.se: "Biology 2, Chemistry 2, Mathematics 4 or Mathematics D,
  // English 6"; "The selection is based upon the applicant's upper secondary
  // school qualifications (merit rating)".
  P('ki-biomedicine', 'ki', 'Biomedicine', 'Biology & Life Sciences; Medicine & Health',
    { ib_subjects: subj(M4, BIO, CHE), ib_maths: M4_MATHS,
      other_requirements: 'Listed as two admission alternatives (first and second intake)',
      official_url: 'https://education.ki.se/bachelors-masters-studies/programmes-and-courses/bachelors-programme-in-biomedicine' }),
  // gu.se Business and Economics: "English 6, Mathematics 3b or 3c, Social
  // studies 1b"; SweSAT "allocated to 34% of seats".
  P('gothenburg-business-economics', 'gothenburg', 'Business and Economics', 'Business & Management; Economics',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://www.gu.se/en/study-gothenburg/f0911f75-6ee3-11f1-b645-10cec8c14f9f' }),
  // mdu.se GKV05: "Admission and selection to the Chamber Music programme takes
  // place in the form of an audition."
  P('mdu-chamber-music', 'mdu', 'Chamber Music (keyboard, song, strings or wind)', 'Art & Design',
    { ib_subjects: 'none', ib_maths: 'none', admission: AUDITION, entrance_exam: 'yes',
      other_requirements: 'Four instrument tracks, each applied for separately',
      official_url: 'https://www.mdu.se/utbildning/program/GKV05?l=en' }),
  // gu.se Computer Science and AI: "English 6, Mathematics 4 or Mathematics D".
  P('gothenburg-cs-ai', 'gothenburg', 'Computer Science and AI', 'Computer Science',
    { ib_subjects: M4, ib_maths: M4_MATHS, official_url: 'https://www.gu.se/en/study-gothenburg/89cbbd49-68a1-11f1-a7a1-694995ee4bc9' }),
  // uu.se HEG1K: "basic level social studies (equivalent of level 1b or 1a2)";
  // TEO1K: "intermediate level science studies (equivalent of level 2) … basic
  // level social studies"; HSG1K, HLD1K, HSL1K: "intermediate level mathematics
  // (equivalent of level 2a or 2b or 2c)"; HSP1K: "advanced level mathematics
  // (equivalent of further level 1c)"; HFF1K, HTF1K: general entry only; TKV1K:
  // "advanced level mathematics (equivalent of further level 1b or 1c)". "Students
  // who have completed their upper secondary (high school) studies outside of
  // Sweden are selected based on their upper secondary grades."
  P('uppsala-egyptology', 'uppsala', 'Egyptology', 'History',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.uu.se/en/study/programme?query=HEG1K' }),
  P('uppsala-energy-transition', 'uppsala', 'Energy Transition – Sustainability and Leadership', 'Environmental Sciences; Engineering',
    { city: 'Visby', ib_subjects: subj(NAT, CIV), ib_maths: 'none', official_url: 'https://www.uu.se/en/study/programme?query=TEO1K' }),
  P('uppsala-game-design-graphics', 'uppsala', 'Game Design and Graphics', 'Art & Design; Computer Science',
    { city: 'Visby', ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.uu.se/en/study/programme?query=HSG1K' }),
  P('uppsala-game-design-level-design', 'uppsala', 'Game Design and Level Design', 'Art & Design; Computer Science',
    { city: 'Visby', ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.uu.se/en/study/programme?query=HLD1K' }),
  P('uppsala-game-design-programming', 'uppsala', 'Game Design and Programming', 'Computer Science',
    { city: 'Visby', ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.uu.se/en/study/programme?query=HSP1K' }),
  P('uppsala-game-design-project-management', 'uppsala', 'Game Design and Project Management', 'Art & Design; Business & Management',
    { city: 'Visby', ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://www.uu.se/en/study/programme?query=HSL1K' }),
  P('uppsala-holocaust-genocide', 'uppsala', 'Holocaust and Genocide Studies', 'History',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.uu.se/en/study/programme?query=HFF1K' }),
  // kth.se ICT entry requirements: "Mathematics 4 (advanced level of
  // mathematics)", "Physics 2 (advanced level of physics)"; "Selection is
  // based on upper secondary education grade point average (GPA)"; "KTH offers
  // no entrance exams"; predicted grades not accepted.
  P('kth-ict', 'kth', 'Information and Communication Technology', 'Computer Science; Engineering',
    { ib_subjects: subj(M4, PHY), ib_maths: M4_MATHS,
      other_requirements: 'Predicted grades not accepted: final grades needed',
      official_url: 'https://www.kth.se/en/studies/bachelor/information-communication-technology/bsc-information-and-communication-technology-1.437049' }),
  // su.se SIFPK / SFEHK: "English course 6, Mathematics course 3b or 3c, Social
  // studies course 1b"; "The grade point average … 100%"; SPOCK: "English
  // course 6, Social studies course 1b", GPA 100%; HMESK: "English course 6",
  // "grade point average … 50 %, the Swedish national university aptitude test
  // 50 %".
  P('stockholm-uni-international-business-politics', 'stockholm-uni', 'International Business and Politics', 'Business & Management; Politics & International Relations',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://su.se/coursecatalogue/SIFPK?semester=HT2027&eventcode=31064' }),
  // gu.se International Relations: "General entrance requirements … and …
  // English 6"; SweSAT "allocated to 34% of seats".
  P('gothenburg-international-relations', 'gothenburg', 'International Relations', 'Politics & International Relations',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.gu.se/en/study-gothenburg/d7794902-ac5a-11f1-965d-8bd00dc24ff7' }),
  P('uppsala-leadership-quality', 'uppsala', 'Leadership – Quality Management – Improvement', 'Business & Management; Engineering',
    { city: 'Visby', ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.uu.se/en/study/programme?query=TKV1K,CAMP' }),
  P('stockholm-uni-mena-studies', 'stockholm-uni', 'Middle Eastern and North African Studies', 'Politics & International Relations; History',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://su.se/coursecatalogue/HMESK?semester=HT2027&eventcode=28001' }),
  P('gothenburg-music-classical', 'gothenburg', 'Music – Classical Performance', 'Art & Design',
    { ib_subjects: 'none', ib_maths: 'none', admission: TESTS, entrance_exam: 'yes',
      official_url: 'https://www.gu.se/en/study-gothenburg/545de042-a214-11f1-9d7c-ef3a652c4209' }),
  P('gothenburg-music-improvisation', 'gothenburg', 'Music – Improvisation Performance', 'Art & Design',
    { ib_subjects: 'none', ib_maths: 'none', admission: TESTS, entrance_exam: 'yes',
      official_url: 'https://www.gu.se/en/study-gothenburg/b44f42cf-a207-11f1-9d7c-ef3a652c4209' }),
  P('uppsala-theoretical-philosophy', 'uppsala', 'Theoretical Philosophy', 'Philosophy',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.uu.se/en/study/programme?query=HTF1K' }),
  // liu.se MGMB2: only "General entry requirements for undergraduate studies"
  // shows; "Grades 67%, Swedish Scholastic Aptitude Test 33%". A biomedicine
  // programme with no science line is unlikely, so subjects stay unchecked.
  P('liu-experimental-industrial-biomedicine', 'liu', 'Experimental and Industrial Biomedicine', 'Biology & Life Sciences; Medicine & Health',
    { ib_subjects: '', ib_maths: '?', official_url: 'https://liu.se/en/education/program/mgmb2' }),
  P('stockholm-uni-business-ethics-sustainability', 'stockholm-uni', 'Business, Ethics and Sustainability', 'Business & Management; Philosophy',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://su.se/coursecatalogue/SFEHK?semester=HT2027&eventcode=31065' }),
  P('lnu-economics-data-analysis', 'lnu', 'Economics and Data Analysis', 'Economics; Mathematics',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/EGNAD/20272/F3678' }),
  // bth.se PAGEN: "Mathematics 3b or 3c".
  P('bth-software-engineering', 'bth', 'Software Engineering and Technology', 'Computer Science; Engineering',
    { ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.bth.se/english/PAGEN27h' }),
  // gu.se HDK-Valand Steneby: "General entrance requirements for university
  // studies and approved work sample"; "The selection is based on an
  // assessment of submitted work samples and a personal interview."
  P('gothenburg-crafting-futures', 'gothenburg', 'Craft – Crafting Futures', 'Art & Design',
    { degree_type: 'BFA', city: 'Dals Långed', ib_subjects: 'none', ib_maths: 'none', admission: WORK,
      official_url: 'https://www.gu.se/en/study-gothenburg/b4a2312e-6fc3-11f1-b645-10cec8c14f9f' }),
  P('gothenburg-metal-art', 'gothenburg', 'Metal Art', 'Art & Design',
    { degree_type: 'BFA', city: 'Dals Långed', ib_subjects: 'none', ib_maths: 'none', admission: WORK,
      official_url: 'https://www.gu.se/en/study-gothenburg/6ba91ef8-6fc2-11f1-b645-10cec8c14f9f' }),
  P('gothenburg-furniture-design', 'gothenburg', 'Wood Oriented Furniture Design', 'Art & Design',
    { degree_type: 'BFA', city: 'Dals Långed', ib_subjects: 'none', ib_maths: 'none', admission: WORK,
      official_url: 'https://www.gu.se/en/study-gothenburg/a075bb61-6fc0-11f1-b645-10cec8c14f9f' }),
  // his.se Biomedicine and Molecular Biodesign: "Mathematics 2a or 2b or 2c,
  // Science studies 2 or Biology 1 and Chemistry 1, English 6"; Molecular
  // Bioinformatics: "Mathematics 3b or Mathematics 3c or Mathematics C, Science
  // studies 2 or Biology 1 and Chemistry 1"; Cybersecurity: "English 6 or
  // English level 2"; all "Grade 67%, Swedish Scholastic Aptitude Test 33%".
  P('skovde-biomedicine', 'skovde', 'Biomedicine', 'Biology & Life Sciences; Medicine & Health',
    { ib_subjects: subj(M2, NAT), ib_maths: ALL_MATHS, official_url: 'https://www.his.se/en/biomedicine/' }),
  P('skovde-cybersecurity', 'skovde', 'Cybersecurity and Network Administration', 'Computer Science',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.his.se/en/cna' }),
  P('lnu-design-change', 'lnu', 'Design + Change', 'Art & Design',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/DGDES/20272/F3626' }),
  // kau.se SGDMA: "Civics 1b or 1a1+1a2, English 6"; SGGGJ: "English 6, Civics
  // 1b or 1a1+1a2".
  P('kau-digital-media-analysis', 'kau', 'Digital Media Analysis', 'Media & Communication',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.kau.se/en/education/programmes-and-courses/programmes/SGDMA?occasion=80947' }),
  P('miun-ecotechnology', 'miun', 'Ecotechnology', 'Environmental Sciences; Engineering',
    { ...UNCHECKED, city: 'Östersund', official_url: 'https://www.miun.se/en/education/22b82ad7-1ba3-11f1-84d1-4c27b6f345b5' }),
  // mau.se: European Studies "English 6/English Level 2 and Civics 1b"; Human
  // Rights, Interaction Design, IMER, International Relations "English 6";
  // Peace and Conflict "Civics 1b … + English 6"; all "66% Upper Secondary
  // Grades - 34% Swedish Scholastic Aptitude Test (SweSAT)".
  P('malmo-european-studies', 'malmo', 'European Studies – Politics, Societies and Cultures', 'Politics & International Relations',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.mau.se/instance/abf17d7b-b1d0-11f1-b91e-79fcc9b9441c' }),
  // slu.se: "Mathematics 2a, 2b or 2c · Natural sciences 2 · English 6".
  P('slu-forest-landscape', 'slu', 'Forest and Landscape', 'Environmental Sciences; Biology & Life Sciences',
    { degree_type: 'BSc', city: 'Alnarp', ib_subjects: subj(M2, NAT), ib_maths: ALL_MATHS, official_url: 'https://www.slu.se/en/api/education/redirect/a95a18f7-6665-11f1-a7a1-694995ee4bc9' }),
  P('kau-gender-human-rights', 'kau', 'Global Perspectives on Gender, Human Rights and Social Justice', 'Sociology & Anthropology; Politics & International Relations',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.kau.se/en/education/programmes-and-courses/programmes/SGGGJ?occasion=80813' }),
  // ju.se KU018: "Mathematics 2a or 2b or 2c, English 6"; KU019: "Mathematics
  // 3b, English 6"; KU104: "Physics 2, Chemistry 1, Mathematics 3c, English 6";
  // KU013: "specific demand on mathematics, physics, and chemistry" (levels not
  // given).
  P('jonkoping-graphic-design-web', 'jonkoping', 'Graphic Design and Web Development', 'Art & Design; Computer Science',
    { ib_subjects: M2, ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/graphic-design-and-web-development-autumn-2027-ku018.html' }),
  P('malmo-human-rights', 'malmo', 'Human Rights', 'Law; Politics & International Relations',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.mau.se/instance/d9ab6bb8-b1d0-11f1-b91e-79fcc9b9441c' }),
  P('jonkoping-supply-chain', 'jonkoping', 'Industrial Engineering and Management: Sustainable Supply Chain Management', 'Engineering; Business & Management',
    { ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/industrial-engineering-and-management-sustainable-supply-chain-management-autumn-2027-ku019.html' }),
  P('malmo-interaction-design', 'malmo', 'Interaction Design', 'Art & Design; Computer Science',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.mau.se/instance/91f4ae88-6edf-11f1-b645-10cec8c14f9f' }),
  // hv.se International Affairs: "general entry requirements … with minimum
  // specific entry requirements for social studies".
  P('university-west-international-affairs', 'university-west', 'International Affairs', 'Politics & International Relations',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.hv.se/en/education/degree-programmes/international-affairs/' }),
  P('stockholm-uni-political-science-regional', 'stockholm-uni', 'Political Science and Regional Studies', 'Politics & International Relations',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://su.se/coursecatalogue/SPOCK?semester=HT2027&eventcode=42000' }),
  // umu.se: "English 6/level 2, Mathematics 3b or 3c …, Civics 1b"; "Grade point
  // average (60%) - Swedish Scholastic Aptitude Test (40%)".
  P('umea-international-business-economics', 'umea', 'International Business and Economics', 'Business & Management; Economics',
    { ib_subjects: subj(M3, CIV), ib_maths: ALL_MATHS, official_url: 'https://www.umu.se/en/education/programmes-and-courses/d9040b2a-4471-11f1-9bfb-c8fd9ca940c5' }),
  // mdu.se SEV25: "Basic eligibility and English 6, Mathematics 3b or 3c or
  // Mathematics C".
  P('mdu-international-business-management', 'mdu', 'International Business Management', 'Business & Management',
    { ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.mdu.se/utbildning/program/SEV25?l=en' }),
  P('lnu-international-business', 'lnu', 'International Business', 'Business & Management',
    { ...UNCHECKED, city: 'Kalmar', official_url: 'https://lnu.se/en/programme/EGINB/20272/F3654' }),
  P('lnu-international-cooperation', 'lnu', 'International Co-operation and Global Challenges', 'Politics & International Relations',
    { ...UNCHECKED, city: 'Kalmar', official_url: 'https://lnu.se/en/programme/SGINT/20272/F3513' }),
  P('malmo-imer', 'malmo', 'International Migration and Ethnic Relations', 'Sociology & Anthropology; Politics & International Relations',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.mau.se/instance/c140cf9f-b1d0-11f1-b91e-79fcc9b9441c' }),
  P('malmo-international-relations', 'malmo', 'International Relations', 'Politics & International Relations',
    { ib_subjects: 'none', ib_maths: 'none', official_url: 'https://www.mau.se/instance/cd920a0b-b1d0-11f1-b91e-79fcc9b9441c' }),
  // du.se STMGG: "Mathematics 2a or 2b or 2c, English 6, Social Sciences 1b";
  // "Final school grades (66 %) and Högskoleprovet (34 %)".
  P('dalarna-international-tourism', 'dalarna', 'International Tourism Management', 'Business & Management',
    { city: 'Borlänge', ib_subjects: subj(M2, CIV), ib_maths: ALL_MATHS, official_url: 'http://www.du.se/redirect/programme.aspx?language=en&code=STMGG' }),
  P('lnu-tourism-hospitality-events', 'lnu', 'International Tourism, Hospitality and Event Management', 'Business & Management',
    { ...UNCHECKED, city: 'Kalmar', official_url: 'https://lnu.se/en/programme/EGTHE/20272/F3652' }),
  P('jonkoping-mechanical-engineering', 'jonkoping', 'Mechanical Engineering', 'Engineering',
    { degree_type: 'BSc', ib_subjects: subj(M3, PHY, CHE), ib_maths: ALL_MATHS, official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/mechanical-engineering-bsc-autumn-2027-ku104.html' }),
  P('lnu-media-entrepreneurship', 'lnu', 'Media and Entrepreneurship', 'Media & Communication; Business & Management',
    { ...UNCHECKED, city: 'Kalmar', official_url: 'https://lnu.se/en/programme/MGMEP/20272/F3519' }),
  P('skovde-molecular-biodesign', 'skovde', 'Molecular Biodesign', 'Biology & Life Sciences',
    { ib_subjects: subj(M2, NAT), ib_maths: ALL_MATHS, official_url: 'https://www.his.se/en/molecular-biodesign' }),
  P('skovde-molecular-bioinformatics', 'skovde', 'Molecular Bioinformatics', 'Biology & Life Sciences; Computer Science',
    { ib_subjects: subj(M3, NAT), ib_maths: ALL_MATHS, official_url: 'https://www.his.se/Molecular-Bioinformatics/' }),
  P('lnu-network-security', 'lnu', 'Network Security', 'Computer Science',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/NGDNS/20272/F3537' }),
  P('malmo-peace-conflict', 'malmo', 'Peace and Conflict Studies', 'Politics & International Relations',
    { ib_subjects: CIV, ib_maths: 'none', official_url: 'https://www.mau.se/instance/b61158db-b1d0-11f1-b91e-79fcc9b9441c' }),
  P('jonkoping-prosthetics-orthotics', 'jonkoping', 'Prosthetics and Orthotics', 'Medicine & Health; Engineering',
    { degree_type: 'BSc', ib_subjects: 'Maths, Physics and Chemistry (the page gives no levels)', ib_maths: '?',
      official_url: 'https://ju.se/en/study-at-ju/our-programmes/bachelor-programmes/prosthetics-and-orthotics-bsc-autumn-2027-ku013.html' }),
  // lu.se NGNAT-ENMA: "Mathematics 4"; NGNAT-INES: "Biology 1, Physics 1a …,
  // Chemistry 1 and Mathematics 4 …, OR Mathematics 4 … together with two of
  // the courses Biology 2, Physics 2 and Chemistry 2"; NGNAT-ENFY: "Physics 2,
  // Chemistry 1 and Mathematics 4".
  P('lund-mathematics', 'lund', 'Mathematics', 'Mathematics',
    { degree_type: 'BSc', ib_subjects: M4, ib_maths: M4_MATHS, official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-NGNAT-ENMA/80225' }),
  P('lund-physical-geography', 'lund', 'Physical Geography and Ecosystem Science', 'Environmental Sciences',
    { degree_type: 'BSc', ib_subjects: subj(M4, 'Biology, Chemistry and Physics, or two of them (SL 4+ or HL 3+)'), ib_maths: M4_MATHS,
      official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-NGNAT-INES/80205' }),
  P('lund-physics', 'lund', 'Physics', 'Physics',
    { degree_type: 'BSc', ib_subjects: subj(M4, PHY, CHE), ib_maths: M4_MATHS, official_url: 'http://www.lunduniversity.lu.se/lubas/i-uoh-lu-NGNAT-ENFY/80200' }),
  // gu.se Software Engineering and Management: "English 6, Mathematics 3b or
  // 3c".
  P('gothenburg-software-engineering-management', 'gothenburg', 'Software Engineering and Management', 'Computer Science; Business & Management',
    { ib_subjects: M3, ib_maths: ALL_MATHS, official_url: 'https://www.gu.se/en/study-gothenburg/ec06e8cf-964d-11f1-8158-f751c37a40ac' }),
  P('lnu-software-technology', 'lnu', 'Software Technology', 'Computer Science',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/NGDPV/20272/F3538' }),
  // hb.se 7207A: "Civics 1b …, Mathematics 2a or … 2c and English 6"; "Grade
  // 67%, Swedish Scholastic Aptitude Test 33%".
  P('boras-textile-production', 'boras', 'Textile Production and Innovation', 'Engineering; Art & Design',
    { ib_subjects: subj(M2, CIV), ib_maths: ALL_MATHS, official_url: 'https://www.hb.se/redirect/antagning/20272/7207A/en' }),
  P('lnu-visual-communication', 'lnu', 'Visual Communication + Change', 'Art & Design; Media & Communication',
    { ...UNCHECKED, official_url: 'https://lnu.se/en/programme/DGVIC/20272/F3624' }),
];

// -------------------------------------------------------------------- write

const unis = read(new URL('universities.csv', DATA));
const uniRows = UNIS.map((u) => Object.fromEntries(unis.head.map((h) => [h, u[h] ?? ''])))
  .map((u) => ({ ...u, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const uniIds = new Set(uniRows.map((u) => u.university_id));
const keptUnis = unis.rows.filter((u) => !uniIds.has(u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...keptUnis, ...uniRows]);

const progs = read(new URL('programmes.csv', DATA));
for (const p of PROGS) {
  for (const k of Object.keys(p)) if (!progs.head.includes(k)) throw new Error(`${p.programme_id}: unknown column ${k}`);
  if (!uniIds.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university ${p.university_id}`);
}
const progRows = PROGS.map((p) => Object.fromEntries(progs.head.map((h) => [h, p[h] ?? ''])))
  .map((p) => ({ ...p, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const ids = new Set(progRows.map((p) => p.programme_id));
if (ids.size !== progRows.length) throw new Error('duplicate programme_id in this script');
const keptProgs = progs.rows.filter((p) => !ids.has(p.programme_id));
if (keptProgs.length + progRows.length !== new Set([...keptProgs, ...progRows].map((p) => p.programme_id)).size) throw new Error('programme_id clash');
save(new URL('programmes.csv', DATA), progs.head, [...keptProgs, ...progRows]);
console.log(`Sweden: ${uniRows.length} universities, ${progRows.length} programmes`);
