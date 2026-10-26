// One-off import: Trinity College Dublin undergraduate courses -> programmes.csv rows.
//
//   node tools/import-tcd.mjs        writes tools/tcd-rows.csv
//
// Trinity is the only Irish university besides UCD that states a subject
// requirement per course, under an "International Baccalaureate:" heading in
// its Admission Requirements block. That block is the reason this importer
// exists in its own file.
//
// This file was rewritten on 2026-08-16 to fix a bug and to move its points on
// to the same source as the other six. Both are worth knowing about:
//
//   * The original capped the captured requirement at 110 characters. Trinity's
//     real requirements are routinely longer ("SL Grade 5 Mathematics HL Grade 5
//     in two of Physics, Chemistry, Biology, ..."), so the match failed
//     outright and the code fell through to writing `none` — telling a student
//     there was no subject requirement where Trinity demands several. 39 of the
//     79 rows were wrong. There is now no cap, and a failure to find the block
//     writes blank ("not checked"), never `none`.
//
//   * Points came from the cutoff printed on Trinity's own page. They now come
//     from the CAO table, which alone says whether a cutoff was a real cutoff,
//     an every-qualified-applicant year, or a score that still needed a test or
//     a random draw. See tools/lib/cao-points.mjs.
//
// Hand corrections to re-apply after any rerun (this writes tools/tcd-rows.csv,
// never data/, so merge by hand):
//
//   * tcd-columbia-dual-degree (2026-10-25): admission, application_system and
//     tuition_eu "?" were set by hand. It is a joint Trinity–Columbia
//     application with its own deadline, not a plain CAO course, and years 3–4
//     are spent at Columbia, so Trinity's standard fee can't be shown as the
//     fee. This importer would write it back as a plain CAO row.

import { writeFileSync } from 'node:fs';
import { getHtml, toText, convertCutoff, areasFor, otherFor, toRow, HPAT_CODES, HPAT } from './lib/ireland.mjs';
import { fetchCaoPoints, caoNote, hasCaoTest } from './lib/cao-points.mjs';

const BASE = 'https://www.tcd.ie';
const cao = await fetchCaoPoints();
const list = await getHtml(`${BASE}/courses/undergraduate/a-z-of-ug-courses/`);

const links = [...list.matchAll(/href="(\/courses\/undergraduate\/courses\/[a-z0-9-]+\/?)"[^>]*>([^<]{4,90})</g)]
  .map((m) => ({ h: m[1], t: m[2].replace(/\s+/g, ' ').trim() }))
  .filter((v, i, a) => a.findIndex((z) => z.h === v.h) === i)
  // (JH) courses are joint-honours halves, not standalone degrees.
  .filter((x) => !/\(JH\)/i.test(x.t))
  // Irish-language, vocational and clinical-support routes a Slovak IB student
  // realistically cannot or would not apply to.
  .filter((x) => !/irish|gaeilge|acting|deaf studies|dental (nursing|hygiene|technology)|diploma in/i.test(x.t))
  // Graduate entry needs a first degree. Trinity's list doesn't go through
  // SKIP_TITLE, so the same words are kept out here.
  .filter((x) => !/graduate[- ]entry/i.test(x.t));

console.log(`courses to fetch: ${links.length}`);

// Ids are built the way the original built them, and must stay that way: a
// shortlist saved in a browser stores these strings.
const seen = new Set();
const idFor = (href) => {
  const stem = `tcd-${href.replace('/courses/undergraduate/courses/', '').replace(/\/$/, '').slice(0, 30)}`;
  let id = stem;
  for (let n = 2; seen.has(id); n++) id = `${stem}-${n}`;
  seen.add(id);
  return id;
};

const rows = [];
const counts = { subjects: 0, inherited: 0, none: 0, unchecked: 0, noCutoff: 0 };

// The requirement runs from the IB heading to whatever section comes next. No
// length cap: capping it is what broke this before.
const ibFrom = (txt) => {
  const m = txt.match(
    /International Baccalaureate:?\s*([^]*?)(?=English Language Requirements|Course Fees|Apply To apply|Advanced Entry|$)/i,
  );
  return m && m[1].trim() ? m[1].trim().replace(/\s+/g, ' ') : null;
};

for (const c of links) {
  const html = await getHtml(BASE + c.h);
  const txt = toText(html);
  const code = (txt.match(/CAO Code\s*([A-Z]{2}\d{3})/i) || [])[1] || '';

  let subjects = ibFrom(txt);
  const extra = [];

  if (subjects) {
    counts.subjects++;
  } else if (/view the main/i.test(txt)) {
    // Streams of a larger course ("Chemistry: Chemical Sciences") do not repeat
    // the requirement; they link to the parent course that carries it. Follow
    // that link once — the requirement is genuinely the same one.
    const parent = (html.match(/id="admissions-requirements"[^]*?view the main\s*<a href="([^"]+)"/i) || [])[1];
    const parentTitle = (html.match(/id="admissions-requirements"[^]*?view the main\s*<a href="[^"]+"[^>]*>([^<]+)</i) || [])[1];
    subjects = parent ? ibFrom(toText(await getHtml(parent))) : null;
    if (subjects) {
      counts.inherited++;
      extra.push(`Entry requirements are those of the parent course, ${(parentTitle || '').trim()}.`);
    } else {
      counts.unchecked++;
      subjects = '';
    }
  } else if (/Admission Requirements\s*English Language Requirements/i.test(txt)) {
    // Trinity ran the two headings together, which is how it says a course has
    // no subject requirement beyond the baseline diploma. That is a real
    // "none", not a missing value.
    subjects = 'none';
    counts.none++;
  } else {
    // An admissions block written as prose rather than as a qualifications
    // table — a dual degree, or a restricted-entry course with a questionnaire
    // or an interview. There is no IB line to read, so the field stays blank
    // ("not checked") and the reader is pointed at the page.
    subjects = '';
    counts.unchecked++;
    extra.push('Trinity describes entry to this course in prose rather than as a subject list — read the official page.');
  }

  const entry = cao.get(code);
  const notes = [];
  let ib = null;

  if (entry) {
    notes.push(caoNote(entry));
  } else {
    counts.noCutoff++;
    notes.push(`No CAO cutoff is published for this course${code ? ` (code ${code})` : ''}.`);
  }
  // One conversion for all three Irish writers (lib/ireland.mjs), called on
  // every branch: with no cutoff (AQA, none published, no CAO entry) points is
  // null and the figure stays blank, except on HPAT Medicine, which gets the
  // CAO's minimum whatever the cutoff.
  const conv = convertCutoff(entry ? entry.latest.points : null, {
    test: hasCaoTest(entry) || HPAT_CODES.has(code), hpat: HPAT_CODES.has(code),
  });
  ib = conv.ib;
  notes.push(...conv.notes);

  rows.push(toRow({
    programme_id: idFor(c.h),
    university_id: 'tcd',
    programme: c.t,
    subject_area: areasFor(c.t),
    language: 'English',
    ib_points_min: ib === null ? '' : String(ib),
    ib_subjects: subjects,
    other_requirements: HPAT_CODES.has(code) ? HPAT
      : hasCaoTest(entry) ? 'Test, interview, portfolio or audition' : otherFor(c.t),
    application_deadline: '2027-02-01',
    deadline_notes: [...notes, ...extra].filter(Boolean).join(' '),
    official_url: BASE + c.h,
    last_verified: '2026-08-16',
    verified_by: 'AI-DRAFT',
  }));
}

writeFileSync(new URL('./tcd-rows.csv', import.meta.url), `${rows.join('\n')}\n`);
console.log(
  `rows written: ${rows.length}\n`
  + `  ${counts.subjects} with a stated IB subject requirement\n`
  + `  ${counts.inherited} inherited from a parent course page\n`
  + `  ${counts.none} where Trinity states none\n`
  + `  ${counts.unchecked} left blank — entry described in prose, not as subjects\n`
  + `  ${counts.noCutoff} with no CAO cutoff published`,
);
