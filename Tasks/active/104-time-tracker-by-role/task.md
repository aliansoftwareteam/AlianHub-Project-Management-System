---
id: 104
title: Time tracker access by role — a role switch, on by default, with seats only on plans that have a limit
status: active
priority: high
depends_on: []
created: 2026-11-12
---

# 104 — Time tracker access by role (PRD)

## Goal
Who may use the desktop time tracker is decided by their role in Security & Permissions, not by
a switch on each member. Every role except Guest has it on by default, so a new teammate can track
time without an admin doing anything. Tracker seats are counted and managed only when the plan has
a seat limit; on an unlimited plan nothing is counted.

## Why now
Since the Settings → Members redesign (6c0d6a3bf, 2026-09-03) there is no screen that grants tracker
access: the per-member toggle lived in the old member table, deleted in fea895dbf. A member without
`isTrackerUser` can only be fixed through the API. An admin reported a member stuck this way.

## How it fits the code that exists
- Access today is `company_users.isTrackerUser`, set by `POST /api/v1/manageTrackerUserPermission`
  (`Modules/trackerUserPermission`), which also moves the `companies.trackerUsers` counter.
- The server checks it when the desktop tracker starts a session (`Modules/LogTime/controllerV2/tracker.js:168`)
  and when it captures (`capture.js:434`). The web timer does not check it.
- The desktop app reads `isTrackerUser` from `GET /api/v1/members/:userId` at sign-in and shows its
  "no tracker access" screen when it is false (`time-tracker-app/renderer/pages/home.jsx`).
- Hosted seat limits: `feature('timeTracker')` gives `{ enabled, seats }` (`seats: null` = unlimited);
  `seatSnapshot` and the usage report count holders of `isTrackerUser`. Self-hosted is unlimited
  (`SELF_HOSTED_TRACKER`, `planFeature.timeTrackerUser: null`).
- Role permissions: the catalogue in `utils/data.js importCompanyRules`, defaults in
  `memberDefaults.js`, evaluated by `Config/permissionGuard.js`. Migration 078 is the pattern for
  adding a right to existing companies with per-role defaults. The matrix greys a row whose
  section is None for that role.

## Scope
1. **Role switch** — a new section "Time tracking" in Security & Permissions with one switch row,
   "Desktop time tracker" (`time_tracking.desktop_tracker`, `switchOnly`). Its own section, so it is
   never greyed by a role's timesheet settings. Company-wide: added to `isCompanyWideKey`, so a
   project with its own rules does not hide it.
2. **Defaults** — new companies: Member on, Guest off. Every role created later starts with it on.
   Owner and Admin always have it, as with every right.
3. **Existing companies** — a migration adds the section and row (catalogue sentinel + repair, as
   078) and turns it on for Member and every custom role, off for Guest, never overriding a value an
   owner has already set. `down()` removes only what it added.
4. **One access rule on the server** — a helper `trackerAccessFor(companyId, userId)` answers whether
   a person may track now: role allows, the tracker add-on is on, and a seat is held or free (seat
   part only on a limited plan). `tracker.js` start and `capture.js` use it instead of reading
   `isTrackerUser`.
5. **Unlimited plan** (self-hosted, or hosted with `seats: null`) — the role alone decides. No seat is
   claimed, counted or shown as used.
6. **Limited plan** (hosted with a number of tracker seats):
   - The first time a person with access starts the desktop tracker, they take a seat if one is free.
     When none is free, the start is refused with "All tracker seats are in use — ask an admin."
   - People who hold a seat today keep it, so nobody loses tracking at the switch.
   - A seat is freed when the member is removed (as today), when an admin releases it, or when the
     member's role no longer has the switch on.
   - Settings → Time tracking shows a "Tracker seats" card: used of limit, and the people holding a
     seat, each with a Release button (owner and admin only).
7. **Desktop app — no change needed.** `GET /api/v1/members/:id` returns `isTrackerUser` computed by
   `trackerAccessFor` for the caller's own row, so the builds already installed keep working.
8. **Old per-member endpoint** — `manageTrackerUserPermission` stays only to release a seat (and is
   what the Release button calls); granting through it is refused with a pointer to the role switch.
9. **i18n and tokens** — new strings under `Permissions` / `TimeTracker` in `en.js`, backfilled; no
   hard-coded colours.

## Out of scope
- Changes to the desktop tracker app, including a nicer "seats full" message there (it shows its
  existing no-access screen; a follow-up if wanted).
- Per-member exceptions (a member allowed or blocked regardless of role).
- Hosted billing, plan or portal changes in alianhub-cloud: seat numbers keep coming from the
  entitlements document.
- The web timer on tasks, which never needed tracker access.
- The Time tracking page layout itself (task 103); this adds one card to it.

## Acceptance criteria
- [ ] Security & Permissions shows "Time tracking → Desktop time tracker" with a switch per role.
- [ ] A new company: Member on, Guest off, a newly created role on; owner and admin always allowed.
- [ ] After the migration, an existing company has it on for Member and every custom role, off for
      Guest, and any value an owner had set is unchanged; `down()` reverts only the seeded entries.
- [ ] A member whose role is on can start and capture with the desktop tracker without any
      per-member flag; turning their role off refuses the next start and capture.
- [ ] Unlimited plan: any number of members track; no seat is recorded or reported as used.
- [ ] Limited plan with N seats: the first N people to start take a seat, person N+1 is refused with
      the seats-full message, releasing a seat lets them start, existing holders keep theirs.
- [ ] Settings → Time tracking shows used/limit and the seat holders with Release on a limited
      plan, and no seat card on an unlimited one.
- [ ] An installed desktop tracker, unchanged, shows the tracker for an allowed member and the
      no-access screen for one whose role is off.
- [ ] Unit tests for `trackerAccessFor`, the migration and the seat claim/release; the existing
      tracker start and capture tests updated; `npm run i18n:check` and `npm run style:check` pass.

## Constraints & notes
- Working agreement: minimal comments, every string through i18n, every colour from a token.
- Route behaviour changes but no route is added; if one is, `npm run api:doc` runs in the docs PR.
- PR goes to `staging` unless the owner says it belongs to the cloud programme (`chore/pre-staging`).
- Task 103 (another session) is redesigning Settings → Time tracking; the seat card follows its
  card layout and is rebased onto it if 103 merges first.
- Assumed from the owner's answer "manage seats when there is a limit": seats are claimed on first
  use and released by an admin, rather than assigned by hand in advance.

## Resources
- None yet.
