# Progress: Connectors — Outlook built connector on Microsoft Graph: mail and calendar

## Checklist
- [x] Outlook entry and Microsoft sign-in
- [x] Mail and calendar read tools
- [x] Draft and event proposals
- [ ] Shared-service app; setup page (setup page done: `docs/connectors/outlook.md`; Alian's app on the shared sign-in service waits on 093)
- [x] Fake Graph server and tests

## Last step
Built on `feat/connectors-outlook` from `02cd81e8f` (the MCP road on the connector integration branch). Not pushed. Open: the AI chat road, Alian's shared-service app, and a check against a real Microsoft tenant.

## Blockers
- The AI chat does not call connector tools on this base yet, so "from the AI chat" cannot be shown here; agent runs and MCP can.
- Alian's own Entra app on the shared sign-in service waits on 093 (decision 21).

## Decisions
- **Mail asks `Mail.ReadWrite`, not `Mail.Read`.** Graph's `createReply` and `createReplyAll` need `Mail.ReadWrite` at the least ("Not available" for anything lower), and the research matrix's `Mail.Read` covers reading only. A product is ticked whole, so the mail product asks `Mail.ReadWrite` alone; it includes reading and does not allow sending. `Mail.Send` is never asked for, so AlianHub cannot send mail at all.
- **Calendar asks `Calendars.ReadWrite`**, as in the matrix: reading and creating events.
- **Base scopes are `openid`, `profile` and `offline_access`.** `offline_access` gives the refresh token. `openid` and `profile` give an id token with `tid` and `oid`, which name the account. `User.Read` from the matrix is left out: nothing calls `/me`, so it would be a permission nobody uses.
- **The account is `tid:oid`** from the id token, labelled with `preferred_username` (or `email`, or `name`). `sub` differs per app, so a workspace's own app and the instance app would see one person as two accounts.
- **Granted scopes are stored in the form the tools name.** Microsoft can answer a Graph scope as a full `https://graph.microsoft.com/…` address, in the case it was consented in, or URL-encoded. The definition's `tokenAnswer` turns each into the short form (`Mail.ReadWrite`), so the scope check in the tool runner holds. No shared file changed for this.
- **No revoke endpoint.** Microsoft has none per app. Disconnect retires the tokens and closes the row; the setup page tells the person where to remove the app from their account.
- **`deadGrantErrors` are `invalid_grant` and `interaction_required`.** A refresh that answers `interaction_required` (new MFA rule, password change) can only be fixed by signing in again, so the connection is marked broken and the person is told.
- **The reply is a draft, never sent.** `outlook.mail.reply.draft` calls `createReply` (or `createReplyAll` when asked) with the text as the comment. Graph reads the comment as HTML, so the text is escaped and its line breaks become `<br>`: the draft holds exactly the words on the card, and no image or link markup the model writes can ride in. Graph keeps the quoted message below it.
- **An event invites nobody.** Graph sends invitations as soon as an event with attendees is created, and has no switch to stop that (Google has `sendUpdates=none`). So `outlook.calendar.events.create` has no attendees field, and the card says "Attendees: Nobody". The person invites from Outlook.
- **Events take ISO times with an offset only**, sent to Graph in UTC. All-day events are left out: Outlook stores them at midnight in a named time zone, the tools cannot read the person's own zone without another permission (`MailboxSettings.Read`), and an all-day event set in UTC can show across two days for someone outside UTC. A later change can add them with a time zone input.
- **Reads are text only, capped.** Search: at most 25 messages, 8,000 characters, a 200-character preview each. Read: one message, 12,000 characters; an HTML body loses its head, style, script, comments, tags, images and links, and its entities are decoded. Calendar: at most 50 events, 8,000 characters, times in UTC, default window now to 7 days ahead.
- **Tool names** (decision 20): `outlook.mail.search`, `outlook.mail.read`, `outlook.calendar.events.list`, `outlook.mail.reply.draft`, `outlook.calendar.events.create`. A later move to Microsoft's MCP servers maps these to its tools.
- **Admin consent.** Microsoft answers `access_denied` both when a person declines and when their organisation lets only an admin approve apps (AADSTS65004 from the admin consent workflow). The Connections page now answers `access_denied` and `consent_required` with "ask an admin to approve AlianHub for {provider}", for every provider. The setup page gives the admin two ways to grant consent.
- **`CONNECTORS=outlook`** is a known connector (`flag.js`), so the boot log says it is on or why it is off, the company-app routes exist with only `outlook` named, and a missing instance app is logged like Slack's.

## To check against a real tenant
- That Graph renders the escaped comment with its line breaks (community reports say the comment is HTML; Microsoft's page does not say).
- That a work account in a tenant with user consent off comes back with `access_denied`, and the page shows the admin message.
- The scope string Microsoft answers for a personal account.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decisions 18, 19). Track B.
- Built the provider (`Modules/Connectors/providers/outlook/index.js`) and its five tools (`tools.js`): three reads and two propose-only writes, each with its approval card and editable fields.
- `flag.js`: `outlook` added to the known connectors, its boot line, and `CONNECTOR_OUTLOOK_CLIENT_ID` / `_SECRET` as the instance app (logged when missing, like Slack's). `env-doc.meta.json` describes both and `CONNECTORS` names outlook; `.env.example` and `docs/ENV.md` regenerated (the regeneration also picked up the 076 Google picker settings that were missing from them).
- i18n: `Connectors.tool.*`, `Connectors.card.*`, `Connectors.conn.provider_outlook`, `product_mail`, `return_consent` and five `AgentActions` labels in `en.js`; backfilled to every locale.
- `MyConnections.vue`: a return with `access_denied` or `consent_required` names the admin route.
- Setup page `docs/connectors/outlook.md`: Entra app (multi-tenant and personal accounts), redirect URI, permissions, admin consent, publisher verification, env, disconnect, limits.
- Fake Microsoft (`tests/fixtures/fakeMicrosoft.js`): token endpoint with client, redirect and PKCE checks, refresh rotation and dead grants; Graph mail search, inbox, read, createReply/createReplyAll, calendarView and event create; anything that would send lands in `sent`, which the tests expect empty.
- Tests: `tests/connector-outlook-tools.test.js` (62) and `tests/connector-outlook-connection.test.js` (16), all passing; `frontend/tests/unit/myConnections.spec.js` 9 (2 new). Every `tests/connector-*` and `tests/connectors-*` suite: 22 suites, 594 tests pass. Every `tests/agent-*` and `tests/mcp-*` suite: 203 suites, 7,400 tests pass. Conventions: 30 suites, 477 of 478 tests pass; the one failure is plain-words "baseline is stored sorted" (CRLF on this machine). `mcp-tool-scopes` now names outlook in `CONNECTORS`, and `agent-rest-route-actions` lists the two Outlook writes among the changes with no web route, like Google's. `npm run i18n:check` and `npm run style:check` pass.
