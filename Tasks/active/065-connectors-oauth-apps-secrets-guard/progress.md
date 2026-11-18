# Progress: Connectors — OAuth app lookup (instance default, company override) and the secrets-store guard

## Checklist
- [x] App resolution (instance default + company override) — `Modules/Connectors/apps.js` `resolveApp`, `instanceApp`, `companyProviders`
- [x] Company app handlers (set/replace/remove) — `apps.js` `setApp`/`removeApp`, `controller.js`, `routes.js`
- [x] reauth marking — `apps.js` `markReauth`, run on set/replace/remove
- [x] Secrets guard — secret stored by handle, never returned; set/replace refuses when the store is off (FR-16, via `secrets.requireOn`); flag already logs the off reason at startup
- [x] Audit — `connector.app_set` on set/replace, `connector.app_removed` on remove
- [x] Tests — `tests/connectors-apps.test.js` (15), plus route-list updates in two existing suites

## Last step
Core built on branch `feat/task-065-connectors-oauth-apps-secrets-guard` (off upstream `feat/per-user-connectors`). All 327 connector tests green. Not pushed yet.

## Open
- Recording the issuing app on a connection and wiring company apps into `resolveConnection`/`offered` happen in 066's real connect flow; the `connector_connections.app` field (064) and `apps.resolveApp`/`companyProviders` are ready for it.

## Blockers
None (063, 064 are in).

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-31
- Built the app model: `apps.js` (resolveApp, setApp/removeApp, companyProviders, describeApps, markReauth, audit); company-app routes and handlers; secret kept in the secrets store by handle, never on the row or in a response.
- Added `tests/connectors-apps.test.js`; updated the route-list assertions in the Google and Slack suites for the three new `/api/v2/connectors` app routes. 327 connector tests pass.
- Hardened `setApp`: retire the just-created secret if the row write fails, report a racing duplicate as a 409 conflict, and clear `extra` on a replace that omits it. Three more tests; 330 connector tests pass.
