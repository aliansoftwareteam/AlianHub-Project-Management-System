---
id: 087
title: Ask knows a project — grounded project, list, task and person answers, and a better @ picker
status: active
priority: high
depends_on: []
created: 2026-11-02
---

# 087 — Ask: project context and @ mentions (PRD)

## 1. Goal

The owner asks Ask "what is going on in this project?" and gets a grounded answer: how the work splits by status, what is overdue, blocked or at risk, who is working on what, how each list (sprint) is doing, and what changed lately — every claim cited to a task or to the project's own numbers.

Typing `@` in the Ask box opens a picker of projects, lists, tasks, docs and people, with the current and recent things first. A picked item is a chip, and the question is answered about exactly that item.

## 2. What exists (read from the code, 2026-11-02)

- Ask page: `frontend/src/views/Ai/AskPage.vue`, composer `useAskComposer.js` + `askComposer.js`, menu `AskComposerMenu.vue`, stream `useAskConversation.js` → `POST /api/v1/ai/ask/stream` (`Modules/AI/askStream.js`).
- An `@` picker already exists. It searches `POST /api/v2/search` after 2 characters, finds projects, tasks and docs only, in one flat list, and sends `context: [{ kind, id }]`.
- The server re-reads each pinned id inside the asker's visible projects (`Modules/AI/askContext.js`). A pinned **project** sends only its name and description, so "what is going on" has nothing to stand on. A pinned task sends one line, without its comments or subtasks.
- Question words such as "overdue", "my", "current sprint" already filter tasks exactly (`askIntent.js`, `askStructured.js`); that stays.
- A full task context (task, comments, subtasks, docs) already exists for the task panel (`Modules/AI/taskContext.js`) and is reused.

## 3. Scope

### Backend
1. **Project briefing** (`Modules/AI/askBriefing.js`): from every task in one project the asker can open (private lists they are not on left out):
   - one *project* source with exact numbers: total, done, open, % done; count per status in the project's own status order; overdue, due in 7 days, no due date, unassigned, blocked, high/urgent priority; per person open / overdue / in progress; per list total / done / open / overdue (with state and dates for a scrum list).
   - one *activity* source: the latest history lines of the last 14 days (who changed what on which task).
   - task sources for the tasks that matter: overdue, blocked (with the blocking task), high/urgent, due soon, in progress, recently done — each with status, people, due date, priority.
2. **List (sprint) briefing**: the same numbers for one list, plus its tasks.
3. **Person briefing**: one person's open work across the projects the asker can open, with overdue and due-soon counts.
4. **Pinned task**: uses the full task context (comments, subtasks, linked docs).
5. **When the briefing is used**: a pinned project or list always; otherwise, when the question asks for an overview ("what's going on", "status", "progress", "summary", "update", "how is … doing", "blockers", "risks", …) and the scope is one project (picked in the scope menu or named in the question).
6. **Prompt**: the system prompt gains rules for briefing answers — numbers come only from the briefing, open with a one-line health read, then short sections, cite `[ref]`s.
7. **Mention search** `GET /api/v1/ai/ask/mentions?q=&projectId=`: projects, lists, tasks, docs and people the asker can open, grouped. With no `q`, suggestions: the scoped project and its lists, the asker's recently visited projects/tasks/docs (`recentVisits`), and their own open tasks.

### Frontend
8. `@` opens the picker at once (no 2-character wait) with suggestions; typing searches. Results are grouped by type with headings (Projects, Lists, Tasks, Docs, People), keyboard navigable (↑ ↓ Enter Tab Esc) as today.
9. Items the asker picked lately (kept in this browser) and the scoped project come first.
10. Chips show the kind's icon; the sent question keeps its chips on the turn in the conversation.
11. Every string through i18n; every colour a token.

## 4. Out of scope

- Changing what a person can see; Ask never widens access.
- The command palette's one-shot Ask (`POST /api/v1/ai/ask`), Ask plan mode and the task panel Ask.
- `docs/API.md` / OpenAPI (Rule 4: the follow-up docs PR runs `npm run api:doc`).
- A new rich-text editor; the box stays a textarea with chips above it.

## 5. Acceptance criteria

- [ ] "What is going on in this project?" with a project scoped or `@`-mentioned sends a project source whose counts match the database exactly, the activity source, and the at-risk tasks.
- [ ] A task in a private list the asker is not on never shows in the briefing, its counts, the picker or the activity lines; a project the asker cannot open never resolves.
- [ ] `@` alone shows suggestions; `@eng` shows matching projects, lists, tasks, docs and people under headings; arrows, Enter, Tab and Esc work.
- [ ] A picked mention is a chip, is sent as `{ kind, id }`, and stays shown on the asked turn.
- [ ] Unit tests: mention parsing, grouping, recents and payload (frontend); briefing numbers, overview detection, activity lines and the mention search scoping (backend).
- [ ] `npm run i18n:check` and `npm run style:check` pass.
- [ ] Verified in the browser against the demo companies; screenshots in this folder.

## 6. Decisions (made without the owner, overnight)

- **Own mention endpoint, not `/api/v2/search`.** Global search has no lists or people and needs a query; Ask's picker needs suggestions on a bare `@`. The new route lives in `Modules/AI` and reads through the same visibility helpers.
- **Briefing as sources, not as tools.** Ask is a single grounded model call with cited sources; giving the model tools would change its cost and safety profile. Computing the numbers on the server makes counts exact and keeps the "every claim cites a source" rule.
- **Lists are called lists** in screen text (plain-words rule), "sprint" only where a list is a scrum sprint.
- **People** are searchable; a guest only finds the people on projects shared with them.
- **Recent mentions** are kept in `localStorage` per company (max 8): a per-browser convenience, never needed for correctness.
