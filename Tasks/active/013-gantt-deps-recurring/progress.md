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
Implementation on `cursor/gantt-deps-recurring-52b7`. Jest: 66 passed; one pre-existing share-rules page-entity failure unrelated to this work.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Found existing Gantt (`dhtmlx-gantt`), LinkedTasks relations, and RecurringTasks definitions. Product lock is due-date spawn-next, not the cron cloner.
- Extended `relations` with planFinishToStartAdd (Gantt arrows = Blocking/Blocked by).
- Gantt: cream rail, pine bars, copper today-line and collision hint. No dates stack. Drag does not cascade. RecurringTasks cron left in place. Due-date week/month spawns the next task on complete only.
