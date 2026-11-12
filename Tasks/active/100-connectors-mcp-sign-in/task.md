---
id: 100
title: Connectors — sign-in for MCP apps: discovery, self-registration once per workspace, personal tokens
status: active
priority: high
depends_on: [066, 092]
created: 2026-11-12
---

# 100 — Connectors — sign-in for MCP apps: discovery, self-registration once per workspace, personal tokens

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A member connects an MCP app through the same connect flow as Google and Slack, whichever way that app signs in: an app that registers itself needs no setup on any install, and an app that takes personal tokens needs none either.

## Scope
- **Discovery** (FR-8): for a provider with `transport: 'mcp'`, read the server's protected-resource metadata and its authorization server's metadata. The authorize, token, revoke and registration endpoints come from there unless the definition pins them; every host must be in the definition's `egressHosts`.
- **Self-registration** (FR-41):
  - Dynamic client registration, or a client ID metadata document served at an `<APIURL>` address.
  - Done once per workspace per server, stored in a new `connector_registrations` collection (client id, secret handle if any, method, date), and reused by every member of that workspace.
  - Never once per member or per session.
  - A registration the server forgets is redone once, then the connect step fails with a clear reason.
- **Personal tokens** (FR-42): `POST /api/v2/connectors/:provider/token`. The token is checked with one read before it is saved, stored by handle in the secrets store like an OAuth token, never shown again, and deleted on disconnect.
- **Offered** (FR-2): `registry.isOffered` accepts a provider that registers itself or takes personal tokens without an instance or company app.
- **Account** (FR-1, `readAccount`): an MCP app whose token answer names no account reads it with one allowed tool call after the exchange.
- Audit `connector.connect` with the sign-in kind. No token or client secret in any response, log, event or audit row.

## Out of scope
- Apps that need a registered app: the existing app lookup (065) and the hosted service (093) cover them
- The screens: the existing Connections page connects any offered provider; the redesign is 101

## Acceptance criteria
- [x] Against a fake self-registering server, a member connects with nothing in `.env`; a second member and a second session reuse the same registration
- [x] A forgotten registration is redone once, never in a loop
- [x] A personal token that fails its check read is not saved; a saved one is never returned
- [x] Two members connect the same MCP app with different accounts; each reaches only their own
- [x] Google and Slack connect exactly as before (their tests pass unchanged)

## Constraints & notes
- Track: A — connections (getting and keeping a person's access)
- Phase 1. Depends on: 066 (built), 092
- Extend `Modules/Connectors/connection.js` and `apps.js` rather than adding a second flow; record any contract change in 063's progress.
- The SDK's client auth helpers (`@modelcontextprotocol/sdk/client/auth.js`) may be used for discovery and registration, with their requests through `safeFetch`.
