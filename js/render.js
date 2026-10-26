// Everything that touches the DOM.
//
// Values are written with textContent, never innerHTML: the data comes from a
// spreadsheet that any student can edit, and a pasted <script> tag should show
// up as text rather than run.


const money = new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});
// The top of a range: "€900–1,200", not "€900–€1,200".
const plain = new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 });

const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

export function renderCards(container, rows, options) {
  container.replaceChildren(...rows.map((row) => card(row, options)));
}

function card(row, { state, shortlist, onToggleStar }) {
  const article = el('article', 'card');
  // The panel tint is driven by the country, so the colour carries information
  // rather than decorating. styles.css has a tint pair per country; a country
  // with no pair falls back to the neutral panel, so adding one is a CSS-only
  // change. The class sits on the card itself, which is the content-visibility
  // containment root, so it restyles reliably — a class on a descendant would
  // not.
  if (row.country) {
    article.classList.add(`c-${row.country.toLowerCase().replace(/[^a-z]+/g, '-')}`);
  }
  if (row.deadlinePassed) article.classList.add('is-past');

  // --- heading -----------------------------------------------------------
  const head = el('div', 'card-head');

  const titles = el('div', 'card-titles');
  const title = el('h2', 'card-title');
  title.textContent = row.programme;
  if (row.degreeType) title.append(el('span', 'degree', row.degreeType));
  titles.append(title);
  titles.append(el('p', 'card-uni', row.university));
  titles.append(el('p', 'card-place', [row.city, row.country].filter(Boolean).join(', ')));
  head.append(titles);
  // No save button. It was removed on 2026-10-24 at Jakub's request, and the
  // shortlist it fed went with it; see the note in app.js.

  article.append(head);

  article.append(requirements(row));

  // --- facts -------------------------------------------------------------
  const facts = el('dl', 'facts');

  const deadlineValue = el('dd', deadlineClass(row));
  deadlineValue.textContent = row.deadline ? longDate.format(row.deadline) : 'Not published';
  if (row.isUrgent) deadlineValue.append(el('span', 'badge-urgent', countdown(row.daysUntilDeadline)));
  if (row.deadlinePassed) deadlineValue.append(el('span', 'badge-past', 'passed'));
  facts.append(el('dt', '', 'Deadline'), deadlineValue);

  if (row.deadlinePassed) {
    fact(facts, '', 'Check the official page for the next cycle.', 'sub');
  }
  if (row.deadlineNotes) fact(facts, '', row.deadlineNotes, 'sub');

  const tuition = row.tuitionEu === null
    ? 'Not published'
    : (row.tuitionEu === 0 ? 'No tuition fee' : `${money.format(row.tuitionEu)} / year`);
  fact(facts, 'Tuition (EU)', tuition, row.tuitionEu === null ? 'unknown' : '');

  if (row.livingCostMin !== null) {
    const range = row.livingCostMax > row.livingCostMin
      ? `${money.format(row.livingCostMin)}–${plain.format(row.livingCostMax)}`
      : money.format(row.livingCostMin);
    const value = el('dd', '', `${range} / month`);
    if (row.livingCostSource) value.append(el('span', 'fact-source', ` · ${row.livingCostSource}`));
    facts.append(el('dt', '', 'Living costs'), value);
  }
  if (row.languages.length) fact(facts, 'Taught in', row.languages.join(', '));
  if (row.applicationSystem) fact(facts, 'Apply via', row.applicationSystem);

  article.append(facts);

  // --- why a row survived a filter it looks like it should have failed ---
  if (state.maxTuition !== null && row.tuitionEu === null) {
    article.append(el('p', 'note', 'Shown despite the tuition filter — we do not have a fee for this one.'));
  }
  if (state.myIbPoints !== null && row.ibPointsMin === null) {
    article.append(el('p', 'note', 'Shown despite the points filter — no published minimum.'));
  }

  // --- provenance, on every card, never hidden --------------------------
  article.append(provenance(row));
  return article;
}

// The block this whole site exists for. Four kinds of requirement, each on its
// own row, and a row only appears when there is something to say.
function requirements(row) {
  const block = el('div', 'ib-block');
  block.append(el('p', 'ib-label', 'Requirements'));

  const nothingAtAll = row.ibPointsMin === null &&
                       row.noSubjectsRequired &&
                       row.otherRequirements.length === 0 &&
                       row.englishRequirement.length === 0 &&
                       row.admission.length === 0;

  if (nothingAtAll) {
    // The baseline differs by country, so it comes from the universities tab.
    // Falling back to a country-neutral sentence keeps this honest the day a
    // non-Dutch university is added.
    const baseline = row.baselineRequirement || 'a qualifying secondary school diploma';
    block.append(el('p', 'req-none', `No requirements beyond ${baseline}`));
    return block;
  }

  const list = el('dl', 'req');

  // --- admission ---------------------------------------------------------
  // First, because it frames the rest: a points figure means something
  // different under open entry, a CAO ranking and a Czech entrance exam.
  if (row.admission.length) {
    reqRow(list, 'Admission', row.admission.map((t) => el('span', 'req-admission', t)));
  }

  // --- points ------------------------------------------------------------
  if (row.ibPointsMin === null) {
    // Worth stating rather than omitting: "there is no points threshold" is
    // news to an IB student who assumes every university has one.
    reqRow(list, 'Points', [el('span', 'req-quiet', 'No minimum published')]);
  } else {
    const value = el('span', 'req-points');
    value.append(el('span', 'req-number', String(row.ibPointsMin)));
    value.append(el('span', 'req-unit', 'IB points'));
    reqRow(list, 'Points', [value]);
  }

  // --- subjects ----------------------------------------------------------
  if (row.noSubjectsRequired) {
    reqRow(list, 'Subjects', [el('span', 'req-quiet', 'None required')]);
  } else if (row.ibSubjects) {
    reqRow(list, 'Subjects', [document.createTextNode(row.ibSubjects)]);
  } else {
    reqRow(list, 'Subjects', [el('span', 'req-unknown', 'Not checked yet')]);
  }

  // --- other -------------------------------------------------------------
  if (row.otherRequirements.length) {
    reqRow(list, 'Other', row.otherRequirements.map((t) => el('span', 'req-tag', t)));
  }

  // --- language ----------------------------------------------------------
  if (row.englishRequirement.length) {
    reqRow(list, 'Language', row.englishRequirement.map((t) => el('span', 'req-lang', t)));
  }

  block.append(list);
  return block;
}

function reqRow(dl, label, nodes) {
  dl.append(el('dt', 'req-label', label));
  const dd = el('dd', 'req-value');
  dd.append(...nodes);
  dl.append(dd);
}

function provenance(row) {
  const foot = el('div', 'card-foot');

  // Every card used to end "Gathered <date> · nobody has checked this yet".
  // Removed 2026-10-24 at Jakub's request: the banner at the top of the page
  // already says it once for the whole dataset, and repeated on 757 cards it was
  // noise. A line now appears only when there is something specific to say —
  // a row a person has actually signed off, or an invented sample row.
  //
  // One chain, so the text and its badge are chosen together.
  if (row.isSample) {
    const verified = el('p', 'verified', 'Invented sample row');
    verified.append(el('span', 'badge-danger', 'not real data'));
    foot.append(verified);
  } else if (!row.needsHumanCheck && row.lastVerified) {
    const verified = el('p', 'verified', `Checked ${longDate.format(row.lastVerified)}`);
    if (row.verifiedBy) verified.textContent += ` by ${row.verifiedBy}`;
    if (row.isStale) verified.append(el('span', 'badge-stale', 'may be out of date'));
    foot.append(verified);
  }

  // data.js already ran these through safeUrl and stored null or a normalised
  // href, so there is nothing left to validate here.
  if (row.officialUrl) {
    foot.append(externalLink('official-link', 'Official admissions page', row.officialUrl));
  } else {
    foot.append(el('p', 'note', 'No official link on file — do not rely on this entry.'));
  }
  if (row.studentLifeUrl) {
    foot.append(externalLink('life-link', 'Student life', row.studentLifeUrl));
  }

  return foot;
}

function externalLink(className, label, href) {
  const link = el('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // The icon says "this leaves the site" without spending a word on it.
  link.append(icon('i-external'));
  return link;
}

// Icons come from the sprite in index.html, referenced rather than inlined so
// the same path is not repeated 757 times in the DOM.
function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function deadlineClass(row) {
  if (row.deadlinePassed) return 'past';
  if (row.isUrgent) return 'urgent';
  if (!row.deadline) return 'unknown';
  return '';
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

export function renderSourceBanner(node, meta) {
  const parts = [];

  if (meta.source === 'snapshot') {
    const when = meta.snapshotDate ? longDate.format(meta.snapshotDate) : 'an unknown date';
    parts.push(`Live data is unavailable, so this is a saved copy from ${when}. Deadlines may have moved since.`);
  }

  // Shown while any row is still unverified. Worded as what the site is for
  // rather than how the data was made — Jakub's call, 2026-10-24.
  if (meta.draftCount > 0) {
    parts.push(
      'This site is a starting point for research, not a source of truth. Always check ' +
      'requirements, fees and deadlines on the university’s official page before you apply.'
    );
  }

  if (meta.sampleCount > 0) {
    const all = meta.sampleCount === meta.total;
    parts.push(
      `${all ? 'Every figure on this page is made up' : `${meta.sampleCount} of ${meta.total} entries are made-up sample rows`}. ` +
      `Do not use ${all ? 'it' : 'them'} for real applications.`
    );
  }

  if (parts.length === 0) {
    node.hidden = true;
    return;
  }

  // Invented data is the louder problem, so it sets the tone when both apply.
  node.className = `banner banner-${meta.sampleCount > 0 ? 'danger' : 'warn'}`;
  node.textContent = parts.join(' ');
  node.hidden = false;
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

function fact(dl, term, value, className) {
  dl.append(el('dt', '', term), el('dd', className, value));
}
