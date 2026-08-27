---
id: 009
title: Standup / project update from real task history
status: active
priority: high
depends_on: [008]
created: 2026-08-27
---

# Standup / project update from real task history

## Goal
From a selected project, a user can generate a kiln standup / project-update briefing from real task activity they can open (completed, in progress, blocked, newly created, comments) for the last 24 hours or last 7 days, without replacing any page body.

## Scope
- Compose-rail `standup` action on existing `POST /api/v2/pages/ai` (not a second AI stack).
- Two windows: last 24 hours (default) and last 7 days.
- Grouped briefing with citations to real tasks; `apply: false`.
- Permission-aware pack reused from Ask / transcript; invented task ids dropped.
- Hide the control until a project is selected (same gate as Turn into tasks).
- CompanyId multi-tenant via existing Mongo helpers.

## Out of scope
- Copying ClickUp or Notion UI.
- Adding `@Alian` to Main Chat.
- A dedicated second AI product surface or `/api/v2/pages/standup` unless reuse required it.
- Wiping automations 005–007 or the agent engine 006 foundation.
- Replacing page content.

## Acceptance criteria
- [ ] From a project (e.g. Local Smoke), choose 24h or week and get a briefing citing real tasks
- [ ] Page body is not replaced
- [ ] Standup control is hidden until a project is selected
- [ ] Invented task ids are dropped from citations
- [ ] Tests cover window filter, permission pack, invented ids, and the project-required gate
- [ ] Stacked draft PR on a new `feat/` branch from `feat/meeting-transcript-ee23`

## Constraints & notes
- Stack on `feat/meeting-transcript-ee23` (PR 518). Branch: `feat/standup-project-update-1955`.
- Kiln only: cream `#f4ead8`, pine `#1b2f28`, copper `#c45c26`.
- Reuse `Modules/AIProjectGenerator/llmProvider`.
- Do not pile onto PRs 515, 516, or 517.

## Resources
None.
