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
