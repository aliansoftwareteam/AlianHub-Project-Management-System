---
id: 072
title: Connectors — My connections, admin overview, company apps, quotas and approval cards
status: backlog
priority: high
depends_on: [066, 069, 070]
created: 2026-10-28
---

# 072 — Connectors — My connections, admin overview, company apps, quotas and approval cards

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Members manage their own connections and approve writes; admins oversee and end connections without ever using them.

## Scope
- "My connections" on the Connections page: providers, connect, products, status, usage, reconnect, disconnect (FR-31)
- Admin overview per member: provider, products, scopes, status, dates, usage, "End connection" — no account label, no tokens (FR-30); `GET /api/v2/connectors/admin/connections`
- Company OAuth apps list: instance default / company app, redirect URI to copy, set/replace/remove (FR-32)
- Quota settings
- Inbox approval card per tool kind (FR-33)
- All strings under `Connectors.*` in i18n; colours from tokens (FR-34)

## Out of scope
- Anything not listed above; see the 056 PRD for the neighbouring sub tasks

## Acceptance criteria
- [ ] A member can do every lifecycle action from the screen
- [ ] An admin can end a connection but no route lets them use it
- [ ] Approval card shows recipient/target, title, full text and attachments
- [ ] `i18n:check` and `style:check` pass

## Constraints & notes
- Depends on: 066, 069, 070
