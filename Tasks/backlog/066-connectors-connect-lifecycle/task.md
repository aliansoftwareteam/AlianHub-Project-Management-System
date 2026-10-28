---
id: 066
title: Connectors — generic connect, products, reconnect and disconnect handlers
status: backlog
priority: high
depends_on: [065]
created: 2026-10-28
---

# 066 — Connectors — generic connect, products, reconnect and disconnect handlers

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
One connect lifecycle for every provider, built on the existing four-step flow, so no provider needs its own routes.

## Scope
- `POST /api/v2/connectors/:provider/connect` and `/complete`, public `GET /api/v1/connector-oauth/:provider/callback` (rate-limited), signed ten-minute single-use state, PKCE S256 (FR-8)
- Store only granted scopes (FR-9); `PUT .../connections/:id/products` with incremental consent (FR-10)
- Reconnect: same account replaces tokens, different account revokes the earlier grant (FR-11)
- `DELETE .../connections/:id`: revoke unless shared, retire secrets, close row (FR-12)
- Membership checked at every use (FR-13); tokens only by handle (FR-15); refresh on use, `invalid_grant` → `broken` (FR-17)
- `GET /api/v2/connectors` for the member; `agentsRefused`, audit, socket emit, cache clear

## Out of scope
- Member-removal sweep (067)
- Screens (072)

## Acceptance criteria
- [ ] A fake provider connects end to end through the four steps
- [ ] Reused or expired state is refused
- [ ] Two people connect the same provider with different accounts and each gets only their own
- [ ] Disconnect calls the provider revoke and clears secrets
- [ ] No token in any response, log, socket event or audit row (asserted)

## Constraints & notes
- Depends on: 065
- Generalise `Modules/Agents/connectors/googleConnection.js` and `Modules/Connectors/googleController.js` rather than writing new flow code.
