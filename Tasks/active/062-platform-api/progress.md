# Progress: Platform API — headless provisioning, config push, entitlements, usage and lifecycle

## Checklist

- [x] T1 — `Modules/Platform`, guard, audit; instance routes accept the platform key
- [x] T2 — `GET /status`
- [x] T3 — `POST /provision` (headless setup, activation-pending owner)
- [x] T4 — `PUT /config`
- [x] T5 — `PUT /entitlements` with JWS verification and pull fallback
- [x] T6 — `GET /usage`
- [x] T7 — `POST /lifecycle` with live broadcast. The banner every browser shows is 064's `PlanBanner` (064 T9); 062 stores, broadcasts `INSTANCE_LIFECYCLE_CHANGED` and adds `hosting.lifecycle` to the public config.
- [x] T8 — Owner activation link, login link, transfer; activation page
- [x] T9 — `POST /rotate-key`
- [x] T10 — `POST /support-session` (time-boxed, flagged support user)
- [ ] T11 — Docs and jest done; the Playwright e2e (provision → activate → workspace) is not written: it needs a managed-mode stack to run against (065).

## Last step

T1–T10 and the T11 docs and jest suites built on `feat/platform-api` (not pushed). Next: 064 builds
`Modules/Entitlements` on this branch (its `index.js` exports `applyEntitlements(payload)`), then the
e2e on 065's stack.

## Blockers

None for the app. The e2e waits for a managed-mode stack (065).

## Contracts other tasks use

- **Routes** (`Modules/Platform/routes.js`): `GET /api/v2/platform/status`, `POST /provision`, `PUT /config`,
  `PUT /entitlements`, `GET /usage`, `POST /lifecycle`, `POST /owner/activation-link`, `POST /owner/login-link`,
  `POST /owner/transfer`, `POST /rotate-key`, `POST /support-session`, `DELETE /support-session`. Public, hosted only:
  `POST /api/v2/auth/platform-login`, `POST /api/v2/auth/activation/verify`, `POST /api/v2/auth/activate`.
  Owner session (instance guard): `GET /api/v2/instance/support-access`. Reference: `docs/hosting/platform-api.md`.
- **064**: `Modules/Platform/entitlements.js` exports `DEFAULT_ENTITLEMENTS` (Starter, §12), `currentEntitlements()`
  (stored payload or the defaults), `storedEntitlements()`, `storedVersion()`, `loadEntitlements()`. After a verified
  newer token is stored it calls `require('Modules/Entitlements').applyEntitlements(payload)` when that module exists
  (until then it logs once). `Modules/Platform/lifecycle.js`: `lifecycle()` (in memory, for request guards),
  `lifecycleState()`, `LIFECYCLE_STATES`, `loadLifecycle()`. Seats to leave out: `company_users.isSupportUser` /
  `users.isSupportUser` (same filter as `Modules/Platform/usage.js`). The usage report reads `platform_state`
  `_id: 'mail'` `{ day: 'YYYY-MM-DD' (UTC), sent }`, which 064 writes.
- **065**: call with `x-platform-key` and no `x-forwarded-for`; the same applies on `/api/v2/instance/*`. Maintenance
  lets `/api/v2/platform/*` through. No new env variables.
- **069**: `x-request-id` is kept in each `platform_audit` row. Entitlements pull: `GET {PLATFORM_URL}/api/v1/instances/
  {INSTANCE_ID}/entitlements` with `x-platform-key`, answer `{ token }` (or `{ data: { token } }`). After `rotate-key`,
  render the new key into `.env` within 24 hours. Every write is idempotent (provision by `provisionId`, config by full
  replace, entitlements by version, lifecycle by target state, support session by replacement).
- **Collections** (global DB): `platform_state` (`_id`: `provision`, `entitlements`, `lifecycle`, `keys`, `support`,
  `mail`) and `platform_audit` (TTL 400 days). New fields: `users.lastSeenAt`, `users.activationPending`,
  `users.isSupportUser`, `users.supportSession`, `company_users.isSupportUser`, `userAuth.oneTimeTokens`.
- **Socket.io**: `INSTANCE_LIFECYCLE_CHANGED { state, message, graceUntil, changedAt }` and
  `INSTANCE_SUPPORT_ACCESS_CHANGED { active, expiresAt? }` to every signed-in socket (`socket/controller/instanceSocket.js`).

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- Built autonomously (owner away). Decisions:
  - **Guard order**: not managed → 404; `x-forwarded-for` present → 403; source blocked → 429; key wrong → 401.
    Keys are compared as sha256 digests with `timingSafeEqual`, so length leaks nothing. The lockout is in memory
    (one process per stack) and keyed on `requestAddress(req)`; it writes one `platform.auth_blocked` row when it starts,
    not one per refused call. Rotated keys are cached 30 s.
  - **Audit**: `platform_audit` rows for every call and for refused ones (`auth_failed`, `auth_forwarded`, `auth_blocked`);
    instance routes reached with the key write `platform.instance` rows. Owner sign-in, transfer and support sessions
    also write tenant audit rows (`platform.owner_login`, `platform.owner_transferred`, `platform.support_login`,
    `platform.support_session_started`, `platform.support_session_ended`), with words in `eventWords.js` and `AuditEvents`.
  - **Provision** reuses `startInitialization`, `createOwner` and `createFirstCompany`. `createOwner` takes
    `password: null` (a userAuth row with no hash: `insertAuthFun` accepts an explicit null only with `passwordless`)
    and a profile (`activationPending`, `languageCode`, `Time_Zone`). There is no company time zone field, so
    `timezone` sets the owner's `Time_Zone` and `CRON_TZ` (saved, owner-owned; applies from the next restart) unless
    set already. A retry checks `platform_state.provision` and then the database before each step. A different
    `provisionId`, or an instance set up without one, is 409. Steps go to `/api/v2/setup/events/<provisionId>`.
  - **One-time tokens**: the reset-password store keeps a raw JWT in `userAuth.token`, which cannot hold a hash or a
    purpose, so links use `userAuth.oneTimeTokens.{activation|login} = { hash, expiresAt }`: one live token per purpose,
    consumed by one conditional `findOneAndUpdate`. Activation 7 days, sign-in 60 s.
  - **Activation-pending owner** and the **support account** are never sent a reset, set-password or magic-link mail
    (`refusesPasswordMail`, hosted only). The support account gets a session only while a support session is live,
    whatever way in is tried (`sessionRefusalFor`).
  - **Two-factor owner**: the login token is used up and the exchange answers 409 `{ twoFactorRequired, email }`; the
    page stores the address where the login form reads it (`ForgotEmail`) and opens the normal login.
  - **Activation page** lives at `frontend/src/views/Authentication/Activate/Activate.vue` (where every auth page is),
    not `views/Auth/`: `NewPasswordCard` gained an `activation` mode. On success it hands over to the login page's
    existing `magic=ok&uid=` path, which opens the workspace. `/platform-login` sets a one-time flag for the
    "Signed in from your AlianHub account" notice.
  - **Entitlements**: a stale version answers 200 `{ applied: false, version }`; forged, foreign, future and malformed
    tokens 400 with a `code`. The pull runs at boot and in cron (`platformEntitlementsPull`, hosted only, random minute
    every 6 hours) and never changes anything on failure. `kid` is stored beside the token. The portal URL is left to
    064 (061 said 064 sets it).
  - **Usage**: `seats.active` counts guests too; `seats.guests` are people whose every live seat is a guest's;
    `pending` are invited addresses with no live seat anywhere. AI agents hold no `company_users` seat, so there is
    nothing to subtract for them. `timeTracker.limit` is 0 while the add-on is off. `lastSeenAt`: the JWT middleware's
    session path only notes the moment in memory (hosted only); `Config/lastSeen.js` writes the notes every 5 minutes
    in one bulk write, at most once an hour per person, and the usage report flushes first. No request writes it.
  - **Support session**: the account is created through `addUserMongodbV2` (no password) or reused; a customer account
    already using `support@alianhub.com` is refused (409). Seats are `company_users` rows with `isSupportUser: true`,
    admin role, in every non-deleted workspace; they are removed with its sessions at `expiresAt` (in-process timer plus
    the `platformSupportExpiry` cron) or on `DELETE /support-session`, which the portal's revoke maps to. Audit rows get
    `actorName: 'AlianHub Support (<staff>)'` in `recordAudit` itself, so every writer is covered. Member lists hide the
    seat from everyone but the account. The owner's banner reads `GET /api/v2/instance/support-access`; **End access
    now** opens the portal URL (the portal closes the grant and calls `DELETE /support-session`).
  - **Conventions**: `scripts/route-walk.js` knows `requirePlatform` (guard `platform`) and `scripts/api-doc.js` gives it
    an auth class (`x-platform-key`); `/api/v2/platform` is self-guarded in `v2-guard`; the three public link routes are
    listed in `route-guard-coverage`; `request-address` lists the guard as reading the forwarded header for presence only.
    `docs/API.md` and `docs/api/openapi.json` are left for the follow-up docs PR (Rule 4).
- Tests: `platform-guard` (404 self-hosted on every path, 403 forwarded, 401, lockout and its expiry, rotation window,
  instance routes with the key), `platform-entitlements` (good, bad signature, tampered, wrong instance, future, stale,
  pull applies / keeps on network error, error answer and forged token, Starter defaults), `platform-provision`
  (validation, provision, idempotency, 409, status, locales match the frontend, activation end to end, single use,
  7-day expiry, login link single use and 60 s, two-factor, transfer), `platform-usage` (seat rules; 150 people in
  10 workspaces, every §10 field), `platform-lifecycle-support` (lifecycle store and broadcast, config push refusals and
  key-only audit, rotation, support session seats, audit names, expiry, revoke), `platform-last-seen`,
  `member-list-fields` (support seat hidden), frontend `hostedOwnerLinks.spec.js`. Related suites pass (61 unit
  suites, 1,506 tests; 11 convention suites). `tests/api-doc.test.js` fails as before this task.
- Fix after review: the first `lastSeenAt` version wrote from the request path, which three scoping suites caught as an
  unexpected database call; moved to the flush above. `agent-rest-route-actions` now finds the platform routes and the
  three public link routes listed in `tests/fixtures/agentRoutesOutsideProjects.js`.
