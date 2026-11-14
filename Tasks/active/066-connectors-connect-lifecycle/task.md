---
id: 066
title: Connectors — generic connect, products, reconnect and disconnect handlers
status: backlog
priority: high
depends_on: [065]
created: 2026-10-28
---

# 066 — Connectors — generic connect, products, reconnect and disconnect handlers

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). Delivers FR-8–13, FR-15 and FR-17. Its decisions and section 10 (security, privacy, testability, feature flag) apply here. Built against the 063 contract (`Tasks/active/063-connectors-provider-definition/resources/contract.md`), section 5.

## Goal

One connect lifecycle for every provider, built on the existing four-step flow, so no provider needs its own routes. It produces module-shaped `connector_connections` rows and the real `resolveConnection` that track B (068) has been calling as a stub.

## Scope

- `POST /api/v2/connectors/:provider/connect` and `/complete`, public `GET /api/v1/connector-oauth/:provider/callback` (rate-limited), signed ten-minute single-use state, PKCE S256 (FR-8)
- Store only granted scopes (FR-9) — includes dropping `include_granted_scopes: 'true'` from the Google provider definition so Google does not re-return earlier grants; `PUT .../connections/:id/products` with incremental consent (FR-10)
- Reconnect: same account replaces tokens, different account revokes the earlier grant (FR-11)
- `DELETE .../connections/:id`: revoke unless another live connection of the same person shares the grant, retire secrets, close row (FR-12)
- Membership checked at every use (FR-13); tokens only by handle, none in any response/log/socket/audit (FR-15); refresh on use (one attempt), a `deadGrantErrors` code → `broken`, any other failure fails that one call (FR-17)
- The real `resolveConnection` exactly as the 063 contract defines it, plus `getAccessToken` and `markBackoff`; track B's stub body is replaced on this task
- `GET /api/v2/connectors` for the member (providers offered + own connections); `agentsRefused`, audit (`connector.connect`, `connector.products_changed`, `connector.broken`, `connector.revoke`), socket emit, cache clear

## Out of scope

- Member-removal sweep (067)
- Admin overview, My-connections and company-app screens (072)
- Migrating the existing `google_calendar` rows and retiring the old Google/Slack paths (073, 077) — the old `Modules/Agents/connectors/googleConnection.js`, `googleController.js` and their routes keep running in parallel; 066 adds nothing to them and removes none of them
- Quotas, usage counting, backoff accounting and tools (068–070) — 066 only exposes `markBackoff` for B to call

## Contract — `resolveConnection.js` (063 §5)

Track A builds it, track B calls it. 066 replaces the stub body and keeps the exported `CODE` and `ConnectorError`.

```js
resolveConnection({ companyId, userId, provider })  // → { connectionId, scopes, getAccessToken } | throws ConnectorError
getAccessToken()                                     // → Promise<string>; refreshes on use; throws ConnectorError `broken`
markBackoff({ companyId, connectionId, until })      // → Promise<void>; B calls it on a rate-limit signal
```

Codes: `not_connected`, `not_member`, `broken`, `provider_off` (`scope_missing` is B's). Only the person's own connection is returned; the access token never leaves the caller of `getAccessToken()`.

Row shape is the module shape from 064/contract §6: `handles { access, refresh }`, `account { id, label }`, `scopes[]` as granted, `app { source, appId }`, `status` in `pending|connected|broken|reauth_required|revoked`. (The legacy Google rows use `secretHandles`/`account{email,sub}`; those stay with the old module until 073.)

## File plan

Mostly new generic files that lift and generalise the proven flow from `googleConnection.js` (state/PKCE/fragment-complete, refresh-on-use, revoke-unless-shared), driven by the registry and the 065 company-app lookup instead of hardcoded Google. The old Google files are left untouched.

### New (create)

| File | What |
|---|---|
| `Modules/Connectors/connection.js` | generic lifecycle engine: `start`, `complete`, `returnFor` (public callback target), `setProducts`, `disconnect`, plus `usableAccessToken`/refresh and `describe`/`list` for `GET /api/v2/connectors`. Writes module-shaped rows via `registry` + `apps.resolveApp` |
| `Modules/Connectors/providerApi.js` | generic OAuth HTTP through `agentFetch`: `consentUrl`, `exchange`, `refresh`, `revoke`, reading `authorizeUrl`/`tokenUrl`/`revokeUrl`/`pkce`/`extraParams`/`baseScopes` from the provider definition; account read delegated to the definition's `readAccount` |
| `Modules/Connectors/connectorsController.js` | member-level HTTP handlers (person/seat guards generalised from `googleController.js`): connect, complete, callback, products, disconnect, list |
| `tests/helpers/fakeProvider.js` | a fake provider definition + stubbed authorize/token/revoke endpoints, so the lifecycle is tested with no real credential (FR non-functional: testability) |
| `tests/connector-lifecycle.test.js` | fake provider connects end to end; reused/expired state refused; two accounts isolated; disconnect revokes + clears secrets; no token in any response/log/socket/audit (asserted) |
| `tests/connector-resolve.test.js` | `resolveConnection`/`getAccessToken` refresh-on-use, `broken` on dead grant, membership checked, `markBackoff` write (may be folded into the lifecycle test if small) |

### Changed (edit)

| File | Change |
|---|---|
| `Modules/Connectors/resolveConnection.js` | replace the 063 stub body with the real lookup; add `getAccessToken` and `markBackoff`; keep `CODE` + `ConnectorError` exports |
| `Modules/Connectors/routes.js` | register the generic routes (`:provider` connect/complete, public callback, `connections/:id` products/delete, `GET /api/v2/connectors`), gated by the registry being offered; the two public-callback limiters reused |
| `Modules/Connectors/providers/google/index.js` | one-line fix (PR #1735 review): drop `include_granted_scopes: 'true'` from `auth.extraParams`, keep `access_type: 'offline'` (needed for the refresh token). With the param set Google re-returns previously granted scopes, so a connection's stored `scopes` would not reflect only what this flow granted; dropping it keeps FR-9 and incremental consent (FR-10) exact |

### Not changed (done earlier or later)

- `utils/mongo-handler/schema.js` — `connectorConnections` already has `provider`, `products`, `app`, `status`, `scopes`, `account` (064)
- `registry.js`, `validate.js`, `apps.js` — 063 and 065 (the google definition gets only the one-line `extraParams` fix above)
- `googleConnection.js`, `googleController.js`, `flag.js`, old Google routes — retired in 073/077, not here

Decided (2026-10-31): a separate `connectorsController.js` for the member-level handlers, leaving `controller.js` for the manager-level Slack/apps handlers (the same split the legacy `googleController.js` kept); `connector-resolve.test.js` folded into `connector-lifecycle.test.js`. **5 new files, 5 edited**, no frontend/i18n (screens are 072).

## Acceptance criteria

- [ ] A fake provider connects end to end through the four steps
- [ ] Reused or expired state is refused
- [ ] Two people connect the same provider with different accounts and each gets only their own
- [ ] Ticking a new product asks only for its scopes (incremental consent) on the same connection
- [ ] Reconnect with the same account replaces tokens; with a different account the earlier grant is revoked
- [ ] Disconnect calls the provider revoke (unless shared) and clears secrets
- [ ] A guest / removed / deactivated member is refused with `not_member`; a dead grant on refresh marks the row `broken`
- [ ] No token in any response, log, socket event or audit row (asserted)
- [ ] `resolveConnection` returns the contract shape and track B's existing tests still pass against it

## Constraints & notes

- Track: A — connections (getting and keeping a person's token). Depends on: 065.
- Generalise the flow from `Modules/Agents/connectors/googleConnection.js` and `Modules/Connectors/googleController.js`; do not rewrite them in place and do not remove them (that is 073/077).
- Reuse as is: the secrets store (`Config/secrets.js`, kind `connector`), `agentFetch` + the egress allow-list, the signed-state/PKCE/fragment-complete pattern, the audit words `connector.*`.
- Security (FR-15/16, §10): company scoping on every query; state signed, short-lived, single-use, bound to session; public callback rate-limited; `/security-review` on the PR.
- Branch and flow per the team convention: one branch `feat/task-066-…` off the 065 tip, task moved to active when work starts.
