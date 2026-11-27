// TEST ONLY: invented reviewed-subject-rule records for tools/check.mjs and
// tools/smoke.mjs (F01). Every record here is marked SAMPLE in both signer
// cells, so the real site rejects it (subject-rules.js, reason 'sample');
// only the test adapter (subject-rules-sample-adapter.js) lets one through,
// with a fixture warning on screen. Nothing here describes a real programme's
// requirements, and nothing here is ever written to data/.
//
// Dependencies are never typed in: they are read at test time from the very
// catalogue text the page is served (plan R7), so Jakub's routine edits to
// programmes.csv cannot break the tests. Drift tests change a copy.

import { csvToObjects } from '../js/csv.js';
import { RULE_COLUMNS, REQUIRED_PROGRAMME_DEPENDENCIES, REQUIRED_UNIVERSITY_DEPENDENCIES } from '../js/subject-rules.js';

export const SAMPLE_AUTHOR = 'SAMPLE AB';
export const SAMPLE_REVIEWER = 'SAMPLE CD';
export const SAMPLE_URL = 'https://example.org/sample-subject-rule';
export const SAMPLE_QUOTE = 'SAMPLE: invented wording for tests only.';

// Case 1's fixture: Maths AA or AI at HL grade 5 (SL explicitly excluded by
// the invented source) and Physics HL 5. `withoutExclusion` drops the cited
// SL exclusion, which must turn the AI SL conflict into Needs checking.
export const MATHS_HL5 = { type: 'subject', courses: ['maths-aa', 'maths-ai'], levels: ['HL'], min_grade: 5, exclude_levels: ['SL'], sources: ['s1'] };
export const PHYSICS_HL5 = { type: 'subject', courses: ['physics'], levels: ['HL'], min_grade: 5, sources: ['s1'] };

// The catalogue as served: exact trimmed cells, keyed by id.
export function servedCatalogue(universitiesText, programmesText) {
  const rows = (text) => csvToObjects(text, 'served').rows.map(({ __row, ...row }) => row);
  const universities = new Map(rows(universitiesText).map((row) => [row.university_id, row]));
  const programmes = new Map(rows(programmesText).map((row) => [row.programme_id, row]));
  return { universities, programmes };
}

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, Object.hasOwn(row, key) ? row[key] : null]));

// One SAMPLE record (cells as the CSV holds them) for a served programme.
export function sampleRuleRecord(catalogue, programmeId, overrides = {}) {
  const programme = catalogue.programmes.get(programmeId);
  if (!programme) throw new Error(`fixture: ${programmeId} is not in the served catalogue`);
  const university = catalogue.universities.get(programme.university_id);
  const fields = {
    schema_version: '1', programme_id: programmeId, intake: '2027/28', status: 'approved',
    scope: { qualification: 'ib-diploma', label: { en: 'Applicants with the IB Diploma (SAMPLE fixture)', sk: 'Uchádzači s IB diplomom (SAMPLE fixture)' }, sources: ['s1'] },
    evidence_kind: 'complete-restrictions',
    routes: { routes: [{ id: 'a', clauses: [MATHS_HL5, PHYSICS_HL5] }] },
    sources: { s1: { url: SAMPLE_URL, quote: SAMPLE_QUOTE } },
    programme_dependencies: pick(programme, REQUIRED_PROGRAMME_DEPENDENCIES),
    university_dependencies: pick(university, REQUIRED_UNIVERSITY_DEPENDENCIES),
    checked_on: '2026-11-20', recheck_by: '2027-01-31', author: SAMPLE_AUTHOR, reviewer: SAMPLE_REVIEWER, reviewed_on: '2026-11-25',
    ...overrides,
  };
  return Object.fromEntries(RULE_COLUMNS.map((column) => {
    const value = fields[column];
    return [column, typeof value === 'string' ? value : JSON.stringify(value)];
  }));
}

const cell = (value) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

// The rules file a test serves: the exact header, then one line per record.
export function rulesCsv(records) {
  return [RULE_COLUMNS.join(','), ...records.map((record) => RULE_COLUMNS.map((c) => cell(record[c] ?? '')).join(','))].join('\n') + '\n';
}
