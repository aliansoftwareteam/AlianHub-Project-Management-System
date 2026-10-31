# Progress: Connectors — audit, health, usage counts, quotas and provider backoff

## Checklist
- [x] Audit rows
- [x] Health + notifications (code done; the row is written once 066 brings `recordHealth`)
- [x] Usage counters
- [x] Quotas + admin route
- [x] Backoff (code done; `backoffUntil` is written once 066 brings `markBackoff`)
- [x] Tests
- [ ] After 066: check `markBackoff` and `recordHealth` against the real functions and a real Google connection

## Last step
Code and tests are done on `feat/070-connectors-tracking-quotas`. The task stays active until the check after 066.

## Blockers
066 brings `markBackoff`, `recordHealth` and `getAccessToken`. Until then `resolveConnection` refuses every call, so no real call reaches the provider.

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
