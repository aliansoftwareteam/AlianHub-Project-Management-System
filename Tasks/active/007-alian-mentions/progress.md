# Progress: @Alian mentions in task comments

## Checklist
- [ ] Extract question from `@Alian` text (pure helper + tests)
- [ ] Hook comment save to workspace ask; post Alian follow-up with citations
- [ ] Synthetic `@Alian` option in CommentInput (task comments only)
- [ ] Render Alian comments with kiln look + citation chips
- [ ] Pages compose: `@Alian` routes to workspace ask, does not apply to the page
- [ ] Keep page-content tests green; frontend build

## Last step
Task created. Starting implementation.

## Blockers
None.

## Log

### 2026-08-26
- Task created. Branching from `feat/workspace-ask-citations-27ed` (PR 516).
- Decision: answer lands as a **follow-up comment** from system author Alian (`userId: "alian"`), threaded as a reply to the triggering comment. Edit-in-place would mix the user's question with the model answer.
