// CSVs can come from upstream: one vocabulary keeps old names and typos from
// creating extra filter buttons, without rewriting the source data.
export const SUBJECT_AREAS = Object.freeze([
  'Engineering', 'Computer Science', 'Mathematics', 'Physics', 'Chemistry',
  'Biology & Life Sciences', 'Environmental Sciences', 'Medicine & Health',
  'Psychology', 'Economics', 'Business & Management', 'Law',
  'Politics & International Relations', 'Sociology & Anthropology', 'History',
  'Philosophy', 'Languages & Literature', 'Media & Communication',
  'Art & Design', 'Architecture', 'Education', 'Liberal Arts', 'Sports Science',
]);

export const UNCLASSIFIED = 'Unclassified';

export const SUBJECT_ALIASES = new Map([
  ['business', ['Business & Management']],
  ['marketing', ['Business & Management']],
  ['logistics & trade', ['Business & Management']],
  ['finance', ['Economics', 'Business & Management']],
  ['electrical engineering', ['Engineering']],
  ['mechanical engineering', ['Engineering']],
  ['chemical engineering', ['Engineering']],
  ['energy engineering', ['Engineering']],
  ['mechatronics', ['Engineering']],
  ['industrial electronics', ['Engineering']],
  ['software engineering', ['Computer Science']],
  ['artificial intelligence', ['Computer Science']],
  ['biotechnology', ['Biology & Life Sciences']],
  ['cognitive science', ['Psychology']],
  ['anthropology', ['Sociology & Anthropology']],
  ['social sciences', ['Sociology & Anthropology']],
  ['european studies', ['Politics & International Relations']],
  ['languages', ['Languages & Literature']],
  ['design & architecture', ['Architecture', 'Art & Design']],
  ['design & technology', ['Art & Design']],
  // These known labels are too broad to assign a subject without guessing.
  ['humanities', []],
  ['interdisciplinary', []],
  ['innovation', []],
]);

const canonical = new Map(SUBJECT_AREAS.map((area) => [area.toLowerCase(), area]));

export function subjectAreasOf(raw, issues, where) {
  const areas = new Set();
  for (const value of String(raw || '').split(';').map((v) => v.trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    if (canonical.has(key)) areas.add(canonical.get(key));
    else if (SUBJECT_ALIASES.has(key)) SUBJECT_ALIASES.get(key).forEach((area) => areas.add(area));
    else {
      // Keep the unknown marker even beside a valid subject: unknown never hides.
      areas.add(UNCLASSIFIED);
      issues.push(`${where}: subject_area "${value}" is not on the subject list — shown as Unclassified.`);
    }
  }
  return areas.size ? [...areas] : [UNCLASSIFIED];
}
