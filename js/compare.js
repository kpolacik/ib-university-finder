// What the detail says about a fact, in words, and the compare table built
// from the same words. Pure, no DOM, so tools/check.mjs can test every cell.
//
// The compare table (2 to 4 saved programmes side by side) must never say a
// fact differently from the detail, or a student comparing two rows would
// read two versions of the same programme. So the few sentences both need
// live here and js/render.js imports them: the entrance-exam line, the
// countdown, the money format and the yearly estimate.
//
// A cell is a list of lines. A line is { text } for a plain fact, or
// { tag, text } where the tag is the dashed "Not published" / "Not checked
// yet" box and text (optional) follows it. A cell with an unknown in it says
// so (unknown: true); "Show only differences" never hides a row with an
// unknown cell, because two unknowns are not known to be the same.

import { pointsLines, pointsLineText } from './points.js';
import { pointsBucket } from './filters.js';
import { yearlyCost, FLOOR_LABEL, UNKNOWN_REASON, poundNote } from './cost.js';

export const money = new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});

// The top of a range: "€900–1,200", not "€900–€1,200".
const plain = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 });

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

// "€900–1,200", or "€900" when both ends are the same.
export function moneyRange(low, high) {
  return high > low ? `${money.format(low)}–${plain.format(high)}` : money.format(low);
}

// The Requirements block's Entrance exam row; a missing state is "Not checked yet".
export const EXAM_TEXT = {
  yes: 'Entrance exam or test',
  waivable: 'Entrance exam — some IB applicants can skip it',
  no: 'No entrance exam',
};

export function countdown(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

// The yearly estimate with what it rests on: "€12,700–16,300 a year ·
// university's estimate". A national minimum reads "from …"; an unknown total
// says which half is missing. Returns one line (see the top of this file).
export function yearlyLine(row, cost) {
  if (!cost.known) return { tag: 'Not known', text: ` because ${UNKNOWN_REASON[cost.reason]}` };
  const range = cost.floor ? `from ${money.format(cost.low)}` : moneyRange(cost.low, cost.high);
  const source = cost.personal ? `your ${money.format(cost.monthlyMin)}/month` : row.livingCostSource;
  return { text: [`${range} a year`, source, cost.floor && FLOOR_LABEL, poundNote(row)].filter(Boolean).join(' · ') };
}

// ------------------------------------------------------------------ compare

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

// The verdict words the row's points cell uses (render.js, rowPointsCell), so
// a compare column and its row agree. Null when My IB points is empty or the
// figure is above them: the row shows no verdict then either.
function pointsVerdict(row, state) {
  const bucket = pointsBucket(row, state);
  if (bucket === 'within') return { kind: 'fit', text: row.rankedWithHpat ? 'Within your IB points, then HPAT' : 'Within your IB points' };
  if (bucket === 'maths') return { kind: 'cond', text: 'Only with HL Maths 4+' };
  if (bucket === 'unknown' && row.ibPointsMin !== null) return { kind: 'unk', text: 'Cutoff may include test marks' };
  return null;
}

const tag = (text, after) => (after ? { tag: text, text: after } : { tag: text });

const CELLS = [
  ['points', 'IB points', (row, state) => {
    const lines = pointsLines(row).map((line) => (line.number === null ? tag(line.qualifier) : { text: pointsLineText(line) }));
    const verdict = pointsVerdict(row, state);
    if (verdict) lines.push({ text: verdict.text, verdict: verdict.kind });
    return lines;
  }],
  // ib_maths: the IB maths courses the programme accepts ("none" reads as all
  // four, data.js). Blank or "?" is not known.
  ['maths', 'Maths courses accepted', (row) => (row.mathsAccepted === null
    ? [tag('Not checked yet')] : [{ text: row.mathsAccepted.join(' · ') }])],
  ['exam', 'Entrance exam', (row) => [EXAM_TEXT[row.entranceExam] ? { text: EXAM_TEXT[row.entranceExam] } : tag('Not checked yet')]],
  // Blank is not zero: a null fee is "Not published", a 0 is a real claim.
  ['fee', 'EU fee', (row) => {
    if (row.tuitionEu === null) return [tag('Not published')];
    const lines = row.tuitionEu === 0
      ? [{ text: money.format(0) }, { text: 'No tuition fee' }]
      : [{ text: `${money.format(row.tuitionEu)} / year` }];
    if (row.country === 'Ireland') lines.push({ text: 'Student contribution + levy' });
    return lines;
  }],
  ['yearly', 'Fee + 12 months\' living (estimate)', (row, state) => [yearlyLine(row, yearlyCost(row, state.myLiving))]],
  ['deadline', 'Deadline', (row) => {
    if (!row.deadline) return [tag('Not published')];
    const date = { text: longDate.format(row.deadline) };
    if (row.deadlinePassed) return [date, { text: 'Passed, check next cycle' }];
    return row.isUrgent ? [date, { text: countdown(row.daysUntilDeadline) }] : [date];
  }],
  ['language', 'Language', (row) => [row.languages.length ? { text: row.languages.join(', ') } : tag('Not checked yet')]],
  // The detail's place line says "City not published" for "?" and "City
  // unknown" when there is no city at all; the country is always known.
  ['city', 'City', (row) => {
    const city = row.cityUnknown ? tag('City not published') : (!row.city || row.city === '?' ? tag('City unknown') : null);
    if (city) return row.country ? [city, { text: row.country }] : [city];
    return [{ text: [row.city, row.country].filter(Boolean).join(', ') }];
  }],
  // "?" in application_system comes through as '' (inheritText): unknown.
  ['apply', 'Apply via', (row) => [row.applicationSystem ? { text: row.applicationSystem } : tag('Not published')]],
];

// compareTable(rows, state) → [{ key, label, always, cells: [{ lines, unknown }] }]
// One entry per fact, one cell per programme, in the order given. The
// official link is last and always shown: it is where every fact is checked.
export function compareTable(rows, state) {
  const table = CELLS.map(([key, label, read]) => ({
    key, label, always: false,
    cells: rows.map((row) => {
      const lines = read(row, state);
      return { lines, unknown: lines.some((line) => line.tag !== undefined) };
    }),
  }));
  table.push({
    key: 'link', label: 'Official page', always: true,
    cells: rows.map((row) => (row.officialUrl
      ? { lines: [{ text: 'Official admissions page', href: row.officialUrl, name: ` for ${row.programme}, ${row.university}` }], unknown: false }
      : { lines: [{ text: 'No official admissions link. Do not rely on this entry.', strong: true }], unknown: true })),
  });
  return table;
}

// True when the programmes differ on this fact, or when any of them is
// unknown: "only differences" must never hide what nobody knows.
export function differs(entry) {
  if (entry.cells.some((cell) => cell.unknown)) return true;
  return new Set(entry.cells.map((cell) => JSON.stringify(cell.lines))).size > 1;
}

// The facts to draw. With onlyDifferences, a fact every programme shares goes.
export function visibleFacts(table, onlyDifferences) {
  return onlyDifferences ? table.filter((entry) => entry.always || differs(entry)) : table;
}

// Picks still in the list, in list order, at most MAX_COMPARE. A pick whose
// programme left the list (unsaved, or a different shared link) is dropped.
export function prunePicks(picks, listIds) {
  const keep = new Set(picks);
  return listIds.filter((id) => keep.has(id)).slice(0, MAX_COMPARE);
}
