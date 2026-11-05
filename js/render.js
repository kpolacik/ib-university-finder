import { t, dateFormatter, dataParts, facetLabel, getLanguage, formatCount } from './i18n.js';
// Everything that touches the DOM.
//
// Values are written with textContent, never innerHTML: the data comes from a
// spreadsheet that any student can edit, and a pasted <script> tag should show
// up as text rather than run.

import { foldAccents } from './data.js';
import { pointsLines, pointsShort } from './points.js';
import { activeFilterCount, DEADLINE_WINDOWS, EXAM_OPTIONS, pointsBucket, pointsNote, roundTwoOnly, REVERSE_SORTS } from './filters.js';
import { UNCLASSIFIED } from './subjects.js';
import { yearlyCost, budgetFit, livingIsFloor, floorLabel, UNKNOWN_REASON } from './cost.js';
// The detail's wording for the exam, the countdown, money and the yearly
// estimate lives in compare.js, so the compare table can't say it differently.
import { money, moneyRange, EXAM_TEXT, countdown, yearlyLine, visibleFacts } from './compare.js';

const longDate = dateFormatter({
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const shortDate = dateFormatter({
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
export function renderPane({ pane, heading, body }, row, shown, state, { saved, savedCount = 0 } = {}) {
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
      lead.append(title, document.createTextNode(t('does_not_match_your_filters')));
    } else lead.textContent = t('choose_a_programme');
    content.append(lead, document.createTextNode(row
      ? t('change_your_filters_or_choose_another_programme')
      : t('its_details_appear_here_use_the_up_and_down_arrow_keys_to_move_throu')));
  }
  if (!row) content = filterOverview(state, savedCount);
  heading.hidden = false;
  pane.setAttribute('aria-labelledby', 'pane-h');
  body.replaceChildren(content);
  if (mode === 'content') {
    pane.setAttribute('aria-labelledby', `p-${row.id}`);
    heading.hidden = true;
  }
  return mode;
}

function filterOverview(state, savedCount) {
  const box = el('div', 'filter-overview');
  if (activeFilterCount(state)) {
    box.append(el('h2', '', t('r2_pane_for')));
    const facts = el('dl', 'overview-kv');
    const add = (label, value) => { if (value !== null && value !== '') facts.append(el('dt', '', t(label)), el('dd', '', value)); };
    add('my_ib_points_2', state.myIbPoints);
    if (state.hlMaths) add('hl_maths_4', t('r2_plus25'));
    add('search_2', state.search.trim());
    for (const [field, label] of [['subjectAreas','subject_area'], ['countries','country'], ['languages','language'], ['cities','city'], ['degreeTypes','degree_type']]) {
      add(label, [...state[field]].map((value) => field === 'subjectAreas' || field === 'degreeTypes' ? dataValue(field === 'subjectAreas' ? 'subject_area' : 'degree_type', value).textContent : facetLabel(value)).join(', '));
    }
    add('my_maths_2', state.myMaths);
    add('entrance_exam', state.exam ? EXAM_OPTIONS[state.exam] : null);
    add('deadline', state.deadlineWindow !== 'any' ? DEADLINE_WINDOWS[state.deadlineWindow] : null);
    add('max_eu_fee', state.maxTuition === null ? null : money.format(state.maxTuition));
    add('max_yearly_cost_2', state.maxBudget === null ? null : money.format(state.maxBudget));
    add('my_living_costs', state.myLiving === null ? null : money.format(state.myLiving));
    box.append(facts);
  } else box.append(el('h2', '', t('r2_pane_heading')), el('p', '', t('r2_pane_pick')));
  const edit = el('button', 'btn btn-a', t('r2_edit')); edit.type = 'button'; edit.setAttribute('data-edit', '');
  const list = el('button', 'btn btn-q', t('r2_pane_list', { count: savedCount })); list.type = 'button'; list.setAttribute('data-open-list', '');
  if (activeFilterCount(state)) { const actions = el('div', 'overview-actions'); actions.append(edit, list); box.append(actions); }
  box.append(el('h3', '', t('r2_legend')));
  const legend = el('div', 'legend');
  for (const [type, key] of [['fit','within_your_ib_points'], ['cond','only_with_hl_maths_4'], ['time','r2_legend_time'], ['unknown','r2_legend_unknown']]) {
    const line = el('div'), mark = el('i', `legend-${type}`); mark.setAttribute('aria-hidden', 'true'); line.append(mark, document.createTextNode(t(key))); legend.append(line);
  }
  box.append(legend); return box;
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
    points.append(el('p', 'lab', t('ib_points')), pointsList(row));
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
      row.degreeType && row.degreeType !== '?' ? '' : t('degree_type_unknown'));
    if (row.degreeType && row.degreeType !== '?') degree.append(dataValue('degree_type', row.degreeType));
    if (title.lang) degree.lang = 'en';
    // Only the comma is hidden. A trailing space in the zero-size span collapsed
    // the visible one after it ("DesignBcA.", review round 2).
    title.append(el('span', 'visually-hidden', ','), document.createTextNode(' '), degree);
    // A "?" city is unknown, not irrelevant, so it is said rather than dropped.
    const city = row.cityUnknown ? t('city_not_published') : (!row.city || row.city === '?' ? t('city_unknown') : row.city);
    const place = [city, facetLabel(row.country)].filter(Boolean).join(', ');
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
  detailOriginals(article, row.id, state);
  return article;
}

// Points lines come from pointsLines (js/points.js), shared with the CSV
// export, one line each so a two-round cutoff reads as two. The verdict is
// from pointsBucket, the same test the filter uses, so they cannot disagree.
function pointsCell(row, state) {
  const cell = el('div', 'cell c-pts');
  cell.append(el('span', 'lab', t('ib_points')));
  cell.append(pointsList(row));

  const bucket = pointsBucket(row, state);
  let fill = '';
  let mark = '';
  let verdict = '';
  if (bucket === 'within') {
    [fill, mark] = ['v-fit', 'm-fit'];
    verdict = row.rankedWithHpat ? t('within_your_ib_points_then_hpat') : t('within_your_ib_points');
  } else if (bucket === 'maths') {
    [fill, mark, verdict] = ['v-cond', 'm-cond', t('only_with_hl_maths_4')];
  } else if (bucket === 'unknown') {
    [fill, mark] = ['v-unk', 'm-unk'];
    if (row.ibPointsMin !== null) verdict = t('cutoff_may_include_test_marks');
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
    row.degreeType && row.degreeType !== '?' ? '' : t('degree_type_unknown'));
    if (row.degreeType && row.degreeType !== '?') degree.append(dataValue('degree_type', row.degreeType));
  if (title.lang) degree.lang = 'en';
  degree.id = `degree-${row.id}`;
  title.setAttribute('aria-describedby', degree.id);
  heading.append(title, document.createTextNode(' '), degree);
  const sub = el('p', 'sub');
  const city = row.cityUnknown ? t('city_not_published') : (!row.city || row.city === '?' ? t('city_unknown') : row.city);
  sub.append(el('span', 'uc', [row.university, city].filter(Boolean).join(' · ')));
  if (row.country) {
    // The country in words on a tinted badge; styles.css maps the tint from
    // data-country, and an unmapped country gets the neutral one. A real
    // space before it, so it reads "Town Denmark", not "TownDenmark".
    const country = el('span', 'cc', facetLabel(row.country));
    country.setAttribute('data-country', row.country);
    sub.append(document.createTextNode(' '), country);
  }
  // The Charles faculty shows on every Charles row, not only on same-name
  // ones: students compare faculties (1st/2nd/3rd Medicine) across titles (U2).
  const identityText = row.identity?.text || row.faculty?.name;
  if (identityText) {
    const identity = el('span', 'identity', identityText);
    identity.id = `identity-${row.id}`;
    title.setAttribute('aria-describedby', `${degree.id} ${identity.id}`);
    sub.append(document.createTextNode(' · '), identity);
  }
  if (row.isSample) sub.append(el('span', 'tag tag-strong', t('invented_sample_row_not_real_data')));
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
    line.append(typeof text === 'string' ? document.createTextNode(text) : text);
  };
  const requires = [row.ibSubjects, ...row.otherRequirements].filter(Boolean);
  if (requires.length) group(t('requires'), dataValue('ib_subjects', requires.join(' · ')));
  if (row.languages.length && !(row.languages.length === 1 && row.languages[0] === 'English')) {
    group(t('taught_in'), row.languages.map(facetLabel).join(', '));
  }
  const admission = row.admission.filter((text) => !(row.country === 'Ireland' && text === 'Places offered in order of CAO points'));
  if (admission.length) group('', dataValue('admission', admission.join(' · ')));
  if (!row.isSample && row.isChecked && row.lastVerified) {
    const ok = el('span', 'ok');
    ok.append(icon('i-check', 'ic'), document.createTextNode(t('checked', { value1: row.verifiedBy ? t('by', { value1: row.verifiedBy }) : '' })));
    // A real space, as in the mockup: without it a screen reader and a copy
    // read "Entrance exam: mathsChecked by JK".
    if (line.textContent) line.append(document.createTextNode(' '));
    line.append(ok);
    if (row.isStale) line.append(el('span', 'tag', t('may_be_out_of_date')));
  }
  return line.textContent ? line : null;
}

function rowPointsCell(row, state) {
  const cell = el('p', 'cell c-pts');
  cell.append(el('span', 'lab', t('ib_points')));
  const short = pointsShort(row);
  const bucket = pointsBucket(row, state);
  let fill = 'v-none';
  let verdict = '';
  if (short.unknown) [fill, verdict] = ['v-unk', t('not_published')];
  else if (bucket === 'within') [fill, verdict] = ['v-fit', row.rankedWithHpat ? t('within_your_ib_points_then_hpat') : t('within_your_ib_points')];
  else if (bucket === 'maths') [fill, verdict] = ['v-cond', t('only_with_hl_maths_4')];
  else if (bucket === 'unknown') [fill, verdict] = ['v-unk', t('cutoff_may_include_test_marks')];
  cell.classList.add(fill);
  if (short.parts.length) {
    const fig = el('span', 'fig');
    short.parts.forEach((part, i) => {
      if (i) fig.append(document.createTextNode(' · '));
      const pt = el('span', row.pointsKind === 'cutoff' ? 'pt cutoff' : 'pt');
      if (part.figure !== null) pt.append(document.createTextNode(`${part.figure}${!verdict || short.parts.length > 1 || String(part.figure).startsWith('≈') ? ' ' : ''}`));
      const label = row.rankedWithHpat && bucket === 'within' ? t('minimum') : part.label;
      if (!verdict || short.parts.length > 1 || String(part.figure).startsWith('≈')) pt.append(el('small', '', label));
      fig.append(pt);
    });
    cell.append(fig);
  }
  if (verdict) cell.append(el('span', 'verd', verdict));
  if (short.after && !verdict) cell.append(el('span', 'q', short.after));
  if (roundTwoOnly(row, state)) cell.append(el('span', 'r2', t('round_2_cutoff_only')));
  return cell;
}

export function renderSlot(row, state, { saved } = {}) {
  const slot = el('div', 'expand');
  slot.id = `x-${row.id}`;
  slot.setAttribute('role', 'region');
  slot.setAttribute('aria-label', t('details_for', { value1: row.programme }));
  // The slot opens by animating its one grid row from 0fr to 1fr (spec §8).
  // That needs a single child that may shrink below its content and clips it.
  const inner = el('div', 'expand-inner');
  inner.append(renderDetail(row, state, { slot: true, saved }));
  slot.append(inner);
  return slot;
}

// The count is the one live region: identical text must leave its nodes alone.
export function renderCount(node, lead, parts) {
  const text = [...(lead ? [lead] : []), ...parts.map((p) => p.text)].join(' · ');
  if (node.textContent === text) return false;
  const number = lead.match(/^[\d\s,\u00a0\u202f]+/)?.[0].trimEnd() ?? '';
  node.replaceChildren();
  if (lead) node.append(el('span', 'count-lead'));
  if (lead) node.lastChild.append(el('b', '', number), document.createTextNode(lead.slice(number.length)));
  for (const part of parts) {
    // In a span so a phone can drop it: each verdict sits on its own line there,
    // and a line must not end in a dangling "·" (review round 2).
    if (lead || part !== parts[0]) node.append(el('span', 'sep', ' · '));
    node.append(el('span', `k k-${part.kind} m m-${part.kind}`, part.text));
  }
  return true;
}

// The stuck phone bar's twin: the same lead, then only each bucket's number
// with its mark ("1130 of 1240 programmes · 410 · 41 · 679"). The node is
// aria-hidden; the full sentence stays the live region. Every
// pointsSummaryParts text starts with its count.
export function renderCountShort(node, lead) {
  if (node.textContent === lead) return false;
  node.textContent = lead;
  return true;
}

function deadlineCell(row, { compact = false } = {}) {
  const cell = el(compact ? 'p' : 'div', 'cell c-ddl');
  cell.append(el('span', 'lab', t('deadline')));
  if (!row.deadline) {
    cell.classList.add('v-unk');
    cell.append(el('span', 'fig', t('not_published')));
    return cell;
  }
  const date = (compact ? shortDate : longDate).format(row.deadline);
  if (compact) {
    const fig = el('span', 'fig');
    if (row.deadlinePassed) { cell.classList.add('v-past'); fig.append(el('s', '', date)); }
    else { fig.textContent = date; if (row.isUrgent) cell.classList.add('v-time'); }
    cell.append(fig, el('span', 'verd', row.deadlinePassed ? t('r2_passed') : t(row.daysUntilDeadline === 1 ? 'r2_day' : 'r2_days', { count: row.daysUntilDeadline })));
  } else if (row.deadlinePassed) {
    // Neutral, never red and never dimmed: it is still a fact worth reading.
    cell.classList.add('v-past');
    const fig = el('span', 'fig');
    fig.append(el('s', '', date));
    cell.append(el('span', 'verd', t('passed_check_next_cycle')), fig);
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
  // The compact row has no "/ year" on the figure, so where the column headings
  // are hidden its label has to say it (review round 2).
  cell.append(el('span', 'lab', t(compact ? 'r2_fee_heading' : 'eu_fee')));
  const cost = yearlyCost(row, state?.myLiving ?? null);
  const fit = budgetFit(cost, state?.maxBudget ?? null);
  if (fit === 'maybe') {
    cell.classList.add('v-cond');
    cell.append(el('span', 'verd m m-cond', t('may_exceed_your_budget')));
  } else if (fit === 'unknown') {
    cell.append(el('span', 'verd m m-unk', t('yearly_cost_unknown')));
  }
  const fig = el('span', 'fig');
  if (row.tuitionEu === null) {
    cell.classList.add('v-unk');
    fig.textContent = t('not_published');
  } else if (row.tuitionEu === 0) {
    // From 600 px the dot hides and "No tuition fee" drops under "€0".
    const zero = el('small', 'zf');
    zero.append(el('span', 'dot', '· '), document.createTextNode(t('no_tuition_fee')));
    fig.append(document.createTextNode(`${money.format(0)} `), zero);
  } else {
    fig.append(document.createTextNode(money.format(row.tuitionEu)));
    if (!compact) fig.append(document.createTextNode(' '), el('small', '', t('year')));
  }
  cell.append(fig);
  // The Irish figure is the Free Fees student contribution plus levy, not the
  // larger "EU fee" some course pages print. Only said beside a real figure:
  // under "Not published" it would read as a fee we do not have.
  if (!compact && row.country === 'Ireland' && row.tuitionEu !== null) {
    cell.append(el('small', 'q', t('student_contribution_levy')));
  }
  cell.append(el('small', 'q liv', livingShort(cost)));
  return cell;
}

// The living cost in a few words for the fee cell: "Living €900–1,200/mo",
// "Living from €957/mo" for a national minimum, "Living: your €800/mo" when
// the student's own figure replaced the university's.
function livingShort(cost) {
  if (cost.monthlyMin === null) return t('living_cost_not_published');
  if (cost.personal) return t('living_your_mo', { value1: money.format(cost.monthlyMin) });
  if (cost.floor) return t('living_from_mo', { value1: money.format(cost.monthlyMin) });
  return t('living_mo', { value1: moneyRange(cost.monthlyMin, cost.monthlyMax) });
}

// The block this whole site exists for. Each kind of requirement on its own
// row, and a row only appears when there is something to say.
function requirementsSection(row) {
  const section = el('section', 'd-sec');
  section.append(el('h3', '', t('requirements')));

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
    const baseline = row.baselineRequirement || t('a_qualifying_secondary_school_diploma');
    const sentence = t('no_ib_subject_requirements_general_requirement_language_requirement', { value1: '\u0000' }).split('\u0000');
    const text = el('p', 'kv-none');
    text.append(sentence[0], row.baselineRequirement ? dataValue('baseline_requirement', baseline) : baseline[0].toUpperCase() + baseline.slice(1), sentence[1]);
    section.append(text);
    return section;
  }

  const list = el('dl', 'kv');

  // --- admission ---------------------------------------------------------
  // First, because it frames the rest: a points figure means something
  // different under open entry, a CAO ranking and a Czech entrance exam.
  if (row.admission.length) {
    reqRow(list, t('admission'), [dataValue('admission', row.admission.join(' · '))]);
  } else if (row.admissionUnknown) {
    // A "?" route is not "no route": it exists and differs from the default,
    // but is unpublished. Same tag as the Subjects row's "Not checked yet".
    reqRow(list, t('admission'), [unknownTag(t('not_published'))]);
  }

  // --- entrance exam -----------------------------------------------------
  // The admission line names the exam; this row answers the yes/no question
  // the exam filter asks, so the entry and the filter never disagree
  // (Jakub's entrance_exam column, upstream 2026-10-27).
  reqRow(list, t('entrance_exam'), [EXAM_TEXT[row.entranceExam] ?? unknownTag(t('not_checked_yet'))]);

  // --- subjects ----------------------------------------------------------
  // "none" is the university saying there are none; blank is nobody checked.
  if (row.noSubjectsRequired) {
    reqRow(list, t('ib_subjects'), [t('none_required')]);
  } else if (row.ibSubjects) {
    reqRow(list, t('ib_subjects'), [dataValue('ib_subjects', row.ibSubjects)]);
  } else {
    reqRow(list, t('ib_subjects'), [unknownTag(t('not_checked_yet'))]);
  }

  if (row.otherRequirements.length) {
    reqRow(list, t('other_requirements'), [dataValue('other_requirements', row.otherRequirements.join(' · '))]);
  }

  // --- English -----------------------------------------------------------
  // Always shown. Leaving the row out made 608 cards look as if there were no
  // language requirement, when nobody had looked (R01). "?" means it differs
  // from the university's and is unpublished, as on the Admission row.
  if (row.englishRequirement.length) {
    reqRow(list, t('language_requirement'), [dataValue('english_requirement', row.englishRequirement.join(' · '))]);
  } else if (row.englishUnknown) {
    reqRow(list, t('language_requirement'), [unknownTag(t('not_published'))]);
  } else {
    reqRow(list, t('language_requirement'), [unknownTag(t('not_checked_yet'))]);
  }

  // --- general -----------------------------------------------------------
  // What every applicant's diploma must clear, from the universities tab. It
  // used to appear only inside nothingAtAll, which no real row reaches, so 29
  // universities' baselines were never shown (R03). The stored text starts
  // lowercase; the UI capitalises it in either general requirement. A blank
  // baseline shows nothing: six Irish ones are blank on purpose (STATUS).
  if (row.baselineRequirement) {
    const general = row.baselineRequirement;
    reqRow(list, t('general_requirement'), [dataValue('baseline_requirement', general)]);
  }

  section.append(list);
  return section;
}

function applyingSection(row, state) {
  const list = el('dl', 'kv');
  if (row.faculty) reqRow(list, t('faculty'), [row.faculty.name]);
  const deadlineNotes = [];
  if (row.deadlinePassed) deadlineNotes.push(t('check_the_official_admissions_page_for_the_next_cycle'));
  // On Irish rows this is the CAO sentence the points lines were read from.
  if (row.deadlineNotes) deadlineNotes.push(dataValue('deadline_notes', row.deadlineNotes));
  if (deadlineNotes.length) reqRow(list, t('deadline_notes'), deadlineNotes.map((text) => { const p = el('p'); p.append(text); return p; }));
  const cost = yearlyCost(row, state?.myLiving ?? null);
  // A monthly range with whose estimate it is (Jakub's living_cost_* columns).
  const universityLiving = row.livingCostMin === null ? null : el('span');
  if (universityLiving) {
    universityLiving.append(t('month', { value1: moneyRange(row.livingCostMin, row.livingCostMax) }));
    if (row.livingCostSource) universityLiving.append(' · ', dataValue('living_cost_source', row.livingCostSource));
    if (livingIsFloor(row.livingCostSource)) universityLiving.append(' · ', floorLabel());
  }
  if (cost.personal) {
    // The student's own figure, said as theirs, with what it replaced.
    reqRow(list, t('living_costs'), [personalLiving(cost, universityLiving)]);
  } else if (universityLiving) {
    reqRow(list, t('living_costs'), [universityLiving]);
  }
  // Only with a living figure: without one there is no year to add up, and
  // the fee cell already says "Living cost not published".
  if (cost.monthlyMin !== null) reqRow(list, t('fee_12_months_living_estimate'), [yearlyText(row, cost)]);
  if (row.languages.length) reqRow(list, t('language'), [row.languages.map(facetLabel).join(', ')]);
  if (row.applicationSystem) reqRow(list, t('apply_via'), [dataValue('application_system', row.applicationSystem)]);
  if (list.childElementCount === 0) return null;

  const section = el('section', 'd-sec');
  section.append(el('h3', '', t('applying')), list);
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
  if (line.segments) {
    const node = el('span');
    line.segments.forEach((part, i) => {
      if (i) node.append(' · ');
      node.append(part.field ? dataValue(part.field, part.text) : part.text);
    });
    return node;
  }
  if (line.field) return dataValue(line.field, line.text);
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
      ? t('not_filtered_by_subject_area_one_of_its_subject_areas_is_not_on_the')
      : t('not_filtered_by_subject_area_its_subject_area_is_not_classified')));
  }
  if (state.maxTuition !== null && row.tuitionEu === null) {
    box.append(el('p', 'note', t('not_filtered_by_your_fee_limit_the_eu_fee_is_unknown')));
  }
  // Max yearly cost: why a row is shown that may not fit (budgetFit).
  const cost = yearlyCost(row, state.myLiving);
  const fit = budgetFit(cost, state.maxBudget);
  if (fit === 'unknown') {
    box.append(el('p', 'note', t('not_filtered_by_your_yearly_budget', { value1: UNKNOWN_REASON[cost.reason] })));
  } else if (fit === 'maybe') {
    box.append(el('p', 'note', cost.high > state.maxBudget
      ? t('may_exceed_your_budget_the_lowest_estimate_a_year_fits_the_highest_d', { value1: money.format(cost.low), value2: money.format(cost.high) })
      : t('may_exceed_your_budget_a_year_uses_a_national_minimum_for_living_cos', { value1: money.format(cost.low) })));
  }
  if (state.myMaths !== null && row.mathsAccepted === null) {
    box.append(el('p', 'note', t('not_filtered_by_your_maths_course_it_depends_on_your_other_subjects')));
  }
  if (state.exam !== null && row.entranceExam === null) {
    box.append(el('p', 'note', t('not_filtered_by_the_entrance_exam_choice_nobody_has_checked_whether')));
  }
  if (row.identity?.unresolved) {
    box.append(el('p', 'note', t('this_list_has_entries_named_at_this_is_entry_of_differences_beyond_t', { value1: row.identity.count, value2: row.programme, value3: row.university, value4: row.identity.entry, value5: row.identity.count })));
  }
  if (pointsSays) box.append(el('p', 'note pnote', pointsSays));
  if (!row.officialUrl) {
    box.append(el('p', 'note note-strong', t('no_official_admissions_link_do_not_rely_on_this_entry')));
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
    foot.append(externalLink('btn btn-p', t('official_admissions_page'), row.officialUrl,
      t('for', { value1: row.programme, value2: row.university, value3: identity ? ` · ${identity}` : '' })));
  }
  if (row.studentLifeUrl) {
    foot.append(externalLink('lnk', t('student_life'), row.studentLifeUrl));
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
    foot.append(el('span', 'tag tag-strong', t('invented_sample_row_not_real_data')));
  } else if (row.isChecked && row.lastVerified) {
    const ok = el('p', 'ok');
    let text = t('checked_2', { value1: longDate.format(row.lastVerified) });
    if (row.verifiedBy) text += t('by', { value1: row.verifiedBy });
    ok.append(icon('i-check', 'ic'), document.createTextNode(text));
    if (row.isStale) ok.append(document.createTextNode(' '), el('span', 'tag', t('may_be_out_of_date')));
    foot.append(ok);
  }

  return foot.childElementCount ? foot : null;
}

// Both links open a new tab, which a screen reader user is not told unless
// the link says so (A04). The visible text stays as it was.
function externalLink(className, label, href, hiddenName = '') {
  const link = el('a', className, label);
  link.append(el('span', 'visually-hidden', t('opens_in_a_new_tab', { value1: hiddenName })));
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
    el('span', 'visually-hidden', t('save_to_my_list', { value1: row.programme, value2: row.university })));
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
  if (words) words.textContent = saved ? t('saved_to_my_list') : t('save_to_my_list_2');
}

// The compare table: one column per programme, one row per fact
// (compareTable in compare.js). Row headers are real <th scope=row>, and each
// column is headed by the programme, so a screen reader names every cell.
export function renderCompare(container, rows, table, { onlyDifferences = false } = {}) {
  const facts = visibleFacts(table, onlyDifferences);
  const wrap = el('div', 'cmp-scroll');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', t('compare_table_scrolls_sideways'));
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
  if (hidden) out.push(el('p', 'help cmp-same', t('facts_hidden_count', { count: hidden })));
  container.replaceChildren(...out);
  return facts.length;
}

// ------------------------------------------------------------ filter chips

// One checkbox row per value, inside a filter drop-down's pick-list. (These were
// pill-shaped chips until the filters moved into a bar above the results.)
// flags maps a value to a sprite symbol (the Country list only). The flag is
// aria-hidden, so the option is still named by the country alone.
export function renderChips(container, values, selected, onToggle, { flags, field, counts, forceSearch = false } = {}) {
  const options = values.map((value) => {
    const label = el('label', 'option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected.has(value);
    input.addEventListener('change', () => onToggle(value, input.checked));
    label.append(input);
    if (flags?.[value]) label.append(icon(flags[value], 'flag'));
    label.append(field ? dataValue(field, value) : el('span', '', facetLabel(value)));
    if (counts) { const count = el('span', 'option-count', counts.get(value) ?? 0); count.setAttribute('aria-hidden', 'true'); label.append(count); }
    return label;
  });
  container.replaceChildren();
  if (forceSearch || values.length > 12) {
    const searchLabel = el('label', 'help opt-q');
    const search = el('input', 'inp');
    search.type = 'search';
    search.placeholder = t('search_options', { value1: container.parentElement.getAttribute('aria-label').toLowerCase() });
    search.setAttribute('aria-label', search.placeholder);
    const clear = el('button', 'btn btn-q opt-clear', t('clear_the_search'));
    clear.type = 'button';
    clear.hidden = true;
    const empty = el('p', 'help opt-none', t('no_matching_options_try_another_spelling_or_clear_the_search'));
    empty.hidden = true;
    searchLabel.append(search);
    const filter = () => {
      const query = foldAccents(search.value.trim()).toLowerCase();
      options.forEach((option, i) => { option.hidden = !foldAccents(`${values[i]} ${facetLabel(values[i])} ${field ? dataParts(field, values[i], 'sk').map((part) => part.text).join(' ') : ''}`).toLowerCase().includes(query); });
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
      button.replaceChildren(el('span', 'visually-hidden', t('remove')), el('span', '', label), cross);
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
    el('span', 'stat', `${formatCount(rows.length)} ${t('programme_count', { count: rows.length })} · ${formatCount(universities)} ${t('university_count', { count: universities })} · ${formatCount(countries)} ${t('country_count', { count: countries })}.`),
    ' ',
    el('span', '', t('r2_footer_data')),
  );
}

export function renderSourceBanner(node, meta) {
  node.replaceChildren();
  const parts = [];
  if (meta.source === 'snapshot') {
    const when = meta.snapshotDate ? longDate.format(meta.snapshotDate) : t('an_unknown_date');
    parts.push(t('could_not_load_the_latest_data_showing_a_saved_copy_from_requirement', { value1: when }));
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
      const link = el('a', '', t('view_data_problems'));
      link.href = '#issues';
      text.append(
        `${parts.length ? ' ' : ''}${t('data_problem_count', { count: problems })}. `,
        t('some_entries_may_be_missing_or_incomplete'), link,
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
      el('b', '', t('of', { value1: meta.sampleCount, value2: meta.total, value3: meta.total === 1 ? t('programme') : t('programmes'), value4: meta.sampleCount === 1 ? t('is_an_invented_sample_row') : t('are_invented_sample_rows') })),
      t('do_not_use_for_real_applications', { value1: meta.sampleCount === 1 ? t('it') : t('them') }),
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
  summary.textContent = t('data_problem_count', { count: issues.length });
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

// Rows and compare stay plain. Detail decoration adds the shared reveal.
export function dataValue(field, english) {
  const value = el('span', 'data-value');
  for (const part of dataParts(field, english)) {
    const display = field === 'baseline_requirement' ? part.text[0].toUpperCase() + part.text.slice(1) : part.text;
    const text = el('span', '', display);
    if (part.missing) { text.lang = 'en'; text.setAttribute('data-untranslated', ''); }
    if (part.en) text.setAttribute('data-english', part.en);
    value.append(text);
  }
  return value;
}

function detailOriginals(article, id, state) {
  if (getLanguage() !== 'sk') return;
  for (const section of article.querySelectorAll('.d-sec')) {
    if (section.querySelector('[data-untranslated]')) {
      section.append(el('p', 'english-note', t('untranslated_section')));
    }
  }
  const translated = article.querySelectorAll('[data-english]');
  if (!translated.length) return;
  state.englishOriginals ??= new Set();
  const button = el('button', 'detail-originals', t('show_english_original'));
  button.type = 'button';
  const originals = [...translated].map((text) => {
    const original = el('span', 'data-original', text.getAttribute('data-english'));
    original.lang = 'en';
    text.append(original);
    return original;
  });
  const sync = () => {
    // The label names the next action, so it carries no aria-pressed:
    // "Hide the English original, pressed" would contradict itself.
    const shown = state.englishOriginals.has(id);
    button.textContent = t(shown ? 'hide_english_original' : 'show_english_original');
    originals.forEach((original) => { original.hidden = !shown; });
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state.englishOriginals.has(id)) state.englishOriginals.delete(id);
    else state.englishOriginals.add(id);
    sync();
  });
  sync();
  // Under the title, never above it: at the top of the pane the button sat
  // beneath the × close (review round 2).
  const head = article.querySelector('.d-head');
  if (head) head.after(button); else article.insertBefore(button, article.firstChild);
}

function personalLiving(cost, universityLiving) {
  const node = el('span');
  if (universityLiving) {
    // Preserve the estimate's language markup while letting translators reorder it.
    const parts = t('your_month_replacing', { value1: money.format(cost.monthlyMin), value2: '\u0000' }).split('\u0000');
    node.append(parts[0], universityLiving, parts[1]);
  } else node.append(t('your_month', { value1: money.format(cost.monthlyMin) }), ' (', t('no_university_estimate'), ')');
  return node;
}
