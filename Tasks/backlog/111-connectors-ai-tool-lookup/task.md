---
id: 111
title: Connectors — one tool lookup for Ask and agents, with missing ticks shown
status: backlog
priority: high
depends_on: [109, 110]
created: 2026-11-17
---

# 111 — Connectors — one tool lookup for Ask and agents, with missing ticks shown

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
Ask and agents get the tools that fit a request from one place, so they cannot disagree about what is usable.

## Scope
- One Connectors method, for example `available({ companyId, userId, kind, provider, product, purpose })`: the person's connections (REST and MCP) and their usable tools after workspace switch and permissions.
- Filters: kind (read or write), app, product, purpose (`ask` or `agent`). Purpose `agent` leaves out changed tools.
- Each result says which tools are unreachable, so the AI can say so.
- `Modules/AI/askConnectors.js` and `Modules/Agents/agentConnectors.js` use it in place of their own lists.
- Agent settings show a ticked tool that is gone or no longer listed as missing, with a way to remove it. Runs refuse it with a clear reason.

## Out of scope
- AlianHub's own MCP server (`Modules/Mcp`) keeps its tool list.
- Asking which app (112).

## Acceptance criteria
- [ ] Ask and agents get their tools only from the lookup
- [ ] Filtering by kind and by app returns only matching tools
- [ ] An agent run leaves out changed tools; Ask includes them
- [ ] An unreachable app is reported as unreachable in the answer
- [ ] An agent ticked for a removed tool shows the tick as missing in settings, and the run refuses it with that reason
- [ ] `i18n:check` passes
