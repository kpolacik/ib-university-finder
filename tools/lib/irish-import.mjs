// The shape every Irish importer after Trinity shares.
//
// UCC, Galway, DCU, UL and Maynooth all publish the same thing: a list of
// course pages, each carrying a CAO code. None of them publishes an IB entry
// requirement per course, so the points figure has to come from the CAO's own
// table and be converted — which is what makes them different from UCD, whose
// importer stands alone because UCD states an IB minimum outright.
//
// Each university differs only in how to find the links and where the CAO code
// sits on the page. Those two things are the config; everything else is here.

import { writeFileSync } from 'node:fs';
import {
  getHtml, toText, lowestIB, aboveIB, areasFor, otherFor, toRow, idMaker, SKIP_TITLE, HPAT_CODES, HPAT,
} from './ireland.mjs';
import { fetchCaoPoints, caoNote } from './cao-points.mjs';

/**
 * @param {object} cfg
 * @param {string} cfg.universityId   universities.csv key, e.g. 'ucc'
 * @param {string} cfg.base           origin for relative links
 * @param {string} cfg.listUrl        page listing every undergraduate course
 * @param {RegExp} cfg.linkRe         /g regex over list HTML -> [, href, title]
 * @param {(page: string, href: string) => string|null} cfg.caoCode
 *        pulls the CAO code from a course page's text (or from its URL)
 * @param {(title: string) => boolean} [cfg.skip]  extra per-university filter
 * @param {(page: string) => {eu?: number, noneu?: number}} [cfg.fees]
 *        per-course fees, only where the university publishes an unambiguous
 *        figure on the course page. Every Irish fee in this dataset is what a
 *        Free Fees student pays — student contribution plus that university's
 *        levy — because the State pays the tuition of EU/EEA applicants
 *        resident and educated in the EU/EEA for three of the previous five
 *        years, which this cohort is. Pages that print a larger "EU fee" are
 *        quoting the rate for EU applicants who do not qualify; do not take it.
 * @param {() => Promise<Map<string, {eu?: number, noneu?: number}>>} [cfg.feesByCode]
 *        the same thing for universities that publish one fee schedule for
 *        every course, keyed by CAO code, instead of putting it on each page.
 * @param {string} cfg.out            file to write, relative to tools/
 */
export async function importUniversity(cfg) {
  const cao = await fetchCaoPoints();
  const feeTable = cfg.feesByCode ? await cfg.feesByCode() : null;
  if (feeTable) console.log(`${cfg.universityId}: ${feeTable.size} courses in the published fee schedule`);
  const listHtml = await getHtml(cfg.listUrl);

  const links = [...listHtml.matchAll(cfg.linkRe)]
    .map((m) => ({
      // new URL resolves any "/../" in the href itself — Galway's index writes
      // every link relative to a sibling directory.
      href: new URL(m[1], cfg.base).href,
      title: m[2].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
    }))
    .filter((v, i, a) => a.findIndex((z) => z.href === v.href) === i)
    .filter((x) => x.title.length > 3 && !SKIP_TITLE.test(x.title))
    .filter((x) => (cfg.skip ? !cfg.skip(x.title) : true));

  console.log(`${cfg.universityId}: ${links.length} course pages to fetch`);

  const nextId = idMaker(cfg.universityId);
  const rows = [];
  const skipped = { noCode: 0, notInCao: 0, aboveReach: 0 };
  let withFees = 0;

  for (const link of links) {
    let text;
    try {
      text = toText(await getHtml(link.href));
    } catch {
      skipped.noCode++;
      continue;
    }

    const code = cfg.caoCode(text, link.href);
    // No CAO code means it is not a CAO-entry honours degree — a part-time
    // route, a postgraduate page, or a subject rather than a course.
    if (!code) { skipped.noCode++; continue; }

    const entry = cao.get(code);
    if (!entry) { skipped.notInCao++; continue; }

    // The university's own link text, not the CAO's title, which is truncated
    // to fit a fixed-width column ("Arts - Music - 3 years or 4 years  (BMus
    // or Chinese/European/Internation").
    const title = link.title.replace(/\s*\([A-Z]{2}\d{3}\)\s*$/, '').trim();
    const fees = (cfg.fees ? cfg.fees(text) : feeTable?.get(code)) ?? {};
    if (fees.eu) withFees++;
    const needsMaths = /engineer|mathemat|physic|comput|actuarial|financ|econom/i.test(title);

    let ib = null;
    const notes = [caoNote(entry)];

    if (entry.latest.aqa) {
      // No cutoff existed, so there is no total to convert. Left blank, which
      // the site shows and labels rather than reading as "no requirement".
      ib = null;
    } else if (entry.latest.points !== null) {
      ib = lowestIB(entry.latest.points);
      if (ib === null && needsMaths) {
        ib = lowestIB(entry.latest.points - 25);
        if (ib !== null) notes.push('Only reachable with the 25 HL Maths bonus points.');
      } else if (ib !== null && needsMaths) {
        notes.push('HL Maths 4+ adds 25 bonus points.');
      }
      if (ib === null) {
        skipped.aboveReach++;
        notes.push(aboveIB(entry.latest.points));
      }
    }

    rows.push({
      code,
      notes,
      fields: {
        programme_id: nextId(title),
        university_id: cfg.universityId,
        programme: title,
        subject_area: areasFor(title),
        language: 'English',
        ib_points_min: ib === null ? '' : String(ib),
        // Blank, never "none": none of these five states an IB subject
        // requirement per course, so nobody has checked rather than there being
        // nothing to meet.
        ib_subjects: '',
        other_requirements: HPAT_CODES.has(code) ? HPAT
          : entry.latest.test ? 'Test, interview, portfolio or audition' : otherFor(title),
        tuition_eu: fees.eu ?? '',
        tuition_noneu: fees.noneu ?? '',
        application_deadline: '2027-02-01',
        official_url: link.href,
        last_verified: '2026-08-16',
        verified_by: 'AI-DRAFT',
      },
    });
  }

  // Irish universities routinely put several named programmes behind one CAO
  // application code — UL's LM116 is "Engineering (Common Entry)", covering
  // Civil, Biomedical and the rest, and UL's LM002 Arts covers every Arts
  // subject. They all share that code's cutoff. Without this note a row would
  // read as though Civil Engineering had a cutoff of its own, which it does
  // not: you apply to the code, not to the programme.
  const perCode = new Map();
  for (const r of rows) perCode.set(r.code, (perCode.get(r.code) ?? 0) + 1);

  let shared = 0;
  for (const r of rows) {
    const n = perCode.get(r.code);
    if (n < 2) continue;
    shared++;
    r.notes.push(
      `Shared CAO code ${r.code} (${cao.get(r.code).title}): the cutoff covers ${n} programmes.`,
    );
  }

  const csv = rows.map((r) => toRow({ ...r.fields, deadline_notes: r.notes.filter(Boolean).join(' ') }));
  writeFileSync(new URL(`../${cfg.out}`, import.meta.url), `${csv.join('\n')}\n`);
  console.log(`  ${shared} rows share a CAO code with another programme and say so`);
  if (cfg.fees || cfg.feesByCode) console.log(`  ${withFees} rows carry a published EU fee`);
  console.log(
    `${cfg.universityId}: wrote ${rows.length} rows to tools/${cfg.out}\n`
    + `  skipped ${skipped.noCode} with no CAO code, ${skipped.notInCao} not in the CAO Level 8 table\n`
    + `  ${skipped.aboveReach} kept with a blank points figure — the cutoff was beyond IB reach`,
  );
  return rows.length;
}
