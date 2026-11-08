import { t, dateFormatter, facetLabel, getLanguage } from './i18n.js';
// What the detail says about a fact, in words, and the compare table built
// from the same words. Pure, no DOM, so tools/check.mjs can test every cell.
//
// The compare table (up to 4 programmes side by side) must never say a
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
import { yearlyCost, floorLabel, UNKNOWN_REASON, poundNote } from './cost.js';

// Euros follow the interface language: "€2,771" in English, "2 771 €" in
// Slovak (Leon, 2026-11-03). A Slovak reads "€1,000" as one euro, because the
// comma is the Slovak decimal mark. Chosen at format time, like dates.
const MONEY = {
  en: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  sk: new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
};
const PLAIN = {
  en: new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 }),
  sk: new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 0 }),
};
export const money = { format: (n) => MONEY[getLanguage()].format(n) };
const plain = { format: (n) => PLAIN[getLanguage()].format(n) };

const longDate = dateFormatter({
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

// One currency sign per range, where the language puts it: "€900–1,200" in
// English, "900–1 200 €" in Slovak; just "€900" when both ends are the same.
export function moneyRange(low, high) {
  if (!(high > low)) return money.format(low);
  return getLanguage() === 'sk' ? `${plain.format(low)}–${money.format(high)}` : `${money.format(low)}–${plain.format(high)}`;
}

// The Requirements block's Entrance exam row; a missing state is "Not checked yet".
export const EXAM_TEXT = {
  get yes() { return t('entrance_exam_or_test'); },
  get waivable() { return t('entrance_exam_some_ib_applicants_can_skip_it'); },
  get no() { return t('no_entrance_exam'); },
};

export function countdown(days) {
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  return t('day_count', { count: days });
}

// The yearly estimate with what it rests on: "€12,700–16,300 a year ·
// university's estimate". A national minimum reads "from …"; an unknown total
// says which half is missing. Returns one line (see the top of this file).
export function yearlyLine(row, cost) {
  if (!cost.known) return { tag: t('not_known'), text: t('because', { value1: UNKNOWN_REASON[cost.reason] }) };
  const range = cost.floor ? t('from', { value1: money.format(cost.low) }) : moneyRange(cost.low, cost.high);
  const source = cost.personal ? t('your_month_2', { value1: money.format(cost.monthlyMin) }) : row.livingCostSource;
  const segments = [{ text: t('a_year', { value1: range }) },
    source && { text: source, ...(cost.personal ? {} : { field: 'living_cost_source' }) },
    cost.floor && { text: floorLabel() }, poundNote(row) && { text: poundNote(row) }].filter(Boolean);
  return { text: segments.map((part) => part.text).join(' · '), segments };
}

// ------------------------------------------------------------------ compare

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

// The verdict words the row's points cell uses (render.js, rowPointsCell), so
// a compare column and its row agree. Null when My IB points is empty or the
// figure is above them: the row shows no verdict then either.
function pointsVerdict(row, state) {
  const bucket = pointsBucket(row, state);
  if (bucket === 'within') return { kind: 'fit', text: row.rankedWithHpat ? t('within_your_ib_points_then_hpat') : t('within_your_ib_points') };
  if (bucket === 'maths') return { kind: 'cond', text: t('only_with_hl_maths_4') };
  if (bucket === 'unknown' && row.ibPointsMin !== null) return { kind: 'unk', text: t('cutoff_may_include_test_marks') };
  return null;
}

const tag = (text, after) => (after ? { tag: text, text: after } : { tag: text });

const CELLS = () => [
  ['points', t('ib_points'), (row, state) => {
    const lines = pointsLines(row).map((line) => (line.number === null ? tag(line.qualifier) : { text: pointsLineText(line) }));
    const verdict = pointsVerdict(row, state);
    if (verdict) lines.push({ text: verdict.text, verdict: verdict.kind });
    return lines;
  }],
  // ib_maths: the IB maths courses the programme accepts ("none" reads as all
  // four, data.js). Blank or "?" is not known.
  ['maths', t('maths_courses_accepted'), (row) => (row.mathsAccepted === null
    ? [tag(t('not_checked_yet'))] : [{ text: row.mathsAccepted.join(' · ') }])],
  ['exam', t('entrance_exam'), (row) => [EXAM_TEXT[row.entranceExam] ? { text: EXAM_TEXT[row.entranceExam] } : tag(t('not_checked_yet'))]],
  // Blank is not zero: a null fee is "Not published", a 0 is a real claim.
  ['fee', t('eu_fee'), (row) => {
    if (row.tuitionEu === null) return [tag(t('not_published'))];
    const lines = row.tuitionEu === 0
      ? [{ text: money.format(0) }, { text: t('no_tuition_fee') }]
      : [{ text: t('year_2', { value1: money.format(row.tuitionEu) }) }];
    if (row.country === 'Ireland') lines.push({ text: t('student_contribution_levy') });
    return lines;
  }],
  ['yearly', t('fee_12_months_living_estimate'), (row, state) => [yearlyLine(row, yearlyCost(row, state.myLiving))]],
  ['deadline', t('deadline'), (row) => {
    if (!row.deadline) return [tag(t('not_published'))];
    const date = { text: longDate.format(row.deadline) };
    if (row.deadlinePassed) return [date, { text: t('passed_check_next_cycle') }];
    return row.isUrgent ? [date, { text: countdown(row.daysUntilDeadline) }] : [date];
  }],
  ['language', t('language'), (row) => [row.languages.length ? { text: row.languages.map(facetLabel).join(', ') } : tag(t('not_checked_yet'))]],
  // The detail's place line says "City not published" for "?" and "City
  // unknown" when there is no city at all; the country is always known.
  ['city', t('city'), (row) => {
    const city = row.cityUnknown ? tag(t('city_not_published')) : (!row.city || row.city === '?' ? tag(t('city_unknown')) : null);
    if (city) return row.country ? [city, { text: facetLabel(row.country) }] : [city];
    return [{ text: [row.city, facetLabel(row.country)].filter(Boolean).join(', ') }];
  }],
  // "?" in application_system comes through as '' (inheritText): unknown.
  ['apply', t('apply_via'), (row) => [row.applicationSystem ? { text: row.applicationSystem, field: 'application_system' } : tag(t('not_published'))]],
];

// compareTable(rows, state) → [{ key, label, always, cells: [{ lines, unknown }] }]
// One entry per fact, one cell per programme, in the order given. The
// official link is last and always shown: it is where every fact is checked.
export function compareTable(rows, state) {
  const table = CELLS().map(([key, label, read]) => ({
    key, label, always: false,
    cells: rows.map((row) => {
      const lines = read(row, state);
      return { lines, unknown: lines.some((line) => line.tag !== undefined) };
    }),
  }));
  table.push({
    key: 'link', label: t('official_page'), always: true,
    cells: rows.map((row) => (row.officialUrl
      ? { lines: [{ text: t('official_admissions_page'), href: row.officialUrl, name: t('for_2', { value1: row.programme, value2: row.university }) }], unknown: false }
      : { lines: [{ text: t('no_official_admissions_link_do_not_rely_on_this_entry'), strong: true }], unknown: true })),
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
