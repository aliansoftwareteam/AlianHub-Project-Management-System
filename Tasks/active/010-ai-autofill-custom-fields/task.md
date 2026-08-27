---
id: 010
title: AI Autofill on custom fields
status: active
priority: high
depends_on: [009]
created: 2026-08-27
---

# AI Autofill on custom fields

## Goal
From an open task, suggest values for empty custom fields (summary/text, date, owner/assignee-like, tag/select) using the task the caller can already see. Preview first, apply on confirm, never silently overwrite.

## Scope
- Task-detail Autofill control (kiln cream/pine/copper) on the custom-fields block.
- `POST /api/v2/tasks/ai-autofill` with `preview` and `apply`.
- Reuse `Modules/AIProjectGenerator/llmProvider`. CompanyId-scoped, permission-aware.
- Map AlianHub types: text/textarea → summary, date → date, dropdown → tag, owner-titled dropdown + empty native assignee → owner.
- Skip filled fields. Drop invented people and tags. Only fields and people the caller can set.
- Cheap S3.2 hook: exported apply-writes helper. No trigger runner.

## Out of scope
- S3.2 triggered write-back.
- A second AI stack, Write-with-AI rewrite, pages compose path as the primary surface.
- @Alian in Main Chat.
- Copying ClickUp or Notion UI.
- Wiping automations 005–007 or the agent engine 006 foundation.
- Number, money, email, phone, checkbox, formula, rollup fields.

## Acceptance criteria
- [ ] On a Local Smoke task with empty custom fields, Autofill previews summary/date/owner/tag suggestions grounded in that task
- [ ] Applying fills only empties
- [ ] A second run does not clobber filled fields
- [ ] Tests cover skip-filled, invented people/tags dropped, and permission gate
- [ ] Draft PR opened; tests green
- [ ] Frontend build passes

## Constraints & notes
- Stack on `feat/standup-project-update-1955` (PR 519). New `feat/` branch — not piled onto 515–518.
- Decision: dedicated `/api/v2/tasks/ai-autofill` rather than Write-with-AI (description-only) or pages compose (wrong surface). Same llmProvider as those paths.

## Resources
None.
