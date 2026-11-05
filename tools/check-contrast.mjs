// Checks every text colour in css/styles.css against the background it is
// actually painted on.
//
//   node tools/check-contrast.mjs
//
// Why this exists: the first pass of the 2026-08 redesign shipped seven text
// colours below WCAG AA, one of them at 2.63:1, and none of it was visible by
// eye — the palette looked fine. A redesign that swaps the token values is
// exactly the change that reintroduces that, so it gets a check rather than a
// careful look. It has since caught --save at 3.63:1 on white, on its first run.
//
// Needs no libraries. It reads the token blocks straight out of the stylesheet,
// so it cannot drift from the real values the way a second copy of the palette
// would.
//
// Text needs 4.5:1; control edges, marks and focus need 3:1.
// Only the explicitly decorative hairline is informational.

import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'css/styles.css'), 'utf8');

// ----------------------------------------------------------------- the pairs
//
// Each entry is a colour as it is genuinely rendered: the token the rule sets,
// the token of the nearest ancestor that paints a background, and where to look
// if it fails. Keep this list honest — a pair that is not here is not checked.
//
// `min` defaults to 4.5. It drops to 3 only where WCAG allows it: text at or
// above 24px (or 18.66px bold), and graphical objects such as an icon.
const CANONICAL_PAIRS = [
  ["--accent-tint", "--ink", "Toast action on ink", 4.5],
  ["--edge", "--panel", ".lang button; input/select/dropdown borders ; .note rule, .tag border, .btn border (stage 2)", 3.0],
  ["--edge-soft", "--panel", "Switch track while OFF and slider thumb while UNSET (WCAG 1.4.11; the mockup's #c4cdd8 was 1.61:1)", 3.0],
  ["--edge", "--ground", "Ground-side control edge: .status .copy (Copy link) border on the count line", 3.0],
  ["--edge", "--accent-tint", "Edge on the active tint: .is-sel .row .tag border; .is-set .inp before its 2 px accent border", 3.0],
  ["--ink", "--panel", ".mast h1, .src b, controls, .row, .empty h2, .issues summary; .detail text, .pnote, .note-strong rule, .tag-strong border (stage 2)", 4.5],
  ["--ink", "--ground", "body, .count", 4.5],
  ["--ink", "--hover", "Retokened .button:hover; .row:hover facts", 4.5],
  ["--ink", "--accent-tint", ".is-sel .fig (stage 4)", 4.5],
  ["--ink", "--fit-fill", ".v-fit .fig: detail cells (stage 2); row cells", 4.5],
  ["--ink", "--cond-fill", ".v-cond .fig: detail cells (stage 2); row cells", 4.5],
  ["--ink", "--time-fill", ".v-time .fig: detail cells (stage 2); row cells", 4.5],
  ["--ink-2", "--panel", ".tagline, .src, .bn-saved, language group, .cols, .empty ul, .issues ul, row .star; .d-place, .lab, .kv dt, .fig small, .unk-t (stage 2)", 4.5],
  ["--ink-2", "--ground", ".foot; count secondary text", 4.5],
  ["--ink-2", "--hover", ".row:hover .sub", 4.5],
  ["--ink-2", "--accent-tint", ".is-sel .sub, .is-sel .line (stage 4)", 4.5],
  ["--ink-2", "--fit-fill", ".v-fit .fig small, .lab: detail cells (stage 2); row cells", 4.5],
  ["--ink-2", "--cond-fill", ".v-cond .fig small, .lab: detail cells (stage 2); row cells", 4.5],
  ["--ink-2", "--time-fill", ".v-time .lab: detail cells (stage 2); row cells; keep secondary text at least 13px here", 4.5],
  ["--ink-3", "--panel", ".lang [aria-disabled=true], input placeholders; .v-unk / .unk-t dash (stage 2)", 4.5],
  ["--ink-3", "--ground", "Ground control placeholder; .m-unk dash", 4.5],
  ["--ink-3", "--hover", ".row:hover .v-unk dash (stronger text minimum retained)", 4.5],
  ["--ink-3", "--accent-tint", ".is-sel .v-unk dash; .is-set .inp::placeholder", 4.5],
  ["--accent", "--panel", ".bn-saved a, links/focus, .skip-link, saved .star and .save; .lnk (stage 2)", 4.5],
  ["--accent", "--ground", "Ground links / global focus", 4.5],
  ["--accent", "--hover", "Hovered row links / sort focus", 4.5],
  ["--accent", "--accent-tint", "Selected-row link/focus; focus ring on .is-set .inp, .dropdown.is-set>summary and .btn.is-on (Filters); picked .option and .achip chip text/border", 4.5],
  ["--accent", "--fit-fill", ".v-fit focus-ring context: detail cells (stage 2); row cells", 3.0],
  ["--accent", "--cond-fill", ".v-cond focus-ring context: detail cells (stage 2); row cells", 3.0],
  ["--accent", "--time-fill", ".v-time focus-ring context: detail cells (stage 2); row cells", 3.0],
  ["--on-accent", "--accent-press", ".bn-fail .btn-p:hover Reload (stage 1); .d-foot .btn-p:hover (stage 2)", 4.5],
  ["--accent-press", "--panel", ".bn-saved a:hover, a:hover", 4.5],
  ["--on-accent", "--accent", ".bn-fail .btn-p Reload (stage 1); .d-foot .btn-p (stage 2)", 4.5],
  ["--on-accent", "--alarm", ".bn-sample text", 4.5],
  ["--fit-ink", "--fit-fill", ".v-fit .verd: detail cells (stage 2); row cells and .r2", 4.5],
  ["--fit-ink", "--ground", ".status .k-fit", 4.5],
  ["--fit-ink", "--panel", ".status.is-stuck .cshort .k-fit", 4.5],
  ["--fit-ink", "--accent-tint", ".is-sel .k-fit context (stage 4)", 4.5],
  ["--fit-mark", "--fit-fill", ".v-fit .m-fit::before: detail cells (stage 2); row cells", 3.0],
  ["--fit-mark", "--panel", ".status.is-stuck .cshort .m-fit::before", 3.0],
  ["--fit-mark", "--ground", ".status .m-fit::before", 3.0],
  ["--fit-mark", "--accent-tint", "Selected-row fit mark context (stage 4)", 3.0],
  ["--cond-ink", "--cond-fill", ".v-cond .verd: detail cells (stage 2); row cells and .r2", 4.5],
  ["--cond-ink", "--ground", ".status .k-cond", 4.5],
  ["--cond-ink", "--panel", ".status.is-stuck .cshort .k-cond", 4.5],
  ["--cond-mark", "--cond-fill", ".v-cond .m-cond::before: detail cells (stage 2); row cells", 3.0],
  ["--cond-mark", "--panel", ".status.is-stuck .cshort .m-cond::before", 3.0],
  ["--cond-mark", "--ground", ".status .m-cond::before", 3.0],
  ["--time-ink", "--time-fill", ".v-time .verd: detail cells (stage 2); row cells", 4.5],
  ["--time-mark", "--time-fill", ".v-time .ic clock: detail cells (stage 2); row cells", 3.0],
  ["--time-mark", "--panel", "Clock mark on panel context (stage 2)", 3.0],
  ["--alarm", "--panel", ".bn-fail border", 3.0],
  ["--alarm-ink", "--panel", ".bn-fail p", 4.5],
  ["--hairline", "--panel", ".top divider, .bn-saved decorative outline", null],
  ["--panel", "--ink", "Former .lang [aria-pressed=true] (kept: ink on panel is the inverse pair)", 4.5],
  // Redesign revisions (2026-10-28): the lavender masthead and country badges.
  ["--brand-ink", "--brand-fill", ".mast h1, .tagline, .lang group and button text/borders on the masthead", 4.5],
  ["--panel", "--brand-ink", ".lang [aria-pressed=true] (EN)", 4.5],
  ["--ink-2", "--brand-fill", ".src source line on the masthead", 4.5],
  ["--ink", "--brand-fill", ".src b on the masthead", 4.5],
  ["--ink-3", "--brand-fill", ".lang [aria-disabled=true] (SK) on the masthead", 4.5],
  ["--accent", "--brand-fill", "Focus ring on masthead controls", 3.0],
  ["--cty-ink", "--cty-fill", ".cc country badge, neutral pair for any unmapped country", 4.5],
  ["--cty-dk-ink", "--cty-dk-fill", ".cc[data-country=Denmark]", 4.5],
  ["--cty-ie-ink", "--cty-ie-fill", ".cc[data-country=Ireland]", 4.5],
  ["--cty-it-ink", "--cty-it-fill", ".cc[data-country=Italy]", 4.5],
  ["--cty-nl-ink", "--cty-nl-fill", ".cc[data-country=Netherlands]", 4.5],
  ["--cty-cz-ink", "--cty-cz-fill", ".cc[data-country=Czechia]", 4.5],
  ["--cty-uk-ink", "--cty-uk-fill", ".cc[data-country=\"United Kingdom\"]", 4.5],
  ["--cty-de-ink", "--cty-de-fill", ".cc[data-country=Germany]", 4.5],
  ["--cty-at-ink", "--cty-at-fill", ".cc[data-country=Austria]", 4.5],
  ["--cty-se-ink", "--cty-se-fill", ".cc[data-country=Sweden]", 4.5],
  ["--cty-fi-ink", "--cty-fi-fill", ".cc[data-country=Finland]", 4.5],
  ["--cty-no-ink", "--cty-no-fill", ".cc[data-country=Norway]", 4.5],
  ["--edge", "--brand-fill", "Masthead-adjacent control edge context", 3.0],
];

export const PAIRS = CANONICAL_PAIRS;

// ----------------------------------------------------------------- the tokens

/** The custom properties declared in one `:root { ... }` block. */
function tokensFrom(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** The body of the first `:root { ... }` at or after `from`. */
function rootBlock(text, from = 0) {
  const start = text.indexOf(':root', from);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  if (open === -1 || close === -1) return null;
  return text.slice(open + 1, close);
}

// Approved Stage 1 root plus the redesign-revisions identity tokens and the
// 380px pane (2026-10-28); keep this independent of ignored design files.
const CANONICAL = {
  "--ground": "#e8edf3",
  "--panel": "#ffffff",
  "--hover": "#f2f5f9",
  "--hairline": "#d9e0e9",
  "--edge": "#76808e",
  "--edge-soft": "#8b95a2",
  "--ink": "#16202c",
  "--ink-2": "#46515f",
  "--ink-3": "#5d6877",
  "--accent": "#1f5bd0",
  "--accent-press": "#1745a3",
  "--accent-tint": "#e3ecfb",
  "--on-accent": "#ffffff",
  "--fit-fill": "#d9f0e2",
  "--fit-ink": "#0f5e38",
  "--fit-mark": "#2a8553",
  "--cond-fill": "#f7d982",
  "--cond-ink": "#5a3a00",
  "--cond-mark": "#8f5a00",
  "--time-fill": "#f6b98a",
  "--time-ink": "#612800",
  "--time-mark": "#9a4600",
  "--alarm": "#a3202f",
  "--alarm-ink": "#86171d",
  "--scrim": "rgb(22 32 44 / .45)",
  "--thumb-shadow": "0 1px 3px rgb(22 32 44 / .22)",
  "--pop-shadow": "0 1px 2px rgb(22 32 44 / .08),0 12px 32px -10px rgb(22 32 44 / .28)",
  "--dialog-shadow": "0 24px 64px -16px rgb(22 32 44 / .4)",
  "--spring-snappy": "linear(0,.012,.049,.107,.185,.278,.383,.493,.601,.702,.791,.865,.924,.967,.995,1.013,1.019,1.016,1.009,1.003,1)",
  "--shadow": "0 1px 2px rgb(22 32 44 / .06), 0 8px 24px -8px rgb(22 32 44 / .22)",
  "--brand-fill": "#ebe4f3",
  "--brand-ink": "#47345d",
  "--cty-fill": "#edf0f4",
  "--cty-ink": "#46515f",
  "--cty-dk-fill": "#eee6f5",
  "--cty-dk-ink": "#523b72",
  "--cty-ie-fill": "#f0e5ef",
  "--cty-ie-ink": "#5a4058",
  "--cty-it-fill": "#f0e7f5",
  "--cty-it-ink": "#563d66",
  "--cty-nl-fill": "#eae7f5",
  "--cty-nl-ink": "#4b426c",
  "--cty-cz-fill": "#eee9ee",
  "--cty-cz-ink": "#4e4352",
  "--cty-uk-fill": "#e6edf5",
  "--cty-uk-ink": "#2f4d6b",
  "--cty-de-fill": "#e6eef0",
  "--cty-de-ink": "#2c4f58",
  "--cty-at-fill": "#f3e7ec",
  "--cty-at-ink": "#69384a",
  "--cty-se-fill": "#e7eaf5",
  "--cty-se-ink": "#37467a",
  "--cty-fi-fill": "#e4f0ee",
  "--cty-fi-ink": "#2a5650",
  "--cty-no-fill": "#ecebf1",
  "--cty-no-ink": "#42485f",
  "--flag-white": "#ffffff",
  "--flag-nl-red": "#ae1c28",
  "--flag-nl-blue": "#21468b",
  "--flag-ie-green": "#169b62",
  "--flag-ie-orange": "#ff883e",
  "--flag-it-green": "#009246",
  "--flag-it-red": "#ce2b37",
  "--flag-dk-red": "#c8102e",
  "--flag-cz-red": "#d7141a",
  "--flag-cz-blue": "#11457e",
  "--flag-gb-blue": "#012169",
  "--flag-gb-red": "#c8102e",
  "--flag-de-black": "#000000",
  "--flag-de-red": "#dd0000",
  "--flag-de-gold": "#ffce00",
  "--flag-at-red": "#c8102e",
  "--flag-se-blue": "#006aa7",
  "--flag-se-yellow": "#fecc02",
  "--flag-fi-blue": "#002f6c",
  "--flag-no-red": "#ba0c2f",
  "--flag-no-blue": "#00205b",
  "--font": "'IBM Plex Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
  "--fs-12": ".75rem",
  "--fs-13": ".8125rem",
  "--fs-14": ".875rem",
  "--fs-16": "1rem",
  "--fs-18": "1.125rem",
  "--s-1": "4px",
  "--s-2": "8px",
  "--s-3": "12px",
  "--s-4": "16px",
  "--s-5": "24px",
  "--s-6": "32px",
  "--r-panel": "12px",
  "--r-cell": "4px",
  "--pane-w": "clamp(300px,26vw,380px)",
  "--t-fast": "120ms",
  "--t-med": "160ms",
  "--t-slow": "200ms",
  "--ease-out": "cubic-bezier(.22,1,.36,1)",
  "--ease-in-out": "cubic-bezier(.45,0,.25,1)"
};
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

// Check declaration values, not selectors (#issues) or URL fragments (#i-globe).
export function colourPolicyErrors(text) {
  const errors = [];
  const clean = withoutComments(text);
  const roots = [...text.matchAll(/:root\s*\{([^{}]*)\}/g)];
  if (roots.length !== 1) errors.push('Expected exactly one root block');
  const block = roots[0]?.[1] ?? '';
  const declarations = [...withoutComments(block).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)];
  const seen = new Set();
  for (const [, name, value] of declarations) {
    if (seen.has(name)) errors.push(`Duplicate root token ${name}`);
    seen.add(name);
    if (Object.hasOwn(CANONICAL, name)) {
      if (value.trim() !== CANONICAL[name]) errors.push(`Changed canonical token ${name}`);
    } else {
      errors.push(`Unapproved root token ${name}`);
    }
  }
  for (const name of Object.keys(CANONICAL)) {
    if (!seen.has(name)) errors.push(`Missing canonical token ${name}`);
  }
  const outside = clean.replace(/:root\s*\{[^{}]*\}/g, '');
  for (const [, property, rawValue] of outside.matchAll(/(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]*)(?=;|\})/g)) {
    const value = rawValue.replace(/url\([^)]*\)/gi, '');
    if (/#(?:[\da-f]{3,8})\b|\b(?:rgba?|hsla?)\s*\(/i.test(value)) {
      errors.push(`Colour literal outside root in ${property}`);
    }
    if (Object.hasOwn(CANONICAL, property)) {
      errors.push(`Root token overridden outside root: ${property}`);
    }
  }
  for (const [, selectors, body] of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(',').map((s) => s.trim())) {
      if (/var\(\s*--alarm\s*\)/.test(body) && (!/^\.bn-(?:sample|fail)(?=[\s.:#[>]|$)/.test(selector) || /[+~]/.test(selector))) {
        errors.push(`Alarm outside banner: ${selector}`);
      }
      if (/var\(\s*--alarm-ink\s*\)/.test(body) && (!/^\.bn-fail\s+(?:>\s*)?\S/.test(selector) || /[+~]/.test(selector))) {
        errors.push(`Alarm ink outside failure descendants: ${selector}`);
      }
    }
  }
  return errors;
}

const light = tokensFrom(withoutComments(rootBlock(css) ?? ''));

// One palette. The dark one was dropped on 2026-10-24 — the site is light only,
// and `color-scheme: light` in the stylesheet stops the browser dark-rendering
// form controls and scrollbars underneath it. If a dark palette ever comes
// back, add it to THEMES so its pairs get checked too; this guard makes sure
// nobody can reintroduce one and quietly leave it unchecked.
if (css.includes('prefers-color-scheme: dark')) {
  throw new Error(
    'css/styles.css has a dark-mode block again, but this checker only tests the '
    + 'light palette. Add it to THEMES so its pairs are checked as well.',
  );
}

const THEMES = [['light', light]];

// ------------------------------------------------------------------- contrast

function rgb(hex) {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

// WCAG relative luminance.
function luminance(hex) {
  const parts = rgb(hex);
  if (!parts) return null;
  const [r, g, b] = parts.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ----------------------------------------------------------------------- run

function run() {
  const policyErrors = colourPolicyErrors(css);
  for (const error of policyErrors) console.error(`  FAIL  ${error}`);
  let failures = policyErrors.length;
  let enforced = 0;
  let missing = 0;

  for (const [themeName, tokens] of THEMES) {
    console.log(`\n${themeName}`);

    for (const [fgName, bgName, where, min = 4.5] of PAIRS) {
      const fg = tokens[fgName];
      const bg = tokens[bgName];

      if (!fg || !bg) {
        console.log(`  MISS  ${fgName} on ${bgName} — token not declared`);
        missing++;
        continue;
      }

      const r = ratio(fg, bg);
      if (r === null) {
        console.log(`  MISS  ${fgName} on ${bgName} — not a hex colour (${fg} / ${bg})`);
        missing++;
        continue;
      }

      if (min === null) {
        console.log(`  INFO  ${r.toFixed(2)}:1  ${fgName} on ${bgName} — decorative only`);
        continue;
      }
      enforced++;
      const ok = r >= min;
      if (!ok) failures++;
      const shown = r.toFixed(2).padStart(5);
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'}  ${shown}:1  (needs ${min})  ${fgName} on ${bgName}`
        + `${ok ? '' : `\n          ${fg} on ${bg} — used by ${where}`}`,
      );
    }
  }

  const problems = failures + missing;
  console.log(
    problems
      ? `\n${failures} below the minimum, ${missing} unresolvable. `
        + 'Darken the foreground token or lighten its background — do not lower the minimum.'
      : `\nAll ${enforced} colour pairs pass.`,
  );
  process.exitCode = problems ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
