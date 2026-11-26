# Progress: Connectors — end a member's connections on removal, deactivation or SCIM, plus a daily sweep

## Checklist
- [x] Removal/deactivation/SCIM hooks
- [x] Daily sweep
- [x] Tests

## Acceptance criteria
- [x] Removing a member revokes at the provider and clears secrets
- [x] A removal made while the provider was down is caught by the next sweep (proved 2026-11-26, `tests/connector-revoke-lifecycle.test.js`)
- [x] Running the sweep twice changes nothing the second time

## Last step
2026-11-26: the three access-outliving-removal gaps from the 066 security review are fixed on `fix/connectors-067-revoke-retry` (from `origin/staging`), committed, not pushed. All 36 connector, SCIM and connector-migration suites green (702 tests), conventions green (489).

## Blockers
None. Rides on 066's `connection.endForMember`, which already exists.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-02
- Branch `feat/task-067-connectors-member-removal-sweep` cut from `feat/task-066-connectors-connect-lifecycle` (066 PR #1750 is done but unmerged), so 066's `endForMember` is available.
- **Removal/deactivation/SCIM hooks:** the three call sites already invoke `endMemberConnections` (`settings/Members/controller.js`, `Scim/provisioning.js` × 2) from 065/066. Extended `Modules/Agents/connectors/memberDeparted.js` so that hook now ends the **generic** connectors (`Connectors/connection.endForMember`) as well as the legacy Google ones. Both paths are wrapped so neither throws into the removal flow (FR-14); each loads nothing while its connectors are unnamed.
- **Daily sweep:** added `connection.sweepCompany(companyId)` — finds every open connection for an offered provider, and for each owner with no seat reuses `endForMember`. New `Modules/Connectors/sweep.js` iterates all companies (`sweepAll`) and is registered as a recurring job in `Modules/Connectors/init.js` via `engine.defineRecurring` (same pattern as `agent.schedules`). Interval defaults to 24h, overridable with `CONNECTOR_SWEEP_HOURS`.
- **`connector.revoke` audit:** already emitted by the generic `disconnect` (connection.js), which `endForMember` calls for token-holders; no new audit code needed.
- Decisions:
  - *"Departed" = `!hasSeat`.* The sweep uses the module's own membership signal (`hasSeat` → false for a removed member or a guest), the same one `findUsable` already uses to refuse a connection. A member downgraded to guest therefore gets swept — consistent with the goal "no connection outlives its person's membership".
  - *Idempotency by reuse, not a new guard.* The sweep calls `endForMember`, which closes rows (`deletedStatusKey: 1`); a closed row is not matched by the next pass's `deletedStatusKey: { $ne: 1 }` query, so a second run ends nothing. Proven by test.
  - *Provider-down case:* `disconnect` asks the provider once and clears local state regardless of the answer, so the sweep's role is to catch connections a **failed or interrupted** removal left open, not to retry provider revokes on already-closed rows.
- Tests (in `tests/connector-lifecycle.test.js`): removal hook revokes + clears secrets + audits; sweep ends a seatless member's open connection while leaving a seated colleague; sweep is idempotent. `npx jest tests/connector-lifecycle.test.js` → 28/28.
- Note: 5 files (`.claude/launch.json` + 4 `tests/conventions/*`) were already modified in the working tree before this task; left untouched and out of 067's commits.

### 2026-11-02 — PR #1752 review fix
- **Blocker (fixed): the sweep must not revoke on a failed seat read.** `sweepCompany` decided with `hasSeat`, which returns `false` on any `getRoleType` error (fail-closed). Right for `findUsable` (refuse one call), destructive in the sweep: one Mongo blip during the daily pass would make every connected member look seatless and revoke every grant + retire every secret, with no way back.
- **Change:** added `seatOf(companyId, userId)` → `yes` / `no` / `unknown`; `hasSeat` now derives from it (`=== yes`), so `findUsable`'s fail-closed behaviour is unchanged. The sweep ends a member **only on a definite `no`**; an `unknown` (read failed) is skipped and left for the next pass to retry.
- **Test:** added a case where the seat read throws — the sweep ends nothing and revokes no one; once the read recovers and the member is gone, the next pass ends only them. `connector-lifecycle` → 29/29.
- Supersedes the earlier *"Departed = `!hasSeat`"* decision: departed is now a definite no-seat answer, never an unreadable one.

### 2026-11-26 — security review gaps (access outliving a disconnect or removal)
- **Failed revoke is retried (criterion 2).** Closing a row now parks the handles it takes as `revokeRetry: { handles, attempts, nextAt, by }` in the same write, then asks the provider once. A refusal keeps only the token the revoke call needs (the refresh token; also the access token for `revokeWith: 'access'`), on the closed row, which no lookup returns; the daily sweep retries it once `nextAt` (1 h) has passed, up to 7 attempts, then retires it and audits `gave_up`. Every attempt audits `connector.revoke` with its outcome and attempt number. A process that dies between the close and the revoke leaves the parked row for the sweep too.
- **Reconnect to another account** now audits the earlier grant's revoke (`by: 'reconnected'`) and parks it for the sweep when it fails, on a closed row of its own.
- **Race with an in-flight exchange or refresh.** Chose "the late writer notices" over "block the close": every write to a row (`update`) matches a live row only, so a writer that lost the race gets null instead of writing to a closed row; `complete` then parks and revokes the grant it was just given (`by: 'late_grant'`) and answers 409 `connection_ended`, and a refresh retires the handle it made and hands out nothing. The close itself matches the handles it read, so a token written between the disconnect's read and its close makes it re-read rather than close over it. No lock, lease or waiting is needed, and nothing is left held if a process dies. `complete` now always stores new tokens under new handles and retires the old ones after a successful write: rotating them into the row's own handles would let a concurrent disconnect revoke the new grant and lose the old one's token.
- **Provider not offered.** `endForMember` and `sweepCompany` end every module row of the person (`provider` a string), offered or not; `endableIds` is gone. Revoke still runs where a definition exists (a catalog provider's needs no app; `revokeWith: 'access'` with an expired token needs one and is skipped without it). The removal hook and `sweepAll` no longer return early when CONNECTORS names nothing.
- Tests: `tests/connector-revoke-lifecycle.test.js` (11, each failing on `origin/staging`). Changed expectations: `connector-lifecycle` (a reconnect gets new handles, old ones retired) and `connector-google-member-leaves` (a removal with Google unreachable keeps the leaver's refresh token parked for the retry). `audit-event-labels` lists `handles.refresh`/`handles.access` as connection fields.
- Not proved: real MongoDB behaviour of the conditional writes (fake Mongo only); the sweep's `revokeRetry.nextAt` query has no index (closed rows per company are few).

