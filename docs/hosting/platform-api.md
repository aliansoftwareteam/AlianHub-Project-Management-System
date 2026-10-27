# Platform API (hosted instances)

The AlianHub Cloud control plane drives every hosted instance through `/api/v2/platform/*`
(`Modules/Platform`). Nothing else in the product uses it, and on a self-hosted instance it does not
exist: every path answers **404**.

## How a call gets in

Three locks, each enough on its own to stop a stranger:

1. The edge (Traefik, task 065) refuses the `/api/v2/platform` path from the internet.
2. A request carrying `x-forwarded-for` is refused with **403**: it crossed a proxy. The host agent
   calls the container directly on the Docker network (or through `docker compose exec`).
3. `x-platform-key` must equal `PLATFORM_API_KEY`, or a key added with `POST /rotate-key` in the last
   24 hours. Compared in constant time. A missing or wrong key is **401**; 10 wrong keys within a
   minute from one source address block that address for 15 minutes (**429**, even with the right key).

Send `x-request-id` (the job id and step, e.g. `job_01jd…:owner_provisioned`). It is logged and kept
in the audit row, so a failed step links straight to the instance's log lines.

The same key, under the same three locks, also opens the existing `/api/v2/instance/*` routes
(`req.instanceAdmin = 'platform'`): health, settings, stats, backups, maintenance, restart.

Every call writes one row to the global `platform_audit` collection, kept 400 days:
`{ at, action, requestId, ok, summary, durationMs }`. Summaries name keys and ids, never values or
request bodies. `platform.auth_failed`, `platform.auth_blocked` and `platform.auth_forwarded` rows
record refused calls.

```sh
# From the host, into the app container of one tenant stack
docker compose -p t_ins_01jd3k… exec -T app sh -c \
  'curl -s -H "x-platform-key: $PLATFORM_API_KEY" -H "x-request-id: job_1:status" http://localhost:4000/api/v2/platform/status'
```

Every answer has the usual shape: `{ status: true, statusText, data }`, or
`{ status: false, statusText, errors?, code? }` with the HTTP status below.

## Endpoints

### `GET /status`

The readiness probe after `stack.create` and after an upgrade. Pings the database and reads two small
global documents; never a workspace database.

```json
{ "version": "14.40.0", "build": "14.40.0-beta.12", "dbOk": true,
  "setup": { "installed": true, "provisionId": "prv_01jd…" },
  "migrations": { "pending": 0, "error": null },
  "lifecycle": "active", "entitlementsVersion": 7,
  "maintenance": false, "bootedAt": "2026-11-02T09:00:00.000Z" }
```

### `POST /provision`

Headless setup: the owner (no password, activation pending) and the first workspace, with the same
helpers the setup wizard uses. The instance sends no email; the portal mails the activation link.

```sh
curl -s -X POST http://localhost:4000/api/v2/platform/provision \
  -H "x-platform-key: $PLATFORM_API_KEY" -H 'content-type: application/json' \
  -d '{ "provisionId": "prv_01jd…", "owner": { "email": "maya@acme.com", "firstName": "Maya", "lastName": "Shah" },
        "workspace": { "name": "Acme", "teamFocus": "software" }, "sampleData": true, "locale": "en", "timezone": "Asia/Kolkata" }'
```

→ `{ userId, companyId, activationUrl, activationExpiresAt }`

| Status | When |
|---|---|
| 400 | A field is wrong; `errors` names each: `provisionId`, `firstName`, `lastName`, `email`, `companyName`, `teamFocus`, `locale` (one of the app's languages), `timezone` (an IANA zone). |
| 409 | The instance was provisioned with another `provisionId`, or set up some other way. |

Idempotent by `provisionId`: the same order again answers the same ids and a fresh activation link
(the previous link stops working). An interrupted run is finished by the retry: each step looks for
what an earlier run made first. The steps are also sent to `/api/v2/setup/events/<provisionId>`.
`timezone` becomes the owner's time zone and `CRON_TZ`, unless the environment or the owner set one
(`CRON_TZ` is read at boot, so it applies from the next restart).

### `PUT /config`

```json
{ "values": { "S3_ACCESS_KEY": "…", "S3_SECRET_KEY": "…", "S3_PREFIX": "ins_01jd…/", "RESEND_API_KEY": "re_…" } }
```

Replaces the whole platform source of Instance settings (061): a key left out falls back to the owner's
value or the default. `{ "set": true }` for a secret keeps the value already pushed. Storage keys reload
the S3 client at once (063).

→ `{ applied: [...], restartRequired: [...] }`

| Status | When |
|---|---|
| 400 | `errors[key]` is `unknown` (not a setting), `not_platform` (the customer owns it), or a validation code (`number`, `option`, `prefix`, …). Nothing is applied. |

### `PUT /entitlements`

`{ "token": "<compact JWS>" }`, alg `EdDSA`, verified with `PLATFORM_PUBLIC_KEY`. Payload: architecture §9.

→ `{ applied: true, version }`, or `{ applied: false, version: <stored> }` for a version at or below the
stored one (a retry, not an error).

| Status | `code` | When |
|---|---|---|
| 400 | `bad_signature` | Not signed by the platform's key, or changed after signing. |
| 400 | `wrong_instance` | `instanceId` is not this instance's `INSTANCE_ID`. |
| 400 | `future_issued` | `issuedAt` more than 5 minutes ahead. |
| 400 | `bad_alg`, `malformed` | Not an EdDSA compact JWS with a version and issuedAt. |

The verified document is stored in the global `platform_state` collection (`_id: 'entitlements'`).
At boot and every 6 hours the instance also pulls
`GET {PLATFORM_URL}/api/v1/instances/{INSTANCE_ID}/entitlements` (header `x-platform-key`, answer
`{ token }`) with the same checks. When the platform cannot be reached nothing changes: the stored plan,
or the Starter limits built into the image before the first push, stay in force.

### `GET /usage`

The report in architecture §10, cached 60 seconds. Seats are distinct people with a live seat in any
workspace; the AlianHub Support account never counts. `guests` are people whose every live seat is a
guest's; `pending` are invited addresses that hold no live seat anywhere. Activity comes from
`users.lastSeenAt`, written at most once an hour per person. `mail.sentToday` reads the counter 064 keeps.

### `POST /lifecycle`

```json
{ "state": "read_only", "reason": "payment_failed", "message": "Payment failed: update your card.", "graceUntil": "2026-11-09T00:00:00Z" }
```

`state` is `active`, `past_due`, `read_only` or `suspended` (`cancelled` and `deleted` are not instance
states: the stack is stopped). Stored (`platform_state`, `_id: 'lifecycle'`), kept in memory, and sent to
every open browser as the Socket.io event `INSTANCE_LIFECYCLE_CHANGED`. The public config carries it as
`hosting.lifecycle`. → `{ state, previous }`. Enforcement is task 064.

### `POST /owner/activation-link`

`{ "email"?: "…" }` → `{ userId, activationUrl, activationExpiresAt }`: a 7-day, single-use link to
`${WEBURL}/#/activate?token=…`. A new link revokes the previous one. Only the hash of the token is stored.
400 `not_owner` when `email` is not the instance owner's.

### `POST /owner/login-link`

→ `{ userId, loginUrl, expiresAt, twoFactor }`: a 60-second, single-use link to
`${WEBURL}/#/platform-login?token=…` (the portal's "Open AlianHub"). With two-factor sign-in on, the link
opens the normal login with the owner's address filled in instead.

### `POST /owner/transfer`

`{ "toEmail": "…" }` → `{ userId, previousUserId, changed }`. The target must hold an active seat; the
move is audited in both people's workspaces. 400 `not_member` otherwise.

### `POST /rotate-key`

`{ "newKey": "<at least 32 characters>" }` → `{ rotated: true, expiresAt }`. The new key works beside
`PLATFORM_API_KEY` for 24 hours; render it into `.env` on the next stack update, after which the
extra entry simply expires. Only its sha256 is stored.

### `POST /support-session` and `DELETE /support-session`

`{ "staffEmail": "ravi@alianhub.com", "staffName": "Ravi K.", "expiresAt": "<at most 24 h away>" }`
→ `{ userId, expiresAt, loginUrl, loginExpiresAt }`.

Call it only while the owner's support grant is open (the platform checks the grant). The instance
gives the flagged `support@alianhub.com` account (never the owner, never a customer) an admin seat in
every workspace and a 60-second sign-in link. Every audit row it writes names the staff member
(`AlianHub Support (Ravi K.)`); it holds no seat, is left out of member lists, and is never sent a
password mail. The owner sees "AlianHub Support has access until 14:00" with **End access now**, which
opens the account portal. At `expiresAt`, or on `DELETE /support-session` (the portal revoked the
grant), its seats and sessions are removed. 400 `errors.expiresAt = 'too_far'` beyond 24 hours.

## Public routes the links land on

Hosted only (404 self-hosted); the one-time token is the credential.

| Route | Body | Answer |
|---|---|---|
| `POST /api/v2/auth/activation/verify` | `{ token }` | `{ email, firstName, workspace }`; 400 `key: 'expired'` |
| `POST /api/v2/auth/activate` | `{ token, password }` | Sets the first password, ends activation, signs in: `{ uid }` |
| `POST /api/v2/auth/platform-login` | `{ token }` | Signs the owner (or the support account during its session) in: `{ uid }`; 409 `twoFactorRequired` with `email`; 403 `key: 'ended'` |

## What other tasks read

- `Modules/Platform/entitlements.js`: `DEFAULT_ENTITLEMENTS`, `currentEntitlements()`,
  `storedEntitlements()`, `loadEntitlements()`. After storing a verified document it calls
  `require('Modules/Entitlements').applyEntitlements(payload)` when that module exists (064).
- `Modules/Platform/lifecycle.js`: `lifecycle()`, `lifecycleState()`, `LIFECYCLE_STATES`.
- `Modules/Platform/supportSession.js`: `supportAccess()`, `isSupportSessionLive(userId)`.
- Seats: `company_users.isSupportUser` and `users.isSupportUser` mark what never counts.
- `platform_state` documents: `provision`, `entitlements`, `lifecycle`, `keys`, `support`, and `mail`
  (`{ day, sent }`, written by 064).
