---
id: 013
title: Gantt v1, dependencies, and due-date recurring
status: active
priority: high
depends_on: [012]
created: 2026-08-27
---

# Gantt v1, dependencies, and due-date recurring

## Goal
Ship Sprint 4.1 Gantt and 4.4 Blocking/Blocked-by plus due-date recurring on the existing kiln polish stack. One Gantt for a project, finish-to-start arrows from the same relation data as the task, no silent cascade on drag, and completing a weekly/monthly task creates the next one only.

## Scope
- Restyle and finish the existing `GanttView` (cream name rail, pine bars, copper today-line). Drag bar to move dates; drag the end to change due. Unscheduled tasks in a slim "No dates" stack. FS arrows only. Collision = copper hint, never a silent move of blocked tasks.
- Blocking / Blocked by on the task write the same `relations` documents the Gantt arrows use.
- Recurring lives on Due date (week/month). Spawn the next task on complete. Do not pre-clone a year. Do not wipe RecurringTasks 005–007 or automations.

## Out of scope
- 4.2 page properties / table/board of pages
- 4.3 block comments
- ClickUp four link types, red critical path, reschedule-deps toggle (v2)
- Notion Timeline chrome
- Copying ClickUp or Notion UI
- A second AI stack; reuse `llmProvider`
- Reverting kiln polish on PR 522

## Acceptance criteria
- [ ] Gantt view exists for a selected project; hidden until a project is selected if that matches other project-mode chips
- [ ] Unscheduled stack ("No dates") works; drag-to-schedule
- [ ] FS arrows draw from `blocks` relations
- [ ] Blocking / Blocked by on the task write the same links
- [ ] Drag does not cascade blocked tasks
- [ ] Date collision shows a copper hint on the arrow
- [ ] Completing a weekly/monthly recurring task creates the next one only
- [ ] Jest for dep create, no cascade on drag, spawn-next-on-complete; existing tests stay green
- [ ] i18n keys added in `frontend/src/locales/en.js` without wiping Automations or Pages

## Constraints & notes
- Stack on `feat/kiln-autofill-writeback-polish-edb6` (PR 522). Do not revert polish.
- Kiln only: cream `#f4ead8`, pine `#1b2f28`, copper `#c45c26`.
- Reuse existing `relations` (`blocks` / `blocked_by`) and `updateDates`. Do not add a second dependency system.
- RecurringTasks cron definitions stay; due-date recurrence is a separate field on the task.
- Permissions: company-scoped, respect existing task/project access.
