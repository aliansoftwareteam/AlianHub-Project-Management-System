---
id: 011
title: Triggered agent write-back from status / page / comment
status: active
priority: high
depends_on: [010]
created: 2026-08-27
---

# Triggered agent write-back from status / page / comment

## Goal
When a user changes a task status, saves a page, or posts a comment, an agent can write back onto that same task or page: fill empty custom fields, post a short follow-up comment, or update a page briefing — permission-aware, companyId-scoped, never silently overwriting filled fields.

## Scope
- Guarded write-back on `task_status_changed`, `page_updated`, and `comment_created`.
- Reuse `applyAutofillWrites` for empty custom fields; Alian follow-up comments from 007; page briefing field (body untouched).
- Reuse `Modules/AIProjectGenerator/llmProvider`. Heuristic fallback when no model is configured.
- Project-level kiln toggle to turn the trigger off (`aiWritebackEnabled`).
- Visible kiln affordance: Alian comment listing what was written, plus a page briefing strip.

## Out of scope
- Copying ClickUp or Notion UI.
- Adding `@Alian` to Main Chat.
- A second AI stack.
- Wiping automations 005–007 or the agent engine 006 foundation.
- Wiring AUTO-03 `set_priority` into live task mutations.
- Silently overwriting filled custom fields or page body.

## Acceptance criteria
- [ ] Changing a Local Smoke task status, saving a page, or posting a comment can trigger a grounded write-back (empty fields or a follow-up comment)
- [ ] Filled fields are not clobbered; invented people/tags/task ids are dropped
- [ ] Permission-aware and companyId multi-tenant
- [ ] Tests cover event gate, skip-filled, invented ids dropped, and permission
- [x] Draft stacked PR on a new `feat/` branch from `feat/ai-autofill-custom-fields-32f3`; tests green

## Constraints & notes
- Stack on `feat/ai-autofill-custom-fields-32f3` (PR 520). New `feat/` branch — not piled onto 515–519.
- Kiln only: cream `#f4ead8`, pine `#1b2f28`, copper `#c45c26`.
- Smaller reuse than a new AUTO-03 action: fire-and-forget like `@Alian` (007), calling S3.1 `applyAutofillWrites`. AUTO-03 stays on-demand `set_priority`.
- Skip `@Alian` comments (007 handles those) and Alian-authored comments (loop guard).

## Resources
None.
