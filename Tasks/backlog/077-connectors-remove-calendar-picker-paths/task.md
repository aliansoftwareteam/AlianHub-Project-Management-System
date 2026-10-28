---
id: 077
title: Connectors — remove the old Google Calendar and CloudStorage paths; Google and Dropbox setup pages
status: backlog
priority: medium
depends_on: [073, 076]
created: 2026-10-28
---

# 077 — Connectors — remove the old Google Calendar and CloudStorage paths; Google and Dropbox setup pages

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Track A's old connection paths are gone, and instance and company admins have setup pages for Google and Dropbox.

## Scope
- Delete the old Google Calendar connection code (`googleConnection.js`, `googleController.js`) and the `Modules/CloudStorage` per-person app paths, with their flags
- Setup pages for Google and Dropbox (instance app and company override)

## Out of scope
- Slack and GitHub old paths (079, track B)
- The `integration_connections` catalogue (FR-38 — stays)

## Acceptance criteria
- [ ] No caller of the removed paths remains
- [ ] Full test suite, i18n and style checks pass
- [ ] Google and Dropbox setup pages exist

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 073, 076
