import { t } from './i18n.js';
// Loads the two sheets, joins them, and normalises everything into the one
// shape the rest of the site uses. Nothing downstream should ever see a raw
// spreadsheet string.

import { csvToObjects } from './csv.js';
import { parseCaoSentence, ibForCutoff, testScoring } from './points.js';
import { subjectAreasOf, UNCLASSIFIED } from './subjects.js';
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
      const built = readSheets(uniText, progText, today);
      let translations = [];
      try { translations = csvToObjects(await fetchText('data/i18n/sk.csv', timeoutMs), 'data/i18n/sk.csv').rows; } catch { /* English remains usable. */ }
      return {
        programmes: built.programmes,
        translations,
        meta: {
          source: source.kind,
          sampleCount: built.sampleCount,
          draftCount: built.draftCount,
          total: built.programmes.length,
          snapshotDate: null,
          issues: built.issues,
        },
      };
    } catch (err) {
      failures.push(err.message);
    }
  }

  // Everything above failed. Fall back to the committed snapshot — but the
  // caller must tell the user, because a snapshot can be months out of date
  // and stale deadlines are the one thing this site must not present quietly.
  const reasons = failures.map((f) => t('could_not_load_the_latest_data', { value1: f }));
  let snapshot;
  let built;
  try {
    // fetchBody checks res.ok first. Without that, a missing file's HTML error
    // page went to .json(), and the banner showed the parse error (L07).
    snapshot = await fetchBody(SNAPSHOT_URL, timeoutMs, async (res) => {
      try {
        return await res.json();
      } catch {
        throw new Error(t('is_not_a_readable_saved_copy', { value1: SNAPSHOT_URL }));
      }
    });
    if (!snapshot || !Array.isArray(snapshot.programmes) || snapshot.programmes.length === 0) {
      throw new Error(t('contains_no_programmes', { value1: SNAPSHOT_URL }));
    }
    built = build(
      withRowNumbers(snapshot.universities),
      withRowNumbers(snapshot.programmes),
      today,
    );
  } catch (err) {
    // The page shows one plain sentence; the reasons go to the issues panel.
    const total = new Error(t('no_programme_data_could_be_loaded'));
    total.reasons = [...reasons, t('saved_copy_unavailable', { value1: err.message })];
    throw total;
  }
  return {
    programmes: built.programmes,
    translations: snapshot.translations || [],
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

// The maintainer lint must use the same checks as the page, including parse
// problems and empty files that should send the browser to its saved copy.
export function readSheets(uniText, progText, today = new Date()) {
  const uni = csvToObjects(uniText, 'Universities');
  const prog = csvToObjects(progText, 'Programmes');
  requireColumns(uni, 'Universities', REQUIRED_UNIVERSITY_COLUMNS);
  requireColumns(prog, 'Programmes', REQUIRED_PROGRAMME_COLUMNS);
  if (prog.rows.length === 0) throw new Error(t('the_programmes_file_has_no_data_rows'));
  const built = build(uni.rows, prog.rows, today);
  return { ...built, issues: [...uni.issues, ...prog.issues, ...built.issues] };
}

// The columns whose loss blanks the whole site or its trust signal. Every other
// column (aliases, application_system, admission, ...) is optional, so a Sheet
// that lacks one still loads. application_deadline is here because a renamed
// header would turn every deadline into "Not published" while the saved copy
// has them.
const REQUIRED_UNIVERSITY_COLUMNS = ['university_id', 'name', 'country', 'verified_by'];
const REQUIRED_PROGRAMME_COLUMNS = [
  'programme_id', 'university_id', t('programme'), 'application_deadline', 'official_url', 'verified_by',
];

function requireColumns(parsed, label, required) {
  const missing = required.filter((c) => !parsed.header.includes(c));
  if (missing.length === 0) return;
  if (parsed.header.length === 0) throw new Error(t('the_file_is_empty', { value1: label }));
  throw new Error(
    t('the_file_has_no', { value1: label, value2: missing.map((c) => `"${c}"`).join(', '), value3: missing.length === 1 ? t('column') : t('columns') }) +
    t('renamed_deleted_or_not_a_csv_at_all')
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
    if (!res.ok) throw new Error(t('returned_http', { value1: url, value2: res.status }));
    return await read(res);
  } catch (err) {
    if (signal.aborted) throw new Error(t('did_not_answer_within_s', { value1: url, value2: timeoutMs / 1000 }));
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
      issues.push(t('universities_row_no_university_id_row_skipped', { value1: row.__row }));
      continue;
    }
    if (universities.has(id)) {
      issues.push(t('universities_row_university_id_is_used_twice_second_row_skipped', { value1: row.__row, value2: id }));
      continue;
    }
    universities.set(id, {
      id,
      name: text(row.name),
      city: text(row.city),
      country: text(row.country),
      applicationSystem: text(row.application_system),
      ...livingCost(row, issues),
      tuitionEuDefault: number(row.tuition_eu_default, issues, t('universities_row_tuition_eu_default', { value1: row.__row }), NOT_NEGATIVE),
      tuitionNonEuDefault: number(row.tuition_noneu_default, issues, t('universities_row_tuition_noneu_default', { value1: row.__row }), NOT_NEGATIVE),
      englishRequirementDefault: text(row.english_requirement_default),
      // How places are decided, when it is the same across the university —
      // every Irish course goes through CAO points. Czech and Dutch rows vary
      // by programme, so they leave this blank and say it per row.
      admissionDefault: text(row.admission_default),
      // What a diploma has to clear before any programme-specific requirement.
      // It differs by country, so it cannot be a sentence baked into the
      // renderer — the Netherlands says VWO, nowhere else does.
      baselineRequirement: text(row.baseline_requirement),
      studentLifeUrl: url(row.student_life_url, issues, t('universities_row_student_life_url', { value1: row.__row })),
      lastVerified: date(row.last_verified, issues, t('universities_row_last_verified', { value1: row.__row })),
      verifiedBy: signer(row.verified_by, issues, t('universities_row', { value1: row.__row })),
      // Short and native names people search for ("UvA", "ČVUT", "Univerzita
      // Karlova"), only ever read into the search text. A Sheet or snapshot
      // without the column gives none, which is fine (S01).
      aliases: list(row.aliases, BULLET),
    });
  }

  const programmes = [];
  const seen = new Set();

  for (const row of programmeRows) {
    const where = t('programmes_row', { value1: row.__row });
    const id = text(row.programme_id);

    if (!id) {
      issues.push(t('no_programme_id_row_skipped', { value1: where }));
      continue;
    }
    if (seen.has(id)) {
      issues.push(t('programme_id_is_used_twice_second_row_skipped', { value1: where, value2: id }));
      continue;
    }
    const uni = universities.get(text(row.university_id));
    if (!uni) {
      issues.push(t('university_id_is_not_on_the_universities_tab_row_skipped', { value1: where, value2: text(row.university_id) }));
      continue;
    }
    seen.add(id);

    const tuitionEu = inheritNumber(row.tuition_eu, uni.tuitionEuDefault, issues, t('tuition_eu', { value1: where }));
    const tuitionNonEu = inheritNumber(row.tuition_noneu, uni.tuitionNonEuDefault, issues, t('tuition_noneu', { value1: where }));

    // The programme row's own date and signer: signing a programme covers
    // everything its card shows, including what it takes from the university
    // row (T01, Q14 = A, 2026-10-26). The university's AI-DRAFT and its date
    // used to be joined in, so a signed programme never showed as checked.
    const lastVerified = date(row.last_verified, issues, t('last_verified', { value1: where }));
    const deadline = date(row.application_deadline, issues, t('application_deadline', { value1: where }));

    const verifiedBy = signer(row.verified_by, issues, where);
    // The card's "Checked" line needs the date as well as the initials. Since
    // the university's date no longer fills in, a signed row without its own
    // date counted as checked but showed nothing, with no hint why.
    if (verifiedBy && !verifiedBy.includes('AI-DRAFT') && !verifiedBy.includes('SAMPLE') && !lastVerified) {
      issues.push(t('signed_but_last_verified_is_blank_no_checked_line_is_shown_add_the_d', { value1: where, value2: verifiedBy }));
    }

    const city = inheritText(row.city, uni.city);
    const subjects = text(row.ib_subjects);
    const deadlineNotes = text(row.deadline_notes);
    const otherRequirements = list(row.other_requirements, BULLET);
    // D27: a "#" course listed in TEST_IN_CUTOFF or TEST_UNVERIFIED (js/points.js)
    // has no IB figure. A figure written before that rule (a CSV not yet
    // refreshed by update-cao-points.mjs) is ignored, so the card and the
    // filters never use it. UCD's figure is its own minimum, so UCD is exempt.
    const testScore = uni.country === 'Ireland' && uni.id !== UCD_ID
      ? testScoring(parseCaoSentence(deadlineNotes)?.code, otherRequirements.includes(CAO_TEST)) : null;
    const ibPointsMin = testScore ? null : number(row.ib_points_min, issues, t('ib_points_min', { value1: where }), IB_POINTS);
    const rankedWithHpat = ibPointsMin !== null && deadlineNotes.includes(HPAT_NOTE);
    const cao = cutoffSentence(uni, ibPointsMin, rankedWithHpat, deadlineNotes, otherRequirements);
    const subjectAreas = subjectAreasOf(row.subject_area, issues, where);

    programmes.push({
      id,
      programme: text(row.programme),
      degreeType: text(row.degree_type),
      subjectAreas,
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
      livingCostMin: uni.livingCostMin,
      livingCostMax: uni.livingCostMax,
      livingCostSource: uni.livingCostSource,
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
      pointsPlusTest: ibPointsMin === null && (deadlineNotes.includes(PLUS_TEST) || testScore === 'included'),
      // D27: a "#" course where no page confirms whether the assessment's
      // marks are in the cutoff, so no IB figure is shown.
      pointsTestUnverified: testScore === 'unverified',
      // What kind of figure ib_points_min is, so the card can say it (P01, Q2
      // interim, 2026-10-26). "cutoff": an Irish course's IB equivalent of last
      // year's CAO cutoff, which moves with demand every year. "minimum": what
      // the university publishes as its floor, including UCD's stated IB
      // minimum and the CAO's 480-point HPAT Medicine minimum. null: no figure.
      // Derived from the university and the CAO sentence because there is no
      // column for it yet; plans/backlog/points-value-kind.md replaces this
      // with a field the importers write.
      pointsKind: ibPointsMin === null ? null : (cao ? 'cutoff' : t('minimum')),
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
      // Jakub's columns (upstream, 2026-10-26/27): which IB maths courses the
      // programme accepts, and whether every applicant sits an entrance exam.
      // null means nobody has checked, and a filter never hides it.
      mathsAccepted: mathsCourses(row.ib_maths, issues, t('ib_maths', { value1: where })),
      entranceExam: examState(row.entrance_exam, issues, t('entrance_exam_4', { value1: where })),
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
      officialUrl: officialUrl(row.official_url, issues, t('official_url', { value1: where })),
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
          uni.country, ...list(row.subject_area),
          // "Unclassified" is a site label, not something a student searches for.
          ...subjectAreas.filter((a) => a !== UNCLASSIFIED)].join(' ')
      ).toLowerCase(),
    });
  }

  addProgrammeIdentity(programmes);
  applyToday(programmes, today);

  if (programmes.length === 0 && programmeRows.length > 0) {
    throw new Error(t('every_programme_row_failed_to_load'));
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
    // "None required" is shown on the card, so it is a known difference.
    row.noSubjectsRequired ? 'none' : row.ibSubjects, row.otherRequirements.filter(known).join(' · '),
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
  if (value === '') issues.push(t('verified_by_is_blank_shown_as_not_checked_use_ai_draft_until_you_per', { value1: where }));
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

// The four IB maths courses. ib_maths lists the ones a programme accepts, so
// the maths filter can answer "can I apply with what I take?" — a yes/no on HL
// alone could not, because some programmes take AA SL but not AI HL.
export const MATHS_COURSES = ['AA HL', 'AA SL', 'AI HL', 'AI SL'];

// Same three states as ib_subjects, plus "?":
//   "none"  -> no maths requirement, so every course qualifies
//   blank or "?" -> not known; returns null and the filter never hides the row
//   list    -> the courses accepted, e.g. "AA HL · AA SL · AI HL"
function mathsCourses(value, issues, label) {
  const raw = text(value);
  if (!raw || raw === UNKNOWN) return null;
  if (raw === NO_REQUIREMENT) return [...MATHS_COURSES];
  const courses = list(raw, BULLET);
  const bad = courses.filter((c) => !MATHS_COURSES.includes(c));
  if (bad.length) {
    issues.push(t('is_not_one_of_treated_as_unknown', { value1: label, value2: bad.join('", "'), value3: MATHS_COURSES.join(', ') }));
    return null;
  }
  return courses;
}

// Whether you have to sit an entrance exam, test or audition:
//   "yes"       every applicant sits one
//   "waivable"  there is one, but some IB applicants can skip it
//   "no"        none: grades, documents, interviews, matching or a lottery
//   blank or "?" -> not known; returns null and the filter never hides the row
export const EXAM_STATES = ['yes', 'waivable', 'no'];

function examState(value, issues, label) {
  const raw = text(value);
  if (!raw || raw === UNKNOWN) return null;
  if (!EXAM_STATES.includes(raw)) {
    issues.push(t('is_not_one_of_treated_as_unknown', { value1: label, value2: raw, value3: EXAM_STATES.join(', ') }));
    return null;
  }
  return raw;
}

// Living costs are a monthly range, because that is how universities publish
// them ("€900–1,200"), plus a few words saying whose estimate it is. A single
// figure is min with a blank max. The old one-number column is still read, so
// a Sheet that has not been updated keeps working.
function livingCost(row, issues) {
  const where = t('universities_row', { value1: row.__row });
  let min = number(row.living_cost_min, issues, t('living_cost_min', { value1: where }), NOT_NEGATIVE);
  let max = number(row.living_cost_max, issues, t('living_cost_max', { value1: where }), NOT_NEGATIVE);
  if (min === null && max === null) {
    min = number(row.living_cost_monthly, issues, t('living_cost_monthly', { value1: where }), NOT_NEGATIVE);
  }
  if (min === null && max !== null) min = max;
  if (max === null) max = min;
  if (min !== null && max < min) {
    issues.push(t('living_cost_max_is_below_living_cost_min_swapped', { value1: where, value2: max, value3: min }));
    [min, max] = [max, min];
  }
  return { livingCostMin: min, livingCostMax: max, livingCostSource: text(row.living_cost_source) };
}

// Ranges for number(). Every money column is a fee or a cost, so never below
// 0; IB points are a whole number on the 24-45 diploma scale. A value outside
// its range is reported and treated as not published, never clamped (L04).
const NOT_NEGATIVE = { min: 0, get says() { return t('below_0'); } };
const IB_POINTS = { min: 24, max: 45, whole: true, get says() { return t('not_a_whole_number_of_ib_points_from_24_to_45'); } };

function number(value, issues, label, range = {}) {
  const raw = text(value);
  if (raw === '') return null;
  const cleaned = raw.replace(/[€$\s ]/g, '');
  // A comma is accepted only as a thousands separator ("12,500"). Stripping
  // every comma read a decimal comma, "2771,00", as 277100.
  if (cleaned.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    issues.push(t('is_not_a_number_use_a_dot_for_decimals_or_no_separator_treated_as_no', { value1: label, value2: raw }));
    return null;
  }
  const n = Number(cleaned.replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    issues.push(t('is_not_a_number_treated_as_not_published', { value1: label, value2: raw }));
    return null;
  }
  if ((range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max)
      || (range.whole && !Number.isInteger(n))) {
    issues.push(t('is_treated_as_not_published', { value1: label, value2: raw, value3: range.says }));
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
    issues.push(t('is_not_a_usable_link_use_an_http_or_https_url_without_a_username_or', { value1: label, value2: raw }));
  }
  return clean;
}

// official_url is the one link the site promises on every card. A blank one
// used to pass quietly; the card says "No official admissions link", and now the
// problems list says which row needs it (T04).
function officialUrl(value, issues, label) {
  if (text(value) === '') {
    issues.push(t('is_blank_no_official_admissions_link_is_shown_add_the_programme_s_of', { value1: label }));
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
        t('is_not_yyyy_mm_dd_read_as_day_month_year', { value1: label, value2: raw }) +
        t('set_that_column_to_plain_text_in_the_sheet_and_re_enter_the_date')
      );
      return d;
    }
  }

  issues.push(t('is_not_a_date_we_can_read_treated_as_missing', { value1: label, value2: raw }));
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
