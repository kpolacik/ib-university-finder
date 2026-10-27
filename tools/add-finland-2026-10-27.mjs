// One-off: add Finland's English-taught university bachelor programmes,
// checked 2026-10-27.
//
//   node tools/add-finland-2026-10-27.mjs
//
// The list. Studyinfo.fi (opintopolku.fi, the national portal run by the
// Finnish National Agency for Education) — its search API
// (konfo-backend/search/koulutukset, koulutustyyppi "kandi" and
// "kandi-ja-maisteri", opetuskieli English) returned 9 + 62 programmes. Kept:
// the ones whose implementation lists English as the only teaching language
// and that have an application option for autumn 2027. Left out: University
// of the Arts programmes taught in Finnish, Swedish and English (Global Music,
// English-only, stays), three Finnish-named programmes, and LUT's separate
// HEBUT double-degree and pathway intakes. Universities of applied sciences
// are not included, as elsewhere on this site.
//
// How each programme admits, from its Studyinfo admission-criteria page
// (konfo/en/hakukohde/<oid>/valintaperuste), read for the application round
// an IB holder uses:
//   Joint application: "7 January 2027 … 21 January 2027 at 3 pm".
//   Aalto round B: "If you apply on the basis of your International
//   Baccalaureate (IB) diploma, you apply … in the admission round B … 7 to 22
//   January 2027" (aalto.fi, "I am applying with an IB Diploma").
//   Helsinki: "If you have completed or will complete by 31 August 2027 [an IB
//   examination], you must apply in admission group 2"; group 2 runs 9-23
//   March 2027 on Studyinfo.
//   LUT: international rolling admission "1 September 2026–30 April 2027 at
//   23:59 (UTC+3) unless the programme has been filled earlier".
//
// Certificate-based admission ranks IB grades with national tables
// (yliopistovalinnat.fi, "Scoring of certificate-based admissions in 2026",
// which also lists each 2027 programme using it). IB thresholds there:
//   Technology and engineering: "At least grade 2 in advanced mathematics and
//   chemistry or physics. One of the above-mentioned subjects must be
//   completed with a minimum grade of 4."
//   Business: "At least grade 2 in mathematics (advanced or basic syllabus)".
//   Economics: "Advanced syllabus in mathematics with at least grade 2 or
//   basic syllabus in mathematics with at least grade 4."
//   Liberal Arts and Sciences: "Studies in language and literature with at
//   least grade 4 and advanced syllabus in mathematics with at least grade 4
//   or basic syllabus in mathematics with at least grade 5."
//   Bachelor's Programme in Science: "Advanced syllabus in mathematics with at
//   least grade 4 or basic syllabus in mathematics with at least grade 5."
//   Administrative and social sciences, health sciences: "there are no
//   threshold criteria".
//   Advanced maths = AA HL, AA SL or AI HL; basic = AI SL.
// Aalto sets its own (aalto.fi IB page): Science and Technology "advanced
// mathematics with at least grade 6" (Quantum Technology: "or physics with at
// least grade 6"); Technology, Business and Design "advanced mathematics with
// at least 6" plus "Mandatory preliminary assignment"; Design and Media
// "preliminary assignments, intake assignments, and an interview".
// LUT (rolling-admission IB page, table headed "2026 Entry requirements"):
// "IB 24"; technology "Advanced 4" plus chemistry and/or physics; business
// "Basic 5 or Advanced 4", "At least one subject 5"; or "OMPT … 60 %", SAT
// 1300 or ACT 28 instead; "There are no entrance exams".
//
// Entrance exam: certificate-based routes are `no` (other routes such as SAT
// or an interview are optional for IB holders); LUT is `waivable` (an online
// maths test only if your maths falls short); `yes` where every applicant sits
// an exam: UEF Social Sciences ("entrance examination admission"), UEF Forest
// Bioeconomy and Information Technology ("entrance examination course"), JYU
// Early Childhood Education ("Admission is based on SAT and ACT results and
// interview"), JYU Immersive Software Engineering ("online exam"), Aalto
// Design and Media ("intake assignments"), Uniarts Global Music ("Entrance
// examination"). Interview-only (UEF East Slavic) and design-task (Lapland)
// routes are `no`.
//
// Living costs: Study in Finland, "approximately €900–€1,200 per month,
// depending on the location" (studyinfinland.fi, fees-and-cost-living); the
// University of Helsinki, "The total monthly living expenses of a single
// student average from 900 to 1 250 euros" (updated 6.2.2025), used for the
// Helsinki-based universities.
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

const FI = {
  country: 'Finland',
  application_system: 'Studyinfo.fi (Finnish national portal)',
  living_cost_min: '900', living_cost_max: '1200',
  living_cost_source: 'national estimate (Study in Finland)',
  tuition_eu_default: '0',
  baseline_requirement: 'an IB Diploma',
};
const HELSINKI_COST = { living_cost_min: '900', living_cost_max: '1250' };
const UNIS = [
  // aalto.fi IB page: "All students are expected to have sufficient language
  // skills to be able to study in English. You are not required to submit a
  // language test result."
  { university_id: 'aalto', name: 'Aalto University', city: 'Espoo',
    english_requirement_default: 'No language test needed: Aalto expects you to be able to study in English' },
  { university_id: 'helsinki', name: 'University of Helsinki', city: 'Helsinki', ...HELSINKI_COST, living_cost_source: "university's estimate" },
  { university_id: 'tampere', name: 'Tampere University', city: 'Tampere' },
  // lut.fi IB page: "International Baccalaureate completed in English"; else
  // "English as A1 language … (minimum grade 2)", "English as B language with
  // a minimum grade 5", or "IELTS Academic … 6.5 with a minimum score of 6.0
  // in writing and in speaking".
  { university_id: 'lut', name: 'LUT University (Lappeenranta-Lahti University of Technology)', city: 'Lappeenranta',
    application_system: 'Studyinfo.fi (LUT rolling admission)',
    english_requirement_default: 'An IB Diploma taught in English · or English A 2+ or English B 5+ · or IELTS Academic 6.5 (6.0 in writing and speaking)' },
  { university_id: 'oulu', name: 'University of Oulu', city: 'Oulu' },
  // UEF admission-criteria pages: "IELTS Academic: Minimum overall score:
  // 6.0, with a minimum of 5.5 in each component".
  { university_id: 'uef', name: 'University of Eastern Finland', city: 'Joensuu',
    english_requirement_default: 'IELTS Academic 6.0 (5.5 in each part), or another listed test or IB route — see the programme page' },
  { university_id: 'turku', name: 'University of Turku', city: 'Turku' },
  { university_id: 'jyu', name: 'University of Jyväskylä', city: 'Jyväskylä' },
  { university_id: 'vaasa', name: 'University of Vaasa', city: 'Vaasa' },
  { university_id: 'hanken', name: 'Hanken School of Economics', city: 'Helsinki', ...HELSINKI_COST, living_cost_source: 'estimate from University of Helsinki, same city' },
  { university_id: 'lapland', name: 'University of Lapland', city: 'Rovaniemi' },
  { university_id: 'uniarts', name: 'University of the Arts Helsinki', city: 'Helsinki', ...HELSINKI_COST, living_cost_source: 'estimate from University of Helsinki, same city' },
].map((u) => ({ ...FI, ...u }));

// ------------------------------------------------------------- programmes

const ADV = 'AA HL, AA SL or AI HL';
const ALL = 'AA HL · AA SL · AI HL · AI SL';
const ADV_MATHS = 'AA HL · AA SL · AI HL';
const TECH = `Maths: ${ADV}, and Chemistry or Physics — at least 2 in both and 4 in one`;
const AALTO_ST = `Maths: ${ADV} 6+ · Chemistry or Physics counts in the score`;
const ECON = `Maths: ${ADV} 2+, or AI SL 4+`;
const BUS2 = 'Maths: any IB maths course, 2+';
const PASS = 'Maths: any IB maths course, passed';
const SCI = `Maths: ${ADV} 4+, or AI SL 5+`;
const LUT_TECH = (sci) => `IB 24+ · Maths: ${ADV} 4+ · ${sci}`;
const LUT_BUS = `IB 24+ · Maths: ${ADV} 4+, or AI SL 5+ · at least one humanities or science subject at 5`;

const JOINT = 'Joint application: 7–21 January 2027 (closes 15:00 Finnish time).';
const AALTO_NOTE = 'IB holders apply in Aalto\'s admission round B, 7–22 January 2027 (closes 15:00 Finnish time). Predicted grades due 1 April 2027.';
const HY_NOTE = 'IB holders apply in admission group 2, 9–23 March 2027. The 5–19 January round is for other diplomas.';
const LUT_NOTE = 'Rolling admission, 1 September 2026 to 30 April 2027, or until the programme is full. A decision comes within a month of a complete application.';
const CERT = (pct) => `Ranked on IB grades with the national scoring table (${pct} of places)`;
const LUT_ADM = 'Places offered while they last to applicants who meet the requirements';

const studyinfo = (oid) => `https://opintopolku.fi/konfo/en/koulutus/1.2.246.562.13.${oid}`;
const P = (programme_id, university_id, programme, subject_area, oid, fields) => ({
  programme_id, university_id, programme, subject_area, language: 'English',
  degree_type: 'Bachelor + Master', application_deadline: '2027-01-21', deadline_notes: JOINT,
  entrance_exam: 'no', official_url: studyinfo(oid), ...fields,
});
const aalto = (id, name, area, oid, f) => P(`aalto-${id}`, 'aalto', name, area, oid, { application_deadline: '2027-01-22', deadline_notes: AALTO_NOTE, ...f });
const lut = (id, name, area, oid, f) => P(`lut-${id}`, 'lut', name, area, oid,
  { ib_points_min: '24', admission: LUT_ADM, entrance_exam: 'waivable', application_deadline: '2027-04-30', deadline_notes: LUT_NOTE,
    other_requirements: 'Maths short of the bar: an online maths placement test (OMPT) at 60%, or SAT 1300 / ACT 28 · LUT\'s table is headed 2026 entry requirements', ...f });
const tampereTech = (id, name, area, oid) => P(`tampere-${id}`, 'tampere', name, area, oid,
  { ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('30%'), other_requirements: 'Other route: SAT 1250 (Math 700) or ACT 26 plus an interview' });

const PROGS = [
  // ---- Aalto
  aalto('chemical-engineering', 'Chemical Engineering', 'Engineering; Chemistry', '00000000000000002812', { ib_subjects: AALTO_ST, ib_maths: ADV_MATHS, admission: CERT('43%') }),
  aalto('computer-engineering', 'Computer Engineering', 'Engineering; Computer Science', '00000000000000009264', { ib_subjects: AALTO_ST, ib_maths: ADV_MATHS, admission: CERT('45%') }),
  aalto('data-science', 'Data Science', 'Computer Science; Mathematics', '00000000000000002815', { ib_subjects: AALTO_ST, ib_maths: ADV_MATHS, admission: CERT('37%') }),
  aalto('digital-systems-design', 'Digital Systems and Design', 'Engineering; Computer Science', '00000000000000002814', { ib_subjects: AALTO_ST, ib_maths: ADV_MATHS, admission: CERT('40%') }),
  aalto('mechanical-civil', 'Mechanical and Civil Engineering', 'Engineering', '00000000000000002813', { ib_subjects: AALTO_ST, ib_maths: ADV_MATHS, admission: CERT('40%') }),
  aalto('quantum-technology', 'Quantum Technology', 'Physics; Engineering', '00000000000000002816',
    { ib_subjects: `Maths: ${ADV} 6+, or Physics 6+ · Chemistry or Physics counts in the score`, ib_maths: ALL, admission: CERT('43%') }),
  aalto('technology-business-design', 'Technology, Business and Design', 'Engineering; Business & Management; Art & Design', '00000000000000012107',
    { ib_subjects: `Maths: ${ADV} 6+ · Chemistry or Physics counts in the score`, ib_maths: ADV_MATHS, admission: CERT('50%'),
      other_requirements: 'Mandatory preliminary assignment, published 17 December 2026, due 22 January 2027' }),
  aalto('design-media', 'Design and Media', 'Art & Design; Media & Communication', '00000000000000002809',
    { ib_subjects: 'none', ib_maths: 'none', entrance_exam: 'yes', admission: 'Preliminary assignments, then intake assignments and an interview; school grades not used',
      other_requirements: 'Preliminary assignments due 29 January 2027' }),
  aalto('economics', 'Economics', 'Economics', '00000000000000002810', { city: 'Helsinki', ib_subjects: ECON, ib_maths: ALL, admission: CERT('70%'),
    other_requirements: 'Scored: best Language A, maths and three best other subjects' }),
  aalto('finance', 'Finance', 'Economics; Business & Management', '00000000000000012221', { city: 'Helsinki', ib_subjects: ECON, ib_maths: ALL, admission: CERT('81%'),
    other_requirements: 'Optional SAT 1200 / ACT 25 route as well' }),
  aalto('international-business', 'International Business', 'Business & Management', '00000000000000010636', { city: 'Helsinki', ib_subjects: BUS2, ib_maths: ALL, admission: CERT('45%'),
    other_requirements: 'Optional SAT 1200 / ACT 25 route as well' }),

  // ---- Helsinki (group 2: certificate-based)
  P('helsinki-liberal-arts', 'helsinki', 'Liberal Arts and Sciences', 'Liberal Arts', '00000000000000010743',
    { ib_subjects: `Language A 4+ · ${SCI}`, ib_maths: ALL, admission: CERT('83%'), application_deadline: '2027-03-23', deadline_notes: HY_NOTE }),
  P('helsinki-science', 'helsinki', 'Science', 'Mathematics; Physics; Chemistry; Computer Science', '00000000000000000628',
    { ib_subjects: SCI, ib_maths: ALL, admission: CERT('78%'), application_deadline: '2027-03-23', deadline_notes: HY_NOTE }),

  // ---- Tampere
  tampereTech('automation-robotics', 'Automation and Robotics', 'Engineering', '00000000000000012740'),
  tampereTech('biomedical-engineering', 'Biomedical Engineering', 'Engineering; Medicine & Health', '00000000000000012737'),
  tampereTech('chemistry', 'Chemistry (Science and Engineering)', 'Chemistry; Engineering', '00000000000000012735'),
  tampereTech('computing-electrical', 'Computing Sciences and Electrical Engineering', 'Computer Science; Engineering', '00000000000000012744'),
  tampereTech('engineering-physics', 'Engineering Physics', 'Physics; Engineering', '00000000000000012741'),
  tampereTech('environmental-engineering', 'Environmental Engineering', 'Engineering; Environmental Sciences', '00000000000000012739'),
  tampereTech('materials-science', 'Materials Science', 'Engineering; Chemistry', '00000000000000012738'),
  P('tampere-technology-urban', 'tampere', 'Technology, Sustainable Urban Development', 'Engineering; Environmental Sciences', '00000000000000000832',
    { ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('51%') }),
  P('tampere-administrative-urban', 'tampere', 'Administrative Sciences, Sustainable Urban Development', 'Politics & International Relations', '00000000000000000992',
    { ib_subjects: 'none', ib_maths: 'none', admission: CERT('51%') }),
  P('tampere-social-urban', 'tampere', 'Social Sciences, Sustainable Urban Development', 'Sociology & Anthropology', '00000000000000000914',
    { ib_subjects: 'none', ib_maths: 'none', admission: CERT('51%') }),
  P('tampere-socially-sustainable', 'tampere', 'Socially Sustainable Societies', 'Sociology & Anthropology; Politics & International Relations', '00000000000000007915',
    { ib_subjects: 'none', ib_maths: 'none', admission: CERT('30%') }),

  // ---- LUT
  lut('chemical-process', 'Chemical and Process Engineering', 'Engineering; Chemistry', '00000000000000010934', { ib_subjects: LUT_TECH('Chemistry'), ib_maths: ADV_MATHS }),
  lut('civil-engineering', 'Civil Engineering', 'Engineering', '00000000000000012058', { city: 'Lahti', ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('computational-science-ai', 'Computational Science and Artificial Intelligence', 'Computer Science; Mathematics', '00000000000000009515', { ib_subjects: LUT_TECH('Physics'), ib_maths: ADV_MATHS }),
  lut('electrical-engineering', 'Electrical Engineering', 'Engineering', '00000000000000012659', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('electrical-engineering-dd', 'Electrical Engineering (double degree)', 'Engineering', '00000000000000000912', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('energy-technology', 'Energy Technology', 'Engineering', '00000000000000012660', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('energy-technology-dd', 'Energy Technology (double degree)', 'Engineering', '00000000000000000932', { city: 'Lahti', ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('environmental-technology', 'Environmental Technology', 'Engineering; Environmental Sciences', '00000000000000012661', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('industrial-engineering', 'Industrial Engineering and Management', 'Engineering; Business & Management', '00000000000000000797', { city: 'Lahti', ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('mechanical-engineering', 'Mechanical Engineering', 'Engineering', '00000000000000012658', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('mechanical-engineering-dd', 'Mechanical Engineering (double degree)', 'Engineering', '00000000000000000824', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('software-systems-dd', 'Software and Systems Engineering (double degree)', 'Computer Science; Engineering', '00000000000000000859', { city: 'Lahti', ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('technology-engineering-science', 'Technology and Engineering Science', 'Engineering', '00000000000000000878', { ib_subjects: LUT_TECH('Chemistry or Physics'), ib_maths: ADV_MATHS }),
  lut('digital-business', 'Digital Business', 'Business & Management; Computer Science', '00000000000000010933', { city: 'Lahti', ib_subjects: LUT_BUS, ib_maths: ALL }),
  lut('sustainable-international-business', 'Sustainable International Business', 'Business & Management', '00000000000000008009', { ib_subjects: LUT_BUS, ib_maths: ALL }),

  // ---- Oulu
  P('oulu-computer-science', 'oulu', 'Computer Science and Engineering', 'Computer Science; Engineering', '00000000000000011061', { ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('24%') }),
  P('oulu-electronics-communications', 'oulu', 'Electronics and Communications Engineering', 'Engineering', '00000000000000000935', { ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('24%') }),
  P('oulu-software-information-systems', 'oulu', 'Software Engineering and Information Systems', 'Computer Science', '00000000000000010833', { ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('24%') }),
  P('oulu-international-business', 'oulu', 'International Business Management', 'Business & Management', '00000000000000002937',
    { ib_subjects: BUS2, ib_maths: ALL, admission: CERT('77%'), deadline_notes: `${JOINT} Oulu also runs a rolling admission for this programme until 25 February 2027.` }),

  // ---- Eastern Finland
  P('uef-urban-sustainability', 'uef', 'Urban Sustainability Studies', 'Environmental Sciences; Sociology & Anthropology', '00000000000000010390',
    { degree_type: 'BSocSc', ib_subjects: 'none', ib_maths: 'none', admission: CERT('33%'),
      other_requirements: 'At least 54 certificate points · Other route: online interview · Joint YUFE degree, years 2–3 at partner universities' }),
  P('uef-human-planetary-health', 'uef', 'Human and Planetary Health', 'Medicine & Health; Environmental Sciences', '00000000000000010958',
    { degree_type: 'BHSc', city: 'Kuopio', ib_subjects: 'none', ib_maths: 'none', admission: CERT('33%') }),
  P('uef-data-engineering', 'uef', 'Data Engineering', 'Computer Science; Engineering', '00000000000000010968',
    { city: 'Kuopio', ib_subjects: TECH, ib_maths: ADV_MATHS, admission: CERT('25%') }),
  P('uef-lifelong-learning', 'uef', 'Lifelong Learning and Sustainable Development', 'Education', '00000000000000001052',
    { degree_type: 'BA', ib_subjects: '', ib_maths: '?', admission: CERT('16%') }),
  P('uef-east-slavic', 'uef', 'East Slavic Societies and Religion', 'Languages & Literature; History', '00000000000000012196',
    { degree_type: 'BA', ib_subjects: 'none', ib_maths: 'none', admission: 'Recorded online video interview' }),
  P('uef-social-sciences', 'uef', 'Social Sciences', 'Sociology & Anthropology', '00000000000000001053',
    { degree_type: 'BSocSc', ib_subjects: 'none', ib_maths: 'none', admission: 'Entrance examination', entrance_exam: 'yes' }),
  P('uef-forest-bioeconomy', 'uef', 'Sustainable Forest Bioeconomy', 'Environmental Sciences; Biology & Life Sciences', '00000000000000007916',
    { degree_type: 'BSc', ib_subjects: 'none', ib_maths: 'none', admission: 'Online entrance examination course and a video interview', entrance_exam: 'yes' }),
  P('uef-information-technology', 'uef', 'Information Technology', 'Computer Science', '00000000000000010964',
    { city: 'Kuopio', ib_subjects: 'none', ib_maths: 'none', admission: 'Entrance examination course and a video interview', entrance_exam: 'yes' }),

  // ---- Turku, Jyväskylä, Vaasa, Hanken, Lapland, Uniarts
  P('turku-sustainable-entrepreneurship', 'turku', 'Sustainable and Social Entrepreneurship', 'Business & Management', '00000000000000009104',
    { degree_type: 'BSc (Econ)', ib_subjects: `${PASS} · at least 110 points on the national business table`, ib_maths: ALL, admission: CERT('30%') }),
  P('jyu-business-innovation', 'jyu', 'Business Innovation and Sustainability', 'Business & Management', '00000000000000009323',
    { ib_subjects: PASS, ib_maths: ALL, admission: CERT('40%') }),
  P('jyu-early-childhood', 'jyu', 'Early Childhood Education', 'Education', '00000000000000012870',
    { degree_type: 'BA', ib_subjects: 'none', ib_maths: 'none', admission: 'SAT (1100) or ACT (22) score, then an online interview', entrance_exam: 'yes' }),
  P('jyu-immersive-software-ai', 'jyu', 'Immersive Software Engineering and AI', 'Computer Science; Engineering', '00000000000000012852',
    { degree_type: 'BSc (Tech)', ib_subjects: 'none', ib_maths: 'none', admission: 'Online exam and written task, then an interview', entrance_exam: 'yes' }),
  // Vaasa: "University of Vaasa : Business Administration (100 %)" on the 2027
  // business list; Studyinfo only shows the 2026 rolling round so far.
  P('vaasa-business-administration', 'vaasa', 'Business Administration', 'Business & Management', '00000000000000010124',
    { ib_subjects: BUS2, ib_maths: ALL, admission: CERT('100%'), application_deadline: '',
      deadline_notes: '2027 round not on Studyinfo yet. In 2026 it was a rolling admission from 23 October 2025 to 15 April 2026.' }),
  P('hanken-business', 'hanken', 'Business', 'Business & Management; Economics', '00000000000000007930',
    { ib_subjects: PASS, ib_maths: ALL, admission: CERT('40%') }),
  P('lapland-design', 'lapland', 'Design', 'Art & Design', '00000000000000012708',
    { ib_subjects: 'none', ib_maths: 'none', admission: 'A design challenge and a video reflection, set when the application opens' }),
  P('uniarts-global-music', 'uniarts', 'Global Music', 'Art & Design', '00000000000000002061',
    { ib_subjects: 'none', ib_maths: 'none', admission: 'Entrance examination', entrance_exam: 'yes' }),
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
save(new URL('programmes.csv', DATA), progs.head, [...keptProgs, ...progRows]);
console.log(`Finland: ${uniRows.length} universities, ${progRows.length} programmes`);
