# Progress: Managed mode — platform-owned settings and a customer-safe Instance console

## Checklist

- [x] T1 — `HOSTING_MODE` switch and boot checks
- [x] T2 — `platform` settings source and explicit refusal of locked keys
- [x] T3 — Ownership per setting; env matrix and `env-doc --check`
- [x] T4 — Customer-safe Instance console (routes + tabs). The Backups card has no "Last:" line yet: the time of the last nightly backup comes from 071.
- [x] T5 — Owner-triggered restart. Built and unit-tested; not yet watched coming back on a real Docker stack (needs 065).
- [x] T6 — Close the setup wizard in managed mode
- [x] T7 — Hide the old in-app billing
- [x] T8 — "Source code" link to the running version (AGPL §13)
- [x] T9 — Tests, i18n, style checks

## Last step

T1–T9 built on `feat/managed-mode-settings` (not pushed). Next: 062 builds the platform API on this
branch (`savePlatformSettings`, `requireInstanceAdmin` → `req.instanceAdmin = 'platform'`).

## Blockers

None. Q16 and Q21 have workable defaults.

## Contracts other tasks use

- `Config/hostingMode.js`: `mode()`, `isManaged()`, `platform()` → `{ instanceId, url, publicKey }`,
  `ed25519PublicKey(text)` (KeyObject or null), `bootProblems(env)`, `refuseBadBoot()`,
  `setPortalUrl(url)` / `portalUrl()` (064 sets the portal from entitlements).
- `Config/instanceSettings.js`: `savePlatformSettings(values, by)` → `{ applied, restartRequired }`,
  throws `{ code: 'invalid_settings', statusCode: 400, errors }` and keeps the last good set;
  `setOwnershipOverrides(map)` (replaces, in memory); `lockedKeys()`; `envKeys()`; `refusedKeys(body)`;
  `platformKeys()`. `applied` names only keys whose live value changed.
- `Modules/Instance/settingsCatalog.js`: `GROUP_OWNER`, `ownerOf(key, overrides)`,
  `platformOwnedKeys(overrides)` (062 uses it for `errors[key] = 'not_platform'`).
- `Modules/Instance/guard.js`: `managedDeny`, `ownerOnHostedInstance(req)`; 062 sets
  `req.instanceAdmin = 'platform'`, which every closed route lets through.
- `instance_settings` document gains `platformValues`, `platformUpdatedAt`, `platformUpdatedBy`,
  `restartsAt` (schema updated: it is strict).
- Frontend: `publicConfig.hosting = { mode, portalUrl }`, `isManagedHosting()`;
  `@/composable/upgradeLink` sends Upgrade to route `PlanUsage` (064) or the portal.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- Built T1–T9 autonomously (owner away). Decisions:
  - Boot check runs in `index.js` right after `.env` is read (`server.js` only requires `index.js`),
    so nothing listens or touches the database first. A `HOSTING_MODE` other than `self`/`managed`
    also refuses to start: a typo must not open a hosted instance as self-hosted with the wizard open.
  - Platform values load only in managed mode, so a hosted database restored self-hosted brings none
    of ours. In managed mode an owner value saved for a platform-owned key is not applied.
  - In managed mode env rows are managed too (architecture §7): `value: null`, `default: null`. The
    WEBURL row shows the public web URL the SPA already has.
  - Ownership: `AGENT_TAINT_ROUTING` is customer-owned (still read-only) so its state stays visible;
    the audit added `GITLAB_BASE_API_URL` to the five expected customer keys. Google as an LLM
    provider is not in the catalog, so `GOOGLE_*` model variables are `fixed` for now.
  - Env matrix: every variable the generator lists has `managed`; frontend `VUE_APP_*` are `fixed`
    (baked into the image); demo, atlas and translation keys are `dev`. `--check` fails (strict or
    not) on a read variable without one; the conventions test runs it in CI. 063 adds its own
    values for the `S3_*` variables at merge.
  - Restart: 404 self-hosted, 429 after 3 in an hour (kept in `instance_settings.restartsAt`, since
    the restart clears memory), audited into the workspace the SPA names plus a server log line,
    exits 0 after the server drains or 10 s. The page waits for `/health` from a process younger
    than the click (90 s cap), then reloads.
  - Health for a hosted owner: green/red per part, cron jobs without error text, no host, path,
    bucket or Node details; stats drop Node version and uptime. The platform key sees everything.
  - Billing: the API paths (Chargebee, Paddle and the subscription endpoints in
    `frontend/src/config/env.js`) answer 404 hosted (`Config/billingRoutes.js`); the SPA installs the
    two billing plugins only after the public config says self-hosted.
  - Source code links the release tag for a release build and the commit for a build between
    releases (no tag exists for a beta build).
  - Test files are flat (`tests/hosting-mode.test.js`, `instance-settings-precedence`,
    `settings-catalog-ownership`, `instance-routes-managed-deny`, `setup-managed`,
    `instance-restart`, `billing-routes-hosted`): jest's unit project only matches `tests/*.test.js`.
