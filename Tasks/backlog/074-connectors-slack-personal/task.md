---
id: 074
title: Connectors — Slack as a personal OAuth provider; retire the workspace bot
status: backlog
priority: medium
depends_on: [069, 070, 078]
created: 2026-10-28
---

# 074 — Connectors — Slack as a personal OAuth provider; retire the workspace bot

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Slack is used with each person's own Slack user token, and the workspace bot is gone.

## Scope
- Research first: Slack user-token OAuth scopes for channel read and message post, HTTPS redirect constraint, revoke, rate limits; a Slack row in `056-personal-app-connectors/resources/research-matrix.md`
- Slack provider definition (user token) in the contract's format
- `slack.channel.read` and `slack.message.post` redefined on the person's token and the channels they can see (FR-36)
- Retire bot token, signing secret and channel allow-list; revoke their secrets; tell admins
- Tunnel note for local development (HTTPS redirect)
- Setup page

## Out of scope
- The Slack slash command (FR-38 — stays)

## Acceptance criteria
- [ ] Reads are capped and tainted; posts are proposals
- [ ] Bot secrets revoked and removed
- [ ] Tested against a fake Slack server

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 069, 070, 078
- Replaces `slackConnection.js`, `slackApi.js`, `slackRead.js`, `slackPost.js`.
