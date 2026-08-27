# Progress: Gantt v1, dependencies, and due-date recurring

## Checklist
- [x] Investigate existing Gantt / relations / RecurringTasks
- [x] Pure rules: FS dep create, no-cascade drag, spawn-next-on-complete
- [x] Schema + status hook for due-date recurrence
- [x] Kiln Gantt: rail, bars, today-line, No dates stack, collision hint
- [x] Blocking / Blocked by on the task (same relations)
- [x] Due date week/month control
- [x] Jest + i18n; existing tests green

## Last step
GitHub CI green on PR 523 (`feat/gantt-deps-recurring-52b7`, stacked on PR 522).

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Found existing Gantt (`dhtmlx-gantt`), LinkedTasks relations, and RecurringTasks definitions. Product lock is due-date spawn-next, not the cron cloner.
- Extended `relations` with planFinishToStartAdd (Gantt arrows = Blocking/Blocked by).
- Gantt: cream rail, pine bars, copper today-line and collision hint. No dates stack. Drag does not cascade. RecurringTasks cron left in place. Due-date week/month spawns the next task on complete only.
- GitHub CI green on PR 523 (title, branch name, commitlint, CodeRabbit). Stacked on PR 522.
