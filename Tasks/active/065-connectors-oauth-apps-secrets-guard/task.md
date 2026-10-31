---
id: 065
title: Connectors — OAuth app lookup (instance default, company override) and the secrets-store guard
status: backlog
priority: high
depends_on: [063, 064]
created: 2026-10-28
---

# 065 — Connectors — OAuth app lookup (instance default, company override) and the secrets-store guard

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Resolve which OAuth app serves a workspace and refuse to run without a usable secrets store, so no client secret is ever stored in clear.

## Scope
- Instance default from `CONNECTOR_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET`; existing `CONNECTOR_GOOGLE_*` keep working (FR-4)
- Company override: set/replace/remove handlers, secret to the secrets store, never returned (FR-5)
- Connections record the issuing app; changing or removing a company app marks its connections `reauth_required` (FR-6)
- Redirect URI from `APIURL` only (FR-7)
- Module refuses to switch on without `SECRETS_STORE` and a usable `SECRETS_KEY`: one startup log line, reason for the admin screen (FR-16)
- `connector.app_set` audit

## Out of scope
- The company apps screen (072)

## Acceptance criteria
- [x] Company app wins for its workspace only; other workspaces keep the instance default
- [x] Replacing a company app marks its connections `reauth_required`
- [x] No response, log or audit row contains a client secret (asserted)
- [x] Without the secrets store the module stays off with a clear reason

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 063, 064
- Changing or removing a company app moves its `connected` connections to `reauth_required`; a `broken` connection stays `broken` (it already signals that the person must reconnect, so it is left alone).
- The company app handlers live under `/api/v2/connectors/apps/:provider` (not `/:provider/app`), so the provider segment never collides with a provider's own `/:connector` routes.
