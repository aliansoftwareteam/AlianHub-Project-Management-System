---
id: 010
title: Redesign stage 4 — auditable AI agent system
status: active
priority: high
depends_on: [009]
created: 2026-09-03
---

# Redesign stage 4 — auditable AI agent system

## Goal
Ship the agent system the handoff differentiates on: agents you can audit, with the reason, exact actions, cost and undo on every one, destructive actions absent from the registry, and CLI coding agents working from AlianHub through MCP.

## Scope (handoff option ids)
- `9a` AI Hub · `9b` AI Inbox (approve / edit / decline, undo, completion state, gated deploys) · `9c` agent settings (skills, allowed actions, autonomy L0–L3, schedule, spend cap, kill switch, audit) · `9d` AI Assist in a project · `11a` skill library · `11b` audit log (humans + agents in one stream) · `11c` portfolio report with agent summary
- `13a` new agent wizard with model picker (incl. open-source / local-only policy) · `13b` agents as teammates (@mention, assign, Members badge) · `13c` AI fields in Table · `13d` NL automations compiled to editable rules · `13e` connections (MCP servers, external agents, search sources) · `13g` Planner v2 · `13h` Team page · `13i` Ask
- `29a–c` Provenance of Done: `completion { workBy[], checkedBy, closedBy }` on tasks; `closedBy` never an agent; HUMAN/AGENT/MIXED/UNCHECKED badge, filter, rollups
- Agent action registry (allow-list; `project.delete`, `task.delete`, `billing.*`, `deploy.production`, `git.merge`, `member.remove`, `permissions.edit`, `status.set("Done")` absent) with audit + undo
- `26a–d` MCP server at `/mcp` with scoped PATs and the nine tools; `task.get` returns a brief · `27a–d` personal Claude Code accounts (three modes, linking, attribution, edge cases) · `28a–c` pipeline, five on-screen surfaces, release & deploy screen · `30a–c` fit-ranked agent picker, bulk routing, decline/handback/stop

## Out of scope
- Autonomy above L1 enabled by default (ship L0–L1 first per the roadmap).

## Acceptance criteria
- [ ] Rail shows AI item and "n running" footer; AI Hub/Inbox/settings match mocks.
- [ ] Every agent action lands in the shared audit log with reason, actions, cost, undo.
- [ ] API rejects an agent token calling status → Done and logs the attempt.
- [ ] MCP server serves the nine tools over scoped tokens; `task.get` returns the brief.
- [ ] Provenance fields stored on completion; badge and filter work in List/Table/Board.

## Constraints & notes
- Extend `Modules/Agents`, `Modules/Audit`, `Modules/ApiTokens`, `Modules/AI`, `Modules/Automations` (tasks 005–007 built the automation engine + agent engine foundations — build on them, don't fork).
