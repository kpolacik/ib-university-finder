// Everything that touches the DOM.
//
// Values are written with textContent, never innerHTML: the data comes from a
// spreadsheet that any student can edit, and a pasted <script> tag should show
// up as text rather than run.

import { pointsLines } from './points.js';
import { pointsNote } from './filters.js';

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});

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
  // The card is named by its title, so a screen reader's list of articles reads
  // as a list of programmes (A05). programme_id never changes, so neither does
  // the id; the prefix keeps it from colliding with the page's own ids.
  title.id = `p-${row.id}`;
  article.setAttribute('aria-labelledby', title.id);
  title.append(document.createTextNode(row.programme));
  // Czech-taught programmes have Czech titles; without lang a screen reader
  // reads "Architektura a urbanismus" with English pronunciation (A05).
  if (row.languages.length === 1 && row.languages[0] === 'Czech') title.lang = 'cs';
  if (row.degreeType) {
    // Hidden ", " so it is not read as "Architektura a urbanismusBc." (A05).
    // The degree keeps the page's language even inside a Czech title.
    const degree = el('span', 'degree', row.degreeType);
    if (title.lang) degree.lang = 'en';
    title.append(el('span', 'visually-hidden', ', '), degree);
  }
  titles.append(title);
  titles.append(el('p', 'card-uni', row.university));
  // A "?" city is unknown, not irrelevant, so it is said rather than dropped.
  const city = row.cityUnknown ? 'City not published' : row.city;
  titles.append(el('p', 'card-place', [city, row.country].filter(Boolean).join(', ')));
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

  if (row.livingCostMonthly !== null) {
    fact(facts, 'Living costs', `${money.format(row.livingCostMonthly)} / month`);
  }
  if (row.languages.length) fact(facts, 'Taught in', row.languages.join(', '));
  if (row.applicationSystem) fact(facts, 'Apply via', row.applicationSystem);

  article.append(facts);

  // --- why a row survived a filter it looks like it should have failed ---
  if (state.maxTuition !== null && row.tuitionEu === null) {
    article.append(el('p', 'note', 'Shown despite the tuition filter — we do not have a fee for this one.'));
  }
  // My points: why an unknown row is shown, and when a cutoff is reached only
  // with HL Maths 4+ or only on Round 2 (pointsNote in filters.js).
  const pointsSays = pointsNote(row, state);
  if (pointsSays) article.append(el('p', 'note', pointsSays));

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
                       !row.englishUnknown &&
                       row.admission.length === 0 &&
                       !row.admissionUnknown;

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
  } else if (row.admissionUnknown) {
    // A "?" route is not "no route": it exists and differs from the default,
    // but is unpublished. Same style as the Subjects row's "Not checked yet".
    reqRow(list, 'Admission', [el('span', 'req-unknown', 'Not published')]);
  }

  // --- points ------------------------------------------------------------
  // What the row says comes from pointsLines (js/points.js), shared with the
  // CSV export. Each line is its own .req-points, so a two-round cutoff reads
  // as two lines. The comma sits in the unit span and the qualifier gets its
  // own span: .req-points is flex with a gap, so a bare text node would put a
  // gap before the comma.
  reqRow(list, 'Points', pointsLines(row).map((line) => {
    const value = el('span', 'req-points');
    if (line.number === null) {
      value.append(el('span', 'req-quiet', line.qualifier));
    } else {
      value.append(el('span', 'req-number', line.number));
      value.append(el('span', 'req-unit', `${line.unit},`));
      value.append(el('span', 'req-quiet', line.qualifier));
    }
    return value;
  }));

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
  // Always shown. Leaving the row out made 608 cards look as if there were no
  // language requirement, when nobody had looked (R01). "?" means it differs
  // from the university's and is unpublished, as on the Admission row.
  if (row.englishRequirement.length) {
    reqRow(list, 'Language', row.englishRequirement.map((t) => el('span', 'req-lang', t)));
  } else if (row.englishUnknown) {
    reqRow(list, 'Language', [el('span', 'req-unknown', 'Not published')]);
  } else {
    reqRow(list, 'Language', [el('span', 'req-unknown', 'Not checked yet')]);
  }

  // --- general -----------------------------------------------------------
  // What every applicant's diploma must clear, from the universities tab. It
  // used to appear only inside nothingAtAll, which no real row reaches, so 29
  // universities' baselines were never shown (R03). The stored text starts
  // lowercase because it also completes "No requirements beyond …". A blank
  // baseline shows nothing: six Irish ones are blank on purpose (STATUS).
  if (row.baselineRequirement) {
    const general = row.baselineRequirement;
    reqRow(list, 'General', [document.createTextNode(general[0].toUpperCase() + general.slice(1))]);
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
  } else if (row.isChecked && row.lastVerified) {
    const verified = el('p', 'verified', `Checked ${longDate.format(row.lastVerified)}`);
    if (row.verifiedBy) verified.textContent += ` by ${row.verifiedBy}`;
    if (row.isStale) verified.append(el('span', 'badge-stale', 'may be out of date'));
    foot.append(verified);
  }

  // data.js already ran these through safeUrl and stored null or a normalised
  // href, so there is nothing left to validate here.
  if (row.officialUrl) {
    // 1240 links all named "Official admissions page" are useless in a screen
    // reader's links list, so a hidden part says whose page it is (A04).
    foot.append(externalLink('official-link', 'Official admissions page', row.officialUrl,
      ` for ${row.programme}, ${row.university}`));
  } else {
    foot.append(el('p', 'note', 'No official link on file — do not rely on this entry.'));
  }
  if (row.studentLifeUrl) {
    foot.append(externalLink('life-link', 'Student life', row.studentLifeUrl));
  }

  return foot;
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

function fact(dl, term, value, className) {
  dl.append(el('dt', '', term), el('dd', className, value));
}
