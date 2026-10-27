// One-off: admission corrections found while checking entrance exams, 2026-10-27.
//
//   node tools/fix-admission-2026-10-27.mjs
//
// Every value below was read on the official page named next to it.
//
// Groningen. rug.nl/education/application-enrolment-tuition-fees/admission/
// non-dutch-qualification/fixus-non-dutch-qualification: "De Rijksuniversiteit
// Groningen heeft 5 bacheloropleidingen met een numerus fixus … Geneeskunde (400
// plaatsen), International Business (400 plaatsen), Psychologie (Nederlandse
// track) (390 plaatsen), Psychologie (Engelse track) (225 plaatsen),
// Tandheelkunde (69 plaatsen)". So Artificial Intelligence, Computing Science
// and UCG are not numerus fixus. AI page: "please choose the option without the
// 'Numerus fixus programme' label", EU/EEA deadline "01 mei 2027". UCG
// (rug.nl/ucg/application/): "is not classified as a "numerus fixus"; instead
// it operates on a selective basis"; the motivation video "plays a central role
// in the final decision"; Early Bird 15 January 2027, final deadline 1 May 2027.
//
// Tilburg. Each programme's /application page (IBA, Economics, Global Law,
// CSAI, Econometrics, EBI): "EEA Nationals May 1 / Non-EEA Nationals April 1";
// "You meet all of our admissions requirements and will be admitted"; then a
// mandatory matching step ("Please note: this is a mandatory step"). Open
// entry with matching, not selective.
//
// Erasmus. IBEB admission page: "For 2027-2028, 500 seats are available".
// Econometrics admission page: "Mathematics: Analysis & Approaches HL minimum
// grade 5. Students studying Analysis & Approaches SL with a minimum grade of 6
// can register for the mathematics entrance exam".
//
// Leiden University College, how-to-apply page: "All applicants for LUC have to
// go through a selection process" (pre-admission class, written reflection,
// holistic review). Archaeology matching page: "After you have submitted your
// application for the Archaeology bachelor's programme (before 1 May) … we will
// send you an invitation to complete the Matching module".
// UCR (ucr.nl/admissions/application-process/): "Apply by May 1 if you are not
// applying for a scholarship and have a European passport"; Kira assessment of
// six questions "about yourself and your experiences", then a decision.
//
// SDU uniTEST (sdu.dk/en/uddannelse/bachelor/mechanical-engineering/
// civilingenioer/adgangskrav/unitest): "If your grades can be converted to the
// Danish grading system, your application may be assessed in quota 1 … If you
// wish to be considered for places allocated through quota 2, you must register
// for the uniTEST"; "All non-EU/EEA citizens will be invited to take the
// uniTEST".
//
// Ireland. The old labels came from CAO course codes and several were wrong:
//   TCD Music: "formal musical training is not a prerequisite for entry"; no
//     audition listed. TCD Drama: "you will be sent a questionnaire to complete
//     in March". TCD Nursing: health screening and Garda vetting only. TCD
//     Medicine: "all EU applicants applying via CAO will be required to sit the
//     admissions test (HPAT – Ireland)". TCD Music Education: "called for an
//     interview/audition … a score of up to 200". TCD Stage Management: "Entry
//     is by interview and everyone who applies will get an interview".
//   UCD Music, Music (BA Humanities), Music Film & Drama, Drama Studies,
//     English Drama & Film: entry requirements list grades only; auditions are
//     for some performance modules after you start. UCD Veterinary Medicine:
//     "at least 60 hours practical experience relevant to animal handling".
//   UCC Arts-Music (CK104): "Applicants must pass a music entrance exam".
//     Theatre (CK112): "apply for and sit the admissions interview and music
//     test". Youth and Community Work (CK114): "An interview will be used as an
//     additional selection mechanism". Medicine (CK701): HPAT. Graduate-entry
//     Medicine (CK791): GAMSAT.
//   Galway Drama (GY118): "Students are not required to audition or submit
//     portfolios". Medicine (GY501): "HPAT CAO applicants must complete the
//     Health Professions Admission Test (HPAT)". Hotel Management (Shannon
//     College): "Interviews are normally held in April and July".
//   DCU Religious Education and Music: "Applicants must take music aural and
//     performance tests". Jazz: "achieve the minimum threshold of 120 points in
//     the Entrance Test" plus an audition.
//   UL entry-requirements pages: "(Audition required)" for Contemporary Dance,
//     Irish Dance, Irish Music, Music, Voice. Architecture: "must submit a
//     digital portfolio and a written statement … up to 200 points". Product
//     Design: "CAO points and (ii) a portfolio submission". Paramedic Studies:
//     driving licences only. Music, Media and Performance Technology: no
//     audition or portfolio, just the maths grade.
//
// ČVUT Faculty of Architecture (fa.cvut.cz/cs/uchazeci/bc-programy/): "absolvujete
// testy obecných studijních předpokladů (SCIO), testy prostorové představivosti
// a všeobecného přehledu a zejména nejdůležitější část – talentové zkoušky".
//
// Re-runnable: every value is set, never appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const url = new URL('../data/programmes.csv', import.meta.url);
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const [head, ...rows] = parseCsv(readFileSync(url, 'utf8'));
const c = (n) => head.indexOf(n);
const byId = new Map(rows.map((r) => [r[c('programme_id')], r]));
let n = 0;
const set = (id, fields) => {
  const r = byId.get(id);
  if (!r) throw new Error(`no row ${id}`);
  for (const [k, v] of Object.entries(fields)) { if (c(k) < 0) throw new Error(k); r[c(k)] = v; }
  r[c('last_verified')] = '2026-10-27';
  n++;
};

const OPEN = 'Open entry: meet the requirements, get a place';
const SELECTIVE = 'Selective: assessed on your application';

// Groningen
const RUG_NOTE = "In Studielink, choose the option without the 'Numerus fixus programme' label. Early Bird: apply between 1 October and 28 February for a decision within a month.";
for (const id of ['rug-ai', 'rug-cs']) set(id, { admission: OPEN, other_requirements: '', application_deadline: '2027-05-01', deadline_notes: RUG_NOTE });
set('rug-ucg', {
  admission: SELECTIVE,
  other_requirements: 'Motivation video',
  application_deadline: '2027-05-01',
  deadline_notes: 'Final deadline 1 May; Early Bird deadline 15 January. Build your own curriculum at University College Groningen. September intake (the February intake closes 1 January).',
});
set('rug-ib', { other_requirements: 'Numerus fixus (400 places) · Online Fit & Benchmarking activity with an aptitude quiz' });
set('rug-psy', { other_requirements: 'Numerus fixus (225 places) · Online selection test' });

// Tilburg
const TB_NOTE = 'EEA nationals: 1 May. Non-EEA nationals: 1 April.';
for (const id of ['tb-iba', 'tb-econ', 'tb-globallaw', 'tb-csai', 'tb-eor', 'tb-ebi']) {
  set(id, { admission: OPEN, other_requirements: 'Mandatory matching after admission', application_deadline: '2027-05-01', deadline_notes: TB_NOTE });
}
set('tb-psy', { other_requirements: 'Numerus fixus · Knowledge test and motivation assignment' });

// Erasmus
set('eur-ibeb', {
  other_requirements: 'Numerus fixus (500 places) · Grades plus weighted lottery · Online curriculum-based activity (pass/fail)',
  deadline_notes: 'Deadline 15 January. Places 1-250 go to the best grades among those who passed the activity; the rest by weighted lottery.',
});
set('eur-ibeor', { other_requirements: 'Maths entrance exam if you take AA SL (6+) instead of AA HL 5' });
set('eur-ibp', { other_requirements: 'Numerus fixus (600 places) · Online knowledge test and motivation/study-attitude test · Max 3 selection attempts' });

// Leiden, Utrecht
set('lei-luc', { admission: SELECTIVE, other_requirements: 'Online pre-admission class and written reflection' });
set('lei-archaeology', { admission: OPEN, other_requirements: 'Mandatory matching', application_deadline: '2027-05-01', deadline_notes: '' });
set('uu-ucr', {
  admission: SELECTIVE,
  other_requirements: 'Online Kira assessment (six questions about yourself)',
  application_deadline: '2027-05-01',
  deadline_notes: 'Based in Middelburg, not Utrecht. 1 May for European passports; 1 March if you also apply for a scholarship.',
});

// SDU
set('sdu-ite', { other_requirements: 'uniTEST is optional for IB holders: converted grades count in quota 1; take it to compete in quota 2 too (non-EU applicants must take it) · Register by 20 March 12:00; test 17-18 April 2027 in Odense or 20-25 April online · 2026: all qualified applicants admitted (about 30 places)' });

// Ireland
const IE = {
  'tcd-music': '',
  'tcd-drama-and-theatre-studies': 'Questionnaire in March',
  'tcd-nursing---general-nursing-adel': 'Health screening and Garda vetting',
  'tcd-medicine': 'HPAT admission test',
  'tcd-music-education': 'Interview and audition (up to 200 extra points)',
  'tcd-stage-management-and-technical': 'Interview',
  'ucd-music': '',
  'ucd-music-ba-humanities': '',
  'ucd-music-film-drama': '',
  'ucd-drama-studies': '',
  'ucd-english-drama-film': '',
  'ucd-veterinary-medicine': 'At least 60 hours of practical animal-handling experience',
  'ucc-arts-music': 'Music entrance exam (usually April)',
  'ucc-theatre-and-performative-practices': 'Admission interview and music test',
  'ucc-youth-and-community-work': 'Interview',
  'ucc-medicine': 'HPAT admission test',
  'ucc-medicine-graduate-entry': 'GAMSAT admission test',
  'galway-bachelor-of-arts-drama-theatre-and-pe': '',
  'galway-bachelor-of-medicine-mb-of-surgery-bc': 'HPAT admission test',
  'galway-bachelor-of-business-studies-internat': 'Interview (adds points)',
  'galway-bachelor-of-commerce-in-international': 'Interview (adds points)',
  'dcu-bachelor-of-religious-education-and-musi': 'Music aural and performance tests',
  'dcu-jazz-and-contemporary-music-performance': 'Entrance test and audition',
  'ul-contemporary-dance-ba': 'Audition',
  'ul-irish-dance-ba': 'Audition',
  'ul-irish-music-ba': 'Audition',
  'ul-music-ba': 'Audition',
  'ul-voice-ba': 'Audition',
  'ul-architecture-barch': 'Portfolio and written statement (up to 200 extra points)',
  'ul-product-design-and-technology-bsc': 'Portfolio',
  'ul-paramedic-studies-bsc': 'Full B and provisional C1 driving licence',
  'ul-music-media-and-performance-technology-bs': '',
};
for (const [id, v] of Object.entries(IE)) set(id, { other_requirements: v });

// ČVUT Faculty of Architecture
for (const id of ['cvut-design', 'cvut-krajinarska-architektura']) set(id, { admission: 'Talent exam + Scio and spatial tests' });

writeFileSync(url, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`updated ${n} rows`);
