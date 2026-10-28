---
id: 076
title: Connectors — Drive/Dropbox attachment picker on the module
status: backlog
priority: medium
depends_on: [066, 072]
created: 2026-10-28
---

# 076 — Connectors — Drive/Dropbox attachment picker on the module

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
The attachment picker uses each person's module connection with the instance or company app, and nobody can pick from another person's account.

## Scope
- Drive through the person's Google connection with Drive ticked; Dropbox provider definition (FR-39)
- Short-lived `drive.file` picker token to the owner's own session only; no route takes another person's id (FR-15, FR-40)
- Remove per-person app settings; migrate `cloud_storage_connections` rows or ask once to reconnect; delete stored client secrets
- Disconnect revokes at the provider

## Out of scope
- Anything not listed above; see the 056 PRD for the neighbouring sub tasks

## Acceptance criteria
- [ ] Picker works with no per-person app
- [ ] Another person's session cannot get a picker token or import
- [ ] Stored client secrets deleted; migration safe to run twice

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 066, 072
- `Modules/CloudStorage` today stores the client secret unsealed (`sanitizeAppConfig`, `saveSettings`) and never revokes.
