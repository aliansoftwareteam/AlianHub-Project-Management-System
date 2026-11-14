# Progress: Connectors — Supabase, Upwork, Wispr Flow, Dropbox, HubSpot and Canva through their MCP servers

## Checklist
- [x] Supabase (registers itself, as a confidential client; read access only)
- [x] Upwork (registers itself)
- [x] Wispr Flow (registers itself; OpenID account)
- [x] Dropbox (the picker's provider now also reaches `mcp.dropbox.com`, one connection for both)
- [x] HubSpot ("MCP auth app" registered once)
- [x] Canva (registers itself; a developer-portal app wins if set)
- [x] Setup page `docs/connectors/mcp-apps.md`, with how to pin shapes
- [ ] Pin each app's shapes with `scripts/connector-tool-shapes.js` and a test account; correct the placeholder tool names for Upwork, Wispr Flow, Dropbox and Canva
- [ ] One manual run per app

## Last step
All six definitions are in and validate; their tools stay off until their shapes are pinned with real accounts.

## Blockers
Test accounts at each app, to pin shapes and confirm the tool names.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decisions 18, 19). Track B.
- Read each server's published sign-in metadata (2026-11-12) and built the definitions from it:
  - **Supabase:** `mcp.supabase.com` → `api.supabase.com` `/v1/oauth/authorize`, `/v1/oauth/token`, registration at `/platform/oauth/apps/register`. The token endpoint takes only `client_secret_basic`/`client_secret_post`, so the definition sets `auth.registrationAuth: 'client_secret_post'` (new, optional) and keeps the secret the sign-up returns. Scopes: `organizations:read`, `projects:read`, `database:read`; no SQL writes.
  - **Upwork:** `mcp.upwork.com`, with sign-in on `www.upwork.com` (`/ab/account-security/oauth2/authorize`, `/api/v3/oauth2/token`, `/register`); `none` accepted.
  - **Wispr Flow:** `api.wisprflow.ai/connect/mcp` → `mcp-auth.wisprflow.com` `/oauth2/authorize`, `/oauth2/token`, `/oauth2/register`; OpenID, so `openid email offline_access` and the account from the id token's `sub`.
  - **Dropbox:** `mcp.dropbox.com` → `www.dropbox.com`, the same OAuth as the picker. The existing Dropbox provider becomes `transport: 'mcp'` with `mcp.dropbox.com` among its hosts; the picker is unchanged and its tests pass.
  - **HubSpot:** `mcp.hubspot.com` with `/oauth/authorize/user` and `/oauth/v3/token`, no registration endpoint and `client_secret_post` only, so it needs an MCP auth app (`CONNECTOR_HUBSPOT_CLIENT_*`, a company app, or the shared service).
  - **Canva:** `mcp.canva.com` `/authorize`, `/token`, `/register`; the 2026-11-12 research says Canva may admit only approved clients, in which case a developer-portal app is set and wins.
- New shared pieces:
  - `Modules/Connectors/tokenAccount.js`: the account from an app's known token fields, then an id token's subject, then one stable id per person.
  - `providerApi.consentUrl` leaves out an empty scope.
  - `auth.registrationAuth` in `validate.js` and `providerApi.register`.
  - `flag.js` stops logging registry providers as unknown at boot.
- Tools, all `shape: null`, mostly reads:
  - Supabase: projects list and read, tables list.
  - Upwork: contracts, job search.
  - Wispr Flow: meeting search and read.
  - Dropbox: search, read a file.
  - HubSpot: CRM search and read.
  - Canva: design search and read.
  - The tool names for Upwork, Wispr Flow, Dropbox and Canva are placeholders; the shapes script shows the real ones.
- Tests: `tests/connector-mcp-apps.test.js`, 11 tests. They cover: every app validates and is reached at a host it names; every tool has an on-screen label and is off until pinned; only two writes exist (GitHub comment, Notion page); self-registering apps are offered with nothing set; HubSpot is not offered until an app is set; Supabase asks for a confidential client; empty scope left out; account fallback. All 31 connector suites (1,132 tests) pass.
