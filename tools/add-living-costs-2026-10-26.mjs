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

  // ----------------------------------------------------------------- Ireland
  //
  // An Irish academic year runs September to May: DCU's sheet below totals
  // "September 2025 – May 2026", nine months. Figures given per academic year
  // are divided by nine, per calendar year by twelve.

  // tcd.ie/study/international/welcome/cost-of-living, "Total estimated annual
  // costs … (including accommodation but excluding tuition)": "Undergraduate
  // €19,937 – €29,050" — by twelve, €1,661 to €2,421.
  tcd: [1660, 2420, UNI],
  // ucd.ie/global/study-at-ucd/scholarshipsfinances/livingcosts, per month,
  // "Total (last updated April 2026)": lowest €1,735, median €2,445 (high
  // €4,035); "the costs incurred by most students align more closely with the
  // median" — lowest to median.
  ucd: [1735, 2445, UNI],
  // ucc.ie/en/international/studentinfohub/beforeyouarrive/costofliving,
  // "Average Cost Range per month": "Overall Expense (including Accommodation)
  // €1,181 - €2,923 approx."
  ucc: [1181, 2923, UNI],
  // dcu.ie/sites/default/files/inline-files/cost-of-attending-university-
  // 2025.26-away-from-home.pdf, "Monthly Costs of Living Away from Home":
  // total 1822 (rent, average single room, 796).
  dcu: [1822, null, UNI],
  // ul.ie/media/cost-of-living-2024-25 ("Cost of Living 2024/25", linked from
  // UL's cost-of-living page), "Monthly Costs": accommodation including
  // utilities €700 - €1100, food €200 - €400, books €75, Leap Card €45, mobile
  // €11-20, recreation €100 - €300 — €1,131 to €1,940.
  ul: [1131, 1940, UNI],
  // maynoothuniversity.ie/international/money-and-budgeting, "Costs estimator
  // for your time in Maynooth (valid: Summer 2025)": accommodation 529 to
  // 1,100 per month (on or off campus), groceries 300 – 425, social life 200 —
  // €1,029 to €1,725. Utilities ("350-400 per month per household") are left
  // out because the page does not say per person.
  maynooth: [1029, 1725, UNI],
  // University of Galway publishes rent (€700 - €1,200 a month) and sample
  // prices but no total; its cost page sends readers to Numbeo. The other
  // university in the city, ATU: atu.ie/study/global/international-faqs, "The
  // cost of living includes accommodation, food, transport and other personal
  // expenses … generally ranges between €10,000 and €15,000 per academic
  // year" — by nine, €1,111 to €1,667. ATU's figure covers all its campuses,
  // Galway included.
  galway: [1110, 1670, 'estimate from ATU, same city'],

  // ----------------------------------------------------------------- Czechia

  // mff.cuni.cz/en/admissions/costs-and-dates (Charles University, Faculty of
  // Mathematics and Physics): "Average living costs range from 600 to 800 EUR
  // per month, including accommodation, meals, public transport, and leisure
  // activities."
  cuni: [600, 800, UNI],
  // admissions.vse.cz/living-costs: "The estimated living costs in Prague are
  // around 7,000 EUR per academic year (approximately 550–800 EUR per month)".
  vse: [550, 800, UNI],
  // ČVUT publishes dormitory prices (suz.cvut.cz "Student's estimated financial
  // cost for accommodation", valid from 08.09.2025) and FEL's partial list
  // (fel.cvut.cz/en/admissions/life-at-fee-ctu: dormitory about 4 000 CZK,
  // "about 2 000 CZK per month for lunches", transport 130 CZK) — no total, and
  // the list covers lunches only. So Prague's figure from VŠE, above.
  cvut: [550, 800, 'estimate from VŠE, same city'],
  // fss.muni.cz/en/faculty-of-social-studies/student-life/life-in-brno
  // (Masaryk University, Faculty of Social Studies): accommodation EUR 250–400,
  // meals ca EUR 200, pocket money EUR 150 - 200, "Total: EUR 600–850 per month".
  muni: [600, 850, UNI],
  // fit.vut.cz/applicants/degree-programme-en (Brno University of Technology,
  // Faculty of Information Technology): "the monthly costs of living may vary
  // between EUR 300-600." Probably dated: the same paragraph prices BUT halls
  // at "about EUR 120/month", where vut.cz/en/cooperation/welcome-service/
  // guide/costs now gives "Student halls (month) 4 710 Kč / 186 EUR". It is
  // VUT's own figure, so it is used; STATUS.md flags it.
  vut: [300, 600, UNI],
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
