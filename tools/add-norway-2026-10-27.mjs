// One-off: add Norway's English-taught bachelor programmes, checked 2026-10-27.
//
//   node tools/add-norway-2026-10-27.mjs
//
// The list. Study in Norway (studyinnorway.no, run by the Norwegian
// Directorate for Higher Education and Skills) lists "full degree programmes
// taught in English"; with the Bachelor filter it shows 31. Kept: those at
// universities and specialised universities, as for the other countries.
// Left out: Inland Norway University of Applied Sciences and the university
// colleges (Noroff, Kristiania, Fjellhaug, HLT); the University of Stavanger's
// Bachelor in Dance (uis.no answers 403 to this machine); the Norwegian
// Academy of Music's two (its classical programme says "Undervisningen vil
// hovedsakelig være på norsk", and its conducting page does not say the
// teaching is in English); Nord's Animal Science (a Norwegian-language page
// whose entry line asks for "norsk 112 timer").
//
// Applicants with a school diploma from outside the Nordic countries apply
// directly to each university (not Samordna opptak, which asks for Norwegian),
// with these dates for autumn 2027:
//   UiA, each programme page: "EU/EEA applicants: From 1 February to 1 March";
//   Classical Music Performance: "Application deadline: 15 December", "Apply
//   between 1 Nov-15 Dec".
//   Nord: "Non-EU/EEA: November 1 - December 1 // EU/EEA and Nordic residents:
//   February 1 - April 15". Acting and Artistic Production: "Admission is
//   closed"; its auditions listed are for April 2026.
//   NMBU (International Environment and Development Studies): "International
//   applicants (including EU/EEA): 1 December".
//   UiO (Technology Systems, applicants without Norwegian): "The application
//   deadline is 1 December."
//   BI (admission requirements page): "a priority application deadline of …
//   March 1st for international applicants. However, we still accept
//   applications after that date based on availability."
//
// Requirements, from the same pages:
//   UiA: "Higher Education Entrance Qualification for international applicants
//   and certified language requirements in English"; Classical Music:
//   "Successful completion of entrance examinations in your main instrument,
//   aural training and theory".
//   Nord: Higher Education Entrance Qualification; "qualified candidates will
//   be ranked based on their grade points"; Biology also "Mathematics
//   R1/(S1+S2)" and further natural-science subjects (the page lists
//   "Mathematics R1+R2" and "Physics 1 + 2"); Acting: "pass the audition
//   process".
//   UiO: "mathematics equivalent to Mathematics R1 in Norwegian upper secondary
//   school" and "an additional science subject, for instance physics,
//   chemistry or biology"; "Qualified applicants are ranked based on their
//   grades from upper secondary school".
//   BI: the full IB Diploma (or IB results with 20+ points, 3+ in every
//   subject, TOK and EE passed); English A 3+ or English B 5+; Data Science
//   for Business: any IB maths course at grade 3+; tuition "NOK 106,400" per
//   year on each programme page (EU citizens pay no surcharge: "students with
//   citizenship from outside the EU/EEA/Switzerland pay a 30% tuition fee
//   differential").
// Norwegian maths codes (R1, S1+S2) are quoted as given: none of these pages
// names the IB equivalent, so ib_maths stays "?" where they apply.
//
// Living costs: UDI's study-permit page, "at least NOK 15 488 per month",
// at the ECB reference rate of 26 October 2026 (NOK 10.4545 to the euro) =
// €1,481. BI's fee: 106,400 / 10.4545 = €10,178. Public universities charge EU
// students no tuition (Nord: "No tuition fees for EU/EEA/EFTA students").
//
// Re-runnable: rows are replaced by id, not appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-27';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const NO = {
  country: 'Norway',
  application_system: "Direct (the university's international application)",
  living_cost_min: '1481', living_cost_source: 'national estimate (UDI)',
  tuition_eu_default: '0',
  baseline_requirement: 'an IB Diploma (Higher Education Entrance Qualification)',
  admission_default: 'Ranked on school grades',
};
const UNIS = [
  { university_id: 'uia', name: 'University of Agder', city: 'Kristiansand',
    english_requirement_default: 'Documented English proficiency (see the programme page)' },
  { university_id: 'nord', name: 'Nord University', city: 'Bodø' },
  // bi.no admission requirements: English A 3+ or English B 5+.
  { university_id: 'bi', name: 'BI Norwegian Business School', city: 'Oslo', tuition_eu_default: '10178',
    english_requirement_default: 'IB English A 3+ or English B 5+ · or an accepted English test',
    baseline_requirement: 'the IB Diploma, or IB results with 20+ points, 3+ in every subject, TOK and EE passed' },
  { university_id: 'nmbu', name: 'Norwegian University of Life Sciences (NMBU)', city: 'Ås' },
  // uio.no Technology Systems: English "equivalent to the grade 4 in the
  // English foundational course in Norwegian upper secondary school".
  { university_id: 'uio', name: 'University of Oslo', city: 'Oslo',
    english_requirement_default: 'English at the level of grade 4 in the Norwegian foundation course · most international applicants need an approved test' },
].map((u) => ({ ...NO, ...u }));

const UIA_NOTE = 'EU/EEA applicants: 1 February to 1 March 2027. Non-EU: 1 November to 1 December 2026.';
const NORD_NOTE = 'EU/EEA applicants: 1 February to 15 April 2027. Non-EU: 1 November to 1 December 2026. Apply through Nord\'s international application (Søknadsweb), not Samordna opptak, which requires Norwegian.';
const BI_NOTE = 'Priority deadline for international applicants; BI keeps admitting after it while places last.';

const P = (programme_id, university_id, programme, subject_area, official_url, fields) => ({
  programme_id, university_id, programme, subject_area, official_url, language: 'English', degree_type: 'Bachelor',
  ib_subjects: 'none', ib_maths: 'none', entrance_exam: 'no', ...fields,
});

const PROGS = [
  P('uia-academic-esports', 'uia', 'Academic Esports', 'Media & Communication', 'https://www.uia.no/english/studies/programmes/academic-esports-bachelor/index.html',
    { application_deadline: '2027-03-01', deadline_notes: UIA_NOTE, other_requirements: '40 places' }),
  P('uia-english', 'uia', 'English', 'Languages & Literature', 'https://www.uia.no/english/studies/programmes/english-bachelor/index.html',
    { application_deadline: '2027-03-01', deadline_notes: UIA_NOTE, other_requirements: 'Solid English, beyond the minimum of one year at upper secondary' }),
  P('uia-global-development', 'uia', 'Global Development Studies', 'Politics & International Relations; Sociology & Anthropology', 'https://www.uia.no/english/studies/programmes/global-development-studies-bachelor/index.html',
    { application_deadline: '2027-03-01', deadline_notes: UIA_NOTE, other_requirements: '45 places' }),
  P('uia-classical-music', 'uia', 'Classical Music Performance', 'Art & Design', 'https://www.uia.no/english/studies/programmes/classical-music-performance-bachelor/index.html',
    { admission: 'Entrance examinations in your main instrument, aural training and theory', entrance_exam: 'yes',
      application_deadline: '2026-12-15', deadline_notes: 'Apply 1 November to 15 December 2026.', other_requirements: '15 places' }),

  P('nord-biology', 'nord', 'Biology', 'Biology & Life Sciences', 'https://www.nord.no/en/studies/biology-bachelors-programme',
    { degree_type: 'BSc', ib_subjects: 'Maths at Norwegian R1 level (or S1 + S2), plus further science such as R2 or Physics 1 and 2 — the page names no IB equivalent', ib_maths: '?',
      application_deadline: '2027-04-15', deadline_notes: NORD_NOTE }),
  P('nord-cg-art-animation', 'nord', 'CG Art and Animation', 'Art & Design', 'https://www.nord.no/en/studies/cg-art-and-animation-bachelors-programme',
    { application_deadline: '2027-04-15', deadline_notes: NORD_NOTE }),
  P('nord-film-tv', 'nord', 'Film and TV Production', 'Art & Design; Media & Communication', 'https://www.nord.no/en/studies/film-and-tv-production-bachelors-programme',
    { application_deadline: '2027-04-15', deadline_notes: NORD_NOTE }),
  P('nord-games-entertainment', 'nord', 'Games and Entertainment Technology', 'Computer Science; Art & Design', 'https://www.nord.no/en/studies/games-and-entertainment-technology-bachelor',
    { application_deadline: '2027-04-15', deadline_notes: NORD_NOTE }),
  P('nord-acting', 'nord', 'Acting and Artistic Production', 'Art & Design', 'https://www.nord.no/en/studies/acting-and-artistic-production-bachelors-programme',
    { admission: 'Audition in rounds, ending in a four-day workshop', entrance_exam: 'yes', city: 'Levanger', other_requirements: '20 places',
      deadline_notes: 'Admission closed on the page; the auditions listed were for April 2026. 2027 dates not published yet.' }),

  P('bi-business-administration', 'bi', 'Business Administration (BBA)', 'Business & Management', 'https://www.bi.no/en/programmes-and-individual-courses/bachelor-programmes/business-administration/',
    { application_deadline: '2027-03-01', deadline_notes: BI_NOTE, admission: 'Rolling admission while places last' }),
  P('bi-digital-business', 'bi', 'Digital Business', 'Business & Management; Computer Science', 'https://www.bi.no/en/programmes-and-individual-courses/bachelor-programmes/digital-business/',
    { application_deadline: '2027-03-01', deadline_notes: BI_NOTE, admission: 'Rolling admission while places last' }),
  P('bi-data-science-business', 'bi', 'Data Science for Business', 'Computer Science; Business & Management', 'https://www.bi.no/en/programmes-and-individual-courses/bachelor-programmes/Data-Science-for-Business/',
    { application_deadline: '2027-03-01', deadline_notes: BI_NOTE, admission: 'Rolling admission while places last',
      ib_subjects: 'Maths: any IB maths course, 3+', ib_maths: 'AA HL · AA SL · AI HL · AI SL' }),

  P('nmbu-environment-development', 'nmbu', 'International Environment and Development Studies', 'Environmental Sciences; Politics & International Relations', 'https://www.nmbu.no/en/studies/bachelor/international-environment-and-development-studies',
    { application_deadline: '2026-12-01', deadline_notes: '1 December 2026 for international applicants, including EU/EEA.' }),

  P('uio-technology-systems', 'uio', 'Technology Systems: Science and Engineering', 'Engineering; Physics; Computer Science', 'https://www.uio.no/english/studies/programmes/technology-systems/',
    { ib_subjects: 'Maths at Norwegian R1 level plus one more science (physics, chemistry or biology) — the page names no IB equivalent', ib_maths: '?',
      application_deadline: '2026-12-01', deadline_notes: '1 December 2026 for applicants who cannot document Norwegian.' }),
];

const unis = read(new URL('universities.csv', DATA));
const uniRows = UNIS.map((u) => Object.fromEntries(unis.head.map((h) => [h, u[h] ?? ''])))
  .map((u) => ({ ...u, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const uniIds = new Set(uniRows.map((u) => u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...unis.rows.filter((u) => !uniIds.has(u.university_id)), ...uniRows]);

const progs = read(new URL('programmes.csv', DATA));
for (const p of PROGS) {
  for (const k of Object.keys(p)) if (!progs.head.includes(k)) throw new Error(`${p.programme_id}: unknown column ${k}`);
  if (!uniIds.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university ${p.university_id}`);
}
const progRows = PROGS.map((p) => Object.fromEntries(progs.head.map((h) => [h, p[h] ?? ''])))
  .map((p) => ({ ...p, last_verified: TODAY, verified_by: 'AI-DRAFT' }));
const ids = new Set(progRows.map((p) => p.programme_id));
if (ids.size !== progRows.length) throw new Error('duplicate programme_id in this script');
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((p) => !ids.has(p.programme_id)), ...progRows]);
console.log(`Norway: ${uniRows.length} universities, ${progRows.length} programmes`);
