// The guards behind tools/reword-prose.mjs, kept here so check.mjs can test
// them directly. A reword changes how a note is said, never what it says, so
// two things are compared between the old and the new cell:
//
// - Frozen text: sentences that code reads back out of the prose. Changing a
//   letter of one silently breaks a card (the CAO points, "needs HL Maths 4+",
//   the pounds-to-euros note) or a refresh (update-cao-points.mjs finds its
//   old sentences by OLD_CAO_SENTENCES and would leave a reworded one beside
//   the fresh one). They must come through byte for byte, and a reword must
//   not invent one either.
// - Condition tokens: numbers, dates, times, amounts, percentages, links,
//   course codes, grade strings and capitalised names of tests and systems.
//   They are read in a canonical form, so "2027-01-13" equals "13 January
//   2027" and "£10,050" equals "GBP 10,050", and then compared as sets: a
//   figure repeated in a removed quote can go, a figure that disappears
//   altogether has to be named in `drops` and approved by the reviewer, and a
//   figure that appears from nowhere is new evidence, not wording.
//
// Scope words ("EU/EEA applicants only", "for this programme only") are not
// tokens unless written in capitals. The independent reviewer checks them.
import { OLD_CAO_SENTENCES } from './cao-points.mjs';
import { CAO_TEST } from '../../js/data.js';

// js/cost.js poundNote reads this clause; no full stop may sit inside the date.
export const ECB_SENTENCE = /in euros at the ECB rate of [^.]+\./;
// tools/check.mjs reads this sentence on every UvA row that mentions housing.
export const UVA_HOUSING = /Want UvA housing\? Apply by \d{1,2} [A-Za-z]+ \d{4} instead\./;
export const FROZEN_SENTENCES = [...OLD_CAO_SENTENCES, ECB_SENTENCE, UVA_HOUSING];

// Every frozen sentence in a cell, sorted, so the old and new lists can be
// compared as they are. In other_requirements the CAO test tag and the HPAT
// item are whole list items the code looks up, so they stay whole items.
export function frozenParts(column, text) {
  const out = [];
  for (const re of FROZEN_SENTENCES) {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) out.push(m[0]);
  }
  if (column === 'other_requirements') {
    for (const item of text.split(' · ')) if (item === CAO_TEST || /HPAT/.test(item)) out.push(`item: ${item}`);
  }
  return out.sort();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };
// Full names first, so "September" is not read as "Sep" plus "tember".
const MONTH = `(${MONTHS.join('|')}|Sept|${Object.keys(SHORT).filter((m) => m !== 'Sept').join('|')})\\.?(?![a-z])`;
const month = (name) => String(MONTHS.indexOf(name) + 1 || SHORT[name]).padStart(2, '0');
const two = (n) => String(n).padStart(2, '0');
const ORD = '(?:st|nd|rd|th)?';
const NUM = '\\d{1,3}(?:[,\\u00a0\\u202f]\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
const number = (s) => s.replace(/[,  ]/g, '').replace(/\.0+$/, '');
const CODES = 'GBP|EUR|CZK|DKK|SEK|NOK|CHF|USD|PLN|HUF';
const CURRENCY = { '£': 'GBP', '€': 'EUR', $: 'USD', euro: 'EUR', euros: 'EUR', pound: 'GBP', pounds: 'GBP', 'Kč': 'CZK' };
const currency = (c) => CURRENCY[c] || c;
// Names of tests with lower-case letters, which the capitals rule below misses.
const MIXED_NAMES = ['CEnT-S', 'Duolingo', 'Cambridge', 'LanguageCert'];
// Capitalised words that are emphasis in a quoted page, not a condition.
const EMPHASIS = new Set(['PLEASE', 'NOTE', 'NB']);

// The canonical condition tokens of a cell, as a sorted array without repeats.
// Each rule blanks what it read, so a later rule never reads the same digits
// again (the 13 of a date is not also the number 13).
export function conditionTokens(input) {
  let text = String(input ?? '');
  const tokens = new Set();
  const take = (re, read) => {
    text = text.replace(re, (...m) => {
      const got = read(m);
      if (got === null) return m[0];
      for (const t of [got].flat()) tokens.add(t);
      return ' '.repeat(m[0].length);
    });
  };
  const date = (y, m, d) => (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31 ? `date:${y}-${m}-${two(d)}` : null);

  take(/\bhttps?:\/\/\S+|\bwww\.\S+/g, ([u]) => `url:${u.replace(/[.,;:)\]"'”’]+$/, '')}`);
  for (const name of MIXED_NAMES) take(new RegExp(`(?<![\\w-])${name.replace('-', '\\-')}(?![\\w-])`, 'g'), () => `name:${name}`);
  // 7–21 January 2027 is two dates.
  take(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s*[-–—]\\s*(\\d{1,2})${ORD}\\s+${MONTH},?\\s+(\\d{4})(?!\\d)`, 'g'),
    ([, a, b, m, y]) => [date(y, month(m), a), date(y, month(m), b)].filter(Boolean));
  take(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, ([, y, m, d]) => date(y, m, d));
  take(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH},?\\s+(\\d{4})(?!\\d)`, 'g'), ([, d, m, y]) => date(y, month(m), d));
  take(new RegExp(`${MONTH}\\s+(\\d{1,2})${ORD},?\\s+(\\d{4})(?!\\d)`, 'g'), ([, m, d, y]) => date(y, month(m), d));
  // Without a year a date stays a day and month: "13 January" is not 2027.
  take(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s*[-–—]\\s*(\\d{1,2})${ORD}\\s+${MONTH}`, 'g'),
    ([, a, b, m]) => [`day:${month(m)}-${two(a)}`, `day:${month(m)}-${two(b)}`]);
  take(new RegExp(`(?<!\\d)(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}`, 'g'), ([, d, m]) => `day:${month(m)}-${two(d)}`);
  take(new RegExp(`${MONTH},?\\s+(\\d{4})(?!\\d)`, 'g'), ([, m, y]) => `month:${y}-${month(m)}`);
  take(new RegExp(`${MONTH}\\s+(\\d{1,2})(?!\\d)`, 'g'), ([, m, d]) => `day:${month(m)}-${two(d)}`);
  take(new RegExp(`(?<![A-Za-z])${MONTH}`, 'g'), ([, m]) => `month:${month(m)}`);
  // 6pm, 6:00 p.m., 18:00, noon. Midnight stays its own word: 23:59 and 00:00
  // are different promises.
  take(/(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/gi, ([, h, mm = '00', ap]) => {
    const pm = ap[0].toLowerCase() === 'p';
    const hour = (+h % 12) + (pm ? 12 : 0);
    return +h > 12 ? null : `time:${two(hour)}:${mm}`;
  });
  take(/(?<![\d.:])([01]?\d|2[0-4]):([0-5]\d)(?![\d:])/g, ([, h, mm]) => `time:${two(h)}:${mm}`);
  take(/\b(?:noon|midday)\b/gi, () => 'time:12:00');
  take(/\bmidnight\b/gi, () => 'time:midnight');
  // Amounts: £10,050, GBP 10,050, 10,050 GBP, €2,350, 2 350 €, 100000 CZK.
  take(new RegExp(`(£|€|\\$|\\b(?:${CODES})\\b)\\s?(${NUM})`, 'g'), ([, c, n]) => `money:${currency(c)}:${number(n)}`);
  take(new RegExp(`(?<![\\w.])(${NUM})\\s?(€|£|Kč|\\b(?:${CODES}|euros?|pounds?)\\b)`, 'g'), ([, n, c]) => `money:${currency(c)}:${number(n)}`);
  take(new RegExp(`(?<![\\w.])(${NUM})\\s?(?:%|per ?cent\\b)`, 'g'), ([, n]) => `pct:${number(n)}`);
  // Course and CAO codes (H401, TR028) and language levels (C1, B2).
  take(/(?<![\w-])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,}(?![\w-])/g, ([c]) => `code:${c}`);
  // A-level grade strings: AAB, A*AA, A*A*A.
  take(/(?<![\w*])(?=[A-E*]*[A-E][A-E*]*[A-E])(?=[A-E*]*\*)[A-E*]{3,}(?![\w*])/g, ([g]) => `grade:${g}`);
  // Capitalised names and abbreviations: IELTS, TOLC-E, UCAS, EU, EEA, HL.
  take(/(?<![\w-])[A-Z][A-Z0-9]*[A-Z](?:-[A-Z0-9]+)*(?![\w])/g, ([w]) => (EMPHASIS.has(w) ? null : `abbr:${w}`));
  take(new RegExp(`(?<![\\w.])(${NUM})${ORD}(?![\\w])`, 'g'), ([, n]) => `num:${number(n)}`);
  return [...tokens].sort();
}

// The tokens of the old cell missing from the new one, and the new tokens that
// were not in the old cell. A capitalised word written in lower case is still
// there ("NOT accepted" -> "not accepted").
export function compareTokens(oldText, newText) {
  const before = conditionTokens(oldText);
  const after = new Set(conditionTokens(newText));
  const lower = (w) => new RegExp(`(?<![\\w-])${w.replace(/[-]/g, '\\-')}(?![\\w-])`, 'i');
  const missing = before.filter((t) => !after.has(t)
    && !(t.startsWith('abbr:') && lower(t.slice(5)).test(newText)));
  const old = new Set(before);
  const added = [...after].filter((t) => !old.has(t)
    && !(t.startsWith('abbr:') && lower(t.slice(5)).test(oldText)));
  return { missing, added };
}

// What makes a new value unfit to write, or ''. The old value may have these
// faults (fixing them is the point); the new one may not.
export function formatProblem(value) {
  if (/^\s*(?:\?|none|n\/a|0|)\s*$/i.test(value)) return `the new value ${JSON.stringify(value)} is blank or a marker, not prose; a reword never clears a cell or turns it into "?", "none" or "0"`;
  if (value !== value.trim()) return 'the new value has a space at the start or end';
  if (/[\r\n]/.test(value)) return 'the new value has a line break';
  if (/ {2}/.test(value)) return 'the new value has a double space';
  if (/(?<!\.)\.\.(?!\.)/.test(value)) return 'the new value has a doubled full stop';
  if (value.includes('|')) return 'the new value has a "|"';
  if (/(?<! )·|·(?! )|  ·|·  /.test(value)) return 'a list bullet must be written " · " (one space each side)';
  return '';
}
