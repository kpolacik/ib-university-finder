// One-off import: Masaryk University (Brno) bachelor and long-cycle master's
// programmes -> programmes.csv rows.
//
//   node tools/import-muni.mjs        writes tools/muni-rows.csv
//
// Two catalogues, handled differently:
//
//   * Czech-taught. Masaryk lists every programme under eleven subject
//     categories, and each programme page carries the same "Informace o
//     studiu" block (type, mode, length, language) plus a "Přijímací řízení"
//     section that says what the entrance exam is. Those pages are uniform
//     enough to read mechanically, so they are.
//
//   * English-taught. Only eleven of these are bachelor or long-cycle
//     programmes, and every faculty runs its own admissions: its own
//     deadlines, its own test (or none), its own fee, some in CZK and one in
//     EUR. The programme page often shows last year's cycle. So the facts for
//     these come from a table below, each one read off the faculty's own page
//     on 2026-10-24, with the source in the comment beside it. The programme
//     page is still fetched, to confirm it is a full-time bachelor or
//     long-cycle programme taught in English and to read the CZK fee where it
//     is printed.

import { writeFileSync } from 'node:fs';
import {
  getHtml, czText, toRow, idMaker, areasFor, czkPerEur, toEur, czkAmount,
} from './lib/czechia.mjs';

const BASE = 'https://www.muni.cz/bakalarske-a-magisterske-studijni-programy';
const EN_BASE = 'https://www.muni.cz/en/bachelors-and-masters-study-programmes';
const VERIFIED = '2026-10-24';

const { rate, date: rateDate } = await czkPerEur();
console.log(`ČNB rate ${rateDate}: ${rate} CZK per euro`);

// One page per subject category. The category stands in for subject_area only
// when the programme's English name says nothing areasFor can use.
const CATEGORIES = {
  'historie-filozofie-a-umeni': 'History',
  'cizi-jazyky-cestina-a-literatura': 'Languages & Literature',
  'medicina-zdravi-a-osetrovatelstvi': 'Medicine & Health',
  'biologie-chemie-geografie-a-geologie': 'Biology & Life Sciences',
  'ucitelstvi-a-pedagogika': 'Education',
  'spolecenske-vedy-psychologie-a-komunikace': 'Sociology & Anthropology',
  'pravo-a-verejna-sprava': 'Law',
  'ekonomie-finance-a-management': 'Business & Management',
  'informatika-programovani-a-vypocetni-technika': 'Computer Science',
  'sport-regenerace-a-vyziva': 'Sports Science',
  'matematika-a-fyzika': 'Mathematics',
};

// The whole university takes Czech-programme applications in one window,
// stated on its Termíny page: "od 1. 11. 2026 do 28. 2. 2027".
const CZECH_DEADLINE = '2027-02-28';

/** "Typ studia bakalářský Forma …" -> "bakalářský". Fields run together in the text view. */
const field = (txt, label, next) => (txt.match(new RegExp(`${label} +(.*?) +(?:${next})`)) || [])[1] || '';

/**
 * What the entrance procedure is, from the page's Přijímací řízení section.
 * Returned as bullet items. Anything not recognised comes back empty, which
 * the site shows as nothing rather than as "no exam".
 */
function czechAdmission(adm) {
  const parts = [];
  const tsp = /Test\S* studijních předpokladů|\bTSP\b/.test(adm);
  const subject = /oborov\S* (zkouš|test)|odborn\S* test|test\S* z (biologie|chemie|fyziky|matematiky)|základů společensk|Biologie \(\d+ bodů\)|Chemie \(\d+ bodů\)/i.test(adm);
  const either = /a\) Test studijních předpokladů.{0,40}nebo b\)/.test(adm);
  const oral = /ústní/i.test(adm);
  const practical = /praktick\S* zkouš|talentov|FSpS/.test(adm);

  if (either) parts.push('Entrance exam: TSP aptitude test or a subject test');
  else if (tsp && subject) parts.push('Entrance exam: TSP aptitude test + subject test');
  else if (tsp) parts.push('Entrance exam: TSP aptitude test');
  else if (subject) parts.push(`Entrance exam: ${oral ? 'oral ' : ''}subject exam`);
  else if (/přijímací zkoušk/i.test(adm)) parts.push('Entrance exam');

  if (practical) parts.push('Practical or talent exam (see faculty page)');
  if (/pohovor/i.test(adm)) parts.push('Interview');

  // The waiver heading "Přijetí bez přijímací zkoušky" appears on almost every
  // page, including those where the next words say it is not possible:
  // "(prominutí přijímací zkoušky) není možné" on the medical faculty's
  // health programmes, "není možné prominout přijímací zkoušku" on several
  // Faculty of Arts ones. The heading alone wrote "can be waived" on all of
  // them until a second check caught it on 2026-10-25.
  const noWaiver = /přijímací zkoušky\)? není možné|není možné prominout/.test(adm);
  if (!noWaiver && /prominut|na základě dalších kritérií|bez přijímací zkoušky/i.test(adm)) {
    parts.push('Exam can be waived on set criteria');
  }
  return parts;
}

// -------------------------------------------------------------- Czech-taught

const programmes = new Map();
for (const [slug, area] of Object.entries(CATEGORIES)) {
  const html = await getHtml(`${BASE}/${slug}`);
  for (const m of html.matchAll(/href="(?:https:\/\/www\.muni\.cz)?\/bakalarske-a-magisterske-studijni-programy\/(\d+-[a-z0-9-]+)"[^>]*>([^<]+)</g)) {
    if (!programmes.has(m[1])) programmes.set(m[1], { area });
  }
}
if (programmes.size < 100) throw new Error(`only ${programmes.size} Czech programmes found — the catalogue has changed`);
console.log(`Czech catalogue: ${programmes.size} programmes`);

const nextId = idMaker('muni');
const rows = [];
const skipped = { notFullTime: 0, notCzech: 0, noType: 0 };
let noAdmission = 0;

for (const [key, { area }] of programmes) {
  const url = `${BASE}/${key}`;
  const html = await getHtml(url);
  const txt = czText(html);

  const title = czText((html.match(/<h1[^>]*>([^]*?)<\/h1>/) || [])[1] || '');
  const type = field(txt, 'Typ studia', 'Forma');
  const fullTime = field(txt, 'Forma prezenční', 'kombinovaná');
  const language = field(txt, 'Vyučovací jazyk', 'Bodové|Školné|Váháte|Spolupracující|Studijní');

  if (!/^(bakalářský|magisterský)$/.test(type)) { skipped.noType++; continue; }
  if (fullTime !== 'ano') { skipped.notFullTime++; continue; }
  if (language !== 'čeština') { skipped.notCzech++; continue; }

  // The English twin of the page, linked from every Czech page, gives an
  // English name for areasFor to work on.
  const enSlug = (html.match(/\/en\/bachelors-and-masters-study-programmes\/\d+-([a-z0-9-]+)/) || [])[1] || '';
  const areas = areasFor(enSlug.replace(/-/g, ' '));

  const at = html.indexOf('id="prijimaci-rizeni"');
  const admission = at > 0 ? czechAdmission(czText(html.slice(at, at + 9000))) : [];
  if (!admission.length) noAdmission++;

  rows.push(toRow({
    programme_id: nextId(enSlug || key),
    university_id: 'muni',
    programme: title,
    degree_type: type === 'bakalářský' ? 'Bc.' : 'Long-cycle master',
    subject_area: areas || area,
    language: 'Czech',
    // Czech admission is by exam, so there is no IB points figure to state.
    ib_points_min: '',
    // Blank, not "none": Masaryk states no IB subject list, which is not the
    // same as saying there is nothing to meet.
    ib_subjects: '',
    admission: admission.join(' · '),
    // Free: "Na české vysoké škole neplatíš školné" — Masaryk's page for
    // Slovak applicants. The university default carries the 0.
    english_requirement: /překlad|tlumoč/i.test(title)
      ? 'Czech essential (translation programme)'
      : '',
    application_deadline: CZECH_DEADLINE,
    official_url: url,
    last_verified: VERIFIED,
    verified_by: 'AI-DRAFT',
  }));
}

// ------------------------------------------------------------ English-taught

// Read off each faculty's admissions page on 2026-10-24.
//   ECON  econ.muni.cz/en/admissions/bachelor-studies/how-to-apply and
//         …/application-requirements: "Apr 30 September intake"; academic
//         competence "IB Diploma 28+, Mathematics 4+ (SL or HL)"; "Predicted
//         grades do not meet the academic competence requirement".
//   FSS   fss.muni.cz/en/…/bachelors-studies: Autumn 2027 applications
//         "from 1 November 2026 until 15 May 2027"; tuition "3500 EUR per
//         year … for the students starting in Spring 2027".
//   PED   programme pages: "1 Oct 2026 - 31 Mar 2027"; "On-line Interview".
//   PHIL  phil.muni.cz programme pages: "Tuition 76,000 CZK/year", "Next
//         intake will be for Autumn 2027", no 2027 deadline yet.
//   SCI, MED, PHARM  programme pages still show the 2026 cycle.
const ECON_NOTE = 'Final IB results only — predicted grades do not count, so with a 30 April '
  + 'deadline you will need a Scio GAP or Maths test (50th percentile+). Places are limited.';
const FSS_NOTE = 'Applications 1 Nov 2026 – 15 May 2027. Fee stated for Spring 2027 starters.';
const NOT_YET = (last) => `2027 dates not yet published (last cycle: ${last}).`;

const ENGLISH = {
  '26520-business-management-and-finance': {
    area: 'Business & Management; Economics', deadline: '2027-04-30', ib: 28, subjects: 'Maths SL or HL 4',
    admission: 'Document review: IB 28+ with Maths 4+, or a Scio test', note: ECON_NOTE,
  },
  '26521-economics-and-public-policy': {
    area: 'Economics; Politics & International Relations', deadline: '2027-04-30', ib: 28, subjects: 'Maths SL or HL 4',
    admission: 'Document review: IB 28+ with Maths 4+, or a Scio test', note: ECON_NOTE,
  },
  '26460-global-challenges-society-politics-environment': {
    area: 'Politics & International Relations; Environmental Sciences', deadline: '2027-05-15', eur: 3500,
    admission: 'Scio GAP test (30th percentile+)', note: FSS_NOTE,
  },
  '23254-international-relations-and-european-politics': {
    area: 'Politics & International Relations', deadline: '2027-05-15', eur: 3500,
    admission: 'Documents and motivation letter · Online interview', note: FSS_NOTE,
  },
  '26459-politics-media-and-communication': {
    area: 'Politics & International Relations; Media & Communication', deadline: '2027-05-15', eur: 3500,
    admission: 'Scio GAP test (30th percentile+)', note: FSS_NOTE,
  },
  '26773-education-for-diversity-and-inclusion': {
    area: 'Education', deadline: '2027-03-31', admission: 'Online interview',
    note: 'Applications 1 Oct 2026 – 31 Mar 2027.',
  },
  '24665-english-language-for-education': {
    area: 'Education; Languages & Literature', deadline: '2027-03-31', admission: 'Online interview',
    note: 'Applications 1 Oct 2026 – 31 Mar 2027.',
  },
  '26286-culture-media-and-performative-arts': {
    area: 'Media & Communication; Art & Design', admission: 'Entrance exam', note: NOT_YET('1 Dec 2025 – 30 Apr 2026'),
  },
  '24424-english-language-and-literature': {
    area: 'Languages & Literature', admission: 'Entrance exam', note: NOT_YET('1 Dec 2025 – 30 Apr 2026'),
  },
  '27005-biology-and-biochemistry': {
    area: 'Biology & Life Sciences; Chemistry', admission: 'Online test · Online interview · Motivation letter',
    note: NOT_YET('1 Nov 2025 – 28 Feb 2026'),
  },
  '23439-general-medicine': {
    area: 'Medicine & Health', admission: 'Entrance exam: biology, chemistry and physics tests',
    note: NOT_YET('2 Jan – 31 Jul 2026'),
  },
  '23449-dentistry': {
    area: 'Medicine & Health', admission: 'Entrance exam', note: NOT_YET('2 Jan – 31 Jul 2026'),
  },
  '26615-pharmacy': {
    area: 'Medicine & Health; Chemistry', admission: 'Online entrance exam',
    note: NOT_YET('EU applicants 1 Dec 2025 – 31 Jul 2026'),
  },
};

const enIndex = await getHtml(EN_BASE);
const enKeys = new Set([...enIndex.matchAll(/href="\/en\/bachelors-and-masters-study-programmes\/(\d+-[a-z0-9-]+)"/g)].map((m) => m[1]));
const missing = Object.keys(ENGLISH).filter((k) => !enKeys.has(k));
if (missing.length) throw new Error(`English catalogue no longer lists: ${missing.join(', ')}`);

for (const [key, facts] of Object.entries(ENGLISH)) {
  const url = `${EN_BASE}/${key}`;
  const html = await getHtml(url);
  const txt = czText(html);
  const type = field(txt, 'Type of studies', 'Mode');
  const language = field(txt, 'Language of instruction', 'Tuition|Do you|Find|Collaborating');
  if (!/^(Bachelor's|Master's)$/.test(type) || field(txt, 'Mode full-time', 'combined') !== 'Yes' || language !== 'English') {
    throw new Error(`${key}: page no longer reads as a full-time English bachelor/long-cycle programme`);
  }

  const czkFee = (txt.match(/fees are paid per academic year ([\d,. ]+) CZK/) || [])[1];
  const fee = facts.eur ?? (czkFee ? toEur(czkAmount(czkFee), rate) : null);
  // The euro figure moves with the exchange rate; the koruna one is the fee.
  const feeNote = czkFee ? `Fee is ${czkFee.trim()} CZK (euros at ČNB rate, ${rateDate}).` : '';

  rows.push(toRow({
    programme_id: nextId(`en-${key.replace(/^\d+-/, '')}`),
    university_id: 'muni',
    programme: czText((html.match(/<h1[^>]*>([^]*?)<\/h1>/) || [])[1] || ''),
    degree_type: type === "Bachelor's" ? 'Bc.' : 'Long-cycle master',
    subject_area: facts.area,
    language: 'English',
    ib_points_min: facts.ib ?? '',
    ib_subjects: facts.subjects ?? '',
    admission: facts.admission,
    // "?" rather than blank: blank would inherit the university's 0, and
    // English-taught study is never free.
    tuition_eu: fee ?? '?',
    application_deadline: facts.deadline ?? '',
    deadline_notes: [facts.note, feeNote].filter(Boolean).join(' '),
    official_url: url,
    last_verified: VERIFIED,
    verified_by: 'AI-DRAFT',
  }));
}

writeFileSync(new URL('./muni-rows.csv', import.meta.url), `${rows.join('\n')}\n`);
console.log(
  `rows written: ${rows.length} (${rows.length - Object.keys(ENGLISH).length} Czech-taught, ${Object.keys(ENGLISH).length} English-taught)\n`
  + `  skipped ${skipped.notFullTime} not full-time, ${skipped.notCzech} not Czech-taught, ${skipped.noType} follow-up or unknown type\n`
  + `  ${noAdmission} Czech rows with no recognisable admission section (left blank)`,
);
