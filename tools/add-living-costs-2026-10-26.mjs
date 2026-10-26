// One-off: monthly living costs per university, as a range with its source,
// checked on 2026-10-26.
//
//   node tools/add-living-costs-2026-10-26.mjs
//
// Order of sources, and the words the card shows after the range:
//   1. the university's own published figure           "university's estimate"
//   2. another university in the same city             "estimate from <name>"
//   3. an official national study portal               "national estimate (<portal>)"
// Nothing else — no Numbeo, no blogs. Blank if none of the three says.
//
// Figures are rent included, tuition excluded, in euros. Where a university
// gives only a table of items, the range is the sum of the items it lists.
// A single figure goes in min with max left blank. Re-runnable: it writes only
// living_cost_min, living_cost_max, living_cost_source and last_verified.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const TODAY = '2026-10-26';
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const UNI = "university's estimate";

// [min, max, source]; max null for a single figure.
const COSTS = {
  // ------------------------------------------------------------- Netherlands

  // eur.nl/en/education/practical-matters/orientation-arrival/costs-living:
  // "students living and studying in Rotterdam spend approximately €1000 to
  // €1800 per month, mainly depending on housing costs."
  eur: [1000, 1800, UNI],
  // wur.nl/en/education/bachelor/study-expenses-bachelors, "Estimated total
  // costs for 3 years": "Living expenses €41,400.00" (EU/EFTA) = €1,150 a month.
  wur: [1150, null, UNI],
  // maastrichtuniversity.nl/study/student-life/cost-studying-financial-
  // assistance, "Monthly cost (euro)": rent 561, groceries 272, books 53,
  // transport 67, leisure 238, clothing 60, health insurance 156, phone and
  // internet 55 — €1,462 in total.
  maastricht: [1462, null, UNI],
  // tue.nl/en/education/become-a-tue-student/tuition-fees-living-expenses,
  // "Estimated monthly cost (€)": housing €500 - €1,000, food €200 - €300,
  // study materials €50, insurance €100 - €130, transport €30 - €100, personal
  // €150 - €200 — €1,030 to €1,780 in total.
  tue: [1030, 1780, UNI],
  // rug.nl/fse/education/choose-your-study/international-portal/get-to-know-
  // us/faq: "our students spend on average €1000- €1,100 per month, excluding
  // tuition fees."
  rug: [1000, 1100, UNI],
  // uva.nl/en/programmes/bachelors/business-administration/tuition-fee: "expect
  // to spend between €900 and €1,500 per month on living expenses. This
  // includes rent, but not tuition fees."
  uva: [900, 1500, UNI],
  // vu.nl/en/education/more-about/cost-of-living-and-working: "living and
  // studying in the Netherlands for one year costs a student between €1,000
  // and €2,000 per month."
  vu: [1000, 2000, UNI],
  // utwente.nl/en/education/student-services/upcoming-students/money-matters/
  // cost-of-living: "studying and living in the Netherlands will cost you, on
  // average, about 1,300 euros a month, excluding tuition fees" (UT quoting Nibud).
  twente: [1300, null, UNI],
  // tilburguniversity.edu/education/bachelors-programs/tuition-fees-and-monthly-
  // cost-living: "The approximate cost of living is between € 1,000 and € 1,200
  // per month."
  tilburg: [1000, 1200, UNI],
  // universiteitleiden.nl/en/education/international-students/financial-
  // matters, "Monthly living costs" (Leiden and The Hague): "Total (excluding
  // tuition fees) €1214 – €1644".
  leiden: [1214, 1644, UNI],
  // ru.nl/en/education/studying-at-radboud-university/finances/costs-and-
  // expenses, "Average expenses per month (€)", EU/EEA column: "Total €1,681 -
  // €1,720", which includes "Tuition fee (2027-2028) €231" — €1,450 to €1,489
  // without it.
  radboud: [1450, 1489, UNI],
  // uu.nl/en/education/welcome-to-utrecht/prepare-your-stay/cost-of-living:
  // "you can expect to spend between €1000 and €1,400 a month on living
  // expenses."
  utrecht: [1000, 1400, UNI],
  // TU Delft gives no figure of its own: its tuition-fee-finances page says
  // "Would you like an estimate of the cost of living for students? You can
  // find information on this topic on the Study in NL website", linking
  // studyinnl.org/finances/daily-student-expenses-and-cost-of-living-in-the-
  // netherlands: "Students spend an average of € 1000 - € 1,500 a month." No
  // other university is in Delft.
  'tu-delft': [1000, 1500, 'national estimate (Study in NL)'],
};

// ------------------------------------------------------------------- write

const url = new URL('universities.csv', DATA);
const [head, ...rows] = parseCsv(readFileSync(url, 'utf8'));
const col = (name) => { const i = head.indexOf(name); if (i < 0) throw new Error(`no column ${name}`); return i; };
const [iId, iMin, iMax, iSrc, iVer] = ['university_id', 'living_cost_min', 'living_cost_max', 'living_cost_source', 'last_verified'].map(col);
const seen = new Set();
for (const r of rows) {
  const c = COSTS[r[iId]];
  if (!c) continue;
  const [min, max, source] = c;
  if (max !== null && max <= min) throw new Error(`${r[iId]}: max must be above min`);
  r[iMin] = String(min); r[iMax] = max === null ? '' : String(max); r[iSrc] = source; r[iVer] = TODAY;
  seen.add(r[iId]);
}
const missing = Object.keys(COSTS).filter((id) => !seen.has(id));
if (missing.length) throw new Error(`unknown university: ${missing}`);
writeFileSync(url, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`living costs written for ${seen.size} of ${rows.length} universities`);
