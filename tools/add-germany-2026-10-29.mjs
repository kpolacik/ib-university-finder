// One-off: add Germany, checked 2026-10-29.
//
//   node tools/add-germany-2026-10-29.mjs
//
// Part 1 — English-taught bachelors at universities. The list is the DAAD's
// International Programmes database (www2.daad.de/…/international-programmes,
// search API: degree Bachelor, language English only, institution type
// "university" — 63 programmes; TUM's two Singapore-campus degrees left
// out). Each row's facts come from its DAAD detail page (application
// periods, fees, admission and language requirements, living costs); the
// official_url is the university's own course page linked from it.
// Part 2 — German-taught bachelors at the best universities, from the
// universities' own lists (see below).
//
// The IB in Germany. KMK, "Vereinbarung über die Anerkennung des
// International Baccalaureate Diploma" (10.03.1986 i. d. F. vom 15.06.2023):
// the six subjects must include "zwei Sprachen auf dem Niveau A oder B (davon
// mindestens eine fortgesetzte Fremdsprache …)", "ein naturwissenschaftliches
// Fach (Biology, Chemistry, Physics)", "Mathematik (Mathematics: Analysis and
// Approaches oder Mathematics: Applications and Interpretation)", "ein
// gesellschaftswissenschaftliches Fach"; one HL must be a language, maths or a
// science (from 2025); "Die geforderten sechs Fächer müssen mindestens mit der
// IB-Note 4 benotet sein" (one 3 can be offset by a 5 at the same level and 24
// points). Footnote 3: with AA SL or AI SL, "kann nur ein fachgebundener
// Hochschulzugang … für Studienfächer, die nicht dem mathematisch-
// naturwissenschaftlich-technischen Bereich zuzuordnen sind, eröffnet
// werden", unless the school is in Annex 1 or 2. The Hessian ministry's 2025
// guide lists those fields (Biologie, Chemie, Informatik, Physik,
// Geowissenschaften, Umweltwissenschaften, Architektur, Maschinenbau,
// Wirtschaftsingenieurwesen, …) and says Medizin, Psychologie,
// Wirtschaftswissenschaften, Rechtswissenschaft etc. are not among them. So
// STEM rows say "Maths HL" (ib_maths AA HL · AI HL); the others accept any
// maths course.
//
// Living costs: each university's figure from its DAAD entry; where none is
// given, the German student-visa amount "992 EUR per month" (Passau, Magdeburg
// on DAAD). Tuition: public universities charge EU students nothing (fees for
// non-EU students in Bavaria and Baden-Württemberg aside); private schools'
// per-semester fees are doubled to a year.
//
// Re-runnable: rows are replaced by id, not appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-29';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const DE = {
  country: 'Germany', application_system: "Direct (the university's portal) or uni-assist",
  living_cost_min: '992', living_cost_source: 'national estimate (German student visa)',
  tuition_eu_default: '0',
  baseline_requirement: 'an IB Diploma meeting the KMK rules: two languages, a science, Maths, a humanities subject, all at 4+',
  admission_default: 'Open admission: meet the requirements, get a place',
};
const L = (min, max = '') => ({ living_cost_min: String(min), living_cost_max: String(max), living_cost_source: "university's estimate" });
const U = (university_id, name, city, extra = {}) => ({ ...DE, university_id, name, city, ...extra });
const UNIS = [
  U('goettingen', 'University of Göttingen', 'Göttingen', L(800, 1000)),
  U('tu-chemnitz', 'Chemnitz University of Technology', 'Chemnitz', L(970)),
  U('passau', 'University of Passau', 'Passau', L(992)),
  U('giessen', 'Justus Liebig University Giessen', 'Gießen'),
  U('tum', 'Technical University of Munich (TUM)', 'Munich'),
  U('regensburg', 'University of Regensburg', 'Regensburg', L(1000)),
  U('potsdam', 'University of Potsdam', 'Potsdam', L(600, 1100)),
  U('btu', 'Brandenburg University of Technology Cottbus-Senftenberg', 'Cottbus', L(780, 1000)),
  U('tu-dortmund', 'TU Dortmund University', 'Dortmund'),
  U('hohenheim', 'University of Hohenheim', 'Stuttgart'),
  U('uni-hamburg', 'University of Hamburg', 'Hamburg', L(900, 1400)),
  U('tuhh', 'Hamburg University of Technology (TUHH)', 'Hamburg', L(1000)),
  U('oldenburg', 'University of Oldenburg', 'Oldenburg', L(1100)),
  U('magdeburg', 'Otto von Guericke University Magdeburg', 'Magdeburg', L(992)),
  U('flensburg', 'Europa-Universität Flensburg', 'Flensburg', L(800, 1000)),
  U('leipzig', 'Leipzig University', 'Leipzig', L(900, 1000)),
  U('kit', 'Karlsruhe Institute of Technology (KIT)', 'Karlsruhe'),
  U('ebs', 'EBS Universität für Wirtschaft und Recht', 'Oestrich-Winkel', { application_system: 'Direct (EBS online application)', admission_default: 'Selective: assessed on your application' }),
  U('whu', 'WHU – Otto Beisheim School of Management', 'Vallendar', { ...L(1200), application_system: 'Direct (WHU online application)', admission_default: 'Selective: assessed on your application' }),
  U('freiburg', 'University of Freiburg', 'Freiburg', L(850, 1000)),
  U('muenster', 'University of Münster', 'Münster', L(1000)),
  U('leuphana', 'Leuphana University Lüneburg', 'Lüneburg', L(900)),
  U('bayreuth', 'University of Bayreuth', 'Bayreuth'),
  U('fau', 'FAU Erlangen-Nürnberg', 'Erlangen'),
  U('hhu', 'Heinrich Heine University Düsseldorf', 'Düsseldorf', L(1000)),
  U('cologne', 'University of Cologne', 'Cologne'),
  U('saarland', 'Saarland University', 'Saarbrücken', L(1000)),
  U('tuebingen', 'University of Tübingen', 'Tübingen', L(1000)),
  U('geisenheim', 'Hochschule Geisenheim University', 'Geisenheim', L(990)),
  U('mainz', 'Johannes Gutenberg University Mainz', 'Mainz'),
  U('bremen', 'University of Bremen', 'Bremen'),
  U('frankfurt-school', 'Frankfurt School of Finance & Management', 'Frankfurt', { application_system: 'Direct (Frankfurt School online application)', admission_default: 'Selective: assessed on your application' }),
  U('wuppertal', 'University of Wuppertal', 'Wuppertal'),
  U('lmu', 'LMU Munich (Ludwig-Maximilians-Universität)', 'Munich'),
  U('heidelberg', 'Heidelberg University', 'Heidelberg'),
  U('rwth', 'RWTH Aachen University', 'Aachen'),
  U('tu-berlin', 'Technische Universität Berlin', 'Berlin'),
  U('fu-berlin', 'Freie Universität Berlin', 'Berlin'),
];

const STEM = { ib_maths: 'AA HL · AI HL', ib_subjects: 'Maths HL (AA or AI); SL only if your school is in the KMK annex' };
const ANY = { ib_maths: 'AA HL · AA SL · AI HL · AI SL', ib_subjects: 'none' };
const JUL15 = { application_deadline: '2027-07-15', deadline_notes: 'Winter semester: apply by 15 July.' };
const NC = 'Restricted places (numerus clausus): ranked on your converted IB grade';
const daad = (id) => `https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/${id}/`;

// Exam values checked 2026-10-30. Regensburg: applicants "who fall within a
// middle range in the first stage … must additionally complete either a
// written aptitude test or a selection interview" (waivable). WHU: the
// admission round "consists of three parts: An analytical test … An assessment
// … One-on-one interviews" (yes). Saarland: "choose one of three application
// tracks" (olympiad, aptitude test, or interview), so the test can be avoided
// (waivable).
// [programme_id, university_id, programme, subject_area, degree, url, stem?, fields]
const EN_ROWS = [
  ['goettingen-intercultural-theology', 'goettingen', 'Intercultural Theology', 'Philosophy', 'BA', 'https://www.uni-goettingen.de/de/695602.html', 0, { ...JUL15, english_requirement: 'English B2' }],
  ['goettingen-ecosystem-sciences', 'goettingen', 'Ecosystem Sciences', 'Environmental Sciences; Biology & Life Sciences', 'BSc', 'https://www.uni-goettingen.de/en/657331.html', 1, { ...JUL15, admission: 'Restricted admission: apply to the university', english_requirement: 'English B2' }],
  ['tu-chemnitz-data-science', 'tu-chemnitz', 'Foundations in Data Science', 'Computer Science; Mathematics', 'BSc', 'https://www.mytuc.org/qbnf', 1, { ...JUL15, english_requirement: 'English B2' }],
  ['passau-mathematics', 'passau', 'Mathematics', 'Mathematics', 'BSc', 'https://www.uni-passau.de/en/bachelors-degrees/mathematics', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 April to 15 July.', english_requirement: 'English B2' }],
  ['passau-ai', 'passau', 'Artificial Intelligence', 'Computer Science', 'BSc', 'https://www.uni-passau.de/en/bsc-artificial-intelligence/', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 April to 15 July.', english_requirement: 'English B2' }],
  ['giessen-environmental-sciences', 'giessen', 'Environmental Sciences', 'Environmental Sciences', 'BSc', 'https://www.uni-giessen.de/en/study/courses/ba/environmental-sciences', 1, { application_deadline: '2027-06-15', deadline_notes: 'International school certificates: 1 May to 15 June.', english_requirement: 'English C1 · German A2' }],
  ['giessen-global-food-systems', 'giessen', 'Global Food Systems', 'Biology & Life Sciences; Environmental Sciences', 'BSc', 'https://www.uni-giessen.de/en/study/courses/ba/global-food-systems', 1, { application_deadline: '2027-06-15', deadline_notes: 'International school certificates: 1 May to 15 June.', english_requirement: 'English C1 · German A2' }],
  ['tum-sustainable-engineering', 'tum', 'Sustainable Engineering for Materials and Processes', 'Engineering; Chemistry', 'BSc', 'https://www.cs.tum.de/en/study/bachelor/sustainable-engineering-for-materials-and-processes', 1, { city: 'Straubing', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', english_requirement: 'English B2 (recommended, no proof needed)' }],
  ['tum-bioeconomy', 'tum', 'Bioeconomy', 'Biology & Life Sciences; Economics', 'BSc', 'https://www.cs.tum.de/en/study/bachelor/bioeconomy', 1, { city: 'Straubing', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', english_requirement: 'English B2' }],
  ['tum-geodesy-earth-observation', 'tum', 'Geodesy and Earth Observation', 'Engineering; Environmental Sciences', 'BSc', 'https://www.ed.tum.de/en/ed/studies/degree-programs/geodesy-and-earth-observation-b-sc/', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', other_requirements: 'Aptitude recommendation (SOV): advice, not a selection' }],
  ['tum-aerospace', 'tum', 'Aerospace', 'Engineering', 'BSc', 'https://www.ed.tum.de/ed/studium/studienangebot/aerospace-b-sc/', 1, { city: 'Garching', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', admission: 'Aptitude assessment procedure', other_requirements: 'Eight-week pre-study internship' }],
  ['tum-management-technology', 'tum', 'Management and Technology', 'Business & Management; Engineering', 'BSc', 'https://www.mgt.tum.de/programs/bachelor-management-technology/munich', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', admission: 'Assessment procedure on your application', other_requirements: 'Letter of motivation', english_requirement: 'English C1 (or German)' }],
  ['tum-management-data-science', 'tum', 'Management & Data Science', 'Business & Management; Computer Science', 'BSc', 'https://www.mgt.tum.de/programs/undergraduate-programs/bachelor-management-data-science/', 1, { city: 'Heilbronn', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', admission: 'Assessment procedure on your application', other_requirements: 'Letter of motivation' }],
  ['tum-sustainable-management-technology', 'tum', 'Sustainable Management & Technology', 'Business & Management; Environmental Sciences', 'BSc', 'https://www.mgt.tum.de/programs/bachelor-in-sustainable-management-technology', 1, { city: 'Straubing', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', admission: 'Aptitude assessment procedure' }],
  ['tum-information-engineering', 'tum', 'Information Engineering', 'Engineering; Computer Science', 'BSc', 'https://www.cit.tum.de/en/cit/studies/degree-programs/bachelor-information-engineering/', 1, { city: 'Heilbronn', application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July.', other_requirements: 'Letter of motivation', english_requirement: 'English B2 · German A2' }],
  ['regensburg-liberal-arts', 'regensburg', 'Liberal Arts: Culture, History, Society', 'Liberal Arts; History', 'BA', 'https://www.uni-regensburg.de/en/philosophie-kunst-geschichte-gesellschaft/institut-fuer-geschichte/lehrstuhl-fuer-europaeische-geschichte-19-und-20-jahrhundert/ba-liberal-arts-culture-history-society', 0, { ...JUL15, admission: 'Aptitude assessment: grades; a middle range takes a written test or an interview', entrance_exam: 'waivable' }],
  ['potsdam-anglophone-postcolonial', 'potsdam', 'Anglophone Postcolonial Studies', 'Languages & Literature', 'BA', 'https://www.uni-potsdam.de/de/studium/studienangebot/bachelor/ein-fach-bachelor/anglophone-postcolonial-studies', 0, { application_deadline: '2027-09-15', deadline_notes: 'Apply 15 August to 15 September.', entrance_exam: 'waivable', other_requirements: "English: the institute's aptitude test, or a certificate instead" }],
  ['btu-environmental-resource-management', 'btu', 'Environmental and Resource Management', 'Environmental Sciences', 'BSc', 'https://www.b-tu.de/en/environment-bs', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 March to 15 July.', english_requirement: 'English B2' }],
  ['btu-life-science-health', 'btu', 'Life Science and International Health', 'Biology & Life Sciences; Medicine & Health', 'BSc', 'https://www.b-tu.de/en/life-science-international-health-bs/page', 1, { city: 'Senftenberg', application_deadline: '2027-07-15', deadline_notes: 'Apply 1 March to 15 July.', english_requirement: 'English B2' }],
  ['tu-dortmund-political-conflict', 'tu-dortmund', 'Political Conflict Studies', 'Politics & International Relations', 'BA', 'https://pcs.ht.tu-dortmund.de/', 0, { application_deadline: '', deadline_notes: 'EU/EEA: from late March until the Friday before lectures start (usually early October).' }],
  ['hohenheim-safs', 'hohenheim', 'Sustainable Agriculture and Food Systems', 'Environmental Sciences; Biology & Life Sciences', 'BSc', 'https://agrar.uni-hohenheim.de/en/bsc-safs', 1, { application_deadline: '2027-07-15', deadline_notes: 'EU applicants: 11 May to 15 July. Non-EU: 4 January to 15 March.', english_requirement: 'English B2 · IELTS 6.5' }],
  ['uni-hamburg-earth-system-physics', 'uni-hamburg', 'Earth System Physics', 'Physics; Environmental Sciences', 'BSc', 'https://www.ifm.uni-hamburg.de/en/education/bsc-earthsystemphysics.html', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 June to 15 July.', english_requirement: 'English B2' }],
  ['tuhh-engineering-science', 'tuhh', 'Engineering Science', 'Engineering', 'BSc', 'https://www.tuhh.de/tuhh/studium/vor-dem-studium/studienangebot/bachelorstudiengaenge/engineering-science.html', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 June to 15 July.', english_requirement: 'English C1' }],
  ['oldenburg-engineering-physics', 'oldenburg', 'Engineering Physics', 'Engineering; Physics', 'BEng', 'https://uol.de/en/physics/studies/courseofstudies/ep', 1, { application_deadline: '2027-10-15', deadline_notes: 'Apply 15 January to 15 October.', english_requirement: 'English B2 · German A2' }],
  ['magdeburg-ibe', 'magdeburg', 'International Business and Economics', 'Business & Management; Economics', 'BSc', 'https://www.isp.ovgu.de/', 0, { application_deadline: '2027-07-15', deadline_notes: 'Apply 15 April to 15 July.', english_requirement: 'English B2 · IELTS 6.5' }],
  ['magdeburg-engineering-science', 'magdeburg', 'Engineering Science', 'Engineering', 'BSc', 'https://www.ovgu.de/unimagdeburg/en/engineering_science_bachelor.html', 1, { ...JUL15, english_requirement: 'English B2 · IELTS 6.5' }],
  ['flensburg-eucs', 'flensburg', 'European Cultures and Society', 'Sociology & Anthropology; Politics & International Relations', 'BA', 'https://www.uni-flensburg.de/eucs/', 0, { application_deadline: '2027-08-15', deadline_notes: 'EU applicants: 15 May to 15 August.', english_requirement: 'English B2 · IELTS 6.5' }],
  ['leipzig-physics', 'leipzig', 'International Physics Studies Programme (Honours)', 'Physics', 'BSc', 'https://www.physes.uni-leipzig.de/studium/studienangebot/bachelor-international-physics-studies-program-honours', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 8 April to 15 July.', english_requirement: 'English B2 · German A1' }],
  ['kit-mechanical-engineering', 'kit', 'Mechanical Engineering (International)', 'Engineering', 'BSc', 'https://www.carlbenzschool.kit.edu/', 1, { tuition_eu: '15402', application_deadline: '2027-04-30', deadline_notes: 'Apply by 30 April. Fee: €7,701 a semester for EU students (€9,201 non-EU).', admission: 'Selected on maths and physics grades (top 80% of your class)', english_requirement: 'English B2 · IELTS 6.5' }],
  ['ebs-business-studies', 'ebs', 'Business Studies', 'Business & Management', 'BSc', 'https://www.ebs.edu/en/ebs-business-school/bachelor-in-business-studies', 0, { tuition_eu: '19460', application_deadline: '2027-06-30', deadline_notes: 'No fixed deadline; EBS recommends applying by 30 June. Fee: €9,730 a semester.', entrance_exam: 'yes', other_requirements: 'Knowledge test (maths and logic) and personality test · CV', english_requirement: 'English B2' }],
  ['ebs-law-politics-economics', 'ebs', 'Law, Politics and Economics', 'Law; Politics & International Relations; Economics', 'BA', 'https://www.ebs.edu/en/ebs-law-school/bachelor-in-law-politics-and-economics', 0, { tuition_eu: '18160', application_deadline: '2027-06-30', deadline_notes: 'No fixed deadline; EBS recommends applying by 30 June. Fee: €9,080 a semester.', entrance_exam: 'yes', other_requirements: 'Knowledge test (maths and logic) and personality test · CV', english_requirement: 'English B2' }],
  ['whu-iba', 'whu', 'International Business Administration', 'Business & Management', 'BSc', 'https://www.whu.edu/en/programs/bachelor-program/bachelor-in-international-business-administration/', 0, { tuition_eu: '18200', application_deadline: '2027-05-15', deadline_notes: 'Rounds close 31 January, 31 March and 15 May 2027. Fee: €9,100 a semester.', entrance_exam: 'yes', other_requirements: 'Motivation letter and CV · Online admission round: analytical test, assessment and interviews · Six-week internship before the start', english_requirement: 'English C1 · IELTS 6.5' }],
  ['freiburg-liberal-arts', 'freiburg', 'Liberal Arts and Sciences (University College Freiburg)', 'Liberal Arts', 'BA/BSc', 'https://uni-freiburg.de/ucf/las/', 0, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 June to 15 July.', admission: 'Selective: about 80 students, on grades, motivation and fit', english_requirement: 'English B2' }],
  ['muenster-human-movement', 'muenster', 'Human Movement in Sports and Exercise', 'Medicine & Health', 'BSc', 'https://www.uni-muenster.de/Sportwissenschaft/studium/studiengaenge/Bachelor_of_Science.html', 0, { application_deadline: '2027-07-15', deadline_notes: 'EU applicants: 1 May to 15 July.' }],
  ['leuphana-digital-media', 'leuphana', 'Digital Media', 'Media & Communication', 'BA', 'https://www.leuphana.de/en/college/bachelor/ba-digital-media.html', 0, { ...JUL15, english_requirement: 'English B2 · IELTS 6.5' }],
  ['leuphana-iba-entrepreneurship', 'leuphana', 'International Business Administration & Entrepreneurship', 'Business & Management', 'BSc', 'https://www.leuphana.de/en/college/bachelor/bsc-international-business-administration-entrepreneurship.html', 0, { ...JUL15, english_requirement: 'English C1 · IELTS 6.5' }],
  ['leuphana-psychology', 'leuphana', 'Psychology', 'Psychology', 'BSc', 'https://www.leuphana.de/en/college/bachelor/psychology-major.html', 0, { ...JUL15, english_requirement: 'English B2 · IELTS 6.5' }],
  ['leuphana-economics', 'leuphana', 'Economics', 'Economics', 'BSc', 'https://www.leuphana.de/en/college/bachelor/economics-major.html', 0, { ...JUL15, english_requirement: 'English B2 · IELTS 6.5' }],
  ['leuphana-studium-individuale', 'leuphana', 'Studium Individuale', 'Liberal Arts', 'BA', 'https://www.leuphana.de/en/college/bachelor/ba-studium-individuale.html', 0, { ...JUL15 }],
  ['leuphana-cultural-studies', 'leuphana', 'Cultural Studies — Organisation, Society, and the Arts', 'Sociology & Anthropology; Art & Design', 'BA', 'https://www.leuphana.de/en/college/bachelor/cultural-studies.html', 0, { ...JUL15 }],
  ['leuphana-environmental-sustainability', 'leuphana', 'Global Environmental and Sustainability Sciences', 'Environmental Sciences', 'BSc', 'https://www.leuphana.de/en/college/bachelor/bsc-global-environmental-and-sustainability-studies.html', 1, { ...JUL15, english_requirement: 'English B2 · IELTS 6.5' }],
  ['bayreuth-african-studies', 'bayreuth', 'African Studies: Language, Arts, Philosophy', 'Languages & Literature; Philosophy', 'BA', 'https://www.uni-bayreuth.de/en/bachelor/african-studies-language-arts-philosophy', 0, { application_deadline: '2027-10-15', deadline_notes: 'EU citizens: 15 April to 15 October.', english_requirement: 'English B2' }],
  ['bayreuth-data-science-ai', 'bayreuth', 'Data, Science and AI', 'Computer Science; Mathematics', 'BA/BSc', 'https://www.uni-bayreuth.de/en/bachelor/data-science-and-ai', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 March to 15 July.', entrance_exam: 'yes', other_requirements: 'TestAS or SAT certificate with a sufficiently high score', english_requirement: 'English B2' }],
  ['fau-international-business', 'fau', 'International Business Studies', 'Business & Management', 'BSc', 'https://www.international-business-economics.wiso.rw.fau.eu/', 0, { city: 'Nürnberg', application_deadline: '2027-07-15', deadline_notes: 'Apply 1 May to 15 July.', admission: NC, english_requirement: 'English B2' }],
  ['fau-international-economics', 'fau', 'International Economic Studies', 'Economics', 'BSc', 'https://www.international-business-economics.wiso.rw.fau.eu/', 0, { city: 'Nürnberg', ...JUL15, admission: NC, english_requirement: 'English B2' }],
  ['fau-clean-energy', 'fau', 'Clean Energy Processes', 'Engineering; Chemistry', 'BSc', 'https://www.cep.study.fau.eu/cep/prospective-students/bachelor/', 1, { application_deadline: '2027-07-15', deadline_notes: 'International applicants: by 15 July.', english_requirement: 'English B2' }],
  ['fau-autonomy-technologies', 'fau', 'Autonomy Technologies', 'Engineering; Computer Science', 'BSc', 'http://www.at.study.fau.eu', 1, { application_deadline: '2027-07-15', deadline_notes: 'International applicants: 15 April to 15 July.', entrance_exam: 'yes', other_requirements: 'Qualification assessment test (English, maths, computer science, physics)', english_requirement: 'English B2' }],
  ['fau-artificial-intelligence', 'fau', 'Artificial Intelligence', 'Computer Science', 'BSc', 'https://www.ai.study.fau.eu/', 1, { application_deadline: '', deadline_notes: 'Opens 15 April; the deadline depends on your applicant group.', other_requirements: 'TestAS certificate for some international applicants', english_requirement: 'English B2' }],
  ['hhu-quantitative-biology', 'hhu', 'Quantitative Biology', 'Biology & Life Sciences', 'BSc', 'https://www.qbio.hhu.de/en', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 May to 15 July: register on Hochschulstart, then apply on HHU\'s portal.', english_requirement: 'English B2' }],
  ['cologne-mess', 'cologne', 'Management, Economics and Social Sciences', 'Business & Management; Economics; Sociology & Anthropology', 'BSc', 'https://wiso.uni-koeln.de/en/studies/bachelor/management-economics-social-sciences', 0, { application_deadline: '2027-07-15', deadline_notes: 'Apply 15 April to 15 July.', admission: 'Ranked on the grades of your school-leaving certificate', english_requirement: 'English B2 · German C1 (DSH-2) as well' }],
  ['saarland-cybersecurity', 'saarland', 'Cybersecurity', 'Computer Science', 'BSc', 'https://cysec.uni-saarland.de/bachelor/cybersecurity', 1, { application_deadline: '2027-07-15', deadline_notes: 'Regular deadline 15 July (interview track 15 June); early admission by 15 January.', admission: 'Competitive: choose one of three application tracks', entrance_exam: 'waivable', other_requirements: 'Olympiad track, aptitude-test track or interview track', english_requirement: 'English C1' }],
  ['saarland-computer-science', 'saarland', 'Computer Science', 'Computer Science', 'BSc', 'https://saarland-informatics-campus.de/en/computerscience-course/', 1, { ...JUL15, admission: 'Competitive: choose one of three application tracks', entrance_exam: 'waivable', other_requirements: 'Olympiad track, aptitude-test track or interview track', english_requirement: 'English B2' }],
  ['tuebingen-computational-linguistics', 'tuebingen', 'Computational Linguistics', 'Languages & Literature; Computer Science', 'BA', 'https://uni-tuebingen.de/en/134560', 0, { application_deadline: '2027-09-15', deadline_notes: 'EU applicants: by 15 September.', english_requirement: 'English B2 · IELTS 6.5' }],
  ['tuebingen-english-american', 'tuebingen', 'English and American Studies', 'Languages & Literature', 'BA', 'https://uni-tuebingen.de/de/86240', 0, { application_deadline: '2027-09-30', deadline_notes: 'EU applicants enrol online by 30 September (major, winter semester only).', english_requirement: 'English B2' }],
  ['geisenheim-wine-business', 'geisenheim', 'International Wine Business', 'Business & Management', 'BSc', 'https://www.hs-geisenheim.de/en/studies/prospective-students/bachelors-programs/international-wine-business-bsc-english-program', 0, { application_deadline: '2027-09-01', deadline_notes: 'Apply by 1 September.', other_requirements: '12-week pre-study internship' }],
  ['mainz-english-literature', 'mainz', 'English Literature and Culture', 'Languages & Literature', 'BA', 'https://www.studium.uni-mainz.de/en/choosing-your-degree-program/courses-offered/english-literature-and-culture-ba/', 0, { application_deadline: '2027-09-01', deadline_notes: 'Apply by 1 September. Foreign certificates need a recognition certificate (up to six weeks).', english_requirement: 'English C1 (placement test or interview)' }],
  ['bremen-natural-sciences-sustainability', 'bremen', 'Natural Sciences for Sustainability', 'Chemistry; Physics; Environmental Sciences', 'BSc', 'https://www.uni-bremen.de/fb1/studium/studiengaenge/natural-sciences-for-sustainability-bsc', 1, { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 May to 15 July.', english_requirement: 'English C1 · IELTS 7' }],
  ['frankfurt-school-business-administration', 'frankfurt-school', 'Business Administration', 'Business & Management', 'BSc', 'https://www.frankfurt-school.de/en/home/programmes/bachelor/bachelor-science/bsc-businessadministration', 0, { tuition_eu: '16400', application_deadline: '2027-06-30', deadline_notes: 'Applications open in September and close at the end of June; rolling decisions. Fee: €8,200 a semester.', entrance_exam: 'yes', other_requirements: 'Online Assessment Centre', english_requirement: 'English B2 · German C1 as well' }],
  ['frankfurt-school-mpe', 'frankfurt-school', 'Management, Philosophy & Economics', 'Business & Management; Philosophy; Economics', 'BSc', 'https://www.frankfurt-school.de/en/home/programmes/bachelor/bachelor-science/bsc-managementphilosophyeconomics', 0, { tuition_eu: '16400', application_deadline: '2027-06-30', deadline_notes: 'Applications open in September and close at the end of June; rolling decisions. Fee: €8,200 a semester.', entrance_exam: 'yes', other_requirements: 'Online Assessment Centre' }],
  ['frankfurt-school-business-analytics', 'frankfurt-school', 'Computational Business Analytics', 'Business & Management; Computer Science', 'BSc', 'https://www.frankfurt-school.de/en/study/bachelor/bachelor-science/bachelor-computational-business-analytics', 0, { tuition_eu: '16400', application_deadline: '2027-06-30', deadline_notes: 'Applications open in September and close at the end of June; rolling decisions. Fee: €8,200 a semester.', entrance_exam: 'yes', other_requirements: 'Online Assessment Centre' }],
  ['wuppertal-sustainable-chemistry', 'wuppertal', 'Sustainable Chemistry', 'Chemistry', 'BSc', 'https://www.chemie.uni-wuppertal.de/en/studium/studiengaenge/sustainable-chemistry-bachelor/', 1, { application_deadline: '2027-07-15', deadline_notes: 'Non-German school certificates: 15 May to 15 July. No admission restriction.', english_requirement: 'English B2' }],
];

const PROGS = EN_ROWS.map(([programme_id, university_id, programme, subject_area, degree_type, official_url, stem, f]) => ({
  programme_id, university_id, programme, subject_area, degree_type, official_url, language: 'English', entrance_exam: 'no',
  ...(stem ? STEM : ANY), ...f,
}));

// -------------------------------------------------------------- part 2: German-taught
// "The best universities": TUM, LMU Munich and Heidelberg (Germany's
// Excellence universities that top the national rankings). German-taught
// bachelors need German at about C1 before enrolment.

// TUM. tum.de/en/studies/degree-programs, each programme's page (checked
// 2026-10-29): "Application period Winter semester: 15.05. – 15.07." (15.09.
// for the unrestricted Weihenstephan programmes, but "Applicants with
// international university entrance qualification must have applied for the
// preliminary documentation (VPD) via uni-assist by 15.07."); every page:
// "please be sure to complete the application for your VPD Certificate before
// 15.07. … and submit proof of your German language proficiency before the
// application deadline". Aptitude assessment: "Depending on the amount of
// points accumulated, applicants are either immediately admitted, rejected or
// invited to an admissions interview" (or "to take a written test" for
// Informatics and Information Systems, "an online test" for Nutrition and
// Molecular Biotechnology); Architecture: "you will be invited to a mandatory
// written test". Left out: Bioeconomics ("being transitioned … New
// applications are only possible for Bioeconomy"), Games Engineering and TUM
// BWL Heilbronn (no new enrolment), Bioinformatics (joint with LMU, listed
// there), Management and Technology (already in part 1), the Singapore and
// Salzburg degrees.
const TUM_DE = 'German C1: DSH-2, TestDaF 4 in all parts, or telc C1 Hochschule (proof due by the application deadline)';
const TUM_DL = { application_deadline: '2027-07-15', deadline_notes: 'Apply 15 May to 15 July. Foreign school certificates also need uni-assist preliminary documentation (VPD), applied for by 15 July.' };
const TUM_DL_WEI = { application_deadline: '2027-07-15', deadline_notes: "TUM's window runs 15 May to 15 September, but with a foreign school certificate the uni-assist preliminary documentation (VPD) must be applied for by 15 July." };
const TUM_APT = 'Aptitude assessment: points for school grades; top scorers admitted directly, others interviewed or rejected';
const TUM_APT_TEST = 'Aptitude assessment: points for school grades; top scorers admitted directly, others take a test or are rejected';
const TUM_SOV = 'Open admission after a compulsory online self-assessment (SOV), which is advice only';
const tumUrl = (slug) => `https://www.tum.de/en/studies/degree-programs/detail/${slug}`;
// [slug, id, programme, area, degree, stem, city, admission-or-null, exam, extra]
const TUM_DE_ROWS = [
  ['agricultural-and-horticultural-sciences-bachelor-of-science-bsc', 'agricultural-horticultural-sciences', 'Agricultural and Horticultural Sciences', 'Biology & Life Sciences; Environmental Sciences', 'BSc', 1, 'Freising', null, 'no', TUM_DL_WEI],
  ['architecture-bachelor-of-arts-ba', 'architecture', 'Architecture', 'Architecture', 'BA', 1, 'Munich', 'Aptitude assessment: school grade (50%) and a compulsory written test (50%)', 'yes', TUM_DL],
  ['biochemistry-bachelor-of-science-bsc', 'biochemistry', 'Biochemistry', 'Chemistry; Biology & Life Sciences', 'BSc', 1, 'Garching', TUM_APT, 'no', { ...TUM_DL, other_requirements: 'Non-native speakers with a foreign school certificate always have an admissions interview' }],
  ['biogenic-materials-bachelor-of-science-bsc', 'biogenic-materials', 'Biogenic Materials', 'Engineering; Chemistry', 'BSc', 1, 'Straubing', null, 'no', TUM_DL],
  ['brewing-and-beverage-technology-bachelor-of-science-bsc', 'brewing-beverage-technology', 'Brewing and Beverage Technology', 'Engineering; Biology & Life Sciences', 'BSc', 1, 'Freising', null, 'no', TUM_DL_WEI],
  ['chemical-biotechnology-bachelor-of-science-bsc', 'chemical-biotechnology', 'Chemical Biotechnology', 'Chemistry; Biology & Life Sciences', 'BSc', 1, 'Straubing', null, 'no', TUM_DL],
  ['chemical-engineering-bachelor-of-science-bsc', 'chemical-engineering', 'Chemical Engineering', 'Engineering; Chemistry', 'BSc', 1, 'Garching', TUM_APT, 'no', TUM_DL],
  ['chemistry-bachelor-of-science-bsc', 'chemistry', 'Chemistry', 'Chemistry', 'BSc', 1, 'Garching', TUM_SOV, 'no', TUM_DL],
  ['civil-engineering-bachelor-of-science-bsc', 'civil-engineering', 'Civil Engineering', 'Engineering', 'BSc', 1, 'Munich', null, 'no', { ...TUM_DL, other_requirements: 'Six-week pre-study internship' }],
  ['electrical-engineering-and-information-technology-bachelor-of-science-bsc', 'electrical-engineering', 'Electrical Engineering and Information Technology', 'Engineering', 'BSc', 1, 'Munich', null, 'no', TUM_DL],
  ['engineering-science-bachelor-of-science-bsc', 'engineering-science', 'Engineering Science', 'Engineering', 'BSc', 1, 'Garching', TUM_APT, 'no', TUM_DL],
  ['environmental-engineering-bachelor-of-science-bsc', 'environmental-engineering', 'Environmental Engineering', 'Engineering; Environmental Sciences', 'BSc', 1, 'Munich', null, 'no', { ...TUM_DL, other_requirements: 'Six-week pre-study internship' }],
  ['food-chemistry-bachelor-of-science-bsc', 'food-chemistry', 'Food Chemistry', 'Chemistry', 'BSc', 1, 'Freising', TUM_SOV, 'no', TUM_DL],
  ['food-technology-bachelor-of-science-bsc', 'food-technology', 'Food Technology', 'Engineering; Biology & Life Sciences', 'BSc', 1, 'Freising', null, 'no', TUM_DL_WEI],
  ['forest-science-and-resource-management-bachelor-of-science-bsc', 'forest-science', 'Forest Science and Resource Management', 'Environmental Sciences', 'BSc', 1, 'Freising', null, 'no', TUM_DL_WEI],
  ['geodesy-and-geoinformation-bachelor-of-science-bsc', 'geodesy-geoinformation', 'Geodesy and Geoinformation', 'Engineering; Environmental Sciences', 'BSc', 1, 'Munich', null, 'no', TUM_DL],
  ['geosciences-bachelor-of-science-bsc', 'geosciences', 'Geosciences', 'Environmental Sciences', 'BSc', 1, 'Munich', null, 'no', TUM_DL],
  ['health-sciences-bachelor-of-science-bsc', 'health-sciences', 'Health Sciences', 'Medicine & Health', 'BSc', 0, 'Munich', TUM_APT, 'no', TUM_DL],
  ['informatics-bachelor-of-science-bsc', 'informatics', 'Informatics', 'Computer Science', 'BSc', 1, 'Garching', TUM_APT_TEST, 'waivable', TUM_DL],
  ['information-systems-bachelor-of-science-bsc', 'information-systems', 'Information Systems', 'Computer Science; Business & Management', 'BSc', 1, 'Garching', TUM_APT_TEST, 'waivable', TUM_DL],
  ['landscape-architecture-and-landscape-planning-bachelor-of-science-bsc', 'landscape-architecture', 'Landscape Architecture and Landscape Planning', 'Architecture; Environmental Sciences', 'BSc', 1, 'Munich', TUM_APT, 'no', TUM_DL],
  ['life-sciences-biology-bachelor-of-science-bsc', 'life-sciences-biology', 'Life Sciences Biology', 'Biology & Life Sciences', 'BSc', 1, 'Freising', TUM_SOV, 'no', TUM_DL],
  ['life-sciences-nutrition-bachelor-of-science-bsc', 'life-sciences-nutrition', 'Life Sciences Nutrition', 'Biology & Life Sciences; Medicine & Health', 'BSc', 1, 'Freising', TUM_APT_TEST, 'waivable', TUM_DL],
  ['mathematics-bachelor-of-science-bsc', 'mathematics', 'Mathematics', 'Mathematics', 'BSc', 1, 'Garching', TUM_SOV, 'no', TUM_DL],
  ['mechanical-engineering-bachelor-of-science-bsc', 'mechanical-engineering', 'Mechanical Engineering', 'Engineering', 'BSc', 1, 'Garching', TUM_APT, 'no', { ...TUM_DL, other_requirements: 'Eight-week manufacturing internship, ideally before the start' }],
  ['molecular-biotechnology-bachelor-of-science-bsc', 'molecular-biotechnology', 'Molecular Biotechnology', 'Biology & Life Sciences', 'BSc', 1, 'Freising', TUM_APT_TEST, 'waivable', TUM_DL],
  ['pharmaceutical-bioprocess-engineering-bachelor-of-science-bsc', 'pharmaceutical-bioprocess-engineering', 'Pharmaceutical Bioprocess Engineering', 'Engineering; Biology & Life Sciences', 'BSc', 1, 'Freising', null, 'no', TUM_DL_WEI],
  ['physics-bachelor-of-science-bsc', 'physics', 'Physics', 'Physics', 'BSc', 1, 'Garching', null, 'no', TUM_DL],
  ['political-science-bachelor-of-science-bsc', 'political-science', 'Political Science', 'Politics & International Relations', 'BSc', 0, 'Munich', 'Aptitude assessment: points for school grades; top scorers admitted directly, others interviewed', 'no', TUM_DL],
  ['sport-science-bachelor-of-science-bsc', 'sport-science', 'Sport Science', 'Medicine & Health', 'BSc', 0, 'Munich', 'Aptitude assessment: points for school grades; top scorers admitted directly, others interviewed', 'no', TUM_DL],
  ['technology-of-biogenic-resources-bachelor-of-science-bsc', 'technology-biogenic-resources', 'Technology of Biogenic Resources', 'Engineering; Environmental Sciences', 'BSc', 1, 'Straubing', null, 'no', TUM_DL],
];
for (const [slug, id, programme, subject_area, degree_type, stem, city, admission, entrance_exam, f] of TUM_DE_ROWS) {
  PROGS.push({ programme_id: `tum-${id}-de`, university_id: 'tum', city, programme, subject_area, degree_type, official_url: tumUrl(slug),
    language: 'German', entrance_exam, english_requirement: TUM_DE, ...(admission ? { admission } : {}), ...(stem ? STEM : ANY), ...f });
}

// LMU Munich. The LMU-Studiengangsfinder (lmu.de/de/studium/studienangebot/
// alle-studienfaecher-und-studiengaenge), all "Bachelor / Hauptfach" entries
// with their "Zulassungsmodus". "Studiengänge nach Zulassungsbedingungen":
// local NC programmes — apply "bis spätestens 15. Juli" (through
// hochschulstart.de's DoSV); places go on "Durchschnittsnote der
// Hochschulzugangsberechtigung, bei Psychologie Bachelor zusätzlich das
// Ergebnis des Studieneignungstests BaPsy-DGPs" (optional, so no exam);
// "Nicht-EU-Bürgerinnen und -Bürger müssen sich über das International Office
// bewerben". Unrestricted programmes need no application for German
// applicants; with a foreign school certificate the International Office's
// application (15 July for winter) applies. Anglistik, Kunst und Multimedia
// and Kunstpädagogik have an aptitude procedure (Eignungsverfahren) whose form
// is not yet checked, so their exam stays "?". German: DSH-2 or equivalent.
// Duplicates left out: Archäologie 120 ECTS (180 kept), Informatik mit
// Nebenfach 30 ECTS (60 kept), the PIR Modellstudiengang, Wirtschaftspädagogik II.
const LMU_DE = 'German C1: DSH-2 or equivalent (Goethe C2, TestDaF 4 in all parts)';
const LMU_DL = { application_deadline: '2027-07-15', deadline_notes: 'Foreign school certificates: apply through the International Office by 15 July.' };
const LMU_NC_DL = { application_deadline: '2027-07-15', deadline_notes: 'Apply by 15 July: register on hochschulstart.de (DoSV), then apply to LMU. Non-EU applicants apply through the International Office.' };
const lmuUrl = (slug) => `https://www.lmu.de/de/studium/studienangebot/alle-studienfaecher-und-studiengaenge/${slug}.html`;
// [slug, id, programme, area, degree, stem, nc?, exam]
const LMU_ROWS = [
  ['aegyptologie-und-koptologie-bachelor-hauptfach-2830', 'egyptology', 'Ägyptologie und Koptologie (Egyptology and Coptic Studies)', 'History', 'BA', 0, 0],
  ['allgemeine-und-vergleichende-literaturwissenschaft-bachelor-hauptfach-2836', 'comparative-literature', 'Allgemeine und Vergleichende Literaturwissenschaft (Comparative Literature)', 'Languages & Literature', 'BA', 0, 0],
  ['alter-orient-bachelor-hauptfach-2838', 'ancient-near-east', 'Alter Orient (Ancient Near East)', 'History', 'BA', 0, 0],
  // Institute's EFV page (checked 2026-10-30): "Das Eignungsfeststellungsverfahren
  // berücksichtigt die Durchschnittsnote im Abitur und das Ergebnis eines
  // schriftlichen Sprachtests" (yes).
  ['anglistik-bachelor-hauptfach-2839', 'english-studies', 'Anglistik (English Studies)', 'Languages & Literature', 'BA', 0, 0, 'yes'],
  ['archaeologie-europa-und-vorderer-orient-180-ects-bachelor-hauptfach-2842', 'archaeology', 'Archäologie: Europa und Vorderer Orient (Archaeology)', 'History', 'BA', 0, 0],
  ['betriebswirtschaftslehre-bachelor-hauptfach-2848', 'business-administration', 'Betriebswirtschaftslehre (Business Administration)', 'Business & Management', 'BSc', 0, 1],
  ['bioinformatik-bachelor-hauptfach-2855', 'bioinformatics', 'Bioinformatik (Bioinformatics, with TUM)', 'Computer Science; Biology & Life Sciences', 'BSc', 1, 1],
  ['biologie-bachelor-hauptfach-2857', 'biology', 'Biologie (Biology)', 'Biology & Life Sciences', 'BSc', 1, 0],
  ['buchwissenschaft-bachelor-hauptfach-2862', 'book-studies', 'Buchwissenschaft (Book Studies)', 'Media & Communication', 'BA', 0, 0],
  ['buddhistische-und-suedasiatische-studien-bachelor-hauptfach-2865', 'buddhist-south-asian-studies', 'Buddhistische und Südasiatische Studien (Buddhist and South Asian Studies)', 'Philosophy; Languages & Literature', 'BA', 0, 0],
  ['chemie-und-biochemie-bachelor-hauptfach-2870', 'chemistry-biochemistry', 'Chemie und Biochemie (Chemistry and Biochemistry)', 'Chemistry', 'BSc', 1, 0],
  ['classical-studies-bachelor-hauptfach-2871', 'classical-studies', 'Classical Studies', 'History; Languages & Literature', 'BA', 0, 0],
  ['computerlinguistik-bachelor-hauptfach-2872', 'computational-linguistics', 'Computerlinguistik (Computational Linguistics)', 'Computer Science; Languages & Literature', 'BSc', 1, 0],
  ['deutsch-als-fremdsprache-bachelor-hauptfach-2875', 'german-foreign-language', 'Deutsch als Fremdsprache (German as a Foreign Language)', 'Languages & Literature; Education', 'BA', 0, 0],
  ['empirische-kulturwissenschaft-und-europaeische-ethnologie-bachelor-hauptfach-2884', 'european-ethnology', 'Empirische Kulturwissenschaft und Europäische Ethnologie (European Ethnology)', 'Sociology & Anthropology', 'BA', 0, 0],
  ['ethnologie-bachelor-hauptfach-2882', 'social-anthropology', 'Ethnologie (Social and Cultural Anthropology)', 'Sociology & Anthropology', 'BA', 0, 0],
  ['finnougristik-bachelor-hauptfach-2889', 'finno-ugric-studies', 'Finnougristik (Finno-Ugric Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['geographie-bachelor-hauptfach-2891', 'geography', 'Geographie (Geography)', 'Environmental Sciences', 'BSc', 1, 1],
  ['geowissenschaften-bachelor-hauptfach-2895', 'geosciences', 'Geowissenschaften (Geosciences)', 'Environmental Sciences', 'BSc', 1, 0],
  ['germanistik-bachelor-hauptfach-2903', 'german-studies', 'Germanistik (German Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['geschichte-bachelor-hauptfach-2905', 'history', 'Geschichte (History)', 'History', 'BA', 0, 0],
  ['griechische-philologie-bachelor-hauptfach-2908', 'greek-philology', 'Griechische Philologie (Greek Philology)', 'Languages & Literature; History', 'BA', 0, 0],
  ['griechische-studien-bachelor-hauptfach-2910', 'greek-studies', 'Griechische Studien (Greek Studies)', 'Languages & Literature; History', 'BA', 0, 0],
  ['historische-und-allgemeine-sprachwissenschaft-bachelor-hauptfach-2833', 'linguistics', 'Historische und Allgemeine Sprachwissenschaft (Linguistics)', 'Languages & Literature', 'BA', 0, 0],
  ['informatik-bachelor-mit-nebenfach-60-ects-bachelor-hauptfach-2916', 'computer-science', 'Informatik (Computer Science, with a minor)', 'Computer Science', 'BSc', 1, 1],
  ['informatik-mit-integriertem-anwendungsfach-bachelor-hauptfach-26048', 'computer-science-applied', 'Informatik mit integriertem Anwendungsfach (Computer Science with an applied subject)', 'Computer Science', 'BSc', 1, 1],
  ['italianistik-bachelor-hauptfach-2921', 'italian-studies', 'Italianistik (Italian Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['japanologie-bachelor-hauptfach-2923', 'japanese-studies', 'Japanologie (Japanese Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['kommunikationswissenschaft-bachelor-hauptfach-2928', 'communication-science', 'Kommunikationswissenschaft (Communication Science)', 'Media & Communication', 'BA', 0, 1],
  ['kunst-und-multimedia-bachelor-hauptfach-2933', 'art-multimedia', 'Kunst und Multimedia (Art and Multimedia)', 'Art & Design', 'BA', 0, 0, '?'],
  ['kunstgeschichte-bachelor-hauptfach-2931', 'art-history', 'Kunstgeschichte (Art History)', 'Art & Design; History', 'BA', 0, 0],
  ['kunstpaedagogik-bachelor-hauptfach-2935', 'art-education', 'Kunstpädagogik (Art Education)', 'Art & Design; Education', 'BA', 0, 0, '?'],
  ['latinistik-bachelor-hauptfach-2936', 'latin-studies', 'Latinistik (Latin Studies)', 'Languages & Literature; History', 'BA', 0, 0],
  ['mathematik-bachelor-hauptfach-2940', 'mathematics', 'Mathematik (Mathematics)', 'Mathematics', 'BSc', 1, 0],
  ['medieninformatik-bachelor-hauptfach-2942', 'media-informatics', 'Medieninformatik (Media Informatics)', 'Computer Science; Media & Communication', 'BSc', 1, 1],
  ['medienkulturwissenschaft-bachelor-hauptfach-27648', 'media-culture', 'Medienkulturwissenschaft (Media and Cultural Studies)', 'Media & Communication', 'BA', 0, 1],
  ['musikwissenschaft-bachelor-hauptfach-2953', 'musicology', 'Musikwissenschaft (Musicology)', 'Art & Design', 'BA', 0, 0],
  ['naher-und-mittlerer-osten-bachelor-hauptfach-2955', 'near-middle-east', 'Naher und Mittlerer Osten (Near and Middle Eastern Studies)', 'Languages & Literature; History', 'BA', 0, 0],
  ['nordamerikastudien-bachelor-hauptfach-2960', 'north-american-studies', 'Nordamerikastudien (North American Studies)', 'Languages & Literature; History', 'BA', 0, 0],
  ['paedagogik-bildungswissenschaft-bachelor-hauptfach-2964', 'education', 'Pädagogik / Bildungswissenschaft (Education)', 'Education', 'BA', 0, 0],
  ['pharmaceutical-sciences-bachelor-hauptfach-2967', 'pharmaceutical-sciences', 'Pharmaceutical Sciences', 'Chemistry; Medicine & Health', 'BSc', 1, 1],
  ['philosophie-bachelor-hauptfach-2969', 'philosophy', 'Philosophie (Philosophy)', 'Philosophy', 'BA', 0, 0],
  ['phonetik-und-sprachverarbeitung-bachelor-hauptfach-2975', 'phonetics', 'Phonetik und Sprachverarbeitung (Phonetics and Speech Processing)', 'Languages & Literature', 'BA', 0, 0],
  ['physik-bachelor-hauptfach-3840', 'physics', 'Physik (Physics)', 'Physics', 'BSc', 1, 0],
  ['physik-plus-meteorologie-bachelor-hauptfach-3841', 'physics-meteorology', 'Physik plus Meteorologie (Physics plus Meteorology)', 'Physics; Environmental Sciences', 'BSc', 1, 0],
  ['politikwissenschaft-bachelor-hauptfach-2986', 'political-science', 'Politikwissenschaft (Political Science)', 'Politics & International Relations', 'BA', 0, 0],
  ['psychologie-bachelor-hauptfach-2991', 'psychology', 'Psychologie (Psychology)', 'Psychology', 'BSc', 0, 1],
  ['romanistik-bachelor-hauptfach-3002', 'romance-studies', 'Romanistik (Romance Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['sinologie-bachelor-hauptfach-3004', 'chinese-studies', 'Sinologie (Chinese Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['skandinavistik-bachelor-hauptfach-3007', 'scandinavian-studies', 'Skandinavistik (Scandinavian Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['slavistik-bachelor-hauptfach-3010', 'slavic-studies', 'Slavistik (Slavic Studies)', 'Languages & Literature', 'BA', 0, 0],
  ['soziologie-bachelor-hauptfach-3013', 'sociology', 'Soziologie (Sociology)', 'Sociology & Anthropology', 'BA', 0, 0],
  ['sprachtherapie-bachelor-hauptfach-3017', 'speech-therapy', 'Sprachtherapie (Speech and Language Therapy)', 'Medicine & Health; Education', 'BA', 0, 1],
  ['statistik-und-data-science-bachelor-hauptfach-3019', 'statistics-data-science', 'Statistik und Data Science (Statistics and Data Science)', 'Mathematics; Computer Science', 'BSc', 1, 0],
  ['theaterwissenschaft-bachelor-hauptfach-3024', 'theatre-studies', 'Theaterwissenschaft (Theatre Studies)', 'Art & Design', 'BA', 0, 0],
  ['volkswirtschaftslehre-bachelor-hauptfach-3027', 'economics', 'Volkswirtschaftslehre (Economics)', 'Economics', 'BSc', 0, 0],
  ['wirtschaftsmathematik-bachelor-hauptfach-3036', 'business-mathematics', 'Wirtschaftsmathematik (Business Mathematics)', 'Mathematics; Economics', 'BSc', 1, 0],
  ['wirtschaftspaedagogik-wirtschaftspaedagogik-i-bachelor-hauptfach-3031', 'business-education', 'Wirtschaftspädagogik (Business Education)', 'Education; Business & Management', 'BSc', 0, 1],
];
for (const [slug, id, programme, subject_area, degree_type, stem, nc, exam] of LMU_ROWS) {
  const aptitude = exam === '?';
  PROGS.push({ programme_id: `lmu-${id}`, university_id: 'lmu', programme, subject_area, degree_type, official_url: lmuUrl(slug),
    language: 'German', entrance_exam: exam ?? 'no', english_requirement: LMU_DE, ...(stem ? STEM : ANY),
    ...(nc ? { admission: NC, ...LMU_NC_DL } : LMU_DL),
    ...(aptitude ? { admission: 'Aptitude procedure (Eignungsverfahren) run by the department' } : {}),
    ...(id === 'english-studies' ? { admission: 'Aptitude procedure: Abitur grade and a written language test (apply to the institute by 15 July)' } : {}),
    ...(id === 'psychology' ? { other_requirements: 'Optional BaPsy-DGPs aptitude test can improve your ranking' } : {}),
    ...(id === 'education' ? { other_requirements: 'Compulsory study-orientation procedure with the department by 15 July' } : {}) });
}

// Heidelberg. uni-heidelberg.de/de/studium/alle-studienfaecher, one page per
// subject (the 100% single-subject bachelor where offered, else 75%, else
// 50%): "Lehrsprache(n)", "Bewerbungsverfahren". Deadlines, "Bewerbungsfristen
// für das 1. Fachsemester grundständiger Studiengänge": "ohne
// Zulassungsbeschränkung und ohne Aufnahmeprüfung 01.06. – 31.10."; "mit
// Zulassungsbeschränkung (Universitätsinternes Auswahlverfahren, DOSV) oder
// mit Aufnahmeprüfung 01.06. - 15.07.". German, "Sprachanforderungen für
// deutschsprachige Studiengänge": "In der Regel … DSH 2 … zum Zeitpunkt der
// Immatrikulation"; accepted: DSD II, DSH-2, Goethe C2, TestDaF "in allen
// Teilprüfungen mindestens mit dem Ergebnis TDN 4", telc C1 Hochschule, ÖSD
// C2, the bilingual IB (GIB); "Bachelor Molekulare Biotechnologie" needs it at
// application, "Germanistik im Kulturvergleich" a higher level. The
// "Aufnahmeprüfungsverfahren" (Chemie, English Studies, Informatik, Physik)
// is not described on the pages, so their exam stays "?"; Sportwissenschaft
// has a "Sporteingangsprüfung". 50% and 75% bachelors are combined with other
// subjects. Left out: Interprofessionelle Gesundheitsversorgung and
// Physiotherapiewissenschaft (for trained health professionals).
const HD_DE = 'German C1: DSH-2, TestDaF 4 in all parts, Goethe C2, telc C1 Hochschule or DSD II (by enrolment)';
const HD_OPEN = { application_deadline: '2027-10-31', deadline_notes: 'Unrestricted: apply 1 June to 31 October.' };
const HD_SEL = { application_deadline: '2027-07-15', deadline_notes: 'Apply 1 June to 15 July.' };
const hdUrl = (path) => `https://www.uni-heidelberg.de/de/studium/alle-studienfaecher/${path}`;
// [path, id, programme, area, degree, stem, kind (open | nc | sel | exam), share]
const HD_ROWS = [
  ['aegyptologie/aegyptologie-bachelor-50', 'egyptology', 'Ägyptologie (Egyptology)', 'History', 'BA', 0, 'open', 50],
  ['alte-geschichte/alte-geschichte-bachelor-50', 'ancient-history', 'Alte Geschichte (Ancient History)', 'History', 'BA', 0, 'open', 50],
  ['american-studies/american-studies-bachelor-100', 'american-studies', 'American Studies', 'Languages & Literature; History', 'BA', 0, 'open', 100],
  ['assyriologie/assyriologie-bachelor-75', 'assyriology', 'Assyriologie (Assyriology)', 'History', 'BA', 0, 'open', 75],
  ['bildungswissenschaft/bildungswissenschaft-bachelor-75', 'education', 'Bildungswissenschaft (Educational Science)', 'Education', 'BA', 0, 'open', 75],
  ['biochemie/biochemie-bachelor-100', 'biochemistry', 'Biochemie (Biochemistry)', 'Chemistry; Biology & Life Sciences', 'BSc', 1, 'nc', 100],
  ['biologie/biologie-bachelor-50', 'biology', 'Biologie (Biology)', 'Biology & Life Sciences', 'BSc', 1, 'sel', 50],
  ['biowissenschaften/biowissenschaften-bachelor-100', 'biosciences', 'Biowissenschaften (Biosciences)', 'Biology & Life Sciences', 'BSc', 1, 'nc', 100],
  ['byzantinische-archaeologie-und-kunstgeschichte/byzantinische-archaeologie-und-kunstgeschichte-bachelor-50', 'byzantine-archaeology', 'Byzantinische Archäologie und Kunstgeschichte (Byzantine Archaeology and Art History)', 'History; Art & Design', 'BA', 0, 'open', 50],
  ['chemie/chemie-bachelor-100', 'chemistry', 'Chemie (Chemistry)', 'Chemistry', 'BSc', 1, 'interview', 100],
  ['christentum-und-kultur/christentum-und-kultur-bachelor-50', 'christianity-culture', 'Christentum und Kultur (Christianity and Culture)', 'Philosophy', 'BA', 0, 'open', 50],
  ['computerlinguistik/computerlinguistik-bachelor-100', 'computational-linguistics', 'Computerlinguistik (Computational Linguistics)', 'Computer Science; Languages & Literature', 'BA', 1, 'open', 100],
  ['english-studiesanglistik/english-studiesanglistik-bachelor-75', 'english-studies', 'English Studies / Anglistik', 'Languages & Literature', 'BA', 0, 'test', 75],
  ['ethnologie/ethnologie-bachelor-75', 'anthropology', 'Ethnologie (Anthropology)', 'Sociology & Anthropology', 'BA', 0, 'open', 75],
  ['europaeische-kunstgeschichte/europaeische-kunstgeschichte-bachelor-75', 'art-history', 'Europäische Kunstgeschichte (European Art History)', 'Art & Design; History', 'BA', 0, 'open', 75],
  ['evangelische-theologie/evangelische-theologie-bachelor-50', 'protestant-theology', 'Evangelische Theologie (Protestant Theology)', 'Philosophy', 'BA', 0, 'open', 50],
  ['franzoesisch-romanistik/franzoesischromanistik-bachelor-50', 'french', 'Französisch / Romanistik (French Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['geographie/geographie-bachelor-100', 'geography', 'Geographie (Geography)', 'Environmental Sciences', 'BSc', 1, 'open', 100],
  ['geowissenschaften/geowissenschaften-bachelor-100', 'geosciences', 'Geowissenschaften (Geosciences)', 'Environmental Sciences', 'BSc', 1, 'open', 100],
  ['germanistik-im-kulturvergleich/germanistik-im-kulturvergleich-bachelor-75', 'german-intercultural', 'Germanistik im Kulturvergleich (German Studies in Cultural Comparison)', 'Languages & Literature', 'BA', 0, 'open', 75],
  ['germanistikdeutsch/germanistik-bachelor-50', 'german-studies', 'Germanistik / Deutsch (German Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['geschichte/geschichte-bachelor-75', 'history', 'Geschichte (History)', 'History', 'BA', 0, 'open', 75],
  ['informatik/informatik-bachelor-100', 'computer-science', 'Informatik (Computer Science)', 'Computer Science', 'BSc', 1, 'interview', 100],
  ['islamwissenschaft/islamwissenschaft-bachelor-75', 'islamic-studies', 'Islamwissenschaft (Islamic Studies)', 'Languages & Literature; History', 'BA', 0, 'open', 75],
  ['italienisch-romanistik/italienischromanistik-bachelor-50', 'italian', 'Italienisch / Romanistik (Italian Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['juedische-studien/juedische-studien-bachelor-75', 'jewish-studies', 'Jüdische Studien (Jewish Studies)', 'History; Philosophy', 'BA', 0, 'open', 75],
  ['klassische-archaeologie/klassische-archaeologie-bachelor-75', 'classical-archaeology', 'Klassische Archäologie (Classical Archaeology)', 'History', 'BA', 0, 'open', 75],
  ['graezistikklassische-philologie/graezistikklassische-philologie-bachelor-50', 'greek', 'Gräzistik / Klassische Philologie (Greek)', 'Languages & Literature; History', 'BA', 0, 'open', 50],
  ['latinistikklassische-philologie/latinistikklassische-philologie-bachelor-50', 'latin', 'Latinistik / Klassische Philologie (Latin)', 'Languages & Literature; History', 'BA', 0, 'open', 50],
  ['mathematik/mathematik-bachelor-100', 'mathematics', 'Mathematik (Mathematics)', 'Mathematics', 'BSc', 1, 'open', 100],
  ['medizinische-informatik/medizinische-informatik-bachelor-100', 'medical-informatics', 'Medizinische Informatik (Medical Informatics)', 'Computer Science; Medicine & Health', 'BSc', 1, 'sel', 100],
  ['molekulare-biotechnologie/molekulare-biotechnologie-bachelor-100', 'molecular-biotechnology', 'Molekulare Biotechnologie (Molecular Biotechnology)', 'Biology & Life Sciences', 'BSc', 1, 'nc', 100],
  ['musikwissenschaft/musikwissenschaft-bachelor-75', 'musicology', 'Musikwissenschaft (Musicology)', 'Art & Design', 'BA', 0, 'open', 75],
  ['ostasienwissenschaften/ostasienwissenschaften-bachelor-75', 'east-asian-studies', 'Ostasienwissenschaften (East Asian Studies)', 'Languages & Literature', 'BA', 0, 'open', 75],
  ['osteuropa-und-ostmitteleuropastudien/osteuropa-und-ostmitteleuropastudien-bachelor-100', 'east-european-studies', 'Osteuropa- und Ostmitteleuropastudien (East European Studies)', 'Politics & International Relations; History', 'BA', 0, 'open', 100],
  ['philosophie/philosophie-bachelor-75', 'philosophy', 'Philosophie (Philosophy)', 'Philosophy', 'BA', 0, 'open', 75],
  ['physik/physik-bachelor-100', 'physics', 'Physik (Physics)', 'Physics', 'BSc', 1, 'interview', 100],
  ['politikwissenschaft/politikwissenschaft-bachelor-75', 'political-science', 'Politikwissenschaft (Political Science)', 'Politics & International Relations', 'BA', 0, 'sel', 75],
  ['psychologie/psychologie-bachelor-100', 'psychology', 'Psychologie (Psychology)', 'Psychology', 'BSc', 0, 'nc', 100],
  ['religionswissenschaft/religionswissenschaft-bachelor-75', 'religious-studies', 'Religionswissenschaft (Religious Studies)', 'Philosophy', 'BA', 0, 'open', 75],
  ['semitische-sprachen-und-kulturen/semitische-sprachen-und-kulturen-bachelor-50', 'semitic-studies', 'Semitische Sprachen und Kulturen (Semitic Languages and Cultures)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['slavistik/slavistik-bachelor-75', 'slavic-studies', 'Slavistik (Slavic Studies)', 'Languages & Literature', 'BA', 0, 'open', 75],
  ['soziologie/soziologie-bachelor-100', 'sociology', 'Soziologie (Sociology)', 'Sociology & Anthropology', 'BA', 0, 'nc', 100],
  ['spanisch-romanistik/spanischromanistik-bachelor-50', 'spanish', 'Spanisch / Romanistik (Spanish Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['sportwissenschaft/sportwissenschaft-bachelor-75', 'sport-science', 'Sportwissenschaft (Sport Science)', 'Medicine & Health', 'BSc', 0, 'sport', 75],
  ['suedasienstudien/suedasienstudien-bachelor-100', 'south-asian-studies', 'Südasienstudien (South Asian Studies)', 'Languages & Literature; History', 'BA', 0, 'open', 100],
  ['translation-und-kommunikationstechnologien/translation-und-kommunikationstechnologien-bachelor-100', 'translation-technology', 'Translation und Kommunikationstechnologien (Translation and Communication Technologies)', 'Languages & Literature', 'BA', 0, 'open', 100],
  ['uebersetzungswissenschaft/uebersetzungswissenschaft-bachelor-100', 'translation-studies', 'Übersetzungswissenschaft (Translation Studies)', 'Languages & Literature', 'BA', 0, 'open', 100],
  ['ur-und-fruehgeschichte/ur-und-fruehgeschichte-bachelor-50', 'prehistory', 'Ur- und Frühgeschichte (Prehistory and Early History)', 'History', 'BA', 0, 'open', 50],
  ['volkswirtschaftslehre-economics/volkswirtschaftslehre-bachelor-100', 'economics', 'Volkswirtschaftslehre / Economics', 'Economics', 'BSc', 0, 'open', 100],
  ['vorderasiatische-archaeologie/vorderasiatische-archaeologie-bachelor-75', 'near-eastern-archaeology', 'Vorderasiatische Archäologie (Near Eastern Archaeology)', 'History', 'BA', 0, 'open', 75],
];
const HD_KIND = {
  open: { ...HD_OPEN, entrance_exam: 'no' },
  nc: { ...HD_SEL, admission: 'Restricted places: apply through hochschulstart.de (DoSV)', entrance_exam: 'no' },
  sel: { ...HD_SEL, admission: "Restricted places: the university's own selection procedure", entrance_exam: 'no' },
  // Each subject's Aufnahmeprüfung statute (Zulassungsordnung, linked from its
  // page; checked 2026-10-30). Physik: pre-selection on grades, then an
  // "Auswahlgespräch"; Chemie: "einer Vorauswahl und einem
  // Bewerbungsgespräch"; Angewandte Informatik: pre-selection and a
  // "Bewerbungsgespräch" — interviews, so no. English Studies: school English
  // grades plus a "fachspezifischen Studierfähigkeitstest" in written form (yes).
  interview: { ...HD_SEL, admission: 'Admission procedure: grades, then an interview', entrance_exam: 'no' },
  test: { ...HD_SEL, admission: 'Admission procedure: English grades and a written aptitude test', entrance_exam: 'yes' },
  sport: { ...HD_OPEN, entrance_exam: 'yes', other_requirements: 'Sports entrance test (Sporteingangsprüfung)' },
};
for (const [path, id, programme, subject_area, degree_type, stem, kind, share] of HD_ROWS) {
  const combo = share === 100 ? [] : [share === 75 ? 'Major (75%): add a 25% minor' : 'Two-subject degree (50%): add a second 50% subject'];
  const k = HD_KIND[kind];
  PROGS.push({ programme_id: `heidelberg-${id}`, university_id: 'heidelberg', programme, subject_area, degree_type, official_url: hdUrl(path),
    language: 'German', english_requirement: id === 'molecular-biotechnology' ? HD_DE.replace('(by enrolment)', '(at application)') : HD_DE,
    ...(stem ? STEM : ANY), ...k, other_requirements: [k.other_requirements, ...combo].filter(Boolean).join(' · ') });
}

// -------------------------------------------------------- part 3: more German-taught
// Added 2026-10-30: KIT, RWTH Aachen, TU Berlin, FU Berlin, Freiburg and
// Tübingen, every current German-taught bachelor in each university's own
// course finder (teacher-training, part-time, dual, nursing/midwifery, phased-out
// and minor-only entries left out; programmes already in part 1 skipped). HU
// Berlin's site sits behind a bot check ("Anubis could not load its
// JavaScript") that this machine cannot pass, so HU is not included.
//
// Per university (checked 2026-10-30):
//   KIT       course pages: "Zulassungsbeschränkung: 1. Fachsemester: ja/nein",
//             "Bewerbungsfrist: Deutsche oder EU-Staatsangehörige 1. Fachsemester:
//             15. Juli / 15. September"; International Students Office: non-EU
//             applicants "15th July for the winter semester". German: "mindestens
//             dem Niveau C1" by the end of enrolment. Selection in restricted
//             programmes, ZSB "Numerus Clausus … Auswahlverfahren" (Dec 2025):
//             Abitur average, subject grades and other achievements; Architektur
//             adds a "Praxisbezogene Aufgabe" (exam ?).
//   RWTH      "Liste aktuelle Studiengänge" (NC column, "NC für WiSe 2026" /
//             "kein NC"); international applicants: "zulassungsfrei 20. Oktober",
//             "zulassungsbeschränkt (NC) 15. Juli"; "You must therefore provide
//             proof of German language skills at C1 level when you enroll".
//             Psychologie: "neben der Durchschnittsnote … auch das Ergebnis des
//             Studieneignungstests (BaPsy-DGPs)" — not said to be optional (?).
//   TU Berlin course list (Zulassung, Lehrsprache); deadlines "Application for
//             bachelor's programs with restricted admission (NC): 01.06.2026
//             until 15.07.2026", open admission "01.06.2026 until 31.08.2026";
//             foreign certificates need a uni-assist VPD; German: DSH-2, TestDaF
//             4 in all parts, DSD II or telc Deutsch C1 Hochschule.
//   FU Berlin "Ob … das Fach platzbeschränkt (NC) oder zulassungsfrei (kein NC)
//             ist, wird jedes Semester neu festgelegt"; restricted "01.06.2026 –
//             15.07.2026", open "01.06.2026 – 01.09.2026"; VPD from uni-assist;
//             to apply, German "mindestens … C1 GER" (graded certificate).
//   Freiburg  Studiengangfinder (Zulassung, Bewerbungsfrist per programme);
//             "Bis auf den Bachelor of Liberal Arts and Sciences ist die
//             Unterrichtssprache in den grundständigen Studiengängen immer
//             Deutsch"; German: DSH-2, TestDaF 4, DSD II or telc C1 Hochschule.
//             "Aufnahmeprüfung" programmes check school subjects, not a test
//             (English/Romance languages: language level from school or a
//             certificate; Klassische Philologie and Altertumswissenschaften:
//             "das Latinum"). Sport: Sport grades in the last school years, or
//             "der … Nachweis über das Bestehen der Aufnahmeprüfung" (waivable).
//   Tübingen  course pages (Zulassungsbeschränkung, Unterrichtssprache); deadlines
//             "15. Juli" (restricted) and "30. September" (open) for
//             international applicants; German: DSH-2 or TestDaF 4 in all parts.
//             Sportwissenschaft: "Voraussetzung … ist der Nachweis über das
//             Bestehen der Sporteingangsprüfung" (yes); Psychologie counts the
//             "freiwilligen Studieneignungstests BaPsy-DGPs" (no).
const NC3 = 'Restricted places (numerus clausus)';
const U3 = {
  kit: { de: 'German C1 (DSH-2, TestDaF 4 in all parts) by the end of enrolment', nc: 'Restricted places: selection on the Abitur-equivalent grade, subject grades and other achievements' },
  rwth: { de: 'German C1 at enrolment (DSH-2, TestDaF 4 in all parts or equivalent)', nc: NC3 },
  tu: { de: 'German: DSH-2, TestDaF 4 in all parts, DSD II or telc Deutsch C1 Hochschule (with the application)', nc: NC3 },
  fu: { de: 'German C1 (graded certificate) to apply; DSH-2 or TestDaF 4 in all parts by enrolment', nc: NC3 },
  fr: { de: 'German: DSH-2, TestDaF 4 in all parts, DSD II or telc C1 Hochschule', nc: 'Restricted places: selection on the Abitur-equivalent grade and other achievements' },
  tue: { de: 'German: DSH-2 or TestDaF 4 in all parts', nc: NC3 },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UNI3 = { kit: 'kit', rwth: 'rwth', tu: 'tu-berlin', fu: 'fu-berlin', fr: 'freiburg', tue: 'tuebingen' };
const FR_SPECIAL = {
  'freiburg-english-and-american-studies-anglistik-und-amerikanistik': 'English at B2 from school or a certificate',
  'freiburg-iberocultura-spanische-sprache-literatur-und-kultur': 'Spanish from school or a certificate',
  'freiburg-frankomedia-franzoesische-sprache-literatur-und-medienkultur': 'French from school or a certificate',
  'freiburg-romanische-sprachen-und-literaturen': 'French, Italian or Spanish from school or a certificate',
  'freiburg-klassische-philologie': 'Latinum (or equivalent Latin)',
  'freiburg-altertumswissenschaften': 'Latinum (or equivalent Latin)',
};
// [uni, programme_id, programme, degree, url, language, subject_area, stem?, admission (open|nc|varies|special), exam, KIT/Freiburg deadline MM-DD, combination]
const ROWS3 = [
  ["kit","kit-angewandte-geowissenschaften","Angewandte Geowissenschaften","BSc","https://www.sle.kit.edu/vorstudium/bachelor-angewandte-geowissenschaften.php","German","Environmental Sciences",1,"open","no","09-15",""],
  ["kit","kit-angewandte-umweltinformatik-und-erdbeobachtung","Angewandte Umweltinformatik und Erdbeobachtung","BSc","https://www.sle.kit.edu/vorstudium/bachelor-angewandte-umweltinformatik-erdbeobachtung.php","German","Computer Science; Environmental Sciences",1,"open","no","09-15",""],
  ["kit","kit-architektur","Architektur","BSc","https://www.sle.kit.edu/vorstudium/bachelor-architektur.php","German; English","Architecture",1,"nc","?","07-15",""],
  ["kit","kit-bauingenieurwesen","Bauingenieurwesen","BSc","https://www.sle.kit.edu/vorstudium/bachelor-bauingenieurwesen.php","German","Engineering",1,"open","no","09-15",""],
  ["kit","kit-bioingenieurwesen","Bioingenieurwesen","BSc","https://www.sle.kit.edu/vorstudium/bachelor-bioingenieurwesen.php","German","Engineering",1,"nc","no","07-15",""],
  ["kit","kit-biologie","Biologie","BSc","https://www.sle.kit.edu/vorstudium/bachelor-biologie.php","German","Biology & Life Sciences",1,"nc","no","07-15",""],
  ["kit","kit-chemie","Chemie","BSc","https://www.sle.kit.edu/vorstudium/bachelor-chemie.php","German","Chemistry",1,"open","no","07-15",""],
  ["kit","kit-chemieingenieurwesen-und-verfahrenstechnik","Chemieingenieurwesen und Verfahrenstechnik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-chemieingenieurwesen-verfahrenstechnik.php","German","Chemistry; Engineering",1,"open","no","09-15",""],
  ["kit","kit-chemische-biologie","Chemische Biologie","BSc","https://www.sle.kit.edu/vorstudium/bachelor-chemische-biologie.php","German","Chemistry; Biology & Life Sciences",1,"nc","no","07-15",""],
  ["kit","kit-computational-and-data-science","Computational and Data Science","BSc","https://www.sle.kit.edu/vorstudium/bachelor-computational-data-science.php","German","Computer Science",1,"open","no","09-15",""],
  ["kit","kit-digital-economics","Digital Economics","BSc","https://www.sle.kit.edu/vorstudium/bachelor-digital-economics.php","German; English","Economics",0,"nc","no","07-15",""],
  ["kit","kit-elektrotechnik-und-informationstechnik","Elektrotechnik und Informationstechnik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-elektrotechnik-informationstechnik.php","German","Engineering",1,"open","no","09-15",""],
  ["kit","kit-geodaesie-und-geoinformatik","Geodäsie und Geoinformatik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-geodaesie-geoinformatik.php","German","Computer Science; Environmental Sciences; Engineering",1,"open","no","09-15",""],
  ["kit","kit-geooekologie","Geoökologie","BSc","https://www.sle.kit.edu/vorstudium/bachelor-geooekologie.php","German","Environmental Sciences",1,"nc","no","07-15",""],
  ["kit","kit-geophysik","Geophysik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-geophysik.php","German","Physics; Environmental Sciences",1,"open","no","09-15",""],
  ["kit","kit-germanistik","Germanistik","BA","https://www.sle.kit.edu/vorstudium/bachelor-germanistik.php","German","Languages & Literature",0,"open","no","09-15",""],
  ["kit","kit-informatik","Informatik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-informatik.php","German","Computer Science",1,"nc","no","07-15",""],
  ["kit","kit-kunstgeschichte","Kunstgeschichte","BA","https://www.sle.kit.edu/vorstudium/bachelor-kunstgeschichte.php","German; English","History; Art & Design",0,"open","no","09-15",""],
  ["kit","kit-lebensmittelchemie","Lebensmittelchemie","BSc","https://www.sle.kit.edu/vorstudium/bachelor-lebensmittelchemie.php","German","Chemistry; Biology & Life Sciences",1,"open","no","09-15",""],
  ["kit","kit-liberal-arts-and-sciences","Liberal Arts and Sciences","BA","https://www.sle.kit.edu/vorstudium/bachelor-liberal-arts-and-sciences.php","German; English","Liberal Arts",0,"open","no","09-15",""],
  ["kit","kit-maschinenbau","Maschinenbau","BSc","https://www.sle.kit.edu/vorstudium/bachelor-maschinenbau.php","German","Engineering",1,"open","no","09-15",""],
  ["kit","kit-materialwissenschaft-und-werkstofftechnik","Materialwissenschaft und Werkstofftechnik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-materialwissenschaft-werkstofftechnik.php","German","Engineering",1,"open","no","09-15",""],
  ["kit","kit-mathematik","Mathematik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-mathematik.php","German","Mathematics",1,"open","no","09-15",""],
  ["kit","kit-mechatronik-und-informationstechnik","Mechatronik und Informationstechnik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-mechatronik-informationstechnik.php","German","Engineering",1,"nc","no","07-15",""],
  ["kit","kit-medizintechnik","Medizintechnik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-medizintechnik.php","German","Engineering; Medicine & Health",1,"nc","no","07-15",""],
  ["kit","kit-meteorologie-und-klimaphysik","Meteorologie und Klimaphysik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-meteorologie.php","German","Physics; Environmental Sciences",1,"open","no","09-15",""],
  ["kit","kit-paedagogik","Pädagogik","BA","https://www.sle.kit.edu/vorstudium/bachelor-paedagogik.php","German","Education",0,"open","no","09-15",""],
  ["kit","kit-physik","Physik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-physik.php","German","Physics",1,"open","no","09-15",""],
  ["kit","kit-sportwissenschaft","Sportwissenschaft","BSc","https://www.sle.kit.edu/vorstudium/bachelor-sportwissenschaft.php","German","Medicine & Health",0,"nc","?","07-15",""],
  ["kit","kit-umwelt-und-georessourcenmanagement","Umwelt- und Georessourcenmanagement","BSc","https://www.sle.kit.edu/vorstudium/bachelor-umwelt-georesourcenmanagement.php","German","Environmental Sciences; Business & Management",1,"open","no","09-15",""],
  ["kit","kit-wirtschaftsinformatik","Wirtschaftsinformatik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-wirtschaftsinformatik.php","German","Computer Science; Business & Management",1,"nc","no","07-15",""],
  ["kit","kit-wirtschaftsingenieurwesen","Wirtschaftsingenieurwesen","BSc","https://www.sle.kit.edu/vorstudium/bachelor-wirtschaftsingenieurwesen.php","German","Engineering; Business & Management",1,"nc","no","07-15",""],
  ["kit","kit-wirtschaftsmathematik","Wirtschaftsmathematik","BSc","https://www.sle.kit.edu/vorstudium/bachelor-wirtschaftsmathematik.php","German","Mathematics; Business & Management",1,"open","no","09-15",""],
  ["rwth","rwth-angewandte-geographie","Angewandte Geographie","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Angewandte-Geographie-B-Sc/~blkc/Angewandte-Geographie-B-Sc-/","German","Environmental Sciences",1,"open","no","",""],
  ["rwth","rwth-angewandte-geowissenschaften","Angewandte Geowissenschaften","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Angewandte-Geowissenschaften-B-Sc/~bqxy/Angewandte-Geowissenschaften-B-Sc-/","German; English","Environmental Sciences",1,"open","no","",""],
  ["rwth","rwth-architektur","Architektur","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Architektur-B-Sc-/~bnwk/Architektur-B-Sc-/","German","Architecture",1,"nc","no","",""],
  ["rwth","rwth-bauingenieurwesen","Bauingenieurwesen","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Bauingenieurwesen-B-Sc/~bler/Bauingenieurwesen-B-Sc-/","German","Engineering",1,"open","no","",""],
  ["rwth","rwth-betriebswirtschaftslehre-business-administration","Betriebswirtschaftslehre/Business Administration","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Betriebswirtschaftslehre-Business-Admini/~bpxm/Betriebswirtschaftslehre-Business-Admini/","German; English","Business & Management",0,"nc","no","",""],
  ["rwth","rwth-biologie","Biologie","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Biologie-B-Sc/~blax/Biologie-B-Sc-/","German","Biology & Life Sciences",1,"nc","no","",""],
  ["rwth","rwth-chemie","Chemie","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Chemie-B-Sc/~bkdy/Chemie-B-Sc-/","German","Chemistry",1,"open","no","",""],
  ["rwth","rwth-chemie-plus","Chemie Plus","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Chemie-Plus-B-Sc/~bmhabk/Chemie-Plus-B-Sc/","German","Chemistry",1,"open","no","",""],
  ["rwth","rwth-computational-engineering-science","Computational Engineering Science","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Computational-Engineering-Science-B-Sc-/~bixp/Computational-Engineering-Science-B-Sc/","German; English","Computer Science; Engineering",1,"open","no","",""],
  ["rwth","rwth-computer-engineering","Computer Engineering","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Computer-Engineering-B-Sc/~nbrfz/Computer-Engineering-B-Sc/","German","Computer Science; Engineering",1,"open","no","",""],
  ["rwth","rwth-elektrotechnik-und-informationstechnik","Elektrotechnik und Informationstechnik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Elektrotechnik-und-Informationstechnik-B/~bkui/Elektrotechnik-und-Informationstechnik-B/","German","Engineering",1,"open","no","",""],
  ["rwth","rwth-georessourcenmanagement","Georessourcenmanagement","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Georessourcenmanagement-B-Sc/~blln/Georessourcenmanagement-B-Sc-/","German; English","Environmental Sciences; Business & Management",1,"open","no","",""],
  ["rwth","rwth-geschichtswissenschaft","Geschichtswissenschaft","BA","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Geschichtswissenschaft-B-A/~qadn/Geschichtswissenschaft-B-A/","German","History",0,"nc","no","",""],
  ["rwth","rwth-gesellschaftswissenschaften","Gesellschaftswissenschaften","BA","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Gesellschaftswissenschaften-B-A-/~bhtf/Gesellschaftswissenschaften-B-A-/","German","Sociology & Anthropology",0,"open","no","",""],
  ["rwth","rwth-informatik","Informatik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Informatik-B-Sc-/~boej/Informatik-B-Sc-/","German; English","Computer Science",1,"open","no","",""],
  ["rwth","rwth-maschinenbau","Maschinenbau","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Maschinenbau-B-Sc-/~bnew/Maschinenbau-B-Sc-/","German","Engineering",1,"open","no","",""],
  ["rwth","rwth-materialwissenschaften","Materialwissenschaften","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Materialwissenschaften-B-Sc/~blmr/Materialwissenschaften-B-Sc-/","German; English","Engineering",1,"open","no","",""],
  ["rwth","rwth-mathematik","Mathematik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Mathematik-B-Sc/~bmsr/Mathematik-B-Sc-/","German","Mathematics",1,"open","no","",""],
  ["rwth","rwth-mensch-technik-interaktion-und-kommunikation","Mensch-Technik-Interaktion und ‑Kommunikation","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Technik-Kommunikation-B-Sc/~bkfe/Technik-Kommunikation-B-Sc-/","German; English","Engineering; Media & Communication",1,"open","no","",""],
  ["rwth","rwth-molekulare-und-angewandte-biotechnologie","Molekulare und Angewandte Biotechnologie","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Molekulare-und-Angewandte-Biotechnologie/~bkxi/Molekulare-und-Angewandte-Biotechnologie/","German","Biology & Life Sciences; Engineering",1,"nc","no","",""],
  ["rwth","rwth-nachhaltige-rohstoff-und-energieversorgung","Nachhaltige Rohstoff- und Energieversorgung","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Nachhaltige-Rohstoff-und-Energieversorg/~ogfy/Nachhaltige-Rohstoff-und-Energieversorg/","German","Environmental Sciences",1,"open","no","",""],
  ["rwth","rwth-nachhaltige-werkstofftechnik","Nachhaltige Werkstofftechnik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Werkstoffingenieurwesen-B-Sc/~bhhilu/Werkstoffingenieurwesen-B-Sc/","German; English","Environmental Sciences; Engineering",1,"open","no","",""],
  ["rwth","rwth-philosophie-literatur-und-sprachwissenschaft","Philosophie, Literatur- und Sprachwissenschaft","BA","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Philosophie-Literatur-und-Sprachwissen/~bhtx/Philosophie-Literatur-und-Sprachwissen/","German","Philosophy; Languages & Literature",0,"open","no","",""],
  ["rwth","rwth-physik","Physik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Physik-B-Sc/~bkhy/Physik-B-Sc-/","German","Physics",1,"open","no","",""],
  ["rwth","rwth-physik-plus","Physik Plus","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Physik-Plus-B-Sc/~gtheg/Physik-Plus-B-Sc/","German","Physics",1,"open","no","",""],
  ["rwth","rwth-psychologie-polyvalent","Psychologie (polyvalent)","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Psychologie-polyvalent-B-Sc/~bohv/Psychologie-polyvalent-B-Sc/","German","Psychology",0,"nc","?","",""],
  ["rwth","rwth-soziologie-mit-schwerpunkt-technikforschung","Soziologie mit Schwerpunkt Technikforschung","BA","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Soziologie-mit-Schwerpunkt-Technikforsch/~gqagi/Soziologie-mit-Schwerpunkt-Technikforsch/","German","Sociology & Anthropology",0,"open","no","",""],
  ["rwth","rwth-sprach-und-kommunikationswissenschaft","Sprach- und Kommunikationswissenschaft","BA","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Sprach-und-Kommunikationswissenschaft-B/~fbqr/Sprach-und-Kommunikationswissenschaft-B/","German","Languages & Literature; Media & Communication",0,"nc","no","",""],
  ["rwth","rwth-umweltingenieurwissenschaften","Umweltingenieurwissenschaften","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Umweltingenieurwissenschaften-B-Sc/~bkkg/Umweltingenieurwissenschaften-B-Sc-/","German","Environmental Sciences; Engineering",1,"open","no","",""],
  ["rwth","rwth-verkehrsingenieurwesen-und-mobilitaet","Verkehrsingenieurwesen und Mobilität","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Verkehrsingenieurwesen-und-Mobilitaet-B-/~bldk/Verkehrsingenieurwesen-und-Mobilitaet-B-/","German","Engineering",1,"open","no","",""],
  ["rwth","rwth-wirtschaftsingenieurwesen-fachrichtung-bauingenieurwesen","Wirtschaftsingenieurwesen, Fachrichtung Bauingenieurwesen","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Wirtschaftsingenieurwesen-B-Sc-Fachric/~blcg/Wirtschaftsingenieurwesen-B-Sc-Fachric/","German","Engineering; Business & Management",1,"open","no","",""],
  ["rwth","rwth-wirtschaftsingenieurwesen-fachrichtung-elektrische-energietechnik","Wirtschaftsingenieurwesen, Fachrichtung Elektrische Energietechnik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Wirtschaftsingenieurwesen-B-Sc-Fachric/~bmmy/Wirtschaftsingenieurwesen-B-Sc-Fachric/","German","Engineering; Business & Management",1,"open","no","",""],
  ["rwth","rwth-wirtschaftsingenieurwesen-fachrichtung-maschinenbau","Wirtschaftsingenieurwesen, Fachrichtung Maschinenbau","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Wirtschaftsingenieurwesen-B-Sc-Fachric/~bjsj/Wirtschaftsingenieurwesen-B-Sc-Fachric/","German; English","Engineering; Business & Management",1,"open","no","",""],
  ["rwth","rwth-wirtschaftsingenieurwesen-fachrichtung-werkstoff-und-prozesstechnik","Wirtschaftsingenieurwesen, Fachrichtung Werkstoff- und Prozesstechnik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Wirtschaftsingenieurwesen-B-Sc-Fachric/~bpwb/Wirtschaftsingenieurwesen-B-Sc-Fachric/","German; English","Engineering; Business & Management",1,"open","no","",""],
  ["rwth","rwth-wirtschaftsmathematik","Wirtschaftsmathematik","BSc","https://www.rwth-aachen.de/cms/root/studium/Vor-dem-Studium/Studiengaenge/Liste-Aktuelle-Studiengaenge/Studiengangbeschreibung/Wirtschaftsmathematik-B-Sc/~tgvsl/Wirtschaftsmathematik-B-Sc/","German","Mathematics; Business & Management",1,"open","no","",""],
  ["tu","tu-berlin-architektur","Architektur","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/architektur-b-sc","German","Architecture",1,"nc","no","",""],
  ["tu","tu-berlin-bauingenieurwesen","Bauingenieurwesen","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/bauingenieurwesen-b-sc","German","Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-biotechnologie","Biotechnologie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/biotechnologie-b-sc","German","Biology & Life Sciences; Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-brauerei-und-getraenketechnologie","Brauerei- und Getränketechnologie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/brauerei-und-getraenketechnologie-b-sc","German","Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-brauwesen","Brauwesen","BEng","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/brauwesen-b-eng","German","Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-chemie","Chemie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/chemie-b-sc","German","Chemistry",1,"open","no","",""],
  ["tu","tu-berlin-chemieingenieurwesen","Chemieingenieurwesen","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/chemieingenieurwesen-b-sc","German","Chemistry; Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-computational-engineering-science-informationstechnik-im-maschinenwesen","Computational Engineering Science (Informationstechnik im Maschinenwesen)","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/computational-engineering-science-informationstechnik-im-maschinenwesen-b-sc","German","Computer Science; Engineering",1,"open","no","",""],
  ["tu","tu-berlin-elektrotechnik","Elektrotechnik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/elektrotechnik-b-sc","German","Engineering",1,"open","no","",""],
  ["tu","tu-berlin-erneuerbare-energien-und-verfahrenstechnik","Erneuerbare Energien und Verfahrenstechnik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/erneuerbare-energien-und-verfahrenstechnik-b-sc","German","Environmental Sciences; Engineering",1,"open","no","",""],
  ["tu","tu-berlin-geotechnologie","Geotechnologie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/geotechnologie-b-sc","German","Environmental Sciences; Engineering",1,"open","no","",""],
  ["tu","tu-berlin-informatik","Informatik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/informatik-b-sc","German","Computer Science",1,"nc","no","",""],
  ["tu","tu-berlin-kultur-und-technik-bildungswissenschaft","Kultur und Technik / Bildungswissenschaft","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/kultur-und-technik-bildungswissenschaft-b-a","German","Education",0,"open","no","",""],
  ["tu","tu-berlin-kultur-und-technik-kunstwissenschaft","Kultur und Technik / Kunstwissenschaft","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/kultur-und-technik-kunstwissenschaft-b-a","German","Art & Design",0,"open","no","",""],
  ["tu","tu-berlin-kultur-und-technik-philosophie","Kultur und Technik / Philosophie","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/kultur-und-technik-philosophie-b-a","German","Philosophy",0,"open","no","",""],
  ["tu","tu-berlin-kultur-und-technik-sprache-und-kommunikation","Kultur und Technik / Sprache und Kommunikation","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/kultur-und-technik-sprache-und-kommunikation-b-a","German","Languages & Literature; Media & Communication",0,"nc","no","",""],
  ["tu","tu-berlin-kultur-und-technik-wissenschafts-und-technikgeschichte","Kultur und Technik / Wissenschafts- und Technikgeschichte","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/kultur-und-technik-wissenschafts-und-technikgeschichte-b-a","German","History",0,"open","no","",""],
  ["tu","tu-berlin-landschaftsarchitektur","Landschaftsarchitektur","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/landschaftsarchitektur-b-sc","German","Architecture",1,"nc","no","",""],
  ["tu","tu-berlin-lebensmittelchemie","Lebensmittelchemie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/lebensmittelchemie-b-sc","German","Chemistry; Biology & Life Sciences",1,"open","no","",""],
  ["tu","tu-berlin-lebensmitteltechnologie","Lebensmitteltechnologie","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/lebensmitteltechnologie-b-sc","German","Biology & Life Sciences; Engineering",1,"open","no","",""],
  ["tu","tu-berlin-maschinenbau","Maschinenbau","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/maschinenbau-b-sc","German","Engineering",1,"nc","no","",""],
  ["tu","tu-berlin-materialwissenschaft-und-werkstofftechnik","Materialwissenschaft und Werkstofftechnik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/materialwissenschaft-und-werkstofftechnik-b-sc","German","Engineering",1,"open","no","",""],
  ["tu","tu-berlin-mathematik","Mathematik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/mathematik-b-sc","German","Mathematics",1,"open","no","",""],
  ["tu","tu-berlin-medieninformatik","Medieninformatik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/medieninformatik-b-sc","German","Computer Science; Media & Communication",1,"nc","no","",""],
  ["tu","tu-berlin-medientechnik","Medientechnik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/medientechnik-b-sc","German","Engineering; Media & Communication",1,"nc","no","",""],
  ["tu","tu-berlin-nachhaltiges-management","Nachhaltiges Management","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/nachhaltiges-management-b-sc","German","Environmental Sciences; Business & Management",1,"nc","no","",""],
  ["tu","tu-berlin-naturwissenschaften-in-der-informationsgesellschaft","Naturwissenschaften in der Informationsgesellschaft","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/naturwissenschaften-in-der-informationsgesellschaft-b-sc","German","Sociology & Anthropology",0,"open","no","",""],
  ["tu","tu-berlin-oekologie-und-umweltplanung","Ökologie und Umweltplanung","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/oekologie-und-umweltplanung-b-sc","German","Environmental Sciences",1,"nc","no","",""],
  ["tu","tu-berlin-physik","Physik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/physik-b-sc","German","Physics",1,"open","no","",""],
  ["tu","tu-berlin-physikalische-ingenieurwissenschaft","Physikalische Ingenieurwissenschaft","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/physikalische-ingenieurwissenschaft-b-sc","German","Physics; Engineering",1,"open","no","",""],
  ["tu","tu-berlin-soziologie-technikwissenschaftlicher-richtung","Soziologie technikwissenschaftlicher Richtung","BA","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/soziologie-technikwissenschaftlicher-richtung-b-a","German","Sociology & Anthropology",0,"nc","no","",""],
  ["tu","tu-berlin-stadt-und-regionalplanung","Stadt- und Regionalplanung","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/stadt-und-regionalplanung-b-sc","German","Architecture",1,"nc","no","",""],
  ["tu","tu-berlin-technische-informatik","Technische Informatik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/technische-informatik-b-sc","German","Computer Science",1,"nc","no","",""],
  ["tu","tu-berlin-technischer-umweltschutz","Technischer Umweltschutz","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/technischer-umweltschutz-b-sc","German","Environmental Sciences",1,"open","no","",""],
  ["tu","tu-berlin-technomathematik","Technomathematik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/technomathematik-b-sc","German","Mathematics",1,"open","no","",""],
  ["tu","tu-berlin-verkehrswesen","Verkehrswesen","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/verkehrswesen-b-sc","German","Engineering",1,"open","no","",""],
  ["tu","tu-berlin-volkswirtschaftslehre-und-nachhaltigkeit","Volkswirtschaftslehre und Nachhaltigkeit","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/volkswirtschaftslehre-und-nachhaltigkeit-b-sc","German","Environmental Sciences; Economics",1,"nc","no","",""],
  ["tu","tu-berlin-wirtschaftsinformatik","Wirtschaftsinformatik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/wirtschaftsinformatik-b-sc","German; English","Computer Science; Business & Management",1,"nc","no","",""],
  ["tu","tu-berlin-wirtschaftsingenieurwesen","Wirtschaftsingenieurwesen","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/wirtschaftsingenieurwesen-b-sc","German","Engineering; Business & Management",1,"nc","no","",""],
  ["tu","tu-berlin-wirtschaftsmathematik","Wirtschaftsmathematik","BSc","https://www.tu.berlin/studieren/studienangebot/gesamtes-studienangebot/studiengang/wirtschaftsmathematik-b-sc","German","Mathematics; Business & Management",1,"open","no","",""],
  ["fu","fu-berlin-allgemeine-und-vergleichende-literaturwissenschaften","Allgemeine und Vergleichende Literaturwissenschaften","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/allgemeine_vergleichende_literaturwissenschaft_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-altertumswissenschaften-profilbereich-aegyptologie","Altertumswissenschaften: Profilbereich Ägyptologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/altertumswissenschaften_profil_aegyptologie/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-altertumswissenschaften-profilbereich-altorientalistik","Altertumswissenschaften: Profilbereich Altorientalistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/altertumswissenschaften_profil_altorientalistik/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-altertumswissenschaften-profilbereich-klassische-archaeologie","Altertumswissenschaften: Profilbereich Klassische Archäologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/altertumswissenschaften_profil_klassische_archaeologie/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-altertumswissenschaften-profilbereich-praehistorische-archaeologie","Altertumswissenschaften: Profilbereich Prähistorische Archäologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/altertumswissenschaften_profil_praehistorische_archaeologie/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-altertumswissenschaften-profilbereich-vorderasiatische-archaeologie","Altertumswissenschaften: Profilbereich Vorderasiatische Archäologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/altertumswissenschaften_profil_vorderasiatische_archaeologie/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-betriebswirtschaftslehre","Betriebswirtschaftslehre","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/betriebswirtschaftslehre/index.html","German","Business & Management",0,"varies","no","",""],
  ["fu","fu-berlin-bildungs-und-erziehungswissenschaft","Bildungs- und Erziehungswissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/bildungs_und_erziehungswissenschaft_mono/index.html","German","Education",0,"varies","no","",""],
  ["fu","fu-berlin-biochemie","Biochemie","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/biochemie_mono/index.html","German","Chemistry; Biology & Life Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-bioinformatik","Bioinformatik","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/bioinformatik_mono/index.html","German","Computer Science; Biology & Life Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-biologie","Biologie","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/biologie_mono/index.html","German","Biology & Life Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-chemie","Chemie","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/chemie_mono/index.html","German","Chemistry",1,"varies","no","",""],
  ["fu","fu-berlin-chinastudien-ostasienwissenschaften","Chinastudien/Ostasienwissenschaften","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/chinastudien_ostasienwissenschaften/index.html","German","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-chinesische-sprache-und-gesellschaft","Chinesische Sprache und Gesellschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/chinesische_sprache_und_gesellschaft_kombi/index.html","German","Sociology & Anthropology; Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-deutsche-philologie","Deutsche Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/deutsche_philologie_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-deutsch-franzoesische-literatur-und-kulturstudien","Deutsch-Französische Literatur- und Kulturstudien","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/dt_frz_literatur_u_kulturstudien/index.html","German; French","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-englische-philologie","Englische Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/englische_philologie_kombi/index.html","English","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-filmwissenschaft","Filmwissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/filmwissenschaft_kombi/index.html","German","Media & Communication",0,"varies","no","","kombi"],
  ["fu","fu-berlin-frankreichstudien","Frankreichstudien","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/frankreichstudien_mono/index.html","German; French","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-franzoesische-philologie","Französische Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/franzoesische_philologie_kombi/index.html","German; French","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-geographische-wissenschaften","Geographische Wissenschaften","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geographische_wissenschaft_mono/index.html","German","Environmental Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-geologische-wissenschaften","Geologische Wissenschaften","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geologische_wissenschaften_mono/index.html","German","Environmental Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-geschichte","Geschichte","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschichte_kombi/index.html","German","History",0,"varies","no","","kombi"],
  ["fu","fu-berlin-geschichte-und-kultur-des-vorderen-orients-schwerpunktbereich-arabistik","Geschichte und Kultur des Vorderen Orients: Schwerpunktbereich Arabistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschkult_vo_arabistik_mono/index.html","German","History; Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-geschichte-und-kultur-des-vorderen-orients-schwerpunktbereich-iranistik","Geschichte und Kultur des Vorderen Orients: Schwerpunktbereich Iranistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschkult_vo_iranistik_mono/index.html","German","History; Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-geschichte-und-kultur-des-vorderen-orients-schwerpunktbereich-islamwissenschaft","Geschichte und Kultur des Vorderen Orients: Schwerpunktbereich Islamwissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschkult_vo_islamwissenschaft_mono/index.html","German","History; Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-geschichte-und-kultur-des-vorderen-orients-schwerpunktbereich-semistik","Geschichte und Kultur des Vorderen Orients: Schwerpunktbereich Semistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschkult_vo_semitistik_mono/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-geschichte-und-kultur-des-vorderen-orients-schwerpunktbereich-turkologie","Geschichte und Kultur des Vorderen Orients: Schwerpunktbereich Turkologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/geschkult_vo_turkologie_mono/index.html","German","History; Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-griechische-philologie","Griechische Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/griechische_philologie_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-informatik","Informatik","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/informatik/index.html","German","Computer Science",1,"varies","no","",""],
  ["fu","fu-berlin-italienische-philologie","Italienische Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/italienische_philologie_kombi/index.html","German; Italian","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-italienstudien","Italienstudien","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/italienstudien_mono/index.html","German; Italian","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-japanstudien-ostasienwissenschaften","Japanstudien/Ostasienwissenschaften","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/japanstudien_ostasienwissenschaften_mono/index.html","German","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-judaistik","Judaistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/judaistik/index.html","German","History",0,"varies","no","",""],
  ["fu","fu-berlin-koreastudien-ostasienwissenschaften","Koreastudien/Ostasienwissenschaften","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/koreastudien_ostasienwissenschaften_mono/index.html","German","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-kunstgeschichte-mit-dem-schwerpunkt-afrika","Kunstgeschichte mit dem Schwerpunkt Afrika","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/kunstgesch_afrika_kombi/index.html","German","History; Art & Design",0,"varies","no","","kombi"],
  ["fu","fu-berlin-kunstgeschichte-mit-dem-schwerpunkt-europa-und-amerika","Kunstgeschichte mit dem Schwerpunkt Europa und Amerika","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/kunstgesch_europa_amerika_kombi/index.html","German","History; Art & Design",0,"varies","no","","kombi"],
  ["fu","fu-berlin-kunstgeschichte-mit-dem-schwerpunkt-ostasien","Kunstgeschichte mit dem Schwerpunkt Ostasien","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/kunstgesch_ostasien_kombi/index.html","German","History; Languages & Literature; Art & Design",0,"varies","no","","kombi"],
  ["fu","fu-berlin-lateinische-philologie","Lateinische Philologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/lateinische_philologie_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-mathematik","Mathematik","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/mathematik_mono/index.html","German","Mathematics",1,"varies","no","",""],
  ["fu","fu-berlin-medieninformatik","Medieninformatik","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/medieninformatik/index.html","German","Computer Science; Media & Communication",1,"varies","no","",""],
  ["fu","fu-berlin-meteorologie","Meteorologie","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/meteorologie_mono/index.html","German","Environmental Sciences",1,"varies","no","",""],
  ["fu","fu-berlin-neograezistik","Neogräzistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/neograezistik_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-sprache-literatur-kultur-niederlaendisch","Sprache – Literatur – Kultur: Niederländisch","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/niederlaendische_philologie_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-nordamerikastudien","Nordamerikastudien","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/nordamerikastudien/index.html","English","Languages & Literature",0,"varies","no","",""],
  ["fu","fu-berlin-philosophie","Philosophie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/philosophie_kombi/index.html","German","Philosophy",0,"varies","no","","kombi"],
  ["fu","fu-berlin-physik","Physik","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/physik_mono/index.html","German","Physics",1,"varies","no","",""],
  ["fu","fu-berlin-politikwissenschaft","Politikwissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/politik/index.html","German","Politics & International Relations",0,"varies","no","",""],
  ["fu","fu-berlin-psychologie","Psychologie","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/psychologie_mono/index.html","German","Psychology",0,"varies","no","",""],
  ["fu","fu-berlin-publizistik-und-kommunikationswissenschaft","Publizistik- und Kommunikationswissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/publizistik_kommwiss_kombi/index.html","German","Media & Communication",0,"varies","no","","kombi"],
  ["fu","fu-berlin-sozial-und-kulturanthropologie","Sozial- und Kulturanthropologie","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/sozial_kulturanthro_kombi/index.html","German","Sociology & Anthropology",0,"varies","no","","kombi"],
  ["fu","fu-berlin-spanische-philologie-mit-lateinamerikanistik","Spanische Philologie mit Lateinamerikanistik","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/spanische_philologie_mit_lateinamerikanistik_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-sprache-gesellschaft","Sprache & Gesellschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/sprache-und-gesellschaft/index.html","German","Sociology & Anthropology; Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-theaterwissenschaft","Theaterwissenschaft","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/theaterwissenschaft_kombi/index.html","German","Media & Communication",0,"varies","no","","kombi"],
  ["fu","fu-berlin-sprache-und-literatur-der-tuerkei","Sprache und Literatur der Türkei","BA","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/tuerkisch_kombi/index.html","German","Languages & Literature",0,"varies","no","","kombi"],
  ["fu","fu-berlin-volkswirtschaftslehre","Volkswirtschaftslehre","BSc","https://www.fu-berlin.de/studium/studienangebot/grundstaendige/volkswirtschaftslehre_mono/index.html","German","Economics",0,"varies","no","",""],
  ["fr","freiburg-altertumswissenschaften","Altertumswissenschaften","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/260","German","History",0,"special","no","09-30","2f"],
  ["fr","freiburg-angewandte-politikwissenschaft","Angewandte Politikwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/789","German; English; French","Politics & International Relations",0,"nc","no","07-15",""],
  ["fr","freiburg-archaeologische-wissenschaften","Archäologische Wissenschaften","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/261","German","History",0,"open","no","10-08","2f"],
  ["fr","freiburg-betriebswirtschaftslehre-public-and-non-profit-management","Betriebswirtschaftslehre (Public and Non-Profit Management)","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/364","German","Business & Management",0,"nc","no","07-15",""],
  ["fr","freiburg-bildungswissenschaft-und-bildungsmanagement","Bildungswissenschaft und Bildungsmanagement","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/405","German","Business & Management; Education",0,"nc","no","07-15","2f"],
  ["fr","freiburg-biologie","Biologie","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/302","German","Biology & Life Sciences",1,"nc","no","07-15",""],
  ["fr","freiburg-chemie","Chemie","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/259","German","Chemistry",1,"open","no","10-08",""],
  ["fr","freiburg-deutsche-sprach-und-literaturwissenschaft","Deutsche Sprach- und Literaturwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/27","German","Languages & Literature",0,"open","no","10-08","2f"],
  ["fr","freiburg-embedded-systems-engineering","Embedded Systems Engineering","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/321","German; English","Engineering",1,"open","no","10-08",""],
  ["fr","freiburg-empirische-kulturwissenschaft","Empirische Kulturwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/777","German","Sociology & Anthropology",0,"open","no","10-08","2f"],
  ["fr","freiburg-english-and-american-studies-anglistik-und-amerikanistik","English and American Studies/Anglistik und Amerikanistik","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/31","German; English","Languages & Literature",0,"special","no","09-30","2f"],
  ["fr","freiburg-frankomedia-franzoesische-sprache-literatur-und-medienkultur","FrankoMedia – Französische Sprache, Literatur und Medienkultur","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/684","German; French","Languages & Literature; Media & Communication",0,"special","no","09-30","2f"],
  ["fr","freiburg-geographie","Geographie","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/404","German","Environmental Sciences",1,"nc","no","07-15",""],
  ["fr","freiburg-geowissenschaften","Geowissenschaften","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/177","German","Environmental Sciences",1,"open","no","10-08",""],
  ["fr","freiburg-geschichte","Geschichte","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/200","German","History",0,"open","no","10-08","2f"],
  ["fr","freiburg-iberocultura-spanische-sprache-literatur-und-kultur","IberoCultura – Spanische Sprache, Literatur und Kultur","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/179","German","Languages & Literature",0,"special","no","09-30","2f"],
  ["fr","freiburg-informatik","Informatik","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/66","German; English","Computer Science",1,"open","no","10-08",""],
  ["fr","freiburg-islamwissenschaft","Islamwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/201","German","Languages & Literature",0,"open","no","10-08","2f"],
  ["fr","freiburg-judaistik","Judaistik","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/262","German","History",0,"open","no","10-08","2f"],
  ["fr","freiburg-katholisch-theologische-studien","Katholisch-Theologische Studien","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/312","German","Philosophy",0,"open","no","10-08",""],
  ["fr","freiburg-klassische-philologie","Klassische Philologie","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/366","German","Languages & Literature",0,"special","no","09-30","2f"],
  ["fr","freiburg-kunstgeschichte","Kunstgeschichte","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/91","German","History; Art & Design",0,"open","no","10-08","2f"],
  ["fr","freiburg-mathematik","Mathematik","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/303","German","Mathematics",1,"open","no","10-08",""],
  ["fr","freiburg-medienkulturwissenschaft","Medienkulturwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/341","German","Sociology & Anthropology; Media & Communication",0,"nc","no","07-15","2f"],
  ["fr","freiburg-mikrosystemtechnik","Mikrosystemtechnik","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/111","German","Engineering",1,"open","no","10-08",""],
  ["fr","freiburg-molekulare-medizin","Molekulare Medizin","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/760","German","Biology & Life Sciences; Medicine & Health",1,"nc","no","07-15",""],
  ["fr","freiburg-musikwissenschaft","Musikwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/264","German","Art & Design",0,"open","no","10-08","2f"],
  ["fr","freiburg-neuere-und-neueste-geschichte","Neuere und Neueste Geschichte","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/203","German","History",0,"open","no","10-08","2f"],
  ["fr","freiburg-pharmazeutische-wissenschaften","Pharmazeutische Wissenschaften","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/324","German","Chemistry",1,"nc","no","07-15",""],
  ["fr","freiburg-philosophie","Philosophie","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/188","German","Philosophy",0,"nc","no","07-15","2f"],
  ["fr","freiburg-physik","Physik","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/304","German","Physics",1,"open","no","10-08",""],
  ["fr","freiburg-politikwissenschaft","Politikwissenschaft","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/190","German","Politics & International Relations",0,"nc","no","07-15","2f"],
  ["fr","freiburg-psychologie","Psychologie","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/258","German","Psychology",0,"nc","?","07-15",""],
  ["fr","freiburg-regio-chimica","Regio Chimica","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/342","German; English; French","Chemistry",1,"nc","no","07-15",""],
  ["fr","freiburg-romanische-sprachen-und-literaturen","Romanische Sprachen und Literaturen","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/769","German","Languages & Literature",0,"special","no","09-30","2f"],
  ["fr","freiburg-sinologie","Sinologie","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/265","German","Languages & Literature",0,"open","no","10-08","2f"],
  ["fr","freiburg-skandinavistik","Skandinavistik","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/142","German","Languages & Literature",0,"open","no","10-08","2f"],
  ["fr","freiburg-slavistik","Slavistik","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/144","German","Languages & Literature",0,"open","no","10-08","2f"],
  ["fr","freiburg-sozial-und-kulturanthropologie","Sozial- und Kulturanthropologie","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/784","German","Sociology & Anthropology",0,"open","no","10-08","2f"],
  ["fr","freiburg-soziologie","Soziologie","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/267","German","Sociology & Anthropology",0,"nc","no","07-15","2f"],
  ["fr","freiburg-sportwissenschaft-bewegung-und-gesundheit","Sportwissenschaft – Bewegung und Gesundheit","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/680","German","Medicine & Health",0,"nc","waivable","07-15",""],
  ["fr","freiburg-sustainable-systems-engineering","Sustainable Systems Engineering","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/723","German","Engineering",1,"open","no","10-08",""],
  ["fr","freiburg-umweltnaturwissenschaften","Umweltnaturwissenschaften","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/757","German","Environmental Sciences",1,"nc","no","07-15",""],
  ["fr","freiburg-volkswirtschaftslehre","Volkswirtschaftslehre","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/305","German","Economics",0,"open","no","10-08",""],
  ["fr","freiburg-vorderasiatische-altertumskunde","Vorderasiatische Altertumskunde","BA","https://uni-freiburg.de/studium/studienangebot/studiengang/268","German","History",0,"open","no","10-08","2f"],
  ["fr","freiburg-waldwissenschaften","Waldwissenschaften","BSc","https://uni-freiburg.de/studium/studienangebot/studiengang/758","German","Environmental Sciences",1,"nc","no","07-15",""],
  ["tue","tuebingen-aegyptologie","Ägyptologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/aegyptologie-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
  ["tue","tuebingen-allgemeine-rhetorik","Allgemeine Rhetorik","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/allgemeine-rhetorik-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-allgemeine-sprachwissenschaft","Allgemeine Sprachwissenschaft","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/allgemeine-sprachwissenschaft-bachelor-hauptfach/","German; English","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-altorientalische-philologie","Altorientalische Philologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/altorientalische-philologie-bachelor-hauptfach/","German","History; Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-biochemie","Biochemie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/biochemie-bachelor-mono/","German","Chemistry; Biology & Life Sciences",1,"nc","no","",""],
  ["tue","tuebingen-bioinformatik","Bioinformatik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/bioinformatik-bachelor-mono/","German","Computer Science; Biology & Life Sciences",1,"nc","no","",""],
  ["tue","tuebingen-biologie","Biologie","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/biologie-bachelor-mono/","German","Biology & Life Sciences",1,"nc","no","",""],
  ["tue","tuebingen-chemie","Chemie","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/chemie-bachelor-mono/","German","Chemistry",1,"open","no","",""],
  ["tue","tuebingen-deutsch-als-zweitsprache-sprachdiagnostik-und-sprachfoerderung","Deutsch als Zweitsprache: Sprachdiagnostik und Sprachförderung","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/deutsch-als-zweitsprache-sprachdiagnostik-und-sprachfoerderung-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-economics-and-business-administration","Economics and Business Administration","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/economics-and-business-administration-bachelor-mono/","German; English","Economics; Business & Management",0,"nc","no","",""],
  ["tue","tuebingen-empirische-bildungsforschung-und-paedagogische-psychologie","Empirische Bildungsforschung und Pädagogische Psychologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/empirische-bildungsforschung-und-paedagogische-psychologie-bachelor-mono/","German","Psychology; Education",0,"nc","no","",""],
  ["tue","tuebingen-empirische-kulturwissenschaft","Empirische Kulturwissenschaft","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/empirische-kulturwissenschaft-bachelor-hauptfach/","German","Sociology & Anthropology",0,"open","no","","hf"],
  ["tue","tuebingen-erziehungswissenschaft-und-soziale-arbeit-erwachsenenbildung","Erziehungswissenschaft und Soziale Arbeit / Erwachsenenbildung","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/erziehungswissenschaft-und-soziale-arbeit-erwachsenenbildung-bachelor-mono/","German","Education",0,"nc","no","",""],
  ["tue","tuebingen-ethnologie-social-and-cultural-anthropology","Ethnologie/Social and Cultural Anthropology","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/ethnologie-bachelor-hauptfach/","German","Sociology & Anthropology",0,"open","no","","hf"],
  ["tue","tuebingen-franzoesisch","Französisch","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/franzoesisch-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-geographie","Geographie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/geographie-bachelor-mono/","German","Environmental Sciences",1,"open","no","",""],
  ["tue","tuebingen-geooekologie","Geoökologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/geooekologie-bachelor-mono/","German","Environmental Sciences",1,"nc","no","",""],
  ["tue","tuebingen-geowissenschaften","Geowissenschaften","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/geowissenschaften-bachelor-mono/","German","Environmental Sciences",1,"open","no","",""],
  ["tue","tuebingen-germanistik","Germanistik","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/germanistik-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-geschichtswissenschaft","Geschichtswissenschaft","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/geschichtswissenschaft-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
  ["tue","tuebingen-griechisch","Griechisch","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/griechisch-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-indologie-south-asian-studies","Indologie/South Asian Studies","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/indologiesouth-asian-studies-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-informatik","Informatik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/informatik-bachelor-mono/","German","Computer Science",1,"open","no","",""],
  ["tue","tuebingen-interdisciplinary-american-studies","Interdisciplinary American Studies","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/interdisciplinary-american-studies-bachelor-mono/","English","Languages & Literature",0,"open","no","",""],
  ["tue","tuebingen-international-business-administration","International Business Administration","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/international-business-administration-bachelor-mono/","German; English","Business & Management",0,"nc","no","",""],
  ["tue","tuebingen-international-economics","International Economics","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/international-economics-bachelor-mono/","German; English","Economics",0,"open","no","",""],
  ["tue","tuebingen-internationale-literaturen","Internationale Literaturen","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/internationale-literaturen-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-islamische-theologie","Islamische Theologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/islamische-theologie-bachelor-mono/","German","Philosophy; Languages & Literature",0,"open","no","",""],
  ["tue","tuebingen-italienisch","Italienisch","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/italienisch-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-japanologie-japanese-studies","Japanologie/Japanese Studies","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/japanologiejapanese-studies-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-judaistik","Judaistik","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/judaistik-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
  ["tue","tuebingen-katholische-theologie","Katholische Theologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/katholische-theologie-bachelor-hauptfach/","German","Philosophy",0,"open","no","","hf"],
  ["tue","tuebingen-klassische-archaeologie","Klassische Archäologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/klassische-archaeologie-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
  ["tue","tuebingen-kognitionswissenschaft","Kognitionswissenschaft","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/kognitionswissenschaft-bachelor-mono/","German","Biology & Life Sciences",1,"nc","no","",""],
  ["tue","tuebingen-koreanistik-korean-studies","Koreanistik/Korean Studies","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/koreanistik-bachelor-hauptfach/","German; English","Languages & Literature",0,"nc","no","","hf"],
  ["tue","tuebingen-kunstgeschichte","Kunstgeschichte","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/kunstgeschichte-bachelor-hauptfach/","German","History; Art & Design",0,"open","no","","hf"],
  ["tue","tuebingen-latein","Latein","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/latein-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-mathematik","Mathematik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/mathematik-bachelor-mono/","German","Mathematics",1,"open","no","",""],
  ["tue","tuebingen-medieninformatik","Medieninformatik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/medieninformatik-bachelor-mono/","German","Computer Science; Media & Communication",1,"open","no","",""],
  ["tue","tuebingen-medienwissenschaft","Medienwissenschaft","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/medienwissenschaft-bachelor-hauptfach/","German","Media & Communication",0,"nc","no","","hf"],
  ["tue","tuebingen-medizininformatik","Medizininformatik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/medizininformatik-bachelor-mono/","German; English","Computer Science; Medicine & Health",1,"nc","no","",""],
  ["tue","tuebingen-medizintechnik","Medizintechnik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/medizintechnik-bachelor-mono/","German","Engineering; Medicine & Health",1,"nc","no","",""],
  ["tue","tuebingen-molekulare-medizin","Molekulare Medizin","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/molekulare-medizin-bachelor-mono/","German","Biology & Life Sciences; Medicine & Health",1,"nc","no","",""],
  ["tue","tuebingen-musikwissenschaft","Musikwissenschaft","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/musikwissenschaft-bachelor-hauptfach/","German","Art & Design",0,"open","no","","hf"],
  ["tue","tuebingen-nano-science","Nano-Science","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/nano-science-bachelor-mono/","German","Physics",1,"open","no","",""],
  ["tue","tuebingen-philosophie","Philosophie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/philosophie-bachelor-hauptfach/","German","Philosophy",0,"open","no","","hf"],
  ["tue","tuebingen-physik","Physik","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/physik-bachelor-mono/","German","Physics",1,"open","no","",""],
  ["tue","tuebingen-politikwissenschaft","Politikwissenschaft","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/politikwissenschaft-bachelor-hauptfach/","German; English","Politics & International Relations",0,"nc","no","","hf"],
  ["tue","tuebingen-psychologie","Psychologie","BSc","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/psychologie-bachelor-mono/","German","Psychology",0,"nc","no","",""],
  ["tue","tuebingen-religionswissenschaft","Religionswissenschaft","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/religionswissenschaft-bachelor-hauptfach/","German","Philosophy",0,"open","no","","hf"],
  ["tue","tuebingen-sinologie-chinese-studies","Sinologie / Chinese Studies","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sinologie-chinese-studies-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-slavistik","Slavistik","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/slavistik-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-soziale-arbeit-und-weiterbildung","Soziale Arbeit und Weiterbildung","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/soziale-arbeit-und-weiterbildung-bachelor-mono/","German","Education",0,"nc","no","",""],
  ["tue","tuebingen-soziologie","Soziologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/soziologie-bachelor-hauptfach/","German","Sociology & Anthropology",0,"open","no","","hf"],
  ["tue","tuebingen-spanisch","Spanisch","BA","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/spanisch-bachelor-hauptfach/","German","Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-sportwissenschaft-mit-dem-profil-coaching-im-sport","Sportwissenschaft mit dem Profil Coaching im Sport","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sportwissenschaft-mit-dem-profil-coaching-im-sport-bachelor-mono/","German","Medicine & Health",0,"nc","yes","",""],
  ["tue","tuebingen-sportwissenschaft-mit-dem-profil-gesundheitsfoerderung","Sportwissenschaft mit dem Profil Gesundheitsförderung","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sportwissenschaft-mit-dem-profil-gesundheitsfoerderung-bachelor-mono/","German","Medicine & Health",0,"nc","yes","",""],
  ["tue","tuebingen-sportwissenschaft-mit-dem-profil-medien-und-kommunikation","Sportwissenschaft mit dem Profil Medien und Kommunikation","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sportwissenschaft-mit-dem-profil-medien-und-kommunikation-bachelor-mono/","German","Medicine & Health; Media & Communication",0,"nc","yes","",""],
  ["tue","tuebingen-sportwissenschaft-mit-dem-profil-sportmanagement","Sportwissenschaft mit dem Profil Sportmanagement","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sportwissenschaft-mit-dem-profil-sportmanagement-bachelor-mono/","German","Medicine & Health; Business & Management",0,"nc","yes","",""],
  ["tue","tuebingen-sprachen-geschichte-und-kulturen-des-nahen-ostens","Sprachen, Geschichte und Kulturen des Nahen Ostens","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/sprachen-geschichte-und-kulturen-des-nahen-ostens-bachelor-hauptfach/","German","History; Languages & Literature",0,"open","no","","hf"],
  ["tue","tuebingen-umweltnaturwissenschaften","Umweltnaturwissenschaften","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/umweltnaturwissenschaften-bachelor-mono/","German","Environmental Sciences",1,"open","no","",""],
  ["tue","tuebingen-ur-und-fruehgeschichtliche-archaeologie-und-archaeologie-des-mittelalters","Ur- und Frühgeschichtliche Archäologie und Archäologie des Mittelalters","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/ur-und-fruehgeschichtliche-archaeologie-und-archaeologie-des-mittelalters-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
  ["tue","tuebingen-vorderasiatische-archaeologie-und-palaestina-archaeologie","Vorderasiatische Archäologie und Palästina-Archäologie","","https://uni-tuebingen.de/studium/studienangebot/verzeichnis-der-studiengaenge/detail/course/vorderasiatische-archaeologie-und-palaestina-archaeologie-bachelor-hauptfach/","German","History",0,"open","no","","hf"],
];
for (const [u, programme_id, programme, degree_type, official_url, language, subject_area, stem, adm, entrance_exam, mmdd, combo] of ROWS3) {
  const other = [];
  let application_deadline = '', deadline_notes = '', admission = '';
  if (adm === 'nc') admission = U3[u].nc;
  if (adm === 'varies') admission = 'Restricted (NC) or open: decided each year';
  if (adm === 'special') { admission = 'Entry check on school subjects (no test)'; other.push(FR_SPECIAL[programme_id]); }
  if (u === 'kit') { application_deadline = `2027-${mmdd}`; deadline_notes = mmdd === '07-15' ? 'Apply by 15 July.' : 'EU applicants: by 15 September. Non-EU applicants: by 15 July.'; }
  if (u === 'rwth') { application_deadline = adm === 'nc' ? '2027-07-15' : '2027-10-20'; deadline_notes = 'International applicants: restricted subjects by 15 July, open subjects by 20 October.'; }
  if (u === 'tu') { application_deadline = adm === 'nc' ? '2027-07-15' : '2027-08-31'; deadline_notes = `Apply 1 June to ${adm === 'nc' ? '15 July' : '31 August'} (2026 dates). Foreign certificates also need a uni-assist VPD.`; }
  if (u === 'fu') { application_deadline = '2027-07-15'; deadline_notes = 'Restricted subjects 1 June to 15 July, open subjects until 1 September (2026 dates); 2027 status published in summer. Foreign certificates also need a uni-assist VPD.'; }
  if (u === 'fr') { application_deadline = mmdd ? `2027-${mmdd}` : ''; deadline_notes = mmdd ? `Apply 1 June to ${Number(mmdd.slice(3))} ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}.` : ''; }
  if (u === 'tue') { application_deadline = adm === 'nc' ? '2027-07-15' : '2027-09-30'; deadline_notes = adm === 'nc' ? 'Restricted: apply by 15 July.' : 'Open: international applicants apply by 30 September.'; }
  if (combo === 'kombi') other.push('Kombi-Bachelor: combine with a second subject');
  if (combo === '2f' || combo === 'hf') other.push('Major: combine with a minor subject');
  if (u === 'tue' && /sportwissenschaft/.test(programme_id)) other.push('Sports entrance test (Sporteingangsprüfung)');
  if (programme_id === 'freiburg-sportwissenschaft-bewegung-und-gesundheit') other.push('Sport grades from school, or a passed sports entrance test');
  PROGS.push({ programme_id, university_id: UNI3[u], programme, degree_type, official_url, language, subject_area, entrance_exam,
    english_requirement: U3[u].de, ...(stem ? STEM : ANY), ...(admission ? { admission } : {}), other_requirements: other.filter(Boolean).join(' · '),
    application_deadline, deadline_notes });
}

// -------------------------------------------------------------------- write
const unis = read(new URL('universities.csv', DATA));
const uniRows = UNIS.map((u) => Object.fromEntries(unis.head.map((h) => [h, u[h] ?? '']))).map((u) => ({ ...u, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const uniIds = new Set(uniRows.map((u) => u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...unis.rows.filter((u) => !uniIds.has(u.university_id)), ...uniRows]);
const progs = read(new URL('programmes.csv', DATA));
for (const p of PROGS) {
  for (const k of Object.keys(p)) if (!progs.head.includes(k)) throw new Error(`${p.programme_id}: unknown column ${k}`);
  if (!uniIds.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university ${p.university_id}`);
}
const progRows = PROGS.map((p) => Object.fromEntries(progs.head.map((h) => [h, p[h] ?? '']))).map((p) => ({ ...p, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const ids = new Set(progRows.map((p) => p.programme_id));
if (ids.size !== progRows.length) throw new Error('duplicate programme_id');
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((p) => !ids.has(p.programme_id)), ...progRows]);
console.log(`Germany: ${uniRows.length} universities, ${progRows.length} programmes`);
