// One-off import: University College Dublin undergraduate courses -> programmes.csv rows.
//
//   node tools/import-ucd.mjs        writes tools/ucd-rows.csv
//
// UCD is the best-documented of the Irish universities: every course page
// states "General Entry Requirements (IB)" as an IB total the university will
// accept, alongside the CAO cutoff. That stated total is what goes in
// ib_points_min — it is UCD's own number, not a conversion of a cutoff, so it
// is the one Irish figure in this dataset that is a real minimum. The cutoff
// still goes in the notes, because in practice it is what decides the offer.

import { writeFileSync } from 'node:fs';
import {
  getHtml, toText, areasFor, otherFor, toRow, idMaker, SKIP_TITLE, HPAT_CODES, HPAT,
} from './lib/ireland.mjs';
import { fetchCaoPoints, caoNote } from './lib/cao-points.mjs';

const cao = await fetchCaoPoints();

const HUB = 'https://hub.ucd.ie/usis/';

// UCD's course list is drawn by JavaScript from an internal reporting endpoint;
// the plain HTML pages carry no course list at all. This is that endpoint, with
// the query token the course browser itself sends. The token is an encrypted
// description of the query "CB420-1" (all courses, no filters) and is not tied
// to a session, so it can be replayed. If UCD ever rotates it this script stops
// with a loud error rather than writing a short file.
const QUERY = `${HUB}W_HU_REPORTING.P_JSON_QUERY?p_format=ARRAY&p_query=CB420-1&p_parameters=`
  + 'AD170D9F1297E433485DD05346F59764696012E27F8D5B3136AAB99760DA674EDB62027EF3FDFB54D7093A8D24AECC33'
  + 'B486BD023583D29D3C4BD0BF95453A04BB574C490FA60A17341AB9CC21F065F9E9B1339B85D93E8ED715722E90341124'
  + '9958B88D9723E4FCEF37447A345EE5D0324359A7C417FC765D7DAD8AC3CDFBD3C4E2B1620366E56EB598765D1A6B271C'
  + 'ACEEAD6D9FAECE185AF900D4278D94DCA7EB9BA760D7F1C6075394B2B04E5481F75499159CC0F2DAD800DF16440ADF08'
  + '0F857940290D7BCCA1CBC1BCBD71FC5EBEFE211D4D8C2C4283E4186905A6DF527AB2E1507DCC18A0969AC2606CC7C708'
  + '03A88BBC54A6211BBA4AD4F825A7DE2C8A25A22B3348C7F9B64A9794B01F21E670A1BF36E7A577029F825BBE3C83C85C'
  + 'F21DC40227C0B1906EF442B1295B9169';

const catalogue = JSON.parse(await getHtml(QUERY));
if (!Array.isArray(catalogue.data) || catalogue.data.length < 500) {
  throw new Error(`UCD course query returned ${catalogue.data?.length} rows — the endpoint or its token has changed.`);
}

// Columns, from the endpoint's own column_titles: 0 = title cell (HTML),
// 1 = major code, 2 = level, 3 = award.
const courses = catalogue.data
  .filter((r) => r[2] === 'Undergraduate')
  .map((r) => ({
    majr: r[1],
    award: r[3],
    title: (r[0].match(/data-course-title="([^"]+)"/) || [])[1]?.replace(/\s*\([A-Z0-9]{4}\)$/, '').trim() || '',
    cao: (r[0].match(/class="caoCode[^"]*"[^>]*>([A-Z]{2}\d+)</) || [])[1] || '',
  }))
  .filter((c) => c.title && !SKIP_TITLE.test(c.title));

console.log(`undergraduate courses to fetch: ${courses.length}`);

const nextId = idMaker('ucd');
const rows = [];
let noReqs = 0;

for (const c of courses) {
  const txt = toText(await getHtml(`${HUB}!W_HU_MENU.P_PUBLISH?p_tag=COURSE&MAJR=${c.majr}&AUDIENCE=audienceEU`));

  // Courses with no entry-requirements block are the ones UCD does not admit to
  // directly from school — they are skipped rather than guessed at.
  const ib = (txt.match(/General Entry Requirements \(IB\)\s*(\d{2})\b/) || [])[1];
  if (!ib) { noReqs++; continue; }

  const pts = txt.match(/CAO Points (\d{4})\s*(\d{3})\b/);

  // "Subject Requirements (Mathematics) GCSE C / A Level E IB SL 4 / HL 3" —
  // several may be listed, and only the IB half of each is any use here. The
  // page repeats the whole block once for EU and once for non-EU applicants,
  // so the list is deduped before it is joined.
  //
  // No length cap on the body. There was one, of 160 characters, and it did
  // exactly what the 110-character cap did to Trinity: Computer Science states
  // its maths requirement more than 160 characters before the next heading, so
  // the match failed outright and the row was written with no subject
  // requirement at all. Same lesson, second importer — a bounded capture whose
  // failure mode is silence will eventually go silent on real data.
  const subjects = [...new Set([...txt.matchAll(
    /Subject Requirements \(([^)]{2,40})\)([^]*?)(?=Subject Requirements \(|CAO Points|Leaving Cert|Country Specific|Other School|$)/g,
  )]
    .map(([, subject, body]) => {
      const grade = (body.match(/\bIB\s+((?:SL|HL)\s*\d(?:\s*\/\s*(?:SL|HL)\s*\d)?)/) || [])[1];
      return grade ? `${subject.trim()} ${grade.replace(/\s+/g, ' ').trim()}` : null;
    })
    .filter(Boolean))];

  // UCD's stated minimum is the honest ib_points_min. The cutoff is what
  // actually decides the offer, so it goes in the note — taken from the CAO's
  // own table rather than UCD's page, because only the CAO says whether the
  // number was a real cutoff, an every-qualified-applicant year, or a score
  // that still needed a test or a random draw to get past.
  const entry = cao.get(c.cao);
  const notes = [`UCD's stated minimum: ${ib} IB points.`];

  if (entry) {
    notes.push(caoNote(entry));
  } else if (pts) {
    notes.push(`UCD lists a ${pts[2]} point CAO cutoff for ${pts[1]}${c.cao ? ` under code ${c.cao}` : ''}.`);
  }

  rows.push({
    cao: c.cao,
    notes,
    fields: {
      programme_id: nextId(c.title),
      university_id: 'ucd',
      programme: c.title,
      degree_type: c.award || '',
      subject_area: areasFor(c.title),
      language: 'English',
      ib_points_min: ib,
      // Blank, not "none": UCD lists subject requirements only where it has them,
      // and a course with none listed has not been checked against anything else.
      ib_subjects: subjects.join('; '),
      other_requirements: HPAT_CODES.has(c.cao) ? HPAT
        : entry?.latest.test ? 'Test, interview, portfolio or audition' : otherFor(c.title),
      application_deadline: '2027-02-01',
      official_url: `https://hub.ucd.ie/usis/!W_HU_MENU.P_PUBLISH?p_tag=COURSE&MAJR=${c.majr}&AUDIENCE=audienceEU`,
      last_verified: '2026-08-16',
      verified_by: 'AI-DRAFT',
    },
  });
}

// UCD funnels several degrees into one CAO code — DN250 alone covers
// Agricultural Science, Agri-Environmental Sciences and Agricultural Systems
// Technology. Same reasoning as the other five: the cutoff belongs to the code.
const perCode = new Map();
for (const r of rows) if (r.cao) perCode.set(r.cao, (perCode.get(r.cao) ?? 0) + 1);

let shared = 0;
for (const r of rows) {
  if (!r.cao || perCode.get(r.cao) < 2) continue;
  shared++;
  r.notes.push(
    `Shared CAO code ${r.cao}: the cutoff covers ${perCode.get(r.cao)} UCD programmes.`,
  );
}

const csv = rows.map((r) => toRow({ ...r.fields, deadline_notes: r.notes.filter(Boolean).join(' ') }));
writeFileSync(new URL('./ucd-rows.csv', import.meta.url), `${csv.join('\n')}\n`);
console.log(
  `rows written: ${rows.length}, skipped (no published entry requirements): ${noReqs}\n`
  + `  ${shared} rows share a CAO code with another programme and say so`,
);
