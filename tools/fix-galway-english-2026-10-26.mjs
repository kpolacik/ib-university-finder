// One-off: Galway's English requirement for IB students, checked 2026-10-26.
//
//   node tools/fix-galway-english-2026-10-26.mjs
//
// The card said "Galway publishes no IB-specific English grades". Galway does
// not print them itself, but sends EU applicants to the CAO guide that does —
// the same route used for DCU's line on 2026-10-26:
//
//   universityofgalway.ie/undergrad-admissions/faqs: "How do I find out which
//   European qualifications are recognized for purposes of entry to University
//   of Galway? For information please refer to Agreed Entry Requirements
//   Criteria for EU/EFTA Applicants."
//   CAO "Agreed Entry Requirements for EU/EFTA/UK" (Nov 2025), International
//   Baccalaureate: "English Language A: 3 at Higher level or 4 at Standard
//   level; English Language B or Ab initio: 4 at Higher Level or 6 at standard
//   (4 @ either Level if presenting IB through English)".
//   Galway's own wording, kept for the test route: "must have advanced level
//   English in Final School Exam or must present one of the recognised English
//   Language qualifications (e.g. IELTS ...)".
//
// Re-runnable: writes english_requirement_default and last_verified for galway.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const url = new URL('../data/universities.csv', import.meta.url);
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const [head, ...rows] = parseCsv(readFileSync(url, 'utf8'));
const [iId, iEng, iVer] = ['university_id', 'english_requirement_default', 'last_verified'].map((c) => head.indexOf(c));
const row = rows.find((r) => r[iId] === 'galway');
row[iEng] = 'IB English A 3 HL or 4 SL · English B or Ab Initio 4 HL or 6 SL · just 4 at either level if you sat the IB through English · or a recognised test such as IELTS';
row[iVer] = '2026-10-26';
writeFileSync(url, [head, ...rows].map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log('galway english_requirement_default updated');
