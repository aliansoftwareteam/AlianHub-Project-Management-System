---
id: 063
title: Connectors — provider definition format, registry and the Google provider file
status: backlog
priority: high
depends_on: [061]
created: 2026-10-28
---

# 063 — Connectors — provider definition format, registry and the Google provider file

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Make a provider one definition file, so adding a connector needs no new route, collection, screen or registry file.

## Scope
- Definition shape: id, display name, auth (authorize/token endpoints, PKCE, extra params), scopes per product and per tool, account id and label reader, refresh, revoke, egress hosts, rate-limit signals, tools (FR-1)
- Registry that loads definitions and offers a provider only when named in `CONNECTORS` and an OAuth app is configured (FR-2)
- Products as ticks, scopes the union of ticked products (FR-3)
- The Google provider file with Calendar, Meet and Drive products (no tools yet; task 071)

## Out of scope
- Routes and storage (064–066)
- Tool registration (068)

## Acceptance criteria
- [ ] A test adds a fake provider by one file and it appears in the registry with no other change
- [ ] A provider missing from `CONNECTORS` or with no app is not offered
- [ ] Scope union per ticked products is tested

## Constraints & notes
- Depends on: 061
- Replaces the sync-only `Modules/Integrations/appConnections/registry.js` interface for connectors; Google today lives in `Modules/Agents/connectors/googleConnection.js`.
