# Progress: Connectors — remove the old Google Calendar and CloudStorage paths; Google and Dropbox setup pages

## Checklist
- [x] Remove code + flags
- [x] Setup pages
- [x] Checks

## Last step
Done on branch `refactor/connectors-remove-old-paths` (from `6d4e2eace`), not pushed. Every removal below was checked for callers first; the connector, migration, picker, agent, MCP and convention suites pass apart from failures that are also on the base commit.

## Blockers
None.

## What was removed
- **Google Calendar connector**: `Modules/Agents/connectors/googleConnection.js`, `googleApi.js`, `Modules/Connectors/googleController.js`; the seven `/api/v2/connectors/google/*` and `/api/v1/connector-oauth/google/callback` legacy routes; the coexistence branch in `connectorsController.callback` and `connection.ownsState`, which only it used; `google_calendar`, `GOOGLE`, `requestedGoogle`, `googleClient` and the `google_client_missing` problem in `flag.js`; the legacy branch in `memberDeparted.js`.
- **Screens and strings**: `frontend/src/views/Integrations/GoogleConnection.vue` (it had no route of its own; its entry, import and `hasGoogle` left `ConnectionsPage.vue`, nothing else there changed), the `GoogleConnection.*` namespace and the orphaned `Integrations.cloud_*` strings, and the backfill dropped all 57 keys from every locale and pending file.
- **CloudStorage per-person picker**: all of `Modules/CloudStorage` (routes, controller, per-person app settings, `cloudProviders`, `cloudStorageRules`), its mount in `index.js`, the `/api/v1/cloud-storage` prefix in `setMiddleware.js` and `CLOUD_STORAGE` in `frontend/src/config/env.js`.
- **Tests that only tested deleted code**: `tests/connector-google-connection.test.js`, `tests/cloud-providers-metadata.test.js`, `tests/cloud-storage-rules-safety.test.js`, `frontend/tests/unit/googleConnection.spec.js`; the coexistence `describe` in `connector-lifecycle.test.js` and the cloud block in `connector-settings-session-tenant.test.js`.

## What was kept or moved, and why
- `accountOf` moved from `googleApi.js` into `Modules/Connectors/providers/google/index.js`, its only remaining caller.
- `cloudCrypto.js` still encrypts integration secrets through `utils/secretField.js` (GitHub sign-in state, integration configs while the secrets store is off), so its cipher moved into `secretField.js` byte for byte, with the `CLOUD_STORAGE_ENC_KEY` name and salt unchanged. Checked: a value written by the old helper decrypts with the new one, and the reverse.
- The `cloudStorageConnections` schema and the `CLOUD_STORAGE_CONNECTIONS` collection stay, so migrations 082 and 083 can clear the old rows; the collection stays on the gateway's credential list.
- `CLOUD_STORAGE_MAX_IMPORT_BYTES` stays: the module picker's import reads it.
- The `google_calendar` entry of the `integration_connections` catalogue and its strings are FR-38, not this connector, and stay.
- Migration 080 no longer calls `requestedGoogle`; it reads the legacy name from `CONNECTORS` itself, so it behaves as before and its tests pass unchanged. 080 exports its reshape and 082 its clear, for 083.

## Behaviour changed on purpose
- **Company OAuth app routes** (`/api/v2/connectors/apps`) were mounted only while `CONNECTORS` named `slack` or `google_calendar`. With `google_calendar` gone, a `CONNECTORS=google,dropbox` install would have had no way to set a company app, so they now mount with the other connector routes whenever a registry provider is named. The catalogue's `connectors` list is now the named registry providers for the same reason, which is what shows the Company OAuth apps card.
- **Boot log**: the unknown-name error now lists every known provider, and the server says once at startup when `google` is named with no instance app, as the old `google_client_missing` problem did. Reading the two Google variables by name there also keeps them in `.env.example` and `docs/ENV.md`.

## Migration 083
`migrations/083-connectors-finish-legacy-cutover.js`, numbered after 082, the highest on this branch. 080 and 082 hold while `CONNECTORS` still serves the old paths and record themselves applied, so they can leave rows behind; with the old code gone nothing would ever read those rows again. 083 runs with no gate:
- every remaining `connector: 'google_calendar'` row is reshaped as 080 does, so its grant works once `google` is named and nobody reconnects (FR-35);
- a row whose account the person already holds on the module trips the unique index: its tokens are retired in the secrets store (never revoked at Google, which would end the live grant too) and it is reshaped closed; any other write error fails the company and retires nothing;
- every `cloud_storage_connections` row 082 did not clear loses its stored client secret and tokens and is closed (FR-39).
Both halves select only what they have not handled, so a second run changes nothing. No `down`: retired tokens and deleted secrets cannot come back.

## Setup pages
`docs/connectors/google.md` (Cloud project, APIs, consent screen, OAuth client, `CONNECTOR_GOOGLE_PICKER_API_KEY`, `CONNECTOR_GOOGLE_APP_ID`, `.env`, company app with `extra.pickerApiKey`/`extra.appId`, moving from the old paths) and `docs/connectors/dropbox.md` (Scoped app, permissions, redirect URI, Chooser domains, `.env`, company app, one connection backing the picker and the `mcp.dropbox.com` tools). `mcp-apps.md` links both; `.claude/CLOUD-ATTACHMENTS-FLOW.md` is marked superseded.

## Tests
- New: `tests/migration-finish-legacy-cutover.test.js` (7: order, reshape of a held row, no gate, duplicate closed with tokens retired and Google not called, other errors retire nothing, cloud rows cleared, twice-safe).
- Adapted: `connector-google-member-leaves.test.js` now connects through the module's Google provider and proves the members screen, a cancelled seat, SCIM deactivation and provisioning, a guest demotion and an unreachable Google all end or freeze the connection as before; `storage-change-scope.test.js` imports through `pickerController` (the change-scope guard still refuses before downloading); `connector-picker.test.js` took the SSRF, encoding, thumbnail and clip cases the deleted cloud tests held; `connector-lifecycle.test.js` checks the company app routes and that no legacy Google route is served; `connector-catalogue-flags.test.js` checks the `connectors` list; `connector-registry.test.js` covers `accountOf`; the route-guard list, the egress-callers list, the agent-routes fixture and the session-tenant integration test lost the deleted routes.
- Runs, on this commit, with the scratch jest config outside the repo:
  - connector, Slack, Google, cloud, picker, agent, MCP, migration, storage, integration, secret, member, SCIM, inbox and approval unit files (360 files, 4 shards): 10,669 of 10,670 pass. The one failure, `agent-rest-route-actions` (`github.issue.comment` and `notion.page.create` have no web route), fails the same way on `6d4e2eace`.
  - the other 840 unit files (5 shards): 21,189 of 21,210 pass. Of the 12 files that failed, 3 pass alone (`auth-two-factor-controller`, `automation-subtasks-trigger`, `knowledge-task-changes`: timeouts under load). `visual-core` expects `/` in a path and gets this machine's `\`. The other 8 fail the same way on `6d4e2eace`: `api-doc` (the same path separator), `build-info` (`git init` on this machine), `ai-connection`, `demo-team-seed`, `knowledge-file-ingest`, `process-guards`, `role-prompts` and `upload-routes-order`.
  - conventions: 26 of 30 files pass. `plain-words` is the known CRLF baseline failure; `mcp-tool-scopes`, `agent-action-labels` and `audit-event-labels` fail the same way on `6d4e2eace` (the MCP-app tools it added have no scope or label yet).
  - frontend: 25 vitest specs on the Connections, Integrations, picker and Inbox views, 394 tests pass.
  - `npm run i18n:check` and `npm run style:check` pass; no style baseline changed (the deleted view had none). `node scripts/env-doc.js --check --strict` now reports only the two Dropbox entries it reported before (and `frontend/.env.example`, line endings only). `npm run api:doc:check` reports the stale `docs/API.md` and `openapi.json`, regenerated in the docs PR (Rule 4), and the five Slack bot route descriptions 074 left, which 079 removes.
- Env doc: `CONNECTORS`, `CONNECTOR_GOOGLE_CLIENT_ID/SECRET`, `CLOUD_STORAGE_ENC_KEY` and `CLOUD_STORAGE_MAX_IMPORT_BYTES` describe what they do now; `.env.example` and `docs/ENV.md` regenerated.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-12
- Removed the old Google Calendar and CloudStorage paths, added migration 083 and the Google and Dropbox setup pages (details above).
