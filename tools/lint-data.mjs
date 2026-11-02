// A maintainer should see mistakes before a commit, without opening the site
// or re-running an importer that could undo hand corrections.
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvToObjects } from '../js/csv.js';
import { readSheets } from '../js/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COLUMNS = {
  Universities: 'university_id,name,city,country,application_system,living_cost_monthly,tuition_eu_default,tuition_noneu_default,baseline_requirement,english_requirement_default,admission_default,student_life_url,last_verified,verified_by,aliases'.split(','),
  Programmes: 'programme_id,university_id,city,programme,degree_type,subject_area,language,ib_points_min,ib_subjects,other_requirements,admission,tuition_eu,tuition_noneu,english_requirement,application_deadline,deadline_notes,official_url,last_verified,verified_by,application_system'.split(','),
};
const REQUIRED = {
  Universities: ['university_id', 'name', 'country', 'verified_by'],
  Programmes: ['programme_id', 'university_id', 'programme', 'application_deadline', 'official_url', 'verified_by'],
};
const UNKNOWN_COLUMNS = new Set(['tuition_eu', 'tuition_noneu', 'english_requirement', 'admission', 'city', 'degree_type', 'application_system']);
// These universities publish official pages under more than one domain.
const EXTRA_DOMAINS = { vut: ['vutbr.cz'], eur: ['rsm.nl'] };
const COMPARISON_DOMAINS = new Set(['studyportals.com', 'bachelorsportal.com', 'mastersportal.com', 'educations.com', 'topuniversities.com', 'timeshighereducation.com', 'wikipedia.org', 'unipage.net']);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const finding = (severity, rule, where, id, message) => ({ severity, rule, where, id, message });
const rowWhere = (label, row) => `${label} row ${row.__row}`;
const fingerprint = (row) => JSON.stringify([row.university_id, (row.programme || '').toLowerCase(), row.official_url]);

function isoDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === raw ? date : null;
}

function cellDate(raw) {
  const parts = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(raw);
  return isoDate(parts ? `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}` : raw);
}

function domain(raw) {
  try {
    // shortcut: last two labels cover the current countries; revisit before
    // adding countries with public suffixes such as co.uk.
    return new URL(raw).hostname.toLowerCase().split('.').slice(-2).join('.');
  } catch { return ''; }
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function lintData({ universitiesCsv, programmesCsv, today = new Date() }) {
  const findings = [];
  const sheets = {
    Universities: csvToObjects(universitiesCsv, 'Universities'),
    Programmes: csvToObjects(programmesCsv, 'Programmes'),
  };
  const add = (severity, rule, where, id, message) => findings.push(finding(severity, rule, where, id, message));
  let siteIssues;
  try { siteIssues = readSheets(universitiesCsv, programmesCsv, today).issues; }
  catch (err) { siteIssues = [err.message]; }
  for (const issue of siteIssues) {
    const where = /^(Universities|Programmes) row (\d+)/.exec(issue);
    const label = where?.[1];
    const row = label && sheets[label].rows.find((r) => r.__row === +where[2]);
    add('error', 'site', where?.[0] || 'Data files', row?.programme_id || row?.university_id || '', `The site itself will complain: ${issue}`);
  }
  // Calendar days match the cards: a deadline today has not passed yet.
  const day = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const farDay = new Date(day);
  farDay.setUTCMonth(farDay.getUTCMonth() + 18);
  const universities = new Map(sheets.Universities.rows.map((r) => [r.university_id, r]));
  const programmes = sheets.Programmes.rows;
  const usualDomains = new Map([...universities.keys()].map((id) => [id,
    mostCommon(programmes.filter((r) => r.university_id === id).map((r) => domain(r.official_url))),
  ]));
  const seenRows = new Set();
  for (const [label, sheet] of Object.entries(sheets)) {
    const seenHeaders = new Set();
    for (const column of sheet.header) {
      if (seenHeaders.has(column)) add('error', 'header-dup', `${label} header`, '', `Column ${column} appears twice; the site reads only one. Delete the copy.`);
      else if (!COLUMNS[label].includes(column)) add('warning', 'header-extra', `${label} header`, '', `The site ignores column ${column}. Is it misspelt?`);
      seenHeaders.add(column);
    }
    for (const column of COLUMNS[label]) {
      if (!REQUIRED[label].includes(column) && !seenHeaders.has(column)) {
        add('warning', 'header-missing', `${label} header`, '', `Column ${column} is missing. Its values will be blank or use the university default where one applies.`);
      }
    }
    for (const row of sheet.rows) {
      const id = row.programme_id || row.university_id || '';
      const where = rowWhere(label, row);
      const cell = (severity, rule, column, message) => add(severity, rule, where, id, `${column}: ${message}`);
      for (const column of sheet.header) {
        const value = row[column];
        const marker = /\b(?:CONFIRM|TODO|TBD|FIXME|XXX)\b|\?\?/.exec(value);
        if (marker) cell('error', 'marker', column, `"${marker[0]}" is a note to yourself and students would see it. Finish the check or delete it.`);
        if (value === '?' && (label === 'Universities' || !UNKNOWN_COLUMNS.has(column))) {
          cell('error', 'unknown-misuse', column, '"?" only means "not published" in programme tuition, English, admission, city, application system and degree type. Leave this cell blank if nobody checked.');
        }
        if (/\bSAMPLE\b/.test(value)) cell('error', 'sample', column, 'SAMPLE marks invented test rows and puts a red banner on the site.');
        if (/Ã|â€|Â/.test(value)) cell('error', 'encoding', column, 'This cell was damaged by Excel or a wrong encoding (é became Ã©). Re-type it; never open the CSV in Excel.');
        if (/·/.test(value) && /(?<! )·|·(?! )/.test(value)) cell('warning', 'bullet', column, 'Lists need " · " with spaces, or two items read as one.');
        if (label === 'Programmes' && UNKNOWN_COLUMNS.has(column) &&
            (/^(?:unknown|n\/a|TBC|not published)$/i.test(value) || (value.includes('?') && value !== '?'))) {
          cell('warning', 'unknown-text', column, 'Write just "?" when the value is not published.');
        }
      }
      if (row.verified_by && row.verified_by !== 'AI-DRAFT' && !row.verified_by.includes('SAMPLE') && !/^\p{Lu}{2,4}$/u.test(row.verified_by)) {
        cell('error', 'signer', 'verified_by', 'This is a signature: AI-DRAFT, or 2–4 capital initials of the person who read the page. "ai-draft" would show this row as checked.');
      }
      const verified = cellDate(row.last_verified || '');
      if (verified && +verified > day) cell('error', 'future-verified', 'last_verified', 'This date is in the future, so it is probably a typo.');
      if (label !== 'Programmes') continue;
      if (/^(?:none|n\/a|-|no requirements?)$/i.test(row.ib_subjects) && row.ib_subjects !== 'none') {
        cell('error', 'none-spelling', 'ib_subjects', 'Write exactly "none", and only when the university says it has no subject requirements. Leave it blank if nobody checked.');
      }
      for (const [, d, m, y] of (row.deadline_notes || '').matchAll(/\bwill (?:confirm|announce|publish)\b[^.]*?\bby (\d{1,2}) ([A-Za-z]+) (\d{4})/gi)) {
        const month = MONTHS.indexOf(m.toLowerCase());
        const promised = isoDate(`${y}-${String(month + 1).padStart(2, '0')}-${d.padStart(2, '0')}`);
        if (promised && +promised < day) cell('error', 'promise', 'deadline_notes', `The note promises news by ${d} ${m} ${y}, which has passed. Re-read the official page and rewrite the note.`);
      }
      const deadline = cellDate(row.application_deadline || '');
      if (deadline && +deadline < day) cell('warning', 'past-deadline', 'application_deadline', `The deadline ${row.application_deadline} has passed and the card says so. If next year's date is out, update it.`);
      if (deadline && +deadline > +farDay) cell('warning', 'far-deadline', 'application_deadline', `${row.application_deadline} is very far off. Check the year.`);
      const host = domain(row.official_url);
      const usual = usualDomains.get(row.university_id);
      if (COMPARISON_DOMAINS.has(host)) cell('error', 'comparison-site', 'official_url', "Use the university's own page, not a comparison site.");
      if (host && usual && host !== usual && !EXTRA_DOMAINS[row.university_id]?.includes(host)) {
        cell('warning', 'off-domain', 'official_url', `The link goes to ${host}, but this university's other links use ${usual}. Check it is the official page.`);
      }
      if (/^http:/.test(row.official_url)) cell('warning', 'http', 'official_url', 'Use https.');
      if (universities.get(row.university_id)?.country === 'Czechia' && row.ib_points_min) {
        cell('warning', 'czech-points', 'ib_points_min', 'Czech admission is by entrance exam. Keep this only if the university publishes an IB score (for example, a test waiver).');
      }
      const key = fingerprint(row);
      if (seenRows.has(key)) add('warning', 'dup-row', where, id, 'Looks like one programme listed twice: same university, title and official link.');
      seenRows.add(key);
    }
  }
  return findings;
}

export function compareIds({ base, work }) {
  const findings = [];
  for (const [kind, label, idColumn, identity] of [
    ['programmes', 'Programmes', 'programme_id', fingerprint],
    ['universities', 'Universities', 'university_id', (r) => JSON.stringify([r.country, (r.name || '').toLowerCase()])],
  ]) {
    // Without a base, every row would look new and every prefix check would
    // pretend to know history. The CLI explains why comparison was skipped.
    if (base?.[kind] == null) continue;
    const oldSheet = csvToObjects(base[kind], label);
    const sheet = csvToObjects(work[kind], label);
    // A renamed identity column is a site error, not evidence of renamed ids.
    const identityColumns = kind === 'programmes'
      ? [idColumn, 'university_id', 'programme', 'official_url'] : [idColumn, 'name', 'country'];
    if (identityColumns.some((column) => !oldSheet.header.includes(column) || !sheet.header.includes(column))) continue;
    const oldRows = oldSheet.rows;
    const rows = sheet.rows;
    const old = new Map(oldRows.map((r) => [r[idColumn], r]));
    const current = new Map(rows.map((r) => [r[idColumn], r]));
    const byIdentity = new Map();
    for (const row of oldRows) {
      const key = identity(row);
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(row);
    }
    const renamed = new Set();
    // An old id that still exists but no longer has its old identity.
    const shiftedFrom = (matches) => matches.find((r) => current.has(r[idColumn])
      && identity(current.get(r[idColumn])) !== identity(r));
    for (const row of rows) {
      const id = row[idColumn];
      const before = old.get(id);
      const matches = (byIdentity.get(identity(row)) || []).filter((r) => r[idColumn] !== id);
      const add = (severity, rule, message) => findings.push(finding(severity, rule, rowWhere(label, row), id, message));
      if (!before) {
        const disappeared = matches.find((r) => !current.has(r[idColumn]));
        if (disappeared) {
          renamed.add(disappeared[idColumn]);
          add('warning', kind === 'programmes' ? 'id-renamed' : 'uni-renamed', `${id} looks like ${disappeared[idColumn]} under a new id. Keep ${disappeared[idColumn]}; ids must never change.`);
        } else if (kind === 'programmes' && shiftedFrom(matches)) {
          // An importer that meets one more row first hands every later id
          // to its neighbour: the new id gets an old row, and that old id now
          // points at something else. If the old id took over a third row's
          // identity too, it is a chain, which only renumbering explains.
          const shifted = shiftedFrom(matches);
          const chain = (byIdentity.get(identity(current.get(shifted.programme_id))) || [])
            .some((r) => r.programme_id !== shifted.programme_id);
          add(chain ? 'error' : 'warning', 'id-shift', `${id} is new but holds what ${shifted.programme_id} held in the comparison commit, and ${shifted.programme_id} now holds something else. An importer probably shifted the ids. Put the old ids back; ids must never change.`);
        } else if (kind === 'programmes') {
          const prefix = mostCommon(oldRows.filter((r) => r.university_id === row.university_id).map((r) => r.programme_id.split('-')[0])) || row.university_id;
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !id.startsWith(prefix + '-')) {
            add('warning', 'new-id-format', `New ids must look like the others (for example, ${prefix}-…). Ids can never change later, so get it right now.`);
          }
        }
        continue;
      }
      if (kind !== 'programmes' || identity(before) === identity(row)) continue;
      const swap = matches.find((r) => current.has(r[idColumn]) && identity(current.get(r[idColumn])) === identity(before));
      if (swap) {
        add('error', 'id-swap', `${id} and ${swap.programme_id} have exchanged programmes since the comparison commit. An importer probably renumbered them. Put the old ids back; ids must never change.`);
      } else if (matches.length) {
        add('warning', 'id-collision', `${id} now looks like what ${matches.map((r) => r.programme_id).join(', ')} was in the comparison commit. If an importer renumbered ids, put the old ids back.`);
      }
      if (before.university_id !== row.university_id) add('warning', 'id-moved', `${id} now belongs to ${row.university_id}, previously ${before.university_id}. Check the university; ids must never change meaning.`);
      if (!swap && !matches.length && (before.programme || '').toLowerCase() !== (row.programme || '').toLowerCase()) {
        add('warning', 'id-retitled', `${id} was "${before.programme}" and is now "${row.programme}". Fine for a spelling fix; a different programme needs a new id.`);
      }
    }
    for (const row of oldRows) {
      const id = row[idColumn];
      if (!current.has(id) && !renamed.has(id)) findings.push(finding('warning', kind === 'programmes' ? 'id-gone' : 'uni-gone', rowWhere(label, row) + ' in comparison commit', id,
        `${id} (${row.programme || row.name}) was in the comparison commit and is gone. Fine if dropped on purpose. If renamed or re-imported, restore ${id}.`));
    }
  }
  return findings;
}

export function formatReport(findings, notes = [], { all = false } = {}) {
  const lines = notes.map((note) => `Note: ${note}`);
  for (const [severity, heading] of [['error', 'ERRORS (fix before you commit)'], ['warning', 'WARNINGS (read each; fix it, or leave it if it is right)']]) {
    lines.push('', heading);
    const groups = new Map();
    for (const f of findings.filter((f) => f.severity === severity)) {
      if (!groups.has(f.rule)) groups.set(f.rule, []);
      groups.get(f.rule).push(f);
    }
    if (!groups.size) lines.push('  None.');
    for (const [rule, rows] of groups) {
      lines.push(`  ${rule} (${rows.length})`);
      for (const f of (all ? rows : rows.slice(0, 10))) lines.push(`    ${f.where}${f.id ? ` (${f.id})` : ''}: ${f.message}`);
      if (!all && rows.length > 10) lines.push(`    …and ${rows.length - 10} more (add --all)`);
    }
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  lines.push('', `Result: ${errors} errors, ${warnings} warnings. ${errors ? 'Fix the errors first.' : 'OK to commit.'}`);
  return lines.join('\n');
}

function main(args) {
  const usage = 'Usage: node tools/lint-data.mjs [--against <git ref>] [--no-git] [--today YYYY-MM-DD] [--all]';
  let ref = 'HEAD';
  let explicitRef = false;
  let noGit = false;
  let all = false;
  let today = new Date();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-git') noGit = true;
    else if (arg === '--all') all = true;
    else if (arg === '--against' || arg === '--today') {
      const value = args[++i];
      if (!value || value.startsWith('--') || (arg === '--today' && !isoDate(value))) { console.log(usage); return 2; }
      if (arg === '--against') { ref = value; explicitRef = true; }
      else {
        const date = isoDate(value);
        today = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      }
    } else { console.log(usage); return 2; }
  }
  const work = Object.fromEntries(['programmes', 'universities'].map((kind) => [kind, readFileSync(join(ROOT, `data/${kind}.csv`), 'utf8')]));
  const notes = [];
  const base = { programmes: null, universities: null };
  if (!noGit) {
    for (const kind of Object.keys(base)) {
      try {
        // Node's default 1 MiB buffer would fail silently once the CSV grows
        // past about 2,800 rows, and the id comparison would quietly stop.
        base[kind] = execFileSync('git', ['show', `${ref}:data/${kind}.csv`],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      } catch (err) {
        const reason = err.code === 'ENOENT' ? 'git is not installed'
          : `cannot read data/${kind}.csv at ${ref}${err.code ? ` (${err.code})` : ''}`;
        // A maintainer who typed --against wants that comparison (before an
        // upstream merge, say); a typo must not end in "OK to commit".
        if (explicitRef && err.code !== 'ENOENT') { console.log(`Cannot compare ids: ${reason}.`); return 2; }
        notes.push(reason);
      }
    }
  }
  const findings = [
    ...lintData({ universitiesCsv: work.universities, programmesCsv: work.programmes, today }),
    ...compareIds({ base, work }),
  ];
  const uniCount = csvToObjects(work.universities, 'Universities').rows.length;
  const progCount = csvToObjects(work.programmes, 'Programmes').rows.length;
  console.log(`data/universities.csv (${uniCount} rows), data/programmes.csv (${progCount} rows); compare ids against ${noGit ? 'disabled (--no-git)' : ref}.`);
  console.log(formatReport(findings, notes.length ? [`Id comparison skipped: ${notes.join('; ')}.`] : [], { all }));
  return findings.some((f) => f.severity === 'error') ? 1 : 0;
}

// Imports are used by check.mjs; they must not read files, run git or print.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
