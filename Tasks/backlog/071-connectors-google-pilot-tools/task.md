---
id: 071
title: Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail)
status: backlog
priority: high
depends_on: [068, 069]
created: 2026-10-28
---

# 071 — Connectors — Google pilot tools: Calendar, Meet and Drive (no Gmail)

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Prove the module end to end: a member connects Google, ticks products, and both an agent run and MCP read and propose writes.

## Scope
- Calendar read tools and event create/update as write proposals
- Meet read tools and meeting create as a write proposal (scopes per 061)
- Drive `drive.file` tools on picked files
- Fake Google server for tests
- Instance and company setup page for Google

## Out of scope
- Gmail (decision 15)
- Calendar row migration (073)
- Attachment picker (076)

## Acceptance criteria
- [ ] Phase 1 "done when" of the PRD holds for Google
- [ ] A missing product scope tells the person which product to tick
- [ ] All tools tested against the fake Google server; no real credential needed

## Constraints & notes
- Depends on: 068, 069
