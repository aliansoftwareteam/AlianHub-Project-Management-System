---
id: 078
title: Connectors — Inbox approval cards and quota settings screens
status: backlog
priority: high
depends_on: [069, 070]
created: 2026-10-28
---

# 078 — Connectors — Inbox approval cards and quota settings screens

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Members approve outside writes from cards that show exactly what goes out; admins set quotas.

## Scope
- Inbox approval card per tool kind: recipient or target, title, the whole text, attachments; edit re-validates and shows again (FR-23, FR-33)
- Quota settings for the workspace, a member or an agent, capped at the instance ceiling (FR-29)
- All strings under `Connectors.*` in i18n; colours from tokens (FR-34)

## Out of scope
- My connections, admin overview and company apps (072, track A)

## Acceptance criteria
- [ ] Approval card shows recipient/target, title, full text and attachments
- [ ] Only the connection owner sees the approve action
- [ ] A quota above the ceiling is refused on screen with the reason
- [ ] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 069, 070
