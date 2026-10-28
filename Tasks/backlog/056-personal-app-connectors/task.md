---
id: 056
title: Personal app connectors for AI and agents — one reusable module, then connectors one by one
status: backlog
priority: high
depends_on: [061, 062, 063, 064, 065, 066, 067, 068, 069, 070, 071, 072, 073, 074, 075, 076, 077]
created: 2026-10-23
---

# 056 — Personal app connectors for AI and agents (PRD)

Status: backlog · PRD v1.1, 2026-10-23 · open questions answered by the owner (decisions 13–17); owner corrections still to come.

Builds on the connector work of task 046 (`Tasks/active/046-better-than-clickup/design-connectors.md`, slices 1–3 built) and changes several of its decisions (section 3).

Anything said here about a provider's console, scopes, review process or limits is **from memory, as of 2026**; Phase 0 confirms it.

## 1. Problem

People run their work across HubSpot, Gmail, Notion, Slack, GitHub, Figma and others, and want the AI in AlianHub (built-in agents, or their own Claude or ChatGPT connected over MCP) to read from and act in those tools. Today:

- Only Slack (one workspace bot) and Google Calendar (a per-person connection with no tools yet) are agent connectors, and GitHub is a workspace-wide sync.
- There are four unrelated connection models, each with its own OAuth, storage and screens, so every new connector is a from-scratch build.
- A connection is either shared by the whole workspace or limited to one per person, and an AI acting for one person can end up using an account that is not theirs.

## 2. Goal and success measures

One reusable connector module through which **each person connects their own accounts**, and through which both AlianHub's agents and the person's own AI act in those accounts — safely, with approval for every outside write, and fully tracked. Adding a connector is describing a provider and its tools.

Success measures:

- A new connector after the pilot ships with one provider definition plus its tools, with no new route, collection or screen.
- Zero tokens or client secrets in any response, log, socket event or audit row (tested).
- Every connector call is attributable from the audit log to a person, an agent or MCP client, and a connection.
- The existing Slack, GitHub and Google Calendar paths are removed after migrating onto the module.

Connectors in scope:

| Connector | Status |
|---|---|
| Google: Calendar, Meet, Drive | pilot (Calendar connection exists; Gmail follows later, decision 15) |
| GitHub | exists per workspace; moves to personal |
| Slack | exists per workspace; moves to personal |
| Dropbox | exists as the attachment picker; moves to the module |
| HubSpot, ClickUp, Notion, Upwork, Outlook, Supabase, Canva, Figma | new, easiest first |
| Wispr Flow | new; research first, dropped if no usable API or export |
| Shopify | optional, last |

## 3. Decisions (owner, 2026-10-23)

1. **Personal only.** A connection is owned by one person and used only on that person's behalf. No workspace-owned or shared connections.
2. **Accounts per person.** One account per connector per person in the first version. The data model is keyed by connection id, so several accounts per person can be switched on later with an account picker and little else.
3. **OAuth apps: instance default + company override.** The instance sets each provider's client id and secret in `.env`; a workspace owner or admin may register the company's own app, which then wins for that workspace.
4. **Used by both** AlianHub's built-in agent runs **and** the person's own Claude or ChatGPT through AlianHub's MCP server. This partly reverses decision 30 (task 047), under which the person's own AI brought its own connectors.
5. **Every write to an outside service needs approval**, at every autonomy level, tainted run or not.
6. **Tracking covers:** an audit row for every call, connection health and status, usage counts and limits, and an admin overview.
7. **Tools first, sync later.** Background sync into AlianHub is a later decision per connector.
8. **Slack moves to personal OAuth.** The workspace bot token, signing secret, channel allow-list and decision 3 of task 046 are retired.
9. **GitHub moves to personal, on demand.** Pull requests are looked up and linked when a member or their AI asks. The workspace sign-in and the background PR → task sync of task 049 are retired.
10. **Google is one connection per Google account** with products ticked (Gmail, Drive, Meet, Calendar); only ticked products' scopes are asked for, more added later by incremental consent.
11. **Google is the pilot** for the new module.
12. **Wispr Flow:** research decides; dropped if there is nothing to connect to.
13. **MCP writes are approved in the AlianHub Inbox**, as proposals only the connection's owner approves, the way held MCP calls already work. Never inline in the AI client.
14. **Usage limits.** Defaults per person: 500 reads and 50 write proposals a day across their connections; per agent: 200 reads a day. A workspace owner or admin may change them for the workspace, a member or an agent, up to a ceiling the instance admin sets in `.env`.
15. **Gmail is not in the Google pilot.** The pilot ships Calendar, Meet and Drive (picked files, `drive.file`). Gmail's supported production path is a company's own Internal Google app through the company override; Gmail on the Alian-hosted instance waits for the owner's decision on Google verification and the yearly CASA assessment, made later from lab quotes. Customers run both hosted and self-hosted, and users are mostly on company Google Workspace domains, some on personal Gmail.
16. **The Drive/Dropbox attachment picker joins the module.** It uses the person's Google connection (Drive ticked) and a Dropbox provider, with the instance or company app instead of an app per person. A person's connection is never usable by anyone else; the shared OAuth app gives nobody access to anyone's account.
17. **Connector order after Google: easiest first**, ranked by the Phase 0 research on build effort and app-review time. Shopify stays optional and last.

## 4. Users and roles

| Role | Wants | May |
|---|---|---|
| Member | Their AI to work in their own tools | Connect, use, approve writes from, and disconnect **their own** connections |
| Owner / admin | Oversight and the ability to cut access | See every member's connections (provider, scopes, status, dates, usage), end any of them, set quotas, register the company's OAuth apps. **Never** use a member's connection, read through it, approve its writes or see its tokens |
| Instance admin | Run the product | Set instance-default OAuth apps and `CONNECTORS` in `.env` |
| Built-in agent | Do work for a person | Call tools on the connection of the person the run works for |
| Person's own AI (MCP client) | Do work for its person | Call tools on the connection of the person behind its token or OAuth grant |
| Guest, API token without the connector scope | — | Nothing |

## 5. User stories

1. As a member, I connect my HubSpot from "My connections" and see the account it is, its status and when it was last used.
2. As a member, I tick Gmail and Drive on my Google connection; later I tick Meet and Google asks only for Meet's access.
3. As a member, I ask my Claude (over AlianHub MCP) "find the HubSpot deal for Acme and add the next step to my task", and it reads my HubSpot only.
4. As a member, when an agent wants to post in Slack, create a Notion page or draft a Gmail reply, I see exactly what would go out and approve or decline it; nothing is sent before.
5. As a member, I disconnect a connection and the provider is told; no AI can use it again.
6. As an admin, I see which members connected what and can end a connection, for example when a laptop is lost.
7. As an admin, I register our company's own Google app so the consent screen shows our name.
8. As an admin, I remove a member and all their connections end at the providers.
9. As an instance admin, I follow one page per provider to register its app and switch it on.

## 6. What exists today

| Model | Where | Owner | Notes |
|---|---|---|---|
| `integration_connections` catalogue | `Modules/Integrations` (`helpers/integrationsRules.js` `CATALOG`) | workspace | Slack slash command, GitHub PAT, GitLab, an unread `google_calendar` client id/secret, Teams webhook, Zapier, iframe |
| App connections (GitHub sync) | `Modules/Integrations/appConnections`, flag `APP_CONNECTIONS` | workspace, repos per project (049) | OAuth with PKCE, 5-minute cron, per-repo cursor and backoff, acts as `connectedBy`; `registry.js` is a sync-only interface |
| Agent connectors `connector_connections` | `Modules/Agents/connectors`, routes `Modules/Connectors`, flag `CONNECTORS` | Slack: workspace bot. Google Calendar: per person | Own Google client, PKCE, 4-step connect, tokens in the secrets store by handle, refresh on use, revoke on disconnect and member removal. No tools; `usableTokenHandle` has no production caller. Lookup `findOne(userId, connector)` |
| `cloud_storage_connections` | `Modules/CloudStorage` | per person | Drive/Dropbox attachment picker. Each person registers their own OAuth app; the client secret is stored unsealed (`sanitizeAppConfig`, `controller.js` `saveSettings`) while tokens are encrypted; a short-lived access token goes to the browser for Google's picker; disconnect only blanks tokens and never revokes; nothing ends it when a member leaves. Picked files are attached as a link or imported as a copy using the session person's own token |

Reused as is: the secrets store (`Config/secrets.js`, kind `connector`), the state/PKCE/fragment-complete flow (`googleConnection.js`), membership at use and `memberDeparted.js`, the agent registry with `proposeOnly` and proposals, MCP proposals waiting in the Inbox (`Modules/Mcp/propose.js`, `approval.js`), MCP tool scopes (`Modules/Mcp/scopes.js`), connector taint and no web fetch after a connector read (`taint.js`, `agentFetch.js`), read caps (`readLimits.js`), the egress allow-list (`Instance/egress.js`), backoff (`appConnections/backoff.js`), the audit words `connector.*`.

## 7. Functional requirements

### 7.1 Providers

- **FR-1** A provider is one definition file: id, display name, auth (authorize and token endpoints, PKCE, extra parameters), scopes per product and per tool, how to read the account id and label, refresh, revoke, the hosts it calls (for egress), rate-limit signals, and its tools.
- **FR-2** Adding a provider needs no new route, collection, screen or registry file. A provider is offered only when named in `CONNECTORS` and an OAuth app (instance or company) is configured.
- **FR-3** Providers with products (Google; others the research finds) expose them as ticks on one connection; scopes are the union of the ticked products' scopes.

### 7.2 OAuth apps

- **FR-4** Instance defaults from `.env`: `CONNECTOR_<PROVIDER>_CLIENT_ID` and `CONNECTOR_<PROVIDER>_CLIENT_SECRET`. The existing `CONNECTOR_GOOGLE_*` keep working.
- **FR-5** A company override: an owner or admin enters a client id and secret per provider; the secret goes to the secrets store and is never shown again. The override applies to that workspace only and wins over the instance default.
- **FR-6** Each connection records which app issued it. Changing or removing a company app marks that app's connections `reauth_required`; nothing is silently moved to another app.
- **FR-7** The redirect URI is `<APIURL>/api/v1/connector-oauth/<provider>/callback`, never built from a request header, and is shown on the company-app form for copying.

### 7.3 Connecting and lifecycle

- **FR-8** Connect uses the existing four steps for every provider: `POST /api/v2/connectors/<provider>/connect` returns the consent address; the public callback hands the code to the page in the URL fragment; the page calls `POST /api/v2/connectors/<provider>/complete` under its own session; only then is the code exchanged. A signed ten-minute state names workspace, person, provider and connection; PKCE (S256) where the provider supports it; the state is used up by the first attempt.
- **FR-9** Only the scopes the provider actually granted are stored; a tool checks its scope at call time and, when missing, says which product to tick.
- **FR-10** Adding a product asks only for its scopes (incremental consent) on the same connection.
- **FR-11** Reconnecting with the same account replaces tokens; with a different account it revokes the earlier grant (one account per connector per person, decision 2).
- **FR-12** Disconnect revokes at the provider unless another live connection of the same person shares the grant, retires the secrets and closes the row.
- **FR-13** Membership is checked at every use: a guest, a removed or deactivated member, or an unreadable seat gets no token.
- **FR-14** Member removal and deactivation (members screen, SCIM) end every connection of that person; a failure never blocks the removal. A daily sweep ends anything missed.

### 7.4 Credentials

- **FR-15** Access and refresh tokens live only in the secrets store under kind `connector`, by handle. No route, log, socket event, audit row or browser ever receives one. One exception: the attachment picker (FR-39) hands the connection's owner, in their own session, a short-lived `drive.file` access token for Google's picker; never a refresh token, never to anyone else.
- **FR-16** The module refuses to switch on without `SECRETS_STORE` and a usable `SECRETS_KEY`, with one startup log line and the reason on the admin screen.
- **FR-17** Tokens are refreshed on use, one attempt; `invalid_grant` (or the provider's equivalent) marks the connection `broken` and notifies the person; other failures fail that one call only.

### 7.5 Tools for AI

- **FR-18** A tool is defined once in its provider: key (`<provider>.<object>.<verb>`, e.g. `hubspot.deal.search`), label, read or write, required scope, input schema, output shape and caps. From that one definition it is registered in the agent registry and as an MCP tool.
- **FR-19** A call uses only the connection of the person the run works for (who started it or owns the schedule) or the person behind the MCP token or grant. No connection: refused with "connect <provider> on My connections". The one-account rule means no account choice now; the call takes a `connectionId` parameter reserved for several accounts later.
- **FR-20** Reads return text only, capped per read and per run (per-provider defaults, based on `readLimits.js`), and taint the run with kind `connector` and a ref such as `hubspot:<hash of the object id>`. After a connector read the run makes no web fetch.
- **FR-21** Writes are `proposeOnly` at every autonomy level, from both paths. MCP writes are filed as proposals that wait in the AlianHub Inbox, like other held MCP calls (`Modules/Mcp/propose.js`); the tool's reply says so. No write is approved inside the AI client.
- **FR-22** A new gate `connection_owner`: only the person who owns the connection may approve its writes. An owner or admin may not approve on their behalf.
- **FR-23** The approval card shows exactly what will go out (recipient or target, title, the whole text, attachments if any); what is approved is what is sent; an edit is re-validated and shown again. One attempt per approval; the result or error is kept on the proposal.
- **FR-24** Every provider call goes through `agentFetch` in the workspace's egress context; the provider's hosts come from its definition, so the "Allow host" prompt names them.
- **FR-25** MCP exposes connector tools under new scopes `connectors:read` and `connectors:write`, shown on the consent screen of the person's own AI; a token without them does not see the tools.

### 7.6 Tracking

- **FR-26** Audit: one `connector.call` row per call (person, agent or MCP client, connection, provider, tool, outcome, counts), never content or ids in clear. Also `connector.connect`, `connector.products_changed`, `connector.broken`, `connector.revoke`, `connector.app_set`.
- **FR-27** Health: status (`pending`, `connected`, `broken`, `reauth_required`, `revoked`), token expiry, last used, last error; the person is notified when action is needed.
- **FR-28** Usage: counts per connection, person and agent by day; shown to the person on their connection and to admins in the overview.
- **FR-29** Limits: provider rate limits honoured with backoff and `Retry-After`. Daily quotas with defaults of 500 reads and 50 write proposals per person (across their connections) and 200 reads per agent. An owner or admin sets them for the workspace, a member or an agent, never above the instance ceiling in `.env`. A call over quota is refused with the limit and when it resets. The run's existing spend and daily-run limits apply unchanged.
- **FR-30** Admin overview: per member, each connection's provider, products, scopes, status, connected and last-used dates, usage, and an "End connection" action. Not the account's email or label (the 046 rule), never tokens.

### 7.7 Screens

- **FR-31** "My connections" on the Connections page: available providers, connect, products, status, usage, reconnect, disconnect.
- **FR-32** The admin overview and the company OAuth apps list (per provider: instance default in use / company app set, redirect URI, set or replace, remove).
- **FR-33** The approval card per tool kind in the Inbox (FR-23).
- **FR-34** All strings through i18n (`Connectors.*`), all colours from tokens; style and i18n checks pass.

### 7.8 Migration of existing connectors

- **FR-35** Google Calendar rows move into the Google provider as one connection with Calendar ticked; existing grants keep working.
- **FR-36** Slack becomes a personal OAuth provider (user token); `slack.channel.read` and `slack.message.post` are redefined on the person's token and the channels their Slack user can see. The bot token, signing secret and allow-list are retired, their secrets revoked, and admins told. Slack needs an HTTPS redirect, so local development uses a tunnel.
- **FR-37** GitHub becomes a personal OAuth provider; `pull_request.get` and new link tools use the caller's own connection. The workspace connection, repo-to-project mapping, cron runner and their screens (task 049) are retired with a migration; admins are told before it runs.
- **FR-38** The Slack slash command and the other `integration_connections` catalogue entries are not connectors and stay as they are.
- **FR-39** The Drive/Dropbox attachment picker uses the module: Drive through the person's Google connection with Drive ticked (`drive.file`), Dropbox through a Dropbox provider. The per-person app settings go; the instance or company app is used. Existing `cloud_storage_connections` rows are migrated or the person is asked to reconnect once, and their stored client secrets are deleted.
- **FR-40** A picker token and a file import are available only to the connection's owner, taken from their own session; no route accepts another person's id. A file attached as a link opens for others only as Google or Dropbox sharing allows; a file imported as a copy is stored like an upload and seen by whoever can see the task. Nobody can browse or pick from another person's account.

## 8. Data model

`connector_connections` (evolved, declared in the strict schema):

| Field | Purpose |
|---|---|
| `_id` | the connection id every tool, audit row and proposal names |
| `companyId`, `userId` | owner |
| `provider`, `products[]` | what is connected |
| `account { id, label }` | the provider's account id and a display label (shown to the owner only) |
| `scopes[]` | as granted |
| `status`, `lastError`, `brokenAt` | health |
| `app { source: 'instance' \| 'company', appId }` | which OAuth app issued it |
| `handles { access, refresh }` | secrets store handles |
| `accessExpiresAt`, `connectedAt`, `lastUsedAt`, `disconnectedAt`, `disconnectedBy` | dates |
| `oauth { stateHash, verifier, sessionId, origin }` | in-flight connect |
| `backoffUntil` | provider rate limit |

Unique index on (`companyId`, `userId`, `provider`, `account.id`); a partial unique index on (`companyId`, `userId`, `provider`) for live rows enforces one account per connector until decision 2 is lifted.

New: `connector_apps` (`companyId`, `provider`, `clientId`, secret handle, set by, dates) and `connector_usage` (`companyId`, `connectionId`, `userId`, `agentId` or MCP client, day, counts), or counters on the row if the research shows that is enough. Migrations for FR-35 to FR-37.

## 9. API surface (sketch)

| Route | Who |
|---|---|
| `GET /api/v2/connectors` | member: providers on, own connections |
| `POST /api/v2/connectors/:provider/connect` / `complete` | member |
| `PUT /api/v2/connectors/connections/:id/products` | owner of the connection |
| `DELETE /api/v2/connectors/connections/:id` | owner of the connection, or owner/admin (ends it) |
| `GET /api/v1/connector-oauth/:provider/callback` | public, rate-limited |
| `GET /api/v2/connectors/admin/connections` | owner/admin |
| `PUT` / `DELETE /api/v2/connectors/admin/apps/:provider` | owner/admin |
| `PUT /api/v2/connectors/admin/quotas` | owner/admin |

Write routes are wrapped in `agentsRefused`; audit, socket emit and cache clear like sibling routes. `api:doc` runs in the follow-up docs PR (Rule 4).

## 10. Non-functional requirements

- **Security:** company scoping on every query; tokens only by handle; least scopes; no token to the browser; state signed, short-lived, single-use, bound to session; public callback rate-limited; the egress allow-list respected; `/security-review` on every PR of this task.
- **Privacy:** no connector content stored outside the run's model call and its replay row (`AI_REPLAY`); audit rows hold hashes, not ids or text.
- **Reliability:** one provider down never affects another; a refresh failure fails one call; the daily sweep is idempotent.
- **Testability:** every provider tested against a fake provider server; no real credential needed to merge.
- **Docs:** one setup page per provider for the instance admin (register app, redirect URIs, scopes, review needed) and for a company admin (override).
- **Feature flag:** `CONNECTORS=<providers>`; off means no route, tool or screen for that provider.

## 11. Phases and milestones

| Phase | Output | Done when |
|---|---|---|
| 0 Research | `resources/research-matrix.md`: per connector auth type, per-person support, API reach and least scopes, app review needed, token life, limits, callback constraints, verdict | Owner accepts the matrix and the connector order |
| 1 Module | FR-1 to FR-34, with Google as the pilot provider: Calendar, Meet and Drive (`drive.file`) tools; no Gmail | A member connects Google, ticks products, and both an agent run and MCP read and propose writes on it; the admin overview and audit show it |
| 2 Migration | FR-35 to FR-40 | Calendar, Slack, GitHub and the Drive/Dropbox picker run on the module; old paths removed |
| 3 Connectors | One provider at a time, easiest first by the research's ranking; Gmail once its production path is decided; Shopify optional and last | Each passes the acceptance criteria below |

Phase 0 questions to settle beyond the matrix: Wispr Flow (any API or export); Supabase (Management API, or data in a project database); Outlook (Microsoft Graph, multi-tenant app, tenant admin consent); Meet (Meet REST API scopes and their sensitivity); Upwork (API key application and terms); Canva, Figma, HubSpot, Shopify (public app review); per-instance vs per-company review for a self-hosted product; current CASA lab quotes for Gmail on the hosted instance (indicative 2026 figures: about $500–$6,000 a year in lab fees at budget labs, far more at premium firms, plus fix-up time; reassessed every 12 months). The matrix ends with the ranking for Phase 3.

### Sub tasks (split 2026-10-28)

| Phase | Task | FRs | Depends on |
|---|---|---|---|
| 0 | 061 Research: Google, Slack, GitHub, Dropbox | — | — |
| 0 | 062 Research: new connectors, Gmail CASA, Phase 3 ranking | — | — |
| 1 | 063 Provider definition, registry, Google provider file | 1–3 | 061 |
| 1 | 064 Data model | §8 | — |
| 1 | 065 OAuth app lookup + secrets guard | 4–7, 16 | 063, 064 |
| 1 | 066 Connect lifecycle handlers | 8–13, 15, 17 | 065 |
| 1 | 067 Member removal + daily sweep | 14 | 066 |
| 1 | 068 Tool framework (agents + MCP) | 9, 18–20, 24, 25 | 063, 066 |
| 1 | 069 Write approvals | 21–23 | 068 |
| 1 | 070 Audit, health, usage, quotas, backoff | 26–29 | 064, 068 |
| 1 | 071 Google pilot tools | — | 068, 069 |
| 1 | 072 Screens | 30–34 | 066, 069, 070 |
| 2 | 073 Migrate Google Calendar | 35 | 071 |
| 2 | 074 Slack personal | 36 | 061, 069, 070, 072 |
| 2 | 075 GitHub personal | 37 | 061, 069, 070, 072 |
| 2 | 076 Attachment picker | 39, 40 | 071, 072 |
| 2 | 077 Remove old paths + setup docs | 38 | 073–076 |

Phase 3 tasks (one per connector, Gmail when decided) are created after 062's ranking is accepted.

## 12. Out of scope

- Workspace-owned or shared connections.
- Background sync for any connector (later, per connector).
- Writes to outside services without approval; sending Gmail (drafts at most).
- Gmail in the Google pilot.
- Several accounts per person in the screens (the data model allows it).
- The integration catalogue (slash command, webhooks, Zapier, iframe).

## 13. Acceptance criteria

- The Phase 0 matrix exists for every listed connector with a verdict and reason, accepted by the owner.
- A new provider is added by one definition plus its tools, with no new route, collection or screen.
- Two people in one workspace connect the same provider with different accounts; each person's built-in runs and MCP client reach only their own account; a person with no connection is refused with a clear reason.
- No route, log, socket event or audit row contains a token or client secret (asserted in tests); nothing switches on without the secrets store.
- Every outside write from either path becomes a proposal only the connection's owner can approve; an admin's approval is refused; what is sent equals what was approved.
- Every call writes one audit row; usage counts match the calls; a quota stops calls with a clear reason; an admin cannot set a quota above the instance ceiling.
- An MCP write from a person's own AI waits in the Inbox and only that person can approve it.
- The attachment picker works from a person's module connection with no per-person app; another person's session cannot get a picker token or import through it; disconnecting revokes at the provider.
- An admin sees members' connections, scopes, status and usage and can end one, but no route lets them use it.
- Removing or deactivating a member revokes their connections at the provider and clears their secrets; the sweep catches a removal made while the provider was off.
- A company OAuth app replaces the instance default for that workspace only; replacing it marks its connections for reconnect.
- Google Calendar, Slack, GitHub and the attachment picker run on the module; the old paths are gone, with migrations that are safe to run twice.
- Every provider is tested against a fake provider; i18n, style and API-doc checks pass.

## 14. Open questions

The five questions of v1 were answered on 2026-10-23 (decisions 13–17). Still open:

1. **Gmail on the Alian-hosted instance:** fund Google verification and the yearly CASA assessment, or not. The owner decides from current lab quotes gathered in Phase 0.

## 15. Risks

- **Provider review:** restricted Google scopes, Upwork API access and public-app review at Canva, Shopify and others can block production use regardless of the build; the matrix must surface this early.
- **Gmail for personal accounts:** until the hosted app is verified, people on personal @gmail.com addresses on the hosted instance have no Gmail connector; only company Internal apps work.
- **Picker migration:** members who used the old picker must reconnect once if their grant cannot be carried over, since it was issued by their own app.
- **Losing GitHub sync:** retiring task 049's automatic PR linking is a visible regression for teams that rely on it; admins are told before migration.
- **Slack user tokens** reach everything the person can see in Slack; read tools must still be capped and tainted, and writes approved.
- **Prompt injection** through connector content (mail, Slack, CRM notes): taint, no web fetch after a read, and approval for every write are the defence; no tool may bypass them.
