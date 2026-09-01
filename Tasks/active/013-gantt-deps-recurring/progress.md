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
Live 360 on 9e6e5ace: Week today-line uses local noon so IST Wed is not Monday; No dates is a left slim stack; all board tasks bind; empty copy is only “No scheduled tasks yet…”.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Found existing Gantt (`dhtmlx-gantt`), LinkedTasks relations, and RecurringTasks definitions. Product lock is due-date spawn-next, not the cron cloner.
- Extended `relations` with planFinishToStartAdd (Gantt arrows = Blocking/Blocked by).
- Gantt: cream rail, pine bars, copper today-line and collision hint. No dates stack. Drag does not cascade. RecurringTasks cron left in place. Due-date week/month spawns the next task on complete only.
- GitHub CI green on PR 523 (title, branch name, commitlint, CodeRabbit). Stacked on PR 522.
- Kiln pass: dropped the overlap banner. Collision copy lives on the copper FS arrow (“Dates overlap. Blocked task stayed put.”). Quiet pine arrows otherwise. Lightbox disabled. Empty stays “No scheduled tasks yet…”.

### 2026-09-01
- Live 360 FAIL on 636b4398: today-line missing on Day (02 Sep visible) and Week #36; No dates was a horizontal Schedule-chip shelf; empty copy did not overlay the chart.
- Cause: `renderData()` `clearAll()` wiped the one-shot marker and never re-added it; `.gantt_today` cell class was never assigned; No dates list was `display: flex` row of pills; empty sat as a flex sibling of the chart instead of an overlay.
- Fix in `GanttView.vue` only: re-paint copper today overlay + marker after every parse/render/scroll; `timeline_cell_class` / `scale_cell_class` mark today; No dates is a slim vertical stack; empty is an absolute pine overlay gated on `scheduled.length === 0`. Board/list files untouched.

### 2026-09-01 (9e6e5ace 360)
- Week line sat on Mon|Tue: dhtmlx week scale reads UTC day of local midnight (IST Wed 00:00 → Tue 18:30 UTC). Week now paints noon on the local calendar day; Day stays midnight so 02 Sep is unchanged.
- No dates was still a full-width top shelf. It is a left slim stack beside the chart, with or without bars.
- SMOKE-2 dropped: first-sprint `node.tasks` only, no subtasks, ignored groupBy callback. Gantt now merges every sprint bucket, subtasks, `alltasks`, and the groupBy callback.
- Empty copy shortened to “No scheduled tasks yet…”.
