---
id: 098
title: Connectors — agents use connectors: ticked on the agent, declared as reads in skills
status: active
priority: medium
depends_on: [068]
created: 2026-11-12
---

# 098 — Connectors — agents use connectors: ticked on the agent, declared as reads in skills

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
An agent reads from apps only where it was allowed to, through the connection of the person it works for.

## Scope
- Agent settings get a Connectors section, in the tabs of task 059: tick connectors and which of their turned-on tools the agent may use; nothing ticked by default; stored on the agent record (FR-61)
- A skill declares a connector read step (AlianHub tool name and arguments) beside its outside reads (`Modules/Agents/skills/externalReads.js`); the skill editor offers it next to `SkillDeclaredRead.vue` (FR-62). Skills already read connectors (the Slack summary seed reads `slack.channel.read`); this task makes it a general step, gated by the agent's ticks
- The run's gather step runs declared connector reads on the connection of the person the run works for. A missing connection fails that step with "connect <app>". Taint, caps and usage apply as for any read.
- Writes stay proposals (FR-21)
- Strings via i18n; colours from tokens

## Out of scope
- A free tool loop for agents

## Acceptance criteria
- [x] An agent with GitHub unticked cannot call any GitHub tool, even if its skill declares one (the rule is the same for every app; tested with the fixture API and MCP apps until GitHub's provider lands)
- [x] A scheduled run uses the schedule owner's connection, never the agent creator's
- [x] A declared read without a connection fails that step with the reason, and the run continues as the skill allows (a step marked optional carries on; otherwise the run stops with the reason)
- [x] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: B — tools (using that access safely)
- Phase 2. Depends on: 068
