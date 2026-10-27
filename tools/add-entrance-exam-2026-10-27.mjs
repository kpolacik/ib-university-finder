// One-off: add the entrance_exam column to data/programmes.csv, 2026-10-27.
//
//   node tools/add-entrance-exam-2026-10-27.mjs
//
// Values:
//   yes       every applicant sits a test, exam or audition (a selection test,
//             an aptitude test such as Scio/TSP/CEnT-S/TOLC/SAT, HPAT, a talent
//             exam or audition). Run online or in person, it counts.
//   waivable  there is an exam, but some IB applicants can skip it (on IB points,
//             on subject grades, or because it only applies to a missing maths
//             level).
//   no        admission on grades, documents, letters, interviews, portfolios,
//             matching or lottery only.
//   ?         not checked or not clear on the official page.
//
// Most rows follow from the admission and other_requirements text that is
// already sourced (rules below). Rows the text can't settle were read on the
// official page on 2026-10-27; those are in OVERRIDE with their source.
//
// Netherlands, selective and numerus fixus programmes (2027-2028 pages):
//   tud-ae   selection-procedure page: "Your fit will be assessed with two
//            tests: the Academic Aptitude Assessment … and the Selection Test".
//   tud-cse  selection-procedure page: "For the selection part all candidates
//            will be tested on two selection criteria"; "Your ranking number
//            will be based on your test results and a lottery draw".
//   tue-aubs "Participation in this test is mandatory for all candidates. The
//            Online Cognitive Skills Test will take place on March 13, 2027".
//   tue-cse  "Algorithmic thinking test (40%)"; "The assessments cannot be
//            taken at another time". tue-me: "Tests cannot be rescheduled".
//   tue-cec  selection page: "Be available all day; tests cannot be
//            rescheduled".
//   um-brain "Deadline for completing the selection exam: 1 March 2027".
//   um-psy   UM selection regulations (linked as the 2027-2028 rules): "In the
//            second part, applicants need to take an online test that consists
//            of multiple-choice questions".
//   uva-ba, uva-ebe  selection-procedure pages: "If you do not take part in the
//            test, unfortunately, you will not receive a ranking number".
//   uva-psychology   "All applicants will watch two (recorded) lectures … and
//            take two tests on the test day".
//   rug-ib   numerus-fixus page: "All applicants will have to successfully
//            complete both an admission and selection by a Fit & Benchmark
//            procedure", which includes "A short quiz that assesses general
//            aptitude".
//   rug-psy  about-selection page: "The selection test takes place online".
//   lei-psy  selection-and-placement page: "Online Assessment … the assessment
//            will close at exactly 23:59 CET on Saturday 7 March".
//   lei-iro  "your score in the online assessment (70%)" (see merge-duplicates).
//   uu-pharma selection page: "On the selection day, you will receive an
//            assignment"; proctored online with ProctorExam.
//   uu-ppe   selection page: skills assessed "on the basis of the competency
//            profile test", then interviews.
//   ut-psy   selection page: "online open-book test"; "Methods & Statistics
//            test (40%)".
//   tb-psy   application page: "you will timely receive an invitation and
//            further instructions for the knowledge test".
//   vu-psy   admissions page: "All candidates will be scored on … A score
//            obtained on the online test".
//   eur-ibp  EUR "Regulations numerus fixus and decentralized selection
//            psychology 2027-2028", art. 5: "The selection assessment consists
//            of … a knowledge test; and a motivation/study attitude test".
//   eur-ibeb admission page: an "Online ESE curriculum-based activity" of
//            e-modules with "reading material, interactive videos and
//            reflective questions", pass/fail on completion. Not an exam: no.
//   eur-ibeor admission page: AA HL 5, or AA SL 6 plus "the mathematics
//            entrance exam": waivable.
//   uva-polsci "The programme uses an unweighted lottery": no.
//   um-els   "UM will then conduct a lottery": no.
//   um-ib    ranking on the International Classroom essay, grades and CV: no.
//   ut-me, ut-tcs  "No, the matching procedure is not an admission test": no.
//   uu-ucr   Kira: "six questions about yourself and your experiences": no.
//   ru-psy   four-part "Matching Assignment" plus grades; the page does not say
//            whether any part is a test: ?.
//
// Ireland: HPAT/GAMSAT, music tests, entrance tests and auditions are yes;
// interviews, portfolios and questionnaires are no (other_requirements was
// corrected in fix-admission-2026-10-27.mjs). Left as ?: UL Music and Dance
// (entry via LM002, "additional special qualifications specific to individual
// subjects … may be determined"), Maynooth MH002 (a "written exercise/
// interview/online video audition … may form part of your application
// assessment"), UCD Veterinary Nursing (no assessment named on its page).
//
// Denmark: no. SDU's uniTEST page: "If your grades can be converted to the
// Danish grading system, your application may be assessed in quota 1, where
// admission is based on your grade point average"; quota 2 tests are optional
// for IB holders, and every Danish row here has a quota 1 route.
//
// Italy: Luiss "Direct admission with IB 36+ … or the Luiss Test" is waivable.
// Cattolica's selective programmes assess CV, grades and an interview (no),
// except Medicine (national test, yes) and the one programme where "the
// Cattolica Admission Test may be required" depending on your maths (waivable).
// "Non-selective entrance test of general knowledge after enrolling" is after
// admission: no. A compulsory TOLC check test before enrolling is yes even when
// a low score only adds first-year duties. An open-access row that names no
// test at all stays ?: Italian open-access degrees often still set a
// compulsory entry check.
//
// Czechia: an exam that "can be waived on set criteria" is waivable, unless the
// only waiver is Czech/Slovak school grades (yes). VŠE's admissions page only
// says entrance exams depend on the programme ("In order to be admitted at VŠE,
// the entrance exams has to be passed successfully"), so VŠE rows stay ? except
// EMO, whose page lists an essay, a motivation video and an interview (no).
//
// Re-runnable: inserts the column after "admission" if it is missing, then sets
// every row.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const pUrl = new URL('../data/programmes.csv', import.meta.url);
const uUrl = new URL('../data/universities.csv', import.meta.url);
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const [uHead, ...uRows] = parseCsv(readFileSync(uUrl, 'utf8'));
const uni = new Map(uRows.map((r) => [r[uHead.indexOf('university_id')], Object.fromEntries(uHead.map((h, i) => [h, r[i]]))]));

let [head, ...rows] = parseCsv(readFileSync(pUrl, 'utf8'));
if (!head.includes('entrance_exam')) {
  const at = head.indexOf('admission') + 1;
  head = [...head.slice(0, at), 'entrance_exam', ...head.slice(at)];
  rows = rows.map((r) => [...r.slice(0, at), '', ...r.slice(at)]);
}
const c = (n) => head.indexOf(n);

const YES = 'yes', WAIVABLE = 'waivable', NO = 'no', UNKNOWN = '?';

const OVERRIDE = {
  // Netherlands (sources above)
  'tud-ae': YES, 'tud-cse': YES, 'tue-aubs': YES, 'tue-cse': YES, 'tue-me': YES, 'tue-cec': YES,
  'um-brain': YES, 'um-psy': YES, 'uva-ba': YES, 'uva-ebe': YES, 'uva-psychology': YES,
  'rug-ib': YES, 'rug-psy': YES, 'lei-psy': YES, 'lei-iro': YES, 'uu-pharma': YES, 'uu-ppe': YES,
  'ut-psy': YES, 'tb-psy': YES, 'vu-psy': YES, 'eur-ibp': YES,
  'eur-ibeor': WAIVABLE, 'eur-iba': WAIVABLE,
  'ru-psy': UNKNOWN,
  // Ireland
  'ul-music-and-dance': UNKNOWN,
  'maynooth-b-ed-bachelor-of-education-primary--2': UNKNOWN,
  'ucd-veterinary-nursing': UNKNOWN,
  // Czechia
  'vse-en-economics-of-markets-and-organization': NO,
  // Italy
  'unicatt-med': YES,
};

const has = (re, s) => re.test(s);

function czech(t) {
  if (!t) return UNKNOWN;
  if (has(/^See the faculty/i, t)) return UNKNOWN;
  if (has(/no entrance exam|^no exam|\(no( written)? exam\)/i, t)) return NO;
  if (has(/^Assessed on documents/i, t)) return NO; // "SAT/ACT/Scio strongly recommended" is not required
  if (has(/cannot be waived/i, t)) return YES;
  if (has(/waived? (on|for) (CZ\/SK|school grades if you sit a Czech|CZ\/SK maturita)/i, t)) return YES;
  if (has(/waive|priority admission on set criteria/i, t)) {
    return has(/exam|test|scio|tsp|gap|osp/i, t) ? WAIVABLE : NO;
  }
  if (has(/document review: IB .* or a Scio test/i, t)) return YES; // final IB results arrive after the decision
  if (has(/exam|test|scio|tsp|gap|talent/i, t)) return YES;
  if (has(/document|interview|portfolio review/i, t)) return NO;
  return UNKNOWN;
}

function ireland(other) {
  if (has(/HPAT|GAMSAT|entrance exam|entrance test|test|audition/i, other) && !has(/^Test, interview, portfolio or audition$|^Audition or portfolio$/i, other)) return YES;
  if (has(/^Test, interview, portfolio or audition$|^Audition or portfolio$|additional assessment/i, other)) return UNKNOWN;
  return NO;
}

function italy(id, adm, other) {
  const t = `${adm} · ${other}`;
  if (has(/IB 36\+.*Luiss Test/i, t)) return WAIVABLE;
  if (has(/may be required/i, other)) return WAIVABLE;
  if (has(/after enrolling/i, other)) return NO;
  if (has(/test|TOLC|CEnT-S|SAT|CISIA|\bTIL\b|\bTOL\b/, t)) return YES;
  if (id.startsWith('unicatt-') || has(/^Selective/i, adm)) return NO;
  return UNKNOWN;
}

function rule(r) {
  const id = r[c('programme_id')];
  const u = uni.get(r[c('university_id')]);
  const adm = r[c('admission')] || u.admission_default || '';
  const other = r[c('other_requirements')] || '';
  switch (u.country) {
    case 'Czechia': return czech([adm, other].filter(Boolean).join(' · '));
    case 'Ireland': return ireland(other);
    case 'Italy': return italy(id, adm, other);
    case 'Denmark': return NO;
    case 'Netherlands': return adm === '?' ? UNKNOWN : NO;
    // Countries added after this script set their own value when imported
    // (tools/add-sweden-2026-10-27.mjs); a re-run must not wipe it.
    default: return r[c('entrance_exam')] || UNKNOWN;
  }
}

const tally = {};
for (const r of rows) {
  const id = r[c('programme_id')];
  const v = OVERRIDE[id] ?? rule(r);
  r[c('entrance_exam')] = v;
  tally[v] = (tally[v] ?? 0) + 1;
}
for (const id of Object.keys(OVERRIDE)) if (!rows.some((r) => r[c('programme_id')] === id)) throw new Error(`no row ${id}`);

writeFileSync(pUrl, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log('entrance_exam:', tally);
