// What a year costs: the EU fee plus twelve months of living costs, as a
// range. One place for the sum, so the row, the detail, the "Max yearly cost"
// filter and the CSV export can never disagree about it. Pure, no DOM.

// Living costs from a visa or residence-permit rule are the least a
// government will accept as proof of funds, not what a student spends. The
// sources are written by hand in data/universities.csv (living_cost_source),
// and on 2026-11-03 these four kinds were floors:
//   "national estimate (German student visa)"           Germany
//   "national estimate (UDI)"                           Norway, the immigration directorate
//   "national estimate (Migration Agency)"              Sweden, the residence-permit amount
//   "national estimate (UK student visa), £1,171 a month" (and £1,529 for London)
// The national student portals (Study in NL, Study in Denmark, Study in
// Finland, Study in Austria) publish a typical budget, so they are not floors.
// A new source that names a visa, a residence permit or an immigration or
// migration authority is a floor too.
const FLOOR_SOURCE = /\bvisa\b|residence permit|\bUDI\b|migration|immigration/i;

export function livingIsFloor(source) {
  return FLOOR_SOURCE.test(String(source || ''));
}

export const FLOOR_LABEL = 'national minimum, not a full budget';

// A money figure we may add up: a finite number, 0 or more. 0 is a real value
// (no tuition fee, or a student who lives at home); null, NaN, Infinity or a
// negative number is not, and never turns into 0.
function amount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// yearlyCost(row, myLiving) → {
//   known     true when both the fee and a living cost are known
//   low, high fee + 12 × the lowest and highest monthly figure (null when not known)
//   reason    null when known; else 'fee', 'living' or 'both' (what is missing)
//   monthlyMin, monthlyMax  the monthly figures used (null when unknown)
//   personal  true when the student's own monthly figure replaced the university's
//   floor     true when the university's figure is a visa or national minimum
// }
// myLiving is the student's "My living costs" in euros a month, or null. When
// it is a usable amount it replaces the university's estimate, including where
// that estimate is unknown. An unknown fee still means no total.
export function yearlyCost(row, myLiving = null) {
  const fee = amount(row.tuitionEu);
  const mine = amount(myLiving);
  const personal = mine !== null;
  let monthlyMin = personal ? mine : amount(row.livingCostMin);
  let monthlyMax = personal ? mine : amount(row.livingCostMax);
  if (monthlyMin !== null && (monthlyMax === null || monthlyMax < monthlyMin)) monthlyMax = monthlyMin;
  if (monthlyMin === null) monthlyMax = null;
  const floor = !personal && monthlyMin !== null && livingIsFloor(row.livingCostSource);

  const missing = [fee === null && 'fee', monthlyMin === null && 'living'].filter(Boolean);
  if (missing.length) {
    return { known: false, low: null, high: null, reason: missing.length === 2 ? 'both' : missing[0],
      monthlyMin, monthlyMax, personal, floor };
  }
  return { known: true, low: fee + 12 * monthlyMin, high: fee + 12 * monthlyMax, reason: null,
    monthlyMin, monthlyMax, personal, floor };
}

// Where a row stands against "Max yearly cost":
//   null       no budget set
//   'over'     even the lowest estimate is above the budget: the only one hidden
//   'maybe'    the lowest estimate fits, the highest does not (low ≤ budget < high),
//              or the figure is a national minimum, whose real top is unknown
//   'within'   the whole range fits
//   'unknown'  the fee or the living cost is unknown: shown, never hidden
// The boundary is inclusive: a total exactly equal to the budget fits.
export function budgetFit(cost, budget) {
  if (budget === null || budget === undefined) return null;
  if (!cost.known) return 'unknown';
  if (cost.low > budget) return 'over';
  if (cost.high > budget || cost.floor) return 'maybe';
  return 'within';
}

// Why a total is missing, in words, for the detail and the export.
export const UNKNOWN_REASON = {
  fee: 'the EU fee is not published',
  living: 'living costs are not published',
  both: 'the EU fee and living costs are not published',
};

// UK fees and living costs were stored in pounds and converted (STATUS, United
// Kingdom). Each UK row's deadline_notes says so ("shown here in euros at the
// ECB rate of 29 October 2026"); the yearly estimate repeats it, since it adds
// up two converted figures. Null where the row says nothing of the kind.
export function poundNote(row) {
  const said = /in euros at the (ECB rate of [^.]+)\./.exec(row.deadlineNotes || '');
  return said ? `converted from £ at the ${said[1]}` : null;
}
