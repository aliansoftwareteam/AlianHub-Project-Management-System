---
id: 055
title: Create Project modal — Member, Skills, Source and Due date pickers open above the modal
status: active
priority: high
depends_on: []
created: 2026-10-20
---

# Create Project modal — Member, Skills, Source and Due date pickers open above the modal

## Goal
In the Create Project modal, the Member (Lead), Skills, Source and Due date fields cannot be used, so a project cannot be created with leads, skills, a chosen source or a usable due date. Make every picker in the modal open above it, fully visible and usable, through one shared mechanism rather than four patches. Related: ABFT-34 (UX-013).

## Root cause
`CreateProjectSidebar.vue` teleports the modal to `<body>` with `z-index: 1050` (`.ah-cp`). The pickers teleport into the hosts `main.js` appends to `#app` (`#my-dropdown`, `#my-sidebar`), which `tokens.css` pins at `z-index: 100` (commit a2cf4e149). So:

- **Source** (`ProjectSourceSelect` → `DropDown`) does open, but its panel sits directly under the field, behind the modal, so it is fully hidden and looks like it "does not open". It is wired up correctly.
- **Skills** (`SkillsSelect` → `DropDown`) opens behind the modal in the same way.
- **Member / Lead** (`Assignee` → `Sidebar`) opens the app-wide member drawer, also behind the modal. It shows beside the dialog but can't be clicked.
- **Due date** (`VueDatePicker`) renders its menu inline inside `.ah-cp__right` (`overflow-y: auto`), so the modal clips it.

## Scope
- A shared popover-layer mechanism: a modal provides a teleport target inside its own stacking context. `DropDown`, `Sidebar` and the modal's `VueDatePicker`s render into it. Components outside such a modal keep today's hosts.
- `CreateProjectSidebar.vue` provides that layer, and its two due-date pickers use it (or teleport out of the clipping container).
- The Member field keeps the existing member drawer (decided with the user), now shown above the modal.
- Esc and outside-click close the open picker without closing the modal; keyboard selection keeps working.
- Re-check the same fields where the components are shared: Edit Project (`ProjectDetailRightSide`), the AI project creator, and the template form (`ProjectForm`).
- Update the Source root cause in the ticket comment.

## Out of scope
- Replacing the member drawer with an anchored popover.
- Raising the global teleport-host z-index (that would reorder every legacy layer).
- Fixing other body-teleported modals beyond listing which ones share the pattern (follow-up).
- ABFT-34 missing-field feedback.

## Acceptance criteria
- [ ] Member (Lead) drawer opens above the modal; members can be searched, selected and saved on the created project
- [ ] Skills list opens anchored to the field above the modal; selected skills save on the project
- [ ] Source list opens anchored to the field above the modal; the chosen source saves on the project
- [ ] Due date calendar is fully visible at 1366×768, 1440×900 and 1920×1080 and repositions near viewport edges; the date saves
- [ ] Esc / outside click closes the open picker without closing the modal; keyboard selection works
- [ ] Edit Project, the AI creator and the template form still open these pickers correctly
- [ ] Screenshots of all four fields working, for the In Review comment
- [ ] `npm run style:check` and `npm run i18n:check` pass; no new hard-coded colours or bare strings

## Constraints & notes
- Hard rules: minimal comments, tokens only, i18n for any new string.
- `.ah-cp` is `position: fixed` with no transform, so `position: fixed` children of a layer inside it still resolve against the viewport.
- `@vuepic/vue-datepicker` 10.0.0 supports a `teleport` prop; its menu wrapper is `z-index: 99999`.

## Resources
- Ticket text pasted in the session (no files).
