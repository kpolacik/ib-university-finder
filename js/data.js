// Loads the two sheets, joins them, and normalises everything into the one
// shape the rest of the site uses. Nothing downstream should ever see a raw
// spreadsheet string.

import { csvToObjects } from './csv.js';
import {
  SHEET_CSV_URLS, SAMPLE_CSV_URLS, SNAPSHOT_URL,
  STALE_AFTER_DAYS, URGENT_WITHIN_DAYS,
} from './config.js';

const DAY = 24 * 60 * 60 * 1000;

export async function loadData(today = new Date()) {
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
        fetchText(source.urls.universities),
        fetchText(source.urls.programmes),
      ]);
      const uni = csvToObjects(uniText, 'Universities');
      const prog = csvToObjects(progText, 'Programmes');
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
  const snapshot = await (await fetch(SNAPSHOT_URL)).json();
  const built = build(
    withRowNumbers(snapshot.universities),
    withRowNumbers(snapshot.programmes),
    today,
  );
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
      issues: [...built.issues, ...failures.map((f) => `Live data unavailable: ${f}`)],
    },
  };
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
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
      ...livingCost(row, issues),
      tuitionEuDefault: number(row.tuition_eu_default, issues, `Universities row ${row.__row}, tuition_eu_default`),
      tuitionNonEuDefault: number(row.tuition_noneu_default, issues, `Universities row ${row.__row}, tuition_noneu_default`),
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
      verifiedBy: text(row.verified_by),
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

    const lastVerified = older(uni.lastVerified, date(row.last_verified, issues, `${where}, last_verified`));
    const deadline = date(row.application_deadline, issues, `${where}, application_deadline`);

    // Usually the same person checked both rows; only name them twice if not.
    const verifiedBy = [...new Set([uni.verifiedBy, text(row.verified_by)].filter(Boolean))].join(' / ');

    // Whole days from today. Negative means the date has gone.
    const daysUntilDeadline = deadline
      ? Math.round((deadline.getTime() - startOfDay(today)) / DAY)
      : null;

    const city = inheritText(row.city, uni.city);
    const subjects = text(row.ib_subjects);

    programmes.push({
      id,
      programme: text(row.programme),
      degreeType: text(row.degree_type),
      subjectAreas: list(row.subject_area),
      languages: list(row.language),

      university: uni.name,
      // Satellite campuses: University College Roosevelt is in Middelburg, not
      // Utrecht. Blank means "the university's home city".
      city,
      country: uni.country,
      applicationSystem: uni.applicationSystem,
      livingCostMin: uni.livingCostMin,
      livingCostMax: uni.livingCostMax,
      livingCostSource: uni.livingCostSource,
      baselineRequirement: uni.baselineRequirement,

      tuitionEu,
      tuitionNonEu,
      ibPointsMin: number(row.ib_points_min, issues, `${where}, ib_points_min`),

      // Three requirement kinds, kept apart so a card can show only what
      // applies. ib_subjects has its own three states:
      //   "none"  -> the university states there are no subject requirements
      //   blank   -> nobody has checked yet (NOT the same thing)
      //   text    -> the requirements
      // Blank defaulting to "not checked" is deliberate: a cell someone forgot
      // to fill in must never read as "there is nothing to meet".
      ibSubjects: subjects === NO_REQUIREMENT ? '' : subjects,
      noSubjectsRequired: subjects === NO_REQUIREMENT,
      mathsAccepted: mathsCourses(row.ib_maths, issues, `${where}, ib_maths`),
      entranceExam: examState(row.entrance_exam, issues, `${where}, entrance_exam`),
      otherRequirements: list(row.other_requirements, BULLET),

      // How the place is actually decided: open entry, a ranking, an entrance
      // exam. Same inherit / "?" rules as english_requirement, same bullet.
      admission: list(inheritText(row.admission, uni.admissionDefault), BULLET),

      // Split on the same bullet as other_requirements — the docs teach one
      // separator, so every column that uses it must honour it.
      englishRequirement: list(inheritText(row.english_requirement, uni.englishRequirementDefault), BULLET),

      deadline,
      deadlineNotes: text(row.deadline_notes),
      officialUrl: url(row.official_url, issues, `${where}, official_url`),
      studentLifeUrl: uni.studentLifeUrl,

      lastVerified,
      verifiedBy,

      daysUntilDeadline,
      deadlinePassed: daysUntilDeadline !== null && daysUntilDeadline < 0,
      isUrgent: daysUntilDeadline !== null &&
                daysUntilDeadline >= 0 &&
                daysUntilDeadline <= URGENT_WITHIN_DAYS,
      isStale: lastVerified ? (today - lastVerified) / DAY > STALE_AFTER_DAYS : true,

      // verified_by is the site's promise that a person read the official page.
      // Rows gathered automatically say AI-DRAFT until someone signs them off,
      // and invented rows say SAMPLE. Neither may pass as checked.
      isSample: verifiedBy.includes('SAMPLE'),
      needsHumanCheck: verifiedBy.includes('AI-DRAFT'),

      searchBlob: foldAccents(
        [text(row.programme), uni.name, city, uni.country].join(' ')
      ).toLowerCase(),
    });
  }

  if (programmes.length === 0 && programmeRows.length > 0) {
    throw new Error('every programme row failed to load');
  }

  // "some", not "every": one invented row mixed into real data must still raise
  // the alarm, otherwise the real rows lend it credibility.
  const sampleCount = programmes.filter((p) => p.isSample).length;
  const draftCount = programmes.filter((p) => p.needsHumanCheck).length;

  return { programmes, issues, sampleCount, draftCount };
}

// ---------------------------------------------------------------- helpers

function text(value) {
  return value == null ? '' : String(value).trim();
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
    issues.push(`${label}: "${bad.join('", "')}" is not one of ${MATHS_COURSES.join(', ')} — treated as unknown.`);
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
    issues.push(`${label}: "${raw}" is not one of ${EXAM_STATES.join(', ')} — treated as unknown.`);
    return null;
  }
  return raw;
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

function inheritNumber(raw, fallback, issues, label) {
  const value = text(raw);
  if (value === UNKNOWN) return null;
  if (value === '') return fallback;
  return number(value, issues, label);
}

function inheritText(raw, fallback) {
  const value = text(raw);
  if (value === UNKNOWN) return '';
  return value || fallback;
}

function list(value, separator = ';') {
  return text(value).split(separator).map((s) => s.trim()).filter(Boolean);
}

// Living costs are a monthly range, because that is how universities publish
// them ("€900–1,200"), plus a few words saying whose estimate it is. A single
// figure is min with a blank max. The old one-number column is still read, so
// a Sheet that has not been updated keeps working.
function livingCost(row, issues) {
  const where = `Universities row ${row.__row}`;
  let min = number(row.living_cost_min, issues, `${where}, living_cost_min`);
  let max = number(row.living_cost_max, issues, `${where}, living_cost_max`);
  if (min === null && max === null) {
    min = number(row.living_cost_monthly, issues, `${where}, living_cost_monthly`);
  }
  if (min === null && max !== null) min = max;
  if (max === null) max = min;
  if (min !== null && max < min) {
    issues.push(`${where}: living_cost_max (${max}) is below living_cost_min (${min}) — swapped.`);
    [min, max] = [max, min];
  }
  return { livingCostMin: min, livingCostMax: max, livingCostSource: text(row.living_cost_source) };
}

function number(value, issues, label) {
  const raw = text(value);
  if (raw === '') return null;
  const cleaned = raw.replace(/[€$\s ]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    issues.push(`${label}: "${raw}" is not a number — treated as not published.`);
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

function older(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function startOfDay(today) {
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
}

// So that searching "Munchen" finds "München" and "Kosice" finds "Košice".
function foldAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export { foldAccents };
