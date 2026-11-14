---
id: 064
title: Connectors — data model: evolve connector_connections, add connector_apps and connector_usage
status: active
priority: high
depends_on: [063]
created: 2026-10-28
---

# 064 — Connectors — data model: evolve connector_connections, add connector_apps and connector_usage

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Store connections keyed by connection id with health, app source and handles, so every tool, audit row and proposal can name one connection.

## Scope
- `connector_connections` fields of PRD section 8, declared in the strict schema
- Partial unique index (`companyId`, `userId`, `provider`, `account.id`) for live rows: a person may connect several accounts of one provider, each once (decided on the PR #1738 review)
- `connector_apps` and `connector_usage` collections (or row counters if 061 shows that is enough)
- SCHEMA_TYPE entries; every query company-scoped

## Out of scope
- Data migrations of existing rows (073–076)

## Acceptance criteria
- [x] The same account connected twice by one person is refused by the index; a second account of the same provider is allowed
- [x] A disconnected row does not block a new connection
- [x] Schemas declared; no hard-coded collection names
- [x] A module row (one with `provider`) cannot be saved without `companyId`

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 063
