# Progress: Time tracker access by role

## Checklist
- [x] Owner confirms the PRD (seats claimed on first use, admin releases)
- [x] Catalogue: "Time tracking" section and `desktop_tracker` row, defaults, company-wide key
- [x] New roles start with the switch on
- [x] Migration for existing companies (+ sentinel key, down)
- [x] `trackerAccessFor` helper; tracker start and capture use it
- [x] Seat claim on first start and release paths (admin, member removed, role off) on limited plans
- [x] `GET /api/v1/members/:id` returns the computed `isTrackerUser` for the caller's own row
- [x] `manageTrackerUserPermission` narrowed to releasing a seat
- [x] Settings → Time tracking seat card (limited plans only)
- [x] i18n keys + backfill; tests; i18n and style checks
- [ ] Checked in a running app (no local MongoDB on this machine)
- [ ] Integration tests (`tests/integration`) run against a seeded database

## Last step
Built and unit-tested on `feat/time-tracker-by-role`; PR into `staging` next.

## Blockers
None.

## Log

### 2026-11-12
- Task created. A member had no tracker access and the web app has no screen to grant it since the
  Members redesign (6c0d6a3bf) dropped the per-member toggle.
- Owner decisions: access by role, on by default; Guest off by default; seat limits managed only
  when the plan has a limit, nothing tracked on unlimited plans.
- Found: the desktop app reads `isTrackerUser` from `GET /api/v1/members/:id`, so serving a computed
  value there means no desktop app change.
- Built. `Modules/DesktopTracker/trackerSeats.js` holds the rule: role (`time_tracking.desktop_tracker`),
  then add-on, then seats. Hosted seats come from the entitlements document and count per person
  across the instance; self-hosted keeps the per-workspace `planFeature.timeTrackerUser` (empty =
  unlimited). A claim re-counts after writing and gives the seat back if two people raced past the limit.
- Decisions made while building:
  - The v2 tracker start now checks access too; before, only v3 start and v4 capture checked the flag.
    The older v2/v3 capture routes are unchanged (they need a running session, which needs a start).
  - A seat is released after any Security & Permissions save and after a seat holder's role changes,
    by sweeping holders whose role no longer allows the tracker.
  - Unlimited plans: the desktop card shows "Unlimited users" and the hosted usage report sends
    `seatsUsed: 0`, so old per-member flags are not reported as used seats.
  - Migration number 083: 080–082 are taken on the connectors branches.
- Tests: new `tests/desktop-tracker-by-role.test.js` (20) and `frontend/tests/unit/trackerSeatsCard.spec.js` (4);
  10 tracker suites and 4 others updated for the new check. 123 suites that load the changed modules pass.
  Convention and frontend failures seen (ci-e2e-shards, plain-words, role-playbooks, style-check baseline
  form, ai-core-boundary, retired-flags, upload-routes-order; chatTokens, designVariantDefault,
  firstPaintSet, uiSweepThirdPass, listSearchPlainText, darkModeBatchThree) fail the same way on a clean
  `staging` checkout on this machine.
