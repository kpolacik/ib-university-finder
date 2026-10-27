// Everything that touches the DOM.
//
// Values are written with textContent, never innerHTML: the data comes from a
// spreadsheet that any student can edit, and a pasted <script> tag should show
// up as text rather than run.

import { pointsLines } from './points.js';
import { pointsBucket, pointsNote } from './filters.js';

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

// shortlist and onToggleStar are still passed by app.js and kept here on
// purpose, unused: the save button was removed on 2026-10-24 at Jakub's
// request, but its code stays in case it comes back (STATUS decisions). Until
// the rows arrive (redesign stage 3) every shown programme is one full detail.
export function renderCards(container, rows, { state, shortlist, onToggleStar }) {
  container.replaceChildren(...rows.map((row) => renderDetail(row, state)));
}

// The full entry for one programme (design spec §6.7). Stage 4 will put one of
// these in the pane; for now there is one per shown row.
export function renderDetail(row, state) {
  const article = el('article', 'detail');
  // State sits on the article itself, the content-visibility root, so it
  // restyles reliably; a class on a descendant inside a skipped subtree would
  // not (STATUS trap). Passed rows are never dimmed (A01).
  if (row.deadlinePassed) article.classList.add('is-past');
  if (row.isSample) article.classList.add('is-sample');

  // --- head ----------------------------------------------------------------
  const head = el('header', 'd-head');
  const title = el('h2', 'd-title');
  // The article is named by its title, so a screen reader's list of articles
  // reads as a list of programmes (A05). programme_id never changes, so neither
  // does the id; the prefix keeps it from colliding with the page's own ids.
  title.id = `p-${row.id}`;
  article.setAttribute('aria-labelledby', title.id);
  title.append(document.createTextNode(row.programme));
  // Czech-taught programmes have Czech titles; without lang a screen reader
  // reads "Architektura a urbanismus" with English pronunciation (A05).
  if (row.languages.length === 1 && row.languages[0] === 'Czech') title.lang = 'cs';
  if (row.degreeType) {
    // Hidden ", " so it is not read as "Architektura a urbanismusBc." (A05).
    // The degree keeps the page's language even inside a Czech title.
    const degree = el('span', 'deg', row.degreeType);
    if (title.lang) degree.lang = 'en';
    title.append(el('span', 'visually-hidden', ', '), degree);
  }
  // A "?" city is unknown, not irrelevant, so it is said rather than dropped.
  const city = row.cityUnknown ? 'City not published' : row.city;
  const place = [city, row.country].filter(Boolean).join(', ');
  // The title comes first so heading navigation reads it first; CSS draws the
  // place line above it, as the design has it.
  head.append(title, el('p', 'd-place', [row.university, place].filter(Boolean).join(' · ')));
  article.append(head);

  // --- the three cells -------------------------------------------------------
  const cells = el('div', 'd-cells');
  cells.append(pointsCell(row, state), deadlineCell(row), feeCell(row));
  article.append(cells);

  // --- Requirements | Applying -----------------------------------------------
  const two = el('div', 'two');
  two.append(requirementsSection(row));
  const applying = applyingSection(row);
  if (applying) two.append(applying);
  article.append(two);

  // --- notes, after the facts -------------------------------------------------
  // My points: why an unknown row is shown, and when a cutoff is reached only
  // with HL Maths 4+ or only on Round 2 (pointsNote in filters.js). The cell
  // carries the short verdict; the full sentence is said once, here (spec §0:
  // §6.7 outranks the mockup, which merged the two).
  const pointsSays = pointsNote(row, state);
  const said = notes(row, state, pointsSays);
  if (said) article.append(said);

  const foot = footer(row);
  if (foot) article.append(foot);
  return article;
}

// Points lines come from pointsLines (js/points.js), shared with the CSV
// export, one line each so a two-round cutoff reads as two. The verdict is
// from pointsBucket, the same test the filter uses, so they cannot disagree.
function pointsCell(row, state) {
  const cell = el('div', 'cell c-pts');
  cell.append(el('span', 'lab', 'Points'));
  const list = el('ul', 'plines');
  for (const line of pointsLines(row)) {
    const item = el('li');
    if (line.number === null) {
      item.textContent = line.qualifier;
    } else {
      // The space after the number is real text, so reading and copying the
      // line gives "≈ 38 IB points, …", not "≈ 38IB points".
      item.append(el('b', '', line.number), document.createTextNode(` ${line.unit}, ${line.qualifier}`));
    }
    list.append(item);
  }
  cell.append(list);

  const bucket = pointsBucket(row, state);
  let fill = '';
  let mark = '';
  let verdict = '';
  if (bucket === 'within') {
    [fill, mark] = ['v-fit', 'm-fit'];
    verdict = row.rankedWithHpat ? 'Within your points, then HPAT' : 'Within your points';
  } else if (bucket === 'maths') {
    [fill, mark, verdict] = ['v-cond', 'm-cond', 'Only with HL Maths 4+'];
  } else if (bucket === 'unknown') {
    [fill, mark] = ['v-unk', 'm-unk'];
    if (row.ibPointsMin !== null) verdict = 'Cutoff includes a test';
    else verdict = row.pointsPlusTest ? 'No IB figure' : 'No minimum published';
  } else if (bucket === null && row.ibPointsMin === null) {
    // My points empty: the dashed box and the line already say it is unknown.
    fill = 'v-unk';
  }
  if (fill) cell.classList.add(fill);
  if (verdict) cell.append(el('span', `verd m ${mark}`, verdict));
  return cell;
}

function deadlineCell(row) {
  const cell = el('div', 'cell c-ddl');
  cell.append(el('span', 'lab', 'Deadline'));
  if (!row.deadline) {
    cell.classList.add('v-unk');
    cell.append(el('span', 'fig', 'Not published'));
    return cell;
  }
  const date = longDate.format(row.deadline);
  if (row.deadlinePassed) {
    // Neutral, never red and never dimmed: it is still a fact worth reading.
    cell.classList.add('v-past');
    const fig = el('span', 'fig');
    fig.append(el('s', '', date));
    cell.append(el('span', 'verd', 'Passed, check next cycle'), fig);
  } else if (row.isUrgent) {
    cell.classList.add('v-time');
    const verd = el('span', 'verd');
    verd.append(icon('i-clock', 'ic'), document.createTextNode(countdown(row.daysUntilDeadline)));
    cell.append(verd, el('span', 'fig', date));
  } else {
    cell.append(el('span', 'fig', date));
  }
  return cell;
}

// Blank is not zero: a null fee is "Not published", a 0 is a real claim.
function feeCell(row) {
  const cell = el('div', 'cell c-fee');
  cell.append(el('span', 'lab', 'EU fee'));
  const fig = el('span', 'fig');
  if (row.tuitionEu === null) {
    cell.classList.add('v-unk');
    fig.textContent = 'Not published';
  } else if (row.tuitionEu === 0) {
    // From 600 px the dot hides and "no tuition fee" drops under "€0".
    const zero = el('small', 'zf');
    zero.append(el('span', 'dot', '· '), document.createTextNode('no tuition fee'));
    fig.append(document.createTextNode(`${money.format(0)} `), zero);
  } else {
    fig.append(document.createTextNode(`${money.format(row.tuitionEu)} `), el('small', '', '/ year'));
  }
  cell.append(fig);
  return cell;
}

// The block this whole site exists for. Each kind of requirement on its own
// row, and a row only appears when there is something to say.
function requirementsSection(row) {
  const section = el('section', 'd-sec');
  section.append(el('h3', '', 'Requirements'));

  const nothingAtAll = row.ibPointsMin === null &&
                       row.noSubjectsRequired &&
                       row.otherRequirements.length === 0 &&
                       row.englishRequirement.length === 0 &&
                       !row.englishUnknown &&
                       row.admission.length === 0 &&
                       !row.admissionUnknown;

  if (nothingAtAll) {
    // The baseline differs by country, so it comes from the universities tab.
    // Falling back to a country-neutral sentence keeps this honest the day a
    // non-Dutch university is added.
    const baseline = row.baselineRequirement || 'a qualifying secondary school diploma';
    section.append(el('p', 'kv-none', `No requirements beyond ${baseline}`));
    return section;
  }

  const list = el('dl', 'kv');

  // --- admission ---------------------------------------------------------
  // First, because it frames the rest: a points figure means something
  // different under open entry, a CAO ranking and a Czech entrance exam.
  if (row.admission.length) {
    reqRow(list, 'Admission', [row.admission.join(' · ')]);
  } else if (row.admissionUnknown) {
    // A "?" route is not "no route": it exists and differs from the default,
    // but is unpublished. Same tag as the Subjects row's "Not checked yet".
    reqRow(list, 'Admission', [unknownTag('Not published')]);
  }

  // --- subjects ----------------------------------------------------------
  // "none" is the university saying there are none; blank is nobody checked.
  if (row.noSubjectsRequired) {
    reqRow(list, 'Subjects', ['None required']);
  } else if (row.ibSubjects) {
    reqRow(list, 'Subjects', [row.ibSubjects]);
  } else {
    reqRow(list, 'Subjects', [unknownTag('Not checked yet')]);
  }

  if (row.otherRequirements.length) {
    reqRow(list, 'Other', [row.otherRequirements.join(' · ')]);
  }

  // --- English -----------------------------------------------------------
  // Always shown. Leaving the row out made 608 cards look as if there were no
  // language requirement, when nobody had looked (R01). "?" means it differs
  // from the university's and is unpublished, as on the Admission row.
  if (row.englishRequirement.length) {
    reqRow(list, 'English requirement', [row.englishRequirement.join(' · ')]);
  } else if (row.englishUnknown) {
    reqRow(list, 'English requirement', [unknownTag('Not published')]);
  } else {
    reqRow(list, 'English requirement', [unknownTag('Not checked yet')]);
  }

  // --- general -----------------------------------------------------------
  // What every applicant's diploma must clear, from the universities tab. It
  // used to appear only inside nothingAtAll, which no real row reaches, so 29
  // universities' baselines were never shown (R03). The stored text starts
  // lowercase because it also completes "No requirements beyond …". A blank
  // baseline shows nothing: six Irish ones are blank on purpose (STATUS).
  if (row.baselineRequirement) {
    const general = row.baselineRequirement;
    reqRow(list, 'General', [general[0].toUpperCase() + general.slice(1)]);
  }

  section.append(list);
  return section;
}

function applyingSection(row) {
  const list = el('dl', 'kv');
  const deadlineNotes = [];
  if (row.deadlinePassed) deadlineNotes.push('Check the official page for the next cycle.');
  // On Irish rows this is the CAO sentence the points lines were read from.
  if (row.deadlineNotes) deadlineNotes.push(row.deadlineNotes);
  if (deadlineNotes.length) reqRow(list, 'Deadline notes', deadlineNotes.map((t) => el('p', '', t)));
  if (row.livingCostMonthly !== null) {
    reqRow(list, 'Living costs', [`${money.format(row.livingCostMonthly)} / month`]);
  }
  if (row.languages.length) reqRow(list, 'Taught in', [row.languages.join(', ')]);
  if (row.applicationSystem) reqRow(list, 'Apply via', [row.applicationSystem]);
  if (list.childElementCount === 0) return null;

  const section = el('section', 'd-sec');
  section.append(el('h3', '', 'Applying'), list);
  return section;
}

// Never called with an empty label, so no dt is ever empty (A05).
function reqRow(dl, label, nodes) {
  dl.append(el('dt', '', label));
  const dd = el('dd');
  dd.append(...nodes.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)));
  dl.append(dd);
}

function unknownTag(text) {
  return el('span', 'unk-t', text);
}

// Why a row survived a filter it looks like it should have failed, and the
// one warning that matters more than any fact on the entry.
function notes(row, state, pointsSays) {
  const box = el('div', 'notes');
  if (state.maxTuition !== null && row.tuitionEu === null) {
    box.append(el('p', 'note', 'Shown despite the tuition filter — we do not have a fee for this one.'));
  }
  if (pointsSays) box.append(el('p', 'note pnote', pointsSays));
  if (!row.officialUrl) {
    box.append(el('p', 'note note-strong', 'No official link on file — do not rely on this entry.'));
  }
  return box.childElementCount ? box : null;
}

function footer(row) {
  const foot = el('footer', 'd-foot');

  // data.js already ran these through safeUrl and stored null or a normalised
  // href, so there is nothing left to validate here.
  if (row.officialUrl) {
    // 1240 links all named "Official admissions page" are useless in a screen
    // reader's links list, so a hidden part says whose page it is (A04).
    foot.append(externalLink('btn btn-p', 'Official admissions page', row.officialUrl,
      ` for ${row.programme}, ${row.university}`));
  }
  if (row.studentLifeUrl) {
    foot.append(externalLink('lnk', 'Student life', row.studentLifeUrl));
  }

  // Every card used to end "Gathered <date> · nobody has checked this yet".
  // Removed 2026-10-24 at Jakub's request: the source line at the top of the
  // page already says it once for the whole dataset, and repeated on every
  // entry it was noise. A line now appears only when there is something
  // specific to say — a row a person has signed off, or an invented sample row.
  //
  // One chain, so the text and its tag are chosen together.
  if (row.isSample) {
    foot.append(el('span', 'tag tag-strong', 'Invented sample row · not real data'));
  } else if (row.isChecked && row.lastVerified) {
    const ok = el('p', 'ok');
    let text = `Checked ${longDate.format(row.lastVerified)}`;
    if (row.verifiedBy) text += ` by ${row.verifiedBy}`;
    ok.append(icon('i-check', 'ic'), document.createTextNode(text));
    if (row.isStale) ok.append(document.createTextNode(' '), el('span', 'tag', 'may be out of date'));
    foot.append(ok);
  }

  return foot.childElementCount ? foot : null;
}

// Both links open a new tab, which a screen reader user is not told unless
// the link says so (A04). The visible text stays as it was.
function externalLink(className, label, href, hiddenName = '') {
  const link = el('a', className, label);
  link.append(el('span', 'visually-hidden', `${hiddenName} (opens in a new tab)`));
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // The icon says "this leaves the site" without spending a word on it.
  link.append(icon('i-ext', 'ic'));
  return link;
}

// Icons come from the sprite in index.html, referenced rather than inlined so
// the same path is not repeated 1240 times in the DOM.
function icon(id, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function countdown(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

// ------------------------------------------------------------ filter chips

// One checkbox row per value, inside a filter drop-down's pick-list. (These were
// pill-shaped chips until the filters moved into a bar above the results.)
export function renderChips(container, values, selected, onToggle) {
  container.replaceChildren(...values.map((value) => {
    const label = el('label', 'option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected.has(value);
    input.addEventListener('change', () => onToggle(value, input.checked));
    label.append(input, el('span', '', value));
    return label;
  }));
}

export function renderSortOptions(select, sorts, current) {
  select.replaceChildren(...Object.entries(sorts).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === current;
    return option;
  }));
}

// ---------------------------------------------------------------- banners

export function renderSourceLine(node, rows, meta) {
  node.replaceChildren();
  node.hidden = !(meta.draftCount > 0);
  if (node.hidden) return;
  const universities = new Set(rows.map((r) => r.university)).size;
  const countries = new Set(rows.map((r) => r.country).filter(Boolean)).size;
  node.append(
    el('b', 'stat', `${rows.length} programmes · ${universities} universities · ${countries} countries.`),
    ' This site is a starting point for research, not a source of truth. ',
    el('span', 'src-more', 'Always check requirements, fees and deadlines on the university’s official page before you apply.'),
  );
}

export function renderSourceBanner(node, meta) {
  node.replaceChildren();
  const parts = [];
  if (meta.source === 'snapshot') {
    const when = meta.snapshotDate ? longDate.format(meta.snapshotDate) : 'an unknown date';
    parts.push(`Live data is unavailable, so this is a saved copy from ${when}. Deadlines may have moved since.`);
  }
  // Keep the issues link near the top even when a separate sample warning shows.
  const problems = meta.issues ? meta.issues.length : 0;
  if (parts.length || problems > 0) {
    const saved = el('div', 'bn bn-saved');
    saved.setAttribute('role', 'status');
    const mark = el('span', 'imark', 'i');
    mark.setAttribute('aria-hidden', 'true');
    const text = el('p', '', parts.join(' '));
    if (problems > 0) {
      const link = el('a', '', 'See the list below the results.');
      link.href = '#issues';
      text.append(
        `${parts.length ? ' ' : ''}${problems} spreadsheet ${problems === 1 ? 'problem' : 'problems'}: `,
        'some rows may be missing or incomplete. ', link,
      );
    }
    saved.append(mark, text);
    node.append(saved);
  }
  if (meta.sampleCount > 0) {
    const sample = el('div', 'bn bn-sample');
    sample.setAttribute('role', 'status');
    const all = meta.sampleCount === meta.total;
    const text = el('p');
    text.append(
      el('b', '', all ? 'Every figure on this page is made up.' : `${meta.sampleCount} of ${meta.total} entries are made-up sample rows.`),
      ` Do not use ${all ? 'it' : 'them'} for real applications.`,
    );
    sample.append(text);
    node.append(sample);
  }
  node.hidden = node.childElementCount === 0;
}

export function renderIssues(details, summary, list, issues) {
  if (issues.length === 0) {
    details.hidden = true;
    return;
  }
  summary.textContent = `${issues.length} spreadsheet ${issues.length === 1 ? 'problem' : 'problems'}`;
  list.replaceChildren(...issues.map((text) => el('li', '', text)));
  details.hidden = false;
}

// ---------------------------------------------------------------- helpers

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
