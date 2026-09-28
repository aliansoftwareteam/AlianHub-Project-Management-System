# 043 — Advanced AI from a hands-on look at ClickUp Brain²

## Goal
Close the AI gaps found by using ClickUp Brain² and Super Agents directly on 2026-09-28 (`Tasks/active/034-end-to-end-qa-programme/findings/clickup-ai-hands-on-2026-09-28.md`), on top of task 041. The owner asked for it: "check ClickUp AI and make our system more advanced". AlianHub keeps its own rules throughout:
- the workspace's own model;
- no credits;
- previews before anything is written;
- access checked on every read.

## Scope (one slice and one PR each)
1. **Personal AI memory and preferences.**
   - A private profile per user that Ask and agents started by that user read: nickname, role, tone and format preferences, and things to remember.
   - "Bring memories from another AI": the user pastes what ChatGPT, Claude or Gemini knows about them, and it goes through a preview before saving.
   - Owner-only, removed by erasure-by-person, never shared.
2. **Ask composer that plans and builds.**
   - Starter cards (project update, new task, find my urgent work, draft an email or message).
   - `/` picks a skill and `@` adds a task, doc or project as context.
   - An answer can create several tasks or a doc through a preview checklist, using the normal create paths.
3. **AI on the task and in the editor.**
   - Ask about this task, Suggest next steps, and Research this (web research only when the instance allows egress).
   - In any rich-text editor: "Improve with AI" on a selection and "Turn selection into tasks", both with preview and undo.
4. **Agent catalogue and a conversational builder.**
   - Templates by category (projects, personal, tasks, scheduling, product, meetings, knowledge).
   - "Describe your new teammate": a sentence drafts the wizard's three steps, including skills, allowed actions, autonomy and scope, for review before saving.
5. **Scheduled agents.**
   - Agents at the level that allows schedules (L3) run on a daily or weekly schedule through the existing scheduler, with caps, spend and the audit trail.
   - Ships templates: Daily briefing, Deadline watch, @mentions digest, Weekly status report.
6. **AI fields.**
   - A custom field type filled by the model from a prompt: summary, progress update, translation, action items, category, or custom.
   - Fill one or many tasks (bulk), optionally re-fill when the task changes.
   - Shown in List and Table columns, with spend recorded and preview on first fill.

## Out of scope
- Meeting bots joining Zoom, Meet or Teams.
- A desktop hotkey app.
- Importing a model's memories automatically (import is paste only).

## Acceptance
- Failing-first tests per slice.
- Every string through i18n.
- Dark mode and 390 px.
- AI-off and not-permitted states follow `aiAvailability`.
- Every model call records spend and respects caps.
- Nothing reads data the user or agent could not open.
