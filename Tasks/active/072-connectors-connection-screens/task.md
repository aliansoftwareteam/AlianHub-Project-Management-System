---
id: 072
title: Connectors — My connections, admin overview and company apps screens
status: backlog
priority: high
depends_on: [066]
created: 2026-10-28
---

# 072 — Connectors — My connections, admin overview and company apps screens

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Members manage their own connections; admins oversee and end connections without ever using them.

## Scope
- "My connections" on the Connections page: providers, connect, products, status, usage, reconnect, disconnect (FR-31)
- Admin overview per member: provider, products, scopes, status, dates, usage, "End connection" — no account label, no tokens (FR-30); `GET /api/v2/connectors/admin/connections`
- Company OAuth apps list: instance default / company app, redirect URI to copy, set/replace/remove (FR-32)
- All strings under `Connectors.*` in i18n; colours from tokens (FR-34)

## Out of scope
- Inbox approval cards and quota settings (078, track B)

## Acceptance criteria
- [ ] A member can do every lifecycle action from the screen
- [ ] An admin can end a connection but no route lets them use it
- [ ] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: A — connections (getting and keeping a person's token)
- Depends on: 066
- Usage is read from `connector_usage` in the contract's shape (063); it shows zero until track B's 070 counts calls, which needs no change here.

## Implementation plan
The three screens are components the Connections page composes, the same pattern it already uses for `GoogleConnection` and `ConnectorQuotas`. No new routes.

- `views/Integrations/connectorLabels.js` (new) — shared provider/product/status labels and date formatting, so the three components read alike.
- `views/Integrations/MyConnections.vue` (new) — a member's own connectors from `GET /api/v2/connectors`: per provider the status, products (tick to re-consent), account, usage (`lastUsedAt`), connect, reconnect and disconnect.
- `views/Integrations/AdminConnections.vue` (new, owner/admin) — every member's connections from `GET /api/v2/connectors/members`: provider, products, scopes, status, dates, usage, End connection. Member names resolve from the users store; no account label, no token.
- `views/Integrations/CompanyApps.vue` (new, owner/admin) — company OAuth apps: instance default vs company app, redirect URI to copy, set/replace/remove against `GET|PUT|DELETE /api/v2/connectors/apps`.
- `views/Integrations/ConnectionsPage.vue` (edit) — import and place the three under the right tab/role.
- `views/Integrations/connections.css` (edit) — sections for the three.
- `Modules/Connectors/controller.js` (edit, read-only) — `getApps` also returns a `catalog` of settable named providers with each one's display name, whether an instance app is set, whether a company app is set, and its redirect URI; the screen cannot be built without this and no write path changes.
- `locales/en.js` (edit) + `npm run i18n:backfill` — all strings under `Connectors.conn.*`.

## Decisions
- Endpoints are the ones 066 shipped: admin overview is `GET /api/v2/connectors/members`, not the `admin/connections` the goal named.
- Screens 1 and 2 need no backend change; only `getApps` grows a read-only `catalog` for screen 3.
- Usage shows `lastUsedAt`; call counts stay zero until 070 (no change here).
- Provider and product names come through i18n (`Connectors.conn.provider_<id>`, `..._product_<name>`) with a humanised fallback for any the registry adds later.
