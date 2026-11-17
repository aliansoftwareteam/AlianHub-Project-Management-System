---
id: 114
title: Connectors — Slack on its official MCP server, or listed as an exception
status: backlog
priority: medium
depends_on: [109, 110]
created: 2026-11-17
---

# 114 — Connectors — Slack on its official MCP server, or listed as an exception

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
Slack connects over `https://mcp.slack.com/mcp` like other MCP apps, without losing the guards AlianHub has today: no direct messages, no `@here`, `@channel` or `@everyone`.

## Scope
- First, read Slack's official MCP docs and list its tools with a test workspace (`scripts/connector-tool-shapes.js`). Record in progress: how it signs in (registered app with MCP turned on, no self-registration), which tools exist, and which can reach DMs or post to a channel.
- If the guards can be kept by checking arguments before a call (channel ids checked against `conversations.info`, message text checked by `textOf`), move Slack to MCP:
  - `providers/slack/index.js` gets `transport: 'mcp'` and Slack's MCP sign-in;
  - tools come from 109;
  - the hand-written `providers/slack/tools.js` goes, and its guards move to a pre-call check for Slack's tools;
  - existing Slack connections are asked to reconnect, with a notice.
- If they cannot, Slack stays on its REST tools and 108's doc lists it as an exception with the reason.

## Out of scope
- Slack features AlianHub does not offer today (files, canvases, lists), unless the owner turns them on through 110.

## Acceptance criteria
- [ ] Progress records Slack's sign-in, tool list and the DM/`@channel` finding, with sources
- [ ] Either: Slack runs through its MCP server, a DM channel id is refused, and a message with `<!here>` or `<!channel>` is refused before the call; or: Slack is listed as an exception in 108's doc with the reason
- [ ] Existing Slack connections are told to reconnect if the sign-in changes
- [ ] Tests cover the DM and special-mention refusals
