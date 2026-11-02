# Progress: Connectors — audit, health, usage counts, quotas and provider backoff

## Checklist
- [x] Audit rows
- [x] Health + notifications
- [x] Usage counters
- [x] Quotas + admin route
- [x] Backoff
- [x] Tests
- [x] Check `markBackoff` and `recordHealth` against the real functions
- [x] Check `recordHealth`, audit, usage and the broken notice on a real Google connection
- [x] Check `markBackoff` (fake server only: Google gave no 429 in the real check, so it was never seen against Google)
- [ ] After the PR merges: `npm run api:doc` in the docs PR, then move this task to `done/`

## Last step
Real Google check done, both review follow-ups fixed, committed locally on `fix/070-connector-health`. Not pushed, no PR.

## Blockers
None. Prinsa pushes and opens the PR.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-31
- Contract change agreed with Hetvi, as Prinsa reported: `recordHealth` joins `markBackoff`, B may read `backoffUntil`, and A audits `connector.connect`, `products_changed`, `broken` and `revoke`. Recorded in 063's `progress.md`.
- `toolRunner.js`: every read and send goes through one audit row. Reads are counted and limited; a held provider refuses before anything is spent.
- `writes.js`: `fileChanges` counts and audits a proposal when it is filed, so an edit of a waiting proposal costs nothing. The send claim moved behind the admission and backoff checks, so a refused send no longer spends the approval.
- New files: `usage.js`, `quotas.js`, `rateLimits.js`, `health.js`, `callAudit.js`.
- New collection `connector_quotas`, one row per target, with no migration: the collection is new, so mongoose builds its index before any row exists.
- Decisions:
  - The day and its reset are UTC.
  - A read refused before the provider writes an audit row but no count. A failed provider call counts.
  - A quota is counted first and checked after, so racing calls never pass the limit; near the limit a racing call can be refused early, never let through.
  - The agent limit covers agents. An MCP client is bounded by the person's limit.
  - A listed status other than 429 counts as a rate limit only with `Retry-After` or rate-limit words in the body, since providers answer 403 for missing rights too.
  - Ceilings come from `CONNECTOR_QUOTA_MAX_READS`, `_WRITE_PROPOSALS` and `_AGENT_READS` (defaults 5000, 500, 2000). A lowered ceiling also lowers limits already saved.
  - `lastError` keeps the error code only, because a provider's message can echo the request.
  - A broken connection notifies the person once a day per provider, from the Inbox row's `message`.
- `connector.call` now reads "An agent used a connected service", since it covers writes and MCP too.
- Docs PR after merge: run `npm run api:doc` and `npm run env:doc` for the new route and the three settings.
- 078 needs a read route for the current limits; the task names only the `PUT`, so none was added.
- Tested: `tests/connector-tracking.test.js`, and `tests/integration/connector-usage.int.test.js` on a throwaway MongoDB 9.0, including 12 reads racing for 5 places.

### 2026-11-02
- 066 brought `getAccessToken` and `markBackoff` but not `recordHealth`. The guard in `health.js` and the mocks in the tests hid the gap, so nothing was saved after a call.
- `recordHealth` added to `connection.js` and exported from `resolveConnection.js`. It leaves a broken row alone, because `lastError` there is the reason the person is shown and a call in flight can finish after a refresh marked the row broken.
- Removed the guards in `health.js` and `rateLimits.js`.
- `refresh_failed` and `token_unavailable` now reach `lastError`. They leave `lastUsedAt` alone and stay `refused` in the audit, since the provider was not reached.
- Tested: `tests/integration/connector-health.int.test.js` on a throwaway MongoDB 9.0, including 50 calls finishing while the row is marked broken and one company naming another's connection. 14 deliberate breaks of the code were each caught by a test. The full unit and conventions run fails the same tests as the base commit, plus two baseline-format checks that fail only on this Windows checkout's CRLF line endings.
- Left for others: a provider 401 does not mark a connection broken or tell the person until a refresh fails (track A), and token expiry and a `lastError` on a healthy row are not returned by any route yet (072).
- Real Google check, with a real account in Testing mode, the local database and `google.calendar.events.list`. The tool was called through `toolRunner.read` from a script with `via: mcp`, not through an MCP client or an agent run.
  - Read: `lastUsedAt` saved, `lastError` empty, `connector.call` `applied`, `reads: 1`, tainted.
  - Calendar not ticked on Google's consent: only `openid` and email granted, read refused as `scope_missing`, no count.
  - Access removed at Google: 401, `lastError: provider_refused`, audit `failed`, counted, still `connected` until a refresh fails.
  - Access token expired by hand in the local row to force the refresh: `invalid_grant`, `broken`, `connector.broken` audit, one `connector_broken` notice over three calls, audit `refused`.
- Bugs this found:
  - Fixed: `beginConsent` saved a new row without `companyId`, which the schema requires, so every first connect answered 500. `feat/per-user-connectors` has the same line.
  - Fixed: a read that failed on its token before reaching the provider kept its quota count, against the decision above. Covered by the unit test, not repeated against Google.
  - Not fixed (track A): `complete` stores the asked products even when Google grants fewer, so the row said `calendar` with no Calendar scope.
  - Not fixed (072): the Connections page drops the `code` for provider `google`. The check finished through a throwaway local page and the row's `oauth.origin` set by hand.
- Review follow-ups:
  - `usedByPerson` filters on `companyId` too, so the `{ companyId, userId, day }` index serves it.
  - `fileChanges` takes a `save` callback and runs it inside the claim. A save that fails gives the count back and audits `failed`; `filed` is audited only once the row is stored.
- Accepted on Prinsa's "finish what is left": fake-server cover is enough for `markBackoff`.
- Connector and proposal suites pass (28 suites, 795 tests). `tests/conventions` fails in six suites this work does not touch: retired-flags, ai-core-boundary, style-check, plain-words, ci-e2e-shards, role-playbooks.
