---
id: 012
title: Kiln polish after Autofill + write-back
status: active
priority: high
depends_on: [011]
created: 2026-08-27
---

# Kiln polish after Autofill + write-back

## Goal
Polish S3.1 Autofill and S3.2 write-back so preview, apply, and live events read as kiln (cream / pine / copper), not ClickUp or Notion: named rows with per-row apply, activity instead of a new Alian comment per event, and the leftover 360 blockers that keep a task modal as a skeleton.

## Scope
- Autofill card (`TaskAiAutofill.vue`): drop the kind column; label by field name; Assignee and Owner as two rows; per-row checkboxes; skip-filled per field; Fill empty after first apply; copper in-field mark (not a sparkle); Due date custom field in the block and in suggestions.
- Write-back: status/field writes become one Activity Log row with a copper Alian mark. Page briefing stays a replace-in-place cream/copper strip (dismiss/collapse). Project toggle still silences everything. Notify a person only when they are tagged.
- Search / Home / deep URL: pass the task’s ProjectID so `GET taskData` is not `projectId=` 400. Search result title click opens the task.
- List/board empty copy: “No matching filters” vs “No Data Found” when the data-load bug is larger than this PR.
- Standup briefing: cap height; collapse SOURCES to a count if cheap.

## Out of scope
- Copying ClickUp or Notion UI.
- Adding `@Alian` to Main Chat.
- A second AI stack; reuse `llmProvider`.
- Wiping automations 005–007.
- Piling onto PRs 515–520. Stack on `feat/agent-writeback-status-page-comment-0b24` (PR 521).

## Acceptance criteria
- [ ] Autofill preview shows Assignee and Owner as separate named rows with per-row apply
- [ ] Skip-filled per field; Owner can fill without assigning
- [ ] Write-back no longer dumps a new comment per event; status/field writes are activity
- [ ] Search-open / Home / deep URL task modal loads (ProjectID passed)
- [ ] Tests cover skip-filled per field, Owner-without-Assignee, and write-back activity vs comment
- [ ] Draft stacked PR on a new `feat/` branch; tests green

## Constraints & notes
- Stack on `feat/agent-writeback-status-page-comment-0b24` (PR 521). New `feat/` branch — not piled onto 515–520.
- Kiln only: cream `#f4ead8`, pine `#1b2f28`, copper `#c45c26`.

## Resources
- `resources/s31_preview.png` — Autofill with two OWNER kind labels
- `resources/s31_second.png` — skip-filled second run (Priority tag only)
