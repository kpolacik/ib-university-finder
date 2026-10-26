// One-off: the English-taught bachelors still missing for Denmark and Italy,
// each checked on the university's own page on 2026-10-26.
//
//   node tools/add-programmes-2026-10-26.mjs
//
// Re-runnable: rows and universities listed here replace any earlier copy with
// the same id, and nothing else in the CSVs is touched. Each entry quotes the
// page it came from. What was looked for and NOT added is in STATUS.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-26';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const UNIS = [];
const PROGS = [];

// ------------------------------------------------------------------ Denmark
//
// National rules, verified 2026-10-25 (see merge-italy-denmark.mjs): IB
// applicants apply on Optagelse.dk by 15 March 12:00; 5 July is only the
// documentation deadline; an IB Diploma needs at least 24 points; EU/EEA
// students pay no tuition.

const DK_DEADLINE = '2027-03-15';

UNIS.push(
  {
    // itu.dk/Uddannelser/Bacheloruddannelser/Saadan-soeger-du-ind-BSc: "Til
    // 2026-optagelsen kræves til alle ITUs bacheloruddannelser et samlet
    // karaktergennemsnit på mindst 2,0 i den adgangsgivende eksamen."
    // en.itu.dk refused or reset every connection from this machine; the
    // Danish site www.itu.dk answered after retries.
    university_id: 'itu', name: 'IT University of Copenhagen', city: 'Copenhagen', country: 'Denmark',
    application_system: 'Optagelse.dk (Danish national portal)', tuition_eu_default: '0',
    baseline_requirement: 'an IB Diploma with at least 24 points and an overall grade average of at least 2.0 on the Danish scale',
    admission_default: 'Quota 1 (grade average) or Quota 2 (assessed application)',
  },
  {
    // ruc.dk/en/general-admission-requirement-entry-qualification lists the
    // "International Baccalaureate (IB)" among international entry qualifications.
    // ruc.dk/en/tuition-fees-bachelor-terms-payment: "All EU/EEA-citizens are
    // exempt from paying tuition fees at Danish universities."
    university_id: 'ruc', name: 'Roskilde University', city: 'Roskilde', country: 'Denmark',
    application_system: 'Optagelse.dk (Danish national portal)', tuition_eu_default: '0',
    baseline_requirement: 'an IB Diploma with at least 24 points',
    admission_default: 'Quota 1 (grade average) or Quota 2 (assessed application)',
  },
);

PROGS.push(
  {
    // bachelor.au.dk/en/datascience: "Language: English | Place of study:
    // Aarhus"; "Quota 1 2026: 11,2 (Standby: 10,1)"; requirements "English B,
    // Mathematics A"; "minimum GPA of 6.0 and a minimum GPA of 6.0 in
    // Mathematics A … to be assessed in quota 1"; "limited spots and is
    // intended for international students".
    programme_id: 'au-ds', university_id: 'aarhus', programme: 'Data Science', degree_type: 'BSc',
    subject_area: 'Computer Science; Mathematics', language: 'English', ib_points_min: '24',
    ib_subjects: 'Danish-level equivalents: English B and Mathematics A. Quota 1 also needs a grade average of at least 6.0 overall and 6.0 in Mathematics A (Danish 7-point scale)',
    other_requirements: 'Quota 1/Quota 2 selection · 2026 Quota 1 cut-off 11.2 (standby 10.1) on the Danish 7-point scale · Limited places, meant for international students',
    tuition_eu: '0', application_deadline: DK_DEADLINE,
    deadline_notes: 'Apply via Optagelse.dk by 15 March at 12:00 noon (AU\'s stated deadline for IB applicants; system opens 1 February). Document all requirements by 5 July at 12:00; paying (non-EU) applicants by 15 March at 12:00, including the 150 EUR application fee.',
    official_url: 'https://bachelor.au.dk/en/datascience',
  },
  {
    // sdu.dk/en/uddannelse/bachelor/interactive-technology-engineering:
    // "Student city: Vejle", "Application deadline: 15 March at 12 noon (CET)",
    // "Tuition fee: EUR 17,300 per year for non-EU students"; admission tab:
    // "English level B, Mathematics level A, Physics level B or Geoscience
    // level A"; "3. Take SDU's admission test"; "Register for the admission
    // test uniTEST by 20 March at 12 noon (CET) … 17 and 18 April 2027 … in
    // Odense … 20 - 25 April - online"; statistics: "All qualified applicants
    // accepted", "Expected number of student places 30". Danish page:
    // "Undervisningssprog: Engelsk". The uniTEST dates are for 2027, so it
    // takes a 2027 intake.
    programme_id: 'sdu-ite', university_id: 'sdu', city: 'Vejle', programme: 'Interactive Technology Engineering', degree_type: 'BSc',
    subject_area: 'Engineering; Computer Science', language: 'English',
    ib_subjects: 'Entry requirements on the programme page: English level B, Mathematics level A, Physics level B or Geoscience level A (Danish levels - use SDU\'s pre-assessment for IB equivalences)',
    other_requirements: 'SDU admission test (uniTEST): register by 20 March 12:00; test 17-18 April 2027 in Odense or 20-25 April online · 2026: all qualified applicants admitted (about 30 places)',
    tuition_eu: '0', tuition_noneu: '17300', application_deadline: DK_DEADLINE,
    deadline_notes: 'Programme page states application deadline 15 March at 12 noon (CET); apply via Optagelse.dk. Non-EU students: EUR 17,300 per year.',
    official_url: 'https://www.sdu.dk/en/uddannelse/bachelor/interactive-technology-engineering',
  },
  {
    // www.itu.dk/Uddannelser/Bacheloruddannelser/Data-Science: "Uddannelsen
    // foregår på engelsk."; "Matematik på A-niveau med mindst 6 i gennemsnit
    // … Engelsk på B-niveau med mindst 6 i gennemsnit". Saadan-soeger-du-ind-BSc:
    // 2026 quota 1 "Data Science: 5,9". Frister-og-vigtige-datoer: "15. marts
    // kl. 12:00 … Ansøgningsfrist for internationale adgangsgivende eksaminer
    // (Inklusiv International Baccalaureate)"; "5. juli kl. 12:00 … Frist for
    // at uploade eksamensbevis og dokumentation".
    programme_id: 'itu-ds', university_id: 'itu', programme: 'Data Science', degree_type: 'BSc',
    subject_area: 'Computer Science; Mathematics', language: 'English', ib_points_min: '24',
    ib_subjects: 'Danish-level equivalents: Mathematics A and English B, each with a grade average of at least 6 on the Danish 7-point scale. No programming needed beforehand',
    other_requirements: 'Quota 1/Quota 2 selection · 2026 Quota 1 cut-off 5.9 on the Danish 7-point scale',
    application_deadline: DK_DEADLINE,
    deadline_notes: 'ITU\'s deadline for international entry exams, including the IB, is 15 March at 12:00 noon on Optagelse.dk. Upload the diploma and documentation by 5 July at 12:00.',
    official_url: 'https://www.itu.dk/Uddannelser/Bacheloruddannelser/Data-Science',
  },
);

// Roskilde: ruc.dk/en/step-1-application-deadlines-bachelor: "International
// entry qualification … Application deadline: 15 March, 12 noon (CET)",
// including the IB. Each programme page: "Teaching language English".
// ruc.dk/en/admission-through-quota-1-or-2: in 2026 quota 2 was "only
// relevant" for Global Humanities and Social Sciences (plus Danish-taught
// programmes) — so Natural Sciences admits on quota 1 alone.
const RUC_DEADLINE_NOTE = 'RUC\'s deadline for international entry exams, including the IB, is 15 March at 12:00 noon (CET) on Optagelse.dk.';
PROGS.push(
  {
    // ruc.dk/en/bachelor/bachelor-global-humanities-int: "English at Danish
    // B-level; History or History of Ideas or Contemporary History at Danish
    // B-level; One additional language – either beginner's language at Danish
    // A-level or advanced language at Danish B-level"; "In 2026, guaranteed
    // admission … minimum GPA of 8.5". Quota 2: "upload a motivational letter
    // and your CV".
    programme_id: 'ruc-hum', university_id: 'ruc', programme: 'Bachelor in Global Humanities',
    subject_area: 'Liberal Arts; Media & Communication; Sociology & Anthropology', language: 'English', ib_points_min: '24',
    ib_subjects: 'Danish-level equivalents: English B; History, History of Ideas or Contemporary History B; one more language (a beginner\'s language at A or an advanced language at B)',
    other_requirements: '2026: admission guaranteed with a grade average of 8.5 on the Danish 7-point scale · Quota 2: motivation letter and CV · You choose two subjects after three semesters; some have their own requirements',
    application_deadline: DK_DEADLINE, deadline_notes: RUC_DEADLINE_NOTE,
    official_url: 'https://ruc.dk/en/bachelor/bachelor-global-humanities-int',
  },
  {
    // ruc.dk/en/bachelor/international-bachelor-natural-sciences-int: "English
    // at Danish B-level; Mathematics at Danish A-level; One of the following
    // subject combinations: Physics B and Chemistry B or Physics B and
    // Biotechnology A or Chemistry B and Geoscience A or Chemistry B, Biology
    // A and Physics C"; "In 2026, guaranteed admission … minimum GPA of 2.0".
    programme_id: 'ruc-nat', university_id: 'ruc', programme: 'International Bachelor in Natural Sciences',
    subject_area: 'Biology & Life Sciences; Chemistry; Physics; Mathematics; Environmental Sciences', language: 'English', ib_points_min: '24',
    ib_subjects: 'Danish-level equivalents: English B; Mathematics A; and one of Physics B + Chemistry B, Physics B + Biotechnology A, Chemistry B + Geoscience A, or Chemistry B + Biology A + Physics C',
    other_requirements: '2026: admission guaranteed with a grade average of 2.0 on the Danish 7-point scale · You choose your subjects after the first part; some have their own requirements',
    admission: 'Quota 1 (grade average)',
    application_deadline: DK_DEADLINE, deadline_notes: RUC_DEADLINE_NOTE,
    official_url: 'https://ruc.dk/en/bachelor/international-bachelor-natural-sciences-int',
  },
  {
    // ruc.dk/en/bachelor/international-bachelor-social-sciences-int: "English
    // at Danish B-level; Mathematics at Danish B-level; History or Social
    // Science or Contemporary History or History of Ideas at Danish B-level";
    // minimum grades "6.0 … from your entry qualification" or "4.0 … in the
    // subjects English and Mathematics"; "In 2026, guaranteed admission …
    // minimum GPA of 9.0". ruc.dk/en/minimum-grade-requirements: quota 1 needs
    // 6.0 overall; below the requirement "you will receive a rejection letter,
    // regardless of whether there are fewer applicants than the number of
    // study places".
    programme_id: 'ruc-soc', university_id: 'ruc', programme: 'International Bachelor in Social Sciences',
    subject_area: 'Politics & International Relations; Sociology & Anthropology; Economics; Business & Management', language: 'English', ib_points_min: '24',
    ib_subjects: 'Danish-level equivalents: English B; Mathematics B; History, Social Science, Contemporary History or History of Ideas B',
    other_requirements: 'Minimum grades: 6.0 overall on the Danish 7-point scale (quota 1), or 6.0 overall or 4.0 in English and Mathematics (quota 2) · 2026: admission guaranteed with a grade average of 9.0 · Quota 2: motivation letter and CV',
    application_deadline: DK_DEADLINE, deadline_notes: RUC_DEADLINE_NOTE,
    official_url: 'https://ruc.dk/en/bachelor/international-bachelor-social-sciences-int',
  },
);

// -------------------------------------------------------------------- Italy
//
// No Italian university publishes an IB minimum, so ib_points_min stays
// blank. Public fees depend on family income (ISEE), so tuition stays blank
// and the card shows "Not published".

// Padova. www.unipd.it/en/corsi-laurea-lingua-inglese lists the English-taught
// degrees; each programme's facts come from its unipd.it page ("Language
// English", "Place …", "Access …") and its application page on
// apply.unipd.it, which for every bachelor here says: "For Academic Year
// 2027/2028 … Call for EU and EU-equated students: 15 March 2027 – 7 April
// 2027", "English B2 level (CEFR) or equivalent", "Tuition fee €2,950 per
// year". The formal calls are still "TBD". The CEnT-S programmes add: "the
// first macro-period … (November 2026 – January 2027) … 26 November 2026, 17
// December 2026".
// www.unipd.it/en/ammissione-studenti-internazionali: "you need a minimum
// 12-year school record"; medicine is the one programme not applied for on
// apply.unipd.it.
UNIS.push({
  university_id: 'unipd', name: 'University of Padua', city: 'Padua', country: 'Italy',
  application_system: 'Direct (apply.unipd.it)',
  baseline_requirement: 'a school-leaving diploma after at least 12 years of schooling',
  english_requirement_default: 'English at B2 (CEFR) or an equivalent certificate',
});
const PD_NOTE = 'Padova\'s application portal gives the 2027/28 EU call as 15 March - 7 April 2027 (non-EU applicants abroad: 7 January - 7 March); the formal call is not out yet. The portal lists €2,950 a year; fees depend on family income (ISEE).';
const PD_CENTS = 'CEnT-S test (CISIA); first sittings 26 November and 17 December 2026';
const pd = (slug, fields) => ({
  university_id: 'unipd', language: 'English', degree_type: 'BSc',
  application_deadline: '2027-04-07', deadline_notes: PD_NOTE,
  official_url: `https://www.unipd.it/en/corsi-di-laurea/${slug}`, ...fields,
});
PROGS.push(
  // "Place Legnaro"; "Applicants must have good command of Mathematics,
  // Physics, Biology, Chemistry, Analytical and Logic skills"; 8 non-EU places.
  pd('animal-care', { programme_id: 'unipd-animalcare', city: 'Legnaro', programme: 'Animal Care',
    subject_area: 'Biology & Life Sciences', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: `Limited access: places assigned by ranking · ${PD_CENTS} · Good command of mathematics, physics, biology and chemistry expected` }),
  // "Place BOLOGNA; PADOVA"; the same degree is unibo-5909 under Bologna.
  pd('biology-human-and-environmental-health', { programme_id: 'unipd-bhe', programme: 'Biology of Human and Environmental Health',
    subject_area: 'Biology & Life Sciences; Environmental Sciences', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: `Joint degree with the University of Bologna, taught in Bologna and Padua (also listed under Bologna) · Limited access: places assigned by ranking · ${PD_CENTS}` }),
  // "Access Open admission with requirements"; no limited-access paragraph.
  pd('earth-and-climate-dynamics', { programme_id: 'unipd-ecd', programme: 'Earth and Climate Dynamics',
    subject_area: 'Environmental Sciences; Physics', admission: 'Open access: no limit on places',
    other_requirements: `${PD_CENTS} (required, not a ranking)` }),
  // "Please note that the first semester will be entirely held online."
  pd('economics-governance-and-decision-making', { programme_id: 'unipd-egd', programme: 'Economics, Governance and Decision-Making',
    subject_area: 'Economics; Politics & International Relations', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: `Limited access: places assigned by ranking · ${PD_CENTS} · First semester taught entirely online` }),
  pd('information-engineering', { programme_id: 'unipd-infoeng', programme: 'Information Engineering',
    subject_area: 'Engineering; Computer Science', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: `Limited access: places assigned by ranking · ${PD_CENTS}` }),
  // "This bachelor's programme requires an online entry test in English. More
  // information will be available soon."
  pd('psychological-science', { programme_id: 'unipd-psy', programme: 'Psychological Science',
    subject_area: 'Psychology', admission: 'Online entry test in English and a ranking',
    other_requirements: 'Limited access: places assigned by ranking · Padova\'s own online entry test in English; details not published yet' }),
  // "Study location Italy, Padua (ONLINE)".
  pd('techniques-and-methods-psychological-science', { programme_id: 'unipd-tmps', programme: 'Techniques and Methods in Psychological Science',
    subject_area: 'Psychology', admission: 'Online entry test in English and a ranking',
    other_requirements: 'Taught online · Limited access: places assigned by ranking · Padova\'s own online entry test in English; details not published yet' }),
);
// Medicine: unipd.it pages give "Single-cycle Master's Degree 6 years",
// "Language English", Medicine and Surgery "Place Venice", MedTech "Place
// Padua". The 2026/27 call (wwwassets.unipd.it/sites/default/files/2026-09/
// 2026_Bando_L_MedicineAndSurgery_ENG_V2.pdf): places for EU candidates —
// Venice 75, MedTech 70; registration on Universitaly "from 26th August until
// … 9th September 2026"; test "September 29 2026"; EU candidates need "a
// minimum score of twenty (20) points" to be ranked; one national ranking.
// No 2027/28 call yet, so no deadline.
const PD_MED_NOTE = 'No 2027/28 call yet. In 2026/27 registration ran on Universitaly from 26 August to 9 September and the test was on 29 September 2026. Fees depend on family income (ISEE).';
PROGS.push(
  { programme_id: 'unipd-med', university_id: 'unipd', city: 'Venice', programme: 'Medicine and Surgery',
    degree_type: 'Single-cycle master', subject_area: 'Medicine & Health', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree taught in Venice · 2026/27: 75 places for EU applicants · At least 20 points in the test to be ranked',
    deadline_notes: PD_MED_NOTE, official_url: 'https://www.unipd.it/en/corsi-di-laurea/medicine-and-surgery' },
  { programme_id: 'unipd-medtech', university_id: 'unipd', programme: 'Medicine and Surgery - MedTech',
    degree_type: 'Single-cycle master', subject_area: 'Medicine & Health; Engineering', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree with digital technology and AI; option of a second degree · 2026/27: 70 places for EU applicants · At least 20 points in the test to be ranked',
    deadline_notes: PD_MED_NOTE, official_url: 'https://www.unipd.it/en/corsi-di-laurea/medicine-and-surgery-medtech' },
);

// Milan (Statale). The catalogue at unimi.it/en/education/undergraduate-programmes,
// filtered to English, has five programmes: Ancient Civilizations for the
// Contemporary World, Artificial Intelligence, Economics: behavior, data and
// policy, International Medical School (IMS) and IPLE. Artificial Intelligence
// is run with Pavia and Milano-Bicocca and "will have its administrative
// headquarters in Pavia", so it is listed under Pavia. Each page's
// "Requirements" tab: "upper secondary school diploma … after at least 12
// years of schooling" and B2 English, which without a certificate is checked
// by a placement test in the first year. The "Admissions and enrolment" tabs
// still show the 2026/27 calls, so no 2027/28 deadline is recorded.
UNIS.push({
  university_id: 'unimi', name: 'University of Milan (La Statale)', city: 'Milan', country: 'Italy',
  application_system: 'Direct (unimi.it admissions portal)',
  baseline_requirement: 'a school-leaving diploma after at least 12 years of schooling',
  english_requirement_default: 'English at B2 (CEFR): a certificate, a diploma taught in English, or the university\'s placement test in the first year',
});
const mi = (slug, fields) => ({
  university_id: 'unimi', language: 'English', degree_type: 'BSc',
  official_url: `https://www.unimi.it/en/education/bachelor/${slug}`, ...fields,
});
const MI_FEES = 'Fees depend on family income (ISEE).';
PROGS.push(
  // "maximum number of students … is set at 125, plus … non-EU"; "Places
  // available: 125 + 25 reserved for non-EU citizens"; "Starting from the
  // academic year 2026/2027, the English TOLC-E test will be replaced by the
  // CEnT-S … only the scores obtained in … Mathematics and Reasoning on Texts
  // and Data"; "Application for admission: from 12/03/2026 to 06/07/2026".
  mi('international-politics-law-and-economics-iple', { programme_id: 'unimi-iple', programme: 'International Politics, Law and Economics (IPLE)',
    subject_area: 'Politics & International Relations; Law; Economics', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: 'Limited access: 125 places for EU applicants (2026/27) · CEnT-S: only the Mathematics and Reasoning on Texts and Data sections count',
    deadline_notes: `2027/28 call not out yet. In 2026/27 applications ran from 12 March to 6 July 2026. ${MI_FEES}` }),
  // "Places available: 100 + 15 reserved for non-EU citizens"; the same two
  // CEnT-S sections; "Application for admission: from 12/03/2026 to 06/07/2026".
  mi('economics-behavior-data-and-policy', { programme_id: 'unimi-ebdp', programme: 'Economics: Behavior, Data and Policy',
    subject_area: 'Economics', admission: 'CEnT-S admission test (CISIA) and a ranking',
    other_requirements: 'Limited access: 100 places for EU applicants (2026/27) · CEnT-S: only the Mathematics and Reasoning on Texts and Data sections count',
    deadline_notes: `2027/28 call not out yet. In 2026/27 applications ran from 12 March to 6 July 2026. ${MI_FEES}` }),
  // "interateneo Università Ca' Foscari Venezia"; "Blended learning programme";
  // "Course location Milan, Venice"; its own admission test (general knowledge
  // and reading comprehension of an English literary text); "Places available:
  // 75 + 25 reserved for non-EU citizens"; 2026/27 sessions "from 12/03/2026 to
  // 02/04/2026" and "from 13/05/2026 to 29/05/2026".
  mi('ancient-civilizations-contemporary-world', { programme_id: 'unimi-accw', programme: 'Ancient Civilizations for the Contemporary World',
    subject_area: 'History; Languages & Literature; Art & Design',
    admission: 'Admission test (general knowledge and an English reading text) and a ranking',
    other_requirements: 'Joint degree with Ca\' Foscari University of Venice, blended learning, taught in Milan and Venice · Limited access: 75 places for EU applicants (2026/27) · Two admission sessions',
    deadline_notes: `2027/28 call not out yet. In 2026/27 the two sessions took applications 12 March - 2 April and 13 - 29 May 2026. ${MI_FEES}` }),
  // unimi.it/en/education/single-cycle-master/international-medical-school-ims:
  // "the test is the same for all Italian public universities offering an
  // international medical curriculum"; "Application for admission: from
  // 17/09/2026 to 30/09/2026"; "Admission test date: 29 September 2026".
  { programme_id: 'unimi-ims', university_id: 'unimi', programme: 'International Medical School (IMS) - Medicine and Surgery',
    degree_type: 'Single-cycle master', subject_area: 'Medicine & Health', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree · Places set each year by ministerial decree',
    deadline_notes: `No 2027/28 call yet. In 2026/27 applications ran from 17 to 30 September and the test was on 29 September 2026. ${MI_FEES}`,
    official_url: 'https://www.unimi.it/en/education/single-cycle-master/international-medical-school-ims' },
);

// Trento. unitn.it/en/study/courses (all pages loaded) lists one bachelor
// taught in English (CEILS) and four marked "English Italian"; three of those
// have a full English track — Computer Science ("You can take the course in
// Italian or English"), Computer, Communications and Electronic Engineering
// ("You can choose to study in Italian or English") and Economics and
// Management ("Economics and Management (in English)"). The places in the
// catalogue cover both tracks. unitn.it/en/node/1433: a diploma "awarded
// after at least 12 years of schooling" and an admission test with a ranking.
// Every admissions page still shows the 2026/27 call, so no deadline.
UNIS.push({
  university_id: 'unitn', name: 'University of Trento', city: 'Trento', country: 'Italy',
  application_system: 'Direct (UniTrento admissions portal)',
  baseline_requirement: 'a school-leaving diploma after at least 12 years of schooling',
  admission_default: 'Admission test and a ranking',
});
const tn = (slug, fields) => ({
  university_id: 'unitn', language: 'English', degree_type: 'BSc',
  official_url: `https://corsi.unitn.it/en/${slug}`, ...fields,
});
PROGS.push(
  // corsi.unitn.it/en/comparative-european-and-international-legal-studies:
  // "taught entirely in English"; catalogue "75 Places"; admission page: test
  // organised by UniTrento, 2026/27 "Admission application: from mid December
  // 2025 to 6 March 2026" (test 23 March online) and "from 9 April 2026 to 4
  // May 2026" (test 14 May in person); "pay the application fee of €35,00".
  tn('comparative-european-and-international-legal-studies', { programme_id: 'unitn-ceils', programme: 'Comparative, European and International Legal Studies (CEILS)', degree_type: '',
    subject_area: 'Law', admission: 'UniTrento\'s own admission test and a ranking',
    other_requirements: 'Limited access: 75 places · Two sessions (one online, one in Trento) · Application fee €35',
    deadline_notes: '2027/28 call not out yet. In 2026/27 the first session closed on 6 March (test 23 March, online) and the second on 4 May 2026 (test 14 May, in Trento). Fees depend on family income (ISEE).' }),
  // corsi.unitn.it/en/computer-science-bachelor and …/enrollment/admission-and-
  // enrollment: EU candidates take "TOLC-I test to enrol in the Italian or
  // English programme" or "CEnT test in English to enrol in the English
  // programme in the first session only"; 2026/27 sessions closed 23 March,
  // 11 May and 31 July 2026; "235 Places".
  tn('computer-science-bachelor', { programme_id: 'unitn-cs', programme: 'Computer Science (English track)',
    subject_area: 'Computer Science', admission: 'TOLC-I or CEnT-S test (CISIA) and a ranking',
    other_requirements: 'Limited access: 235 places across the Italian and English tracks · CEnT-S counts only in the first session; TOLC-I in any session',
    deadline_notes: '2027/28 call not out yet. In 2026/27 there were three sessions, closing 23 March, 11 May and 31 July 2026. Fees depend on family income (ISEE).' }),
  // corsi.unitn.it/en/computer-communications-and-electronic-engineering and
  // its admission page: the same call, tests and sessions as Computer Science.
  tn('computer-communications-and-electronic-engineering', { programme_id: 'unitn-ccee', programme: 'Computer, Communications and Electronic Engineering (English track)',
    subject_area: 'Engineering; Computer Science', admission: 'TOLC-I or CEnT-S test (CISIA) and a ranking',
    other_requirements: 'Limited access: 235 places across the Italian and English tracks · CEnT-S counts only in the first session; TOLC-I in any session',
    deadline_notes: '2027/28 call not out yet. In 2026/27 there were three sessions, closing 23 March, 11 May and 31 July 2026. Fees depend on family income (ISEE).' }),
  // corsi.unitn.it/en/economics-and-management and its admission page: EU
  // candidates take "TOLC-E test to enrol in the Italian or English
  // curriculum"; 2026/27 sessions closed 23 March, 11 May and 24 August 2026;
  // "260 Places".
  tn('economics-and-management', { programme_id: 'unitn-em', programme: 'Economics and Management (English track)',
    subject_area: 'Economics; Business & Management', admission: 'TOLC-E test (CISIA) and a ranking',
    other_requirements: 'Limited access: 260 places across the Italian and English tracks',
    deadline_notes: '2027/28 call not out yet. In 2026/27 there were three sessions, closing 23 March, 11 May and 24 August 2026. Fees depend on family income (ISEE).' }),
);

// Pavia. portale.unipv.it/it/didattica/corsi-di-laurea/offerta-formativa,
// filtered to Laurea triennale / ciclo unico and to "Inglese" or "Inglese e
// Italiano": Artificial Intelligence, Physical Sciences for Innovative
// Technologies (seat "MILANO BICOCCA", so listed under Milano-Bicocca), Social
// Sciences for Global Challenges, Medicine and Surgery, and Ingegneria
// Edile-Architettura ("Inglese Italiano", but its first-year courses are all
// Italian-taught — not added).
UNIS.push({
  university_id: 'unipv', name: 'University of Pavia', city: 'Pavia', country: 'Italy',
  application_system: 'Direct (unipv.it admissions)',
  baseline_requirement: 'a school-leaving diploma the university recognises as valid for entry',
});
PROGS.push(
  // portale.unipv.it/…/artificial-intelligence: "Lingua Inglese", "Accesso
  // Programmato". bai.unipv.it: "1 Degree course, 3 prestigious Italian
  // Universities: Pavia, Milano Statale and Milano Bicocca"; "entirely held in
  // English, requiring at least a B2 proficiency level"; bai.unipv.it/home-eng/
  // apply: "EU students … must take the CEnT-S test, or must have the English
  // TOLC-I test"; announcements for "A.Y. 2026/2027". unimi.it's page: "the
  // programme will have its administrative headquarters in Pavia, but classes
  // will be held on all three campuses".
  { programme_id: 'unipv-ai', university_id: 'unipv', programme: 'Artificial Intelligence', degree_type: 'BSc',
    subject_area: 'Computer Science; Mathematics', language: 'English',
    admission: 'CEnT-S or English TOLC-I test (CISIA) and a ranking',
    other_requirements: 'Joint degree of Pavia, Milan Statale and Milano-Bicocca; classes on all three campuses · Limited access',
    english_requirement: 'English at B2 (CEFR)',
    deadline_notes: '2027/28 call not out yet (the course site links the 2026/27 announcement). Fees depend on family income (ISEE).',
    official_url: 'https://bai.unipv.it/' },
  // portale.unipv.it/…/social-sciences-global-challenges: "completely taught in
  // English"; "This open access program requires a B2 level in English, which
  // will need to be certified by providing a language certificate, by having
  // completed a secondary school program in English, or by taking an entrance
  // test. The Degree Program also requires participation in a non-selective
  // entrance test".
  { programme_id: 'unipv-ssgc', university_id: 'unipv', programme: 'Social Sciences for Global Challenges', degree_type: 'BSc',
    subject_area: 'Politics & International Relations; Sociology & Anthropology', language: 'English',
    admission: 'Open access: no limit on places',
    other_requirements: 'Non-selective entrance test of general knowledge after enrolling',
    english_requirement: 'English at B2: a certificate, a school diploma taught in English, or an entrance test',
    deadline_notes: 'Open access; the 2027/28 enrolment period is not published yet. Fees depend on family income (ISEE).',
    official_url: 'https://portale.unipv.it/it/didattica/corsi-di-laurea/corsi-di-laurea-triennale-e-magistrali-a-ciclo-unico/social-sciences-global-challenges' },
  // portale.unipv.it/…/corsi-di-laurea-magistrale/medicine-and-surgery: "The
  // Harvey Medicine and Surgery Course is the first medical course in Italy
  // taught in English, a six-year single-cycle Master's Degree". 2026/27 call
  // (Bando … Medicine and Surgery … a.a. 2026-2027): 103 places for EU
  // candidates; apply on Universitaly "dal 26 agosto al 9 settembre 2026";
  // test "il 29 settembre 2026"; at least "venti (20) punti" to be ranked.
  { programme_id: 'unipv-harvey', university_id: 'unipv', programme: 'Medicine and Surgery (Harvey)', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree · 2026/27: 103 places for EU applicants · At least 20 points in the test to be ranked',
    deadline_notes: 'No 2027/28 call yet. In 2026/27 registration ran on Universitaly from 26 August to 9 September and the test was on 29 September 2026. Fees depend on family income (ISEE).',
    official_url: 'https://portale.unipv.it/it/didattica/corsi-di-laurea/corsi-di-laurea-magistrale/medicine-and-surgery' },
);

// Milano-Bicocca. en.unimib.it/study/international-courses, "Programmes
// entirely taught in English": the bachelors are Economics and Science for
// Environmental Sustainability and Physical Sciences for Innovative
// Technologies; Artificial Intelligence is the Pavia-run joint degree
// (unipv-ai); the rest are master's, plus the School of Medicine and Surgery.
// The admission blocks link the 2026/2027 calls, so no 2027/28 deadline.
UNIS.push({
  university_id: 'unimib', name: 'University of Milano-Bicocca', city: 'Milan', country: 'Italy',
  application_system: 'Direct (unimib.it admissions)',
});
PROGS.push(
  // en.unimib.it/undergraduate/economics-science-environmental-sustainability:
  // "L-33 R", "3 years", "Milan", "limited with entry requirements
  // examination", "English"; "Cisia English TOLC-E — ADMISSION TEST".
  { programme_id: 'unimib-eses', university_id: 'unimib', programme: 'Economics and Science for Environmental Sustainability', degree_type: 'BSc',
    subject_area: 'Economics; Environmental Sciences', language: 'English',
    admission: 'English TOLC-E test (CISIA) and a ranking', other_requirements: 'Limited access',
    deadline_notes: '2027/28 call not out yet. Fees depend on family income (ISEE).',
    official_url: 'https://en.unimib.it/undergraduate/economics-science-environmental-sustainability' },
  // en.unimib.it/undergraduate/physical-sciences: "limited with entry
  // requirements examination", "English"; "jointly organized by the University
  // of Milano-Bicocca and the University of Pavia"; "All the lectures are
  // delivered in English and integrate traditional in-person teaching with
  // dedicated online activities"; "English TOLC-I TEST"; "CALL FOR APPLICATION
  // 2026/2027". Pavia's catalogue gives its seat as "MILANO BICOCCA".
  { programme_id: 'unimib-psit', university_id: 'unimib', programme: 'Physical Sciences for Innovative Technologies', degree_type: 'BSc',
    subject_area: 'Physics; Engineering', language: 'English',
    admission: 'English TOLC-I test (CISIA) and a ranking',
    other_requirements: 'Joint degree with the University of Pavia · Blended: about half in person, half online · Limited access',
    deadline_notes: '2027/28 call not out yet. Fees depend on family income (ISEE).',
    official_url: 'https://en.unimib.it/undergraduate/physical-sciences' },
  // en.unimib.it/study/international-programmes/school-medicine-and-surgery:
  // "a Master degree program in partnership with University of Bergamo and the
  // Papa Giovanni XXIII Hospital … Based in Bergamo"; listed among programmes
  // "entirely taught in English".
  { programme_id: 'unimib-sms', university_id: 'unimib', city: 'Bergamo', programme: 'School of Medicine and Surgery (SMS)', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree based in Bergamo, with the University of Bergamo and Papa Giovanni XXIII Hospital · Problem-based learning',
    deadline_notes: 'No 2027/28 call yet; the national test for English-taught medicine was on 29 September in 2026. Fees depend on family income (ISEE).',
    official_url: 'https://en.unimib.it/study/international-programmes/school-medicine-and-surgery' },
);

// Ca' Foscari. unive.it/pag/15612 (English-taught degree programmes), opened
// tab by tab: the bachelors are Business Administration and Management
// (etr8), Digital Management (etr7), Economics and Business (etr9), Computer
// Science - Data Science (ctr3), Hospitality Innovation and e-Tourism (ctr9),
// Italian and Mediterranean Studies (ftr6), Philosophy, International and
// Economic Studies (ltr6), and Ancient Civilizations for the Contemporary
// World (the Milan-run joint degree, unimi-accw). Each unive.it/degree/<code>
// page gives "Venue", "Language" and "Admission"; each admission page still
// describes 2026/2027, so no 2027/28 deadline. Every admission page: "a
// minimum B2-level" English; non-Italian students on an English-taught
// programme "are required to obtain 3 CFU in Italian to graduate" (exempt
// from B1 Italian).
UNIS.push({
  university_id: 'unive', name: "Ca' Foscari University of Venice", city: 'Venice', country: 'Italy',
  application_system: "Direct (Ca' Foscari online registration)",
  english_requirement_default: 'English at B2 (CEFR)',
});
const CF_ITALIAN = '3 credits of Italian needed to graduate (waived with B1 Italian)';
const CF_TOLC = "TOLC-E test (CISIA) and a ranking";
const cf = (code, fields) => ({ university_id: 'unive', language: 'English', degree_type: 'BSc',
  official_url: `https://www.unive.it/degree/${code}`, ...fields });
PROGS.push(
  // etr8 admission page: "limited-admission programme taught in English that
  // requires candidates to take an entry test"; "Taking the TOLC-E test and
  // registering for the Ca' Foscari selection"; "English TOLC-E tests will
  // not be considered"; 2026/27 summer round closed "August 28th, 2026".
  cf('etr8', { programme_id: 'unive-bam', programme: 'Business Administration and Management', subject_area: 'Business & Management',
    admission: CF_TOLC, other_requirements: `Limited access · Ca' Foscari says the English TOLC-E is not accepted · ${CF_ITALIAN}`,
    deadline_notes: "2027/28 call not out yet. 2026/27 had a spring and a summer round; the summer round closed on 28 August 2026. Fees depend on family income (ISEE)." }),
  // etr7: "Venue: Roncade"; same procedure; summer round "by July 29th, 2026".
  cf('etr7', { programme_id: 'unive-dm', city: 'Roncade', programme: 'Digital Management', subject_area: 'Business & Management; Computer Science',
    admission: CF_TOLC, other_requirements: `Taught at Roncade (Treviso) · Limited access · Ca' Foscari says the English TOLC-E is not accepted · ${CF_ITALIAN}`,
    deadline_notes: "2027/28 call not out yet. 2026/27 had a spring and a summer round; the summer round closed on 29 July 2026. Fees depend on family income (ISEE)." }),
  // etr9: same procedure as etr8; summer round "by August 28th, 2026".
  cf('etr9', { programme_id: 'unive-eb', programme: 'Economics and Business', subject_area: 'Economics; Business & Management',
    admission: CF_TOLC, other_requirements: `Limited access · Ca' Foscari says the English TOLC-E is not accepted · ${CF_ITALIAN}`,
    deadline_notes: "2027/28 call not out yet. 2026/27 had a spring and a summer round; the summer round closed on 28 August 2026. Fees depend on family income (ISEE)." }),
  // ctr3: "Venue: Mestre"; "an open admission programme structured in three
  // different curricula. Only the Data Science curriculum is taught in
  // English"; TOLC-I; 2026/27 enrolment "from July 1st to September 30th 2026".
  cf('ctr3', { programme_id: 'unive-cs-ds', city: 'Mestre', programme: 'Computer Science - Data Science (English curriculum)', subject_area: 'Computer Science',
    admission: 'Open access: no limit on places', other_requirements: `TOLC-I test (CISIA) required, not a ranking · Only the Data Science curriculum is in English · ${CF_ITALIAN}`,
    deadline_notes: "Open access; in 2026/27 enrolment ran from 1 July to 30 September 2026 (late window to 30 October, €50 extra). Fees depend on family income (ISEE)." }),
  // ctr9: "Venue: Venice/Mestre"; TOLC-E procedure; summer round "by August
  // 28th, 2026".
  cf('ctr9', { programme_id: 'unive-hiet', programme: 'Hospitality Innovation and e-Tourism', subject_area: 'Business & Management',
    admission: CF_TOLC, other_requirements: `Taught in Venice and Mestre · Limited access · Ca' Foscari says the English TOLC-E is not accepted · ${CF_ITALIAN}`,
    deadline_notes: "2027/28 call not out yet. 2026/27 had a spring and a summer round; the summer round closed on 28 August 2026. Fees depend on family income (ISEE)." }),
  // ftr6: "an open admission programme taught in English"; "a newly
  // established course"; enrolment "from July 1st to September 30th 2026".
  cf('ftr6', { programme_id: 'unive-ims', programme: 'Italian and Mediterranean Studies', subject_area: 'History; Languages & Literature',
    admission: 'Open access: no limit on places', other_requirements: `New programme (first intake 2026/27) · ${CF_ITALIAN}`,
    deadline_notes: "Open access; in 2026/27 enrolment ran from 1 July to 30 September 2026 (late window to 30 October, €50 extra). Fees depend on family income (ISEE)." }),
  // ltr6: Ca' Foscari's own entry test, taken remotely ("carried out
  // remotely on Wednesday, August 26th, 2026"); "A minimum B2-level knowledge
  // of English is mandatory for enrolment"; summer registration closed "noon
  // on August 17th, 2026".
  cf('ltr6', { programme_id: 'unive-pies', programme: 'Philosophy, International and Economic Studies', subject_area: 'Philosophy; Politics & International Relations; Economics',
    admission: "Ca' Foscari's own online entry test and a ranking",
    other_requirements: `Limited access · B2 English certificate needed by the enrolment deadline · ${CF_ITALIAN}`,
    deadline_notes: "2027/28 call not out yet. 2026/27 had a spring and a summer round; summer registration closed on 17 August 2026 (test online on 26 August). Fees depend on family income (ISEE)." }),
);

// Turin. en.unito.it/studying-unito/programs/degree-programs filtered by
// type and field_lingua_value=eng (the list is for 2026-2027): twelve
// bachelors and one six-year degree. Only three bachelors are "Language
// English"; the other nine are "English Italian" Italian-taught degrees
// (Economia Aziendale and the like, admitted on the Italian TOLC-E) with
// English modules and no English track on their pages, so they are not added.
// The seat filter puts the three bachelors in TORINO and medicine in
// ORBASSANO. Pages: "per essere ammessi occorre essere in possesso di un
// diploma di scuola secondaria superiore … o di altro titolo di studio
// conseguito all'estero, riconosciuto idoneo". No 2027/28 dates published.
UNIS.push({
  university_id: 'unito', name: 'University of Turin', city: 'Turin', country: 'Italy',
  application_system: 'Direct (UniTo Esse3 portal)',
  baseline_requirement: 'a school-leaving diploma the university recognises as valid for entry',
});
const TO_NOTE = '2027/28 dates not published yet. Fees depend on family income (ISEE).';
const to = (slug, fields) => ({ university_id: 'unito', language: 'English', degree_type: 'BSc', deadline_notes: TO_NOTE,
  official_url: `https://en.unito.it/studying-unito/programs/degree-programs/${slug}`, ...fields });
PROGS.push(
  // business-management: "Access Local programmed", "Language English";
  // "dovranno sostenere il SAT Suite … la procedura consiste nella formazione
  // di una graduatoria sulla base del punteggio conseguito nel SAT Suite".
  to('business-management', { programme_id: 'unito-bm', programme: 'Business & Management', subject_area: 'Business & Management',
    admission: 'SAT Suite score and a ranking', other_requirements: 'Limited access' }),
  // economics-and-finance-data-science: the header says "Access Local
  // programmed" but the requirements say "è ad accesso non programmato";
  // "dovrà sostenere un test di valutazione in lingua inglese … logica,
  // comprensione verbale e matematica"; failing it brings extra first-year
  // requirements (OFA). Admission left "?" because the page contradicts itself.
  to('economics-and-finance-data-science', { programme_id: 'unito-efds', programme: 'Economics and Finance with Data Science', subject_area: 'Economics; Mathematics',
    admission: '?', other_requirements: 'UniTo\'s page says both "local programmed" and "not programmed" access · Entry assessment test in English (logic, verbal comprehension, maths); a low score brings extra first-year requirements, not refusal · Advanced English expected' }),
  // global-law-and-transnational-legal-studies: "Access Free"; the TARM is
  // given "attraverso il TOLC di CISIA", which also checks "la conoscenza della
  // lingua inglese pari almeno al livello B2"; below the threshold students
  // "potranno comunque immatricolarsi" with OFA.
  to('global-law-and-transnational-legal-studies', { programme_id: 'unito-glt', programme: 'Global Law and Transnational Legal Studies', degree_type: '',
    subject_area: 'Law', admission: 'Open access: no limit on places',
    other_requirements: 'TOLC test (CISIA) required to check entry level and B2 English; a low score means extra first-year requirements, not refusal' }),
  // medicine-and-surgery-0: "Single Cycle Master Degree 6 years", "Language
  // English"; "accesso programmato nazionale disciplinato da decreto
  // ministeriale"; patient-contact clerkships from year 3 need "un livello B2
  // nella lingua italiana", met by passing the programme's own Italian
  // medical-language courses.
  { programme_id: 'unito-med', university_id: 'unito', city: 'Orbassano', programme: 'Medicine and Surgery', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', language: 'English',
    admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree · B2 Italian needed for clinical placements from year 3 (taught within the degree)',
    deadline_notes: 'No 2027/28 call yet; the national test for English-taught medicine was on 29 September in 2026. Fees depend on family income (ISEE).',
    official_url: 'https://en.unito.it/studying-unito/programs/degree-programs/medicine-and-surgery-0' },
);

// Tor Vergata. en.uniroma2.it refused or dropped every connection from this
// machine (and catalogocorsi.uniroma2.it answered 503), so this comes from
// the Italian site web.uniroma2.it: the bachelor and single-cycle lists under
// /it/percorso/offerta_formativa/sezione/, then each programme's page, whose
// "Lingua" line says "Inglese" for the five below. All link 2026-27 notices
// only, so no deadline.
UNIS.push({
  university_id: 'uniroma2', name: 'University of Rome Tor Vergata', city: 'Rome', country: 'Italy',
  application_system: 'Direct (Tor Vergata Delphi portal)',
});
const TV_NOTE = '2027/28 call not out yet. Fees depend on family income (ISEE).';
const tv = (slug, fields) => ({ university_id: 'uniroma2', language: 'English', degree_type: 'BSc', deadline_notes: TV_NOTE,
  official_url: `https://web.uniroma2.it/it/percorso/offerta_formativa/corso/${slug}`, ...fields });
PROGS.push(
  // "Lingua del corso: Inglese"; "erogato interamente in lingua inglese";
  // "Numero di posti programmato a livello locale"; "Aggiornamento scadenza
  // test CISIA per ammissione BAE 2026-27".
  tv('business_administration_and_economics', { programme_id: 'uniroma2-bae', programme: 'Business Administration and Economics',
    subject_area: 'Business & Management; Economics', admission: 'CISIA test and a ranking', other_requirements: 'Limited access · Two curricula' }),
  // "tutte le attività (lezioni, esercitazioni, materiale didattico ed esami)
  // sono in lingua inglese"; "Accesso libero con prova di verifica
  // obbligatoria … L'esito della prova non preclude la possibilità di
  // immatricolarsi".
  tv('engineering_sciences', { programme_id: 'uniroma2-engsci', programme: 'Engineering Sciences',
    subject_area: 'Engineering', admission: 'Open access: no limit on places',
    other_requirements: 'Compulsory entry check test; the result does not stop you enrolling · Mechanical, energy, electronics and ICT' }),
  // "Lingua : Inglese"; "La didattica e tutte le attività si svolgono in lingua
  // inglese"; "Numero di posti programmato a livello locale". The page does not
  // say how places are allocated.
  tv('global_governance-36050', { programme_id: 'uniroma2-gg', programme: 'Global Governance',
    subject_area: 'Politics & International Relations; Economics; Law', admission: '?',
    other_requirements: 'Limited access; the selection method is in the call, not on the programme page' }),
  // "Corso di laurea a ciclo unico in lingua inglese … Durata 6 anni - Numero
  // di posti programmato a livello nazionale"; "tenuto completamente in lingua
  // inglese … Sono previsti corsi di lingua italiana per i rapporti con i
  // pazienti".
  tv('medicine_and_surgery', { programme_id: 'uniroma2-med', programme: 'Medicine and Surgery', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree · Italian courses for talking to patients are included',
    deadline_notes: 'No 2027/28 call yet; the national test for English-taught medicine was on 29 September in 2026. Fees depend on family income (ISEE).' }),
  // "Farmacia … a ciclo unico in lingua inglese, ha una durata quinquennale";
  // "Numero di posti programmato a livello locale"; "Bando Farmacia - lingua
  // inglese a.a.2026-2027".
  tv('farmacia-27857', { programme_id: 'uniroma2-pharm', programme: 'Pharmacy', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health; Chemistry', admission: '?',
    other_requirements: 'Five-year degree · Limited access; the selection method is in the call, not on the programme page' }),
);

// Bologna, PoliMi, Sapienza: checked for English bachelors not yet listed.
// Bologna: unibo.it/en/study/first-and-single-cycle-degree with the English
// filter gives "15 Degree programmes" — the 15 already here. PoliMi:
// polimi.it/en/education/laurea-programmes, "29 Bachelor of Science
// programmes", seven marked ENG or ITA-ENG — the seven already here.
// Sapienza: corsidilaurea.uniroma1.it/en filtered to _language=ENG, bachelor
// and single-cycle, lists four programmes not yet here (below). Two more in
// that list are "Language Italian, English" with no English track found
// (Environmental Engineering for Sustainable Development, Oriental languages
// and civilizations) and are not added.
const SA_NOTE = 'No 2027/28 call yet. Fees depend on family income (ISEE).';
const sa = (code, fields) => ({ university_id: 'sapienza', language: 'English', deadline_notes: SA_NOTE,
  official_url: `https://corsidilaurea.uniroma1.it/en/course/${code}`, ...fields });
PROGS.push(
  // course/33502: "Course type Bachelor", "Bachelor class L-31", "Access
  // procedure Admission test", "Language English". The 2026/27 ranking list
  // (14824, uniroma1.it) ranks candidates on "ENGLISH TOLC-I", "TOLC-I",
  // "TOLC-S" or "SAT" scores.
  sa('33502', { programme_id: 'sapienza-acsai', programme: 'Applied Computer Science and Artificial Intelligence', degree_type: 'BSc',
    subject_area: 'Computer Science', admission: 'TOLC-I (English or Italian), TOLC-S or SAT score and a ranking',
    other_requirements: 'Limited access · Two selection rounds in 2026/27' }),
  // course/28614: "Nursing - Roma Azienda Ospedaliera Sant'Andrea", "Course
  // type Bachelor", "Bachelor class L/SNT1", "Access procedure Admission test",
  // "Language English"; places set by "Ministerial Decree no. 1014 of 7 August
  // 2026".
  sa('28614', { programme_id: 'sapienza-nursing', programme: "Nursing (Sant'Andrea hospital)", degree_type: 'BSc',
    subject_area: 'Medicine & Health', admission: 'Admission test and a ranking',
    other_requirements: 'Places set each year by ministerial decree · Taught at Sant\'Andrea hospital, Rome' }),
  // course/33454: "Medicine and Surgery \"F\"", "Single-cycle master's
  // degree", "LM-41", "Duration 6 years", "Language English".
  sa('33454', { programme_id: 'sapienza-med-f', programme: 'Medicine and Surgery "F"', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', admission: 'National admission test for English-taught medicine and a national ranking',
    other_requirements: 'Six-year degree' }),
  // course/33563: "Dentistry and Dental Prosthodontics", "Single-cycle
  // master's degree", "LM-46", "Duration 6 years", "Language English". The
  // national English-language test covers "Medicina e Chirurgia, Odontoiatria
  // e protesi dentaria e Medicina veterinaria, in lingua inglese" (D.M. 1005
  // of 6-08-2026, as cited in Padova's call).
  sa('33563', { programme_id: 'sapienza-dent', programme: 'Dentistry and Dental Prosthodontics', degree_type: 'Single-cycle master',
    subject_area: 'Medicine & Health', admission: 'National admission test for English-taught medicine and dentistry and a national ranking',
    other_requirements: 'Six-year degree' }),
);

// -------------------------------------------------------------------- write

const unis = read(new URL('universities.csv', DATA));
const uniRows = UNIS.map((u) => Object.fromEntries(unis.head.map((h) => [h, u[h] ?? ''])))
  .map((u) => ({ ...u, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const uniIds = new Set(uniRows.map((u) => u.university_id));
const keptUnis = unis.rows.filter((u) => !uniIds.has(u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...keptUnis, ...uniRows]);
const known = new Set([...keptUnis, ...uniRows].map((u) => u.university_id));

const progs = read(new URL('programmes.csv', DATA));
const progRows = PROGS.map((p) => Object.fromEntries(progs.head.map((h) => [h, p[h] ?? ''])))
  .map((p) => ({ ...p, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
for (const p of progRows) if (!known.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university ${p.university_id}`);
const ids = new Set(progRows.map((p) => p.programme_id));
if (ids.size !== progRows.length) throw new Error('duplicate programme_id in this script');
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((p) => !ids.has(p.programme_id)), ...progRows]);
console.log(`universities: ${uniRows.length} written · programmes: ${progRows.length} written`);
