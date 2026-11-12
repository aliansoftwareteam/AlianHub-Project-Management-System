# Progress: Connectors — sign-in for MCP apps: discovery, self-registration once per workspace, personal tokens

## Checklist
- [x] Discovery of the server's sign-in metadata (`mcpAuth.discover`, for 096)
- [x] Self-registration once per workspace (`connector_registrations`, `registrations.js`)
- [x] Personal tokens (`POST /api/v2/connectors/:provider/token`)
- [x] `isOffered` for apps with no registered app (`registry.signIns`)
- [x] Account reading with one call (`account { url, read }`)
- [x] Fake server tests; Google and Slack unchanged
- [ ] The token field on the screen (comes with 101)

## Last step
Built and tested on `feat/connectors-mcp-transport`. A member can connect an app that registers itself with nothing in `.env`, or paste a token of their own; the Connections page does not yet show the token field (101).

## Blockers
None.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decisions 21, 22): the v2 sign-in work on top of the built 066. Track A.
- Built:
  - `validate.js`: `auth.registration: 'dynamic'` with an https `registrationUrl` among the hosts and PKCE required; `auth.personalToken: true`; `account { url, read }`, which makes `readAccount` optional and is required for pasted tokens.
  - `registry.js`: `signIns(id, { companyApps })` → `oauth` and/or `token`; `isOffered` needs one of them, so an app that registers itself or takes tokens is offered with nothing in `.env`.
  - New collections `connector_registrations` and `connector_tools` (the latter for 092's review records), declared in all six schema files with unique indexes.
  - `registrations.js`: register once per workspace through the new `providerApi.register` (public client, `token_endpoint_auth_method: none`), store the client (and a secret in the secrets store if the server sends one), reuse it for every member and session, register again when `APIURL` changed, `forget` it on `invalid_client`.
  - `apps.resolveApp`: company app → instance app → registered client; `providerApi` leaves an empty client secret out of the token calls.
  - `callbacks.js`: the callback address in one place, shared by `connection.js` and `apps.js` (093 extends it for hosted instances).
  - `connection.js`: `accountFrom` reads the account from the token answer or with one `account.url` call; `complete` drops a forgotten registration and records `signIn` and `kind`; `saveToken` checks a pasted token with one read, ends any earlier connection, and keeps the token by handle with `signIn: personal_token`; `accessTokenFor` uses it as it is; `revokeAtProvider` skips it; `list` names each provider's sign-ins; `start` answers `token_only` for an app that takes only tokens.
  - Route `POST /api/v2/connectors/:provider/token` (`agentsRefused`, rate-limited, the app-connector AI right).
  - `mcpAuth.js`: `discover()` reads RFC 9728 and RFC 8414 / OpenID metadata over https and names every host it found.
- Contract section 10 records the additions.
- Tests:
  - `tests/connector-mcp-sign-in.test.js`: 15 tests, against fixture providers `selfreg` and `pat`, all passing. They cover validation, sign-ins, registering once across members and sessions, a forgotten registration redone once, a changed `APIURL`, each member's own token, a pasted token refused or kept and never shown or logged, replacing and ending it, the listing, and discovery.
  - `tests/connector-lifecycle.test.js`: two exact-match assertions updated, for the new `signIn` list and the token route; 31 pass.
  - All 93 connector, MCP and migration suites: 3,433 tests pass.
