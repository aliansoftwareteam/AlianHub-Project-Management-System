# Progress: Connectors — data model: evolve connector_connections, add connector_apps and connector_usage

## Checklist
- [x] Schema fields
- [x] Indexes
- [x] connector_apps
- [x] connector_usage
- [x] Tests

## Last step
Added the module fields to `connectorConnections`, the `connectorApps` and `connectorUsage` schemas with their indexes, their names in `Config/schemaType.js`, `Config/collections.js` and `mongoQueries.js`, and `tests/connector-data-model.test.js`.

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
