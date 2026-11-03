---
id: 067
title: Connectors — end a member's connections on removal, deactivation or SCIM, plus a daily sweep
status: backlog
priority: high
depends_on: [066]
created: 2026-10-28
---

# 067 — Connectors — end a member's connections on removal, deactivation or SCIM, plus a daily sweep

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
No connection outlives its person's membership.

## Scope
- Hook member removal, deactivation and SCIM deprovisioning to revoke every connection of that person; a failure never blocks the removal (FR-14)
- Idempotent daily sweep that ends anything missed
- `connector.revoke` audit

## Out of scope
- Anything not listed above; see the 056 PRD for the neighbouring sub tasks

## Acceptance criteria
- [ ] Removing a member revokes at the provider and clears secrets
- [ ] A removal made while the provider was down is caught by the next sweep
- [ ] Running the sweep twice changes nothing the second time

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 066
- Extend `Modules/Agents/connectors/memberDeparted.js`.
