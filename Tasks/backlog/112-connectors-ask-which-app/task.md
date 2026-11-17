---
id: 112
title: Connectors — ask which app when tools from several apps fit a request
status: backlog
priority: medium
depends_on: [111]
created: 2026-11-17
---

# 112 — Connectors — ask which app when tools from several apps fit a request

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
With several apps connected, AI never picks one on the person's behalf when more than one fits. It asks, then uses only the chosen app.

## Scope
- Ask's pick step (`Modules/AI/askConnectors.js`) spots when the request fits tools from more than one app, such as a messaging request with Slack and email connected, or a write two apps can both do.
- Ask then replies with a choice of those apps (buttons in AI chat) and calls nothing. The answer narrows the lookup (111) to that app for the follow-up.
- A request that names the app ("on Slack") skips the question.
- Agents, with no one to ask: use only the apps ticked in their settings. If those still conflict, create a proposal naming the choice instead of calling either.
- Strings through i18n; colours from tokens.

## Out of scope
- Remembering a default app per person. Add it later if the question gets repetitive.

## Acceptance criteria
- [ ] With Slack and another messaging app connected, "send the team a message" asks which app, and the call goes only to the chosen one
- [ ] Two apps that can do the same write make Ask ask before anything is called
- [ ] Naming the app in the request skips the question
- [ ] An agent with two conflicting apps ticked creates a proposal and calls neither
- [ ] `i18n:check` and `style:check` pass
