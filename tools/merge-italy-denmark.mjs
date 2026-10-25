// One-off: bring the Italy and Denmark drafts (written by a second model in
// CAS/verification/{italy,denmark}) into the site's format, with the fixes
// found when they were re-checked against the official pages on 2026-10-25.
//
// ALREADY APPLIED on 2026-10-25. Do not run it again. A rerun replaces every
// Italian and Danish row and undoes the hand corrections made since: the
// Bocconi €17,700 fees and fee note, bocconi-wbb (1 Nov 2026 deadline, Common
// App route) and dtu-ge (English and IB subject requirements). It refuses to
// run without the flag below, and the flag only exists as an escape hatch:
//
//   node tools/merge-italy-denmark.mjs --rerun-one-off
//
// What was re-checked, and changed from the drafts:
//   * Every official_url (71) is live and is the programme it claims to be.
//   * Denmark's deadline is 15 March for IB holders, not 5 July. CBS: "the
//     application deadline for bachelor programmes in Denmark is always 15
//     March, 12:00 noon"; 5 July is only the documentation deadline. DTU:
//     "15 March at 12 noon … Applicants with an IB exam (both quota 1 and 2)".
//     The CBS and DTU drafts said 5 July.
//   * DTU: "IB Diploma with at least 24 points qualifies" — added; its URL now
//     points at the English admission page.
//   * Bocconi: the fee here was set to "?" on 2026-10-25 from the
//     current-students page (2026-27 only). That was wrong — the applicants'
//     page states €17,700 for 2027-28 — and the rows were corrected the
//     same day, outside this script.
//   * Bocconi WBB partners are USC Marshall and HKUST, not Emory and Wuhan.
//   * Bologna Veterinary Medicine: "Duration 5 years", not six.
//   * Italian public fees are set by family income (ISEE), so there is no one
//     figure to show: blank, which the card shows as "Not published".
//   * Fees that were text ("157.04 + variable …", "DKK 115700") became numbers
//     or blanks. Danish krone converted at the fixed peg, 7.46 to the euro.
//   * Long sentences in baseline_requirement shortened: that column finishes
//     the phrase "No requirements beyond …".

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';
import { COLUMNS } from './lib/ireland.mjs';

// Before anything is read or written: see the header (registry D12).
if (!process.argv.includes('--rerun-one-off')) {
  console.error('merge-italy-denmark.mjs was applied on 2026-10-25 and is kept as a record.\n'
    + 'A rerun replaces every Italian and Danish row in data/ and undoes the hand corrections\n'
    + 'made since (Bocconi €17,700 fees and note, bocconi-wbb, dtu-ge). Not running.\n'
    + 'If you really mean it, pass --rerun-one-off and diff data/ carefully afterwards.');
  process.exit(1);
}

const DRAFTS = new URL('../../verification/', import.meta.url);
const DATA = new URL('../data/', import.meta.url);
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');
const DKK = (s) => { const n = Number(String(s).replace(/[^\d]/g, '')); return n ? String(Math.round(n / 7.46 / 10) * 10) : ''; };

// -------------------------------------------------------------- universities

const UNIS = {
  unibo: { tuition_eu_default: '', tuition_noneu_default: '', application_system: 'Direct (unibo.it)',
    baseline_requirement: 'a school-leaving diploma that gives university entry where you earned it (the IB Diploma is accepted)',
    admission_default: 'Admission test (TOLC or SAT) and a ranking' },
  polito: { tuition_eu_default: '', tuition_noneu_default: '', application_system: 'Direct (apply@polito)',
    baseline_requirement: 'a school-leaving diploma after at least 12 years of schooling (the IB Diploma is accepted)',
    admission_default: 'Admission test and a ranking' },
  bocconi: { tuition_eu_default: '', tuition_noneu_default: '', application_system: 'Direct (Bocconi online application)',
    baseline_requirement: 'a school-leaving diploma, with the last two years of grades assessed',
    admission_default: 'Bocconi online test or SAT/ACT, ranked with school grades' },
  polimi: { tuition_eu_default: '', tuition_noneu_default: '', application_system: 'Direct (Politecnico online services)',
    baseline_requirement: 'a school-leaving diploma Politecnico recognises',
    admission_default: 'Entrance test (TOL or an accepted alternative) and a ranking' },
  sapienza: { tuition_eu_default: '', tuition_noneu_default: '', application_system: 'Direct (Infostud)',
    baseline_requirement: 'a school-leaving diploma; each English-taught programme sets its own subject requirements',
    admission_default: 'CEnT-S admission test (CISIA) and a ranking' },
  cbs: { baseline_requirement: 'an IB Diploma with at least 24 points, the Extended Essay, TOK and CAS completed' },
  aarhus: { baseline_requirement: 'an IB Diploma with at least 24 points' },
  dtu: { baseline_requirement: 'an IB Diploma with at least 24 points' },
  sdu: { baseline_requirement: 'a school-leaving diploma meeting the Danish subject-level requirements (SDU publishes no IB minimum)' },
  aau: { baseline_requirement: 'an IB Diploma with at least 24 points', tuition_noneu_default: '' },
};
const DK_ADMISSION = 'Quota 1 (grade average) or Quota 2 (assessed application)';

const unis = read(new URL('universities.csv', DATA));
const fresh = [];
for (const c of ['italy', 'denmark']) {
  for (const u of read(new URL(`${c}/universities.csv`, DRAFTS)).rows) {
    const fix = UNIS[u.university_id];
    if (!fix) throw new Error(`unexpected university ${u.university_id}`);
    const row = Object.fromEntries(unis.head.map((h) => [h, u[h] ?? '']));
    Object.assign(row, fix);
    if (c === 'denmark') {
      row.tuition_eu_default = '0';
      row.admission_default = DK_ADMISSION;
      if (/^\d+$/.test(u.tuition_noneu_default)) row.tuition_noneu_default = u.tuition_noneu_default;
      // SDU's draft put a fees link in student_life_url; that column is for student life.
      row.student_life_url = '';
    }
    row.last_verified = '2026-10-25';
    row.verified_by = 'AI-DRAFT';
    fresh.push(row);
  }
}
const newUniIds = new Set(fresh.map((u) => u.university_id));
save(new URL('universities.csv', DATA), unis.head, [...unis.rows.filter((u) => !newUniIds.has(u.university_id)), ...fresh]);

// --------------------------------------------------------------- programmes

const NOTES = {
  unibo: 'Several application rounds, set per programme in the call for applications; 2027/28 dates not out yet. Fees depend on family income (ISEE).',
  polito: 'Several test sessions and rounds per year; 2027/28 dates not out yet. PoliTo replaces its own TIL test with CISIA tests from 2027/28. Fees depend on family income (ISEE).',
  bocconi: 'Three rounds a year (Early, Winter, Spring); 2027/28 dates not out yet. Fee 2026/27: €17,000; 2027/28 not published.',
  polimi: 'Several test sessions and rounds per year; 2027/28 dates not out yet. Fees depend on family income (ISEE).',
  sapienza: 'CEnT-S is taken in sessions through the year; 2027/28 dates not out yet. Fees depend on family income (ISEE).',
};
const CITY = { 'Ozzano dell Emilia': "Ozzano dell'Emilia", Forli: 'Forlì', 'Milano Leonardo': 'Milan' };
const DEGREE = { 'Single-cycle (LM-ciclo unico)': 'Single-cycle master', 'BSc (L)': 'BSc' };

const progs = read(new URL('programmes.csv', DATA));
const added = [];
for (const c of ['italy', 'denmark']) {
  for (const p of read(new URL(`${c}/programmes.csv`, DRAFTS)).rows) {
    const row = Object.fromEntries(COLUMNS.map((h) => [h, p[h] ?? '']));
    row.city = CITY[row.city] ?? row.city;
    row.degree_type = DEGREE[row.degree_type] ?? row.degree_type;
    row.last_verified = '2026-10-25';
    row.verified_by = 'AI-DRAFT';
    if (c === 'italy') {
      row.deadline_notes = NOTES[row.university_id];
      row.tuition_eu = row.university_id === 'bocconi' ? '?' : '';
      row.tuition_noneu = '';
      row.english_requirement = row.english_requirement.replace(/^\d+$/, '');
      if (/^Open access/i.test(row.other_requirements)) row.admission = 'Open access: no limit on places';
      else if (row.university_id === 'unibo') row.admission = '';
    } else {
      row.application_deadline = '2027-03-15';
      row.tuition_noneu = /DKK/.test(p.tuition_noneu) ? DKK(p.tuition_noneu) : p.tuition_noneu;
      row.admission = '';
    }
    added.push(row);
  }
}

const fix = (id, fields) => { const r = added.find((x) => x.programme_id === id); if (!r) throw new Error(id); Object.assign(r, fields); };
fix('unibo-6197', { other_requirements: 'Restricted access - 50 places (national) - Five-year single-cycle degree taught in English' });
fix('bocconi-wbb', { other_requirements: 'Joint programme with USC Marshall (US) and HKUST (Hong Kong); about 50 students', tuition_eu: '?' });
fix('dtu-ge', {
  ib_points_min: '24',
  official_url: 'https://www.dtu.dk/english/education/undergraduate/general-engineering/admission-and-deadlines/admission-requirements',
  deadline_notes: 'IB applicants apply by 15 March at 12:00 noon in either quota. IB results are fetched by DTU; tell your IB coordinator by 1 June.',
});
for (const r of added.filter((x) => x.university_id === 'cbs')) {
  r.deadline_notes = 'Apply by 15 March at 12:00 noon; documentation (including the language test) by 5 July at 12:00.';
}
fix('au-cog', { deadline_notes: `${added.find((x) => x.programme_id === 'au-cog').deadline_notes} AU warns this programme may switch to Danish for 2027 — check before applying.` });

const newIds = new Set(added.map((r) => r.programme_id));
const clash = progs.rows.filter((r) => newIds.has(r.programme_id) && !newUniIds.has(r.university_id));
if (clash.length) throw new Error(`id clash: ${clash.map((r) => r.programme_id)}`);
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((r) => !newUniIds.has(r.university_id)), ...added]);
console.log(`universities +${fresh.length}, programmes +${added.length}`);
