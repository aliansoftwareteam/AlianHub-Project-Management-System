---
id: 062
title: Platform API — headless provisioning, config push, entitlements, usage and lifecycle
status: active
priority: high
depends_on: [060, 061]
created: 2026-10-27
---

# Platform API — headless provisioning, config push, entitlements, usage and lifecycle

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one

## Goal

Give the AlianHub Cloud platform one narrow, audited API on every hosted instance so it can, with
no human and no browser: create the owner and first workspace, push the credentials we own (S3,
mail, TURN), apply the customer's plan, read usage, move the instance between active, past-due,
read-only and suspended, and help an owner who lost access. This is the "pass them using the API"
part of the brief, and the only door the orchestrator (069) uses.

The contract — paths, bodies, auth — is fixed in
[architecture.md §8–§11](../../active/060-alianhub-cloud-programme/resources/architecture.md#8-the-platform-api-on-each-instance-task-062).
This PRD is how we build it.

## Where we start

- `/api/v2/instance/*` (`Modules/Instance/routes.js`) is guarded by `requireInstanceAdmin`, which
  accepts `INSTANCE_ADMIN_KEY` in an `adminkey` header or the instance owner's session.
- Setup (`Modules/Setup/controller.js` → `startInitialization`, `createOwner`, `createFirstCompany`)
  creates the owner **with a password typed in the wizard** and the first company with
  `planFeature`, sample data and team focus.
- Reset-password tokens and magic links exist (`/api/v2/auth/token-verify-forgotpassword`,
  `/api/v2/auth/magic-link`), so one-time-token sign-in machinery is already there to reuse.
- `Modules/Instance/maintenance.js` blocks every API call during a restore; there is no read-only
  or suspended state (064 builds the enforcement; this task stores and broadcasts the state).
- 061 provides `isManaged()`, boot checks for `PLATFORM_API_KEY` / `PLATFORM_PUBLIC_KEY`, and
  `savePlatformSettings()`.

## Scope — the work, task by task

### T1 — Module, guard and audit

- New module `Modules/Platform/` (`routes.js`, `controller.js`, `guard.js`, `entitlementsToken.js`,
  `usage.js`, `ownerLinks.js`, `platformState.js`), registered like every module (`init(app)`).
- `guard.js` `requirePlatform`:
  1. Not managed mode → **404** (the API does not exist on self-hosted installs).
  2. Request carries `x-forwarded-for` → **403**. Calls come from the host agent straight to the
     container on the Docker network; anything that crossed the public edge has that header. The
     edge also refuses the path (065) — this is the second lock.
  3. `x-platform-key` compared with `crypto.timingSafeEqual` against `PLATFORM_API_KEY` and any
     unexpired rotated key (T9). Mismatch → 401, counted; 10 failures a minute from one source
     address blocks that address for 15 minutes and logs `platform.auth_blocked`.
  4. Sets `req.platform = { requestId: req.headers['x-request-id'] }` for the audit trail.
- Every call writes an instance-level audit row to a new global collection `platform_audit`
  (`{ at, action, requestId, ok, summary, durationMs }`, TTL 400 days) — never request bodies
  holding secrets.
- `Modules/Instance/guard.js`: in managed mode a valid platform key is accepted by
  `requireInstanceAdmin` too (`req.instanceAdmin = 'platform'`), so the platform reuses the existing
  health, settings, stats, backups and maintenance endpoints instead of duplicating them.

### T2 — `GET /api/v2/platform/status`

Returns, in under 200 ms without touching tenant databases beyond a ping:

```json
{ "version": "14.40.0", "build": "14.40.0-beta.12",
  "dbOk": true, "setup": { "installed": true, "provisionId": "prv_01jd…" },
  "migrations": { "pending": 0, "error": null },
  "lifecycle": "active", "entitlementsVersion": 7,
  "maintenance": false, "bootedAt": "2026-11-02T09:00:00Z" }
```

The orchestrator uses it as its readiness probe after `stack.create` and after upgrades.

### T3 — `POST /api/v2/platform/provision` (headless setup)

Body: `{ provisionId, owner: { email, firstName, lastName }, workspace: { name, teamFocus },
sampleData, locale, timezone }`.

- Validate with the existing `validateSetupPayload` rules minus `password`; `locale` must be one of
  the app's locales; `timezone` an IANA zone.
- Idempotent by `provisionId`: stored on the `platform_state` document. Same id again → same
  `userId`/`companyId` and a fresh activation link (200). Different id once installed → 409.
- Steps: `startInitialization()` → `createOwner({ …, password: null })` → mark the owner
  `isProductOwner: true`, `activationPending: true`, language from `locale` →
  `createFirstCompany({ …, timezone })` (company working calendar and `CRON_TZ` default from
  `timezone`) → issue an activation token (T8).
- An owner with `activationPending` cannot sign in with a password (there is none) and is not shown
  in "forgot password" until activated; activation clears the flag.
- Response: `{ userId, companyId, activationUrl, activationExpiresAt }`. **The instance sends no
  email here**: the portal sends the branded welcome email containing the link (067/073), so the
  customer gets one consistent message from AlianHub Cloud.
- Emits the existing setup progress events so a support engineer tailing logs sees the steps.

### T4 — `PUT /api/v2/platform/config`

Body: `{ values: { S3_ACCESS_KEY: "…", S3_PREFIX: "ins_…/", RESEND_API_KEY: "…", … } }` (mail goes
through Resend's HTTPS API because DigitalOcean blocks SMTP ports).
Calls `savePlatformSettings` (061 T2) — full replace of the platform source. Only keys in the
catalog may be sent; a key outside the platform-owned set is refused (400, `errors[key]='not_platform'`)
so the platform cannot accidentally take a setting away from the customer. Response
`{ applied: [...], restartRequired: [...] }`; after 063, storage keys hot-reload and are no longer in
`restartRequired`. Secrets never appear in the audit summary (key names only).

### T5 — `PUT /api/v2/platform/entitlements`

Body: `{ token }` — a compact JWS, `alg: EdDSA`, header `kid`, payload as in architecture §9.

- `entitlementsToken.js` verifies with Node's `crypto.verify(null, …)` against
  `PLATFORM_PUBLIC_KEY` (no new dependency). Refuse when: signature bad; `payload.instanceId !==
  INSTANCE_ID`; `issuedAt` more than 5 minutes in the future; `version` ≤ stored version (answer
  200 `{ applied: false, version: <stored> }` — not an error, just stale).
- Store the raw token and decoded payload in `platform_state` (`_id: 'entitlements'`), then call
  064's `applyEntitlements(payload)`.
- Pull fallback: at boot and every 6 hours (`cron.js`), `GET {PLATFORM_URL}/api/v1/instances/
  {INSTANCE_ID}/entitlements` with `x-platform-key`; same verification. A failed pull logs a warning
  and keeps the stored document — **never** relaxes or tightens limits because the platform is down.
- No stored entitlements at all (a brand-new instance before the first push) → the instance runs
  with the Starter limits baked into the image as `DEFAULT_ENTITLEMENTS`, never unlimited.

### T6 — `GET /api/v2/platform/usage`

Builds the report in architecture §10 (`usage.js`):

| Field | Source |
|---|---|
| `seats.active` | distinct `userId` over `company_users` matching `ACTIVE_SEAT` (Config/seatStatus.js), across all companies, excluding agents and the platform's support user |
| `seats.pending` | distinct over `INVITED_SEAT` minus active |
| `seats.guests` | active seats whose role is a guest role |
| `workspaces.count` | non-deleted companies |
| `storage.bytes`, `byWorkspace` | 063's usage counter (no object listing) |
| `timeTracker.seatsUsed` | users with tracker permission (`trackerUserPermission`) |
| `mail.sentToday` | 064's daily mail counter |
| `activity.lastActiveAt`, `dau`, `mau` | `users.lastSeenAt` — add it if absent, written by the JWT middleware at most once an hour per user |
| `migrations` | migration state already tracked in `Config/instanceState.js` |

Cached 60 s. Must answer in under 1 s on an instance with 150 users and 10 workspaces.

### T7 — `POST /api/v2/platform/lifecycle`

Body: `{ state: 'active'|'past_due'|'read_only'|'suspended', reason, message, graceUntil }`.
Stores the state in `platform_state` (`_id: 'lifecycle'`), keeps it in memory for the request
guards 064 adds, emits a Socket.io event `INSTANCE_LIFECYCLE_CHANGED` to every connected client so
banners appear without a reload, and audits `platform.lifecycle` with from → to. `cancelled` and
`deleted` are not instance states — the stack is stopped by the orchestrator instead.

### T8 — Owner links

- `POST /owner/activation-link` → a new 7-day, single-use activation token for the owner (or for
  `email` if given and that user is the owner); older activation tokens for that user are revoked.
  Reuses the reset-password token store with `purpose: 'activation'` (hash stored, never the token).
  URL: `${WEBURL}/#/activate?token=…`.
- `POST /owner/login-link` → a 60-second, single-use sign-in token for the owner;
  URL `${WEBURL}/#/platform-login?token=…`. A new public route
  `POST /api/v2/auth/platform-login { token }` exchanges it through the existing
  `finalizeSession` and audits `platform.owner_login` in the owner's companies. Refused if the
  owner has two-factor auth on — the link then opens the normal login with the email filled in.
- `POST /owner/transfer { toEmail }` → the target must hold an active seat; moves
  `isProductOwner` to them, removes it from the previous owner, audits both.
- Activation page (`frontend/src/views/Auth/Activate.vue`): reuses the reset-password form with
  activation copy; on success signs the owner in and opens their workspace.

### T9 — `POST /api/v2/platform/rotate-key`

Body `{ newKey }` (≥ 32 chars). Stores `sha256(newKey)` in `platform_state.extraKeys` with a 24-hour
expiry; the guard accepts it alongside the env key. The orchestrator then re-renders `.env` with the
new key on the next `stack.update` (069); after that restart the env key is the new one and the
extra entry expires.

### T10 — `POST /api/v2/platform/support-session`

Body `{ staffEmail, staffName, expiresAt }`. Used by the back office (072) only while the owner's
support grant from the portal (067) is open; the platform checks the grant, the instance checks
`expiresAt` ≤ 24 hours away.

- Creates or reuses a flagged user `support@alianhub.com` (`isSupportUser: true`, excluded from seat
  counts and from member lists, shown as "AlianHub Support"), adds it to every workspace with the
  admin role for the session, and returns a one-time 60-second sign-in link like T8's.
- Never signs in as the owner or any customer user.
- Every action the support user takes carries the staff member's name in the audit row
  (`actor: 'AlianHub Support (Ravi K.)'`); the owner sees a banner "AlianHub Support has access
  until 14:00" with **End access now** (which calls the portal, which closes the session).
- When `expiresAt` passes, a job removes the support user's seats and revokes its sessions.

### T11 — Docs and tests

- `docs/hosting/platform-api.md`: every endpoint with curl examples and error codes. The OpenAPI
  file is regenerated by `npm run api:doc` in the follow-up docs PR (CLAUDE.md Rule 4), not in the
  feature PR.
- Jest: guard (404 self-hosted, 403 forwarded, 401 bad key, lockout), provision idempotency and
  409, activation flow end to end, JWS verification (good, bad signature, wrong instance, stale
  version, future `issuedAt`), pull fallback keeps stored entitlements on network error, usage
  numbers on a seeded instance, lifecycle broadcast, login-link single use and 60 s expiry,
  rotation window.
- e2e (Playwright, `e2e/`): provision → open activation link → set password → land in the workspace.

## How it looks

The orchestrator's view (through the host agent, internal network):

```
POST /api/v2/platform/provision
x-platform-key: ••••
x-request-id: job_01jd…:owner_provisioned

{ "provisionId": "prv_01jd…",
  "owner": { "email": "maya@acme.com",
             "firstName": "Maya", "lastName": "Shah" },
  "workspace": { "name": "Acme",
                 "teamFocus": "software" },
  "sampleData": true, "locale": "en",
  "timezone": "Asia/Kolkata" }

200
{ "status": true, "statusText": "Provisioned.",
  "data": { "userId": "6731…", "companyId": "6731…",
    "activationUrl": "https://acme.alianhub.com/#/activate?token=…",
    "activationExpiresAt": "2026-11-09T10:00:00Z" } }
```

The owner's first screen (from the welcome email):

```
        Welcome to Acme on AlianHub
   Set a password for maya@acme.com
   Password          [ ••••••••••   ]
   Confirm password  [ ••••••••••   ]
   ✓ 10+ characters  ✓ a number
          [ Set password and open ]
```

Portal "Open AlianHub" (login link) — a thin banner after landing:

```
 Signed in from your AlianHub account.  ✕
```

A key mismatch, as an operator sees it in `platform_audit`:

```
2026-11-02T10:01:07Z platform.auth_failed  ok=false
2026-11-02T10:01:09Z platform.auth_blocked ok=false
  summary="10 failures/min from 172.18.0.5"
```

## Platform view

- **Network.** Only the host agent calls this API, over the Docker `edge` network directly to the
  container. Edge refusal (065) + forwarded-header refusal + key = three independent locks.
- **Secrets.** `PLATFORM_API_KEY` is unique per instance, generated by the control plane, stored
  encrypted there, and rotatable without downtime (T9). Entitlements are signed by a key that never
  leaves the control plane, so even a leaked platform key cannot raise a plan's limits.
- **Idempotency.** Every write endpoint is safe to retry: provision by `provisionId`, config by full
  replace, entitlements by version, lifecycle by target state. The orchestrator's retries (069) rely
  on this.
- **Failure modes.** Instance down → the job fails and retries; provisioning half-done (owner
  created, company not) → the retry with the same `provisionId` completes it because each step
  checks before creating.
- **Observability.** `x-request-id` (the job id and step) is logged with every call, so a failed
  step in the back office links straight to the instance's log lines.

## Management view

- **What it unlocks.** Zero-touch provisioning (the product), plan changes in a minute, and support
  actions — "resend activation", "owner lost access", "transfer ownership" — as buttons in the back
  office (072) instead of database edits.
- **Cost.** 6–8 developer days; no running cost.
- **Risks.** A bug here could lock customers out or open a back door. Mitigations: 404 on
  self-hosted, three locks, audit of every call, and the security review in 073 covers this module
  explicitly.
- **Metric.** Provisioning success rate on the first attempt (target ≥ 99%), surfaced by 069.

## Out of scope

- Enforcing limits and read-only/suspended behaviour — 064 (this task stores and broadcasts).
- S3 hot reload and usage counting — 063.
- Sending emails — the portal does (067/073).
- Deleting tenant data — done at the infrastructure level by the orchestrator (069), never by the app.

## Acceptance criteria

- [ ] On a self-hosted instance every `/api/v2/platform/*` path returns 404.
- [ ] In managed mode a call with `x-forwarded-for` returns 403 and a wrong key 401; 10 wrong keys a
      minute block the source for 15 minutes.
- [ ] `POST /provision` on a fresh instance creates the owner (no password, activation pending) and
      the first workspace with sample data, and returns a working activation URL; repeating it with
      the same `provisionId` returns the same ids; a different `provisionId` returns 409.
- [ ] Opening the activation URL lets the owner set a password and lands them in their workspace;
      the link cannot be used twice and expires after 7 days.
- [ ] `PUT /config` applies platform values, refuses non-platform keys, and audit rows name keys only.
- [ ] `PUT /entitlements` applies a valid newer token, ignores an older one, refuses a forged or
      foreign one; the pull at boot recovers a missed push; the platform being unreachable changes
      nothing.
- [ ] `GET /usage` returns every field in architecture §10 within 1 s on 150 users / 10 workspaces.
- [ ] `POST /lifecycle` changes state and every open browser shows the new banner within 2 s.
- [ ] `POST /owner/login-link` signs the owner in once within 60 s and never again.
- [ ] `POST /owner/transfer` moves instance ownership to an active member.
- [ ] Key rotation: both keys work for 24 h; after the stack update only the new one does.
- [ ] Existing `/api/v2/instance/*` endpoints accept the platform key in managed mode.
- [ ] `POST /support-session` gives a flagged support user admin access until `expiresAt`, never
      counts as a seat, names the staff member in every audit row, shows the owner a banner, and
      loses all access when the time passes.

## Dependencies

- 061 (managed mode, platform settings source).
- 063 and 064 consume T4–T7; they can be built in parallel against the stored state.

## Open questions

- Q20 — support access: default is an owner-granted, time-boxed support session (T10); staff never
  sign in as the owner.

## Estimate

6–8 developer days.
