# Progress: Connectors — Drive/Dropbox attachment picker on the module

## Checklist
- [x] Dropbox provider definition (OAuth) on the module
- [x] Picker token endpoint — owner session only, Drive `drive.file`
- [x] Thumbnail + import endpoints — owner session only, no other person's id
- [x] Frontend picker repointed to the module (`/api/v2/connectors`)
- [x] Remove per-person app settings UI
- [x] Migration: clear stored client secrets, ask reconnect, twice-safe
- [x] i18n + style + tests green (api:doc deferred to the docs PR, Rule 4)

## Last step
Backend, migration, frontend and tests written. New/changed:
- `providers/dropbox/index.js`, `pickerProviders.js`, `pickerController.js`, three owner-only routes.
- `providerApi.revoke` + `connection.revokeAtProvider` gained a `revokeAuth: 'bearer'` branch (Dropbox revokes
  with the token in the Authorization header; Google's form path is unchanged).
- `migrations/081-cloud-storage-to-connectors.js` — per-provider cutover gate, clears secrets, closes rows, twice-safe.
- `cloudPicker.js` repointed to `/api/v2/connectors/picker/...`; connect now routes to My connections; per-person
  settings dropped. `Integrations.vue` cloud-storage settings section removed.
- `.env.example`: `CONNECTOR_GOOGLE_PICKER_API_KEY`, `CONNECTOR_GOOGLE_APP_ID`, `CONNECTOR_DROPBOX_CLIENT_ID/SECRET`.
Tests: `connector-picker.test.js` (provider, pure metadata, bearer-vs-form revoke, owner-only controller),
`migration-cloud-storage-to-connectors.test.js` (gate, twice-safe, secrets cleared), and the route-list
assertion in `connector-lifecycle.test.js` updated. `style:check` / `i18n:check` pass; `eslint` clean on the two
changed frontend files; `api:doc:check` is red on purpose (regenerated in the follow-up docs PR, Rule 4).

## Design (decided 2026-11-03)
Owner answered: Dropbox = **hybrid** (keep the Dropbox Chooser as the pick UI, app key from
the instance/company module app; a per-person OAuth connection backs import, disconnect-revoke
and future AI). 076/077 boundary = **076 adds + migrates; 077 removes the old CloudStorage
controller/routes and adds the instance-admin setup pages.**

- **Drive**: the Google provider already carries a `drive: ['drive.file']` product (071). The
  picker uses a new owner-only endpoint that hands the owner their own fresh access token (the
  single FR-15 exception) plus the browser-safe Picker config (`api_key`, `app_id`). That config
  is not OAuth — it lives in the company app's `extra` map (apps.js already supports it) or, for
  the instance default, in `CONNECTOR_GOOGLE_PICKER_API_KEY` / `CONNECTOR_GOOGLE_APP_ID`.
- **Dropbox**: new OAuth provider `dropbox` (app key = the OAuth clientId, so it is browser-safe
  for the Chooser). The Chooser opens with the resolved app key; import/thumbnail use the owner's
  own connection token; disconnect revokes at Dropbox.
- **Owner-only, no cross-person id**: every picker route derives the person from the session
  (`req.uid`), never the body; API tokens and guests are refused (reuses `personOrRefuse`). The
  token and import are only ever for the caller's own connection — no route takes another id.
- **Migration**: the old `cloud_storage_connections` grants were minted by each person's *own*
  OAuth app, so they cannot be carried onto the instance/company app. Migration clears the
  unsealed client secrets from each row's `config`, closes the row, and the person reconnects once
  on My connections (072). Idempotent via `deletedStatusKey`.

## Files
- `Modules/Connectors/providers/dropbox/index.js` — provider definition
- `Modules/Connectors/pickerProviders.js` — pure per-provider download/thumbnail/config builders
- `Modules/Connectors/pickerController.js` — picker-token, thumbnail, import (owner session)
- `Modules/Connectors/routes.js` — three new owner-only routes
- `migrations/081-cloud-storage-to-connectors.js` — clear secrets, close rows
- `frontend/src/composable/cloudPicker.js` — repoint to the module, keep Chooser
- `frontend/src/views/Settings/Integrations/Integrations.vue` — drop per-person app settings
- i18n keys under `Connectors.picker.*`; docs via `npm run api:doc`

## Blockers
None — 066 (lifecycle) and 072 (screens) are present in the branch base; the Google `drive`
product (071) is live.

## Log

### 2026-11-03 (security review — 056 §10)
- `/security-review` run on the 076 changes (fresh-eyes sub-agent): **no high-confidence, newly
  introduced vulnerabilities** (confidence 8/10). Verified: owner-only (person always from the
  session, never the body; API tokens and guests refused), SSRF guard on the Dropbox direct link
  (`isDropboxContentUrl` + per-hop `beforeRedirect`), the Google/Dropbox hosts fixed and the
  `fileId` encoded/header-escaped, path traversal blocked before use plus `changeVerdict`, no
  secret/refresh token to the browser or logs, and the migration clears secrets without leaking them.
- Caught and fixed a test break: `cloudPickerDrivePopup.spec.js` still mocked the old
  `/api/v1/cloud-storage/...` token URL; repointed it to `/api/v2/connectors/picker/...` (60/60 green).

### 2026-11-03
- Moved 076 backlog → active; branched `feat/task-076-connectors-attachment-picker` off the
  current tip (which carries 066 + 072, the deps, not yet on `feat/per-user-connectors`).
- Studied both sides: the mature connectors module (provider defs, `connection.js` lifecycle,
  `apps.js` with its `extra` map, `toolRunner` request path) and the legacy `Modules/CloudStorage`
  picker (per-person apps, in-row unsealed secrets, Chooser, import/thumbnail).
- Confirmed with the owner: hybrid Dropbox, and the 076/077 split. Wrote the design above.
