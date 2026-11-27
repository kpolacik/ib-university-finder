// My subjects in My list (F01 Phase 2): the strip and its inline editor in
// the My list bar, the summary sentence, a status line on each saved row and
// a "Your subjects" block in the open detail. All of it is screen-only
// (.ms-private is hidden on paper) and drawn only in the My list view, own or
// shared, never in Browse or Compare. app.js creates this only when
// js/config.js has SHOW_MY_SUBJECTS on.
//
// The profile never changes which rows show, their order, grouping, counts,
// the filters, the address, a share link, CSV or Compare: those never see it.
// What it does change is redrawn here in place (private nodes only), so an
// open detail, its slot, the pane and the scroll stay where they were.
//
// The words for each result come from the checker (ib-subjects.js); the
// reviewed rule itself is only ever the one subject-authority.js says is
// current right now.

import { t, getLanguage } from './i18n.js';
import {
  IB_COURSES, LEVELS, MAX_ENTRIES, MATHS_FAMILY, STATUS, STATUS_KEYS, SUBJECTS_ONLY_KEY, PREDICTED_KEY,
  courseLabel, familyOf, normalizeProfile, evaluateSubjects, clauseParts, publicRuleView,
} from './ib-subjects.js';
import { reviewedRule } from './subject-authority.js';

const OTHER = 'other';
const ORDER = [STATUS.MEETS, STATUS.CONFLICT, STATUS.NEEDS, STATUS.NO_RESTRICTIONS, STATUS.NO_CHECK];
const VISIBLE_IN_STRIP = 4;
const ROUTE_KEYS = { met: 'ms_route_met', excluded: 'ms_route_excluded', open: 'ms_route_open', 'not-for-you': 'ms_route_not_for_you' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text) {
  const node = el('button', className, text);
  node.type = 'button';
  return node;
}
const entryLabel = (entry) => `${courseLabel(entry.course)} ${entry.level}`;
// The My maths filter's own wording ("AI SL") for a maths entry.
const mathsShort = (entry) => `${entry.course === 'maths-aa' ? 'AA' : 'AI'} ${entry.level}`;

// createSubjectsUI({ store, strip, notices, hooks })
//   store:   createProfileStore() from my-subjects.js
//   strip:   the empty #ml-subjects box in the My list bar
//   notices: the empty #ml-subject-notices box beside #ml-note
//   hooks:   what only app.js knows (see app.js, "My subjects").
export function createSubjectsUI({ store, strip, notices, hooks }) {
  let language = getLanguage();
  let editor = null;          // the open editor: { draft, rows, saved, ... }
  let wasList = false;
  let lastStatus = '';

  // ------------------------------------------------------------- the strip
  const line = el('p', 'ms-line');
  const label = el('b', 'ms-label');
  const names = el('span', 'ms-names');
  const more = el('span', 'ms-more');
  const edit = button('btn btn-q ms-edit');
  edit.setAttribute('aria-controls', 'ms-editor');
  edit.setAttribute('aria-expanded', 'false');
  line.append(label, document.createTextNode(' '), names, more, document.createTextNode(' '), edit);
  const summary = el('p', 'ms-summary');
  const warn = el('div', 'ms-warn');
  const status = el('p', 'ms-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const region = el('div', 'ms-editor');
  region.id = 'ms-editor';
  region.setAttribute('role', 'region');
  region.setAttribute('aria-labelledby', 'ms-editor-h');
  region.hidden = true;
  strip.append(line, summary, warn, status, region);
  edit.addEventListener('click', () => (editor ? cancel() : openEditor()));

  // Let an open dialog handle Escape first. Inside the editor or on its
  // trigger, capture before Escape reaches the selected programme.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !editor || document.querySelector('dialog[open]')) return;
    const focus = document.activeElement;
    const busy = store.snapshot().busy;
    if (focus !== edit && !region.contains(focus) && !(busy && focus === document.body)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }, true);

  // ---------------------------------------------------------- what we know
  const view = () => hooks.view();
  const inList = () => { const v = view(); return v.mode !== 'main' && !v.compareOpen; };
  const profile = () => store.snapshot().active;
  // The programmes this view holds (all saves, or all in the link), hidden by
  // a filter or not. A row just unsaved in place loses its private line.
  let members = { ids: null, set: new Set() };
  const member = (id) => {
    const ids = view().listIds;
    if (members.ids !== ids) members = { ids, set: new Set(ids) };
    return members.set.has(id);
  };

  function resultFor(id, entries) {
    const rule = reviewedRule(id);
    if (!rule) return { rule: null, result: null };
    return { rule, result: evaluateSubjects(rule, entries) };
  }

  function statusText(result) {
    let text = t(STATUS_KEYS[result.status]);
    if (result.status === STATUS.MEETS && result.predicted) text += ` (${t(PREDICTED_KEY)})`;
    return text;
  }

  // ------------------------------------------------------------- drawing

  // Everything in the bar, from the current profile, list and language.
  function drawStrip() {
    const v = view();
    const show = inList();
    strip.hidden = !show;
    notices.hidden = !show || !!editor;
    if (!show) { if (editor) closeEditor(false); return; }
    const snap = store.snapshot();
    const entries = snap.active?.entries ?? [];
    set(label, t('ms_label'));
    if (entries.length) {
      set(names, entries.slice(0, VISIBLE_IN_STRIP).map(entryLabel).join(' · '));
      const extra = entries.length - VISIBLE_IN_STRIP;
      more.hidden = extra <= 0;
      if (extra > 0) { set(more, ` ${t('ms_more', { count: extra })}`); more.setAttribute('aria-label', t('ms_more_label', { count: extra })); }
    } else {
      set(names, t(snap.observed === null ? 'ms_loading' : 'ms_not_added'));
      more.hidden = true;
    }
    set(edit, t(entries.length ? 'ms_edit' : 'ms_add'));
    const editLabel = t(entries.length ? 'ms_edit_label' : 'ms_add_label');
    if (edit.getAttribute('aria-label') !== editLabel) edit.setAttribute('aria-label', editLabel);
    edit.setAttribute('aria-expanded', String(!!editor));
    edit.disabled = snap.busy;
    set(summary, snap.busy ? t('ms_updating') : summaryText(v, entries));
    drawWarning(snap);
    drawNotices(v, entries);
    if (editor) syncEditor(snap);
  }

  function summaryText(v, entries) {
    const ids = v.listIds;
    const shared = v.mode === 'shared';
    const lead = shared ? `${t('ms_context_shared')}. ` : '';
    if (!ids.length) return t(shared ? 'ms_sum_empty_shared' : 'ms_sum_empty_mine');
    const denominator = t(shared ? 'ms_denominator_shared' : 'ms_denominator_mine');
    const reviewed = ids.filter((id) => reviewedRule(id)).length;
    if (!reviewed) return `${entries.length ? lead : ''}${t('ms_sum_zero')}`;
    if (!entries.length) return t('ms_sum_coverage', { reviewed, count: ids.length, denominator });
    const counts = new Map(ORDER.map((s) => [s, 0]));
    let predicted = 0;
    for (const id of ids) {
      const { result } = resultFor(id, entries);
      const s = result ? result.status : STATUS.NO_CHECK;
      counts.set(s, counts.get(s) + 1);
      if (s === STATUS.MEETS && result.predicted) predicted++;
    }
    const parts = ORDER.filter((s) => counts.get(s) > 0).map((s) => {
      let text = t(STATUS_KEYS[s]);
      if (s === STATUS.MEETS && predicted) text += predicted === counts.get(s) ? ` (${t(PREDICTED_KEY)})` : ` (${t('ms_pred_some', { count: predicted })})`;
      return `${text}: ${counts.get(s)}`;
    });
    return `${lead}${t('ms_sum_lead', { count: ids.length, denominator })} ${parts.join(' · ')}. ${t(SUBJECTS_ONLY_KEY)}.`;
  }

  function drawWarning(snap) {
    const key = `${snap.warning}|${snap.busy}|${language}`;
    if (warn.dataset.key === key) return;
    warn.dataset.key = key;
    warn.replaceChildren();
    warn.hidden = !snap.warning;
    if (!snap.warning) return;
    const words = {
      'write-failed': `${t('ms_write_failed')}. ${t('ms_write_failed_old')}`,
      'delete-failed': t('ms_delete_failed'),
      invalid: t('ms_w_invalid'),
      'read-failed': t('ms_w_read_failed'),
      'removed-elsewhere': t('ms_w_removed'),
      'changed-elsewhere': t('ms_w_changed'),
    }[snap.warning];
    warn.append(el('p', 'note', words));
    if (snap.warning === 'delete-failed') {
      const retry = button('btn btn-s ms-retry', t('ms_retry'));
      retry.disabled = snap.busy;
      retry.addEventListener('click', async () => { say(''); sayForget(await store.retryDelete()); });
      warn.append(retry);
    } else if (snap.warning === 'invalid' || snap.warning === 'read-failed') {
      const forget = button('btn btn-s ms-forget-stored', t('ms_forget'));
      forget.disabled = snap.busy;
      forget.addEventListener('click', forgetFromEditor);
      warn.append(forget);
    }
  }

  // The two legacy notices: they compare the profile with the My maths
  // filter and the HL Maths 4+ tick. Never changed by Save or Forget.
  function drawNotices(v, entries) {
    const maths = entries.find((e) => familyOf(e.course) === MATHS_FAMILY);
    const items = [];
    if (maths && v.myMaths && v.myMaths !== mathsShort(maths)) items.push({ key: 'mymaths', text: t('ms_n_mymaths', { filter: v.myMaths, maths: mathsShort(maths) }), link: t('ms_n_link_mymaths') });
    if (maths && v.hlMaths && (maths.level === 'SL' || (maths.grade !== null && maths.grade < 4))) {
      const mine = maths.grade !== null ? t('ms_entry_pred', { entry: mathsShort(maths), grade: maths.grade }) : mathsShort(maths);
      const filter = t('hl_maths_4');
      items.push({ key: 'hl', text: t('ms_n_hl', { filter, maths: mine }), link: t('ms_n_link_hl', { filter }) });
    }
    const key = JSON.stringify(items);
    if (notices.dataset.key === key) return;
    notices.dataset.key = key;
    notices.replaceChildren(...items.map((item) => {
      const p = el('p', 'note ms-notice');
      p.dataset.notice = item.key;
      const go = button('btn btn-q ms-notice-link', item.link);
      go.addEventListener('click', () => hooks.focusFilter(item.key));
      p.append(item.text, ' ', go);
      return p;
    }));
  }

  // ---------------------------------------------------- rows and details

  // A row's line: only with a profile and a current reviewed rule.
  function rowContent(id) {
    const entries = profile()?.entries;
    if (!entries?.length || !member(id)) return null;
    const { result } = resultFor(id, entries);
    if (!result) return null;
    return `${t('ms_row_lead')} ${statusText(result)} · ${t(SUBJECTS_ONLY_KEY)}`;
  }

  function fillRow(node) {
    const text = inList() ? rowContent(node.getAttribute('data-ms-row')) : null;
    const key = text ?? '';
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.textContent = key;
    node.hidden = !text;
  }

  function fillDetail(node, row) {
    const id = node.getAttribute('data-ms-detail');
    const entries = inList() && member(id) ? profile()?.entries : null;
    const rule = entries?.length ? reviewedRule(id) : null;
    const key = entries?.length ? `${language}|${view().mode}|${JSON.stringify(entries)}|${JSON.stringify(rule)}` : '';
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    node.replaceChildren();
    node.hidden = !key;
    if (!key) return;
    node.append(el('h4', 'ms-h', t('ms_detail_h')));
    if (view().mode === 'shared') node.append(el('p', 'ms-context', t('ms_context_shared')));
    const result = rule ? evaluateSubjects(rule, entries) : null;
    const relevant = rule ? relevantEntries(rule, entries) : entries;
    const said = relevant.map((e) => (e.grade === null ? entryLabel(e) : t('ms_entry_pred', { entry: entryLabel(e), grade: e.grade })));
    node.append(el('p', 'ms-entries', `${t('ms_entered')} ${said.length ? said.join(' · ') : t('ms_none_relevant')}`));
    if (!result) {
      node.append(el('p', 'ms-verdict', t(STATUS_KEYS[STATUS.NO_CHECK])));
      node.append(el('p', 'ms-help', t('ms_no_rule_help')));
      node.append(el('p', 'ms-rider', t(SUBJECTS_ONLY_KEY)));
      return;
    }
    const pub = publicRuleView(rule);
    if (pub.sample) node.append(el('p', 'note note-strong rv-sample', t('rv_sample')));
    const verdict = el('p', 'ms-verdict');
    verdict.append(el('strong', '', statusText(result)));
    node.append(verdict, el('p', 'ms-rider', t(SUBJECTS_ONLY_KEY)));
    const numbers = new Map(pub.sources.map((s) => [s.id, s.n]));
    if (result.routes.length) {
      const list = el('ul', 'ms-routes');
      result.routes.forEach((route, i) => {
        const item = el('li', 'ms-route');
        item.append(el('span', 'ms-route-h', t(ROUTE_KEYS[route.outcome], { n: i + 1 })));
        const clauses = el('ul', 'ms-clauses');
        for (const clause of route.clauses) {
          const li = el('li');
          for (const part of clauseParts(clause.clause)) {
            if (!part.lang) li.append(part.text); else { const span = el('span', '', part.text); span.lang = part.lang; li.append(span); }
          }
          li.append(`: ${reasonText(clause)}`);
          const cited = clause.clause.sources.map((s) => numbers.get(s)).filter(Boolean);
          if (cited.length) li.append(` ${t('ms_cite', { n: cited.join(', ') })}`);
          clauses.append(li);
        }
        item.append(clauses);
        list.append(item);
      });
      node.append(list);
    }
    if (result.next) node.append(el('p', 'ms-next', t('ms_next', { text: nextText(result.next, entries.length) })));
    node.append(el('p', 'ms-help', t('ms_see_above')));
  }

  function relevantEntries(rule, entries) {
    const courses = new Set();
    const add = (clause) => { if (clause.type === 'subject') for (const c of clause.courses) courses.add(c); };
    rule.routes.forEach((r) => r.clauses.forEach(add));
    rule.general.forEach(add);
    return entries.filter((e) => courses.has(e.course) || (familyOf(e.course) === MATHS_FAMILY && [...courses].some((c) => familyOf(c) === MATHS_FAMILY)));
  }

  function reasonText(result) {
    const r = result.reason ?? {};
    const course = r.course ? courseLabel(r.course) : '';
    if (result.state === 'met') {
      const text = t('ms_r_met', { entry: entryLabel(result.entry) });
      return result.predicted ? `${text} (${t(PREDICTED_KEY)})` : text;
    }
    const entries = profile()?.entries ?? [];
    const mine = entries.find((e) => e.course === r.course) ?? entries.find((e) => familyOf(e.course) === familyOf(r.course ?? ''));
    const entry = mine ? entryLabel(mine) : course;
    switch (r.kind) {
      case 'level-excluded': return t('ms_r_level_excluded', { level: r.level, entry });
      case 'course-excluded': return t('ms_r_course_excluded', { course, entry });
      case 'other-maths': return t('ms_r_other_maths', { entry });
      case 'level-unstated': return t('ms_r_level_unstated', { level: r.level, entry });
      case 'course-unstated': return t('ms_r_course_unstated', { course });
      case 'grade-missing': return t('ms_r_grade_missing', { min: r.min, course });
      case 'grade-below': return t('ms_r_grade_below', { min: r.min, grade: r.grade, course });
      case 'add': return t('ms_r_add', { course });
      case 'exam': return t('ms_r_exam');
      case 'waiver': return t('ms_r_waiver');
      default: return t('ms_r_manual');
    }
  }

  function nextText(next, count) {
    const course = next.course ? courseLabel(next.course) : '';
    switch (next.kind) {
      case 'add': return t(count >= MAX_ENTRIES ? 'ms_n_add_full' : 'ms_n_add', { course });
      case 'grade-missing': return t('ms_n_grade_missing', { course });
      case 'grade-below': return t('ms_n_grade_below', { course, min: next.min });
      case 'level-unstated': return t('ms_n_level_unstated', { level: next.level });
      case 'course-unstated': return t('ms_n_course_unstated', { course });
      case 'scope': return t('ms_n_scope');
      case 'partial': return t('ms_n_partial');
      case 'exam': return t('ms_n_exam');
      case 'waiver': return t('ms_n_waiver');
      case 'manual': return t('ms_n_manual');
      default: return t('ms_n_official');
    }
  }

  // render.js asks for these while it builds a row or a detail. Outside My
  // list they add nothing at all.
  const decor = {
    row(body, row) {
      if (!inList()) return;
      const node = el('p', 'ms-row ms-private');
      node.setAttribute('data-ms-row', row.id);
      node.hidden = true;
      body.append(node);
      fillRow(node);
    },
    detail(place, row) {
      if (!inList()) return;
      const node = el('div', 'ms-detail ms-private');
      node.setAttribute('data-ms-detail', row.id);
      node.hidden = true;
      place.append(node);
      fillDetail(node, row);
    },
  };

  // The profile, the rules, the list or the language changed: patch every
  // private node in place. Only changed text is written.
  function refresh() {
    if (getLanguage() !== language) { language = getLanguage(); if (editor) relabelEditor(); }
    drawStrip();
    for (const node of document.querySelectorAll('[data-ms-row]')) fillRow(node);
    for (const node of document.querySelectorAll('[data-ms-detail]')) fillDetail(node, hooks.rowById(node.getAttribute('data-ms-detail')));
  }

  // Called from app.js whenever the My list bar is drawn.
  function sync() {
    const now = inList();
    if (now && !wasList) store.activate();
    if (!now && wasList && !store.snapshot().busy) say('');
    wasList = now;
    refresh();
  }

  // ------------------------------------------------------------ the editor

  function openEditor() {
    if (editor || store.snapshot().busy) return;
    const draft = store.openDraft();
    const saved = { trigger: edit, x: window.scrollX, y: window.scrollY, ...hooks.snapshot() };
    editor = { draft, saved, rows: [], seq: 0 };
    buildEditor();
    const start = draft.entries.length ? draft.entries : [{ course: '', level: '', grade: null }];
    for (const entry of start) addRow(entry);
    region.hidden = false;
    notices.hidden = true;
    edit.setAttribute('aria-expanded', 'true');
    syncEditor(store.snapshot());
    region.scrollIntoView({ block: 'nearest' });
    editor.rows[0].course.focus({ preventScroll: true });
    hooks.layoutChanged();
  }

  function buildEditor() {
    const e = editor;
    e.heading = el('h3', 'ms-editor-h');
    e.heading.id = 'ms-editor-h';
    e.help = el('p', 'help');
    e.list = el('ol', 'ms-rows');
    e.emptyNote = el('p', 'help ms-empty');
    e.add = button('btn btn-s ms-add-row');
    e.add.addEventListener('click', () => { const row = addRow({ course: '', level: '', grade: null }); row.course.focus(); });
    e.rememberBox = el('input');
    e.rememberBox.type = 'checkbox';
    e.rememberBox.id = 'ms-remember';
    e.rememberBox.autocomplete = 'off';
    e.rememberBox.checked = e.draft.remember;
    e.rememberBox.setAttribute('aria-describedby', 'ms-remember-help');
    e.rememberText = el('span');
    const tick = el('label', 'tick ms-tick');
    tick.append(e.rememberBox, ' ', e.rememberText);
    e.rememberHelp = el('p', 'help ms-remember-help');
    e.rememberHelp.id = 'ms-remember-help';
    e.rememberBox.addEventListener('change', () => relabelEditor());
    e.formError = el('p', 'err ms-form-err');
    e.formError.id = 'ms-form-err';
    e.formError.setAttribute('aria-live', 'polite');
    e.save = button('btn btn-p ms-save');
    e.cancel = button('btn btn-s ms-cancel');
    e.forget = button('btn btn-q ms-forget');
    e.save.addEventListener('click', saveEditor);
    e.cancel.addEventListener('click', () => cancel());
    e.forget.addEventListener('click', forgetFromEditor);
    const actions = el('div', 'ms-actions');
    actions.append(e.save, e.cancel, e.forget);
    region.replaceChildren(e.heading, e.help, e.list, e.emptyNote, e.add, tick, e.rememberHelp, e.formError, actions);
    relabelEditor();
  }

  function option(value, text) {
    const node = el('option', '', text);
    node.value = value;
    return node;
  }

  function addRow(entry) {
    const e = editor;
    if (e.rows.length >= MAX_ENTRIES) return e.rows.at(-1);
    const n = ++e.seq;
    const row = { n, item: el('li', 'ms-erow') };
    const field = (cls, id) => {
      const box = el('div', `fld ${cls}`);
      const lab = el('label');
      lab.htmlFor = id;
      const select = el('select', 'inp');
      select.id = id;
      select.autocomplete = 'off';
      box.append(lab, select);
      return { box, lab, select };
    };
    const c = field('ms-f-course', `ms-c-${n}`);
    const l = field('ms-f-level', `ms-l-${n}`);
    const g = field('ms-f-grade', `ms-g-${n}`);
    row.course = c.select; row.courseLabel = c.lab;
    row.level = l.select; row.levelLabel = l.lab;
    row.grade = g.select; row.gradeLabel = g.lab;
    row.remove = button('btn btn-q ms-remove');
    row.error = el('p', 'err ms-row-err');
    row.error.id = `ms-e-${n}`;
    for (const select of [row.course, row.level, row.grade]) select.setAttribute('aria-describedby', row.error.id);
    row.remove.addEventListener('click', () => removeRow(row));
    row.item.append(c.box, l.box, g.box, row.remove, row.error);
    e.rows.push(row);
    e.list.append(row.item);
    fillOptions(row);
    row.course.value = entry.course && (IB_COURSES.some((x) => x.id === entry.course)) ? entry.course : '';
    row.level.value = entry.level || '';
    row.grade.value = entry.grade === null || entry.grade === undefined ? '' : String(entry.grade);
    relabelEditor();
    return row;
  }

  function removeRow(row) {
    const e = editor;
    const at = e.rows.indexOf(row);
    e.rows.splice(at, 1);
    row.item.remove();
    relabelEditor();
    // Focus stays in the editor: the next row's subject, the previous one, or
    // Add another subject when none is left.
    const next = e.rows[at] ?? e.rows[at - 1];
    (next ? next.course : e.add).focus();
  }

  // Option lists and every label, in the current language. Values and the
  // student's choices are kept: a language switch never loses a draft.
  function fillOptions(row) {
    const keep = { course: row.course.value, level: row.level.value, grade: row.grade.value };
    row.course.replaceChildren(option('', t('ms_choose')));
    for (const group of [1, 2, 3, 4, 5, 6]) {
      const box = el('optgroup');
      box.label = t('ms_group', { n: group });
      for (const course of IB_COURSES.filter((c) => c.group === group)) box.append(option(course.id, courseLabel(course.id)));
      row.course.append(box);
    }
    row.course.append(option(OTHER, t('ms_other')));
    row.level.replaceChildren(option('', t('ms_level_choose')), ...LEVELS.map((l) => option(l, l)));
    row.grade.replaceChildren(option('', t('ms_no_grade')), ...[1, 2, 3, 4, 5, 6, 7].map((g) => option(String(g), String(g))));
    row.course.value = keep.course; row.level.value = keep.level; row.grade.value = keep.grade;
  }

  function relabelEditor() {
    const e = editor;
    if (!e) return;
    set(e.heading, t('ms_editor_h'));
    set(e.help, t('ms_editor_help'));
    e.rows.forEach((row, i) => {
      if (row.lang !== language) { fillOptions(row); row.lang = language; }
      set(row.courseLabel, t('ms_subject_n', { n: i + 1 }));
      set(row.levelLabel, t('ms_level'));
      set(row.gradeLabel, t('ms_grade'));
      set(row.remove, t('ms_remove'));
      row.remove.setAttribute('aria-label', t('ms_remove_label', { n: i + 1 }));
      if (row.code) set(row.error, errorText(row.code));
    });
    set(e.emptyNote, t('ms_rows_empty'));
    e.emptyNote.hidden = e.rows.length > 0;
    set(e.add, t('ms_add_row'));
    e.add.hidden = e.rows.length >= MAX_ENTRIES;
    set(e.rememberText, t('ms_remember'));
    set(e.rememberHelp, t(e.rememberBox.checked ? 'ms_remember_warn' : 'ms_page_only'));
    set(e.save, t('ms_save'));
    set(e.cancel, t('ms_cancel'));
    set(e.forget, t('ms_forget'));
    if (e.formCode) set(e.formError, formText(e.formCode));
  }

  function syncEditor(snap) {
    const e = editor;
    region.setAttribute('aria-busy', String(snap.busy));
    for (const node of [e.save, e.cancel, e.forget, e.add, e.rememberBox]) node.disabled = snap.busy;
    for (const row of e.rows) for (const node of [row.course, row.level, row.grade, row.remove]) node.disabled = snap.busy;
    // Forget is offered whenever there is something to forget.
    e.forget.hidden = !(snap.active || snap.deleteFailed || snap.writeFailed || snap.warning === 'invalid' || snap.warning === 'read-failed' || snap.observed === 'remembered');
    if (e.formCode === 'empty') set(e.formError, formText(e.formCode));
  }

  const ROW_ERRORS = {
    incomplete: 'ms_e_incomplete', grade: 'ms_e_grade', unsupported: 'ms_e_unsupported', level: 'ms_e_level',
    duplicate: 'ms_e_duplicate', 'duplicate-maths': 'ms_e_duplicate_maths', invalid: 'ms_e_invalid',
  };
  function errorText(code) { return t(ROW_ERRORS[code] ?? 'ms_e_invalid'); }
  function formText(code) {
    return t({
      rows: 'ms_e_summary', empty: editor && !editor.forget.hidden ? 'ms_e_empty_forget' : 'ms_e_empty', 'too-many': 'ms_e_too_many',
      stale: 'ms_stale', invalid: 'ms_refused_invalid', error: 'ms_refused_error', pending: 'ms_refused_pending',
    }[code] ?? 'ms_e_summary');
  }

  function readRows() {
    return editor.rows.map((row) => ({ course: row.course.value, level: row.level.value, grade: row.grade.value }));
  }

  function showErrors(check) {
    const e = editor;
    for (const row of e.rows) { row.code = null; set(row.error, ''); for (const s of [row.course, row.level, row.grade]) s.removeAttribute('aria-invalid'); }
    let first = null;
    for (const error of check.errors) {
      const row = e.rows[error.index];
      if (!row || error.code === 'empty' || error.code === 'too-many') continue;
      row.code = error.code === 'duplicate' && familyOf(row.course.value) === MATHS_FAMILY ? 'duplicate-maths' : error.code;
      set(row.error, errorText(row.code));
      const bad = ['grade'].includes(error.code) ? row.grade : error.code === 'level' || (error.code === 'incomplete' && row.course.value) ? row.level : row.course;
      bad.setAttribute('aria-invalid', 'true');
      first ??= bad;
    }
    const formCode = check.errors.some((x) => x.code === 'empty') ? 'empty' : check.errors.some((x) => x.code === 'too-many') ? 'too-many' : 'rows';
    e.formCode = formCode;
    set(e.formError, formText(formCode));
    (first ?? (formCode === 'empty' && !e.forget.hidden ? e.forget : e.add)).focus();
  }

  async function saveEditor() {
    const e = editor;
    if (!e || store.snapshot().busy) return;
    const check = normalizeProfile(readRows());
    if (!check.ok) { showErrors(check); return; }
    showErrors({ errors: [] });
    e.formCode = null; set(e.formError, '');
    const remember = e.rememberBox.checked;
    say('');
    const outcome = await store.save(e.draft, check.entries, remember);
    if (outcome.result === 'stale' || outcome.result === 'refused') {
      const code = outcome.result === 'stale' ? 'stale' : outcome.base;
      if (editor === e) {
        e.formCode = code;
        set(e.formError, formText(code));
        e.save.focus();
      } else say(formText(code));
      return;
    }
    if (outcome.result === 'busy') return;
    const words = {
      page: t('ms_saved_page'), 'page-removed': t('ms_saved_page_removed'),
      'page-kept': `${t('ms_saved_page')}. ${t('ms_delete_failed')}`,
      remembered: t('ms_saved_browser'),
      'write-failed': `${t('ms_write_failed')}. ${t('ms_write_failed_old')}`,
    }[outcome.result];
    // The status line first, so the page has its final height before the
    // scroll is put back.
    say(words);
    if (editor === e) closeEditor(true);
    refresh();
  }

  async function forgetFromEditor() {
    if (store.snapshot().busy) return;
    const e = editor;
    say('');
    const outcome = await store.forget();
    sayForget(outcome);
    if (e && editor === e) closeEditor(true);
    refresh();
  }

  function sayForget(outcome) {
    if (outcome.result === 'forgotten') say(t(profile() ? 'ms_saved_page_removed' : 'ms_forgotten'));
    else if (outcome.result === 'delete-failed') say(t('ms_delete_failed'));
  }

  function cancel() {
    if (!editor || store.snapshot().busy) return;
    closeEditor(true);
    refresh();
  }

  // restore: Save, Cancel and Escape go back to where the editor was opened
  // from: the same scroll, pane position and open programme, and focus on
  // Edit if it is still on screen there, else on that programme.
  function closeEditor(restore) {
    const e = editor;
    editor = null;
    store.closeDraft(e.draft);
    region.hidden = true;
    region.replaceChildren();
    edit.setAttribute('aria-expanded', 'false');
    hooks.layoutChanged();
    if (!restore) return;
    notices.hidden = !inList();
    window.scrollTo(e.saved.x, e.saved.y);
    hooks.restore(e.saved);
    if (onScreen(edit)) edit.focus({ preventScroll: true });
    else if (!hooks.focusProgramme(e.saved)) { edit.scrollIntoView({ block: 'nearest' }); edit.focus({ preventScroll: true }); }
  }

  // Written at once, so the bar never changes height under a restored
  // scroll. The same words twice get an invisible mark, so they are read again.
  function say(text) {
    const words = text && lastStatus === text ? `${text}\u200b` : text;
    if (text) lastStatus = words;
    status.hidden = !text;
    status.textContent = words;
  }

  return { sync, refresh, decor, isEditing: () => !!editor };
}

function set(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

// Fully visible and not covered (the phone's sticky count line can cover
// the top of the page).
export function onScreen(node) {
  if (!node || node.hidden || !node.getClientRects().length) return false;
  const r = node.getBoundingClientRect();
  if (r.top < 0 || r.bottom > document.documentElement.clientHeight) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === node || node.contains(hit));
}
