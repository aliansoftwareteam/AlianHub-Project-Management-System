---
id: 107
title: Connectors — MCP first: live tool lists per connection, per-tool permissions like Claude's, one tool lookup for AI
status: backlog
priority: high
depends_on: [092, 096, 100, 101]
created: 2026-11-17
---

# 107 — Connectors — MCP first: live tool lists per connection, per-tool permissions like Claude's, one tool lookup for AI

Changes the PRD of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`): FR-44 and FR-45 are replaced by the decisions below, and the tools of built-in MCP apps stop being a static catalog.

## Goal
Any app with an MCP server connects to AlianHub the same way, built-in or added by address. Each connection's tools come live from its server. The connection's owner sees each tool and sets its permission, as in Claude's Connectors settings. AI chat and agents get the tools that fit the request through one lookup.

Today the static lists in `Modules/Connectors/providers/*/tools.js` hold placeholder names for every MCP app: all 21 tools are `shape: null`, so none is offered.

## Decisions (2026-11-17)
1. Every connector connects over MCP. An app that cannot is listed and documented as an exception (below).
2. Tools are listed per connection, with that connection's token. No cache for now.
3. A tool the server changed keeps working, with a "changed" warning on its row. Looking at it again clears the warning. Agents skip a changed tool until then; AI chat still uses it.
4. Read or write comes from the server's `readOnlyHint`; with no hint it is write. The connection's owner can change it.
5. Each tool has a permission per connection: **Always allow**, **Needs approval** or **Off**. The connection's owner sets it.
6. Owners and admins can turn an app off for the whole workspace. There is no per-tool admin review.
7. AI asks one method for the connection's usable tools, filtered by kind, app and purpose. No filter by person, since the lists are already per connection. AlianHub's own MCP server keeps its current tool list for now.
9. When a request fits tools from more than one connected app (for example "message the team" with Slack and email both connected, or two apps that can each create the same thing), AI asks the person which app first and filters the tools to that app. It does not pick one itself.
8. A saved agent or skill tick whose tool the server renamed or removed shows as missing in the agent's settings. It is never dropped silently.

## Apps: MCP or exception (checked 2026-11-17)
| App | Today | Official remote MCP server | Plan |
|---|---|---|---|
| Notion, GitHub, Canva, Dropbox, HubSpot, Supabase, Upwork, WisprFlow | MCP (static placeholder tools) | Yes (URLs in each `providers/<id>/index.js`) | Move to live tools |
| Slack | REST OAuth, 3 hand-written tools | Yes: `https://mcp.slack.com/mcp`, GA Feb 2026. Needs a Slack app with MCP turned on. Slack does no self-registration, so it signs in with a registered app's id and secret | Move to MCP. Re-check: AlianHub's own DM and `@channel` guards are lost unless arguments are checked before a call |
| Google (Gmail, Calendar, Drive) | REST OAuth | Yes, but Developer Preview only: `gmailmcp`/`calendarmcp`/`drivemcp.googleapis.com/mcp/v1`; needs the Workspace Developer Preview Program | **Exception** until generally available; stays REST, documented |
| Outlook / Microsoft 365 | REST OAuth (Graph) | Work IQ Mail/Calendar (Agent 365), tied to a Copilot licence and tenant admin setup; none for personal Outlook.com | **Exception**; stays REST, documented |

## Scope
- **Exceptions doc**: an `.claude/` doc listing the apps that stay REST, why, and what would let them move.
- **Live listing**: built-in MCP apps list their tools from the server per connection (`mcpClient.listTools`), the same way custom servers do. Their `tools.js` placeholders go. A provider definition keeps sign-in, scopes, egress hosts and default caps.
- **Stored tool state per connection**: permission, read/write, the shape last looked at, and a changed flag, kept on the connection or in `CONNECTOR_TOOLS` keyed by connection. This replaces `toolsOff` and the workspace review rows.
- **Changed tools**: a tool whose shape differs from the one last looked at is flagged, notified once, and still works. It is left out of agent runs.
- **Read/write**: the default comes from `annotations.readOnlyHint`. Write tools with **Needs approval** go through the existing approval card (`writes.js`).
- **One lookup for AI**: a Connectors method, for example `available({ companyId, userId, kind, provider, product, purpose })`, that returns the person's connections and their usable tools. Ask (`Modules/AI/askConnectors.js`) and agents (`Modules/Agents/agentConnectors.js`) use it instead of building their own lists.
- **Ask which app**: when Ask's pick step finds tools from more than one connected app that fit the request, such as messaging or a write two apps can both do, it asks the person which app before calling anything. The answer then narrows the lookup to that app. An agent run with no one to ask uses only the apps ticked in its settings; if those still conflict, it proposes rather than guesses.
- **Workspace switch**: owners and admins turn an app off for the workspace. Its tools then leave every list.
- **Custom servers (096)** use the same per-connection model. Their per-tool workspace review folds into it.
- **Screen**: each connection's tools, grouped read and write as in Claude's settings, with the permission control and the changed warning. Agent settings show missing ticks.
- **Slack moves to its MCP server**, with argument checks that keep DMs and `@channel` out, if Slack's tools allow it. Otherwise Slack joins the exceptions.
- Spec: FR-44 and FR-45 in 056 rewritten to match.
- Strings through i18n; colours from tokens.

## Out of scope
- Caching tool lists (decision 2). Added later if listing per request is too slow.
- Moving Google or Outlook to MCP while their servers are preview-only or licence-gated.
- Local (stdio) servers.
- A filter by person.
- Changing the tool list of AlianHub's own MCP server (`Modules/Mcp`).

## Acceptance criteria
- [ ] The exceptions doc lists every app that is not on MCP, with the reason
- [ ] Every built-in MCP app shows its server's real tools after connecting; no `providers/*/tools.js` placeholder remains for an MCP app
- [ ] Two members connected to the same app each see the tools their own connection lists
- [ ] Setting a tool to Off removes it from AI chat and agents; Needs approval sends a write to the approval card; Always allow runs it
- [ ] A tool with `readOnlyHint: true` defaults to read; one without the hint defaults to write
- [ ] A tool the server changed still works in AI chat, shows a changed warning, sends one notice, and is skipped by agents until looked at again
- [ ] An app turned off for the workspace offers no tools to anyone
- [ ] Ask and agents get their tools from the one lookup; filtering by kind and app returns only matching tools
- [ ] With Slack and another messaging app connected, "send the team a message" makes Ask ask which app, and the call then goes only to the chosen app
- [ ] Two apps with tools that fit the same write make Ask ask which app before anything is called
- [ ] An agent ticked for a tool the server removed shows that tick as missing in its settings
- [ ] An app whose server is unreachable is reported as unreachable to the AI, not treated as unconnected
- [ ] Slack runs through `mcp.slack.com` with DMs and `@channel` still refused, or is listed as an exception with the reason
- [ ] `i18n:check`, `style:check` and `api:doc:check` pass

## Constraints & notes
- Track: A — connections, and B — tools.
- A server's tool names and descriptions are outside content: they are shown as the app's own text, never through `$t()`, and its results stay tainted (FR-46).
- Every request lists every connected app live (decision 2). Listing runs in parallel with a timeout per app, so one slow server does not hold up the rest.
- Agent tool ticks store keys built from provider and server tool name. A rename on the server shows as a missing tick, not a broken agent.
- `companyId` scoping, emit after mutation and `removeCache` follow CLAUDE.md.
- Likely split into subtasks on approval: exceptions doc; live listing and stored state; permissions and screen; the AI lookup; the Slack move.

## Resources
- Sources for the app table: [Slack MCP server](https://docs.litellm.ai/docs/mcp_servers/slack), [Google Workspace MCP servers](https://developers.google.com/workspace/guides/configure-mcp-servers), [Google Workspace update, May 2026](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html), [Outlook MCP gated behind Copilot](https://www.usecarly.com/blog/outlook-mcp/), [Outlook MCP vs API](https://www.scalekit.com/blog/outlook-mcp-vs-api)
