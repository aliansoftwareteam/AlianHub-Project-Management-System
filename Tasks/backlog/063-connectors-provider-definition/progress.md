# Progress: Connectors — the two-track contract, provider definition format, registry and the Google provider file

## Checklist
- [x] Contract day with B → `resources/contract.md` (signed by Hetvi and Prinsa, 2026-10-29)
- [x] Definition shape and validation
- [x] Registry + flag/app gate
- [x] Google provider file
- [x] Tests

## Last step
Wrote the contract draft, `Modules/Connectors/validate.js`, `registry.js`, `providers/google/index.js`, the `resolveConnection.js` stub, a fake provider fixture and `tests/connector-registry.test.js`.

## Blockers
None.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-29
- Contract draft in `resources/contract.md`, with two open points for day 1: `connector_usage` as a collection or counters, and `CONNECTORS=google_calendar` versus the new `google` id.
- The registry takes the workspace's company apps as a list (`companyApps`) instead of reading `connector_apps`, so it stays free of the database until 065.
- `Modules/Agents/connectors/flag.js` now exports `named`, so the registry and the old flag read `CONNECTORS` the same way.
- The Google file reuses `googleApi.accountOf` for the account id (`sub`) and label.
- Contract signed by Hetvi (A) and Prinsa (B).
- Contract change after signing, agreed by Prinsa on 2026-10-29: section 5 adds `getAccessToken` throwing `broken`, `markBackoff` as B's one write to `connector_connections`, and the `ConnectorError` fields; section 2 lists every check the code makes and says screens show the provider name through i18n; section 6 sets `app.appId` to `null` for the instance app; section 7 turns the two open points into decisions: `connector_usage` is its own collection, and `google_calendar` is renamed to `google` in 073.
