# Progress: Plan entitlements — limits enforced on the server, read-only and suspended states, Plan & usage page

## Checklist

- [x] T1 — `Modules/Entitlements` (state, pure checks, `applyEntitlements` → `planFeature`)
- [x] T2 — Seats, instance-wide, at every entry point
- [x] T3 — Storage and file size on every upload path. Copies (task and comment duplicates) and seed images are counted by 063 but not refused (see log).
- [x] T4 — Workspace limit
- [x] T5 — Time tracker add-on gating and seats
- [x] T6 — Daily mail cap with queueing
- [x] T7 — Read-only and suspended guards, paused background writers
- [x] T8 — Plan & usage page and `GET /api/v2/plan/usage`
- [x] T9 — Plan banners
- [ ] T10 — Jest, vitest, convention test, i18n and style done; the e2e (fill storage → refused → delete → works; read-only → edits refused, export works) is not written: it needs a managed-mode stack to run against (065).

## Last step

T1–T9 and the T10 unit and convention tests built on `feat/plan-entitlements` (not pushed). Next: the e2e on 065's
stack; `docs/API.md` and `docs/api/openapi.json` gain the two `/api/v2/plan/*` routes in the follow-up docs PR (Rule 4).

## Blockers

None for the app. The e2e waits for a managed-mode stack (065).

## Contracts other tasks use

- **Refusal codes** (`Modules/Entitlements/checks.js` `CODES`): `seat_limit`, `storage_full`, `file_too_large`,
  `workspace_limit`, `tracker_disabled`, `tracker_seat_limit`, `mail_cap`. Body:
  `{ status: false, code, statusCode, limit, used, statusText, message }` (+ `guests: true` when the guest limit refused).
  Seats, workspaces and tracker seats answer HTTP 200 (AR-24; API-token callers get `statusCode` through strictStatus);
  uploads answer 507 / 413; tracker-only routes 403; lifecycle 423 `{ code: 'read_only' | 'suspended', message, graceUntil, portalUrl }`.
- **Routes**: `GET /api/v2/plan/usage` (any member; JWT + company) →
  `{ managed, plan, version, portalUrl, canManage, lifecycle:{state,message,graceUntil}, seats:{used,pending,limit,overLimit},
  guests:{used,limit,overLimit}, storage:{bytes,limit,level,byWorkspace?}, workspaces:{count,limit},
  timeTracker:{enabled,used,limit}, maxFileBytes, mail:{sentToday,limit,capped,queued?} }` (`byWorkspace` and `queued`
  for owners and admins only). `GET /api/v2/plan/workspaces` (JWT, no company) → `{ managed, count, limit, canCreate, portalUrl }`.
- **Socket.io**: `PLAN_UPDATED { version, plan, at }` to every signed-in socket (`socket/controller/instanceSocket.js`);
  a suspended instance answers every client event with `INSTANCE_LOCKED { code: 'suspended' }`.
- **062 usage report** gains `storage.level` (0, 80, 95, 100): the orchestrator's 15-minute poll is how the portal
  learns of the 80% and 95% thresholds and sends the email (067/069). `platform_state` `_id: 'mail'` `{ day, sent }` is
  written for every message (recipients counted).
- **066**: `applyEntitlements` writes `planFeature.trackerTimesheet = features.timeTracker.enabled` and
  `planFeature.timeTrackerUser = features.timeTracker.seats`; tracker sign-in (`/api/v1/auth/loginAuthTracker`,
  `/api/v2/auth/tracker-code`) and the tracker's own upload routes answer 403 `tracker_disabled` while the add-on is off.
- **Module API** (`require('Modules/Entitlements')`): `applyEntitlements(payload)`, `bootEntitlements()`, `limits()`,
  `feature(name)`, `lifecycle()`, `planFeatureFor(base)`, `seatRefusal(people, { includePending })`,
  `acceptanceRefusal({ userId, email, roleType })`, `assertUploadAllowed(companyId, size)`, `uploadLimitRefusal`,
  `trackerSeatRefusal(userId)`, `writable()`, `whenWritable(name, fn)`, the pure checks.
- **Collection**: global `mail_queue` (`SCHEMA_TYPE.MAIL_QUEUE`), mail held by the daily cap.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- Built autonomously (owner away). Decisions:
  - **Self-hosted changes nothing**: every new check returns ok and nothing is counted; the per-workspace `planFeature`
    checks keep deciding what they decided. One exception, a bug fix: the tracker seat check in
    `Modules/trackerUserPermission` ran on removing access (and refused it) instead of on granting it; it now runs on
    granting, which only matters where `planFeature.timeTrackerUser > 0`.
  - **Apply**: 062 calls `applyEntitlements` after storing a newer document, and 062's boot now applies the stored one
    (or the Starter defaults) right after loading it. Each apply writes `users`, `guestUser`, `bucketStorage` and
    `maxFileSize` (MiB), `timeTrackerUser`, `trackerTimesheet` into every workspace's `planFeature`, sets the portal URL,
    sets `{ mail: 'customer' }` ownership when `ownSmtp` (and clears it otherwise), clears `companyData_*` and the public
    config cache, and emits `PLAN_UPDATED`. A workspace created later gets the plan through `planFeatureFor`.
  - **Lifecycle** comes from 062's lifecycle store (`POST /lifecycle`); the `lifecycle` field inside the entitlements
    document is not used, so a push and a lifecycle call never disagree.
  - **Seats**: distinct people with a live seat in any workspace, support accounts left out. Guests count against
    `limits.guests` and never take a member seat; `guests: null` means guests are free. Sending invitations and imports
    count open invitations too (active + pending + new); accepting counts live seats only (active + 1). Someone already
    holding a seat anywhere takes none. Checked at: send invitation, import, accept (signed in, emailed link,
    `PUT /api/v1/root-members`), member reactivation in `updateMember`, SCIM invite / provision / reactivate, SSO
    just-in-time (refused before any account is made; the login page shows `ssoError=seat_limit`). The count is cached
    30 s and recounted fresh within 5 of a limit and for any batch, so the cache never decides a refusal.
  - **Failing open**: a database error while counting seats or workspaces lets the request through (logged), as the
    platform view asks: our trouble never locks a customer out.
  - **Storage**: one check in `bucketAccess.uploadRefusal`, which every upload route and the tracker captures already
    pass through twice — before multer writes (size unknown: refuses only a spent quota) and after (the file's size; the
    server driver's file is discarded). Plus `putLocalFile` (forms, page images), the server base64 route
    (`requirePlanRoom`) and cloud imports. Multer's `fileSize` is a getter that reads the plan's largest file per request;
    the cut-off error says it in the plan's words. Usage is 063's instance total (avatars and public assets never
    refused), cached 5 s and re-read before refusing, so a delete frees space at once. Copies of existing files (task,
    comment and field duplicates) and seed images are not refused; 063 counts them and its nightly reconciliation flags
    drift.
  - **Thresholds**: banner for owners and admins at 80, 95 and 100%; the portal learns them from `storage.level` in the
    usage report (no outbound call from the instance exists to notify it otherwise).
  - **Workspaces**: `POST /api/v2/company/create` checks before the form is read; the create page shows "2 of 3
    workspaces" and stops at the limit with a link to the portal.
  - **Tracker**: an early gate refuses the tracker-only routes (sign-in, code, v2/v3 start, v2 end, v2–v4 capture) while
    the add-on is off; the web timer and timelog routes are the web app's and stay open. Granting tracker access checks
    instance-wide tracker seats (a person already tracked elsewhere takes none). The web app: Settings → Time tracking
    shows the add-on notice, the task's "Open in desktop tracker" is hidden, Tracker timesheets were already gated by
    `planFeature.trackerTimesheet`. Nothing is deleted.
  - **Mail cap**: `Modules/service.js` asks before every send; recipients are counted, so one bcc to 100 people is 100.
    Over the cap the message is stored in `mail_queue` and the caller is told it was accepted; cron `mailQueue` (hosted
    only, every 10 minutes) sends it from the next UTC day while the day's allowance lasts, 5 attempts. Password reset,
    set-password, verification, magic link and the security alert pass `{ accountMail: true }`: always sent, still
    counted. A cap check that fails sends anyway. `service.js` sends through Nodemailer only; Resend (§16) is not in it.
  - **Read-only / suspended guard**: `setMiddleware.setPlanGuards(app)` runs right after the maintenance guard in
    `index.js` (before the JWT middleware, which is where the PRD's "early" lands). Read-only lets through every GET, the
    platform API, health, sign-in/out, token refresh, two-factor, password recovery, activation, OAuth/SSO sign-in, MCP
    token refresh, exports, and the POST routes that only read (`mongoOpration`, `*/find`, search, filters, dashboards,
    report run, workload, …); the instance console takes writes only with the platform key. Suspended lets through only
    the platform API, health and `GET /api/v2/instance/public-config`. Static files and the SPA load in both. Risk: a
    POST that only reads and is not listed gets 423; the SPA shows one toast per 4 s.
  - **MCP** stays reachable while read-only (its reads); agent writes are refused in `perform()`, agent runs in
    `canStart`. A proposal can still be filed over MCP while read-only (it changes no work until approved, and approval
    goes through `perform()`).
  - **Paused writers**: cron `writer()` wraps screenshotRetention, autoArchive, projectAutoClose, scheduledReports,
    projectDailyLook, projectTriage, recurringTasks, reminders, appConnections, timeReminders; the automation due-date
    tick, agent schedules and general reminders skip too. Each logs once when it pauses and once when it resumes, and
    catches up by itself (they act on what is due). Email-in is a webhook and gets 423.
  - **Socket.io**: no client event writes data by itself, so read-only lets events through and the one server write
    they cause (the call history line) checks `writable()`; suspended drops every event but disconnect and answers
    `INSTANCE_LOCKED`.
  - **SPA**: `services/planAnswers.js` on every axios instance: 423 read-only → toast, suspended → `/suspended`; plan
    refusals are re-worded from `Plan.refused.*` with their numbers (and the file name for uploads, toasted once). The
    login page goes to the Suspended notice when the public config says suspended; the public config gained
    `hosting.graceUntil` for "kept until".
  - **Plan & usage** (`/:cid/settings/plan`, name `PlanUsage`, which 061's upgrade links already target): no renewal
    date or add-on prices — the entitlements document carries neither; "Manage plan" and "Add storage or seats" open
    `portalUrl`. Seats show members (people who are not guests everywhere) against `limits.seats`.
  - **Banner**: highest priority first — read-only (everyone, not dismissible), payment due, seats over, storage 100/95/80,
    mail cap (owners and admins, dismissible for the session). Suspended has its own page.
- Tests: `entitlements-checks` (every check below, at and above its limit; seat dedupe; guests; read-only and suspended
  allowlists; socket events; usage numbers), `entitlements-apply` (planFeature rewrite, caches, `PLAN_UPDATED`, ownership,
  portal URL, boot with stored and default documents, 062 hand-off, self-hosted no-op), `entitlements-enforcement`
  (invitation, import, acceptance, guests, uploads over the quota and the largest file, avatars never refused, multer
  limit, workspaces, tracker gate and seats, 423 for read-only and suspended with their allowlists, paused writers,
  agent runs, mail queue to the next UTC day with account mail exempt, self-hosted unchanged),
  `entitlements-seat-routes` (accepting by page and by link, SSO just-in-time), `conventions/upload-plan-limits` (no
  multer user, upload route or direct writer skips the plan check), frontend `planUsage.spec.js`. Updated:
  `platform-entitlements` (the hand-off replaces the "nothing enforces" log), `hosting-mode` (`graceUntil` in the public
  config). 363 related backend suites: all pass but `upload-routes-order` and `process-guards` (failing before, Windows),
  `agent-rest-route-actions` (062's platform routes are not in its write-route table), `invitation-check-access`,
  `email-notification-workspace-scoping`, `tracker-user-permission-workspace-scoping` (each counts 062's `lastSeenAt`
  write as an unexpected database call) and `agent-spend-precall` (daily vs monthly cap wording; budget code untouched).
  Convention suites: only the known Windows ones fail (plain-words baseline line endings, style-check, ci-e2e-shards,
  role-playbooks, ai-core-boundary, retired-flags). `npm run i18n:check` and `npm run style:check` pass; `env-doc --check`
  differs only in line endings.
