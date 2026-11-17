---
id: 113
title: Connectors — custom MCP servers on the per-connection tools model
status: backlog
priority: medium
depends_on: [109, 110]
created: 2026-11-17
---

# 113 — Connectors — custom MCP servers on the per-connection tools model

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
A custom server added by address (096) works like any built-in MCP app: tools listed per connection, permissions set by the connection's owner.

## Scope
- Custom server connections use 109's live listing and 110's permissions.
- The per-tool workspace review (`customReview.js`, `/servers/:id/tools` routes, the review screen) goes. Adding, editing and removing a server, and the "Add custom apps" right, stay.
- The three generic tools in `customTools.js` (list, read, write) give way to the server's own tools under keys `custom_<id>.<tool>`, if 109's keys allow it. Otherwise they stay and read from the new state.
- Existing reviewed rows carry over: an enabled tool becomes its reviewed access with the default permission; a disabled one becomes Off.
- Strings through i18n; colours from tokens.

## Out of scope
- Changing how a server is added or signed in to.

## Acceptance criteria
- [ ] A member connected to a custom server sees its tools and sets their permissions like a built-in app
- [ ] No workspace review step remains for custom server tools
- [ ] Existing reviewed tools keep working after the change; disabled ones are Off
- [ ] Removing a server still ends every connection to it
- [ ] `i18n:check` and `style:check` pass
