// One-off: add the United Kingdom (19 universities, 670 programmes), checked
// 2026-10-28/29. Source: CAS/verification/uk/ (research pipeline with per-row
// verbatim quotes in uk/sources/<uni>.jsonl; ledger CAS/verification/QUEUE.md).
//
//   node tools/merge-uk-2026-10-29.mjs
//
// Re-runnable: rows are replaced by id, not appended.
//
// Mapping choices (see uk/PLAN.md): tuition_eu holds the UK "Home" fee (label
// kept for schema compatibility), tuition_noneu the International fee; every
// row's deadline_notes names which fee year is published. application_system
// is "UCAS"; Oxbridge + medicine/dentistry/vet rows carry deadline
// 2026-10-15, the rest the UCAS 2027 equal consideration date 2027-01-13.
//
// entrance_exam is decided row by row from the sourced other_requirements
// text (vocabulary as in tools/add-entrance-exam-2026-10-27.mjs):
//   yes       a test is required of (effectively) every applicant: UCAT
//             (medicine, dentistry), LNAT where mandatory, Oxford/Cambridge
//             pre-registration tests (MAT/ESAT/TMUA/UCAT/LNAT), Imperial's
//             ESAT/TMUA, LSE's mandatory-TMUA courses, UCL's required
//             TMUA/LNAT/UCAT and its STEP-conditioned Maths offer, Warwick
//             TMUA-required CS/Discrete Maths and TMUA-or-STEP Maths,
//             Durham LNAT, Glasgow LNAT.
//   waivable  an exam exists but some applicants skip it: Cambridge
//             Architecture/Design "College admission assessment" (depends
//             on College), Warwick Data Science/MathStat/MORSE (test route
//             is one way to meet the offer, not the only one), Birmingham
//             Music (audition only for applicants without the qualification).
//   no        everything else: interviews, portfolios, DBS, age rules,
//             vet EMS, "TMUA encouraged/optional" (LSE non-mandatory,
//             Warwick economics family, Durham maths "strongly encouraged"),
//             "STEP for additional consideration" (Sheffield maths), and
//             Bath maths, which says it does not consider STEP/MAT/TMUA.
// The YES/WAIVABLE lists below are exhaustive: the script fails if a row
// mentions a test keyword and is listed in neither list.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const SRC = new URL('file:///C:/Users/jakub/IB_diploma/CAS/verification/uk/');
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const YES = [
  // oxford: fine-art (interview + digital portfolio) stays "no"
  'oxford-biomedical-sciences', 'oxford-computer-science', 'oxford-computer-science-and-philosophy',
  'oxford-engineering-science', 'oxford-law-jurisprudence', 'oxford-mathematics',
  'oxford-mathematics-and-computer-science', 'oxford-mathematics-and-philosophy',
  'oxford-medicine', 'oxford-physics', 'oxford-physics-and-philosophy',
  'cambridge-chemical-engineering-biotechnology', 'cambridge-computer-science', 'cambridge-economics',
  'cambridge-engineering', 'cambridge-law', 'cambridge-mathematics', 'cambridge-medicine',
  'cambridge-natural-sciences', 'cambridge-veterinary-medicine',
  // imperial: every programme that requires ESAT/TMUA, plus medicine (UCAT)
  'imperial-aeronautical-engineering', 'imperial-aeronautics-spacecraft-engineering',
  'imperial-biochemistry-bsc', 'imperial-biochemistry-language', 'imperial-biochemistry-management',
  'imperial-biochemistry-msci', 'imperial-biological-sciences', 'imperial-biological-sciences-language',
  'imperial-biological-sciences-management', 'imperial-biological-sciences-msci',
  'imperial-biotechnology', 'imperial-biotechnology-language', 'imperial-biotechnology-management',
  'imperial-biotechnology-msci', 'imperial-chemical-engineering', 'imperial-civil-engineering',
  'imperial-computing-artificial-intelligence-meng', 'imperial-computing-beng',
  'imperial-computing-international-programme-of-study', 'imperial-computing-meng',
  'imperial-computing-security-reliability-meng', 'imperial-computing-software-engineering-meng',
  'imperial-computing-visual-computing-robotics-meng', 'imperial-design-engineering',
  'imperial-ecology-environmental-biology', 'imperial-economics-finance-data-science',
  'imperial-electrical-electronic-engineering-beng', 'imperial-electrical-electronic-engineering-management',
  'imperial-electrical-electronic-engineering-meng', 'imperial-electronic-information-beng',
  'imperial-electronic-information-meng', 'imperial-mathematics-applied-physics', 'imperial-mathematics-bsc',
  'imperial-mathematics-computation', 'imperial-mathematics-computer-science-ai-beng',
  'imperial-mathematics-computer-science-ai-meng', 'imperial-mathematics-computer-science-beng',
  'imperial-mathematics-computer-science-meng', 'imperial-mathematics-msci',
  'imperial-mathematics-statistics', 'imperial-mathematics-statistics-finance',
  'imperial-mechanical-engineering', 'imperial-mechanical-engineering-nuclear', 'imperial-microbiology',
  'imperial-physics-bsc', 'imperial-physics-msci', 'imperial-physics-theoretical-bsc',
  'imperial-physics-theoretical-msci', 'imperial-pure-mathematics-bsc', 'imperial-medicine',
  'lse-bsc-econometrics-and-mathematical-economics', 'lse-bsc-economics', 'lse-llb-bachelor-of-laws',
  'ucl-economics-bsc-econ', 'ucl-law-llb', 'ucl-mathematics-bsc', 'ucl-medicine-mbbs-bsc',
  'edinburgh-medicine-mbchb',
  'kcl-medicine-mbbs', 'kcl-dentistry-bds', 'kcl-law-llb', 'kcl-politics-philosophy-and-law-llb',
  'manchester-medicine-mbchb', 'manchester-dentistry-first-year-entry-bds',
  'bristol-law-llb', 'bristol-medicine-mbchb', 'bristol-dentistry-bds',
  'warwick-computer-science-bsc', 'warwick-discrete-mathematics-bsc',
  'warwick-mathematics-bsc', 'warwick-mathematics-mmath',
  'durham-law-llb',
  'glasgow-medicine-mbchb', 'glasgow-dentistry-bds', 'glasgow-scots-law-llb',
  'exeter-medicine-bmbs', 'leeds-medicine-and-surgery-mbchb',
  'birmingham-medicine-and-surgery-mbchb', 'birmingham-dental-surgery-bds',
  'southampton-medicine-bm5', 'sheffield-medicine-mbchb', 'sheffield-dental-surgery-bds',
];
const WAIVABLE = [
  'cambridge-architecture', 'cambridge-design',
  'cambridge-classics', 'cambridge-geography', 'cambridge-history-modern-languages',
  'cambridge-human-social-political-sciences', 'cambridge-linguistics-modern-languages',
  'cambridge-modern-medieval-languages', 'cambridge-music', 'cambridge-philosophy',
  'cambridge-psychological-behavioural-sciences',
  'warwick-data-science-bsc', 'warwick-mathematics-and-statistics-mmathstat', 'warwick-morse-bsc',
  'birmingham-music-bmus',
];

const TEST_RE = /\b(?:UCAT|LNAT|MAT|PAT|TSA|ESAT|STEP|TMUA|MLAT|HPAT|ELAT|HAT|BMAT)\b|aptitude test|admissions test|written assessment|admission assessment|entrance exam|audition/i;
// Keyword mentioned only to say a test is NOT needed or only ever optional:
// "No admissions test" (Edinburgh, all courses), "LNAT is/is not required"
// (Birmingham/Southampton/Leeds/Sheffield/Warwick Law), "not mandatory" and
// "encouraged" (LSE, Warwick economics family, Durham maths), Bath maths
// "does not consider STEP/MAT/TMUA", Sheffield maths STEP "additional
// consideration". YES/WAIVABLE membership always wins over this list.
const NOT_REQUIRED_RE = /no admissions test|not required|not mandatory|optional|encouraged|does not consider|do not require|additional consideration|no lnat/i;

const ukProgs = read(new URL('programmes.csv', SRC)).rows;
const ukUnis = read(new URL('universities.csv', SRC)).rows;
for (const p of ukProgs) {
  const req = p.other_requirements || '';
  const listed = YES.includes(p.programme_id) || WAIVABLE.includes(p.programme_id);
  const mentionsTest = TEST_RE.test(req);
  const mentionsOnlyNeg = NOT_REQUIRED_RE.test(req);
  if (!mentionsTest && listed) throw new Error(`${p.programme_id} classified but mentions no test`);
  if (mentionsTest && !listed && !mentionsOnlyNeg) throw new Error(`${p.programme_id} mentions a test but is not classified`);
  p.entrance_exam = YES.includes(p.programme_id) ? 'yes' : WAIVABLE.includes(p.programme_id) ? 'waivable' : 'no';
}

const progs = read(new URL('programmes.csv', DATA));
for (const p of ukProgs) {
  for (const k of Object.keys(p)) if (!progs.head.includes(k)) throw new Error(`${p.programme_id}: unknown column ${k}`);
}
const uniIds = new Set(ukUnis.map((u) => u.university_id));
for (const p of ukProgs) if (!uniIds.has(p.university_id)) throw new Error(`${p.programme_id}: unknown university ${p.university_id}`);
const progIds = new Set(ukProgs.map((p) => p.programme_id));
if (progIds.size !== ukProgs.length) throw new Error('duplicate programme_id in the UK source');
save(new URL('programmes.csv', DATA), progs.head, [...progs.rows.filter((p) => !progIds.has(p.programme_id)), ...ukProgs]);

const unis = read(new URL('universities.csv', DATA));
for (const u of ukUnis) for (const k of Object.keys(u)) if (!unis.head.includes(k)) throw new Error(`${u.university_id}: unknown column ${k}`);
save(new URL('universities.csv', DATA), unis.head, [...unis.rows.filter((u) => !uniIds.has(u.university_id)), ...ukUnis]);

console.log(`UK: ${ukUnis.length} universities, ${ukProgs.length} programmes (${YES.length} yes / ${WAIVABLE.length} waivable entrance_exam)`);
