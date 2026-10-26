# Compare 2–4 programmes: architecture draft

Registry: F05, Q9. Decided 2026-10-26 (Leon): backlog and this draft only.
**No code, hidden or otherwise** (both reviewers objected to dormant code).
**Ask Jakub before building anything.**

## The idea

A student picks two to four programmes and sees them side by side: points,
subjects, fee, deadline, language, admission. The old plan hung this off the
shortlist, which was removed at Jakub's request (STATUS, "No save button, no
shortlist"). This draft does not depend on the shortlist.

## Sketch

- **Address, not storage.** A `compare=` parameter lists the `programme_id`s,
  for example `?compare=tcd-computer-science,tud-cse`. It sits beside the
  filter parameters the page already keeps (S03, `stateToParams` and
  `paramsToState` in `js/filters.js`), so a compare view can be reloaded and
  sent to a friend. Unknown ids are reported, not silently dropped. More than
  four are cut to four with a message.
- **Same card code.** Each column is the existing card from `js/render.js`, so
  the wording (minimum vs cutoff, "Not published", HL Maths) can't differ
  between the list and the compare view.
- **Choosing programmes.** Open question: a small "Compare" control on each
  card, or a picker. Either needs Jakub's view, since he removed the save
  button.
- **Leaving.** One "Back to the list" link that drops `compare=` and keeps the
  filters.

## Open questions

- Does Jakub want it at all?
- How a student picks programmes without a save button.
- Phone layout: two columns at most on 320 px, or a swipe between cards.
- Print: one page with the chosen programmes (A08 is the related print issue).
