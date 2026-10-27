# Progress: Plan entitlements — limits enforced on the server, read-only and suspended states, Plan & usage page

## Checklist

- [ ] T1 — `Modules/Entitlements` (state, pure checks, `applyEntitlements` → `planFeature`)
- [ ] T2 — Seats, instance-wide, at every entry point
- [ ] T3 — Storage and file size on every upload path
- [ ] T4 — Workspace limit
- [ ] T5 — Time tracker add-on gating and seats
- [ ] T6 — Daily mail cap with queueing
- [ ] T7 — Read-only and suspended guards, paused background writers
- [ ] T8 — Plan & usage page and `GET /api/v2/plan/usage`
- [ ] T9 — Plan banners
- [ ] T10 — Tests, convention test, e2e, i18n, style

## Last step

Not yet started.

## Blockers

Needs 062 (stored entitlements and lifecycle) and 063 (storage counter). The checks in T1 can be
built first against fixtures.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
