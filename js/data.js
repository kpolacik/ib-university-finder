// Loads the two sheets, joins them, and normalises everything into the one
// shape the rest of the site uses. Nothing downstream should ever see a raw
// spreadsheet string.

import { csvToObjects } from './csv.js';
import { parseCaoSentence, ibForCutoff } from './points.js';
import {
  SHEET_CSV_URLS, SAMPLE_CSV_URLS, SNAPSHOT_URL,
  STALE_AFTER_DAYS, URGENT_WITHIN_DAYS,
} from './config.js';

const DAY = 24 * 60 * 60 * 1000;

// `timeoutMs` is per request. It is a parameter rather than a config value so
// tools/check.mjs can test a request that never answers in milliseconds.
export async function loadData(today = new Date(), { timeoutMs = 10000 } = {}) {
  const sources = [];

  if (SHEET_CSV_URLS.universities && SHEET_CSV_URLS.programmes) {
    sources.push({ kind: 'live', urls: SHEET_CSV_URLS });
  } else {
    sources.push({ kind: 'sample', urls: SAMPLE_CSV_URLS });
  }

  const failures = [];

  for (const source of sources) {
    try {
      const [uniText, progText] = await Promise.all([
        fetchText(source.urls.universities, timeoutMs),
        fetchText(source.urls.programmes, timeoutMs),
      ]);
      const uni = csvToObjects(uniText, 'Universities');
      const prog = csvToObjects(progText, 'Programmes');
      // A file that read without error can still be useless: empty, only a
      // header, a login page served as HTML, or a renamed column. Each of those
      // used to load as an empty or blank site (L01, L05). Throwing here sends
      // the loader to the saved copy, and the reason lands in the issues.
      requireColumns(uni, 'Universities', REQUIRED_UNIVERSITY_COLUMNS);
      requireColumns(prog, 'Programmes', REQUIRED_PROGRAMME_COLUMNS);
      if (prog.rows.length === 0) throw new Error('the Programmes file has no data rows');
      const built = build(uni.rows, prog.rows, today);
      return {
        programmes: built.programmes,
        meta: {
          source: source.kind,
          sampleCount: built.sampleCount,
          draftCount: built.draftCount,
          total: built.programmes.length,
          snapshotDate: null,
          issues: [...uni.issues, ...prog.issues, ...built.issues],
        },
      };
    } catch (err) {
      failures.push(err.message);
    }
  }

  // Everything above failed. Fall back to the committed snapshot — but the
  // caller must tell the user, because a snapshot can be months out of date
  // and stale deadlines are the one thing this site must not present quietly.
  const reasons = failures.map((f) => `Live data unavailable: ${f}`);
  let snapshot;
  let built;
  try {
    // fetchBody checks res.ok first. Without that, a missing file's HTML error
    // page went to .json(), and the banner showed the parse error (L07).
    snapshot = await fetchBody(SNAPSHOT_URL, timeoutMs, async (res) => {
      try {
        return await res.json();
      } catch {
        throw new Error(`${SNAPSHOT_URL} is not a readable saved copy`);
      }
    });
    if (!snapshot || !Array.isArray(snapshot.programmes) || snapshot.programmes.length === 0) {
      throw new Error(`${SNAPSHOT_URL} has no programmes in it`);
    }
    built = build(
      withRowNumbers(snapshot.universities),
      withRowNumbers(snapshot.programmes),
      today,
    );
  } catch (err) {
    // The page shows one plain sentence; the reasons go to the issues panel.
    const total = new Error('no programme data could be loaded');
    total.reasons = [...reasons, `Saved copy unavailable: ${err.message}`];
    throw total;
  }
  return {
    programmes: built.programmes,
    meta: {
      source: 'snapshot',
      // No is_sample override here: build() already counted the rows marked
      // SAMPLE. A stored flag would go stale the moment rows are signed off,
      // and would fire the red banner over real data.
      sampleCount: built.sampleCount,
      draftCount: built.draftCount,
      total: built.programmes.length,
      snapshotDate: snapshot.meta ? parseIsoDate(snapshot.meta.generated_at) : null,
      issues: [...built.issues, ...reasons],
    },
  };
}

// The columns whose loss blanks the whole site or its trust signal. Every other
// column (aliases, application_system, admission, ...) is optional, so a Sheet
// that lacks one still loads. application_deadline is here because a renamed
// header would turn every deadline into "Not published" while the saved copy
// has them.
const REQUIRED_UNIVERSITY_COLUMNS = ['university_id', 'name', 'country', 'verified_by'];
const REQUIRED_PROGRAMME_COLUMNS = [
  'programme_id', 'university_id', 'programme', 'application_deadline', 'official_url', 'verified_by',
];

function requireColumns(parsed, label, required) {
  const missing = required.filter((c) => !parsed.header.includes(c));
  if (missing.length === 0) return;
  if (parsed.header.length === 0) throw new Error(`the ${label} file is empty`);
  throw new Error(
    `the ${label} file has no ${missing.map((c) => `"${c}"`).join(', ')} column ` +
    `(renamed, deleted, or not a CSV at all)`
  );
}

// A school network can leave a request hanging for minutes. After timeoutMs
// it counts as failed, so the saved copy is tried instead (L02). The timeout
// covers reading the body too, which is why this returns the body, not the
// response.
async function fetchBody(url, timeoutMs, read, init = {}) {
  let timer;
  let signal;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    signal = AbortSignal.timeout(timeoutMs);
  } else {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }
  try {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await read(res);
  } catch (err) {
    if (signal.aborted) throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fetchText(url, timeoutMs) {
  return fetchBody(url, timeoutMs, (res) => res.text(), { cache: 'no-cache' });
}

// The snapshot has no header row, so error messages count from the array
// index instead — off by the same one row the CSV path is off by.
function withRowNumbers(rows) {
  return (rows || []).map((row, i) => ({ ...row, __row: i + 2 }));
}

// ---------------------------------------------------------------- building

function build(universityRows, programmeRows, today) {
  const issues = [];
  const universities = new Map();

  for (const row of universityRows) {
    const id = text(row.university_id);
    if (!id) {
      issues.push(`Universities row ${row.__row}: no university_id — row skipped.`);
      continue;
    }
    if (universities.has(id)) {
      issues.push(`Universities row ${row.__row}: university_id "${id}" is used twice — second row skipped.`);
      continue;
    }
    universities.set(id, {
      id,
      name: text(row.name),
      city: text(row.city),
      country: text(row.country),
      applicationSystem: text(row.application_system),
      livingCostMonthly: number(row.living_cost_monthly, issues, `Universities row ${row.__row}, living_cost_monthly`, NOT_NEGATIVE),
      tuitionEuDefault: number(row.tuition_eu_default, issues, `Universities row ${row.__row}, tuition_eu_default`, NOT_NEGATIVE),
      tuitionNonEuDefault: number(row.tuition_noneu_default, issues, `Universities row ${row.__row}, tuition_noneu_default`, NOT_NEGATIVE),
      englishRequirementDefault: text(row.english_requirement_default),
      // How places are decided, when it is the same across the university —
      // every Irish course goes through CAO points. Czech and Dutch rows vary
      // by programme, so they leave this blank and say it per row.
      admissionDefault: text(row.admission_default),
      // What a diploma has to clear before any programme-specific requirement.
      // It differs by country, so it cannot be a sentence baked into the
      // renderer — the Netherlands says VWO, nowhere else does.
      baselineRequirement: text(row.baseline_requirement),
      studentLifeUrl: url(row.student_life_url, issues, `Universities row ${row.__row}, student_life_url`),
      lastVerified: date(row.last_verified, issues, `Universities row ${row.__row}, last_verified`),
      verifiedBy: signer(row.verified_by, issues, `Universities row ${row.__row}`),
      // Short and native names people search for ("UvA", "ČVUT", "Univerzita
      // Karlova"), only ever read into the search text. A Sheet or snapshot
      // without the column gives none, which is fine (S01).
      aliases: list(row.aliases, BULLET),
    });
  }

  const programmes = [];
  const seen = new Set();

  for (const row of programmeRows) {
    const where = `Programmes row ${row.__row}`;
    const id = text(row.programme_id);

    if (!id) {
      issues.push(`${where}: no programme_id — row skipped.`);
      continue;
    }
    if (seen.has(id)) {
      issues.push(`${where}: programme_id "${id}" is used twice — second row skipped.`);
      continue;
    }
    const uni = universities.get(text(row.university_id));
    if (!uni) {
      issues.push(`${where}: university_id "${text(row.university_id)}" is not on the Universities tab — row skipped.`);
      continue;
    }
    seen.add(id);

    const tuitionEu = inheritNumber(row.tuition_eu, uni.tuitionEuDefault, issues, `${where}, tuition_eu`);
    const tuitionNonEu = inheritNumber(row.tuition_noneu, uni.tuitionNonEuDefault, issues, `${where}, tuition_noneu`);

    // The programme row's own date and signer: signing a programme covers
    // everything its card shows, including what it takes from the university
    // row (T01, Q14 = A, 2026-10-26). The university's AI-DRAFT and its date
    // used to be joined in, so a signed programme never showed as checked.
    const lastVerified = date(row.last_verified, issues, `${where}, last_verified`);
    const deadline = date(row.application_deadline, issues, `${where}, application_deadline`);

    const verifiedBy = signer(row.verified_by, issues, where);
    // The card's "Checked" line needs the date as well as the initials. Since
    // the university's date no longer fills in, a signed row without its own
    // date counted as checked but showed nothing, with no hint why.
    if (verifiedBy && !verifiedBy.includes('AI-DRAFT') && !verifiedBy.includes('SAMPLE') && !lastVerified) {
      issues.push(`${where}: signed "${verifiedBy}" but last_verified is blank — the card shows no "Checked" line. Put today's date in last_verified.`);
    }

    const city = inheritText(row.city, uni.city);
    const subjects = text(row.ib_subjects);
    const ibPointsMin = number(row.ib_points_min, issues, `${where}, ib_points_min`, IB_POINTS);
    const deadlineNotes = text(row.deadline_notes);
    const otherRequirements = list(row.other_requirements, BULLET);
    const rankedWithHpat = ibPointsMin !== null && deadlineNotes.includes(HPAT_NOTE);
    const cao = cutoffSentence(uni, ibPointsMin, rankedWithHpat, deadlineNotes, otherRequirements);

    programmes.push({
      id,
      programme: text(row.programme),
      degreeType: text(row.degree_type),
      subjectAreas: list(row.subject_area),
      languages: list(row.language),

      universityId: uni.id,
      university: uni.name,
      // Satellite campuses: University College Roosevelt is in Middelburg, not
      // Utrecht. Blank means "the university's home city".
      city,
      // "?" empties `city` (it never inherits), which on its own made the card
      // show only the country, as if the city did not matter. This lets the
      // card say the city is not published instead.
      cityUnknown: text(row.city) === UNKNOWN,
      country: uni.country,
      // A programme can apply through a different route from the rest of its
      // university: Bocconi's World Bachelor goes through the Common App, not
      // Bocconi's own portal. Blank inherits, "?" means unknown.
      applicationSystem: inheritText(row.application_system, uni.applicationSystem),
      livingCostMonthly: uni.livingCostMonthly,
      baselineRequirement: uni.baselineRequirement,

      tuitionEu,
      tuitionNonEu,
      ibPointsMin,
      // An Irish figure that is only reachable with the 25 bonus points for HL
      // Maths 4+ (a 601-625 CAO cutoff). The note's exact sentence is what marks
      // it, so the card can say "needs HL Maths 4+" (Q13, 2026-10-25).
      needsHlMaths: ibPointsMin !== null && deadlineNotes.includes(BONUS_ONLY),
      // Irish cutoffs above 625 include a test score, so they are never an IB
      // figure (Q12 option C, 2026-10-25). HPAT Medicine shows the CAO's
      // 480-point minimum and is then ranked with the HPAT; the other test
      // courses show no figure and say the cutoff includes a test score.
      rankedWithHpat,
      pointsPlusTest: ibPointsMin === null && deadlineNotes.includes(PLUS_TEST),
      // What kind of figure ib_points_min is, so the card can say it (P01, Q2
      // interim, 2026-10-26). "cutoff": an Irish course's IB equivalent of last
      // year's CAO cutoff, which moves with demand every year. "minimum": what
      // the university publishes as its floor, including UCD's stated IB
      // minimum and the CAO's 480-point HPAT Medicine minimum. null: no figure.
      // Derived from the university and the CAO sentence because there is no
      // column for it yet; plans/backlog/points-value-kind.md replaces this
      // with a field the importers write.
      pointsKind: ibPointsMin === null ? null : (cao ? 'cutoff' : 'minimum'),
      // On a "cutoff" row only: the CAO sentence read back, each round with its
      // own IB equivalent ({ ib, bonusOnly } from js/points.js), and `test` when
      // the CAO marks the course as including a test, interview or audition.
      cao,

      // Three requirement kinds, kept apart so a card can show only what
      // applies. ib_subjects has its own three states:
      //   "none"  -> the university states there are no subject requirements
      //   blank   -> nobody has checked yet (NOT the same thing)
      //   text    -> the requirements
      // Blank defaulting to "not checked" is deliberate: a cell someone forgot
      // to fill in must never read as "there is nothing to meet".
      ibSubjects: subjects === NO_REQUIREMENT ? '' : subjects,
      noSubjectsRequired: subjects === NO_REQUIREMENT,
      otherRequirements,

      // How the place is actually decided: open entry, a ranking, an entrance
      // exam. Same inherit / "?" rules as english_requirement, same bullet.
      admission: list(inheritText(row.admission, uni.admissionDefault), BULLET),
      // "?" empties `admission` (it never inherits), which on its own makes the
      // card look as if there were no admission route. This lets the card say
      // "Not published" instead: the route differs from the university's, but
      // nobody has found out what it is.
      admissionUnknown: text(row.admission) === UNKNOWN,

      // Split on the same bullet as other_requirements — the docs teach one
      // separator, so every column that uses it must honour it.
      englishRequirement: list(inheritText(row.english_requirement, uni.englishRequirementDefault), BULLET),
      // Same as admissionUnknown: "?" means a requirement exists but nobody has
      // found it, which the card must not show as nothing to meet.
      englishUnknown: text(row.english_requirement) === UNKNOWN,

      deadline,
      deadlineNotes,
      officialUrl: officialUrl(row.official_url, issues, `${where}, official_url`),
      studentLifeUrl: uni.studentLifeUrl,

      lastVerified,
      verifiedBy,

      // daysUntilDeadline, deadlinePassed, isUrgent and isStale are set by
      // applyToday() below, because they change at midnight.

      // verified_by is the site's promise that a person read the official page.
      // Rows gathered automatically say AI-DRAFT until someone signs them off,
      // and invented rows say SAMPLE. Neither may pass as checked, and nor may a
      // blank cell: "nobody signed" used to read as "Checked" with no name (T04).
      // The programme's own signer decides (T01). SAMPLE on either row still
      // marks the row as invented: a real signature cannot vouch for made-up
      // university defaults.
      isSample: verifiedBy.includes('SAMPLE') || uni.verifiedBy.includes('SAMPLE'),
      isChecked: Boolean(verifiedBy) && !verifiedBy.includes('AI-DRAFT') &&
                 !verifiedBy.includes('SAMPLE') && !uni.verifiedBy.includes('SAMPLE'),

      // Subject areas are in, so "medicine" finds a Medicine & Health row whose
      // title doesn't say it (S01). Language and degree type stay out: "english"
      // would match most rows, and language has its own filter.
      searchBlob: foldAccents(
        [text(row.programme), uni.name, ...uni.aliases, city, LOCAL_CITY_NAMES.get(city) || '',
          uni.country, ...list(row.subject_area)].join(' ')
      ).toLowerCase(),
    });
  }

  addProgrammeIdentity(programmes);
  applyToday(programmes, today);

  if (programmes.length === 0 && programmeRows.length > 0) {
    throw new Error('every programme row failed to load');
  }

  // "some", not "every": one invented row mixed into real data must still raise
  // the alarm, otherwise the real rows lend it credibility.
  const sampleCount = programmes.filter((p) => p.isSample).length;
  // Counts every row nobody has signed, not only the AI-DRAFT ones, so a blank
  // signer keeps the research banner up instead of taking it down (T04).
  const draftCount = programmes.filter((p) => !p.isChecked && !p.isSample).length;

  return { programmes, issues, sampleCount, draftCount };
}

// SIS codes identify faculties independently of CSV order and programme ids.
// Names: https://is.cuni.cz/studium/eng/prijimacky/index.php?do=info_fakulta
// Czech aliases: https://is.cuni.cz/studium/prijimacky/index.php?do=info_fakulta
const CHARLES_FACULTIES = new Map([
  ['11110', ['First Faculty of Medicine', '1. lékařská fakulta', '1st Faculty of Medicine']],
  ['11130', ['Second Faculty of Medicine', '2. lékařská fakulta', '2nd Faculty of Medicine']],
  ['11120', ['Third Faculty of Medicine', '3. lékařská fakulta', '3rd Faculty of Medicine']],
  ['11140', ['Faculty of Medicine in Pilsen', 'Lékařská fakulta v Plzni']],
  ['11150', ['Faculty of Medicine in Hradec Králové', 'Lékařská fakulta v Hradci Králové']],
  ['11160', ['Faculty of Pharmacy in Hradec Králové', 'Farmaceutická fakulta v Hradci Králové']],
  ['11210', ['Faculty of Arts', 'Filozofická fakulta']],
  ['11220', ['Faculty of Law', 'Právnická fakulta']],
  ['11230', ['Faculty of Social Sciences', 'Fakulta sociálních věd']],
  ['11240', ['Faculty of Humanities', 'Fakulta humanitních studií']],
  ['11260', ['Catholic Theological Faculty', 'Katolická teologická fakulta']],
  ['11270', ['Faculty of Protestant Theology', 'Evangelická teologická fakulta']],
  ['11280', ['Hussite Theological Faculty', 'Husitská teologická fakulta']],
  ['11310', ['Faculty of Science', 'Přírodovědecká fakulta']],
  ['11320', ['Faculty of Mathematics and Physics', 'Matematicko-fyzikální fakulta']],
  ['11410', ['Faculty of Education', 'Pedagogická fakulta']],
  ['11510', ['Faculty of Physical Education and Sport', 'Fakulta tělesné výchovy a sportu']],
]);

export function charlesFaculty(officialUrl, universityId) {
  if (universityId !== 'cuni') return null;
  try {
    const url = new URL(officialUrl);
    if (url.hostname !== 'is.cuni.cz' || url.port ||
        !['https:', 'http:'].includes(url.protocol) ||
        url.pathname !== '/studium/prijimacky/index.php' ||
        url.searchParams.get('do') !== 'detail_obor') return null;
    const names = CHARLES_FACULTIES.get(url.searchParams.get('fakulta'));
    return names ? { name: names[0], aliases: names.slice(1) } : null;
  } catch {
    return null;
  }
}

function addProgrammeIdentity(programmes) {
  const groups = new Map();
  for (const row of programmes) {
    row.faculty = charlesFaculty(row.officialUrl, row.universityId);
    if (row.faculty) {
      row.searchBlob += ' ' + foldAccents([row.faculty.name, ...row.faculty.aliases].join(' ')).toLowerCase();
    }
    const key = JSON.stringify([row.universityId, row.programme.trim().toLowerCase().normalize('NFC')]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  // Compute once on the full catalogue: filtering or chunked rendering must
  // never renumber a sibling or erase the fact that it has a same-name entry.
  // Unknown values cannot establish a difference; already displayed facts can.
  const known = (value) => value !== null && value !== undefined && value !== '' && value !== '?';
  const facts = (row) => [
    row.faculty?.name, row.degreeType, row.city, row.languages.filter(known).join(', '),
    row.ibSubjects, row.otherRequirements.filter(known).join(' · '),
    row.admission.filter(known).join(' · '), row.tuitionEu, row.deadline?.getTime(),
    row.ibPointsMin,
  ];
  const differs = (a, b) => facts(a).some((value, i) => {
    const other = facts(b)[i];
    return known(value) && known(other) && value !== other;
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    group.forEach((row, i) => {
      const unresolved = group.some((other) => other !== row && !differs(row, other));
      row.identity = {
        text: row.faculty?.name || '',
        entry: i + 1,
        count: group.length,
        unresolved,
      };
      if (unresolved) {
        const fallback = `Same-name entry ${i + 1} of ${group.length} · compare official pages`;
        row.identity.text = [row.identity.text, fallback].filter(Boolean).join(' · ');
      }
    });
  }
}

// The fields that depend on today's date. They used to be set once at load,
// so a tab left open past midnight kept yesterday's deadline state (S06).
// app.js calls this again when the local date has changed.
export function applyToday(programmes, today) {
  for (const p of programmes) {
    // Whole days from today. Negative means the date has gone.
    const days = p.deadline ? Math.round((p.deadline.getTime() - startOfDay(today)) / DAY) : null;
    p.daysUntilDeadline = days;
    p.deadlinePassed = days !== null && days < 0;
    p.isUrgent = days !== null && days >= 0 && days <= URGENT_WITHIN_DAYS;
    p.isStale = p.lastVerified ? (today - p.lastVerified) / DAY > STALE_AFTER_DAYS : true;
  }
  return programmes;
}

// ---------------------------------------------------------------- helpers

function text(value) {
  return value == null ? '' : String(value).trim();
}

// Three states, not two:
//   blank  -> same as the university's default
//   "?"    -> differs from the university, but we do not know the figure
//   number -> this programme's own figure
//
// Without "?" there was no way to say "the default is wrong here", so a
// university college charging double the standard rate would quietly inherit
// the standard rate and show it as fact.
const UNKNOWN = '?';

// The university states there is nothing to meet. Blank means nobody checked —
// see the ib_subjects comment below for why those must stay different.
const NO_REQUIREMENT = 'none';

// One bullet separator, used by every column that holds a list of short items.
// Exported so the CSV export joins on exactly what the parser split on.
export const BULLET = ' · ';

// The local name of a city whose English name is what the CSV stores, so
// "Praha" finds Prague. Keyed on the programme's own city rather than put in the
// university's aliases: Charles University also teaches in Plzeň and Hradec
// Králové, and those rows must not come up for "Praha".
const LOCAL_CITY_NAMES = new Map([
  ['Prague', 'Praha'],
  ['Milan', 'Milano'],
  ['Turin', 'Torino'],
  ['Rome', 'Roma'],
  ['The Hague', 'Den Haag'],
]);

// The exact deadline_notes sentence the Irish tools write when a figure assumes
// the 25 HL Maths bonus points. A copy of BONUS_ONLY in tools/lib/ireland.mjs,
// because the browser cannot import from tools/; check.mjs asserts the two are
// equal, so editing one alone fails the checks.
export const BONUS_ONLY = 'Only reachable with the 25 HL Maths bonus points.';
// The same for HPAT Medicine and for other cutoffs that include a test score
// (copies of HPAT_NOTE and PLUS_TEST in tools/lib/ireland.mjs, also compared by
// check.mjs). Mind the plain ASCII apostrophe in "last year's".
export const HPAT_NOTE = "The CAO minimum for Medicine is 480 points; places then go on points plus the HPAT test, so last year's cutoff is not an IB figure.";
export const PLUS_TEST = 'Above what any IB total can reach, because the cutoff includes test or audition marks, so no IB figure is given.';

// The other_requirements tag the Irish importers write when the CAO marks a
// course "#" (test, interview, portfolio or audition). Its cutoff may include
// those marks, so it is not a pure points total.
export const CAO_TEST = 'Test, interview, portfolio or audition';

// UCD publishes its own IB minimum per course, and the Irish tools store that
// instead of a converted cutoff (STATUS decision), so a UCD figure is a minimum
// even though its note also quotes the CAO cutoff.
const UCD_ID = 'ucd';

// The parsed CAO sentence of a row whose figure is a converted CAO cutoff, or
// null for every other row. HPAT Medicine is a minimum (the CAO's 480), and a
// sentence with no round that had a cutoff gives nothing to convert.
function cutoffSentence(uni, ibPointsMin, rankedWithHpat, notes, otherRequirements) {
  if (ibPointsMin === null || uni.country !== 'Ireland' || uni.id === UCD_ID || rankedWithHpat) return null;
  const sentence = parseCaoSentence(notes);
  if (!sentence || !sentence.rounds.some((r) => r.points !== null)) return null;
  const test = otherRequirements.includes(CAO_TEST);
  return {
    year: sentence.year,
    code: sentence.code,
    test,
    rounds: sentence.rounds.map((r) => ({ ...r, ...ibForCutoff(r.points, { test }) })),
  };
}

// A blank signer is reported: the cell is the site's only record of who read
// the official page, so an empty one is a gap someone should fill, not a pass.
function signer(raw, issues, where) {
  const value = text(raw);
  if (value === '') issues.push(`${where}: verified_by is blank — shown as not checked. Write AI-DRAFT or your initials.`);
  return value;
}

function inheritNumber(raw, fallback, issues, label) {
  const value = text(raw);
  if (value === UNKNOWN) return null;
  if (value === '') return fallback;
  return number(value, issues, label, NOT_NEGATIVE);
}

function inheritText(raw, fallback) {
  const value = text(raw);
  if (value === UNKNOWN) return '';
  return value || fallback;
}

function list(value, separator = ';') {
  return text(value).split(separator).map((s) => s.trim()).filter(Boolean);
}

// Ranges for number(). Every money column is a fee or a cost, so never below
// 0; IB points are a whole number on the 24-45 diploma scale. A value outside
// its range is reported and treated as not published, never clamped (L04).
const NOT_NEGATIVE = { min: 0, says: 'below 0' };
const IB_POINTS = { min: 24, max: 45, whole: true, says: 'not a whole number of IB points from 24 to 45' };

function number(value, issues, label, range = {}) {
  const raw = text(value);
  if (raw === '') return null;
  const cleaned = raw.replace(/[€$\s ]/g, '');
  // A comma is accepted only as a thousands separator ("12,500"). Stripping
  // every comma read a decimal comma, "2771,00", as 277100.
  if (cleaned.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    issues.push(`${label}: "${raw}" is not a number (use a dot for decimals, or no separator) — treated as not published.`);
    return null;
  }
  const n = Number(cleaned.replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    issues.push(`${label}: "${raw}" is not a number — treated as not published.`);
    return null;
  }
  if ((range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max)
      || (range.whole && !Number.isInteger(n))) {
    issues.push(`${label}: "${raw}" is ${range.says} — treated as not published.`);
    return null;
  }
  return n;
}

// Links are typed by hand into a spreadsheet anyone on the team can edit, so
// only http(s) gets through — "javascript:..." in an href is a real thing.
// A rejected link is reported rather than dropped quietly: official_url is the
// one field the site promises to show on every single card.
export function safeUrl(value) {
  const raw = text(value);
  if (raw === '') return null;
  try {
    const parsed = new URL(raw);
    // "https://www.ucd.ie@evil.example/" goes to evil.example: everything
    // before the "@" is a user name. No official page needs one (X01).
    if (parsed.username || parsed.password) return null;
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
  } catch {
    return null;
  }
}

function url(value, issues, label) {
  const raw = text(value);
  if (raw === '') return null;
  const clean = safeUrl(raw);
  if (!clean) {
    issues.push(`${label}: "${raw}" is not a usable link — it must start with https://.`);
  }
  return clean;
}

// official_url is the one link the site promises on every card. A blank one
// used to pass quietly; the card says "No official link on file", and now the
// problems list says which row needs it (T04).
function officialUrl(value, issues, label) {
  if (text(value) === '') {
    issues.push(`${label} is blank — the card says "No official link on file". Add the programme's official page.`);
    return null;
  }
  return url(value, issues, label);
}

function date(value, issues, label) {
  const raw = text(value);
  if (raw === '') return null;

  const iso = parseIsoDate(raw);
  if (iso) return iso;

  // Google Sheets rewrites ISO dates into the spreadsheet's locale format
  // unless the column is set to Plain text. Read those, but say so, because
  // the fix belongs in the sheet.
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  if (m) {
    const d = utcDate(+m[3], +m[2], +m[1]);
    if (d) {
      issues.push(
        `${label}: "${raw}" is not YYYY-MM-DD — read as day/month/year. ` +
        `Set that column to Plain text in the Sheet and re-enter the date.`
      );
      return d;
    }
  }

  issues.push(`${label}: "${raw}" is not a date we can read — treated as missing.`);
  return null;
}

function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  return m ? utcDate(+m[1], +m[2], +m[3]) : null;
}

function utcDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects things like 2026-02-31, which JavaScript would happily roll over.
  const ok = d.getUTCFullYear() === year &&
             d.getUTCMonth() === month - 1 &&
             d.getUTCDate() === day;
  return ok ? d : null;
}

function startOfDay(today) {
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
}

// So that searching "Munchen" finds "München" and "Kosice" finds "Košice".
function foldAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export { foldAccents };
