---
id: 007
title: "@Alian mentions in task comments"
status: active
priority: high
depends_on: [006]
created: 2026-08-26
---

# @Alian mentions in task comments

## Goal
Users can type `@Alian` in a task comment to ask the workspace AI a question. The answer posts as a follow-up comment from a system author named Alian, with the same citation objects as Workspace Ask (S1.1).

## Scope
- Synthetic `@Alian` option in task-comment mention autocomplete (not a real user row).
- On save of a task comment that contains `@Alian`, extract the question and run the existing `answerWorkspaceQuestion` / `pageWorkspaceAsk` stack with the same visibility filters as `askWorkspace`.
- Append a follow-up comment authored as Alian (`userId: "alian"`), including `citations`.
- Pages compose: if the instruction contains `@Alian`, route to workspace ask and do not apply to the page.
- Unit tests for question extraction and citation pass-through (no invented IDs).

## Out of scope
- Gantt, MCP, standup bots, custom-field autofill.
- A second AI stack.
- Overwriting page content.
- Creating a fake Alian user in the users collection.
- Main Chat `@Alian` replies.

## Acceptance criteria
- [ ] `@Alian` appears as a first-class mention option in task comment autocomplete
- [ ] Saving a task comment with `@Alian` posts a follow-up comment from Alian
- [ ] The follow-up includes Workspace Ask citation objects (pack IDs only)
- [ ] Same page/task visibility filters as `askWorkspace`
- [ ] No fake user row is created
- [ ] Page content is not overwritten
- [ ] Unit tests cover question extraction and "do not invent citations"
- [ ] Existing page-content tests stay green; frontend build passes
- [ ] Draft PR opened

## Constraints & notes
- Branch from `feat/workspace-ask-citations-27ed` (PR 516). Branch name: `feat/alian-mentions-6d61`.
- Decision: **follow-up comment**, not edit-in-place — the user's question stays, Alian is a distinct author, and live-sync already inserts new comments.
- Kiln look (cream/pine/copper). Reuse `WorkspaceAskCitations`.
- Reuse `Modules/AIProjectGenerator/llmProvider`.

## Resources
None.
