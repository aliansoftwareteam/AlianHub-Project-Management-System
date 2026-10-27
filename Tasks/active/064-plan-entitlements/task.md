---
id: 064
title: Plan entitlements — limits enforced on the server, read-only and suspended states, Plan & usage page
status: active
priority: high
depends_on: [060, 061, 062, 063]
created: 2026-10-27
---

# Plan entitlements — limits enforced on the server, read-only and suspended states, Plan & usage page

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one

## Goal

Make the plan the customer pays for real inside their instance: seats, workspaces, storage, file
size, time-tracker seats and daily mail are enforced **on the server** from the signed entitlements
document; non-payment turns the instance read-only and then suspended; and every member can see
where they stand on a **Plan & usage** page with a way to the portal to buy more. Limits must be
friendly — warn early, refuse clearly at the edge of the limit, and never break what already exists
(a full storage quota blocks new uploads, not reading old files).

## Where we start

- Each company carries `planFeature` (`Modules/Setup/defaultSubscriptionData.js`): `users`,
  `bucketStorage` (MB), `maxFileSize`, `timeTrackerUser`, `guestUser`, feature booleans
  (`chat`, `customFields`, `workloadView`, …) and nulls for unlimited.
- Those limits are mostly checked **in the browser** (`frontend/src/composable/index.js` storage and
  file size; `Members.vue` seats; `ReviewMapping.vue` import seats). Only the tracker seat count is
  checked on the server (`Modules/trackerUserPermission/controller.js`).
- Storage used is computed by listing every object (`getBucketSize`), too slow to check per upload.
- Seat changes go through `Modules/settings/Members/membershipGuard.js` (`guardInvitation`,
  `guardUserImport`, invitation acceptance) — the natural choke point for seats.
- Uploads converge on `common-storage/common.js` and `Modules/storage/*` (task files, chat, docs
  images, avatars, imports, whiteboards, clips, tracker screenshots).
- Mail goes out through `Modules/service.js` (Nodemailer or Resend).
- 062 stores entitlements and lifecycle state and broadcasts lifecycle changes; 063 maintains a
  per-workspace byte counter.

## Scope — the work, task by task

### T1 — `Modules/Entitlements`: one place that answers "may this happen?"

- `entitlements.js`: holds the current document (from 062's `platform_state`), exposes
  `limits()`, `feature(name)`, `lifecycle()`, and `applyEntitlements(payload)` (called by 062).
- `checks.js` — pure functions, unit-tested without a database:
  `canAddSeats({ activeSeats, adding, limit })`, `canStore({ usedBytes, adding, limit })`,
  `fileAllowed({ size, maxFileBytes })`, `canCreateWorkspace({ count, limit })`,
  `canAssignTrackerSeat({ used, limit, enabled })`, `canSendMail({ sentToday, limit })`. Each returns
  `{ ok: true }` or `{ ok: false, code, limit, used }` with codes `seat_limit`, `storage_full`,
  `file_too_large`, `workspace_limit`, `tracker_disabled`, `tracker_seat_limit`, `mail_cap`.
- Self-hosted mode: every check returns `ok` unless the existing `planFeature` says otherwise —
  current self-hosted behaviour does not change.
- `applyEntitlements` also writes the derived numbers into every company's `planFeature`
  (`users = limits.seats`, `bucketStorage = storageBytes / 1 MiB`, `maxFileSize`,
  `timeTrackerUser = features.timeTracker.seats`, `guestUser = limits.guests`) so the existing
  browser checks and screens show the right numbers with no further change, clears the
  `companies` cache keys, and emits `PLAN_UPDATED` over Socket.io.
- Calls 061's `setOwnershipOverrides({ mail: 'customer' })` when `features.ownSmtp` is true.

### T2 — Seats (instance-wide)

- Count = distinct users holding an `ACTIVE_SEAT` in any workspace of the instance, excluding AI
  agents and the support user (same query as 062 usage).
- Enforced in: `guardInvitation` (sending invitations: active + pending + new ≤ limit), invitation
  acceptance (`/api/v2/auth/invitation-accept` and the link flow: active + 1 ≤ limit), member
  re-activation in `judgeMemberUpdate` (status → active), `guardUserImport` (CSV/bulk import),
  SCIM provisioning (`Modules/Scim`), SSO just-in-time creation (`Modules/SSO`), and adding an
  existing instance user to another workspace (does **not** consume a new seat — same person).
- Guests count against `limits.guests` instead of `seats` when guests are limited separately.
- Over the limit (a downgrade the billing side let through, or an add-on removed): nobody is removed;
  new seats are refused until the count is back under the limit; the owner sees a banner.

### T3 — Storage and file size

- Before writing any file: `canStore(used + size)` and `fileAllowed(size)` — one helper,
  `assertUploadAllowed(companyId, size)`, called from the shared upload paths in
  `common-storage/common.js` and `Modules/storage/*` so every feature (task attachments, comments,
  chat, docs, whiteboards, clips, imports, avatars, tracker screenshots) is covered by one call site
  per driver, not per feature. A convention test greps for upload calls that bypass it.
- Multer limits (`fileSize`) read `limits.maxFileBytes` in managed mode so oversized files are cut
  off while streaming, not after.
- Usage is instance-wide (sum of workspaces) against `limits.storageBytes`, from 063's counter.
- Thresholds: at 80% and 95% the owner and admins see a banner and the portal is notified (it sends
  the email); at 100% uploads are refused with `storage_full`. Deleting files frees space at once
  (the counter decrements); emptying Trash is what frees trashed files.
- Refusal message in the upload UI: "Storage is full (100 GB of 100 GB). Delete files or add
  storage." with a link to Plan & usage.

### T4 — Workspaces

`canCreateWorkspace` in the in-app "create company" flow (`frontend/src/plugins/createcompanyinside`
and its API) against `limits.workspaces`. The button shows "2 of 3 workspaces" and is disabled at
the limit with an upgrade link.

### T5 — Time tracker add-on

- `features.timeTracker.enabled = false` → tracker sign-in (`/api/v1/auth/loginAuthTracker`,
  `/api/v2/auth/tracker-code`) refuses with `tracker_disabled`; tracker upload and sync endpoints
  refuse; the web app hides Tracker timesheets and the tracker download card, and Settings → Time
  tracking shows "The desktop time tracker is an add-on" with a link to the portal.
- `seats`: assigning tracker permission (`Modules/trackerUserPermission`) checks
  `canAssignTrackerSeat`; the existing `planFeature.timeTrackerUser` check stays and reads the same
  number.
- Removing the add-on does not delete screenshots or time entries; they stay readable.

### T6 — Daily mail cap

- A per-instance counter (`platform_state.mail = { day, sent }`) incremented in `Modules/service.js`
  for every message sent. At `limits.emailsPerDay` further mail is **queued** in the existing
  notification path until the next UTC day rather than dropped, and the owner sees a banner;
  password-reset and activation mail are exempt so nobody is locked out.
- Purpose: a compromised or abusive instance cannot burn our sending reputation (architecture §16).

### T7 — Read-only and suspended

A request guard registered early in `Config/setMiddleware.js`, reading 062's lifecycle state:

| State | Allowed | Refused |
|---|---|---|
| `active`, `past_due` | everything | — |
| `read_only` | all `GET`; sign-in, sign-out, token refresh, 2FA; exports (`Modules/Export`, `ExportJobs`); the platform API; health | every other `POST/PUT/PATCH/DELETE` → 423 `{ code: 'read_only', message }` |
| `suspended` | the platform API, health, `GET /api/v2/instance/public-config` | everything else → 423 `{ code: 'suspended' }` |

- Socket.io: in `read_only` and `suspended`, client-emitted mutation events are dropped with an
  error event; background jobs that write on behalf of users (automations, recurring tasks, agent
  runs, scheduled reports, email-in) pause and resume on `active`.
- The SPA treats 423 globally: a toast with the message for `read_only`; for `suspended` it routes to
  a Suspended screen. Login shows the suspended notice before asking for a password.
- `past_due` shows a banner to owners and admins only; members see nothing (their admin pays).

### T8 — Plan & usage page

New page Settings → Workspace → **Plan & usage** (`frontend/src/views/Settings/Plan/PlanUsage.vue`),
visible to everyone in managed mode, actions for owners and admins only. Reads a new
`GET /api/v2/plan/usage` (signed-in, any member; same numbers as 062 usage without
`byWorkspace` details for non-admins). Live-updates on `PLAN_UPDATED`. "Manage plan" opens
`entitlements.portalUrl` in a new tab. Replaces every old "Upgrade" link (061 T7).

### T9 — Banners

One `PlanBanner.vue` in the shell, highest-priority message only, dismissible per session except
suspended/read-only: `past_due` (owners/admins), `read_only` (everyone), `storage ≥ 80%`,
`seats over limit` (owners/admins), `mail cap reached` (owners/admins).

### T10 — Tests and conventions

- Jest: every pure check at, below and above its limit; seat count dedupe across workspaces;
  every enforced route returns the right code; read-only allowlist; suspended allowlist;
  `applyEntitlements` rewrites `planFeature` and clears caches; self-hosted mode unchanged.
- Convention test: no upload path skips `assertUploadAllowed`.
- e2e: fill storage to the limit on a test instance → upload refused → delete a file → upload works;
  set `read_only` → edits refused, export works.
- i18n keys under `Plan.*`; colours from tokens.

## How it looks

Settings → Plan & usage (owner, Pro plan):

```
Plan & usage
───────────────────────────────────────
Pro · renews 2 Dec 2026        Active
                         [ Manage plan ]

Seats            23 of 60
███████████░░░░░░░░░░░░░░░░░░  38%
  50 in Pro + 10 add-on

Storage          13.3 of 150 GB
███░░░░░░░░░░░░░░░░░░░░░░░░░░  9%
  100 GB in Pro + 50 GB add-on
  Acme ………………………… 13.0 GB
  Acme Labs …………… 0.3 GB

Workspaces       2 of 3
Time tracker     8 of 20 tracked users
Largest file     100 MB
Email today      140 of 2,000

Add-ons
  Extra storage +50 GB       $10/mo
  Time tracker × 20 users    $40/mo
              [ Add storage or seats ]
```

Storage at 96% (owner banner):

```
⚠ Storage is 96% full (144 of 150 GB).
  New uploads stop at 100%.  Add storage →
```

Upload refused (any member):

```
┌ Couldn't upload report.pdf ──────────┐
│ Your workspace is out of storage     │
│ (150 GB of 150 GB). Ask an admin to  │
│ free space or add storage.           │
└──────────────────────────────────────┘
```

Read-only (everyone):

```
🔒 This workspace is read-only because the
   subscription is unpaid. You can view
   and export everything. Owner: update
   payment →
```

Suspended (login page):

```
      Acme's workspace is suspended
  The subscription ended or payment
  failed. Your data is kept until
  2 Dec 2026. The owner can restore
  access in their AlianHub account.
        [ Go to AlianHub account ]
```

## Platform view

- **Trust.** Limits come only from the Ed25519-signed document (062); the platform API key alone
  cannot raise them, and a customer with database access (they have none) still could not forge one.
- **Fail-open on our outage, closed on theirs.** If the portal is down, the last good entitlements
  stay; nothing locks. If the customer stops paying, the state machine on our side drives
  read_only/suspended deliberately.
- **Performance.** All checks read in-memory state plus 063's counter — no object listing, no extra
  database round trip on the hot path except the seat count (indexed, cached 30 s, invalidated on
  seat changes).
- **Background jobs.** Pausing writers in read-only prevents automations from failing noisily for
  two weeks; they resume on `active`.
- **Abuse.** The mail cap and storage cap bound the damage of a compromised instance.

## Management view

- **Revenue.** This is what makes the add-ons sellable: storage and tracker seats are only worth
  buying if the limit is real. The Plan & usage page and the 80%/95% banners are the main upsell
  surfaces.
- **Churn and goodwill.** Read-only before suspension, exports always allowed, and data kept 30 days
  after cancellation reduce chargebacks and angry tickets.
- **Metrics to watch** (back office, 072): share of instances above 80% of any limit (upsell
  pipeline), refused uploads per day, seat-limit refusals, time from 95% storage to add-on purchase.
- **Cost.** 7–9 developer days. The mail cap and pausing jobs add testing time.
- **Risk:** a missed upload path lets a customer exceed storage. Mitigation: the convention test and
  063's nightly reconciliation flag any drift.

## Out of scope

- Feature-flag gating of individual views (`planFeature.workloadView` etc.) — all hosted plans get
  every feature in v1; only quantities differ (Q1 may change this).
- Billing, prices and the portal pages behind "Manage plan" — 067/068.
- AI usage caps — the existing per-workspace AI budgets cover BYO keys (Q14).

## Acceptance criteria

- [ ] With the Starter entitlement (10 seats), inviting an 11th distinct person is refused on the
      server with `seat_limit`, whether through invite, link, import, SCIM or SSO; adding an existing
      member to a second workspace is allowed.
- [ ] An upload that would cross `storageBytes` is refused with `storage_full` on every upload path;
      a file above `maxFileBytes` is cut off during streaming; deleting a file frees its bytes at once.
- [ ] Owners see banners at 80% and 95% storage.
- [ ] Creating a workspace beyond `limits.workspaces` is refused.
- [ ] With the tracker add-on off, the tracker cannot sign in, tracker screens are hidden, and old
      screenshots and entries stay readable; with it on, tracker seats are capped.
- [ ] Mail beyond `emailsPerDay` is queued to the next day; activation and reset mail still send.
- [ ] `read_only`: every write returns 423 `read_only`, reads, sign-in and exports work, automations
      pause and resume on `active`.
- [ ] `suspended`: the login page shows the suspended notice; every API except platform, health and
      public config returns 423.
- [ ] A new entitlements push updates Plan & usage for signed-in users without a reload.
- [ ] Self-hosted mode behaves exactly as before (existing suite green).
- [ ] i18n and style checks pass.

## Dependencies

- 061 (managed mode, ownership overrides), 062 (stored entitlements and lifecycle, broadcast),
  063 (storage counter).

## Open questions

- Q1 — the numbers in the limits (defaults in architecture §12).
- Q12 — storage behaviour at the limit (default: refuse new uploads only).
- Q13 — timeline between states (the instance only follows the state it is given).

## Estimate

7–9 developer days.
