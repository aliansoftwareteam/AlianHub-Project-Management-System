# Progress: Workspace Ask with real citations

## Checklist
- [x] Extend `formatContextPack` with structured citations (id, type, title, projectId)
- [x] Ask the model for `used` sources; filter to the pack; fall back to top N
- [x] Return `data.citations` from `answerWorkspaceQuestion` / `askWorkspace`
- [x] Render kiln citation chips in WorkspaceAskPopover and compose-rail Workspace
- [x] Open cited pages via `/:cid/pages?page=<id>`
- [x] Add en.js keys; unit tests for citation shaping
- [x] Keep existing page-content tests green
- [ ] Open draft PR

## Last step
Backend + UI + tests done (60 passing). Opening the draft PR.

## Blockers
None.

## Log

### 2026-08-26
- Task created. Starting from `cursor/ai-native-pages-shell-c793` (PR 515, unmerged) because that tip already has Workspace Ask.
- `formatContextPack` now tags `[page:<id>]` / `[task:<id>]` and returns `citations`.
- Model `used` hints are filtered against the pack; invented IDs are dropped; empty/invalid hints fall back to 6 pages + 6 tasks.
- `POST /api/v2/pages/ask-workspace` returns `data.citations: [{ type, id, title, projectId? }]`.
- Header popover and Pages compose Workspace chip render kiln citation chips. Page chips go to `/:cid/pages?page=<id>`. Tasks stay labeled with data attributes (no task-open route without sprint).
- `npx jest tests/page-content.test.js tests/page-rules.test.js tests/first-run-checklist.test.js` — 60 passing.
