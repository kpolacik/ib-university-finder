// Everything that touches the DOM.
//
// Values are written with textContent, never innerHTML: the data comes from a
// spreadsheet that any student can edit, and a pasted <script> tag should show
// up as text rather than run.

import { foldAccents } from './data.js';
import { pointsLines, pointsShort } from './points.js';
import { pointsBucket, pointsNote, roundTwoOnly, REVERSE_SORTS } from './filters.js';
import { UNCLASSIFIED } from './subjects.js';
import { yearlyCost, budgetFit, livingIsFloor, FLOOR_LABEL, UNKNOWN_REASON } from './cost.js';
// The detail's wording for the exam, the countdown, money and the yearly
// estimate lives in compare.js, so the compare table can't say it differently.
import { money, moneyRange, EXAM_TEXT, countdown, yearlyLine, visibleFacts } from './compare.js';

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

// shortlist: the saved programme ids (js/shortlist.js), for each row's save
// star. headings: programme_id → group heading, put above that row in the
// list view (groupHeadings in js/shortlist.js); empty outside it.
export function renderRows(container, rows, { state, shortlist = new Set(), wide = false, headings = new Map() }) {
  container.replaceChildren(...rows.map((row) => renderRow(row, state, wide, shortlist, headings)));
}

// The rest of a long list, a slice at a time after the first screen is drawn
// (L09). The same rows renderRows builds; the items are returned so app.js can
// open a slot or mark the selection on a row that arrives late.
export function appendRows(container, rows, { state, shortlist = new Set(), wide = false, headings = new Map() }) {
  const items = rows.map((row) => renderRow(row, state, wide, shortlist, headings));
  container.append(...items);
  return items;
}

// Keep the aside and its fallback heading connected while its detail is rebuilt.
// saved: whether the programme is in the student's list, for the detail's
// "Save to my list" button; left out, there is no button.
export function renderPane({ pane, heading, body }, row, shown, state, { saved } = {}) {
  let content;
  const mode = !row ? 'empty' : shown ? 'content' : 'hidden';
  if (mode === 'content') {
    content = renderDetail(row, state, { saved });
  } else {
    content = el('div', 'pane-empty');
    const lead = el('b');
    if (row) {
      const title = el('span', '', row.programme);
      if (row.languages.length === 1 && row.languages[0] === 'Czech') title.lang = 'cs';
      lead.append(title, document.createTextNode(' does not match your filters'));
    } else lead.textContent = 'Choose a programme';
    content.append(lead, document.createTextNode(row
      ? 'Change your filters or choose another programme.'
      : 'Its details appear here. Use the Up and Down arrow keys to move through the list.'));
  }
  heading.hidden = false;
  pane.setAttribute('aria-labelledby', 'pane-h');
  body.replaceChildren(content);
  if (mode === 'content') {
    pane.setAttribute('aria-labelledby', `p-${row.id}`);
    heading.hidden = true;
  }
  return mode;
}

// The full entry for one programme (design spec §6.7). The pane has the full
// head and cells; the slot keeps the full points lines and other facts.
export function renderDetail(row, state, { slot = false, saved } = {}) {
  const article = el('article', 'detail');
  // Passed rows are never dimmed (A01). Containment belongs to li.item.
  if (row.deadlinePassed) article.classList.add('is-past');
  if (row.isSample) article.classList.add('is-sample');

  if (slot) {
    const points = el('div', 'd-pts');
    points.append(el('p', 'lab', 'IB points'), pointsList(row));
    article.append(points);
  } else {
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
    // Keep unknown degrees visible without inventing an award.
    const degree = el('span', row.degreeType && row.degreeType !== '?' ? 'deg' : 'unk-t',
      row.degreeType && row.degreeType !== '?' ? row.degreeType : 'Degree type unknown');
    if (title.lang) degree.lang = 'en';
    title.append(el('span', 'visually-hidden', ', '), degree);
    // A "?" city is unknown, not irrelevant, so it is said rather than dropped.
    const city = row.cityUnknown ? 'City not published' : (!row.city || row.city === '?' ? 'City unknown' : row.city);
    const place = [city, row.country].filter(Boolean).join(', ');
    // The title comes first so heading navigation reads it first; CSS draws the
    // place line above it, as the design has it.
    head.append(title, el('p', 'd-place', [row.university, place].filter(Boolean).join(' · ')));
    article.append(head);

    // --- the three cells -------------------------------------------------------
    const cells = el('div', 'd-cells');
    cells.append(pointsCell(row, state), deadlineCell(row), feeCell(row, { state }));
    article.append(cells);
  }

  // --- Requirements | Applying -----------------------------------------------
  const two = el('div', 'two');
  two.append(requirementsSection(row));
  const applying = applyingSection(row, state);
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

  const foot = footer(row, saved);
  if (foot) article.append(foot);
  return article;
}

// Points lines come from pointsLines (js/points.js), shared with the CSV
// export, one line each so a two-round cutoff reads as two. The verdict is
// from pointsBucket, the same test the filter uses, so they cannot disagree.
function pointsCell(row, state) {
  const cell = el('div', 'cell c-pts');
  cell.append(el('span', 'lab', 'IB points'));
  cell.append(pointsList(row));

  const bucket = pointsBucket(row, state);
  let fill = '';
  let mark = '';
  let verdict = '';
  if (bucket === 'within') {
    [fill, mark] = ['v-fit', 'm-fit'];
    verdict = row.rankedWithHpat ? 'Within your IB points, then HPAT' : 'Within your IB points';
  } else if (bucket === 'maths') {
    [fill, mark, verdict] = ['v-cond', 'm-cond', 'Only with HL Maths 4+'];
  } else if (bucket === 'unknown') {
    [fill, mark] = ['v-unk', 'm-unk'];
    if (row.ibPointsMin !== null) verdict = 'Cutoff may include test marks';
    else verdict = pointsShort(row).unknown.verdict;
  } else if (bucket === null && row.ibPointsMin === null) {
    // My points empty: the dashed box and the line already say it is unknown.
    fill = 'v-unk';
  }
  if (fill) cell.classList.add(fill);
  if (verdict) cell.append(el('span', `verd m ${mark}`, verdict));
  return cell;
}

function pointsList(row) {
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
  return list;
}

function renderRow(row, state, wide, shortlist, headings) {
  const item = el('li', 'item');
  item.setAttribute('data-id', row.id);
  // The list view's group heading ("March 2027 · 2") sits inside the group's
  // first row, so every child of the list stays one programme and the arrow
  // keys, the selection and the late slices need no special case.
  const group = headings.get(row.id);
  if (group) {
    item.classList.add('has-grp');
    item.append(el('h3', 'grp-h', group));
  }
  if (row.deadlinePassed) item.classList.add('is-past');
  if (row.isSample) item.classList.add('is-sample');
  const body = el('div', 'row');
  const main = el('div', 'r-main');
  const heading = el('h3', 'r-t');
  const title = el('button', 'open', row.programme);
  title.type = 'button';
  if (wide) title.setAttribute('aria-controls', 'pane');
  else title.setAttribute('aria-expanded', 'false');
  if (row.languages.length === 1 && row.languages[0] === 'Czech') title.lang = 'cs';
  const degree = el('span', row.degreeType && row.degreeType !== '?' ? 'deg' : 'unk-t',
    row.degreeType && row.degreeType !== '?' ? row.degreeType : 'Degree type unknown');
  if (title.lang) degree.lang = 'en';
  title.append(el('span', 'visually-hidden', ', '), degree);
  heading.append(title);
  const sub = el('p', 'sub');
  const city = row.cityUnknown ? 'City not published' : (!row.city || row.city === '?' ? 'City unknown' : row.city);
  sub.append(el('span', 'uc', [row.university, city].filter(Boolean).join(' · ')));
  if (row.country) {
    // The country in words on a tinted badge; styles.css maps the tint from
    // data-country, and an unmapped country gets the neutral one. A real
    // space before it, so it reads "Town Denmark", not "TownDenmark".
    const country = el('span', 'cc', row.country);
    country.setAttribute('data-country', row.country);
    sub.append(document.createTextNode(' '), country);
  }
  // The Charles faculty shows on every Charles row, not only on same-name
  // ones: students compare faculties (1st/2nd/3rd Medicine) across titles (U2).
  const identityText = row.identity?.text || row.faculty?.name;
  if (identityText) {
    const identity = el('span', 'identity', identityText);
    identity.id = `identity-${row.id}`;
    title.setAttribute('aria-describedby', identity.id);
    sub.append(document.createTextNode(' · '), identity);
  }
  if (row.isSample) sub.append(el('span', 'tag tag-strong', 'Invented sample row · not real data'));
  main.append(heading, sub, starButton(row, shortlist.has(row.id)));
  const chevron = el('span', 'chev');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.append(icon('i-chevron', 'ic'));
  body.append(main, rowPointsCell(row, state), deadlineCell(row, { compact: true }), feeCell(row, { compact: true, state }));
  // The requirements run under the facts across the whole row, never clipped.
  const line = rowRequirements(row);
  if (line) body.append(line);
  body.append(chevron);
  item.append(body);
  return item;
}

function rowRequirements(row) {
  const line = el('p', 'line');
  const group = (label, text) => {
    if (line.childElementCount || line.textContent) line.append(document.createTextNode(' · '));
    if (label) line.append(el('b', '', label), document.createTextNode(' '));
    line.append(document.createTextNode(text));
  };
  const requires = [row.ibSubjects, ...row.otherRequirements].filter(Boolean);
  if (requires.length) group('Requires', requires.join(' · '));
  if (row.languages.length && !(row.languages.length === 1 && row.languages[0] === 'English')) {
    group('Taught in', row.languages.join(', '));
  }
  const admission = row.admission.filter((text) => !(row.country === 'Ireland' && text === 'Places offered in order of CAO points'));
  if (admission.length) group('', admission.join(' · '));
  if (!row.isSample && row.isChecked && row.lastVerified) {
    const ok = el('span', 'ok');
    ok.append(icon('i-check', 'ic'), document.createTextNode(`Checked${row.verifiedBy ? ` by ${row.verifiedBy}` : ''}`));
    // A real space, as in the mockup: without it a screen reader and a copy
    // read "Entrance exam: mathsChecked by JK".
    if (line.textContent) line.append(document.createTextNode(' '));
    line.append(ok);
    if (row.isStale) line.append(el('span', 'tag', 'may be out of date'));
  }
  return line.textContent ? line : null;
}

function rowPointsCell(row, state) {
  const cell = el('p', 'cell c-pts');
  cell.append(el('span', 'lab', 'IB points'));
  const short = pointsShort(row);
  const bucket = pointsBucket(row, state);
  let fill = 'v-none';
  let verdict = '';
  if (short.unknown) [fill, verdict] = ['v-unk', short.unknown.verdict];
  else if (bucket === 'within') [fill, verdict] = ['v-fit', row.rankedWithHpat ? 'Within your IB points, then HPAT' : 'Within your IB points'];
  else if (bucket === 'maths') [fill, verdict] = ['v-cond', 'Only with HL Maths 4+'];
  else if (bucket === 'unknown') [fill, verdict] = ['v-unk', 'Cutoff may include test marks'];
  cell.classList.add(fill);
  if (verdict) cell.append(el('span', `verd m m-${fill.slice(2)}`, verdict));
  if (short.parts.length) {
    const fig = el('span', 'fig');
    short.parts.forEach((part, i) => {
      if (i) fig.append(document.createTextNode(' · '));
      const pt = el('span', 'pt');
      if (part.figure !== null) pt.append(document.createTextNode(`${part.figure} `));
      const label = row.rankedWithHpat && bucket === 'within' ? 'minimum' : part.label;
      pt.append(el('small', '', label));
      fig.append(pt);
    });
    cell.append(fig);
  } else if (short.unknown.reason) {
    const fig = el('span', 'fig');
    fig.append(el('small', '', short.unknown.reason));
    cell.append(fig);
  }
  if (short.after && !verdict) cell.append(el('span', 'q', short.after));
  if (roundTwoOnly(row, state)) cell.append(el('span', 'r2', 'Round 2 cutoff only'));
  return cell;
}

export function renderSlot(row, state, { saved } = {}) {
  const slot = el('div', 'expand');
  slot.id = `x-${row.id}`;
  slot.setAttribute('role', 'region');
  slot.setAttribute('aria-label', `Details for ${row.programme}`);
  // The slot opens by animating its one grid row from 0fr to 1fr (spec §8).
  // That needs a single child that may shrink below its content and clips it.
  const inner = el('div', 'expand-inner');
  inner.append(renderDetail(row, state, { slot: true, saved }));
  slot.append(inner);
  return slot;
}

// The count is the one live region: identical text must leave its nodes alone.
export function renderCount(node, lead, parts) {
  const text = [lead, ...parts.map((p) => p.text)].join(' · ');
  if (node.textContent === text) return false;
  node.replaceChildren(el('b', '', lead));
  for (const part of parts) {
    node.append(document.createTextNode(' · '), el('span', `k k-${part.kind} m m-${part.kind}`, part.text));
  }
  return true;
}

// The stuck phone bar's twin: the same lead, then only each bucket's number
// with its mark ("1130 of 1240 programmes · 410 · 41 · 679"). The node is
// aria-hidden; the full sentence stays the live region. Every
// pointsSummaryParts text starts with its count.
export function renderCountShort(node, lead, parts) {
  const numbers = parts.map((p) => p.text.match(/^\d+/)?.[0] ?? p.text);
  const text = [lead, ...numbers].join(' · ');
  if (node.textContent === text) return false;
  node.replaceChildren(el('b', '', lead));
  parts.forEach((part, i) => {
    node.append(document.createTextNode(' · '), el('span', `k k-${part.kind} m m-${part.kind}`, numbers[i]));
  });
  return true;
}

function deadlineCell(row, { compact = false } = {}) {
  const cell = el(compact ? 'p' : 'div', 'cell c-ddl');
  cell.append(el('span', 'lab', 'Deadline'));
  if (!row.deadline) {
    cell.classList.add('v-unk');
    cell.append(el('span', 'fig', 'Not published'));
    return cell;
  }
  const date = (compact ? shortDate : longDate).format(row.deadline);
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
// Under the fee, the monthly living cost, so the two read side by side; with
// Max yearly cost set, the verdict on the year (budgetFit, the filter's own test).
function feeCell(row, { compact = false, state = null } = {}) {
  const cell = el(compact ? 'p' : 'div', 'cell c-fee');
  cell.append(el('span', 'lab', 'EU fee'));
  const cost = yearlyCost(row, state?.myLiving ?? null);
  const fit = budgetFit(cost, state?.maxBudget ?? null);
  if (fit === 'maybe') {
    cell.classList.add('v-cond');
    cell.append(el('span', 'verd m m-cond', 'May exceed your budget'));
  } else if (fit === 'unknown') {
    cell.append(el('span', 'verd m m-unk', 'Yearly cost unknown'));
  }
  const fig = el('span', 'fig');
  if (row.tuitionEu === null) {
    cell.classList.add('v-unk');
    fig.textContent = 'Not published';
  } else if (row.tuitionEu === 0) {
    // From 600 px the dot hides and "No tuition fee" drops under "€0".
    const zero = el('small', 'zf');
    zero.append(el('span', 'dot', '· '), document.createTextNode('No tuition fee'));
    fig.append(document.createTextNode(`${money.format(0)} `), zero);
  } else {
    fig.append(document.createTextNode(`${money.format(row.tuitionEu)} `), el('small', '', '/ year'));
  }
  cell.append(fig);
  // The Irish figure is the Free Fees student contribution plus levy, not the
  // larger "EU fee" some course pages print. Only said beside a real figure:
  // under "Not published" it would read as a fee we do not have.
  if (!compact && row.country === 'Ireland' && row.tuitionEu !== null) {
    cell.append(el('small', 'q', 'Student contribution + levy'));
  }
  cell.append(el('small', 'q liv', livingShort(cost)));
  return cell;
}

// The living cost in a few words for the fee cell: "Living €900–1,200/mo",
// "Living from €957/mo" for a national minimum, "Living: your €800/mo" when
// the student's own figure replaced the university's.
function livingShort(cost) {
  if (cost.monthlyMin === null) return 'Living cost not published';
  if (cost.personal) return `Living: your ${money.format(cost.monthlyMin)}/mo`;
  if (cost.floor) return `Living from ${money.format(cost.monthlyMin)}/mo`;
  return `Living ${moneyRange(cost.monthlyMin, cost.monthlyMax)}/mo`;
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
    section.append(el('p', 'kv-none', `No IB subject requirements. General requirement: ${baseline[0].toUpperCase() + baseline.slice(1)}. Language requirement not checked yet.`));
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

  // --- entrance exam -----------------------------------------------------
  // The admission line names the exam; this row answers the yes/no question
  // the exam filter asks, so the entry and the filter never disagree
  // (Jakub's entrance_exam column, upstream 2026-10-27).
  reqRow(list, 'Entrance exam', [EXAM_TEXT[row.entranceExam] ?? unknownTag('Not checked yet')]);

  // --- subjects ----------------------------------------------------------
  // "none" is the university saying there are none; blank is nobody checked.
  if (row.noSubjectsRequired) {
    reqRow(list, 'IB subjects', ['None required']);
  } else if (row.ibSubjects) {
    reqRow(list, 'IB subjects', [row.ibSubjects]);
  } else {
    reqRow(list, 'IB subjects', [unknownTag('Not checked yet')]);
  }

  if (row.otherRequirements.length) {
    reqRow(list, 'Other requirements', [row.otherRequirements.join(' · ')]);
  }

  // --- English -----------------------------------------------------------
  // Always shown. Leaving the row out made 608 cards look as if there were no
  // language requirement, when nobody had looked (R01). "?" means it differs
  // from the university's and is unpublished, as on the Admission row.
  if (row.englishRequirement.length) {
    reqRow(list, 'Language requirement', [row.englishRequirement.join(' · ')]);
  } else if (row.englishUnknown) {
    reqRow(list, 'Language requirement', [unknownTag('Not published')]);
  } else {
    reqRow(list, 'Language requirement', [unknownTag('Not checked yet')]);
  }

  // --- general -----------------------------------------------------------
  // What every applicant's diploma must clear, from the universities tab. It
  // used to appear only inside nothingAtAll, which no real row reaches, so 29
  // universities' baselines were never shown (R03). The stored text starts
  // lowercase; the UI capitalises it in either general requirement. A blank
  // baseline shows nothing: six Irish ones are blank on purpose (STATUS).
  if (row.baselineRequirement) {
    const general = row.baselineRequirement;
    reqRow(list, 'General requirement', [general[0].toUpperCase() + general.slice(1)]);
  }

  section.append(list);
  return section;
}

function applyingSection(row, state) {
  const list = el('dl', 'kv');
  if (row.faculty) reqRow(list, 'Faculty', [row.faculty.name]);
  const deadlineNotes = [];
  if (row.deadlinePassed) deadlineNotes.push('Check the official admissions page for the next cycle.');
  // On Irish rows this is the CAO sentence the points lines were read from.
  if (row.deadlineNotes) deadlineNotes.push(row.deadlineNotes);
  if (deadlineNotes.length) reqRow(list, 'Deadline notes', deadlineNotes.map((t) => el('p', '', t)));
  const cost = yearlyCost(row, state?.myLiving ?? null);
  // A monthly range with whose estimate it is (Jakub's living_cost_* columns).
  const universityLiving = row.livingCostMin === null ? null
    : [`${moneyRange(row.livingCostMin, row.livingCostMax)} / month`, row.livingCostSource,
      livingIsFloor(row.livingCostSource) && FLOOR_LABEL].filter(Boolean).join(' · ');
  if (cost.personal) {
    // The student's own figure, said as theirs, with what it replaced.
    reqRow(list, 'Living costs', [`Your ${money.format(cost.monthlyMin)} / month (${universityLiving
      ? `replacing ${universityLiving}` : 'no university estimate'})`]);
  } else if (universityLiving) {
    reqRow(list, 'Living costs', [universityLiving]);
  }
  // Only with a living figure: without one there is no year to add up, and
  // the fee cell already says "Living cost not published".
  if (cost.monthlyMin !== null) reqRow(list, 'Fee + 12 months\' living (estimate)', [yearlyText(row, cost)]);
  if (row.languages.length) reqRow(list, 'Language', [row.languages.join(', ')]);
  if (row.applicationSystem) reqRow(list, 'Apply via', [row.applicationSystem]);
  if (list.childElementCount === 0) return null;

  const section = el('section', 'd-sec');
  section.append(el('h3', '', 'Applying'), list);
  return section;
}

// The yearly estimate (yearlyLine in compare.js) as a node: an unknown total
// gets the dashed "Not known" box, then says which half is missing.
function yearlyText(row, cost) {
  return lineNode(yearlyLine(row, cost));
}

// One compare.js line as a node: plain text, or the dashed unknown box with
// any text after it.
function lineNode(line) {
  if (line.tag === undefined) return document.createTextNode(line.text);
  const node = el('span');
  node.append(unknownTag(line.tag));
  if (line.text) node.append(document.createTextNode(line.text));
  return node;
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
  if (state.subjectAreas.size && row.subjectAreas.includes(UNCLASSIFIED)) {
    // A row can mix a known subject with an unknown word (both are kept).
    box.append(el('p', 'note', row.subjectAreas.length > 1
      ? 'Not filtered by subject area: one of its subject areas is not on the subject list.'
      : 'Not filtered by subject area: its subject area is not classified.'));
  }
  if (state.maxTuition !== null && row.tuitionEu === null) {
    box.append(el('p', 'note', 'Not filtered by your fee limit: the EU fee is unknown.'));
  }
  // Max yearly cost: why a row is shown that may not fit (budgetFit).
  const cost = yearlyCost(row, state.myLiving);
  const fit = budgetFit(cost, state.maxBudget);
  if (fit === 'unknown') {
    box.append(el('p', 'note', `Not filtered by your yearly budget: ${UNKNOWN_REASON[cost.reason]}.`));
  } else if (fit === 'maybe') {
    box.append(el('p', 'note', cost.high > state.maxBudget
      ? `May exceed your budget: the lowest estimate (${money.format(cost.low)} a year) fits, the highest (${money.format(cost.high)}) does not.`
      : `May exceed your budget: ${money.format(cost.low)} a year uses a national minimum for living costs, and real costs are usually higher.`));
  }
  if (state.myMaths !== null && row.mathsAccepted === null) {
    box.append(el('p', 'note', 'Not filtered by your maths course: it depends on your other subjects or is unclear (see IB subjects).'));
  }
  if (state.exam !== null && row.entranceExam === null) {
    box.append(el('p', 'note', 'Not filtered by the entrance-exam choice: nobody has checked whether it has one.'));
  }
  if (row.identity?.unresolved) {
    box.append(el('p', 'note', `This list has ${row.identity.count} entries named ‘${row.programme}’ at ${row.university}. This is entry ${row.identity.entry} of ${row.identity.count}. Differences beyond the facts shown here are not recorded. Compare the official admissions pages.`));
  }
  if (pointsSays) box.append(el('p', 'note pnote', pointsSays));
  if (!row.officialUrl) {
    box.append(el('p', 'note note-strong', 'No official admissions link. Do not rely on this entry.'));
  }
  return box.childElementCount ? box : null;
}

function footer(row, saved) {
  const foot = el('footer', 'd-foot');

  // data.js already ran these through safeUrl and stored null or a normalised
  // href, so there is nothing left to validate here.
  if (row.officialUrl) {
    // 1240 links all named "Official admissions page" are useless in a screen
    // reader's links list, so a hidden part says whose page it is (A04).
    const identity = row.identity?.text || row.faculty?.name;
    foot.append(externalLink('btn btn-p', 'Official admissions page', row.officialUrl,
      ` for ${row.programme}, ${row.university}${identity ? ` · ${identity}` : ''}`));
  }
  if (row.studentLifeUrl) {
    foot.append(externalLink('lnk', 'Student life', row.studentLifeUrl));
  }
  if (typeof saved === 'boolean') foot.append(saveButton(row, saved));

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

// ------------------------------------------------------------ my list

// The row's save star: a toggle (aria-pressed) named by the programme and its
// university, since many titles repeat across universities. The saved state
// is a different symbol, not only a colour: a row sets content-visibility:
// auto, and a state expressed only as CSS inside it can paint stale (STATUS,
// "Three traps"). app.js finds every button for a programme by data-save-id.
function starButton(row, saved) {
  const button = el('button', 'star');
  button.type = 'button';
  button.setAttribute('data-save-id', row.id);
  button.append(icon(saved ? 'i-bookmark-fill' : 'i-bookmark', 'ic'),
    el('span', 'visually-hidden', `Save ${row.programme}, ${row.university}, to my list`));
  button.setAttribute('aria-pressed', String(saved));
  return button;
}

// The detail's button: the same toggle with words, "Save to my list", then
// "Saved to my list" once it is in.
function saveButton(row, saved) {
  const button = el('button', 'btn save');
  button.type = 'button';
  button.setAttribute('data-save-id', row.id);
  button.append(icon(saved ? 'i-bookmark-fill' : 'i-bookmark', 'ic'), el('span', 'save-t'),
    el('span', 'visually-hidden', `: ${row.programme}, ${row.university}`));
  setSaved(button, saved);
  return button;
}

// Brings one save button (star or detail) to the saved state, in place.
export function setSaved(button, saved) {
  button.setAttribute('aria-pressed', String(saved));
  const use = button.querySelector('use');
  const mark = saved ? '#i-bookmark-fill' : '#i-bookmark';
  if (use && use.getAttribute('href') !== mark) use.setAttribute('href', mark);
  const words = button.querySelector('.save-t');
  if (words) words.textContent = saved ? 'Saved to my list' : 'Save to my list';
}

// The compare table: one column per programme, one row per fact
// (compareTable in compare.js). Row headers are real <th scope=row>, and each
// column is headed by the programme, so a screen reader names every cell.
export function renderCompare(container, rows, table, { onlyDifferences = false } = {}) {
  const facts = visibleFacts(table, onlyDifferences);
  const wrap = el('div', 'cmp-scroll');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Compare table, scrolls sideways');
  const grid = el('table', 'cmp-t');
  // The phone layout sizes the table by how many programmes it holds.
  grid.setAttribute('data-n', String(rows.length));
  const head = el('thead');
  const top = el('tr');
  const corner = el('td', 'cmp-c');
  top.append(corner);
  for (const row of rows) {
    const th = el('th', 'cmp-p');
    th.setAttribute('scope', 'col');
    const name = el('span', 'cmp-n', row.programme);
    if (row.languages.length === 1 && row.languages[0] === 'Czech') name.lang = 'cs';
    th.append(name, el('span', 'cmp-u', row.university));
    top.append(th);
  }
  head.append(top);
  const body = el('tbody');
  for (const fact of facts) {
    const tr = el('tr');
    tr.setAttribute('data-fact', fact.key);
    const th = el('th', '', fact.label);
    th.setAttribute('scope', 'row');
    tr.append(th);
    for (const cell of fact.cells) {
      const td = el('td');
      for (const line of cell.lines) {
        const p = el('p', line.verdict ? `verd m m-${line.verdict}` : line.strong ? 'note note-strong' : '');
        if (line.href) p.append(externalLink('lnk', line.text, line.href, line.name));
        else p.append(lineNode(line));
        td.append(p);
      }
      tr.append(td);
    }
    body.append(tr);
  }
  grid.append(head, body);
  wrap.append(grid);
  const hidden = table.length - facts.length;
  const out = [wrap];
  if (hidden) out.push(el('p', 'help cmp-same', `${hidden} ${hidden === 1 ? 'fact is' : 'facts are'} the same for every programme and hidden.`));
  container.replaceChildren(...out);
  return facts.length;
}

// ------------------------------------------------------------ filter chips

// One checkbox row per value, inside a filter drop-down's pick-list. (These were
// pill-shaped chips until the filters moved into a bar above the results.)
// flags maps a value to a sprite symbol (the Country list only). The flag is
// aria-hidden, so the option is still named by the country alone.
export function renderChips(container, values, selected, onToggle, { flags } = {}) {
  const options = values.map((value) => {
    const label = el('label', 'option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected.has(value);
    input.addEventListener('change', () => onToggle(value, input.checked));
    label.append(input);
    if (flags?.[value]) label.append(icon(flags[value], 'flag'));
    label.append(el('span', '', value));
    return label;
  });
  container.replaceChildren();
  if (values.length > 12) {
    const searchLabel = el('label', 'help opt-q', `Search ${container.parentElement.getAttribute('aria-label').toLowerCase()} options`);
    const search = el('input', 'inp');
    search.type = 'search';
    const clear = el('button', 'btn btn-q opt-clear', 'Clear the search');
    clear.type = 'button';
    clear.hidden = true;
    const empty = el('p', 'help opt-none', 'No matching options. Try another spelling or clear the search.');
    empty.hidden = true;
    searchLabel.append(search);
    const filter = () => {
      const query = foldAccents(search.value.trim()).toLowerCase();
      options.forEach((option, i) => { option.hidden = !foldAccents(values[i]).toLowerCase().includes(query); });
      empty.hidden = options.some((option) => !option.hidden);
      clear.hidden = !query;
    };
    search.addEventListener('input', filter);
    clear.addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
    container.append(searchLabel, clear, empty);
  }
  container.append(...options);
}

export function renderAppliedChips(container, chips, onRemove) {
  // Preserve surviving buttons (and their focus) during live filter updates.
  const existing = new Map([...container.children].map((node) => [node.getAttribute('data-chip'), node]));
  const nodes = chips.map(({ key, label }) => {
    let button = existing.get(key);
    if (!button) {
      button = el('button', 'achip');
      button.type = 'button';
      button.setAttribute('data-chip', key);
      button.addEventListener('click', () => onRemove(key));
    }
    // Named "Remove Country: Ireland"; on screen the label and a cross.
    if (button.getAttribute('data-label') !== label) {
      const cross = el('span', '', '×');
      cross.setAttribute('aria-hidden', 'true');
      button.replaceChildren(el('span', 'visually-hidden', 'Remove '), el('span', '', label), cross);
      button.setAttribute('data-label', label);
    }
    return button;
  });
  for (const node of [...container.children]) if (!nodes.includes(node)) node.remove();
  nodes.forEach((node, i) => {
    if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
  });
  container.hidden = chips.length === 0;
}

export function renderSortOptions(select, sorts, current, direction = 'asc') {
  select.replaceChildren(...Object.entries(sorts).flatMap(([key, natural]) => ['asc', 'desc'].map((dir) => {
    const value = `${key}:${dir}`;
    const label = dir === 'desc' ? REVERSE_SORTS[key] : natural;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = key === current && dir === direction;
    return option;
  })));
}

// ---------------------------------------------------------------- banners

export function renderSourceLine(node, rows, meta) {
  node.replaceChildren();
  node.hidden = !(meta.draftCount > 0);
  if (node.hidden) return;
  const universities = new Set(rows.map((r) => r.university)).size;
  const countries = new Set(rows.map((r) => r.country).filter(Boolean)).size;
  node.append(
    el('b', 'stat', `${rows.length} ${rows.length === 1 ? 'programme' : 'programmes'} · ${universities} ${universities === 1 ? 'university' : 'universities'} · ${countries} ${countries === 1 ? 'country' : 'countries'}.`),
    ' This site is a starting point for research, not a source of truth. ',
    el('span', 'src-more', 'Check requirements, EU fees and deadlines on the official admissions page before applying.'),
  );
}

export function renderSourceBanner(node, meta) {
  node.replaceChildren();
  const parts = [];
  if (meta.source === 'snapshot') {
    const when = meta.snapshotDate ? longDate.format(meta.snapshotDate) : 'an unknown date';
    parts.push(`Could not load the latest data. Showing a saved copy from ${when}. Requirements, EU fees and deadlines may have changed.`);
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
      const link = el('a', '', 'View data problems.');
      link.href = '#issues';
      text.append(
        `${parts.length ? ' ' : ''}${problems} data ${problems === 1 ? 'problem' : 'problems'}. `,
        'Some entries may be missing or incomplete. ', link,
      );
    }
    saved.append(mark, text);
    node.append(saved);
  }
  if (meta.sampleCount > 0) {
    const sample = el('div', 'bn bn-sample');
    sample.setAttribute('role', 'status');
    const text = el('p');
    text.append(
      el('b', '', `${meta.sampleCount} of ${meta.total} ${meta.total === 1 ? 'programme' : 'programmes'} ${meta.sampleCount === 1 ? 'is an invented sample row' : 'are invented sample rows'}.`),
      ` Do not use ${meta.sampleCount === 1 ? 'it' : 'them'} for real applications.`,
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
  summary.textContent = `${issues.length} data ${issues.length === 1 ? 'problem' : 'problems'}`;
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
