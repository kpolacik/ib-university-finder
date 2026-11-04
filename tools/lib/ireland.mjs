// Shared pieces for the seven Irish importers (Trinity, UCD, UCC, Galway, DCU, UL, Maynooth).
//
// import-tcd.mjs came first, and this file was later split out of the pieces
// every Irish importer needs. Trinity's importer now imports getHtml, toText,
// lowestIB, areasFor, otherFor, toRow, HPAT_CODES and HPAT from here too. It
// keeps only its own course-list parsing, its id scheme (idFor, by URL) and
// its subject parsing (ibFrom), because Trinity's pages are laid out
// differently from the other five.

// CAO's official IB conversion (TABLE), lowestIB and ibForCutoff live in
// js/points.js, so the browser's "HL Maths 4+" tick and these tools read the
// same table. lowestIB is re-exported so the tools keep one import path.
import { lowestIB, ibForCutoff, testScoring } from '../../js/points.js';
export { lowestIB };

const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
};

// UCD and Maynooth answer 403 to a bare Node fetch, so every request carries a
// browser user-agent. One retry, because a single dropped connection in the
// middle of 200 course pages should not lose the run.
export async function getHtml(url, tries = 2) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } catch (err) {
      if (i >= tries) throw new Error(`${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** The same request, kept as bytes — Maynooth publishes its fees as a PDF. */
export async function getBuffer(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Tags stripped, entities unwrapped, whitespace collapsed. Every one of these
// sites states its numbers in running text, so a text view is enough and no
// HTML parser is needed.
export const toText = (html) =>
  html
    .replace(/<script[^]*?<\/script>/gi, ' ')
    .replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#39;/g, "'")
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The sentence for a cutoff no IB total reaches on its own (lowestIB gave null).
 *
 * It used to say "above the 625-point IB maximum" for every such cutoff. That is
 * false for 601-625: a 45 converts to 600, and the 25 bonus points for HL Maths
 * 4+ lift it to 625, so those cutoffs are reachable, just not by the IB total
 * alone. Only above 625 is the cutoff truly off the scale.
 *
 * convertCutoff now gives a 601-625 cutoff a bonus figure, so the 601-625
 * sentence without a test only appears if that path somehow fails. A 601-625
 * cutoff with the CAO "#" marker (`test`) may include test or portfolio marks
 * (UL Architecture), so it is not a points total and gets its own sentence.
 * Shared by both Irish importers and update-cao-points.mjs so a rerun cannot
 * write a false sentence back.
 */
export const aboveIB = (points, test = false) => points > 625
  ? (test ? PLUS_TEST : 'Above the 625-point IB maximum, so no IB equivalent.')
  : test
    ? 'Above the 600 points a 45 converts to, and the cutoff may include test or portfolio marks, so no IB figure is given.'
    : 'Above the 600 points a 45 converts to; reachable only with the 25 HL Maths bonus points, so no IB figure is given.';

// The exact sentence the card reads. js/data.js keeps a copy of BONUS_ONLY
// (the browser cannot import from tools/), and check.mjs asserts they match:
// a row whose note carries BONUS_ONLY shows "needs HL Maths 4+" on its card.
// The informational "HL Maths 4+ adds 25 bonus points." used to go on courses
// whose title sounded mathematical (126 rows). The bonus applies to any
// course, so it went on 2026-10-26 (registry D28); the "HL Maths 4+" tick next
// to My points says it once instead. OLD_CAO_SENTENCES in cao-points.mjs still
// strips it, so a refresh removes any left over.
export const BONUS_ONLY = 'Only reachable with the 25 HL Maths bonus points.';

/**
 * Every Irish cutoff above 625 includes a test score: the HPAT for Medicine,
 * or the CAO "#" marker (an audition or test) on the rest. So it is not a
 * points total and is never turned into an IB figure or used to hide a course
 * (Q12 option C, Leon 2026-10-25).
 *
 * For HPAT Medicine the CAO publishes a real minimum instead. Its brochure
 * "Selection Criteria for Undergraduate Entry to Medicine for EU Applicants
 * 2027" (www2.cao.ie/downloads/documents/2027/UGMedEntry2027.pdf, read
 * 2026-10-25) says school leavers need "a minimum of 480 points" (Leaving
 * Certificate "or equivalent"), and places then go on "the combined score of
 * Leaving Certificate (or equivalent) and HPAT-Ireland". 480 converts to 35 IB
 * points through TABLE. Re-check the brochure each cycle, like HPAT_CODES.
 * js/data.js keeps copies of HPAT_NOTE and PLUS_TEST; check.mjs compares them.
 */
export const HPAT_MIN_POINTS = 480;
export const HPAT_NOTE = `The CAO minimum for Medicine is ${HPAT_MIN_POINTS} points; places then go on points plus the HPAT test, so last year's cutoff is not an IB figure.`;
export const PLUS_TEST = 'Above what any IB total can reach, because the cutoff includes test or audition marks, so no IB figure is given.';

// D27 (Leon, option 2, 2026-11-02): the notes for a "#" course in
// TEST_IN_CUTOFF or TEST_UNVERIFIED (js/points.js), whatever its cutoff. The
// browser reads the code, not these sentences, so they are for people reading
// the CSV.
export const TEST_ADDED = 'The cutoff includes marks from the test, interview or audition, so it is not a points total and no IB figure is given.';
export const TEST_UNCONFIRMED = 'Entry also needs a test, interview, portfolio or audition, and no official page confirms whether its marks are in the cutoff, so no IB figure is given.';

/**
 * The ib_points_min figure and the note sentences for one CAO cutoff. All three
 * Irish writers (irish-import.mjs, import-tcd.mjs, update-cao-points.mjs) call
 * this, so a rerun of any of them gives the same figure and wording.
 *
 * The bonus path used to depend on the course title (a maths-sounding name, or
 * "mathemat" in the subjects). The CAO's 25 bonus points for HL Maths at 4+
 * apply to any course, so the title made UCC Dentistry and DCU Global Business
 * (USA) show no figure while Trinity Dental Science showed 44 (registry P03).
 * Leon decided on 2026-10-25 (Q13): every 601-625 cutoff without a test gets
 * lowestIB(cutoff - 25) and BONUS_ONLY, and the card says "needs HL Maths 4+".
 * A cutoff with a test (`test`: the CAO "#" marker or an HPAT code) may include
 * test marks, so it is not a points total and gets no bonus figure.
 *
 * The figure itself comes from ibForCutoff in js/points.js, the same function
 * the browser uses. `hpat` (the CAO code is in HPAT_CODES) gives the CAO's
 * Medicine minimum instead of any conversion. `code` (the CAO code) picks out
 * the "#" courses in TEST_IN_CUTOFF / TEST_UNVERIFIED, which get no figure
 * and their own sentence (D27).
 */
export function convertCutoff(points, { test = false, hpat = false, code = null } = {}) {
  // An HPAT cutoff is never a points total, and the 480 minimum does not depend
  // on there having been a cutoff, so HPAT courses always get the CAO minimum,
  // even with no cutoff (AQA, none published, or no CAO entry: points null).
  if (hpat) return { ib: lowestIB(HPAT_MIN_POINTS), notes: [HPAT_NOTE] };
  if (points === null || points === undefined) return { ib: null, notes: [] };
  const scoring = testScoring(code, test);
  if (scoring) return { ib: null, notes: [scoring === 'included' ? TEST_ADDED : TEST_UNCONFIRMED] };
  const { ib, bonusOnly } = ibForCutoff(points, { test });
  const notes = [];
  if (bonusOnly) notes.push(BONUS_ONLY);
  if (ib === null) notes.push(aboveIB(points, test));
  return { ib, notes };
}

export const SUBJ = Object.freeze([
  [/comput|software|information systems|informat|data science|artificial intelligence/i, 'Computer Science'],
  [/engineer/i, 'Engineering'],
  [/mathemat|actuarial|statistic/i, 'Mathematics'],
  // Physical Education is sport, not Physics (also used by Masaryk's importer).
  [/physic(?!al\s+education)|astro|nanotech/i, 'Physics'],
  [/chemi/i, 'Chemistry'],
  [/biolog|biochem|botany|zoolog|genetic|immunolog|microbiolog|neuroscience|physiolog|biomedical sci|biotechnolog|bioscience|marine science/i, 'Biology & Life Sciences'],
  [/environment|geoscience|geography|earth|geolog|climate|agricultur|food science|forestry|equine|horticultur/i, 'Environmental Sciences'],
  [/medicine|dental|dentist|pharmac|nursing|health|nutrition|radiation|radiograph|therap|speech|midwifer|veterinar|paramedic|optometr/i, 'Medicine & Health'],
  [/psycholog/i, 'Psychology'],
  [/econom/i, 'Economics'],
  [/business|management|commerce|marketing|accounting|finance|entrepreneur/i, 'Business & Management'],
  [/\blaw\b|legal|llb|criminolog|criminal justice/i, 'Law'],
  [/politic|international relations|european studies|global|public policy|public administration/i, 'Politics & International Relations'],
  [/sociolog|social (work|studies|policy|science)|anthropol|youth work|community/i, 'Sociology & Anthropology'],
  [/histor|ancient|classic|archaeolog|celtic|heritage/i, 'History'],
  [/philosoph/i, 'Philosophy'],
  [/language|linguist|english|french|german|spanish|italian|russian|polish|literature|translat|japanese|chinese/i, 'Languages & Literature'],
  [/film|media|journalis|communicat|digital humanities/i, 'Media & Communication'],
  [/\bart\b|art history|music|drama|theatre|design|visual|creative|performance/i, 'Art & Design'],
  [/architect|planning|surveying|construction/i, 'Architecture'],
  [/education|teaching|\bsed\b/i, 'Education'],
  [/sport|exercise|physical\s+education/i, 'Sports Science'],
]);

// Unmatched titles stay blank: Liberal Arts describes a course, not a failed guess.
/** Up to three subject areas keyword-mapped from a course title. */
export const areasFor = (name) =>
  [...new Set(SUBJ.filter(([re]) => re.test(name)).map(([, a]) => a))].slice(0, 3).join('; ');

/**
 * The CAO codes whose applicants sit the HPAT, from ACER's HPAT-Ireland home
 * page (hpat-ireland.acer.org), checked 2026-10-25: undergraduate Medicine at
 * Galway, RCSI, Trinity, UCC, UCD and UL. Dental Science is not on it. UL's
 * code is LM301, "Medicine - Undergraduate Entry" in the 2026 CAO table. RCSI
 * (RC001) is left out because no importer reads RCSI. Re-check each cycle:
 * ACER's list is the only source.
 *
 * This used to be a title test (/\bmedicine\b|dental science/), which put an
 * HPAT on Dental Science, Podiatric Medicine and Molecular Medicine, and
 * matched "Veterinary Medicine" before the veterinary rule could. Every
 * importer has the CAO code, so the code decides, ahead of the CAO "test"
 * marker.
 */
export const HPAT_CODES = new Set(['TR051', 'CK701', 'GY501', 'DN400', 'LM301']);
export const HPAT = 'HPAT admission test';

/** Admission hurdles a points total cannot express, spotted from the title. */
export const otherFor = (name) =>
  /veterinar/i.test(name) ? 'Restricted entry — additional assessment'
  : /music|drama|theatre|acting|art & design|fine art|performance/i.test(name) ? 'Audition or portfolio'
  : '';

const esc = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export const COLUMNS = [
  'programme_id', 'university_id', 'city', 'programme', 'degree_type', 'subject_area', 'language',
  'ib_points_min', 'ib_subjects', 'other_requirements', 'admission', 'tuition_eu', 'tuition_noneu',
  'english_requirement', 'application_deadline', 'deadline_notes', 'official_url',
  'last_verified', 'verified_by', 'application_system',
];

/** One programmes.csv line from a partial object, missing fields left blank. */
export const toRow = (fields) => COLUMNS.map((c) => esc(fields[c] ?? '')).join(',');

/** A stable, readable programme_id: prefix plus a slugged title, deduped. */
export function idMaker(prefix) {
  const seen = new Set();
  return (title) => {
    const stem = `${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 44);
    let id = stem;
    for (let n = 2; seen.has(id); n++) id = `${stem}-${n}`;
    seen.add(id);
    return id;
  };
}

/**
 * Titles no Slovak IB applicant can realistically take, or that are not degrees.
 * Graduate entry needs a first degree (UCC's GEM ranks on GAMSAT, whose score
 * of 58 was once converted into "24 IB points"), so school-leavers can't apply.
 * (?<!under) because "Undergraduate Entry Medicine" (UL's LM301, open to school
 * leavers) contains the words "graduate entry" and was being skipped as one.
 */
export const SKIP_TITLE =
  /(?<!under)graduate[- ]entry|gaeilge|irish (language|studies)|as gaeilge|léann|ph\.?d|masters?\b|m\.?sc\b|postgrad|diploma|certificate|foundation|micro-?credential|part[- ]time|access course|mature/i;
