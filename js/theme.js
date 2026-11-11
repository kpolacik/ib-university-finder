// Memory owns the visit, even when browser storage is blocked or full.
export const THEME_KEY = 'ib-university-finder:theme';
let choice = 'system';
let media;
let listening = false;
const valid = (value) => value === 'light' || value === 'dark';
export const getThemeChoice = () => choice;
export function initTheme(storage) {
  let stored;
  try { stored = (storage ?? globalThis.localStorage)?.getItem(THEME_KEY); } catch { /* Follow System. */ }
  choice = valid(stored) ? stored : 'system';
  applyTheme();
}
export function setThemeChoice(value, storage) {
  if (!valid(value) && value !== 'system') return;
  choice = value;
  try {
    const target = storage ?? globalThis.localStorage;
    if (choice === 'system') target?.removeItem(THEME_KEY);
    else target?.setItem(THEME_KEY, choice);
  } catch { /* The choice still applies for this visit. */ }
  applyTheme();
}
export function applyTheme() {
  media ??= matchMedia('(prefers-color-scheme: dark)');
  if (choice === 'system' && !listening) { media.addEventListener('change', applyTheme); listening = true; }
  if (choice !== 'system' && listening) { media.removeEventListener('change', applyTheme); listening = false; }
  const resolved = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolved);
}
