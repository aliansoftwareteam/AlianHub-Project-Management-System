---
id: 039
title: Make the shared DropDown keyboard and screen-reader accessible
status: backlog
priority: medium
depends_on: []
created: 2026-09-26
---

# Make the shared DropDown keyboard and screen-reader accessible

## Goal
Every menu and picker built on the shared `DropDown` works from the keyboard and is announced
correctly by screen readers, so the app meets WCAG 2.1.1 (keyboard) and 4.1.2 (name, role,
value) wherever a dropdown is used, not only on the key flows #944 patched by hand.

Source: finding A11Y-O1 in
`Tasks/active/034-end-to-end-qa-programme/findings/a11y-key-flows-2026-09-24.md`.

## Scope
- `frontend/src/components/molecules/DropDown/DropDown.vue`. Today the trigger is a clickable
  `<div>` that is keyboard-reachable only when the slotted content happens to be a `<button>`.
  The panel is teleported to `#my-dropdown` with no role and no link to its trigger.
- `frontend/src/components/molecules/DropDownOption/DropDownOption.vue`. Options are `<div>`s
  with no role, no arrow keys, no Escape and no focus return.
- `frontend/src/components/molecules/DropDown/CustomDropDown.vue` (1 file, 3 uses).
- Migrating the call sites: 107 `<DropDown>` uses in 75 files, 216 `<DropDownOption>` uses in
  66 files, including the 4 `hover` dropdowns and the mobile full-screen sheet (≤767 px).
- Behaviour to add:
  - A trigger that is a real `<button type="button">` (or the call site's own button, given the
    trigger attributes), with `aria-haspopup`, `aria-expanded` and `aria-controls` pointing at the
    teleported panel's id.
  - Two semantics chosen per use with a prop: `menu` for actions (`role="menu"` / `menuitem`) and
    `listbox` for choosing a value (`role="listbox"` / `option` with `aria-selected`). Status,
    assignee and priority pickers are listboxes; row and "more" menus are menus.
  - Roving focus: opening moves focus to the selected or first item; ArrowUp/ArrowDown, Home and
    End move it; Enter and Space activate; Escape and Tab close; closing returns focus to the
    trigger.
  - `hover` dropdowns also open on focus and on Enter/Space from the trigger.
  - Mobile sheet: the close control is a labelled button, focus stays inside the sheet while it is
    open, and Escape closes it.
- A shared unit spec for the component, and the axe e2e spec from #944 extended to open one menu
  and one listbox on the key flows.

## Out of scope
- Visual redesign of menus and pickers. Spacing, colours and sizes stay as they are.
- Other popovers that are not built on `DropDown`: date pickers, the `vue-mention` list (A11Y-O3,
  own PR), tooltips and the command palette.
- Typeahead (jump to an item by typing its first letters). It is a possible follow-up.

## Acceptance criteria
- [ ] `DropDown` renders a keyboard-reachable trigger with `aria-haspopup`, `aria-expanded` and
      `aria-controls` in every mode (click, hover, mobile sheet). A unit spec proves it.
- [ ] Menu and listbox modes expose the right roles; a listbox marks the current value with
      `aria-selected="true"`. A unit spec proves it.
- [ ] The arrow keys, Home, End, Enter, Space, Escape and Tab behave as described in Scope, and
      focus returns to the trigger on close. A unit spec proves each key.
- [ ] No call site nests an interactive element inside another. A convention test fails if a
      `<DropDown>` trigger slot holds a button while `DropDown` also renders its own.
- [ ] All 107 `DropDown` and 216 `DropDownOption` call sites are migrated. A convention test
      lists any `DropDown` use without a declared mode and has an empty baseline at the end.
- [ ] The axe e2e spec opens one menu and one listbox on the key flows and reports no serious or
      critical violations.
- [ ] No visual change: screenshots of five representative dropdowns (a status picker, an
      assignee picker, a row menu, a hover menu and the mobile sheet) match before and after at
      1280 and 390 px, in light and dark.

## Constraints & notes
- Ship in slices: (1) the component, with the old API still working and both modes added, plus
  its unit spec; then (2..n) call-site batches by area (tasks and lists, projects, settings,
  Home and inbox, AI screens, the rest), one PR each and each under about 15 files. Add the
  convention test with a shrink-only baseline in slice 1, so each batch lowers the count.
- The outside-click listener calls `e.target.className.includes(...)`. On SVG targets
  `className` is an `SVGAnimatedString`, so that call throws. Fix it in slice 1.
- All new labels go through i18n (CLAUDE.md Rule 3).
- #944 put buttons into trigger slots on the key flows. Those call sites must not end up with a
  button inside a button once `DropDown` renders its own. Offer a scoped slot
  (`#button="{ triggerAttrs }"`) for call sites that keep their own button.

## Resources
- `resources/` is empty. The finding and #944's a11y spec are the references.
