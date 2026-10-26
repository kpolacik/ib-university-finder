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
