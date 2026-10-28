---
id: 061
title: Connectors research — confirm Google, Slack, GitHub and Dropbox before the build
status: backlog
priority: high
depends_on: []
created: 2026-10-28
---

# 061 — Connectors research — confirm Google, Slack, GitHub and Dropbox before the build

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Confirm, against current provider documentation, every provider fact the module and the migration rely on, so Phase 1 and 2 build on checked facts rather than memory.

## Scope
- Google Calendar, Meet (Meet REST API) and Drive (`drive.file`): scopes and their sensitivity, incremental consent, token life, revoke endpoint, verification needed
- Slack user-token OAuth: scopes for channel read and message post, HTTPS redirect constraint, revoke, rate limits
- GitHub OAuth app vs GitHub App for personal on-demand PR lookup: scopes, token expiry, revoke
- Dropbox OAuth for the attachment picker: scopes, PKCE, refresh, revoke
- Per-instance vs per-company app review for a self-hosted product
- Result in `056-personal-app-connectors/resources/research-matrix.md`, the rows for these four providers

## Out of scope
- The new connectors and Gmail CASA quotes (task 062)

## Acceptance criteria
- [ ] Each of the four providers has a filled matrix row: auth type, per-person support, least scopes, review needed, token life, limits, callback constraints, verdict
- [ ] Every fact names the documentation page it came from and the date checked
- [ ] Anything that contradicts the PRD is listed for the owner

## Constraints & notes
- Depends on: nothing; can start now
