---
id: 005
title: Project-scoped AI dev chat in a full-screen modal
status: active
priority: high
depends_on: []
created: 2026-08-21
---

# Project-scoped AI dev chat in a full-screen modal

## Goal

One place, per project, where you talk to the AI developer the way you talk to Claude
Desktop: type an instruction, it works on the codebase, you carry on in the same thread.
No task involved, no task history, nothing to find first.

Reached from a single icon in the project header, opening a full-screen window that
handles the whole loop — many chats per project, each its own thread.

The per-task Development tab keeps working exactly as it does now.

## Approach

A chat is its own thing, identified by a `conversationId`. It is **not** anchored to a
task — that was the first cut of this task and it was wrong: it produced a rail of task
threads, which is not what the window is for.

Every dev-agent message therefore carries **exactly one** scope: `taskId` (the task tab,
unchanged) or `conversationId` (the project chat). The controller enforces exactly-one so
relaxing the schema cannot silently produce an unscoped message.

Two things this forces, both deliberate:

- **`devMessages.taskId` becomes `required: false`,** and `conversationId` is added as a
  **declared** field. Declared matters: the schema is `strict: true`, which silently drops
  undeclared fields — a bug that works in-session and vanishes after reload. This repo has
  already been burned by exactly that.
- **The runner stops assuming a task.** No `fetchTask`, no task comments, no `TaskKey` to
  name a branch from. A chat derives its own branch scope and its own memory file.

A chat's title is its first instruction, like Claude Desktop — no separate collection, no
rename UI, nothing to seed.

## Scope

**Schema**
- `utils/mongo-handler/schema.js` — `taskId` → `required: false`; add declared
  `conversationId`.
- `utils/mongo-handler/createSchema.js` — index `{ conversationId: 1, createdAt: 1 }` and
  `{ projectId: 1, conversationId: 1 }`.

**Backend — `Modules/DevAgent`**
- A single `scopeOf(...)` helper: reads `taskId` / `conversationId`, validates the id shape,
  refuses both-or-neither. Every endpoint routes through it.
- `mask` carries `conversationId`.
- `postMessage`, `listMessages`, `postReply`, `enqueueFollowup`, `uploadAttachment`,
  `downloadAttachment`, the no-runner failure reply: scope-aware.
- `listConversations` returns the project's **chats** (grouped by `conversationId`), with
  the first instruction as the title, plus last message, status and time.
- `helpers/attachments.js` — the storage key is scoped by the conversation or task, and the
  scope segment is sanitised. It is currently interpolated raw, which lets a crafted id
  write outside its prefix; fixed here because this is the line being changed.

**Runner — `scripts/dev-agent/dev-agent.js`**
- A chat job skips `fetchTask` / `fetchComments`.
- Branch scope `chat-<short id>`, memory at `.alianhub/chats/<id>.md`, PR body that
  references the chat rather than a task.
- Prior conversation still fed back in, read by `conversationId`.
- Attachment download and every reply carry the conversation scope.

**Frontend**
- `DevelopmentChat.vue` gains a `conversationId` prop and uses it wherever it currently
  uses `taskId`. One component serves both surfaces; the task tab passes what it always did.
- `ProjectDevChat.vue` — rail of chats + "New chat", which mints a client-side id; the chat
  materialises server-side on the first message, as Claude Desktop does.
- Header icon + the mobile dropdown row, both gated.

## Out of scope

- **Deep-linking / browser Back.** No route coupling, matching all fourteen existing
  project overlays.
- **A new project view / `+ View` entry.** `PROJECT_TAB_COMPONENTS` is seeded only at
  company import, so a registered view is invisible to existing companies without a DB
  insert.
- **Renaming a chat**, and any `dev_conversations` collection.
- **Socket.io streaming and a completion notification.** Real gaps, pre-existing; the window
  polls exactly as the tab does. Tracked separately.
- Any change to the per-task Development tab's behaviour.

## Acceptance criteria

1. One gated icon in the project header opens the window; present on mobile via the
   three-dots dropdown. Gate is
   `checkApps('AI', projectData) && checkPermission(<rule>, projectData?.isGlobalPermission) === true`
   — explicit `=== true`, since `checkPermission` is tri-state and returns `null` for
   "no rule configured".
2. "New chat" then an instruction develops on the codebase and replies in that thread, with
   **no task anywhere** in the flow.
3. The rail lists the project's chats, newest activity first, titled by their first
   instruction, each showing last message and live status.
4. Attachments, approve/reject, stop and PR actions all work in a chat thread.
5. A message can never be saved with both scopes or neither.
6. The window is keyed on `projectData._id`; switching project cannot show another
   project's chats.
7. Escape and the backdrop close it; it renders above every existing overlay.
8. The per-task Development tab is unchanged in behaviour: loads, polls, sends, attaches,
   shows PR actions, and its messages still carry `taskId`.
9. No new rule in `molecules/Sidebar/style.css` (unscoped, 50 consumers).
10. ESLint clean on every touched file.
