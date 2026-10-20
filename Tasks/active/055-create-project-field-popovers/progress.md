# Progress: Create Project modal — Member, Skills, Source and Due date pickers open above the modal

## Checklist

- [x] Add the shared popover-layer provide/inject helper (`composable/popoverLayer.js`)
- [x] `DropDown` and `Sidebar` teleport into the injected layer, falling back to their hosts
- [x] `CreateProjectSidebar` provides the layer; due-date pickers teleport to `<body>`
- [x] Verify Esc / outside click / keyboard in the modal
- [x] Verify all four fields save on a created project (local server, demo DB, industry account)
- [x] Re-check Edit Project (AI creator and template form are outside the modal: unchanged hosts)
- [x] Calendar measured at 1366×768, 1440×900, 1920×1080
- [x] style:check, i18n:check, unit spec

## Last step

Done and verified live; committed on the branch. Awaiting review / PR.

## Blockers

None.

## Log

### 2026-10-20
- Task created. Root cause traced: the modal is at z-index 1050 on `<body>`; the teleport hosts are at 100. The date picker is clipped by `.ah-cp__right` overflow.
- Decision (user): Member keeps the existing member drawer, just lifted above the modal.
- Built: `providePopoverLayer()` / `usePopoverLayer(fallback)`. The modal renders `.ah-cp__layer` inside its own stacking context, and `DropDown`/`Sidebar` below it teleport there. The layer ref is null while the modal is hidden, so the AI creator (a child component) keeps the global hosts.
- Found while testing: `--legacy-header-h` was set on `#app`, so a drawer teleported outside `#app` had invalid `top`/`height` (611px tall in a 768px viewport). Moved to `:root`, same values.
- Found while testing: the date input closes its calendar on Esc before the key bubbles, so the modal saw it as closed and shut itself. Fixed by reading the open state in the capture phase.
- Verified on a local server (demo DB, safety switches, demo.visitor industry account), one "Popover check" project created and then deleted:
  - Lead drawer above the modal; search + pick work.
  - Skills: search, keyboard tick, outside click.
  - Source: keyboard + mouse pick.
  - Due date: pick works.
  - Esc closes only the open picker every time.
  - Saved: LeadUserId, source `fiverr`, skills `["react"]`, DueDate 2026-10-30.
- Calendar fully visible and on top at 1366×768, 1440×900 and 1920×1080. It flips above the field near the bottom edge. At an extreme 1366×480 neither side fits its 238px, and it overshoots the top by 6px.
- Edit Project panel: Source drawer and Skills list still open from `#my-sidebar` / `#my-dropdown`, on top.
- Source root cause for the ticket: it was wired up and opening; its list rendered directly under the field, behind the modal, so it looked dead.
- Tests: new `popoverLayer.spec.js` (3) passes; the 44 specs touching these components pass except load-timeouts that pass alone, and `darkModeBatchThree`'s path-table check, which is a pre-existing Windows path-separator failure.
- Follow-up candidates: `MainChatMessage.vue` sits under a fixed ≥1000 overlay with pickers. Nothing else teleports a picker-hosting modal to `<body>`.
