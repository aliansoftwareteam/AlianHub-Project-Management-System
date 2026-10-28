---
id: 070
title: Connectors — audit, health, usage counts, quotas and provider backoff
status: backlog
priority: high
depends_on: [063, 068]
created: 2026-10-28
---

# 070 — Connectors — audit, health, usage counts, quotas and provider backoff

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Every connector call is attributable, counted and limited.

## Scope
- Audit: `connector.call` per call (person, agent or MCP client, connection, provider, tool, outcome, counts — hashes, no content); `connector.connect`, `products_changed`, `broken` (FR-26)
- Health: status, token expiry, last used, last error; notify the person when action is needed (FR-27)
- Usage per connection, person and agent by day (FR-28)
- Quotas: 500 reads / 50 write proposals per person, 200 reads per agent; workspace/member/agent overrides under the `.env` ceiling; refusal names the limit and reset (FR-29)
- Provider rate limits with backoff and `Retry-After` (`backoffUntil`)
- `PUT /api/v2/connectors/admin/quotas`

## Out of scope
- Admin overview screen (072)
- Quota settings screen (078)

## Acceptance criteria
- [ ] One audit row per call; usage counts match calls
- [ ] A call over quota is refused with the limit and reset time
- [ ] An admin cannot set a quota above the instance ceiling
- [ ] A `Retry-After` from the provider delays the next call

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 063, 068
- Writes `connector_usage` and connection health fields in the shape the contract (063) fixes; 064 creates the collection, so until it lands use the contract schema in tests. Reuse `Modules/Integrations/appConnections/backoff.js`.
