---
id: 063
title: Connectors — the two-track contract, provider definition format, registry and the Google provider file
status: active
priority: high
depends_on: []
created: 2026-10-28
---

# 063 — Connectors — the two-track contract, provider definition format, registry and the Google provider file

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Fix the contract both tracks build against, then make a provider one definition file, so adding a connector needs no new route, collection, screen or registry file.

## Scope
- **Contract, day 1, written by both interns and checked in as `resources/contract.md`:** the provider definition shape; the `connector_connections`, `connector_apps` and `connector_usage` fields (PRD section 8, built in 064); and `resolveConnection({ companyId, userId, provider })` returning `{ connectionId, scopes, getAccessToken() }` or a "connect <provider> on My connections" refusal
- Tools live in their own file beside each provider definition (`providers/<id>/tools.js`), so the two tracks never edit the same file
- Contract changes after day 1 need both interns to agree, recorded in this task's progress
- Definition shape: id, display name, auth (authorize/token endpoints, PKCE, extra params), scopes per product and per tool, account id and label reader, refresh, revoke, egress hosts, rate-limit signals, tools (FR-1)
- Registry that loads definitions and offers a provider only when named in `CONNECTORS` and an OAuth app is configured (FR-2)
- Products as ticks, scopes the union of ticked products (FR-3)
- The Google provider file with Calendar, Meet and Drive products (no tools yet; task 071)

## Out of scope
- Routes and storage (064–066)
- Tool registration (068)

## Acceptance criteria
- [x] `resources/contract.md` exists, agreed by both interns, before track B starts 068
- [x] A test adds a fake provider by one file and it appears in the registry with no other change
- [x] A provider missing from `CONNECTORS` or with no app is not offered
- [x] Scope union per ticked products is tested

## Constraints & notes
- Track: A — connections (getting and keeping a person's token) (contract written with B)
- Depends on: nothing; can start now
- The Google research of 061 feeds the Google provider file; the contract itself does not wait for it. Replaces the sync-only `Modules/Integrations/appConnections/registry.js` interface for connectors; Google today lives in `Modules/Agents/connectors/googleConnection.js`.
