# Progress: Connectors — end a member's connections on removal, deactivation or SCIM, plus a daily sweep

## Checklist
- [x] Removal/deactivation/SCIM hooks
- [x] Daily sweep
- [x] Tests

## Last step
Implemented on branch `feat/task-067-connectors-member-removal-sweep` (cut from the 066 branch, which is done but not yet merged). Unit suite run pending; `connector-lifecycle.test.js` green (28 tests).

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
