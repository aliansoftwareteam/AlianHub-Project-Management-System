---
id: 056
title: App connectors for AI and agents — MCP first, built connectors where needed, one Connectors screen
status: backlog
priority: high
depends_on: [061, 062, 063, 064, 065, 066, 067, 068, 069, 070, 071, 072, 073, 074, 075, 076, 077, 078, 079, 092, 093, 094, 095, 096, 097, 098, 099, 100, 101]
created: 2026-10-23
---

# 056 — App connectors for AI and agents (PRD)

Status: backlog · PRD v2.0, 2026-11-12 · approved by the owner on 2026-11-12. v1.1 (2026-10-23) is in git history.

v2.0 keeps the base of v1: personal connections, approval for every outside write, full tracking. It changes how AlianHub reaches each app: through the app's own MCP server wherever that server admits AlianHub, and through a connector we build only where it does not. It adds a shared sign-in address for hosted instances, custom MCP servers, connectors in the AI chat, and one Connectors screen.

**Most of v1.1 is already built** on the integration branch `feat/per-user-connectors` (tasks 061–074, 076, 078; §6). v2.0 builds on that module: Google, Slack and the Dropbox picker stay the built connectors they are, and the new work is the MCP road (092, 100), Notion and GitHub as the first MCP apps, the hosted sign-in service, custom servers, the AI chat, agents and the Connectors screen redesign.

Provider facts: `resources/research-matrix.md` (sections 1–9 from 061, 062 and 074; section 10, the MCP servers, from web research on 2026-11-12). Rows marked "to confirm" are checked with a real test connection in each app's own task.

## 1. Problem

People run their work across GitHub, Slack, Google, Notion, HubSpot and other apps. They want AlianHub's AI to read from and act in those apps: the AI chat (Ask), built-in agents, and their own Claude or ChatGPT connected over MCP. Today:

- Only Slack (one workspace bot) and Google Calendar (a per-person connection with no tools yet) are agent connectors, and GitHub is a workspace-wide sync.
- There are four unrelated connection models, each with its own OAuth, storage and screens, so every new connector is a from-scratch build.
- A connection is either shared by the whole workspace or limited to one per person, and an AI acting for one person can end up using an account that is not theirs.
- Connector screens are spread over five pages (Integrations hub, Connections, App connections, Google, Slack) and are hard to find and use.
- Most apps want an OAuth app registered against each install's own address. With self-hosted installs and hosted instances on many domains, white-label and custom domains included, that cannot be done one domain at a time.

## 2. Goal and success measures

One connector module and one Connectors screen. Through them **each person connects their own accounts**, and the AI chat, built-in agents and the person's own AI act in those accounts: safely, with approval for every outside write, and fully tracked. Adding an app that has a usable MCP server is one catalog entry, with no code.

Success measures:

- A new app with a usable MCP server ships as one catalog entry: no new route, collection, screen or code.
- A new hosted instance or custom domain needs no registration at any provider.
- Zero tokens or client secrets in any response, log, socket event or audit row (tested).
- Every connector call is attributable from the audit log to a person, the AI chat, an agent or an MCP client, and a connection.
- The existing Slack, GitHub, Google Calendar and attachment-picker paths and their screens are removed after moving onto the module.

### First-stage apps

| App | Reached through | Sign-in | Phase | Notes |
|---|---|---|---|---|
| Google: Calendar, Meet, Drive | Built | Google app registered once, plus Google's review | **Built** (071) | Google's MCP servers are a preview and leave out Meet; Calendar and Drive may move to MCP when they are generally available. No Gmail (decision 15) |
| Slack | Built | Slack app registered once | **Built** (074, checked against real Slack) | Stays built (decision 29); Slack's MCP server is an option later |
| Dropbox (attachment picker) | Built | Dropbox app registered once | **Built** (076) | The picker is not an AI tool |
| Notion | MCP | Registers itself | 1 (first MCP app) | |
| GitHub | MCP | App registered once; personal token also | 1 (first MCP app) | Answers "what is the status of this PR?" |
| Supabase | MCP | Registers itself | 2 | |
| Upwork | MCP | Registers itself, to confirm | 2 | |
| Wispr Flow | MCP | Registers itself, to confirm | 2 | Meeting notes and transcripts (Notetaker), not dictation |
| Dropbox (files, for AI) | MCP | Registers itself, to confirm | 2 | |
| HubSpot | MCP | "MCP auth app" registered once | 2 | |
| Canva | MCP | Developer-portal app registered once | 2 | |
| Outlook (mail, calendar) | Built (Microsoft Graph) | Microsoft app registered once | 3 | Microsoft's MCP servers are a preview and need a Copilot licence |
| Shopify | Decided last | — | 3 | Optional |

Dropped from the first stage:
- **ClickUp:** its MCP server admits only approved clients, and ClickUp competes with AlianHub.
- **Figma:** its MCP server admits only approved clients. People reach Figma from their own Claude, Cursor or ChatGPT, which Figma admits; AlianHub's chat and agents cannot.

Either returns as one catalog entry if it admits AlianHub.

## 3. Decisions

### From v1.1 (owner, 2026-10-23), with the v2 changes noted

1. **Personal only.** A connection is owned by one person and used only on that person's behalf. No workspace-owned or shared connections.
2. **Accounts per person.** One account per connector per person in the first version. The data model is keyed by connection id, so several accounts per person can be switched on later with an account picker and little else.
3. **OAuth apps: instance default + company override.** The instance sets each provider's client id and secret in `.env`; a workspace owner or admin may register the company's own app, which then wins for that workspace. *v2: on a hosted instance the shared sign-in service takes the place of the instance default (decision 21).*
4. **Used by both** AlianHub's built-in agent runs **and** the person's own Claude or ChatGPT through AlianHub's MCP server. *v2: and the AI chat (decision 24).*
5. **Every write to an outside service needs approval**, at every autonomy level, tainted run or not.
6. **Tracking covers:** an audit row for every call, connection health and status, usage counts and limits, and an admin overview.
7. **Tools first, sync later.** Background sync into AlianHub is a later decision per connector.
8. **Slack moves to personal OAuth.** The workspace bot token, signing secret, channel allow-list and decision 3 of task 046 are retired. *v2: through Slack's MCP server (decision 18).*
9. **GitHub moves to personal, on demand.** Pull requests are looked up and linked when a member or their AI asks. The workspace sign-in and the background PR → task sync of task 049 are retired. *v2: through GitHub's MCP server.*
10. **Google is one connection per Google account** with products ticked (Gmail, Drive, Meet, Calendar); only ticked products' scopes are asked for, more added later by incremental consent.
11. ~~Google is the pilot.~~ *Replaced by decision 27.*
12. **Wispr Flow: research decides.** *Settled: Wispr Flow's MCP server (meeting notes and transcripts).*
13. **MCP writes are approved in the AlianHub Inbox**, as proposals only the connection's owner approves, the way held MCP calls already work. Never inline in the AI client.
14. **Usage limits.** Defaults per person: 500 reads and 50 write proposals a day across their connections; per agent: 200 reads a day. A workspace owner or admin may change them for the workspace, a member or an agent, up to a ceiling the instance admin sets in `.env`. *v2: the AI chat counts against the asker's own limits.*
15. **Gmail is not in the Google pilot.** Gmail's supported production path is a company's own Internal Google app through the company override; Gmail on the Alian-hosted instance waits for the owner's decision on Google verification and the yearly CASA assessment, made later from lab quotes.
16. **The Drive/Dropbox attachment picker joins the module.** It uses the person's Google connection (Drive ticked) and a Dropbox provider, with the instance or company app instead of an app per person. A person's connection is never usable by anyone else; the shared OAuth app gives nobody access to anyone's account.
17. ~~Connector order after Google: easiest first, by the research.~~ *Replaced by the phases in §11.*

### New in v2.0 (owner, 2026-11-12)

18. **MCP first.** AlianHub reaches an app through the app's own remote MCP server whenever that server admits AlianHub, and through a connector built against the app's API only where it does not. Both sit behind the same catalog, connections, approvals and tracking. Moving an app from built to MCP changes its catalog entry only.
19. **First-stage apps** are the twelve in §2. ClickUp and Figma are dropped.
20. **AlianHub's own tool names stay fixed.** Each catalog entry maps AlianHub's names (for example `github.pull_request.read`) to the provider's tools and holds the allow-list of tools offered, each marked read or write. AlianHub decides read or write; a server's own hints are never trusted. A provider tool that is new, or whose shape changed since it was reviewed, stays hidden until an owner or admin turns it on. Agents, the AI chat and skills use only AlianHub's names, so a provider renaming a tool, or an app moving from built to MCP, breaks none of them.
21. **Hosted instances share one sign-in address.** Alian registers each app that needs a registered app once, with one callback on an Alian-owned address (for example `connect.alianhub.com`). The service forwards each sign-in to the instance named in the signed state. It exchanges codes and refreshes tokens with the app secret, which never leaves it, and it stores no tokens; instances store their members' tokens. Self-hosted installs register their own app once per app (the screen shows the callback to copy), use a personal token where the app offers one, or use apps that register themselves. A company that wants its own brand on the consent screen registers its own app (decision 3). The service is built in the alianhub-cloud repo.
22. **Personal tokens** are a sign-in kind where an app offers them (GitHub, custom servers): each member pastes their own, and it is kept and used like an OAuth token. *Proposed during planning and accepted with the plan on 2026-11-12; confirm at review.*
23. **Custom MCP servers.** A person holding the new "Add custom apps" right (owners and admins by default) adds an MCP server by its address for the workspace; each member connects their own account to it. Every tool starts hidden until that person or an owner/admin turns it on and marks it read or write. Hosted plans may switch it on per plan; an instance admin may switch it off.
24. **The AI chat uses connectors.** Ask is the third user of connectors, next to agents and the person's own AI. It reads only through the asker's own connections; anything it would change outside AlianHub becomes an Inbox proposal.
25. **Naming a connector uses it.** In the AI chat, `@` offers the asker's connectors next to projects, lists, tasks, docs and people. Typing a connected app's name (for example "GitHub") adds it as a chip the asker can remove before sending. A link or reference an app owns (a pull request link, `owner/repo#123`) is read the same way.
26. **One Connectors screen, like Claude's.** AI → Customize → Connectors: the person's connectors, a browsable list of available ones with Connect, "Add custom connector", and a detail panel per connector. It replaces the connector parts of the Integrations hub and the Connections, App connections, Google and Slack pages. Integrations that are not connectors (email to task, automations, webhooks, Zapier, the Slack slash command) stay on the Integrations page.
27. **The first MCP apps are Notion and GitHub.** Notion proves an app that registers itself; GitHub proves a registered app and the hosted sign-in service, and answers "what is the status of this PR?". Google, the v1 pilot, is already built and stays a built connector.
28. **Agents choose their connectors.** An agent uses only the connectors ticked on its settings, through the connection of the person it runs for. A skill declares the connector reads it needs, as it declares an outside read today.
29. **What is built stays built.** Google (071), Slack (074) and the Dropbox picker (076) were built on the module before v2 and were checked against the real apps. They are not rebuilt on MCP. Any of them can move to its app's MCP server later by changing its provider definition, once that server admits AlianHub and is generally available.

## 4. Users and roles

| Role | Wants | May |
|---|---|---|
| Member | Their AI to work in their own tools | Connect, use, approve writes from, and disconnect **their own** connections; turn a tool off for their own use |
| Holder of "Add custom apps" | Their team's own tools | Add, review and remove custom MCP servers for the workspace |
| Owner / admin | Oversight and the ability to cut access | See every member's connections (provider, scopes, status, dates, usage), end any of them, set quotas, register the company's OAuth apps, turn on new or changed provider tools. **Never** use a member's connection, read through it, approve its writes or see its tokens |
| Instance admin | Run the product | Set instance-default OAuth apps, `CONNECTORS` and `CONNECTORS_CUSTOM` in `.env` |
| Alian (hosted) | One-click instances on any domain | Run the shared sign-in service; register each hosted app once |
| AI chat (Ask) | Answer with the asker's own data | Read through the asker's own connections; file write proposals |
| Built-in agent | Do work for a person | Call the tools ticked on its settings, on the connection of the person the run works for |
| Person's own AI (MCP client) | Do work for its person | Call tools on the connection of the person behind its token or OAuth grant |
| Guest, API token without the connector scope | — | Nothing |

## 5. User stories

1. As a member, I connect my HubSpot from the Connectors screen and see the account it is, its status and when it was last used.
2. As a member, I tick Drive and Calendar on my Google connection; later I tick Meet and Google asks only for Meet's access.
3. As a member, I ask my Claude (over AlianHub MCP) "find the HubSpot deal for Acme and add the next step to my task", and it reads my HubSpot only.
4. As a member, when an agent wants to post in Slack or create a Notion page, I see exactly what would go out and approve or decline it; nothing is sent before.
5. As a member, I disconnect a connection and the provider is told; no AI can use it again.
6. As an admin, I see which members connected what and can end a connection, for example when a laptop is lost.
7. As an admin, I register our company's own GitHub app so the consent screen shows our name.
8. As an admin, I remove a member and all their connections end at the providers.
9. As an instance admin, I follow one page per app to register its app and switch it on.
10. As a member, I open AI → Customize → Connectors, see my connectors and the available ones, and connect Notion in two clicks with no admin setup.
11. As a member in the AI chat, I type "@GitHub what is the status of PR 482 in acme/web" and the answer cites the pull request, read with my own GitHub.
12. As a member, I type "what changed on my Notion roadmap page this week?" and Notion is added as a chip I can remove before sending.
13. As an admin, I add our internal MCP server by its address and turn on its two read tools; members connect their own accounts to it.
14. As Alian, I bring up a hosted instance on a customer's domain, and its members connect GitHub, Slack and HubSpot with no registration for that domain.
15. As an admin, I see that GitHub's server added a tool, review it, and turn it on as a read.
16. As a member, I tick GitHub on my release agent's settings, and its weekly run reads the merged pull requests through my connection.

## 6. What is built (integration branch `feat/per-user-connectors`, 2026-11-03)

The v1.1 connector module is built and tested on the integration branch, not yet merged into `staging`.

| Area | Where | Task |
|---|---|---|
| Provider definitions and registry, one folder per provider; the two-track contract | `Modules/Connectors/providers/`, `validate.js`, `registry.js`; `063-connectors-provider-definition/resources/contract.md` | 063 |
| Data model: `connector_connections`, `connector_apps`, `connector_usage`, indexes | `utils/mongo-handler/schema.js`, migrations | 064 |
| App lookup (instance default, company override) and the secrets-store guard | `Modules/Connectors/apps.js` | 065 |
| Connect, products, reconnect, disconnect; `resolveConnection` | `Modules/Connectors/connection.js`, `resolveConnection.js` | 066 |
| Member removal and the daily sweep | `Modules/Connectors/sweep.js` | 067 |
| Tool framework: each provider's `tools.js`, loaded for agents and MCP; the runner with caps, taint and egress | `Modules/Connectors/tools.js`, `toolRunner.js` | 068 |
| Write approvals that only the connection's owner can approve | `Modules/Connectors/writes.js` | 069 |
| Audit, health, usage, quotas, rate limits | `callAudit.js`, `health.js`, `usage.js`, `quotas.js`, `rateLimits.js` | 070 |
| Google: Calendar, Meet and Drive tools | `providers/google/` | 071 |
| My connections, admin overview, company apps (components of the Connections page) | `frontend/src/views/Integrations/` | 072 |
| Google Calendar rows moved onto the Google provider | migration `080` | 073 |
| Slack as a personal provider; workspace bot retired | `providers/slack/`, migration `081` | 074 |
| Drive/Dropbox attachment picker on the module | `pickerController.js`, `providers/dropbox/` | 076 |
| Inbox approval cards and quota settings | `frontend/src/views/Inbox/`, `Approvals/` | 078 |

Still open from v1.1:
- 075 (GitHub), 077 and 079 (removing old paths).
- The owner's acceptance of the 061 and 062 research.

Not built, and needed by v2.0:
- **AI chat:** `Modules/AI/ask*.js` finds records and makes one model call, with no tool calling; the model layer (`Modules/AICore/llmProvider`) has none either. Task 087 (active) builds the grouped `@` picker this plan extends.
- **Agents:** a fixed pipeline that calls the model once (`Modules/Agents/engine/orchestrator.js`). Skills declare outside reads with their hosts (`Modules/Agents/skills/externalReads.js`) and already read connectors: the Slack summary seed reads `slack.channel.read`.
- **MCP client:** `@modelcontextprotocol/sdk` 1.30.0 is a dependency, used today only for AlianHub's own MCP server. Its client takes a custom `fetch`, so MCP calls can go through `safeFetch` with the egress allow-list.
- **Hosted link:** each hosted instance knows `PLATFORM_URL` and `INSTANCE_ID`, holds a key shared with the platform, and checks tokens the platform signs (`Modules/Platform`); `Config/hostingMode` tells it it is hosted.

## 7. Functional requirements

### 7.1 Catalog

- **FR-1** *(v2)* A catalog entry is one definition file: id, display name, one-line description, category, logo, kind (`mcp` or `built`), the sign-in kinds it accepts (`self_register`, `registered_app`, `personal_token`), the hosts it calls (for egress), rate-limit signals, and its tools under AlianHub names. An `mcp` entry adds the server address and the allow-list: each AlianHub tool mapped to the provider's tool, marked read or write, with the shape it was reviewed against. A `built` entry adds authorize and token endpoints, PKCE, extra parameters, scopes per product and per tool, account id and label reader, refresh, revoke, and the tool handlers.
- **FR-2** *(v2)* Adding an entry needs no new route, collection, screen or registry file. An entry is offered only when it is named in `CONNECTORS` and can sign in on this install: it registers itself, takes personal tokens, or has an app (company, hosted service or instance default).
- **FR-3** Providers with products (Google) expose them as ticks on one connection; scopes are the union of the ticked products' scopes.

### 7.2 OAuth apps

- **FR-4** Instance defaults from `.env`: `CONNECTOR_<PROVIDER>_CLIENT_ID` and `CONNECTOR_<PROVIDER>_CLIENT_SECRET`. The existing `CONNECTOR_GOOGLE_*` keep working.
- **FR-5** A company override: an owner or admin enters a client id and secret per provider; the secret goes to the secrets store and is never shown again. The override applies to that workspace only and wins over the hosted service and the instance default.
- **FR-6** Each connection records which app issued it. Changing or removing a company app marks that app's connections `reauth_required`; nothing is silently moved to another app.
- **FR-7** *(v2)* The callback is `<APIURL>/api/v1/connector-oauth/<provider>/callback`, never built from a request header, and is shown on the company-app form for copying. A hosted instance signing in through the shared service uses the service's callback instead (FR-48).

### 7.3 Connecting and lifecycle

- **FR-8** Connect uses the existing four steps for every provider: `POST /api/v2/connectors/<provider>/connect` returns the consent address; the public callback hands the code to the page in the URL fragment; the page calls `POST /api/v2/connectors/<provider>/complete` under its own session; only then is the code exchanged. A signed ten-minute state names workspace, person, provider and connection; PKCE (S256) where the provider supports it; the state is used up by the first attempt. *v2: an `mcp` entry first reads the server's published sign-in metadata.*
- **FR-9** Only the scopes the provider actually granted are stored; a tool checks its scope at call time and, when missing, says which product to tick.
- **FR-10** Adding a product asks only for its scopes (incremental consent) on the same connection.
- **FR-11** Reconnecting with the same account replaces tokens; with a different account it revokes the earlier grant (one account per connector per person, decision 2).
- **FR-12** Disconnect revokes at the provider unless another live connection of the same person shares the grant, retires the secrets and closes the row.
- **FR-13** Membership is checked at every use: a guest, a removed or deactivated member, or an unreadable seat gets no token.
- **FR-14** Member removal and deactivation (members screen, SCIM) end every connection of that person; a failure never blocks the removal. A daily sweep ends anything missed.

### 7.4 Credentials

- **FR-15** *(v2)* Access and refresh tokens, personal tokens and self-registration secrets live only in the secrets store under kind `connector`, by handle. No route, log, socket event, audit row or browser ever receives one. One exception: the attachment picker (FR-39) hands the connection's owner, in their own session, a short-lived `drive.file` access token for Google's picker; never a refresh token, never to anyone else.
- **FR-16** The module refuses to switch on without `SECRETS_STORE` and a usable `SECRETS_KEY`, with one startup log line and the reason on the admin screen.
- **FR-17** Tokens are refreshed on use, one attempt; `invalid_grant` (or the provider's equivalent) marks the connection `broken` and notifies the person; other failures fail that one call only.

### 7.5 Tools for AI

- **FR-18** *(v2)* A tool is defined once in its catalog entry under an AlianHub name (`<provider>.<object>.<verb>`, e.g. `hubspot.deal.search`), with label, read or write, required scope (built) or provider tool (mcp), input schema, output shape and caps. From that one definition it is registered in the agent registry, as a tool of AlianHub's own MCP server, and for the AI chat.
- **FR-19** *(v2)* A call uses only the connection of the person it works for: the asker in the AI chat, the person a run works for (who started it or owns the schedule), or the person behind the MCP token or grant. No connection: refused with "connect <app> on Connectors". The one-account rule means no account choice now; the call takes a `connectionId` parameter reserved for several accounts later.
- **FR-20** Reads return text only, capped per read and per run (per-provider defaults, based on `readLimits.js`), and taint the run with kind `connector` and a ref such as `hubspot:<hash of the object id>`. After a connector read the run makes no web fetch.
- **FR-21** Writes are `proposeOnly` at every autonomy level, from every caller. MCP and AI-chat writes are filed as proposals that wait in the AlianHub Inbox (`Modules/Mcp/propose.js`); the reply says so. No write is approved inside the AI client.
- **FR-22** A new gate `connection_owner`: only the person who owns the connection may approve its writes. An owner or admin may not approve on their behalf.
- **FR-23** The approval card shows exactly what will go out (recipient or target, title, the whole text, attachments if any); what is approved is what is sent; an edit is re-validated and shown again. One attempt per approval; the result or error is kept on the proposal.
- **FR-24** Every provider call, MCP calls included, goes through `agentFetch` in the workspace's egress context; the entry's hosts come from its definition, so the "Allow host" prompt names them.
- **FR-25** AlianHub's MCP server exposes connector tools under new scopes `connectors:read` and `connectors:write`, shown on the consent screen of the person's own AI; a token without them does not see the tools.

### 7.6 Tracking

- **FR-26** Audit: one `connector.call` row per call (person, AI chat, agent or MCP client, connection, provider, tool, outcome, counts), never content or ids in clear. Also `connector.connect`, `connector.products_changed`, `connector.broken`, `connector.revoke`, `connector.app_set`, `connector.tool_reviewed`, `connector.server_added`, `connector.server_removed`.
- **FR-27** Health: status (`pending`, `connected`, `broken`, `reauth_required`, `revoked`), token expiry, last used, last error; the person is notified when action is needed.
- **FR-28** Usage: counts per connection, person and agent by day; shown to the person on their connector and to admins on the workspace tab.
- **FR-29** Limits: provider rate limits honoured with backoff and `Retry-After`. Daily quotas with defaults of 500 reads and 50 write proposals per person (across their connections) and 200 reads per agent. An owner or admin sets them for the workspace, a member or an agent, never above the instance ceiling in `.env`. A call over quota is refused with the limit and when it resets. The run's existing spend and daily-run limits apply unchanged.
- **FR-30** Admin overview (on the Connectors screen's Workspace tab, FR-68): per member, each connection's provider, products, scopes, status, connected and last-used dates, usage, and an "End connection" action. Not the account's email or label (the 046 rule), never tokens.

### 7.7 Screens (v1 numbers)

- **FR-31** *(v2)* Replaced by the Connectors screen, FR-63 to FR-67.
- **FR-32** *(v2)* The company OAuth apps list moves to the Workspace tab (FR-68): per provider, which app is in use (instance default, hosted service or company app), the callback to copy, set or replace, remove.
- **FR-33** The approval card per tool kind in the Inbox (FR-23).
- **FR-34** All strings through i18n (`Connectors.*`), all colours from tokens; style and i18n checks pass.

### 7.8 Moving the existing connectors

- **FR-35** Google Calendar rows move into the Google provider as one connection with Calendar ticked; existing grants keep working.
- **FR-36** *(v2)* Slack is a built provider (task 074): each person's own Slack account through the Slack app, with user scopes and token rotation; the workspace bot is retired (migration 081). It may move to Slack's MCP server later by changing its definition (decision 29).
- **FR-37** *(v2)* GitHub is reached through GitHub's MCP server with the caller's own connection. `pull_request.get` becomes `github.pull_request.read`; linking a pull request to a task uses it. The workspace connection, repo-to-project mapping, cron runner and their screens (task 049) are retired with a migration; admins are told before it runs.
- **FR-38** The Slack slash command and the other `integration_connections` catalogue entries are not connectors and stay as they are, on the Integrations page.
- **FR-39** The Drive/Dropbox attachment picker uses the module: Drive through the person's Google connection with Drive ticked (`drive.file`), Dropbox through a built Dropbox picker provider. The per-person app settings go; the instance, hosted or company app is used. Existing `cloud_storage_connections` rows are migrated or the person is asked to reconnect once, and their stored client secrets are deleted.
- **FR-40** A picker token and a file import are available only to the connection's owner, taken from their own session; no route accepts another person's id. A file attached as a link opens for others only as Google or Dropbox sharing allows; a file imported as a copy is stored like an upload and seen by whoever can see the task. Nobody can browse or pick from another person's account.

### 7.9 Sign-in kinds

- **FR-41** Self-registration (dynamic client registration, or a client ID metadata document published at an `<APIURL>` address) happens once per workspace per server, is stored, and is reused by every member of that workspace. Never once per member or per session.
- **FR-42** A personal token is pasted by the member on the connector's sign-in step, checked with one read before it is saved, stored like an OAuth token (FR-15), and never shown again. Disconnect deletes it; the member revokes it at the app.

### 7.10 MCP transport

- **FR-43** AlianHub calls a remote MCP server over Streamable HTTP with the member's token, using the `@modelcontextprotocol/sdk` client with its requests going through `agentFetch` (FR-24). HTTPS only. A local (stdio) server is never started.
- **FR-44** Before a server's tools are offered, AlianHub lists them and compares each with its reviewed shape (a hash of name, description and input schema). A tool that is new or changed is hidden, and the workspace's owners and admins are told; one of them turns it on and marks it read or write (write by default). Catalog entries ship reviewed shapes, and a release refreshes them.
- **FR-45** A model is shown only the description the reviewer accepted, never one fresh from the server; the server's own text is shown to the reviewer as outside content.
- **FR-46** Results are text only, capped and tainted (FR-20), and never followed as instructions.
- **FR-47** A server error, timeout or rate limit fails that one call, with backoff per server (FR-29); it never marks the connection broken unless sign-in itself fails.

### 7.11 Hosted sign-in service

- **FR-48** On a hosted instance (`Config/hostingMode`), an app with no company app signs in through the shared service. The consent request carries the service's callback and a state signed with the instance's platform key, naming instance, connection and a nonce.
- **FR-49** The service checks the signature and looks the instance's address up in the platform's own instance list, never from the request. It then forwards the code to `<instance>/api/v1/connector-oauth/<provider>/callback` in the URL fragment, and the existing complete step follows.
- **FR-50** The instance exchanges codes, refreshes and revokes through the service's server-to-server endpoints, authenticated with its platform key. The service adds the app secret, returns the tokens and stores none. A suspended or deleted instance is refused.
- **FR-51** If the service is unreachable, a sign-in or a call that needs a refresh fails with a clear reason; the connection is not marked broken.

### 7.12 Custom MCP servers

- **FR-52** A person holding "Add custom apps" (a new row in Security & Permissions, `Config/aiRights.js`; owners and admins by default) adds a server by name and address. AlianHub reads its sign-in metadata: if the server registers itself, nothing more is needed; if it needs a registered app, the person enters client id and secret (secret to the secrets store); if it takes personal tokens, each member pastes their own.
- **FR-53** The address must be HTTPS and must not resolve to a private, loopback or link-local address (`safeFetch.js`); its host is added to the workspace egress list on save.
- **FR-54** Every tool starts hidden. The person who added the server, or an owner or admin, turns tools on and marks each read or write; FR-44 applies to every later change.
- **FR-55** `CONNECTORS_CUSTOM=off` turns custom servers off for the install; on hosted, custom servers are a plan feature (`Modules/Entitlements`). Removing a server ends every connection to it.

### 7.13 AI chat

- **FR-56** The AI chat's `@` picker (task 087) gains a Connectors group: the asker's connected apps first, then available ones with Connect, which opens that app's sign-in and returns to the chat. A picked connector is a chip, sent as `{ kind: 'connector', id }`.
- **FR-57** While the asker types, a whole-word match of a connected app's name adds its chip, which the asker can remove before sending. A name they have not connected adds nothing; the answer may suggest connecting it.
- **FR-58** A question with a connector chip gets its reads in one step. Rules come first: a pull request link or `owner/repo#123` goes straight to `github.pull_request.read`. Otherwise one model call returns at most three read calls as JSON. Each is checked against that connector's turned-on read tools and their input schema, run on the asker's connection, and cited in the answer as a source.
- **FR-59** Chat reads are capped, tainted and counted like any other connector read; after a connector read the chat makes no web fetch (FR-20).
- **FR-60** A change asked for in the chat ("comment on that pull request") becomes an Inbox proposal (FR-21), and the answer says so.

### 7.14 Agents

- **FR-61** An agent's settings get a Connectors section: tick which connectors, and which of their turned-on tools, the agent may use. Nothing is ticked by default.
- **FR-62** A skill declares a connector read as a step (AlianHub tool name and arguments), as it declares an outside read today. The run's gather step runs it on the connection of the person the run works for; a missing connection fails that step with "connect <app>".

### 7.15 Connectors screen

- **FR-63** One place: the AI sidebar's **Customize** entry replaces Connections and Connect your AI. It opens Customize with the tabs **Connectors** (default) and **Connect your AI**. The old Connections and App connections routes redirect to it.
- **FR-64** **Your connectors**: each connected app with logo, account label (shown to its owner only), status dot and last used. A connector that needs attention comes first, with Reconnect.
- **FR-65** **Browse**: every available entry as a card with logo, name, one line and category; search and category filter; Connect on the card. An entry this install cannot sign in to says why to members ("Your admin needs to set up Google") and links owners and admins to its setup.
- **FR-66** **Add custom connector** (with the right): name and address, then the sign-in step that server needs, then its tool review list (FR-52, FR-54).
- **FR-67** **Connector detail** (side panel): account, products (Google), status, usage this week, the tools with read/write labels and an on/off per tool for the member's own use, Disconnect. Owners and admins also see new or changed tools to review.
- **FR-68** **Workspace** tab for owners and admins: members' connections (FR-30), company apps with the callback to copy (FR-32), custom servers, and the link to quotas (task 078).

All of 7.15 meets FR-34, works by keyboard and screen reader, and works at phone width.

## 8. Data model

`connector_connections` (evolved, declared in the strict schema):

| Field | Purpose |
|---|---|
| `_id` | the connection id every tool, audit row and proposal names |
| `companyId`, `userId` | owner |
| `provider` or `serverId`, `products[]` | what is connected (`serverId` for a custom server) |
| `kind`, `signIn` | `mcp` or `built`; `self_register`, `registered_app` or `personal_token` |
| `account { id, label }` | the provider's account id and a display label (shown to the owner only) |
| `scopes[]` | as granted |
| `toolsOff[]` | tools the owner turned off for their own use |
| `status`, `lastError`, `brokenAt` | health |
| `app { source: 'instance' \| 'company' \| 'hosted' \| 'registered', appId }` | which app issued it |
| `handles { access, refresh }` | secrets store handles (a personal token is `access`) |
| `accessExpiresAt`, `connectedAt`, `lastUsedAt`, `disconnectedAt`, `disconnectedBy` | dates |
| `oauth { stateHash, verifier, sessionId, origin }` | in-flight connect |
| `backoffUntil` | provider rate limit |

Unique index on (`companyId`, `userId`, `provider`/`serverId`, `account.id`); a partial unique index on (`companyId`, `userId`, `provider`/`serverId`) for live rows enforces one account per connector until decision 2 is lifted.

New:

- `connector_apps`: `companyId`, `provider`, `clientId`, secret handle, set by, dates.
- `connector_usage`: `companyId`, `connectionId`, `userId`, caller (agent, MCP client or AI chat), day, counts; or counters on the row if 064 shows that is enough.
- `connector_registrations`: `companyId`, `provider` or `serverId`, `clientId`, secret handle if any, method (`dcr` or `cimd`), registered at. One per workspace per server.
- `connector_servers`: `companyId`, name, address, sign-in kind, client app (id, secret handle), added by, dates, status.
- `connector_tools`: `companyId`, `provider` or `serverId`, provider tool, AlianHub name, label and description as reviewed, read or write, on/off, shape hash, reviewed by and at. Holds custom servers' tools and each workspace's review of catalog tools that are new or changed.
- On the agent record, `connectors: [{ provider or serverId, tools[] }]`.

Migrations for FR-35 to FR-37 and FR-39, each safe to run twice.

## 9. API surface (sketch)

| Route | Who |
|---|---|
| `GET /api/v2/connectors` | member: catalog entries available on this install with their sign-in state, and own connections |
| `POST /api/v2/connectors/:provider/connect` / `complete` | member |
| `POST /api/v2/connectors/:provider/token` | member: a personal token |
| `PUT /api/v2/connectors/connections/:id/products` | owner of the connection |
| `PUT /api/v2/connectors/connections/:id/tools` | owner of the connection: tools off for own use |
| `DELETE /api/v2/connectors/connections/:id` | owner of the connection, or owner/admin (ends it) |
| `GET /api/v1/connector-oauth/:provider/callback` | public, rate-limited |
| `GET /api/v1/connector-oauth/client-metadata` | public: the client ID metadata document |
| `GET` / `POST` / `PUT` / `DELETE /api/v2/connectors/servers` | holder of "Add custom apps" |
| `PUT /api/v2/connectors/tools/:providerOrServer` | owner/admin or the server's adder: review tools |
| `GET /api/v2/connectors/admin/connections` | owner/admin |
| `PUT` / `DELETE /api/v2/connectors/admin/apps/:provider` | owner/admin |
| `PUT /api/v2/connectors/admin/quotas` | owner/admin |
| `GET /api/v1/ai/ask/mentions` (task 087) | gains the Connectors group |
| Shared sign-in service (alianhub-cloud): `GET /oauth/:provider/callback`, `POST /exchange`, `/refresh`, `/revoke` | public callback; the rest instance-authenticated |

Write routes are wrapped in `agentsRefused`; audit, socket emit and cache clear like sibling routes. `api:doc` runs in the follow-up docs PR (Rule 4).

## 10. Non-functional requirements

- **Security:**
  - Company scoping on every query.
  - Tokens only by handle; least scopes; no token to the browser.
  - State signed, short-lived, single-use and bound to the session.
  - Public callback rate-limited.
  - Egress allow-list respected; private addresses refused.
  - Server tool text treated as outside content.
  - `/security-review` on every PR of this task.
- **Privacy:** no connector content stored outside the run's model call and its replay row (`AI_REPLAY`); audit rows hold hashes, not ids or text.
- **Reliability:** one provider down never affects another; a refresh failure fails one call; the daily sweep is idempotent.
- **Availability:** the shared sign-in service holds no data and runs as at least two copies; Google tokens refresh through it hourly.
- **Maintainability:** an MCP app is data, not code. A provider's tool change shows as a review item, not as a failure, and AlianHub's tool names never change.
- **Testability:** every entry tested against a fake provider or fake MCP server; no real credential needed to merge.
- **Docs:**
  - One setup page per app that needs a registered app, for the self-hosted instance admin (register app, callback, scopes, review needed) and for a company admin (override).
  - None for apps that register themselves.
  - One page on custom servers.
- **Feature flags:** `CONNECTORS=<ids>`; off means no route, tool or screen for that app. `CONNECTORS_CUSTOM` for custom servers.
- **Screens:** i18n and tokens (FR-34), keyboard and screen-reader use, phone width.

## 11. Phases and milestones

| Phase | Output | Done when |
|---|---|---|
| v1.1 module | 061–074, 076, 078, built on `feat/per-user-connectors` | Built; 061 and 062 wait for the owner's acceptance |
| 1 MCP road + first MCP apps | MCP client and MCP providers (092), sign-in for MCP apps (100), hosted sign-in (093), Notion (094), GitHub (075), the AI chat (097), the Connectors screen redesign (101) | On a self-hosted and a hosted instance, a member connects Notion and GitHub from the Connectors screen. The AI chat answers "what is the status of this PR?" from their own GitHub, and their own Claude over AlianHub MCP reads Notion. A write waits in the Inbox, and audit and usage show every call |
| 2 More apps + custom | Supabase, Upwork, Wispr Flow, Dropbox files, HubSpot, Canva (095); custom servers (096); agents (098); old paths removed (077, 079) | Each app passes the acceptance criteria; the old paths are gone |
| 3 Built connectors | Outlook (099); Shopify decided; Gmail when decided | Outlook on the module |

### Sub tasks (2026-11-12)

The two tracks of 2026-10-28 built v1.1; the v2.0 tasks keep the same split. Track A is connections (getting and keeping a person's access); track B is tools (using that access safely).

| Phase | Track | Task | FRs | Depends on | State |
|---|---|---|---|---|---|
| 0 | A | 061 Research: Google, Dropbox | — | — | Written; owner acceptance open |
| 0 | B | 062 Research: new connectors, Gmail | — | — | Written; owner acceptance open |
| v1.1 | A | 063 Contract, provider definition, registry | 1–3 | — | Done |
| v1.1 | A | 064 Data model | §8 | 063 | Done |
| v1.1 | A | 065 App lookup + secrets guard | 4–7, 16 | 063, 064 | Done |
| v1.1 | A | 066 Connect lifecycle | 8–15, 17 | 065 | Done |
| v1.1 | A | 067 Member removal + daily sweep | 14 | 066 | Done |
| v1.1 | B | 068 Tool framework | 9, 18–20, 24, 25 | 063 | Done; one box open |
| v1.1 | B | 069 Write approvals | 21–23 | 068 | Done |
| v1.1 | B | 070 Audit, health, usage, quotas | 26–29 | 063, 068 | Done; one box open |
| v1.1 | B | 071 Google tools | 3, 10 | 068, 069 | Done; real-account check open |
| v1.1 | A | 072 Connection screens | 30–32, 34 | 066 | Done |
| v1.1 | A | 073 Google Calendar migration | 35 | 064, 066 | Done |
| v1.1 | B | 074 Slack personal | 36 | 069, 070, 078 | Done |
| v1.1 | A | 076 Attachment picker | 39, 40 | 066, 072 | Done |
| v1.1 | B | 078 Approval cards, quota settings | 23, 29, 33, 34 | 069, 070 | Done; one box open |
| 1 | B | 092 MCP client and MCP provider definitions | 1, 43–47 | 063, 068 | Built; every tool waits for its shape to be pinned |
| 1 | A | 100 Sign-in for MCP apps: discovery, self-registration, personal tokens | 8, 41, 42 | 066, 092 | Built |
| 1 | A | 093 Hosted sign-in, instance side | 48–51 | 065, 066 | Built; the service itself is open in alianhub-cloud |
| 1 | A | 094 Notion, the first app that registers itself | 41 | 092, 100 | Built; real-account check and pinning open |
| 1 | B | 075 GitHub, the first registered MCP app | 37, 42 | 092, 093, 100 | Built; real-account check and pinning open |
| 1 | B | 097 Connectors in the AI chat | 56–60 | 075, 087, 092 | Built |
| 1 | A | 101 Connectors screen redesign (Customize → Connectors) | 63–68 | 072 | Built; phone and keyboard pass, usage this week open |
| 2 | B | 095 Supabase, Upwork, Wispr Flow, Dropbox files, HubSpot, Canva | — | 075, 093, 094 | Built; real-account checks and pinning open |
| 2 | A | 096 Custom MCP servers | 52–55, 66 | 092, 100, 101 | Built; hosted plan gating open |
| 2 | B | 098 Agents use connectors | 61, 62 | 068 | Built |
| 2 | B | 079 Remove old Slack bot + GitHub sync paths | 38 | 074, 075 | Slack half built; GitHub half waits for 075 |
| 2 | A | 077 Remove old Calendar + CloudStorage paths; setup pages | — | 073, 076 | Built |
| 3 | B | 099 Outlook built connector | — | 068, 069, 093 | Built; real-account check open |

**Cloud work:** the shared sign-in service is built and tracked in the alianhub-cloud repo (`docs/tasks/connector-sign-in/`, created with its PR), against the contract task 093 writes.

**Shared checks, owned by this task:**
- A joint end-to-end test after Phase 1, on a self-hosted and a hosted instance: Notion and GitHub connected from the screen; the AI chat, an agent run and MCP read them; a write proposed.
- The same test again after Phases 2 and 3, for every app on the module.

Shopify and Gmail tasks are created once their decisions are made.

## 12. Out of scope

- Workspace-owned or shared connections.
- Background sync for any connector (later, per connector).
- Writes to outside services without approval; sending Gmail (drafts at most).
- Gmail in the first stage.
- Several accounts per person in the screens (the data model allows it).
- The integration catalogue (slash command, webhooks, Zapier, iframe).
- ClickUp and Figma (dropped, decision 19).
- Custom servers that sign nobody in; local (stdio) MCP servers.
- A tool-calling loop in the AI chat beyond the one pick step of FR-58 (later).
- A per-chat connectors menu in the chat composer (later).
- The shared sign-in service for self-hosted installs (a later option; it would put Alian in their sign-in path).

## 13. Acceptance criteria

- [ ] The research matrix has a confirmed row for every first-stage app, and the owner accepts it and the allow-lists.
- [ ] A new MCP app is added by one catalog entry with no code, route, collection or screen; a new built app by one entry plus its tool handlers.
- [ ] Two people in one workspace connect the same app with different accounts. Each person's AI chat, built-in runs and MCP client reach only their own account, and a person with no connection is refused with a clear reason.
- [ ] Notion connects on a fresh install with no setup, and registers once per workspace, not per member or session.
- [ ] A hosted instance on a new custom domain connects GitHub, Slack and HubSpot with nothing registered for that domain. The app secrets exist only in the sign-in service, and a suspended instance is refused.
- [ ] A provider tool that is new or changed stays hidden until reviewed; AlianHub's tool names never change.
- [ ] No route, log, socket event or audit row contains a token or client secret (asserted in tests); nothing switches on without the secrets store.
- [ ] Every outside write, from any caller, becomes a proposal only the connection's owner can approve; an admin's approval is refused; what is sent equals what was approved.
- [ ] Every call writes one audit row; usage counts match the calls; a quota stops calls with a clear reason; an admin cannot set a quota above the instance ceiling.
- [ ] In the AI chat, `@GitHub` and typing "GitHub" both add the chip; a pull request link is read through the asker's GitHub and cited; a requested change lands in the Inbox.
- [ ] An agent uses only the connectors ticked on its settings, through the connection of the person it runs for.
- [ ] A custom server can be added only with the right, only at a public HTTPS address, and its tools stay hidden until turned on.
- [ ] The Connectors screen replaces the old pages; every lifecycle action works from it by keyboard, at phone width, with i18n and style checks passing.
- [ ] The attachment picker works from a person's module connection with no per-person app. Another person's session cannot get a picker token or import through it, and disconnecting revokes at the provider.
- [ ] An admin sees members' connections, scopes, status and usage and can end one, but no route lets them use it.
- [ ] Removing or deactivating a member revokes their connections at the provider and clears their secrets; the sweep catches a removal made while the provider was off.
- [ ] A company OAuth app replaces the hosted service or instance default for that workspace only; replacing it marks its connections for reconnect.
- [ ] Google Calendar, Slack, GitHub and the attachment picker run on the module; the old paths are gone, with migrations that are safe to run twice.
- [ ] Every entry is tested against a fake provider or fake MCP server; i18n, style and API-doc checks pass.

## 14. Open questions

1. **Gmail on the Alian-hosted instance:** fund Google verification and the yearly CASA assessment, or not. The owner decides from current lab quotes (062).
2. **Slack listing:** if Slack's MCP server admits only Marketplace-listed apps, Slack waits for the listing (061 confirms).
3. **Shopify:** in or out, decided from 062's facts.

## 15. Risks

- **Provider review and listing:** Google's review for Calendar and Drive scopes, a possible Slack Marketplace listing, and HubSpot and Canva app approval can hold an app back regardless of the build; 061 starts them in Phase 0.
- **Servers that close to AlianHub:** an app may add an approved-client list as ClickUp and Figma did. Its entry then falls back to built or is removed.
- **Preview servers:** Google and Microsoft MCP servers are previews; AlianHub stays on built connectors for them until they are generally available.
- **Provider tool changes:** a changed tool goes quiet until reviewed (FR-44). This is safe but visible, so admins are told at once.
- **The shared sign-in service** sits in the sign-in and Google-refresh path of every hosted instance; an outage stops new connections and Google refreshes.
- **Tool poisoning** through a custom or compromised server: reviewed descriptions only, taint, caps, no web fetch after a read, and approval for every write.
- **Gmail for personal accounts:** until the hosted app is verified, people on personal @gmail.com addresses on the hosted instance have no Gmail connector.
- **Picker migration:** members who used the old picker must reconnect once if their grant cannot be carried over.
- **Losing GitHub sync:** retiring task 049's automatic PR linking is a visible change; admins are told before migration.
- **Slack user tokens** reach everything the person can see in Slack; reads stay capped and tainted, and writes approved.
- **Prompt injection** through connector content (mail, Slack, CRM notes): taint, no web fetch after a read, and approval for every write; no tool may bypass them.
