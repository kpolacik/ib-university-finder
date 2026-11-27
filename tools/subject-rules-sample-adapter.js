// TEST ONLY. Never served by the site and never referenced from js/ or
// index.html (tools/check.mjs fails if it is).
//
// tools/smoke.mjs answers the browser's request for js/subject-rules.js with
// this file, so a browser test can show a rule marked SAMPLE (an invented
// rule) on screen. Everything is the unmodified production module, loaded
// from a distinct address ("?production") so it is not intercepted again:
// every export is passed through unchanged except acceptRule, the single
// acceptance boundary, which here also accepts a rule whose ONLY problem is
// the distinct 'sample' reason, and marks it sample so the page shows its
// fixture warning. Every other reason still rejects the rule. This module
// keeps no state: what is current, the timers and the generation all live in
// js/subject-authority.js, which is not replaced.

import * as production from './subject-rules.js?production';

export * from './subject-rules.js?production';

export function acceptRule(record, context) {
  const result = production.acceptRule(record, context);
  if (result.ok || result.reasons.length !== 1 || result.reasons[0] !== 'sample') return result;
  const inspected = production.inspectRule(record, context);
  if (!inspected.rule || inspected.reasons.join() !== 'sample') return result;
  return { ok: true, key: inspected.key, withdrawal: false, rule: { ...inspected.rule, sample: true }, reasons: [] };
}
