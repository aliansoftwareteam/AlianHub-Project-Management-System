---
id: 097
title: Connectors in the AI chat — @mention or name an app, read with the asker's own account
status: backlog
priority: high
depends_on: [075, 087, 092]
created: 2026-11-12
---

# 097 — Connectors in the AI chat — @mention or name an app, read with the asker's own account

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
In the AI chat, a member asks "what is the status of this PR?" or "@Notion what changed on the roadmap page?". The answer is read through their own connection and cites what it read.

## Scope
- The `@` picker (task 087) gains a Connectors group: connected apps first, then available ones with Connect, which signs in and returns to the chat. A picked connector is a chip sent as `{ kind: 'connector', id }` (FR-56); `GET /api/v1/ai/ask/mentions` returns the group.
- Typing a connected app's name as a whole word adds its chip, which the asker can remove before sending; an unconnected name adds nothing (FR-57)
- On the server, one read step for each connector chip (FR-58):
  - Rules first: a pull request link or `owner/repo#123` goes straight to `github.pull_request.read`.
  - Otherwise one model call returns at most three read calls as JSON.
  - Each call is checked against the connector's turned-on read tools and their input schemas, then run on the asker's connection.
- Reads become sources the answer cites; taint, caps and usage as for any connector read; no web fetch after (FR-59)
- A requested change becomes an Inbox proposal, and the answer says so (FR-60)
- Strings via i18n; colours from tokens

## Out of scope
- A tool-calling loop beyond the one read step; a per-chat connectors menu (056 §12)
- The command palette's one-shot Ask

## Acceptance criteria
- [ ] `@GitHub` and typing "GitHub" both add the chip; removing it before sending stops the read
- [ ] A pull request link in the question is read through the asker's GitHub and cited, with no model call to pick it
- [ ] A model-picked call outside the turned-on read tools, or with arguments that fail the schema, is refused
- [ ] A member without the connection is told "connect GitHub on Connectors"
- [ ] "Comment on that PR" lands in the Inbox, not in GitHub
- [ ] Unit tests: name matching, chip payload, the read step's checks, the pull request rule

## Constraints & notes
- Track: B — tools (using that access safely)
- Phase 1, for the "status of this PR" check. Depends on: 075, 087, 092
- Extend `Modules/AI/askMentions.js`, `askContext.js`, `AskComposerMenu.vue` and the composer (`useAskComposer.js`, `askComposer.js`). The read step uses `parseModelJson` from `Modules/AICore/modelCall.js`, so it works with every configured model and needs no tool calling in the provider layer.
