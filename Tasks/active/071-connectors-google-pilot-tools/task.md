---
id: 071
title: Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail)
status: active
priority: high
depends_on: [068, 069]
created: 2026-10-28
---

# 071 — Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail)

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Give the pilot provider its tools, so an agent run and MCP can read and propose writes on a person's Google account.

## Scope
- Calendar read tools and event create/update as write proposals, in `providers/google/tools.js`
- Meet read tools and meeting create as a write proposal (scopes per the contract and 061's matrix rows)
- Drive `drive.file` tools on picked files
- Fake Google server for tests

## Out of scope
- Gmail (decision 15)
- The Google provider definition and setup page (track A: 063, 077)
- Calendar row migration (073)
- Attachment picker (076)

## Acceptance criteria
- [x] Every tool works from an agent run and from MCP against the fake Google server; no real credential needed
- [x] A missing product scope tells the person which product to tick

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 068, 069
