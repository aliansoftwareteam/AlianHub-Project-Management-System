---
id: 061
title: Connectors research — confirm Google and Dropbox before the build
status: active
priority: high
depends_on: []
created: 2026-10-28
---

# 061 — Connectors research — confirm Google and Dropbox before the build

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Confirm, against current provider documentation, every Google and Dropbox fact the module relies on, so Phase 1 builds on checked facts rather than memory.

## Scope
- Google Calendar, Meet (Meet REST API) and Drive (`drive.file`): scopes and their sensitivity, incremental consent, token life, revoke endpoint, verification needed
- Dropbox OAuth for the attachment picker: scopes, PKCE, refresh, revoke
- Per-instance vs per-company app review for a self-hosted product
- Result in `056-personal-app-connectors/resources/research-matrix.md`, the rows for these providers

## Out of scope
- Slack and GitHub (researched in 074 and 075, track B)
- The new connectors and Gmail CASA quotes (task 062)

## Acceptance criteria
- [x] Google and Dropbox have filled matrix rows: auth type, per-person support, least scopes, review needed, token life, limits, callback constraints, verdict
- [x] Every fact names the documentation page it came from and the date checked
- [x] Anything that contradicts the PRD is listed for the owner

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: nothing; can start now
