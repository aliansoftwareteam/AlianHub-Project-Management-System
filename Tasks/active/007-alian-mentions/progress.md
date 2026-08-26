# Progress: @Alian mentions in task comments

## Checklist
- [x] Extract question from `@Alian` text (pure helper + tests)
- [x] Hook comment save to workspace ask; post Alian follow-up with citations
- [x] Synthetic `@Alian` option in CommentInput (task comments only)
- [x] Render Alian comments with kiln look + citation chips
- [x] Pages compose: `@Alian` routes to workspace ask, does not apply to the page
- [x] Keep page-content tests green; frontend build

## Last step
Fixed live-refresh so Alian follow-ups appear in the open Comments thread without reopening the modal.

## Blockers
None.

## Log

### 2026-08-26
- Task created. Branching from `feat/workspace-ask-citations-27ed` (PR 516).
- Decision: answer lands as a **follow-up comment** from system author Alian (`userId: "alian"`), threaded as a reply to the triggering comment. Edit-in-place would mix the user's question with the model answer.
- `@Alian` is a synthetic mention option (`key: alian`) in task-comment autocomplete. No user row is created. `parseMentionIds` ignores it because it is not a 24-hex id.
- Comment save runs `runWorkspaceAsk` (same visibility filters as `askWorkspace`) as the comment author, then inserts an Alian follow-up with `citations` copied from the pack (never invented).
- Pages compose: an instruction containing `@Alian` is routed to workspace ask and is not applied to the page.
- `jest` — 83 passing (alian-mention, page-content, page-rules, parse-mentions, first-run-checklist).
- `cd frontend && npm run build` — DONE.
- Draft PR: https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/517
- Live-refresh gap: Alian row saved but missing from the open thread until modal reopen. Emit payload now serializes `projectId` / `sprintId` / `taskId` / `_id` to hex strings and `commentSocket` looks up rooms with that prefix. Client insert accepts `userId: alian` and does not require a reload.

