# Progress: Connectors — migrate Google Calendar connections onto the Google provider

## Checklist
- [x] Migration
- [x] Test twice-run and live grant

## Last step
Migration `migrations/080-connectors-google-calendar-to-google.js` and `tests/migration-google-calendar-to-google.test.js` written; 9/9 pass (incl. the unique-index conflict branch), runner + dry-run + connector-index suites green.

## Blockers
None — 064 and 066 are merged into `feat/per-user-connectors`.

## Live verification (real MongoDB, 2026-11-03)
Ran against a live MongoDB in an isolated throwaway company DB (dropped after), using the real `MongoDbCrudOpration`, secrets store, migration 080 and `resolveConnection` — 16/16 checks:
- Running server applied 080 at boot (`schema_versions`: `ok:true`, no error) with `CONNECTORS=slack,google_calendar` → gate deferred (companies `{}`), live connections untouched.
- Gate open (`CONNECTORS=google`): legacy row reshaped in real Mongo — provider/products/handles/account/companyId/app, legacy `connector` unset, `secretHandles` cleared of tokens; scopes preserved.
- `resolveConnection` returned the migrated connection and `getAccessToken` served the stored token from the real secrets store with no reconnect.
- Idempotent (second run migrated 0); gate closed leaves the legacy row as `google_calendar`.
- Note: real Mongoose re-hydrates the `secretHandles` schema default `{}` on read even after `$unset`; harmless (no token), and the unit assertion was made harness-agnostic to match.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-03
- 064 and 066 confirmed merged; branched `feat/task-073-connectors-migrate-google-calendar` off upstream `feat/per-user-connectors`.
- Wrote migration 080: each `connector: 'google_calendar'` row → `provider: 'google'` with `products: ['calendar']`, `secretHandles{refresh_token,access_token}` → `handles{refresh,access}`, `account{email,sub}` → `account{id,label}`, `brokenReason` → `lastError`, adds `companyId` and `app{source:'instance',appId:null}`, unsets the legacy fields. The grant (secrets-store handle + refresh token) is left untouched.
- Decisions: scope is migration only — deleting the old `googleConnection.js`/`googleController.js` and their flags is 077, not here. Forward-only (no `down`): once 066 is live a genuine new-flow Google connection has the same shape as a migrated one, so no reverse could tell them apart (follows the 079 precedent). Idempotent via the `connector` field, which both selects and is unset, so a second run is a no-op. Slack's legacy rows (`connector: 'slack'`) are left for 074.
- Test covers: connected/broken/pending/revoked reshape, Slack row untouched, twice-run no-op, and — against the real Google provider + `resolveConnection` — a migrated row resolving and refreshing an expired token in place with no reconnect.

### 2026-11-03 (cutover-safety fix)
- Caught a sequencing risk in self-review: the migration auto-runs at boot, but which connector is served is set by the `CONNECTORS` env (the full Google cutover is 077). If 080 reshaped rows while `CONNECTORS` still named the legacy `google_calendar`, the legacy `googleController` — which reads rows by `connector`/`secretHandles` — would show every live Calendar connection as disconnected, breaking "existing grants keep working".
- Fix: a **cutover gate** (same pattern as `031-secrets-by-handle`). `up` reshapes only once `CONNECTORS` no longer names `google_calendar` (`flag.requestedGoogle()` empty); while it is named, `up` is a no-op that records itself applied. This makes 073 safe to ship on its own — data moves only when the serving path has.
- Added a safe `down`: it reverses no data (a reshaped row can't be told from a genuine new-flow Google connection once 066 is live), it only clears the record so a later `up` re-evaluates the gate. The 077 cutover re-triggers with `npm run migrate -- down 080-connectors-google-calendar-to-google && npm run migrate -- up`.
- Tests extended to 8: deferral-while-legacy-served, down-then-rerun-after-cutover, and the refresh test now asserts the grant handles are rotated in place (not re-minted), proving no reconnect.
- No frontend/i18n/colour/route changes, so Rules 3–5 gates don't apply. Not yet pushed (Hetvi pushes).
