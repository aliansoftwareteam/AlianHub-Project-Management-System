# Progress: Connectors — the two-track contract, provider definition format, registry and the Google provider file

## Checklist
- [x] Contract day with B → `resources/contract.md` (signed by Hetvi and Prinsa, 2026-10-29)
- [x] Definition shape and validation
- [x] Registry + flag/app gate
- [x] Google provider file
- [x] Tests

## Last step
Tested and reviewed the PR before merge: `test-cases.md` records all 46 cases passing, and four review fixes with their tests. Merged the upstream branch to clear the conflicts #1732 and #1733 left. Waits for the PR to merge.

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

### 2026-10-30
- Merged upstream `feat/per-user-connectors` into the branch: #1732 and #1733 had left conflicts in `Tasks/index.md`, the 061 progress and the research matrix. Kept upstream's matrix and 061 progress.
- Testing before merge, recorded in `test-cases.md`: 45 of 46 cases pass. B-01 (boot log with `CONNECTORS=google`) is not run, since the test machine could not reach MongoDB.
- Review fixes, each with a test: the registry freezes the whole definition, not only its top level; `resolveConnection` throws `provider_off` for a provider `CONNECTORS` does not name, as contract section 5 says; Google `readAccount` throws when the token response has no `sub` instead of returning id `''`; `scopesFor` refuses products that are not a list.
- `Config/config.js` falls back to the working folder when there is no main module, so the `node -e` checks in `test-cases.md` load the Google provider.
- Left for the owner: refusing reserved OAuth keys (`redirect_uri`, `scope`, `state`) in `auth.extraParams` would change the contract and needs track B's agreement.
- B-01 run on a local MongoDB 8.0.4: the server boots with `CONNECTORS=google`, the Google provider loads, and the only connector line is the `google` unknown-name log contract section 7 expects. All 46 cases in `test-cases.md` now pass.
