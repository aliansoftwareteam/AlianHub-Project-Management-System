# MCP authorization security checklist

Each rule from the MCP 2025-11-25 [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and its [security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices), with where AlianHub enforces it and the test that proves it. The rules apply with `MCP_OAUTH=both` or `only`. With `MCP_OAUTH` off, `/mcp` accepts personal access tokens only, as before.

Test files:

- **Scripted client**: `tests/integration/mcp-authorization.int.test.js`. It runs end to end against a real server and database, using the official SDK client (`@modelcontextprotocol/sdk`).
- **Official suite**: `tests/conformance/mcpServerConformance.js`, run by the `mcp-conformance` CI job. Its expected failures are listed in `tests/conformance/mcp-server-expected-failures.yml`.

The "Rule removed" column marks the rules that were each removed from the code in turn while the scripted client ran. The client failed every time and passed again once the rule was back.

## Token handling

| Rule | Enforced in | Proved by | Rule removed |
|---|---|---|---|
| **No token pass-through.** The server accepts only tokens issued for it, and never forwards the inbound token downstream. | `Modules/Mcp/oauthAuth.js` `authenticate` (only `ahoa_` tokens from `grants.introspect`), `Modules/Mcp/server.js` `authenticate` | `tests/mcp-oauth-actions.test.js` "no token pass-through › never puts the inbound token in an outbound URL, header or body during reads and writes"; `tests/integration/mcp-oauth-tokens.int.test.js` "reads with tasks:read, …" (webhook deliveries carry no token) | |
| **Audience binding.** A token's `resource` must be exactly `<issuer>/mcp`. A trailing slash or another host is a different resource. | `Modules/Mcp/oauthAuth.js` `authenticate` (`token.aud !== mcpOAuth.resource()`); `Modules/OAuthServer/config.js` `canonicalResource`; `grants.exchangeCode` and `grants.refresh` | Scripted client: "audience binding › will not issue a token for another resource" and "answers 401 to a live token whose audience is …"; `tests/mcp-oauth-tokens.test.js` "is refused for another audience with a 401 challenge" | yes |
| **Header only.** A token in the query string is refused before any lookup. | `Modules/Mcp/server.js` `hasQueryToken`, `queryTokenRefused` | Scripted client: "where a token is accepted › refuses a token in the query string as …"; `tests/mcp-oauth-resource.test.js` "tokens in the query string" | |
| **Opaque tokens, checked on every call.** A revoked grant stops a live session on its next request. | `Modules/OAuthServer/grants.js` `introspect`, `revokeGrant` | Scripted client: "answers 401 mid-session once the grant is revoked"; `tests/oauth-server.test.js` "/oauth/revoke (RFC 7009)" | |
| **Hashed at rest, never logged.** | `Modules/OAuthServer/tokenHash.js` | `tests/oauth-server.test.js` "secrets at rest and in logs"; `tests/integration/oauth-server.int.test.js` "writes no code, token, verifier or secret to any log" | |

## Sessions

| Rule | Enforced in | Proved by | Rule removed |
|---|---|---|---|
| **A session is never authorization.** Neither an `Mcp-Session-Id` nor a session cookie authenticates a request, whatever it holds. Only the `Authorization` header counts. The server is stateless and issues no session ID. | `Modules/Mcp/server.js` `bearerOf`, `authenticate` | Scripted client: "never takes an Mcp-Session-Id as authorization, whatever it holds"; `tests/mcp-oauth-tokens.test.js` "a session is never authorization"; `tests/integration/mcp-oauth-tokens.int.test.js` "takes neither a signed-in session cookie nor an Mcp-Session-Id as authorization" | yes |
| **Every request is verified**, including workspace membership, so a person removed from the workspace is cut off on the next call. | `Modules/Mcp/oauthAuth.js` `authenticate` (`verifyCompanyMembership`) | `tests/mcp-oauth-person.test.js` "refuses the same token once the person behind the grant is removed from the workspace"; `tests/mcp-oauth-tokens.test.js` "cuts off a person who left the workspace" | |

## The authorization flow

| Rule | Enforced in | Proved by | Rule removed |
|---|---|---|---|
| **Discovery.** A 401 carries `resource_metadata`. The protected-resource metadata names the authorization server, and the server metadata follows RFC 8414. | `Modules/Mcp/server.js` `unauthorized`; `Modules/Mcp/routes.js`; `Modules/OAuthServer/controller.js` `metadata` | Scripted client: "discovery"; `tests/mcp-oauth-resource.test.js` "carries resource_metadata and the default read scopes for discovery with the flag on" | |
| **PKCE is required, S256 only.** A code needs its verifier and is spent on its first use. | `Modules/OAuthServer/controller.js` `authorize`; `Modules/OAuthServer/grants.js` `exchangeCode` | Scripted client: "PKCE › …"; `tests/oauth-server.test.js` "refuses a wrong verifier and spends the code, so the right one cannot follow"; `tests/integration/oauth-server.int.test.js` "refuses plain PKCE and a wrong resource at both endpoints" | yes |
| **Exact redirect URIs**, compared as exact strings. The one exception is an http loopback redirect (`127.0.0.1`, `[::1]` or `localhost`), which may use any port (RFC 8252 §7.3). An https port change, https on `localhost` and a scheme change are all refused. The code is bound to the redirect it was issued with, port included. | `Modules/OAuthServer/redirectUri.js` `matchesRegistered`, `isAllowedRedirectUri`; `grants.exchangeCode` | `tests/oauth-server.test.js` "accepts any port on an http loopback redirect on …", "keeps exact matching for …", "refuses a redirect_uri with …, and never redirects to it", "binds the code to the redirect_uri actually used, port included" | |
| **`state` and `iss` returned.** Errors never reach a redirect URI that has not been verified. | `Modules/OAuthServer/controller.js` `authorize` | `tests/oauth-server.test.js` "echoes state and the issuer with the code", "refuses an unknown client without redirecting" | |
| **Refresh rotation.** Each refresh spends the old token. A replayed refresh token revokes the whole grant (the token family). | `Modules/OAuthServer/grants.js` `refresh`, `revokeGrant` | Scripted client: "rotates the refresh token, and a replayed one revokes the whole family"; `tests/oauth-server.test.js` "/oauth/token: refresh" | yes |
| **Lifetimes.** Access tokens last 15 minutes, refresh tokens 30 days and a grant at most 90 days. | `Modules/OAuthServer/config.js` `lifetimes`; `grants.issueTokens` | `tests/oauth-server.test.js` "exchanges a code for audience-bound tokens with the documented lifetimes", "stops refreshing once the grant cap has passed" | |

## Client registration

| Rule | Enforced in | Proved by | Rule removed |
|---|---|---|---|
| **Pre-registration.** Only an owner or admin, signed in, can register a client. The secret is shown once, and the client is bound to the registering workspace. | `Modules/OAuthServer/admin.js`; `clients.register` | Scripted client: "a pre-registered client stepping up from tasks:read"; `tests/oauth-server.test.js` "admin pre-registration", "binds a pre-registered client to the workspace that registered it" | |
| **Client ID metadata documents: SSRF rules.** A document is fetched only over https, through `safeFetch`, which checks and pins the resolved address and follows no redirects. Size and time are capped, and the document must be served at its own `client_id`. Loopback, private and link-local addresses are refused. | `Modules/OAuthServer/metadataDocument.js`; `Modules/Agents/engine/safeFetch.js` | Scripted client: "a client ID metadata document client › …"; `tests/oauth-client-metadata-ssrf.test.js`; `tests/oauth-server.test.js` "refuses a document served from another URL than its client_id" | |
| **Dynamic registration** is off unless `MCP_OAUTH_DCR` is set. | `Modules/OAuthServer/routes.js` | Scripted client: "publishes resource metadata, then server metadata that requires S256" (no `registration_endpoint`) | |

## Scopes and what a token may do

| Rule | Enforced in | Proved by | Rule removed |
|---|---|---|---|
| **Scope challenges.** A call that needs a scope the token lacks gets `403 insufficient_scope`. The challenge lists the scopes already held plus the missing one, so stepping up keeps what was granted. Tools also check scopes, as a second layer. | `Modules/Mcp/server.js` `insufficientScope`; `Modules/Mcp/scopes.js`; `Modules/Mcp/tools.js` `scopeRefusal` | Scripted client: "refuses a write with 403 insufficient_scope, then writes after stepping up" (the acceptance case: a client holding only `tasks:read`); `tests/mcp-oauth-resource.test.js` "403 insufficient_scope" | yes |
| **Least privilege by default.** With no scope requested, a client gets read scopes only, and a refresh may narrow the scopes but never widen them. | `Modules/OAuthServer/controller.js` `defaultScopes`; `grants.refresh` | `tests/oauth-server.test.js` "grants the resource default read scopes when scope is omitted …", "may narrow the scopes but never widen them" | |
| **Visibility for the delegating person.** A token sees and changes exactly what the person behind the grant can open in the web app. | `Modules/Mcp/visibility.js` | `tests/mcp-oauth-actions.test.js` "visibility of an OAuth call"; `tests/mcp-tool-visibility.test.js`; `tests/integration/mcp-tool-visibility.int.test.js` | |
| **Per-workspace approval.** A client with a live grant is refused unless the workspace approves it. If the approval module is present but broken, the client is refused. | `Modules/Mcp/oauthAuth.js` `clientApprovedInWorkspace`; `Modules/Mcp/approvalsHook.js` | `tests/mcp-oauth-approvals.test.js` "/mcp and the approval module"; `tests/mcp-oauth-tokens.test.js` "is refused once the workspace withdraws its approval" | |
| **Destructive actions go through proposals.** With `MCP_TOOLS_V2` on, a destructive call (an irreversible rating, or any workspace-scope write) opens a proposal that a person approves; it does not run. An OAuth grant cannot file one yet, because approval re-checks only a personal access token, so its destructive call is refused. Under `AGENT_TAINT_ROUTING`, an outside client's other risky writes also wait for a person. | `Modules/Mcp/propose.js`; `Modules/Mcp/tools.js`; `Modules/Mcp/taintHold.js` | `tests/mcp-tools-v2.test.js` "destructive calls open a proposal" (including "refuses to file a proposal for an OAuth grant, which approval cannot re-check yet"); `tests/mcp-proposal-approval.test.js`; `tests/mcp-oauth-actions.test.js` "holds a risky write from an OAuth client for a person, and leaves an audited refusal" | |
| **Audit attribution** names both the agent and the delegating person. | `Modules/Agents/actor.js` `externalClientActor` | `tests/mcp-oauth-actions.test.js` "audit attribution under AUDIT_CHAIN"; `tests/integration/mcp-oauth-tokens.int.test.js` "reads with tasks:read, …" | |

## Consent (confused deputy)

AlianHub is the authorization server for its own data. It does not act as a proxy to a third-party authorization server, so the confused-deputy attack in the best-practices page has no upstream consent cookie to exploit. The consent screen is slice S3 (#805, in review). It covers per-client consent, CSRF protection and refusal to render in a frame. Until S3 merges, an authorization can only complete through the test-only consent path, which is on only when `NODE_ENV=test`. `tests/conventions/oauth-test-consent.test.js` holds that path to its gate. The scripted client uses that path through `tests/support/mcpOAuthClient.js` (`CONSENT_FLOW`) and should move to the consent screen when S3 merges.

## Transport

| Rule | Status |
|---|---|
| **Origin validation (DNS rebinding).** | Partly met. `utils/cors.js` refuses a foreign `Origin` for every route, `/mcp` included, before the handler runs. The refusal comes back as HTTP 200 with `status: false`, but the transport specification requires a 403, so the suite's `dns-rebinding-protection` scenario is an expected failure. The risk is limited because only an `Authorization` header authenticates, and a rebinding page has none. |
| **Protocol version header.** | An unsupported `MCP-Protocol-Version` gets a 400: `tests/integration/mcp-oauth-tokens.int.test.js` "answers 400 to an unknown MCP-Protocol-Version". |
| **HTTPS.** | `Modules/OAuthServer/config.js` `issuerProblem` refuses to start with a non-https issuer, except on a loopback host outside production. |

## Client-side items

The URL-scheme validation, local-server consent and stdio-proxy items in the best-practices page are about MCP clients and local servers. They do not apply to this hosted server.
