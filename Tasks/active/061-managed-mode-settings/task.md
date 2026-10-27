---
id: 061
title: Managed mode — platform-owned settings and a customer-safe Instance console
status: active
priority: high
depends_on: [060]
created: 2026-10-27
---

# Managed mode — platform-owned settings and a customer-safe Instance console

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one

## Goal

One switch, `HOSTING_MODE=managed`, turns an AlianHub instance into a hosted one: the values we own
(URLs, mail, storage, proxy and security) come from the environment or from the platform and are
locked in the UI; the customer's owner still configures what is theirs (AI keys, sign-in providers,
calling, product name); the setup wizard and the old in-app billing are closed; and the Instance
console no longer offers things a hosted customer must not do (restore a backup over the database,
run migrations, read server logs, upgrade). Without the switch, nothing changes for self-hosted
users.

## Where we start

- `Config/instanceSettings.js` already merges env and saved values: `lockedKeys()` snapshots every
  catalog key set in the environment at boot, `applyInstanceSettings()` skips locked keys, and
  `describe()` tells the page each key's `source` (`env | saved | default | unset`) and `locked`.
- `Modules/Instance/settingsCatalog.js` holds ~60 settings in groups
  `general, mail, storage, ai, auth, calling, security`, with `secret`, `restart`, `readOnly` flags.
- `frontend/src/views/Settings/Instance/InstanceSettings.vue` shows a "Locked" chip and disables the
  input when `row.locked`.
- `Modules/Instance/guard.js` lets in the instance owner (`users.isProductOwner`) or the
  `INSTANCE_ADMIN_KEY` header.
- `Modules/Setup/controller.js` `complete` is unauthenticated until the first user exists.
- `frontend/src/views/Settings/SettingsShell.vue` shows "Billing" when the Chargebee or Paddle
  plugin router has an upgrade tab.
- There is no notion of a hosting mode anywhere.

Gap in today's behaviour that this task also fixes: a `PUT /api/v2/instance/settings` with a locked
key is accepted and silently ignored (`applyInstanceSettings` filters it), so the page reports
success for a value that never applied.

## Scope — the work, task by task

### T1 — The `HOSTING_MODE` switch and boot checks

- New `Config/hostingMode.js`: `mode()` returns `'self'` (default) or `'managed'`, read once at
  boot from `HOSTING_MODE`; `isManaged()`; `platform()` returns
  `{ instanceId, url, publicKey }` from `INSTANCE_ID`, `PLATFORM_URL`, `PLATFORM_PUBLIC_KEY`.
- Boot validation in managed mode, before the HTTP server listens (`server.js`): refuse to start —
  log one `fatal` line naming every problem and exit 1 — when any of these is wrong:
  `INSTANCE_ID` missing or not `^ins_[a-z0-9]{20,32}$`; `PLATFORM_API_KEY` shorter than 32
  characters; `PLATFORM_PUBLIC_KEY` not a valid Ed25519 public key; `PLATFORM_URL` or `WEBURL` not
  `https://`; `JWT_SECRET` shorter than 32 characters.
- `publicConfig()` (Config/instanceSettings.js) gains `hosting: { mode, portalUrl }` so the SPA can
  adapt before login (`portalUrl` comes from entitlements once 064 lands, else `PLATFORM_URL`).
- Add `HOSTING_MODE`, `INSTANCE_ID`, `PLATFORM_URL`, `PLATFORM_PUBLIC_KEY`, `PLATFORM_API_KEY` to
  `scripts/env-doc.meta.json` (group GENERAL/SECURITY, `PLATFORM_API_KEY` marked secret) and
  regenerate `.env.example`.

Done when: a self-hosted boot is byte-for-byte unchanged, and a managed boot with a bad value exits
with a message an operator can act on.

### T2 — A `platform` source for settings

- Store platform values beside the customer's in the same `instance_settings` document:
  `{ _id: 'instance', values: {...}, platformValues: {...}, platformUpdatedAt }`. Secrets in
  `platformValues` use the existing `encrypt()` (AES-256-GCM, key derived from `JWT_SECRET`).
- Precedence everywhere a value is resolved: **env > platform > saved > default**.
- `lockedKeys()` becomes: keys set in env ∪ keys present in `platformValues` ∪ (in managed mode)
  every key of a platform-owned group (T3), even when unset.
- New `savePlatformSettings(values, by)`: validates with `validateSettings`, **replaces** the whole
  `platformValues` (the platform always sends its full set), applies with `override: true`, returns
  `{ applied, restartRequired }`. Called by 062's `PUT /api/v2/platform/config`.
- `loadInstanceSettings()` loads and applies `platformValues` after `values` so platform wins.
- `describeSettings()` returns `source: 'platform'` for those keys and, in managed mode, a new
  `managed: true` flag on every platform-owned row. For managed rows **no value leaves the server,
  secret or not** — `value: null` — so a customer cannot read our SMTP host or bucket name.
- `PUT /api/v2/instance/settings` from the owner now refuses locked keys explicitly:
  `errors[key] = 'managed'` (managed row) or `'locked'` (env row), HTTP 400, nothing saved.

Done when: unit tests cover all four sources in every order, the masked describe output, and the
explicit refusal.

### T3 — Decide who owns every setting (catalog + env matrix)

- Catalog: add `owner: 'platform' | 'customer'` to each group in `settingsCatalog.js`
  (`GROUP_OWNER` map) with field-level override:

  | Group / key | Managed owner | Why |
  |---|---|---|
  | `general.WEBURL`, `general.APIURL` | platform | Tied to the subdomain and TLS |
  | `general.APP_NAME` | customer | Branding is theirs (Q16) |
  | `general.CRON_TZ` | customer | Their reminders and reports run in their zone |
  | `mail.*` | platform | Our relay, our sending domain (Q21: Business may get `ownSmtp`) |
  | `storage.*` | platform | Our bucket and keys (063) |
  | `ai.*` | customer | Bring-your-own-key (Q14) |
  | `auth.*` | customer | Their Google/GitHub/GitLab apps |
  | `calling.*` | platform for `TURN_*`, customer for `STUN_URLS` | We run the TURN relay |
  | `security.TRUST_PROXY`, `GLOBAL_RATE_LIMIT_PER_MIN`, `HELMET_ENABLED` | platform | Our edge |
  | `security.WEBHOOK_ALLOWED_PRIVATE_HOSTS` | platform, forced empty | Private hosts are our network |
  | `security.PERMISSION_ENFORCEMENT_MODE` | customer | Their policy |

- When an entitlement grants `features.ownSmtp` (Business), the `mail` group flips to customer
  ownership — 064 calls `setOwnershipOverrides({ mail: 'customer' })`.
- Hosted instances run on DigitalOcean, which blocks SMTP ports 25, 465 and 587 on every Droplet.
  Platform mail is pushed as `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (HTTPS), never `NODEMAILER_*`.
  In managed mode the mail **Test** button, when an SMTP connection to 25/465/587 times out, says
  "Our hosting provider blocks this port. Use an API key (Resend) or your provider's alternate port,
  such as 2525." instead of a generic timeout.
- Env matrix: extend `scripts/env-doc.meta.json` with `managed:` per variable —
  `bootstrap` (we write it in `.env`), `platform` (pushed by 062), `customer` (a console setting),
  `fixed` (tuning knob, default is right for hosting), `dev` (local/test only). `scripts/env-doc.js`
  renders a new section in `docs/hosting/env-matrix.md` and fails (`--check`) when a variable the
  backend reads has no `managed` value. The audit covers every variable the generator already lists.
- Customer-relevant variables found by the audit that are env-only today are added to the catalog
  in the `customer` column. Expected (confirm during the audit): `MAGIC_LINK_ENABLED`,
  `TWO_FACTOR_ISSUER`, `AUDIT_RETENTION_DAYS`, `AI_FIELD_DAILY_LIMIT`, `AI_REPLAY`.

Done when: the matrix exists, `env-doc --check` runs in CI, and every `customer` variable is
editable in the console.

### T4 — Customer-safe Instance console

Server (`Modules/Instance/routes.js`): a `managedDeny` middleware refuses, with 403 and
`statusText: 'AlianHub Cloud manages this for you.'`, these routes when the caller is the owner
(`req.instanceAdmin === 'owner'`) in managed mode — the platform key still passes:

| Route | Why closed |
|---|---|
| `POST /maintenance` | We drive maintenance |
| `GET /upgrade`, `POST /migrations/run` | We roll upgrades (071) |
| `GET /logs`, `/logs/files`, `/logs/download` | Server logs name our infrastructure |
| `GET/POST /backups`, `…/manifest`, `…/download`, `…/restore`, `DELETE /backups/:name` | Backups are ours (071); download is in the portal |
| `GET /orphan-databases`, `POST …/drop` | Dropping databases is ours |
| `GET /stats` → trimmed | Keep counts, drop host/disk details |

SPA (`InstanceShell.vue` tab list): in managed mode hide Backups, Upgrade and Logs tabs and show two
read-only cards on Health instead (see "How it looks"). Health keeps app/database/mail/storage
status as green/red only, no host names.

### T5 — Owner-triggered restart for restart-only settings

A hosted owner cannot run `docker restart`. When a save returns `restartRequired` (e.g. `CRON_TZ`),
managed mode shows **Restart now** to the owner. `POST /api/v2/instance/restart` (owner or platform)
writes an audit row, answers 202, then exits the process gracefully after in-flight requests finish
(≤ 10 s). Docker's `restart: unless-stopped` brings it back; the page polls `/health` and reloads.
Rate-limited to 3 per hour. Not offered in self-hosted mode (operators restart their own way).

### T6 — Close the setup wizard in managed mode

- `POST /api/v2/setup/complete` → 403 `'This workspace is created by AlianHub Cloud.'` in managed
  mode. Headless provisioning goes through 062.
- `GET /api/v2/setup/status` adds `managed: true`.
- The SPA's setup route, when `managed && !installed`, shows "Your workspace is being prepared"
  instead of the wizard (and polls status every 5 s, then sends the visitor to the login page).

### T7 — Hide the old in-app billing

- `SettingsShell.vue`: `hasBilling` is false in managed mode; the `chargebee` and `paddle` plugin
  routers are not registered (`frontend/src/main.js`).
- Backend Chargebee/Paddle routes (`Config/setMiddleware.js` list, `frontend/src/config/env.js`
  endpoints) answer 404 in managed mode.
- Every "Upgrade" call-to-action in the app points to 064's Plan & usage page instead.

### T8 — "Source code" link (AGPL §13)

Hosting a modified AGPL program for users over a network obliges us to offer them its source.
The login page footer and the user menu's About entry show **Source code** linking to the exact
release tag of the running version
(`https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/tree/v<version>`), in both
modes. `docs/hosting/` notes that hosted-only changes ship in the public repo like everything else.

### T9 — Tests and conventions

- Jest: `tests/hosting/hostingMode.test.js` (boot validation), `instanceSettings.precedence.test.js`,
  `settingsCatalog.ownership.test.js`, `instanceRoutes.managedDeny.test.js`,
  `setup.managed.test.js`.
- Frontend unit: Instance shell tabs per mode; settings row rendering for `managed` rows.
- Every new string goes through `en.js` (`Instance.managed_*`, `Setup.preparing_*`), then
  `npm run i18n:backfill`; every colour from tokens (`npm run style:check`).

## How it looks

Settings → Instance → Settings, managed mode, owner signed in:

```
Instance settings
─────────────────────────────────────────
General
  Product name      [ Acme Projects     ]
  Scheduler zone    [ Asia/Kolkata  ▾   ]
                    Applies after restart
  Public web URL    https://acme.alianhub.com
                    🔒 Managed by AlianHub Cloud

┌───────────────────────────────────────┐
│ 🔒 Mail · Storage · Security          │
│ AlianHub Cloud runs these for you:    │
│ email delivery, file storage, TLS,    │
│ proxy and rate limits.                │
│ Need your own SMTP? Business plan →   │
└───────────────────────────────────────┘

AI
  Provider          [ Anthropic ▾ ]
  Anthropic key     [ •••••••• set ]
…
               [ Test ]  [ Save ]

  ⓘ Saved. 1 change applies after a
    restart.        [ Restart now ]
```

Health tab, managed mode (replaces the hidden tabs):

```
┌ Version ──────────────────────────────┐
│ AlianHub 14.40.0                       │
│ Updates are rolled out by AlianHub     │
│ Cloud in your weekly window.           │
│ What's new →                           │
└────────────────────────────────────────┘
┌ Backups ──────────────────────────────┐
│ Nightly, kept 14 days.                 │
│ Last: today 02:10 UTC  ✓               │
│ Download in your AlianHub account →    │
└────────────────────────────────────────┘
```

Fresh instance before provisioning finishes (any visitor):

```
      Your workspace is being prepared
  We'll email the owner as soon as it's
  ready. This usually takes a minute.
              ◌ checking…
```

Owner `PUT` of a managed key:

```json
{ "status": false, "statusText": "Some settings are managed by AlianHub Cloud.",
  "data": { "errors": { "NODEMAILER_HOST": "managed" } } }
```

## Platform view

- **Security.** Managed values never leave the server (not even non-secret ones), so a customer
  cannot learn our relay, bucket, or proxy topology. Platform values are encrypted at rest with the
  instance's `JWT_SECRET`-derived key; that secret lives only in the stack's `.env` and the control
  plane's encrypted store.
- **Failure modes.** A platform config push that fails validation is refused whole and the instance
  keeps its last good values; the orchestrator surfaces the error (069). A restart that does not
  come back healthy within 2 minutes is caught by the fleet health check (071).
- **Self-hosted safety.** Every branch is `isManaged()`-gated; CI runs the instance test suite in
  both modes.
- **Support.** Customers can no longer break mail or storage, which removes the most common class of
  self-hosting support tickets from the hosted product.

## Management view

- **Why it matters.** Without this, a hosted customer could point mail at their own server, restore
  an old backup over live data, or read our server logs — all support and security liabilities.
- **Cost.** About 5–7 developer days; no running cost.
- **Upsell hook.** "Need your own SMTP? Business plan" is the first in-product upgrade prompt.
- **Risk:** customers expecting full self-hosted control. Mitigation: the docs page "Hosted vs
  self-hosted" (073) lists exactly what we manage; the open-source path stays available.

## Out of scope

- The platform API itself (062) and entitlements (064) — this task only provides the hooks they call.
- Custom-domain URL changes (Q10).
- Translating the English catalog labels server-side (the page already translates group and field
  names through `InstanceV2.*`).

## Acceptance criteria

- [ ] With `HOSTING_MODE` unset, all existing instance tests pass unchanged and the console looks
      exactly as before.
- [ ] With `HOSTING_MODE=managed` and a missing or malformed `INSTANCE_ID`, `PLATFORM_API_KEY`,
      `PLATFORM_PUBLIC_KEY`, `PLATFORM_URL`, `WEBURL` or short `JWT_SECRET`, the server refuses to
      start and logs every problem in one line.
- [ ] Settings resolve env > platform > saved > default; the console shows "Managed by AlianHub
      Cloud" for env and platform rows and for every platform-owned row even when unset.
- [ ] `GET /api/v2/instance/settings` as the owner returns `value: null` for every managed row.
- [ ] `PUT /api/v2/instance/settings` with a managed or env-locked key returns 400 naming the key and
      saves nothing.
- [ ] As the owner in managed mode, maintenance, upgrade, migrations, logs, backups and
      orphan-database routes return 403; with the platform key they work.
- [ ] Backups, Upgrade and Logs tabs are hidden in managed mode; Health shows the Version and Backups
      cards.
- [ ] A restart-only change shows **Restart now**; the instance restarts and the page reloads
      healthy within 60 s.
- [ ] `POST /api/v2/setup/complete` returns 403 in managed mode; the setup page shows "being prepared".
- [ ] No Billing entry, Chargebee or Paddle screen or route is reachable in managed mode.
- [ ] The login footer and About menu link to the source of the exact running version.
- [ ] `docs/hosting/env-matrix.md` classifies every variable the backend reads; `env-doc --check`
      fails CI on an unclassified one.
- [ ] `npm run i18n:check` and `npm run style:check` pass.

## Dependencies

- None inside the programme; 062, 063 and 064 build on T1–T3.

## Open questions

- Q16 — what the owner may change (default in the T3 table).
- Q21 — own SMTP for Business (default: allowed through `features.ownSmtp`).

## Estimate

5–7 developer days (T3's env audit is the largest single piece, about 2 days).
