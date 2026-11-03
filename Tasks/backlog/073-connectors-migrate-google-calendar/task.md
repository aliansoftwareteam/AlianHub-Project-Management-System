---
id: 073
title: Connectors — migrate Google Calendar connections onto the Google provider
status: backlog
priority: medium
depends_on: [064, 066]
created: 2026-10-28
---

# 073 — Connectors — migrate Google Calendar connections onto the Google provider

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Existing Calendar connections keep working as Google connections with Calendar ticked.

## Scope
- Migration of `connector_connections` Google Calendar rows to the new shape (FR-35)
- Existing grants keep working; no reconnect asked

## Out of scope
- Calendar tools (071, track B); checked together in the joint end-to-end test of 056

## Acceptance criteria
- [ ] Migration is safe to run twice
- [ ] A migrated row resolves through `resolveConnection` and refreshes its token without reconnecting

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 064, 066
