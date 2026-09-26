# Progress — 039 Accessible DropDown

## Checklist
- [ ] Owner confirms the PRD in `task.md`
- [ ] Slice 1: the component (both modes, the old API still works), its unit spec, the SVG
      outside-click fix, and the convention test with a baseline
- [ ] Call-site batches (one PR per area): tasks and lists, projects, settings, Home and inbox,
      AI screens, the rest
- [ ] Extend the axe e2e spec to open a menu and a listbox
- [ ] Before-and-after screenshots of the five representative dropdowns

## Log
- 2026-09-26: Created from finding A11Y-O1, which is too big for a one-fix PR (107 `DropDown`
  and 216 `DropDownOption` call sites). Counts taken with `git grep` on beta at build 440.
  The acceptance criteria were drafted by the integrator; the owner confirms them before any
  build.
