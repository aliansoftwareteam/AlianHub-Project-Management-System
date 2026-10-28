---
id: 077
title: Connectors — remove the old connection paths and finish the setup docs
status: backlog
priority: medium
depends_on: [073, 074, 075, 076]
created: 2026-10-28
---

# 077 — Connectors — remove the old connection paths and finish the setup docs

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Only the module remains; instance and company admins have one setup page per provider.

## Scope
- Delete the old Slack, GitHub app-connection, Google Calendar and CloudStorage code paths and flags
- Keep the `integration_connections` catalogue (FR-38)
- Setup pages for every migrated provider (instance and company override)
- Close 056 Phase 1–2 in its progress

## Out of scope
- Anything not listed above; see the 056 PRD for the neighbouring sub tasks

## Acceptance criteria
- [ ] No caller of the removed paths remains
- [ ] Full test suite, i18n, style and API-doc checks pass
- [ ] A setup page per provider exists

## Constraints & notes
- Depends on: 073, 074, 075, 076
