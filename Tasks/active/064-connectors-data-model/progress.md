# Progress: Connectors — data model: evolve connector_connections, add connector_apps and connector_usage

## Checklist
- [x] Schema fields
- [x] Indexes
- [x] connector_apps
- [x] connector_usage
- [x] Tests
- [x] Migration 079 builds the indexes in every workspace
- [x] Manual cases in `test-cases.md` run against a real MongoDB

## Last step
Tested and reviewed the PR before merge: every Jest case and every MongoDB case in `test-cases.md` passes, and migration 079 now builds the indexes. Only the Google and Slack regression checks (X-02, X-03) are not run.

## Blockers
None. Needs no 063 code: it only adds schemas, so it branches from `feat/per-user-connectors` on its own.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-29
- Fields are added beside the old ones (`connector`, `secretHandles`, `account { email, sub }`), which the current Google and Slack code still reads; `connector` is no longer required, since module rows carry `provider` instead. 073 and 079 migrate the old rows.
- Both unique indexes on `connector_connections` are partial on `provider` being a string and `deletedStatusKey` being 0. A disconnected row then never blocks a new connection, the same account can be connected again after a disconnect, and rows from before the module (no `provider`) cannot make the index fail to build. `one_live_per_account` also needs `account.id` as a string, so a pending row is held only by `one_live_per_provider`.
- `connector_usage` is its own collection (063 contract, section 7), unique per connection, caller and day.
- `connector_apps` is unique per company and provider and holds the secret only as a secrets store handle.
- The tests check the declared indexes against Mongo's partial-index rule rather than a live database.

### 2026-10-30
- Testing before merge, recorded in `test-cases.md`: every Jest case passes. The manual cases are blocked, since the test machine could not reach MongoDB (Atlas SRV lookup refused from Node, no local `mongod`).
- Review fix: `migrations/079-connector-indexes.js` runs `createIndexes` on `connector_connections`, `connector_apps` and `connector_usage` in every workspace, as 077 does for agents. Without it Mongoose builds the unique indexes only in the background on first use, so a workspace that already has `connector_connections` could take two live rows for one person and provider first. `createIndexes`, not `syncIndexes`, so the indexes the Google and Slack code read by stay.
- Left as they are, with the reasons in `test-cases.md` section G: `one_live_per_account` adds nothing `one_live_per_provider` does not refuse but is in the signed contract; schema checks on `connector_usage.day` and `actor` would not run on the `$inc` upsert, so 070's writer has to build those values.
- The MongoDB cases ran on a local MongoDB 8.0.4 in a throwaway database: Mongo itself refuses a second live connection, a pending row holds the provider, a disconnected row and rows from before the module never block, and the usage counter upserts into one row. All pass.
