---
id: 075
title: Connectors — GitHub as a personal, on-demand provider; retire the task 049 sync
status: backlog
priority: medium
depends_on: [069, 070, 078]
created: 2026-10-28
---

# 075 — Connectors — GitHub as a personal, on-demand provider; retire the task 049 sync

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
PRs are looked up and linked on request with the caller's own GitHub connection; the workspace sync is gone.

## Scope
- Research first: GitHub OAuth app vs GitHub App for personal on-demand PR lookup, scopes, token expiry, revoke; a GitHub row in `056-personal-app-connectors/resources/research-matrix.md`
- GitHub provider definition in the contract's format
- `pull_request.get` and new link tools on the caller's connection (FR-37)
- Retire the workspace connection, repo-to-project mapping, cron runner and their screens, with a migration
- Tell admins before the migration runs
- Setup page

## Out of scope
- Anything not listed above; see the 056 PRD for the neighbouring sub tasks

## Acceptance criteria
- [ ] A member links a PR to a task through their own connection
- [ ] The cron runner and mapping screens are removed
- [ ] Migration safe to run twice; admins notified first
- [ ] Tested against a fake GitHub server

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 069, 070, 078
