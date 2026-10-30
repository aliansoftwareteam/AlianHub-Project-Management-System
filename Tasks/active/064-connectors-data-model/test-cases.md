# 064 test cases: connector data model

Run 2026-10-30 on `feat/task-064-connectors-data-model` after the review fix (section G), and again after the PR #1738 review (section H). Every **Auto** case passes. The **Manual** MongoDB cases were run on a local MongoDB 8.0.4 in a throwaway database (`tc_064_test`, dropped after), with the indexes built by `createIndexes` from the schemas, as migration 079 does: all pass. X-02 and X-03 need Google and Slack apps and are not run.

Two kinds of case:
- **Auto**: covered by Jest. Run `node node_modules/jest/bin/jest.js --selectProjects unit --runTestsByPath tests/connector-data-model.test.js tests/migration-connector-indexes.test.js --no-watchman`. The data model test checks the declared indexes against Mongo's partial-index rule, not a live database. Through `npx jest` on Windows the run can hang on watchman.
- **Mongo**: `tests/integration/connector-indexes.int.test.js` builds the indexes through migration 079 in a throwaway database and inserts against real MongoDB, so it catches what the JS model of the rule would miss. Runs with the integration project (`E2E_MONGODB_URL`).
- **Manual**: run against a real MongoDB with `mongosh`. These prove what the Jest test cannot: that Mongo itself refuses the duplicate.

Write the result in the **Result** column: `pass`, `fail` (with what happened), or `blocked`.

## Setup for the manual cases

1. Root `.env` with a working `MONGODB_URL`.
2. Start the server once (`npm run nodemon`) and open the app with a company, so the company database exists.
3. Run the migration: `npm run migrate`, so migration 079 builds the indexes. Without it they are built only in the background on first use.
4. In `mongosh`, `use <the company's database>`.
5. Run I-01 first. If the two new indexes are missing, the rest of section B cannot be trusted; record I-01 as `fail` and stop.
6. Clean up after: `db.connector_connections.deleteMany({ userId: /^tc-/ })`, `db.connector_apps.deleteMany({ companyId: /^tc-/ })`, `db.connector_usage.deleteMany({ companyId: 'tc-co' })`.

## A. Schema and names

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| N-01 | Auto | `SCHEMA_TYPE` has the new names | Jest | `CONNECTOR_APPS` = `connector_apps`, `CONNECTOR_USAGE` = `connector_usage` | pass |
| N-02 | Auto | `checkType` and `tableType` know both | Jest | Each returns the right schema and collection name | pass |
| N-03 | Auto + Manual | No hard-coded collection name | `git grep -n "'connector_apps'\|'connector_usage'" -- Modules utils` | No match outside `Config/` | pass |
| N-04 | Manual | Old rows still valid | Insert `{ connector: 'slack', deletedStatusKey: 0 }` (no `provider`, no `companyId`) | Insert succeeds | pass |
| N-05 | Manual | Strict schema drops unknown fields | Through the app's Mongo helper, save a row with `foo: 1` | `foo` is not stored | pass |

## B. Unique indexes on `connector_connections`

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| I-01 | Mongo + Manual | One unique index exists | `db.connector_connections.getIndexes()` | Only `one_live_per_account` is `unique: true`, partial on `companyId`, `provider` and `account.id` being strings and `deletedStatusKey: 0`; no `one_live_per_provider` | pass |
| I-02 | Auto + Mongo | Second account of the same provider is allowed | Insert `{ companyId:'tc-co', userId:'tc-u1', provider:'google', account:{id:'a1'}, deletedStatusKey:0 }`, then the same with `account.id:'a2'` | Both succeed | pass |
| I-03 | Auto + Manual | Same account twice is refused | Insert the I-02 first row twice | Second fails `E11000` | pass |
| I-04 | Auto + Manual | Disconnected row does not block | Set the I-02 row to `deletedStatusKey: 1`, then insert a new live row for `tc-u1` + `google` | Insert succeeds | pass |
| I-05 | Auto + Manual | Same account reconnects after disconnect | After I-04, the new row uses `account.id:'a1'` again | Insert succeeds | pass |
| I-06 | Auto + Manual | Different person, same provider | Live row for `tc-u2` + `google` | Insert succeeds | pass |
| I-07 | Auto + Manual | Same person, different provider | Live row for `tc-u1` + `dropbox` | Insert succeeds | pass |
| I-08 | Auto + Manual | Different company, same person id | Live row `companyId:'tc-co2'`, `tc-u1` + `google` | Insert succeeds | pass |
| I-09 | Auto + Mongo | Pending row (no account id yet) never blocks | Insert two `{ companyId:'tc-co', userId:'tc-u3', provider:'google', status:'pending', deletedStatusKey:0 }`, then a live `tc-u3` + `google` row | All succeed | pass |
| I-10 | Auto + Manual | Old rows without `provider` never collide | Insert two `{ userId:'tc-u4', connector:'google_calendar', deletedStatusKey:0 }` | Both succeed | pass |
| I-11 | Auto | The indexes the Google and Slack code read by stay | Jest | `connector,deletedStatusKey` and `userId,connector,deletedStatusKey` still declared | pass |
| I-13 | Auto + Mongo | Row without `companyId` is outside the index | Insert two live `tc-u1` + `google` rows with the same account and no `companyId` | Both succeed: neither is taken for another workspace's | pass |
| I-14 | Auto + Mongo | Module row needs `companyId` | Save `{ userId:'tc-u1', provider:'google' }` through the model; save `{ connector:'slack' }` | First fails validation on `companyId`; second succeeds | pass |
| I-12 | Manual | Disconnect writes `deletedStatusKey: 1` | Read `disconnect` in `Modules/Agents/connectors/googleConnection.js` | `$set` has `deletedStatusKey: 1`, so a disconnected row leaves the live-only indexes | pass |

## C. `connector_apps`

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| A-01 | Manual | Index exists | `db.connector_apps.getIndexes()` | `one_per_provider` on `companyId` + `provider`, unique | pass |
| A-02 | Auto + Manual | One app per company and provider | Insert two `{ companyId:'tc-co', provider:'google', ... }` | Second fails `E11000` | pass |
| A-03 | Manual | Another company may have its own | Same with `companyId:'tc-co2'` | Succeeds | pass |
| A-04 | Auto | No plain secret field | Jest | Only `secretHandle`, no `clientSecret` | pass |
| A-05 | Auto | Required fields | Jest | `companyId`, `provider`, `clientId`, `secretHandle`, `setBy` required | pass |

## D. `connector_usage`

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| U-01 | Manual | Indexes exist | `db.connector_usage.getIndexes()` | `one_per_caller_day` unique, plus `companyId` + `userId` + `day` | pass |
| U-02 | Auto + Manual | One row per connection, caller and day | Insert two `{ companyId:'tc-co', connectionId:'cn1', userId:'tc-u1', actor:{type:'agent',id:'ag1'}, day:'2026-10-30' }` | Second fails `E11000` | pass |
| U-03 | Manual | Next day is a new row | Same with `day:'2026-10-31'` | Succeeds | pass |
| U-04 | Manual | Other caller same day | Same with `actor.id:'ag2'` | Succeeds | pass |
| U-05 | Manual | Counter goes up in place | `updateOne({connectionId:'cn1', 'actor.type':'agent', 'actor.id':'ag1', day:'2026-10-30'}, {$inc:{reads:1}}, {upsert:true})` twice | One row, `reads: 2` | pass |
| U-06 | Auto | Counters start at zero | Jest | `reads` and `writeProposals` default 0 | pass |

## E. Migration 079

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| M-01 | Auto | Listed once, after 078 | Jest | `079-connector-indexes`, company scope | pass |
| M-02 | Auto | Builds what the schemas declare | Jest | Its unique index names match each schema's unique indexes | pass |
| M-03 | Auto | Every workspace, all three collections, `createIndexes` only | Jest | 3 calls per workspace; never `syncIndexes`, so no index is dropped | pass |
| M-04 | Auto | Second run is harmless | Jest | Resolves, nothing else changes | pass |
| M-05 | Auto | A failing workspace does not stop the rest | Jest | Error names the failed workspace; the others are built | pass |
| M-06 | Auto | `--dry-run` builds nothing; `verify` passes before it ran | Jest | Plan lists 2 `createIndexes` per collection; no write | pass |
| M-08 | Auto + Mongo | A database that built the first indexes is brought up to date | Build the old `one_live_per_account` (no `companyId` filter) and `one_live_per_provider`, then run 079 | Both are dropped, the new index is built, a second account then connects; a second run drops nothing | pass |
| M-07 | Manual | Runs on a real database | `npm run migrate`, then I-01, A-01, U-01 | Indexes exist in every workspace | pass on a database with no workspace yet: 079 ran at boot and was recorded applied. The index builds it calls are proven by section B to D |

## F. No regression

| ID | Kind | Case | Steps | Expected | Result |
|---|---|---|---|---|---|
| X-01 | Auto | Migration framework tests still pass | `migrations-runner`, `migrations-dry-run`, `migrate-cli-*`, `migrations-boot-build-version`, and migration 077's test | All green | pass |
| X-02 | Manual | Google Calendar connect still works | With the old flag (`CONNECTORS=google_calendar`), connect a Google account from the app | Connects; row has `connector:'google_calendar'` | blocked |
| X-03 | Manual | Slack connection still works | If Slack is set up, post a test message | Works as before | blocked |

## G. Review findings

| Finding | Risk | Change | Covered by |
|---|---|---|---|
| No migration built the new indexes | Mongoose builds a declared index only in the background, the first time a workspace uses the collection. On a workspace that already has `connector_connections`, two connects close together could both save a live row before `one_live_per_provider` exists, and the build would then fail on the duplicate. Migration 077 fixed the same gap for agents | Added `migrations/079-connector-indexes.js`: `createIndexes` on the three collections in every workspace | M-01 to M-06, `tests/migration-connector-indexes.test.js` |

Noted, not changed:
- `one_live_per_account` refuses nothing that `one_live_per_provider` does not already refuse, since both are partial on live rows and the second has fewer keys. It costs one index write per change. It is in the signed contract (section 6), so removing it needs track B's agreement.
- Schema validators do not run on updates or upserts here (no `runValidators`), so a check on `connector_usage.day` (`YYYY-MM-DD`) or `actor.type` (`agent` | `mcp`) in the schema would not reach the `$inc` upsert that writes usage. The writer in 070 has to build those values itself.
- Migration number 079 and task 079 (which migrates old rows) are different things that share a number.

## H. PR #1738 review (Shiv)

| Finding | Change | Covered by |
|---|---|---|
| `one_live_per_account` never fired: `one_live_per_provider` has fewer keys and tripped first, so a person could hold one account per provider, against the "more than one account" note in #1741 | Decided: several accounts per provider. `one_live_per_provider` removed; 079 drops it, and the old `one_live_per_account`, on a database that built them | I-01, I-02, M-08 |
| A `pending` row blocked the next connect | Follows from the above: the remaining index needs `account.id`, which a pending row does not have yet. 066 still has to clear or reuse abandoned pending rows so they do not pile up | I-09 |
| `companyId` optional but part of the unique key, so a row without it collided across workspaces | Required whenever `provider` is set, and the index is partial on `companyId` being a string | I-13, I-14 |
| Schema comment said "073 and 079 migrate the old rows" | Now names task 073 only; migration 079 builds indexes | - |
| Index tests re-implement Mongo's rule in JS | Added `tests/integration/connector-indexes.int.test.js` against real MongoDB | I-01, I-02, I-09, I-13, I-14, M-08 |

Run on a throwaway MongoDB 8.0.4: unit 29/29, Mongo 10/10. Connector, migration and schema suites 828/829; the one failure is `style-check`'s baseline form check, which fails on this Windows checkout because `core.autocrlf` gives the file CRLF line endings, and this branch does not touch it.
