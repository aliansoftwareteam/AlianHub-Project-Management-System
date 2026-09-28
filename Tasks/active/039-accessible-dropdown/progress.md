# Progress — 039 Accessible DropDown

## Checklist
- [x] Owner confirms the PRD in `task.md` — 2026-09-27 ("go")
- [x] Slice 1: the component (both modes, the old API still works), its unit spec, the SVG
      outside-click fix, and the convention test with a baseline — #1062 (build 526); core follow-up #1078 (537): `#search` slot, `multiselectable`, `mode="dialog"`, search fields keep focus
- [x] Call-site batches (one PR per area): tasks and lists, projects, settings, Home and inbox,
      AI screens, the rest — #1070 (538), #1074 (542), #1076 (547), #1073 (548), #1071 (552), #1075 (555); unique milestone ids #1083 (541)
- [x] Extend the axe e2e spec to open a menu and a listbox — #1088 (549)
- [ ] Before-and-after screenshots of the five representative dropdowns

## Log
- 2026-09-26: Created from finding A11Y-O1, which is too big for a one-fix PR (107 `DropDown`
  and 216 `DropDownOption` call sites). Counts taken with `git grep` on beta at build 440.
  The acceptance criteria were drafted by the integrator; the owner confirms them before any
  build.
- 2026-09-27: owner said go. Slice 1 #1062.
- 2026-09-28: core follow-up #1078 after the batches found search fields losing focus and form panels; six call-site batches merged (builds 538–555); axe e2e #1088 opens a menu and a listbox with no serious or critical findings and caught a focus-return bug on the view ⋯ menu. Final clean-up merged: #1092 (558) empties the baseline with dialog mode for the form-style dropdowns; #1093 (559) moves search fields into `#search`, adds `multiselectable`, and makes the column picker, watcher removal and per-tag menu keyboard-usable. Left: the screenshots, and Tab closing a listbox on desktop before a control inside an option can be reached.
