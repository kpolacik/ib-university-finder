// One-off: correct the UK rows added by tools/merge-uk-2026-10-29.mjs,
// checked 2026-10-29.
//
//   node tools/fix-uk-2026-10-29.mjs
//
// 1. EU students pay the international fee. The merge put the UK "Home" fee
//    (£9,535–£10,050) in tuition_eu. GOV.UK, "Eligibility rules for home fee
//    status and student finance from the 2022 to 2023 academic year onwards":
//    "From 1 August 2021, EU, other EEA and Swiss nationals and their family
//    members who are not covered by the Withdrawal Agreements are no longer
//    eligible for home fee status"; "Irish citizens are automatically treated
//    as settled in the UK". So tuition_eu now holds the international fee, and
//    the Home fee is kept in the note for Irish citizens and those with
//    settled status.
// 2. Pounds were stored as if they were euros (the site prints every amount
//    as €). Fees and living costs are converted at the ECB reference rate of
//    29 October 2026: GBP 0.83578 to the euro.
// 3. subject_area used free text ("Archaeology / Anthropology"); it is mapped
//    onto the site's list (MAINTENANCE.md, Subject areas) so the filter works.
// 4. other_requirements used ";" between items; the site splits on " · ".
//
// Re-runnable: it reads the pound figures from the notes it writes, so a
// second run does not convert twice.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';

const DATA = new URL('../data/', import.meta.url);
const GBP_PER_EUR = 0.83578;
const eur = (gbp) => String(Math.round(Number(gbp) / GBP_PER_EUR));
const gbp = (n) => `£${Number(n).toLocaleString('en-GB')}`;
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const read = (u) => { const [head, ...rows] = parseCsv(readFileSync(u, 'utf8')); return { head, rows: rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) }; };
const save = (u, head, rows) => writeFileSync(u, [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n') + '\n');

const RULES = [
  [/\bppe\b/, ['Philosophy', 'Politics & International Relations', 'Economics']],
  [/natural sciences/, ['Biology & Life Sciences', 'Chemistry', 'Physics']],
  [/account|financ|actuar|business|management|marketing|commerce|entrepreneur/, ['Business & Management']],
  [/econom/, ['Economics']],
  [/\blaw\b|criminolog|legal/, ['Law']],
  [/polit|international relations|international development|development studies|government|public policy|war studies/, ['Politics & International Relations']],
  [/anthropolog|sociolog|social (science|policy|work)|hsps|human sciences/, ['Sociology & Anthropology']],
  [/psycholog/, ['Psychology']],
  [/philosoph|theolog|religio/, ['Philosophy']],
  [/histor|archaeolog|classic|ancient|asnc|medieval/, ['History']],
  [/english|literature|language|linguistic|chinese|japanese|french|german|spanish|italian|russian|arabic|asian|middle eastern|translation|celtic|scandinavian/, ['Languages & Literature']],
  [/film|television|media|journalism|communication/, ['Media & Communication']],
  [/fine art|art history|history of art|design(?! engineering)|music|drama|theatre|creative/, ['Art & Design']],
  [/architect|urban planning/, ['Architecture']],
  [/educat/, ['Education']],
  [/liberal arts/, ['Liberal Arts']],
  [/comput|informatic|artificial intelligence|\bai\b|software|cyber|data science/, ['Computer Science']],
  [/math|statistic|actuar/, ['Mathematics']],
  [/physic|astro/, ['Physics']],
  [/chemi|biochem/, ['Chemistry']],
  [/bio|zoolog|genetic|neuro|ecolog|marine|food science|plant|molecular|cellular/, ['Biology & Life Sciences']],
  [/medic|dentist|pharma|nursing|health|veterinar|physiotherap|optometr|midwif|nutrition|sport|exercise/, ['Medicine & Health']],
  [/engineer|aeronaut|aerospace|mechanical|electr|robot|materials|automotive/, ['Engineering']],
  [/environment|geograph|earth|geolog|geophys|geoscien|ocean|climate|sustainab|urban planning/, ['Environmental Sciences']],
];
const ALLOWED = new Set(['Engineering', 'Computer Science', 'Mathematics', 'Physics', 'Chemistry', 'Biology & Life Sciences',
  'Environmental Sciences', 'Medicine & Health', 'Psychology', 'Economics', 'Business & Management', 'Law',
  'Politics & International Relations', 'Sociology & Anthropology', 'History', 'Philosophy', 'Languages & Literature',
  'Media & Communication', 'Art & Design', 'Architecture', 'Education', 'Liberal Arts']);
function mapArea(text) {
  if (text.split('; ').every((a) => ALLOWED.has(a))) return text; // already mapped
  const low = text.toLowerCase();
  const out = [];
  for (const [re, cats] of RULES) if (re.test(low)) for (const c of cats) if (!out.includes(c)) out.push(c);
  if (!out.length) throw new Error(`no subject area for "${text}"`);
  return out.join('; ');
}

const FEE_NOTE = /EU students pay the international fee: (£[\d,]+)[^.]*\. Irish citizens and students with UK settled status may pay the Home fee \((£[\d,]+)\)\./;
const feeNote = (intl, home) => `EU students pay the international fee: ${gbp(intl)} a year, shown here in euros at the ECB rate of 29 October 2026. Irish citizens and students with UK settled status may pay the Home fee (${gbp(home)}).`;

const unis = read(new URL('universities.csv', DATA));
const ukIds = new Set(unis.rows.filter((u) => u.country === 'United Kingdom').map((u) => u.university_id));
// Living costs, in pounds a month. The merge stored mixed units: monthly
// totals for some, weekly rent only for others, and Edinburgh's 39- and
// 52-week totals. Monthly totals are kept; Edinburgh's page says "an average
// of £1,546 each month"; Leeds' and Birmingham's weekly totals (rent plus
// living) are turned into months (× 52 / 12); where only rent is published,
// or nothing, the GOV.UK Student visa figure is used ("London: £1,529 per
// month … Outside London: £1,171 per month").
const VISA = (london) => ({ min: london ? 1529 : 1171, max: '', src: 'national estimate (UK student visa)' });
const LIVING = {
  oxford: { min: 1475, max: 2175 }, cambridge: { min: 1255, max: 1850 }, imperial: { min: 1690, max: 2530 },
  lse: { min: 1550, max: '' }, ucl: { min: 1077, max: 1727 }, manchester: { min: 1161, max: 1734 }, bristol: { min: 1401, max: '' },
  edinburgh: { min: 1546, max: '' },
  leeds: { min: Math.round(171 * 52 / 12), max: Math.round(466 * 52 / 12), src: "university's estimate (weekly totals × 52 / 12)" },
  birmingham: { min: Math.round(185 * 52 / 12), max: Math.round(221 * 52 / 12), src: "university's estimate (weekly totals × 52 / 12)" },
  kcl: VISA(true),
  warwick: VISA(false), bath: VISA(false), glasgow: VISA(false), exeter: VISA(false), sheffield: VISA(false),
  southampton: VISA(false), durham: VISA(false), 'st-andrews': VISA(false),
};
for (const u of unis.rows) {
  if (!ukIds.has(u.university_id)) continue;
  const l = LIVING[u.university_id];
  if (!l) throw new Error(`no living-cost rule for ${u.university_id}`);
  const alreadyRun = u.living_cost_source.includes('£');
  u.living_cost_min = eur(l.min);
  u.living_cost_max = l.max === '' ? '' : eur(l.max);
  const range = [l.min, l.max].filter((x) => x !== '').map(gbp).join('–');
  u.living_cost_source = `${l.src ?? "university's estimate"}, ${range} a month`;
  if (!alreadyRun) {
    // Defaults: the international fee applies to EU applicants too.
    if (u.tuition_noneu_default && /^\d+$/.test(u.tuition_noneu_default)) {
      const intl = u.tuition_noneu_default;
      u.tuition_eu_default = eur(intl);
      u.tuition_noneu_default = eur(intl);
    } else u.tuition_eu_default = '';
  }
}
save(new URL('universities.csv', DATA), unis.head, unis.rows);

const progs = read(new URL('programmes.csv', DATA));
let n = 0;
for (const p of progs.rows) {
  if (!ukIds.has(p.university_id)) continue;
  n++;
  const m = p.deadline_notes.match(FEE_NOTE);
  let intl, home;
  if (m) { intl = m[1].replace(/[£,]/g, ''); home = m[2].replace(/[£,]/g, ''); }
  else { intl = p.tuition_noneu; home = p.tuition_eu; }
  if (/^\d+$/.test(intl)) {
    p.tuition_eu = eur(intl);
    p.tuition_noneu = eur(intl);
    if (!m) p.deadline_notes = [p.deadline_notes, feeNote(intl, home)].filter(Boolean).join(' ');
  } else if (!m) {
    p.tuition_eu = '';
    p.tuition_noneu = '';
    if (/^\d+$/.test(home)) p.deadline_notes = [p.deadline_notes, `International fee not published; the Home fee (${gbp(home)}) does not apply to most EU students.`].filter(Boolean).join(' ');
  }
  p.subject_area = mapArea(p.subject_area);
  p.other_requirements = p.other_requirements.split(/\s*;\s*/).filter(Boolean).join(' · ');
}
save(new URL('programmes.csv', DATA), progs.head, progs.rows);
console.log(`UK: ${ukIds.size} universities, ${n} programmes corrected`);
