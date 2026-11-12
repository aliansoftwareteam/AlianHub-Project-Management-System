---
id: 099
title: Connectors — Outlook built connector on Microsoft Graph: mail and calendar
status: backlog
priority: medium
depends_on: [068, 069, 093]
created: 2026-11-12
---

# 099 — Connectors — Outlook built connector on Microsoft Graph: mail and calendar

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A member's AI reads their Outlook mail and calendar and proposes drafts and events, through a built connector. This lasts until Microsoft's MCP servers are generally available without a Copilot licence.

## Scope
- Outlook catalog entry, kind `built`: Microsoft identity platform OAuth with a multi-tenant app, tenant admin consent noted; least scopes from section 5 of the research matrix (`Mail.Read`, `Calendars.ReadWrite`, `offline_access`, `User.Read`)
- Tools: mail search and read, calendar read; draft a reply and create an event as write proposals (nothing is sent)
- Alian's app on the shared service; setup page for self-hosted installs (register the Microsoft app, callback, admin consent)
- AlianHub tool names chosen so a later move to Microsoft's MCP servers keeps them (decision 20)
- Fake Microsoft Graph server for tests

## Out of scope
- Sending mail; Teams, OneDrive, SharePoint

## Acceptance criteria
- [ ] Every tool works from the AI chat, an agent run and MCP against the fake Graph server
- [ ] A draft or an event is a proposal only the connection's owner approves; nothing is sent
- [ ] A tenant that needs admin consent gets a clear message

## Constraints & notes
- Track: B — tools (using that access safely)
- Phase 3. Depends on: 068, 069, 093
