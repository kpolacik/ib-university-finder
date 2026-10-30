// One-off: add Austria, checked 2026-10-29.
//
//   node tools/add-austria-2026-10-29.mjs
//
// Scope, as asked: English-taught bachelors at Austrian universities, and
// German-taught bachelors only at the best-known: the University of Vienna,
// TU Wien and WU Vienna. The national database (studienwahl.at) refuses
// connections from this machine, so each university's own list was used.
//
// IB rule (University of Vienna, "Country-specific requirements for
// admission"): the IB Diploma "at least 24 points (admission is not possible
// with an IB Certificate)", "at least six examination subjects including" a
// foreign language "(this may be German)" and Mathematics, "at least three of
// the subjects have to be completed at "Higher Level"". German-taught
// programmes need C1 German before admission ("The subject German in your IB
// Diploma can only be accepted as proof German language proficiency at level
// A2"); TU Wien likewise: "For a German-taught programme German language
// skills at level C1 CEFR are required".
//
// Deadlines. Austria's general admission period for the winter semester ends
// on 5 September (Klagenfurt: "the general admission period (winter
// semester: 5 September …)"; Vienna 2026: EU/EEA "22 June to 5 September
// 2026"; JKU 2026: "July 8, 2026, to September 5, 2026"). Programmes with an
// entrance procedure register in spring; their 2027 dates are not published,
// so those rows carry no deadline and the note gives 2026's.
//
// University of Vienna (studieren.univie.ac.at, the bachelor list and each
// programme's profile; aufnahmeverfahren.univie.ac.at for the 22 with an
// entrance procedure): 2026 registration "2 March to 4 May 2026". "Written
// test" shows a date where the test was held in 2026 (entrance_exam yes);
// where it says "Does not take place" the procedure ended without a test,
// which happens when registrations do not exceed the places (no, with a
// note). Teacher Education is left out (a two-subject teaching degree).
// Mathematical Foundations of Data Science: "English (admission
// requirement) / You do not need any knowledge of German for this programme".
//
// TU Wien (tuwien.at bachelor list): every programme "Language of instruction
// German"; Informatics, Business Informatics and Computer Engineering share
// "670 programme places" in "a collective two-stage admission procedure" with
// a "Ranking test on site expected on July 13, 2026" ("Ranking test will take
// place!"); Architecture: "625 study places … two-stage selection process";
// Spatial Planning: an admission procedure (details not on the page).
//
// WU (wu.ac.at): Business, Economics and Social Sciences — 2026 registration
// "2. März - 19. Mai 2026", online self-assessment, then an entrance exam on
// 30 June 2026; BBE (English): "A selection procedure is held once a year in
// the spring. Applicants who successfully pass the entrance exam can enroll",
// application period "March 2 to May 19, 2026".
//
// JKU Linz ("Language of Instruction" table): English for Artificial
// Intelligence, Biological Chemistry, Chemistry and Chemical Technology,
// International Business Administration, Transformation Studies (first
// intake 2027/28, "Application Period: January 2027"); Quantum Science and
// Technology: "taught in English". English B2 (IBA: C1). IBA: "80 students
// will be accepted", admission procedure; 2026 deadline "August 10".
//
// Klagenfurt (aau.at key facts): "Language of instruction English" for Worlds
// of English, International Business and Economics ("Special admission
// procedure & general admission procedure"), Social Sciences, Information and
// Communications Engineering, DMC² ("Special admission procedure: No").
// Technical Mathematics needs German B2 and is not included.
//
// Leoben (unileoben.ac.at): "Language of instruction: English" for Circular
// Engineering, Geoenergy Engineering and New Science and Technology
// (EURECA-PRO); English programmes have a "mandatory qualification
// examination".
//
// CEU (private, Vienna; ceu.edu/admissions/bachelor): rounds closing 15
// October 2026, 2 February 2027, 15 April 2027, 15 July 2027 ("subject to
// space availability"); motivation letter, recommendation, CV, transcripts;
// "Only preselected candidates are interviewed"; "€8,000 per year".
//
// Living costs: Study in Austria "Total per month approx. 1,300 Euros"; the
// University of Vienna "approx. € 1400" (used for Vienna).
//
// Re-runnable: rows are replaced by id, not appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-29';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const AT = {
  country: 'Austria', application_system: "Direct (the university's online application)",
  living_cost_min: '1300', living_cost_source: 'national estimate (Study in Austria)',
  tuition_eu_default: '0', baseline_requirement: 'an IB Diploma (general university entrance qualification)',
  admission_default: 'Open admission: meet the requirements, get a place',
};
const VIENNA = { city: 'Vienna', living_cost_min: '1400', living_cost_source: "university's estimate" };
const VIENNA_BORROWED = { city: 'Vienna', living_cost_min: '1400', living_cost_source: 'estimate from University of Vienna, same city' };
const GERMAN_C1 = 'German C1 before admission (the IB German subject counts only as A2)';
const UNIS = [
  { university_id: 'univie', name: 'University of Vienna', ...VIENNA,
    baseline_requirement: 'an IB Diploma with 24+ points, six subjects including a foreign language and Maths, three at HL',
    english_requirement_default: GERMAN_C1 },
  { university_id: 'tuwien', name: 'TU Wien', ...VIENNA_BORROWED, english_requirement_default: 'German C1 before admission' },
  { university_id: 'wu', name: 'WU Vienna University of Economics and Business', ...VIENNA_BORROWED },
  { university_id: 'jku', name: 'Johannes Kepler University Linz (JKU)', city: 'Linz', english_requirement_default: 'English B2' },
  { university_id: 'klagenfurt', name: 'University of Klagenfurt', city: 'Klagenfurt', english_requirement_default: 'English B2' },
  { university_id: 'leoben', name: 'Montanuniversität Leoben', city: 'Leoben', english_requirement_default: 'English B2' },
  { university_id: 'ceu', name: 'Central European University (CEU)', ...VIENNA_BORROWED, tuition_eu_default: '8000',
    application_system: 'Direct (CEU online application)', admission_default: 'Selective: assessed on your application',
    english_requirement_default: 'IB English 5+, or an accepted English test' },
].map((u) => ({ ...AT, ...u }));

const GENERAL = 'General admission period: apply by 5 September (the statutory end of the winter-semester admission period).';
const NOTE_2026 = (s) => `2027 dates not published yet. In 2026: ${s}.`;
const P = (programme_id, university_id, programme, subject_area, fields) => ({
  programme_id, university_id, programme, subject_area, language: 'German', ib_subjects: 'none', ib_maths: 'none',
  entrance_exam: 'no', application_deadline: '2027-09-05', deadline_notes: GENERAL, ...fields,
});

// ---- University of Vienna: [id, name, area, degree, Latin, test (held/notheld/''), places, url]
const UNIVIE = [
  ['ancient-history-and-studies-in-classical-antiquity', "Ancient History and Studies in Classical Antiquity", "History", 'BA', "Latin before the admission", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/ancient-history-and-studies-in-classical-antiquity-bachelors-programme"],
  ['byzantine-and-modern-greek-studies', "Byzantine and Modern Greek Studies", "Languages & Literature; History", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/byzantine-and-modern-greek-studies-bachelors-programme"],
  ['catholic-theology', "Catholic Theology", "Philosophy", 'Diploma (Mag. theol.)', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/catholic-theology-diploma-programme"],
  ['chinese-studies', "Chinese Studies", "Languages & Literature", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/chinese-studies-bachelors-programme"],
  ['classical-archaeology', "Classical Archaeology", "History", 'BA', "Latin before the admission", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/classical-archaeology-bachelors-programme"],
  ['classical-philology', "Classical Philology", "Languages & Literature", 'BA', "Latin before the admission", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/classical-philology-bachelors-programme"],
  ['comparative-literature', "Comparative Literature", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/comparative-literature-bachelors-programme"],
  ['egyptology', "Egyptology", "History", 'BA', "Latin before your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/egyptology-bachelors-programme"],
  ['european-ethnology', "European Ethnology", "Sociology & Anthropology", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/european-ethnology-bachelors-programme"],
  ['geography', "Geography", "Environmental Sciences", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/geography-bachelors-programme"],
  ['german-philology', "German Philology", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/german-philology-bachelors-programme"],
  ['history-of-art-and-architecture', "History of Art and Architecture", "Art & Design; History", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/history-of-art-and-architecture-bachelors-programme"],
  ['history', "History", "History", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/history-bachelors-programme"],
  ['hungarian-studies-and-finnish-studies', "Hungarian Studies and Finnish Studies", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/hungarian-studies-and-finnish-studies-bachelors-programme"],
  ['islamic-theological-studies', "Islamic Theological Studies", "Philosophy", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/islamic-theological-studies-bachelors-programme"],
  ['japanese-studies', "Japanese Studies", "Languages & Literature", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/japanese-studies-bachelors-programme"],
  ['jewish-studies', "Jewish Studies", "History; Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/jewish-studies-bachelors-programme"],
  ['languages-and-cultures-of-south-asia-and-tibet', "Languages and Cultures of South Asia and Tibet", "Languages & Literature", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/languages-and-cultures-of-south-asia-and-tibet-bachelors-programme"],
  ['linguistics', "Linguistics", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/linguistics-bachelors-programme"],
  ['mathematics', "Mathematics", "Mathematics", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/mathematics-bachelors-programme"],
  ['meteorology-and-climate-science', "Meteorology and Climate Science", "Physics; Environmental Sciences", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/meteorology-and-climate-science-bachelors-programme"],
  ['musicology', "Musicology", "Art & Design", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/musicology-bachelors-programme"],
  ['oriental-studies', "Oriental Studies", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/oriental-studies-bachelors-programme"],
  ['philosophy', "Philosophy", "Philosophy", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/philosophy-bachelors-programme"],
  ['physics', "Physics", "Physics", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/physics-bachelors-programme"],
  ['prehistory-and-historical-archaeology', "Prehistory and Historical Archaeology", "History", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/prehistory-and-historical-archaeology-bachelors-programme"],
  ['protestant-theology', "Protestant Theology", "Philosophy", 'BTh', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/protestant-theology-bachelors-programme"],
  ['religious-education', "Religious Education", "Education", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/religious-education-bachelors-programme"],
  ['romance-studies', "Romance Studies", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/romance-studies-bachelors-programme"],
  ['scandinavian-studies', "Scandinavian Studies", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/scandinavian-studies-bachelors-programme"],
  ['slavonic-studies', "Slavonic Studies", "Languages & Literature", 'BA', "Latin during your studies", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/slavonic-studies-bachelors-programme"],
  ['sport-and-human-movement-science', "Sport and Human Movement Science", "Medicine & Health", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/sport-and-human-movement-science-bachelors-programme"],
  ['statistics-and-data-analytics', "Statistics and Data Analytics", "Mathematics", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/statistics-and-data-analytics-bachelors-programme"],
  ['theatre-film-and-media-studies', "Theatre, Film and Media Studies", "Media & Communication; Art & Design", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-you-degree-programme/bachelors-and-diploma-programmes/theatre-film-and-media-studies-bachelors-programme"],
  ['african-studies', "African Studies", "Languages & Literature; Sociology & Anthropology", 'BA', "", "", "", "https://studieren.univie.ac.at/en/find-your-degree-programme/bachelors-and-diploma-programmes/african-studies-bachelors-programme"],
  ['astronomy', "Astronomy", "Physics", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-your-degree-programme/bachelors-and-diploma-programmes/astronomy-bachelors-programme"],
  ['earth-sciences', "Earth Sciences", "Environmental Sciences", 'BSc', "", "", "", "https://studieren.univie.ac.at/en/find-your-degree-programme/bachelors-and-diploma-programmes/earth-sciences-bachelors-programme"],
  ['pharmacy', "Pharmacy", "Medicine & Health; Chemistry", 'BSc', "", "held", "441", "https://aufnahmeverfahren.univie.ac.at/en/pharmacy"],
  ['mass-media-and-communication-science', "Mass Media and Communication Science", "Media & Communication", 'BA', "", "notheld", "970", "https://aufnahmeverfahren.univie.ac.at/en/mass-media-and-communication-science"],
  ['economics', "Economics", "Economics", 'BSc', "", "held", "353", "https://aufnahmeverfahren.univie.ac.at/en/economics"],
  ['political-science', "Political Science", "Politics & International Relations", 'BA', "", "notheld", "570", "https://aufnahmeverfahren.univie.ac.at/en/political-science"],
  ['computer-science', "Computer Science", "Computer Science", 'BSc', "", "held", "415 (total for Computer Science and Business Informatics)", "https://aufnahmeverfahren.univie.ac.at/en/computer-science"],
  ['chemistry', "Chemistry", "Chemistry", 'BSc', "", "held", "250", "https://aufnahmeverfahren.univie.ac.at/en/chemistry"],
  ['international-legal-studies', "International Legal Studies", "Law", 'LLB', "", "held", "250", "https://aufnahmeverfahren.univie.ac.at/en/international-legal-studies"],
  ['english-and-american-studies', "English and American Studies", "Languages & Literature", 'BA', "", "notheld", "467", "https://aufnahmeverfahren.univie.ac.at/en/english-and-american-studies"],
  ['sociology', "Sociology", "Sociology & Anthropology", 'BA', "", "notheld", "420", "https://aufnahmeverfahren.univie.ac.at/en/sociology"],
  ['biology', "Biology", "Biology & Life Sciences", 'BSc', "", "held", "1,030", "https://aufnahmeverfahren.univie.ac.at/en/biology"],
  ['law', "Law", "Law", 'Diploma (Mag. iur.)', "", "held", "1,700", "https://aufnahmeverfahren.univie.ac.at/en/law"],
  ['psychology', "Psychology", "Psychology", 'BSc', "", "held", "485", "https://aufnahmeverfahren.univie.ac.at/en/psychology"],
  ['international-business-administration', "International Business Administration", "Business & Management", 'BSc', "", "held", "1,122 (Business Administration: 449, International Business Administration: 673)", "https://aufnahmeverfahren.univie.ac.at/en/international-business-administration"],
  ['business-informatics', "Business Informatics", "Computer Science; Business & Management", 'BSc', "", "held", "415 (total for Computer Science and Business Informatics)", "https://aufnahmeverfahren.univie.ac.at/en/business-informatics"],
  ['transcultural-communication', "Transcultural Communication", "Languages & Literature", 'BA', "", "notheld", "662", "https://aufnahmeverfahren.univie.ac.at/en/transcultural-communication"],
  ['mathematical-foundations-of-data-science', "Mathematical Foundations of Data Science", "Mathematics; Computer Science", 'BSc', "", "held", "unlimited", "https://aufnahmeverfahren.univie.ac.at/en/mathematical-foundations-of-data-science"],
  ['business-administration', "Business Administration", "Business & Management", 'BSc', "", "held", "1,122 (Business Administration: 449, International Business Administration: 673)", "https://aufnahmeverfahren.univie.ac.at/en/business-administration"],
  ['nutritional-sciences', "Nutritional Sciences", "Biology & Life Sciences; Medicine & Health", 'BSc', "", "notheld", "555", "https://aufnahmeverfahren.univie.ac.at/en/nutritional-sciences"],
  ['social-and-cultural-anthropology', "Social and Cultural Anthropology", "Sociology & Anthropology", 'BA', "", "notheld", "360", "https://aufnahmeverfahren.univie.ac.at/en/social-and-cultural-anthropology"],
  ['korean-studies', "Korean Studies", "Languages & Literature", 'BA', "", "notheld", "54", "https://aufnahmeverfahren.univie.ac.at/en/korean-studies"],
  ['education', "Education", "Education", 'BA', "", "notheld", "500", "https://aufnahmeverfahren.univie.ac.at/en/education"],
];
const PROGS = [];
for (const [id, name, area, degree, latin, test, places, url] of UNIVIE) {
  const f = { degree_type: degree, official_url: url };
  const other = [];
  if (latin) other.push(`Latin: ${latin.replace(/^Latin /, '')}`);
  if (test) {
    f.admission = 'Entrance procedure: register in spring';
    f.application_deadline = '';
    f.deadline_notes = NOTE_2026('registration 2 March to 4 May 2026');
    if (places && places !== 'unlimited') other.push(`${places} places`);
    if (test === 'held') { f.entrance_exam = 'yes'; other.push('Written entrance test (held in July 2026)'); }
    else other.push('Entrance test only if registrations exceed the places; none was held in 2026');
  }
  if (id === 'mathematical-foundations-of-data-science') { f.language = 'English'; }
  if (id === 'english-and-american-studies') { f.language = 'English'; other.push('Taught in English; German C1 still needed for admission'); }
  if (other.length) f.other_requirements = other.join(' · ');
  PROGS.push(P(`univie-${id}`, 'univie', name, area, f));
}

// ---- TU Wien
const TU = 'https://www.tuwien.at/en/studies/studies/bachelor-programmes/';
const tu = (id, name, area, slug, f = {}) => P(`tuwien-${id}`, 'tuwien', name, area, { degree_type: 'BSc', official_url: TU + slug, ...f });
const TU_INF = { admission: 'Two-stage admission procedure with a ranking test', entrance_exam: 'yes', application_deadline: '',
  deadline_notes: NOTE_2026('pre-registration 1 April to 4 May 2026, ranking test 13 July 2026'),
  other_requirements: '670 places shared by Informatics, Business Informatics and Computer Engineering · Online self-assessment' };
PROGS.push(
  // Admission-procedure page (checked 2026-10-30): "a three-stage selection
  // procedure" with a "Ranking test".
  tu('architecture', 'Architecture', 'Architecture', 'architecture', { admission: 'Three-stage selection procedure with a ranking test', entrance_exam: 'yes', application_deadline: '',
    deadline_notes: '2027 dates not published yet.', other_requirements: '625 places' }),
  tu('civil-engineering', 'Civil Engineering', 'Engineering', 'civil-engineering'),
  tu('electrical-engineering', 'Electrical Engineering', 'Engineering', 'electrical-engineering'),
  tu('geodesy', 'Geodesy and Geoinformation', 'Engineering; Environmental Sciences', 'geodesy-and-geoinformation'),
  tu('mechanical-engineering', 'Mechanical Engineering', 'Engineering', 'mechanical-engineering'),
  tu('mechanical-engineering-management', 'Mechanical Engineering – Management', 'Engineering; Business & Management', 'mechanical-engineering-management'),
  tu('spatial-planning', 'Urban and Regional Planning', 'Architecture; Environmental Sciences', 'urban-and-regional-planning',
    // Programme page (checked 2026-10-30): "submit a motivation letter and then
    // participate in a ranking test".
    { admission: 'Admission procedure: motivation letter and a ranking test', entrance_exam: 'yes', application_deadline: '', deadline_notes: '2027 dates not published yet.' }),
  tu('technical-chemistry', 'Technical Chemistry', 'Chemistry', 'technical-chemistry'),
  tu('technical-mathematics', 'Technical Mathematics', 'Mathematics', 'technical-mathematics'),
  tu('technical-physics', 'Technical Physics', 'Physics', 'technical-physics'),
  tu('environmental-engineering', 'Environmental Engineering', 'Engineering; Environmental Sciences', 'environmental-engineering'),
  tu('chemical-process-engineering', 'Chemical and Process Engineering', 'Engineering; Chemistry', 'chemical-and-process-engineering'),
  tu('informatics', 'Informatics', 'Computer Science', 'computer-science-and-business-informatics/informatics', TU_INF),
  tu('business-informatics', 'Business Informatics', 'Computer Science; Business & Management', 'computer-science-and-business-informatics/business-informatics', TU_INF),
  tu('computer-engineering', 'Computer Engineering', 'Computer Science; Engineering', 'computer-science-and-business-informatics/computer-engineering', TU_INF),
);

// ---- WU
PROGS.push(
  P('wu-wiso', 'wu', 'Business, Economics and Social Sciences', 'Business & Management; Economics', {
    degree_type: 'BSc', admission: 'Selection procedure: online self-assessment, then an entrance exam', entrance_exam: 'yes',
    application_deadline: '', deadline_notes: NOTE_2026('registration 2 March to 19 May 2026, entrance exam 30 June 2026'),
    english_requirement: 'German (the WU language page lists accepted proofs)',
    official_url: 'https://www.wu.ac.at/en/studium/bachelor/wirtschafts-und-sozialwissenschaften/overview' }),
  P('wu-bbe', 'wu', 'Business and Economics (BBE)', 'Business & Management; Economics', {
    language: 'English', degree_type: 'BSc', admission: 'Selection procedure with an entrance exam, once a year in spring', entrance_exam: 'yes',
    application_deadline: '', deadline_notes: NOTE_2026('application period 2 March to 19 May 2026'),
    official_url: 'https://www.wu.ac.at/en/programs/bachelors-programs/business-and-economics/overview' }),
);

// ---- English-taught elsewhere
const JKU = 'https://www.jku.at/en/degree-programs/types-of-degree-programs/bachelors-and-diploma-degree-programs/';
const EN = { language: 'English' };
PROGS.push(
  P('jku-artificial-intelligence', 'jku', 'Artificial Intelligence', 'Computer Science', { ...EN, degree_type: 'BSc', official_url: `${JKU}ba-artificial-intelligence/` }),
  P('jku-biological-chemistry', 'jku', 'Biological Chemistry', 'Chemistry; Biology & Life Sciences', { ...EN, degree_type: 'BSc',
    other_requirements: 'Double degree: a Czech Bc. as well as the BSc', official_url: `${JKU}ba-biological-chemistry/` }),
  P('jku-chemistry-technology', 'jku', 'Chemistry and Chemical Technology', 'Chemistry; Engineering', { ...EN, degree_type: 'BSc', official_url: `${JKU}ba-chemistry-and-chemical-technology/` }),
  P('jku-quantum', 'jku', 'Quantum Science and Technology', 'Physics', { ...EN, degree_type: 'BSc', official_url: `${JKU}ba-quantum-science-and-technology/` }),
  P('jku-international-business', 'jku', 'International Business Administration', 'Business & Management', { ...EN, degree_type: 'BSc',
    // Admission page (checked 2026-10-30): an application video, then "an
    // interview" online. Interviews are not exams: no.
    admission: 'Admission procedure (80 places): application video and an online interview', entrance_exam: 'no', english_requirement: 'English C1', application_deadline: '',
    deadline_notes: NOTE_2026('admitted students applied by 10 August 2026'), other_requirements: 'Semester or year abroad is compulsory',
    official_url: `${JKU}ba-international-business-administration/` }),
  P('jku-transformation-studies', 'jku', 'Transformation Studies. Art x Science', 'Art & Design; Environmental Sciences', { ...EN, degree_type: 'BA',
    application_deadline: '', deadline_notes: 'First intake 2027/28; application period January 2027.', official_url: `${JKU}ba-transformation-studies-art-x-science/` }),
);
const AAU = 'https://www.aau.at/en/studien/';
PROGS.push(
  P('klagenfurt-worlds-of-english', 'klagenfurt', 'Worlds of English', 'Languages & Literature', { ...EN, degree_type: 'BA', official_url: `${AAU}bachelor-worlds-of-english/` }),
  P('klagenfurt-international-business', 'klagenfurt', 'International Business and Economics', 'Business & Management; Economics', { ...EN, degree_type: 'BSc',
    // Programme page (checked 2026-10-30): "register, upload a letter of
    // motivation and then you can take the exam"; "The online examination is
    // held in English".
    admission: 'Special admission procedure: motivation letter and an online exam', entrance_exam: 'yes', official_url: `${AAU}bachelor-international-business-and-economics/` }),
  P('klagenfurt-social-sciences', 'klagenfurt', 'Social Sciences', 'Sociology & Anthropology; Politics & International Relations', { ...EN, degree_type: 'BA',
    other_requirements: 'Combination programme: 120 ECTS major plus 60 ECTS minor(s)', official_url: `${AAU}bachelor-social-sciences/` }),
  P('klagenfurt-ice', 'klagenfurt', 'Information and Communications Engineering', 'Engineering; Computer Science', { ...EN, degree_type: 'BSc', official_url: `${AAU}bachelor-information-and-communications-engineering/` }),
  P('klagenfurt-dmc', 'klagenfurt', 'Digital Media, Culture, and Communication (DMC²)', 'Media & Communication', { ...EN, degree_type: 'BA', official_url: `${AAU}bachelor-digital-media-culture-and-communication/` }),
);
const LEO = 'https://www.unileoben.ac.at/en/studying/bachelors-programmes/';
const LEO_F = { ...EN, degree_type: 'BSc', entrance_exam: 'yes', admission: 'Mandatory qualification examination for English-taught programmes' };
PROGS.push(
  P('leoben-circular-engineering', 'leoben', 'Circular Engineering', 'Engineering; Environmental Sciences', { ...LEO_F, other_requirements: '6 semesters plus 1 semester of practice', official_url: `${LEO}processes/circular-engineering-en/` }),
  P('leoben-geoenergy', 'leoben', 'Geoenergy Engineering', 'Engineering', { ...LEO_F, other_requirements: '6 semesters plus 1 semester of practice', official_url: `${LEO}resources/geoenergy-engineering-en/` }),
  P('leoben-new-science-technology', 'leoben', 'New Science and Technology (EURECA-PRO)', 'Engineering; Environmental Sciences', { ...LEO_F, official_url: `${LEO}processes/responsible-consumption-and-production-eureca-pro-en/` }),
);
const CEU_F = { ...EN, application_deadline: '2027-04-15', ib_maths: 'none',
  deadline_notes: 'Rounds close 15 October 2026, 2 February 2027 (last round with CEU financial aid), 15 April 2027 and 15 July 2027 (if places remain).',
  other_requirements: 'Motivation letter, recommendation, CV · Interview for preselected candidates · 3-year Austrian degree or 4-year US-accredited degree' };
PROGS.push(
  P('ceu-ppe', 'ceu', 'Philosophy, Politics and Economics', 'Philosophy; Politics & International Relations; Economics', { ...CEU_F, degree_type: 'BA',
    official_url: 'https://undergraduate.ceu.edu/bachelor-degree-philosophy-politics-economics' }),
  P('ceu-data-science-society', 'ceu', 'Data Science and Society', 'Computer Science; Sociology & Anthropology', { ...CEU_F, degree_type: 'BSc',
    ib_subjects: 'Competitive reference: Maths HL 5 or SL 6 (not a minimum)', official_url: 'https://www.ceu.edu/academics/degrees/ba-data-science-society' }),
  P('ceu-culture-politics-society', 'ceu', 'Culture, Politics and Society', 'Sociology & Anthropology; Politics & International Relations', { ...CEU_F, degree_type: 'BA',
    other_requirements: `${CEU_F.other_requirements} · Essay on today's most important challenge`, official_url: 'https://undergraduate.ceu.edu/bachelor-degree-culture-politics-society' }),
);

// -------------------------------------------------------------------- write
const unis = read(new URL('universities.csv', DATA));
const uniRows = UNIS.map((u) => Object.fromEntries(unis.head.map((h) => [h, u[h] ?? '']))).map((u) => ({ ...u, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const uniIds = new Set(uniRows.map((u) => u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...unis.rows.filter((u) => !uniIds.has(u.university_id)), ...uniRows]);
const progs = read(new URL('programmes.csv', DATA));
for (const p of PROGS) {
  for (const k of Object.keys(p)) if (!progs.head.includes(k)) throw new Error(`${p.programme_id}: unknown column ${k}`);
  if (!uniIds.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university`);
}
const progRows = PROGS.map((p) => Object.fromEntries(progs.head.map((h) => [h, p[h] ?? '']))).map((p) => ({ ...p, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const ids = new Set(progRows.map((p) => p.programme_id));
if (ids.size !== progRows.length) throw new Error('duplicate programme_id');
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((p) => !ids.has(p.programme_id)), ...progRows]);
console.log(`Austria: ${uniRows.length} universities, ${progRows.length} programmes`);
