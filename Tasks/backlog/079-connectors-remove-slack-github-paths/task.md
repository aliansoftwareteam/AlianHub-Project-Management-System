---
id: 079
title: Connectors — remove the old Slack bot and GitHub sync paths
status: backlog
priority: medium
depends_on: [074, 075]
created: 2026-10-28
---

# 079 — Connectors — remove the old Slack bot and GitHub sync paths

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Track B's old connection paths are gone.

## Scope
- Delete `slackConnection.js`, `slackApi.js`, `slackRead.js`, `slackPost.js`, the `Modules/Integrations/appConnections` GitHub sync and the `APP_CONNECTIONS` flag
- Keep the Slack slash command and the rest of the `integration_connections` catalogue (FR-38)

## Out of scope
- Google Calendar and CloudStorage old paths (077, track A)

## Acceptance criteria
- [ ] No caller of the removed paths remains
- [ ] Full test suite, i18n, style and API-doc checks pass

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 074, 075
