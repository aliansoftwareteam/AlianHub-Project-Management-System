# Progress: Connectors — the two-track contract, provider definition format, registry and the Google provider file

## Checklist
- [ ] Contract day with B → `resources/contract.md` (draft written; needs B's review and both signatures)
- [x] Definition shape and validation
- [x] Registry + flag/app gate
- [x] Google provider file
- [x] Tests

## Last step
Wrote the contract draft, `Modules/Connectors/validate.js`, `registry.js`, `providers/google/index.js`, the `resolveConnection.js` stub, a fake provider fixture and `tests/connector-registry.test.js`.

## Blockers
- The contract is a draft until track B reviews it and both sign; 068 must not start before.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-29
- Contract draft in `resources/contract.md`, with two open points for day 1: `connector_usage` as a collection or counters, and `CONNECTORS=google_calendar` versus the new `google` id.
- The registry takes the workspace's company apps as a list (`companyApps`) instead of reading `connector_apps`, so it stays free of the database until 065.
- `Modules/Agents/connectors/flag.js` now exports `named`, so the registry and the old flag read `CONNECTORS` the same way.
- The Google file reuses `googleApi.accountOf` for the account id (`sub`) and label.
