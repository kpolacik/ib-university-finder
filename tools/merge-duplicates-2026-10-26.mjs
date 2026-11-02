// One-off: merge two duplicated programmes and correct TU/e's admission lines,
// checked 2026-10-26.
//
//   node tools/merge-duplicates-2026-10-26.mjs
//
// Duplicates. Each pair described one programme twice; the row kept is the one
// whose university runs the admission.
//
//   lei-polsci -> lei-iro. Leiden teaches Political Science in English only as
//   the International Relations and Organisations specialisation (the other,
//   Nationale en Internationale Politiek, is Dutch-taught). Leiden's IRO
//   admission page (…/political-science/international-relations-and-
//   organisations/admission-and-application): "the numerus fixus has been set
//   at a total of 400 students"; "The selection procedure for IRO is based on
//   these criteria: the average grades of your previous education (30%), your
//   score in the online assessment (70%)"; "the early application deadline (15
//   January) and the provisions about selection and placement apply to the
//   International Relations and Organisations specialisation."
//
//   tb-datascience -> tue-ds. One joint bachelor. Tilburg's maths page: "The
//   application and admission procedure for this joint program is done
//   exclusively via Eindhoven University of Technology (TU/e)."
//
// TU/e admission. Every TU/e row said "Numerus fixus". TU/e's selection page
// (tue.nl/en/education/bachelor-college/selection): "For the academic year
// 2027-2028, Eindhoven University of Technology offers a number of programs
// with selection: Architecture, Urbanism and Building Sciences; Computer
// Science and Engineering; Mechanical Engineering; Chemical Engineering and
// Chemistry (only for the English track). Application is possible from 1
// October 2026 until 15 January 2027 via Studielink." Every other TU/e
// bachelor is therefore open entry. The application fee stays: TU/e's
// eligibility page says IB holders are "considered by TU/e as an international
// applicant and will be required to pay an application fee".
//
// Re-runnable: removed rows stay removed, the rest is set, not appended.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const url = new URL('../data/programmes.csv', import.meta.url);
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const [head, ...all] = parseCsv(readFileSync(url, 'utf8'));
const c = (n) => head.indexOf(n);
const REMOVE = ['lei-polsci', 'tb-datascience'];
const rows = all.filter((r) => !REMOVE.includes(r[c('programme_id')]));
const byId = new Map(rows.map((r) => [r[c('programme_id')], r]));
const set = (id, fields) => {
  const r = byId.get(id);
  if (!r) throw new Error(`no row ${id}`);
  for (const [k, v] of Object.entries(fields)) { if (c(k) < 0) throw new Error(k); r[c(k)] = v; }
  r[c('last_verified')] = '2026-10-26';
};

set('lei-iro', {
  degree_type: 'BSc',
  admission: 'Numerus fixus: limited places',
  other_requirements: 'Numerus fixus (400 places) · Selection: school grades 30%, online assessment 70%',
  application_deadline: '2027-01-15',
  deadline_notes: 'Early application deadline for numerus fixus programmes. Taught in English as the Political Science specialisation; the Dutch-taught track has no numerus fixus.',
});

const OPEN = ['tue-am', 'tue-ds', 'tue-ie', 'tue-pt', 'tue-si', 'tue-ap', 'tue-auto', 'tue-ee', 'tue-id'];
for (const id of OPEN) set(id, { admission: 'Open entry: meet the requirements, get a place', other_requirements: 'Application fee' });
set('tue-ds', {
  degree_type: 'BSc',
  deadline_notes: 'Joint degree with Tilburg University, taught in Eindhoven and Tilburg. Apply through TU/e only.',
});
set('tue-cec', {
  admission: 'Numerus fixus: limited places',
  other_requirements: 'Numerus fixus (English track) · Selection test 20 March 2027 · Application fee',
  application_deadline: '2027-01-15',
});

writeFileSync(url, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`removed ${all.length - rows.length}; ${rows.length} programmes`);
