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
];

const STEM = { ib_maths: 'AA HL · AI HL', ib_subjects: 'Maths HL (AA or AI); SL only if your school is in the KMK annex' };
const ANY = { ib_maths: 'AA HL · AA SL · AI HL · AI SL', ib_subjects: 'none' };
const JUL15 = { application_deadline: '2027-07-15', deadline_notes: 'Winter semester: apply by 15 July.' };
const NC = 'Restricted places (numerus clausus): ranked on your converted IB grade';
const daad = (id) => `https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/${id}/`;

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
  ['regensburg-liberal-arts', 'regensburg', 'Liberal Arts: Culture, History, Society', 'Liberal Arts; History', 'BA', 'https://www.uni-regensburg.de/en/philosophie-kunst-geschichte-gesellschaft/institut-fuer-geschichte/lehrstuhl-fuer-europaeische-geschichte-19-und-20-jahrhundert/ba-liberal-arts-culture-history-society', 0, { ...JUL15, admission: 'Special aptitude assessment', entrance_exam: '?' }],
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
  ['whu-iba', 'whu', 'International Business Administration', 'Business & Management', 'BSc', 'https://www.whu.edu/en/programs/bachelor-program/bachelor-in-international-business-administration/', 0, { tuition_eu: '18200', application_deadline: '2027-05-15', deadline_notes: 'Rounds close 31 January, 31 March and 15 May 2027. Fee: €9,100 a semester.', entrance_exam: '?', other_requirements: 'Motivation letter and CV · WHU admission round · Six-week internship before the start', english_requirement: 'English C1 · IELTS 6.5' }],
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
  ['saarland-cybersecurity', 'saarland', 'Cybersecurity', 'Computer Science', 'BSc', 'https://cysec.uni-saarland.de/bachelor/cybersecurity', 1, { application_deadline: '2027-07-15', deadline_notes: 'Regular deadline 15 July (interview track 15 June); early admission by 15 January.', admission: 'Competitive admission', entrance_exam: '?', english_requirement: 'English C1' }],
  ['saarland-computer-science', 'saarland', 'Computer Science', 'Computer Science', 'BSc', 'https://saarland-informatics-campus.de/en/computerscience-course/', 1, { ...JUL15, admission: 'Competitive: choose one of three application tracks', entrance_exam: '?', english_requirement: 'English B2' }],
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
  ['anglistik-bachelor-hauptfach-2839', 'english-studies', 'Anglistik (English Studies)', 'Languages & Literature', 'BA', 0, 0, '?'],
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
  ['chemie/chemie-bachelor-100', 'chemistry', 'Chemie (Chemistry)', 'Chemistry', 'BSc', 1, 'exam', 100],
  ['christentum-und-kultur/christentum-und-kultur-bachelor-50', 'christianity-culture', 'Christentum und Kultur (Christianity and Culture)', 'Philosophy', 'BA', 0, 'open', 50],
  ['computerlinguistik/computerlinguistik-bachelor-100', 'computational-linguistics', 'Computerlinguistik (Computational Linguistics)', 'Computer Science; Languages & Literature', 'BA', 1, 'open', 100],
  ['english-studiesanglistik/english-studiesanglistik-bachelor-75', 'english-studies', 'English Studies / Anglistik', 'Languages & Literature', 'BA', 0, 'exam', 75],
  ['ethnologie/ethnologie-bachelor-75', 'anthropology', 'Ethnologie (Anthropology)', 'Sociology & Anthropology', 'BA', 0, 'open', 75],
  ['europaeische-kunstgeschichte/europaeische-kunstgeschichte-bachelor-75', 'art-history', 'Europäische Kunstgeschichte (European Art History)', 'Art & Design; History', 'BA', 0, 'open', 75],
  ['evangelische-theologie/evangelische-theologie-bachelor-50', 'protestant-theology', 'Evangelische Theologie (Protestant Theology)', 'Philosophy', 'BA', 0, 'open', 50],
  ['franzoesisch-romanistik/franzoesischromanistik-bachelor-50', 'french', 'Französisch / Romanistik (French Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['geographie/geographie-bachelor-100', 'geography', 'Geographie (Geography)', 'Environmental Sciences', 'BSc', 1, 'open', 100],
  ['geowissenschaften/geowissenschaften-bachelor-100', 'geosciences', 'Geowissenschaften (Geosciences)', 'Environmental Sciences', 'BSc', 1, 'open', 100],
  ['germanistik-im-kulturvergleich/germanistik-im-kulturvergleich-bachelor-75', 'german-intercultural', 'Germanistik im Kulturvergleich (German Studies in Cultural Comparison)', 'Languages & Literature', 'BA', 0, 'open', 75],
  ['germanistikdeutsch/germanistik-bachelor-50', 'german-studies', 'Germanistik / Deutsch (German Studies)', 'Languages & Literature', 'BA', 0, 'open', 50],
  ['geschichte/geschichte-bachelor-75', 'history', 'Geschichte (History)', 'History', 'BA', 0, 'open', 75],
  ['informatik/informatik-bachelor-100', 'computer-science', 'Informatik (Computer Science)', 'Computer Science', 'BSc', 1, 'exam', 100],
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
  ['physik/physik-bachelor-100', 'physics', 'Physik (Physics)', 'Physics', 'BSc', 1, 'exam', 100],
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
  exam: { ...HD_SEL, admission: 'Admission procedure (Aufnahmeprüfungsverfahren)', entrance_exam: '?' },
  sport: { ...HD_OPEN, entrance_exam: 'yes', other_requirements: 'Sports entrance test (Sporteingangsprüfung)' },
};
for (const [path, id, programme, subject_area, degree_type, stem, kind, share] of HD_ROWS) {
  const combo = share === 100 ? [] : [share === 75 ? 'Major (75%): add a 25% minor' : 'Two-subject degree (50%): add a second 50% subject'];
  const k = HD_KIND[kind];
  PROGS.push({ programme_id: `heidelberg-${id}`, university_id: 'heidelberg', programme, subject_area, degree_type, official_url: hdUrl(path),
    language: 'German', english_requirement: id === 'molecular-biotechnology' ? HD_DE.replace('(by enrolment)', '(at application)') : HD_DE,
    ...(stem ? STEM : ANY), ...k, other_requirements: [k.other_requirements, ...combo].filter(Boolean).join(' · ') });
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
