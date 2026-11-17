---
id: 108
title: Connectors — exceptions doc for apps not on MCP, and FR-44/FR-45 rewritten
status: backlog
priority: high
depends_on: [107]
created: 2026-11-17
---

# 108 — Connectors — exceptions doc for apps not on MCP, and FR-44/FR-45 rewritten

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
Anyone adding or changing a connector can see which apps connect over MCP, which stay on their own API, and why. The 056 PRD matches the MCP-first decisions.

## Scope
- A doc under `.claude/` (or a section in `.claude/AGENTS-AND-MCP.md`) listing every connector: MCP or REST, its server address, how it signs in, and for each REST app the reason and what would let it move.
- Google (Gmail, Calendar, Drive): official servers are Developer Preview only. Outlook / Microsoft 365: Work IQ needs a Copilot licence and tenant admin setup, with nothing for personal accounts. Both re-checked against official docs before writing.
- Slack's entry stays "moving, see 114" until 114 decides.
- Rewrite FR-44 and FR-45 in `Tasks/backlog/056-personal-app-connectors/task.md`: tools are listed per connection, permissions are set by the connection's owner, a changed tool keeps working with a warning and agents skip it.
- Link the doc from `CLAUDE.md` See Also.

## Out of scope
- Any code change.

## Acceptance criteria
- [ ] Every provider under `Modules/Connectors/providers/` is in the doc, as MCP or as an exception with its reason
- [ ] Each exception names the official source checked and the date
- [ ] FR-44 and FR-45 in 056 state the 107 decisions, and nothing else in 056 contradicts them
