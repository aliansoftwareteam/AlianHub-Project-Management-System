---
id: 095
title: Connectors — Supabase, Upwork, Wispr Flow, Dropbox, HubSpot and Canva through their MCP servers
status: backlog
priority: medium
depends_on: [075, 093, 094]
created: 2026-11-12
---

# 095 — Connectors — Supabase, Upwork, Wispr Flow, Dropbox, HubSpot and Canva through their MCP servers

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Six more apps reach the AI, each as one catalog entry and an allow-list, with no code.

## Scope
- One provider folder each, with its allow-list written from the server's own tool list and its sign-in checked by a test connection:
  - Registers itself: Supabase, Upwork, Wispr Flow, Dropbox (files, for AI; the picker stays built)
  - Registered app: HubSpot ("MCP auth app", PKCE) and Canva (developer-portal app); Alian's apps on the shared service, setup pages for self-hosted installs
- A test connection per app, noted in progress
- Wispr Flow's card says it reaches meeting notes and transcripts

## Out of scope
- The Dropbox attachment picker (076, built)
- An app that turns out to need code: it is split into its own task

## Acceptance criteria
- [ ] Each app is added by its provider folder alone: no route, collection, screen or code change (FR-2)
- [ ] Each meets the 056 acceptance criteria for a connector: personal connections, writes as proposals, audit and usage
- [ ] Each is tested against a fake MCP server, plus one manual run noted in progress

## Constraints & notes
- Track: B — tools (using that access safely)
- Phase 2. Depends on: 075, 093, 094
