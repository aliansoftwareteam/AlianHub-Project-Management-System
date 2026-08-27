---
id: 008
title: Meeting transcript to summary, action items, and linked tasks
status: active
priority: high
depends_on: [007]
created: 2026-08-27
---

# Meeting transcript to summary, action items, and linked tasks

## Goal
A user can paste a meeting transcript on the Pages compose/Ask path and get a kiln-styled summary plus action items without losing the page body. From that briefing they can create linked tasks on the page's project when a project is selected.

## Scope
- Compose-rail `transcript` action on the existing `POST /api/v2/pages/ai` path (not a second AI stack).
- Structured summary + parsed action items; `apply: false` so the page is not replaced.
- Permission-aware related task/page ids from the workspace pack; invented ids dropped.
- Turn into tasks reuses `AiTaskCreator` + `initialRequirements`; hide the control until `projectId` is set.
- gpt-4o output clamped via `llmProvider` `maxTokens`.
- Tests for no overwrite, action-item parse, project gate, invented ids.

## Out of scope
- Copying ClickUp or Notion UI.
- Adding `@Alian` to Main Chat.
- Rebuilding list/board/gantt.
- Wiping automations 005–007 or the agent engine 006 foundation.
- A dedicated second AI product surface.

## Acceptance criteria
- [ ] Paste a transcript on a project-scoped page and receive summary + action items
- [ ] Existing page content is not replaced
- [ ] Turn into tasks is hidden until a project is selected
- [ ] Turn into tasks opens AiTaskCreator seeded with the briefing on that project
- [ ] Invented related task/page ids are dropped
- [ ] Unit tests cover the four cases above; existing page-content tests stay green
- [ ] Frontend build passes
- [ ] Stacked draft PR opened on a new `feat/` branch from `feat/alian-mentions-6d61`

## Constraints & notes
- Stack on `feat/alian-mentions-6d61` (PR 517). Branch: `feat/meeting-transcript-ee23`.
- Kiln only: cream `#f4ead8`, pine `#1b2f28`, copper `#c45c26`.
- Reuse `Modules/AIProjectGenerator/llmProvider`. CompanyId multi-tenant.

## Resources
None.
