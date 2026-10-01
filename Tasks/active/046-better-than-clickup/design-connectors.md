# Design: Gmail, Google Calendar and Slack connectors, and two-way calendar sync

Task 046, tracks A4 ("Agent connectors, one at a time") and A3 ("Two-way calendar sync"). Tracker AP-441.
A survey of what exists and a design. No product code is in this change.

Anything said about Google's or Slack's consoles, scopes or policies is **from memory, as of 2026; check on screen**. Nobody opened those sites to write this.

## 1. What already works and what is missing

| Connector | Capability | Today | Missing |
|---|---|---|---|
| Gmail | Read mail | Nothing. `Modules/EmailIn` is the other direction: a public inbound address turns a mail into a task | Per-person connection, a reader, taint |
| Gmail | Draft | Nothing | A propose-only action and its approval card |
| Google Calendar | Read events | Nothing. The catalogue entry `google_calendar` (`Modules/Integrations/helpers/integrationsRules.js`) stores a client id and secret per workspace and no code reads them | Per-person connection, a reader |
| Google Calendar | Create and update events | Nothing | Propose-only actions |
| Google Calendar | Two-way sync of task dates | One way only: a read-only iCal feed per person (`Modules/Calendar`), all-day events from `DueDate`, at most 1000 tasks, link token stored hashed, visibility decided at read time | Everything two-way |
| Slack | Read a channel | Nothing | A bot token, a reader, taint |
| Slack | Post a message | Nothing from an agent. A slash command (`/api/v1/slack/command/:companyId`, verified by the old verification token) answers `help` and `projects`. Outbound webhooks can format a payload for a Slack incoming-webhook URL (`Modules/Webhooks`) | A propose-only action |

Other findings the design rests on:

- **Two connection models exist.** `integration_connections` is per workspace, written by owners and admins only, secrets redacted on every read (`Modules/Integrations/controller.js`). `cloud_storage_connections` is per person: one row per person and provider, refresh token encrypted, the browser never receives it, a signed ten-minute `state`, a public rate-limited callback outside the JWT prefixes (`Modules/CloudStorage`). The second is the precedent for Gmail and Calendar.
- **Secrets.** With `SECRETS_STORE` on, a secret lives in a per-company store by handle, sealed with AES-256-GCM under `SECRETS_KEY`, bound to its company and handle; `resolve` is server-internal and is the only path that yields a value; create, rotate, revoke and failed lookups are audited; `SECRETS_KEY_PREVIOUS` plus `npm run secrets:reencrypt` rotate the key (`Config/secrets.js`). Owners and admins see name, kind, key id and dates and can rotate or revoke (`Modules/Secrets`), never the value. With the store off, secrets are sealed on their own rows under a key derived from `CLOUD_STORAGE_ENC_KEY` or `JWT_SECRET` (`utils/secretField.js`).
- **Agents.** Every action is a row in `Modules/Agents/registry.js`; an action that is not there does not exist. `proposeOnly` actions are refused unless they come through an approved proposal. `policy.js` decides act, propose or refuse without a model. `proposals.js` stores the exact change list and applies it through `actions.perform` as the agent, checked against the permissions of the person behind it. Gate today: `owner_admin` only. Readers (`skills/readers.js`) return `taint: [{ kind, ref }]`. `taint.js` marks a run and keeps where content came from, never the content. Model spend is capped per run and per month (`spendGuard.js`, `budget.js`), runs per day by `dailyRunLimit.js`. Agent fetches go through `engine/agentFetch.js` and, with `AGENT_EGRESS_ALLOWLIST`, the workspace's host list.
- **What taint routing does and does not do.** With `AGENT_TAINT_ROUTING` on, a tainted run proposes its risky writes (not reversible, wider than a task, money) and any write outside its own project. A reversible write to a task in its own project still happens without approval. The connectors must not depend on that gap staying harmless.
- **Environment variables** (`scripts/env-doc.meta.json`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_URL` and `VUE_APP_GOOGLE_CLIENT_ID` all serve Google sign-in. There is no Slack variable and no redirect-URI variable; callbacks are built from `APIURL`.
- **Screens.** `IntegrationsHub.vue` holds inbound mail, the iCal feed, rules and the catalogue. `ConnectionsPage.vue` lists live catalogue connections, this product's own MCP server and agent tokens. `ExternalData.vue` shows sources, the MCP tool list and recent agent hand-offs. Two lines of copy on Connections (`Parity.grant_slack`, `Parity.grant_calendar`) describe reading events and posting digests, which nothing does yet; they become true or are reworded in the slice that touches them.
- **Nothing reacts to a member leaving.** The iCal feed re-checks membership on every read instead. Connectors need both.

## 2. The connection model

| Connector | Held by | Why |
|---|---|---|
| Gmail | The person | A mailbox is one person's. Nobody else, whatever their role, reads or drafts through it |
| Google Calendar | The person | Same. Sync writes that person's own assigned tasks to their own calendar |
| Slack | The workspace, connected by an owner or admin | A channel is shared. One bot, limited to the channels an admin lists on the connection and the bot has been invited to |

**Where tokens live.** A new company-scoped collection `connector_connections`, one row per person and connector (or one workspace row for Slack): provider, `userId`, granted scopes, status (`connected`, `reauth_required`, `revoked`), dates, and a handle. The refresh token (or Slack bot token) lives only in the secrets store under a new kind `connector`. Connectors refuse to switch on without `SECRETS_STORE` and `SECRETS_KEY`, as `TENANT_PROVIDER_KEYS` does. Access tokens are fetched when needed and never stored. A `connector` secret can be revoked from the stored-secrets screen and cannot be rotated by hand, so nobody can swap another token in under someone's name.

**The OAuth app.** One Google OAuth client per instance, in `.env`, separate from the sign-in client: the sign-in exchange answers to the browser by design, and connector tokens must never leave the server. Flow: authorization code with PKCE, a signed ten-minute `state` naming company, person and connector, `access_type=offline`, `prompt=consent`, a public rate-limited callback at `/api/v1/connector-oauth/google/callback`.

**Least scopes** (exact strings; the consent for each connector asks only for its own):

| Connector | Scope | Used for |
|---|---|---|
| Gmail | `https://www.googleapis.com/auth/gmail.readonly` | search and read threads |
| Gmail | `https://www.googleapis.com/auth/gmail.compose` | create a draft. Gmail has no draft-only scope and this one can also send, so the product ships no send call at all |
| Calendar sync | `https://www.googleapis.com/auth/calendar.app.created` | a calendar the product creates ("AlianHub tasks") and the events on it. The person's own events are out of reach |
| Calendar agent read | `https://www.googleapis.com/auth/calendar.events.readonly` | read events |
| Calendar agent write | `https://www.googleapis.com/auth/calendar.events.owned` | create and update events on calendars the person owns. If the console does not offer it, `calendar.events` |
| Both | `openid`, `email` | label the connection with the account it belongs to |
| Slack (bot) | `channels:history`, `channels:read`, `chat:write` | read public channels the bot is in, resolve channel names, post where the bot is a member. Not `chat:write.public`, no private channels, no user token |

**Refresh and revoke.** On `invalid_grant` the row goes to `reauth_required`, the person is told, and a run that needs it fails with that reason. Disconnect retires the secret and revokes at Google only when it is the person's last Google connector, because revoking one token ends the whole grant. Slack bot tokens do not expire while token rotation is left off.

**When the person leaves the workspace.** Membership is re-checked at every use, as the iCal feed does, so a removed member's connection is dead at once. A hook on member removal and a daily sweep then stop sync, revoke the grant, retire the secret and decline that person's pending connector proposals.

**What an owner or admin sees.** That a person has a connection, which connector, which scopes, when it was connected and last used, and the audit rows (`connector.connect`, `connector.revoke`, `connector.call` with the action and a hashed id). They can revoke it. They cannot use it, read through it, see the account's mail or events, or approve a proposal that sends from it. Nobody sees a token.

## 3. The agent rules

| Action | Kind | Rule |
|---|---|---|
| `gmail.search`, `gmail.thread.read` | read of outside content | Allowed. Taints the run |
| `gcal.events.list` | read of outside content (invites are written by strangers) | Allowed. Taints the run |
| `slack.channel.read` | read of outside content | Allowed. Taints the run |
| `gmail.draft.create` | writes outside the workspace | Propose-only |
| `gcal.event.create`, `gcal.event.update` | sends an invite when it has attendees | Propose-only |
| `slack.message.post` | sends to people | Propose-only |
| Gmail send | | Absent from the registry and added to the never-list |

- **Nothing that leaves the workspace is done by an agent alone, at any autonomy level and whether or not the run is tainted.** The actions are `proposeOnly`, which `registry.evaluate` and `policy.decide` already enforce.
- **The approval card shows exactly what will go out:** for mail, To, Cc, subject and the whole body; for an event, title, time, attendees and whether Google will mail them; for Slack, the channel and the whole text. What is approved is what is sent: the stored change list is applied as stored, and an edit by the approver is re-validated and shown again.
- **Who may approve.** A new gate `connection_owner`: only the person whose mailbox or calendar it is. Not an owner or admin on their behalf. Slack posts keep the existing rules, limited to the admin's channel list.
- **Whose connection a run uses.** Only that of the person the run works for (who started it, or who owns the schedule). No connection, no action, with a reason that says so.
- **Taint.** A new kind `connector`, with a ref such as `gmail:<hash of the message id>` or `slack:<channel id>`; content is never stored. The existing routing then sends the run's risky and out-of-project writes to approval with the taint named in the reason, and the proposal carries the sources (`taint.forProposal`). Two additions: connectors do not register unless `AGENT_TAINT_ROUTING` is on; and a run tainted by a connector makes no further web fetch, because a URL can carry what it just read to a stranger.
- **Limits.** Per run: a cap on connector calls and on the text taken into context; text only, no attachments. Daily run limits and spend caps apply unchanged.

## 4. Two-way calendar sync

Not an agent feature. Per person, opt-in, into the one calendar the product created.

| Task | Event |
|---|---|
| `[TaskKey] TaskName` | summary |
| `startDate` to `DueDate` (`DueDate` alone when there is no start) | an all-day event, in the person's time zone |
| a link back to the task | description. Nothing else: no task description, comments, files, custom fields or other people's names |
| task id and the revision last pushed | private extended properties |

- **Which tasks.** Assigned to the person, with a due date, in projects they can list, minus hidden sprints: the iCal feed's rule (`readableProjectIds`, `hiddenSprintFilter`), evaluated at every sync. A task that stops qualifying loses its event.
- **Back from Google.** Only a date change. It is applied as that person through the normal task update, with the due-date and start-date permissions checked, socket events emitted and the history naming Google Calendar. A title edited in Google is overwritten on the next push. Deleting an event never deletes or changes a task; the event returns on the next change.
- **Conflict rule.** If the task's dates changed in AlianHub since the last push, AlianHub wins and pushes again. Otherwise the calendar change is applied.
- **Loop prevention.** The link row keeps the etag and dates of our last write. An incoming event with that etag or those dates is skipped. Writes made by sync carry a sync actor that the outbound side ignores.
- **Change detection.** Incremental polling with Google's sync token on a job, which works on localhost. Push channels are added later for production only, since they need a public HTTPS address.
- **Never synced.** Tasks in private lists, including the person's own in the first version; tasks the person cannot open; anything from another workspace; events the person adds to that calendar themselves (they never become tasks).
- **Failure states, each shown on the person's connection:** reconnect needed (token refused; weekly while the Google app is in testing); calendar deleted (recreated once, then paused); quota or rate limit (back off, retry); sync token expired (full resync); permission lost on a task (event removed); member removed (sync stops, grant revoked).

New collections: `connector_connections` (above, with the calendar id and sync token for a calendar row) and `calendar_sync_links` (person, task, event id, etag, pushed dates). Both declared in `utils/mongo-handler/schema.js`, since strict schemas drop anything else.

## 5. What the owner must do before the first connector can be tested

**Secrets rule.** The Google client secret, the Slack bot token, the Slack signing secret and `SECRETS_KEY` are secrets. You type them yourself: the Google secret and `SECRETS_KEY` into `.env`, the Slack values into the Integrations screen. Never into the repository, a task, a pull request or a chat, and never to an agent. A client id is not a secret.

**A. In `.env`, once**

1. `SECRETS_STORE=true` and `SECRETS_KEY=` a random value of at least 32 characters that you generate.
2. `AGENT_TAINT_ROUTING=on`.
3. `CONNECTORS=slack` for the first slice; later `slack,google_calendar,gmail`. (New variable, added by slice 1.)
4. Restart the server.

**B. Slack app** (needed for the first slice; from memory, as of 2026; check on screen)

1. Open `api.slack.com/apps`, **Create New App**, **From scratch**. Name it, pick a workspace you can test in.
2. **OAuth & Permissions**, **Bot Token Scopes**: add `channels:history`, `channels:read`, `chat:write`.
3. **Install to Workspace**, allow. No redirect URL is needed for this.
4. In Slack, invite the bot to one test channel: `/invite @<app name>`.
5. In AlianHub, as an owner or admin, open **Integrations & Automation**, **Slack**, and the card **Slack messages from agents**. Next to **Bot token** press **Set**, paste the **Bot User OAuth Token** (starts `xoxb-`) and **Save**. Do the same for **Signing secret** with the value from the Slack app's **Basic Information**, **App Credentials**. Each is checked with Slack, sealed in the secrets store and never shown again.
6. On the same card, under **Channels agents may post to**, tick the test channel and press **Save allowed channels**. A channel marked "the app is not in this channel yet" still needs step 4.
7. Only if you choose an OAuth install instead (decision 3): the redirect URL would be `https://<PRODUCTION-API-HOST>/api/v1/connector-oauth/slack/callback`, Slack accepts HTTPS only so localhost needs a tunnel, and the values go in `.env` as `CONNECTOR_SLACK_CLIENT_ID`, `CONNECTOR_SLACK_CLIENT_SECRET` (secret) and `CONNECTOR_SLACK_SIGNING_SECRET` (secret).

**C. Google OAuth client** (needed from slice 3; from memory, as of 2026; check on screen)

1. Open `console.cloud.google.com` and create a project, for example "AlianHub connectors (dev)".
2. **APIs & Services**, **Library**: enable **Google Calendar API** and **Gmail API**.
3. **Google Auth Platform** (older consoles: **OAuth consent screen**): app name, your support email; **Audience: External**; leave the publishing status at **Testing**.
4. **Audience**, **Test users**: add your own Google account.
5. **Data Access**, **Add or remove scopes**: add the Google scopes from the table in section 2 (`gmail.readonly`, `gmail.compose`, `calendar.app.created`, `calendar.events.readonly`, `calendar.events.owned`, `openid`, `email`).
6. **Clients**, **Create client**, application type **Web application**. Authorised JavaScript origins: none. Authorised redirect URIs, both:
   - `http://localhost:4000/api/v1/connector-oauth/google/callback`
   - `https://<PRODUCTION-API-HOST>/api/v1/connector-oauth/google/callback`
7. Copy the client id and the client secret straight into `.env` as `CONNECTOR_GOOGLE_CLIENT_ID` and `CONNECTOR_GOOGLE_CLIENT_SECRET` (secret). (New variables, added by slice 3. Do not reuse `GOOGLE_CLIENT_ID`.) Restart.
8. Check that `APIURL` is `http://localhost:4000/` locally; the redirect is built from it and must match a listed URI exactly.
9. Expect, while in Testing: a "Google hasn't verified this app" page (continue), at most 100 test users, and a reconnect about every seven days.

## 6. Slices

Each is one pull request. Every one is built and fully tested against a fake provider (a local test server standing in for the provider's API, as the fetch tests already do); no real credential is needed to merge any of them.

| # | Slice | Live check needs |
|---|---|---|
| 1 | **Slack post by approval.** The `CONNECTORS` flag and its preconditions, bot token and signing secret on the Slack connection, the channel list, `slack.message.post` as propose-only, the approval card with channel and exact text. Smallest end-to-end: no OAuth | Steps A and B. First point where you are needed |
| 2 | **Slack read and connector taint.** `slack.channel.read`, the `connector` taint kind, per-run caps, no web fetch after a connector read | Same Slack app |
| 3 | **A person's Google connection.** `connector_connections`, connect, callback and disconnect, state and PKCE, token by handle, "my connections" on the Connections page, membership check at use, revoke on leaving, what an admin sees | Step C and **your Google sign-in**, for the first time |
| 4 | **Calendar, one way.** The product's calendar, link rows, task to event, the visibility rule | Your Google account |
| 5 | **Calendar, two way.** Sync-token polling, dates back to the task, conflict and loop rules, failure states | You drag an event in Google Calendar |
| 6 | **Calendar agent tools.** `gcal.events.list` (taints), create and update as propose-only with the `connection_owner` gate | Your Google account |
| 7 | **Gmail read.** `gmail.search`, `gmail.thread.read`, text only, capped | Your Google account |
| 8 | **Gmail draft by approval.** `gmail.draft.create`, the card with recipients, subject and body | Your Google account |
| 9 | **Production.** Calendar push channels, the slash command moved to the signing secret, Google verification | A public HTTPS host |

## Decisions (2026-10-01)

Taken by the owner; numbers follow section 7.

1. **Gmail's restricted scopes:** left open until slice 7. Slack and Calendar are built first.
2. **Google client:** a separate OAuth client for connectors, never the sign-in client.
3. **Slack:** a bot token pasted per workspace, no OAuth install, and Slack is built first.
4. **Gmail drafts:** always by approval.
5. **Private-list tasks:** never synced to a calendar in the first version, the person's own included.
6. **Web fetch after a connector read:** none.

## Slice 1 as built

- `CONNECTORS=slack` switches it on. It stays off, with one startup log line and the same reasons on the screen, unless `SECRETS_STORE` has a usable `SECRETS_KEY` and `AGENT_TAINT_ROUTING` is on. Off means no route, no registry action and no section on the screen.
- The connection is one row in `connector_connections` (`Modules/Agents/connectors/slackConnection.js`); the bot token and the signing secret are in the secrets store under the kind `connector`, which the stored-secrets screen can revoke and cannot rotate. The signing secret is stored and not used yet: the slash command moves to it in slice 9.
- `slack.message.post` is propose-only with the existing owner-or-admin gate. The channel and the text limits are checked when the proposal is filed and again when it is applied; the proposal keeps the channel id, Slack's name for it and the exact text, and after approval the message timestamp or the error (`delivery`).
- **Internal agents only in this slice.** A data skill emits the action; there is no MCP tool for it and a token cannot file it through the proposals route, so `docs/MCP-AGENT-GUIDE.md` is unchanged.
- The post goes through `engine/agentFetch.js` inside the workspace's egress context. While `AGENT_EGRESS_ALLOWLIST` is on and the workspace has a host list, `slack.com` must be on it.
- One attempt per approval. A token Slack refuses marks the connection broken until it is replaced; a rate limit or an unreachable Slack is recorded and shown, and the message is not sent later on its own. Sending an approved message again needs a new proposal; a "send again" control is a possible follow-up.
- The two lines of copy on the Connections page (`Parity.grant_slack`, `Parity.grant_calendar`) are unchanged: that page lists the slash-command connection, not this one.

## 7. Risks and what to decide

1. **Gmail scopes are restricted.** Outside Testing, Google asks for verification and a yearly security assessment unless the app is Internal to one Google Workspace domain. Decide: Internal only, go through verification, or leave Gmail in Testing for now. Recommended: build Slack and Calendar first, decide before slice 7.
2. **A separate Google client for connectors** (recommended) or reuse the sign-in client.
3. **Slack by pasted bot token per workspace** (recommended: no redirect, works on localhost, fits several companies on one instance) or an OAuth install.
4. **Gmail drafts always by approval** (recommended) or let an untainted run create a draft alone, since the person still presses Send in Gmail.
5. **A person's own private-list tasks on their own calendar:** never in the first version (recommended) or opt-in.
6. **A run that has read a connector makes no further web fetch** (recommended). It blocks "read my mail, then research the web" in one run; the alternative is to rely on the workspace's egress list.
