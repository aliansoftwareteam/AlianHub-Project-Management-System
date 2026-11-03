---
id: 072
title: Connectors — My connections, admin overview and company apps screens
status: backlog
priority: high
depends_on: [066]
created: 2026-10-28
---

# 072 — Connectors — My connections, admin overview and company apps screens

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Members manage their own connections; admins oversee and end connections without ever using them.

## Scope
- "My connections" on the Connections page: providers, connect, products, status, usage, reconnect, disconnect (FR-31)
- Admin overview per member: provider, products, scopes, status, dates, usage, "End connection" — no account label, no tokens (FR-30); `GET /api/v2/connectors/admin/connections`
- Company OAuth apps list: instance default / company app, redirect URI to copy, set/replace/remove (FR-32)
- All strings under `Connectors.*` in i18n; colours from tokens (FR-34)

## Out of scope
- Inbox approval cards and quota settings (078, track B)

## Acceptance criteria
- [ ] A member can do every lifecycle action from the screen
- [ ] An admin can end a connection but no route lets them use it
- [ ] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 066
- Usage is read from `connector_usage` in the contract's shape (063); it shows zero until track B's 070 counts calls, which needs no change here.
