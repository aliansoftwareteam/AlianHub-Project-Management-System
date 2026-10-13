# UX comparison: AlianHub vs ClickUp, non-AI re-check (task 034, 2026-09-28)

This re-checks [ux-comparison-clickup-2026-09-24.md](ux-comparison-clickup-2026-09-24.md) (build 408) and [ux-flows-alianhub-2026-09-24.md](ux-flows-alianhub-2026-09-24.md) against build 519 and later. AI is covered separately in [ai-ux-comparison-clickup-2026-09-28.md](ai-ux-comparison-clickup-2026-09-28.md).

- **AlianHub:**
  - A code re-check of every non-AI item in both documents.
  - A live walk-through of build 519 as Local PM at 1440 px and 390 px: project List, Board and Add View, Inbox, Docs, Chat, Planner, Dashboards and Time.
- **ClickUp:** public sources only, covering 4.0 (GA 2025-12-10) through 4.08 (Sept 2026). Help Center articles are read from search snippets because direct fetches return 403. Sources are at the end.

## Executive summary

Tasks 036–039 closed nearly all of the ranked flow friction (F1–F12). From the 2026-09-24 top 10 they closed #1 (palette), #2 (Inbox snooze), #3 (task detail navigation) and most of #10 (accessibility). AlianHub now matches or beats ClickUp 4.0 in these places:

- the Inbox (Primary, Other, Later, Cleared, snooze, keyboard triage, undo);
- task panel navigation and undo;
- bulk edit with undo;
- the first-run checklist;
- the timesheet (weekly grid, submit, capacity nudge);
- the accessible dropdowns.

It also avoids ClickUp's most-cited complaints: automation run quotas, plan-gated dashboards and conditions, and clutter.

The gaps left are about **depth in the work views**:

- views don't save their setup;
- custom fields appear in no view;
- Table is read-only;
- there are no views across projects;
- comments have no threads and can't be assigned;
- there are no task templates.

The live walk-through also found a data bug: **the owner's workspace offers 3 of 20 view types in Add View**.

## Found live on build 519

1. **Add View offers List, Dashboard and Gantt only.** The workspace's `project_tab_components` catalogue has 3 records; another company on the same server has all 20. Board, Table, Calendar, Workload, Timeline, Mind Map, Forms and the rest can't be added. → task 042 slice 1.
2. **The Add View menu stays open** across a switch from List to Board, over the columns, still holding the old search text. → 042 slice 2.
3. **The Planner grid stops at 17:00** above empty grey space, and the first Unscheduled card is clipped. → 042 slice 2.
4. **Dashboard list thumbnails are permanent grey skeleton bars.** → 042 slice 2.
5. **At 390 px:**
   - The LIVE strip is 520 px wide and scrolls sideways.
   - The project page is 396 px wide.
   - The tab bar has no Inbox or Projects.
   - The List filter toolbar takes three rows, about a third of the screen.

   → 042 slice 3.

## Status of the 2026-09-24 top 10 (non-AI)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Command palette as the front door | Fixed | #949, #950 |
| 2 | Inbox: snooze, Other, Cleared | Fixed | #953, #976, #1031 |
| 3 | Task detail flow: prev/next, copy ID, action row | Fixed | #952, #961 |
| 4 | Saved views that store their setup | **Open**. Group, Me and search are remembered per user in localStorage (#958); views hold only name, pin and privacy | `views/Projects/composables/projectViewPrefs.js` |
| 5 | Bring-your-own model | Fixed (AI, #951) | — |
| 6 | One favourites model, project tree on every project page | **Partly fixed**. Home pins are on the user (#1042); project, sprint and task stars are separate; the tree is on Home only; the sprint crumb is plain text | `HomeSidebar.vue:48-70`, `ProjectHeader.vue:35-38` |
| 7 | Task templates | **Open** | only `Modules/ProjectTemplates` |
| 8 | Threaded and assigned comments | **Open** | `organisms/Comment/Comment.vue`, `Modules/Comments` |
| 9 | Workspace migration (import step, ClickUp importer, export UI) | **Open** | `Modules/Importers/helpers` (jira, trello, asana, monday, csv); `Modules/ExportJobs` has no UI |
| 10 | Keyboard and accessibility basics | **Partly fixed**. The axe checks, `--ink-3`, touch targets, reduced motion and dropdowns are done. The skip link is not rendered, and there is no "?" sheet, no `/` or `g` keys, no high contrast and no accessibility statement | `App.vue:14`, `locales/en.js:1185` |

## New gaps (not in the 2026-09-24 documents)

1. **Custom fields show in no view.** The only row that renders custom-field columns (`organisms/Task/Task.vue:243`) is never mounted. List, Table and Board show no field values. In ClickUp, fields are columns.
2. **Table is read-only, with fixed columns.** Its columns are Task, Status, Owner, Tags, three AI columns and Done by. It has no due, priority, estimate or points columns, no inline edit and no column chooser (`TableView/TableView.vue:33-60`).
3. **No views across projects.** ClickUp has Everything, Space and Folder-level views; AlianHub spans projects only in My Work.
4. **Recurrence can't be set on the task.** It lives in a project tab (`RecurringTasksManager.vue`).
5. **Time in the task panel:** the timer is for assignees only, and there is neither a manual add nor an entry list there (`TaskTimerChip.vue:55`).
6. **Story points appear only in the panel.** They are not on rows and are not totalled per sprint or group.
7. **Docs editor:** it has no @mentions, images are by URL only, and there is no version history or presence (`Modules/Pages/controller.js:28-30`).
8. **No goals or OKRs** beyond a sprint goal.
9. **List has no sort control.** Subtasks are read-only in List rows, and the row menu has no archive, delete, move or duplicate.
10. **Forms have no in-form conditional logic** (only through automations).

Still open from 2026-09-24:
- chat threads;
- whiteboard positions saved per browser without a label;
- form responses show the task key as text;
- Home still opens the legacy task detail (`TodayOverdue.vue:95`);
- the task tray is lost on reload;
- no "Automate" button in a project;
- no rule template gallery.

## Side by side

| Area | ClickUp 4.x (Sept 2026) | AlianHub (build 519+) | Verdict |
|---|---|---|---|
| Navigation | Global rail plus two context sidebars (Home, Spaces), custom sidebar sections, hubs per object, ⌘K, a Cmd+E quick create | Rail, Home sidebar with pins, ⌘K palette with scopes and row actions, `c` to create. The project tree is on Home only | Close. **Behind** on the tree and favourites |
| Hierarchy | Space → Folder → Subfolder (beta) → List → Task → nested subtasks; a task can sit in several Lists | Project → Folder → Sprint → Task → one level of subtasks | **Behind**. Keep one level of subtasks unless the owner decides otherwise |
| Views | 11+ view types; the Views Bar with pin, private, autosave and view templates; Customize panel; Me Mode default per view; group by each assignee or tag (4.08) | 20 view types in the catalogue (3 offered in the owner's workspace: the bug above); views store name, pin and privacy; Me, group and search remembered per user in the browser | **Behind** on saved view state |
| Table and fields | A spreadsheet Table; about 23 custom field types, including People, Rating, Progress, Button, Relationship and Signature; fields scoped by task type (4.07) | A read-only Table; 11 field types; fields invisible in views | **Behind**; the biggest gap for power users |
| Task detail | Full screen, modal or sidebar layouts; dependencies above the description; assigned comments as action items; threaded replies | A side panel, full page, tray and phone sheet; prev/next and j/k; undo; quick actions | **Ahead** on navigation and undo, **behind** on comments |
| Templates | Task, List, Folder, Space and view templates; a Template Center | Project templates only | **Behind** |
| Inbox and Home | Primary, Other, Later, Cleared; reminders (R); My Tasks with Today & Overdue | The same model, plus undo for clear all | **On par** |
| Planner | Multiple calendars, two-way Outlook sync, time blocks from estimates | A week grid with time blocks from estimates; calendar connect | **On par**; fix the grid height |
| Docs | Nested pages, wikis, live cursors | Pages with wikis, templates, agent-drafted review; no presence or history | **Behind** on collaboration |
| Chat | Channels, DMs, threads, Posts, FollowUps, SyncUps | Channels, DMs, calls with notes, make-task; no threads | **Behind** |
| Sprints, time, reporting | Velocity, burndown and burnup cards (Business plan); timesheets with approval; Goals | Sprints, a Sprint report with done-by rollup, a timesheet with approval, dashboards, no goals | **On par** on time, **behind** on goals and points |
| Automations | 100+ templates; 1,000 runs a month on Unlimited, then paused; conditions on Business | Sentence builder with backtest and dry run; no quotas; no template gallery | **Ahead** on model, **behind** on templates |
| Import | 11 importers plus CSV | Jira, Trello, Asana, Monday, CSV; no ClickUp importer; export has no UI | **Behind** for switchers from ClickUp |
| Mobile | A native app with an offline cache; no bulk edit | A responsive web app with a bottom tab bar, bulk edit at 390 px; overflow bugs; no PWA shell | Mixed |
| Accessibility | WCAG 2.2 AA target, High Contrast Mode, a shortcut sheet (shortcuts off by default), VPAT on request | axe in CI, reduced motion, accessible dropdowns; no skip link, shortcut sheet, high contrast or statement | Close; the rest is small |

## What not to copy

- **Run quotas and plan gates** on automations, dashboards and form logic. These are ClickUp's pricing complaints.
- **Settings sprawl.** Reviewers say a new project takes 10–15 minutes to set up and the empty workspace offers dozens of choices. Keep AlianHub's Blank default and checklist.
- **Keyboard shortcuts off by default.** Ship them on, with a "?" sheet.

## Recommendations (task 042 slices)

| Slice | Change | Effort | Impact |
|---|---|---|---|
| 1 | Every view type can be added (catalogue seed, self-heal, migration) | S | H |
| 2 | Add View closes on switch; Planner full day; dashboard previews | S | M |
| 3 | Phone layout at 390 px (strip, overflow, Inbox tab, one-row filters) | S | H |
| 4 | Saved views that save the view: server-stored filters, group, sort, columns and Me; save for everyone or for me; a default view | M | H |
| 5 | Custom-field columns and a column chooser in List and Table; Table inline edit; points on rows | M–L | H |
| 6 | Threaded and assigned comments, with an Inbox kind and a Home card | L | H |
| 7 | Task templates: save, apply in the add row and menu, a default per project | M | H |
| 8 | Project tree on project pages, one favourites store, a linked sprint crumb | M | M |
| 9 | Workspace import: a checklist step, a ClickUp importer, an export UI | M | M |
| 10 | Home opens the overlay panel; the tray survives a reload | S | M |
| 11 | Keyboard and accessibility basics: skip link, "?" sheet, `/`, `g h`, `g i`, high contrast, an accessibility statement | S | M |
| 12 | Recurrence and manual time in the task panel | M | M |
| 13 | The List row menu (archive, delete, move, duplicate) and List sorting | S–M | M |

Left for an owner decision: nested subtasks, tasks in several lists, views across projects (Everything), Goals, chat threads, docs presence and history.

## Sources

ClickUp (official):

- https://clickup.com/blog/clickup-4-0/ (2025-12-08)
- https://feedback.clickup.com/changelog (4.02–4.08, Feb–Sept 2026)
- https://clickup.com/accessibility
- https://clickup.com/import

Help Center, read from search snippets:

- https://help.clickup.com/hc/en-us/articles/31142608907543 (Intro to 4.0)
- https://help.clickup.com/hc/en-us/articles/32854720651543 (Home Sidebar)
- https://help.clickup.com/hc/en-us/articles/19063083658135 (Views Bar)
- https://help.clickup.com/hc/en-us/articles/6303499162647 (Custom Field types)
- https://help.clickup.com/hc/en-us/articles/29665520762647 (task layouts)
- https://help.clickup.com/hc/en-us/articles/33947959867543 (Inbox)
- https://help.clickup.com/hc/en-us/articles/23477062949911 (automation limits)
- https://help.clickup.com/hc/en-us/articles/6309030550167 (keyboard shortcuts)

Third party:

- https://www.zenpilot.com/blog/clickup-4-review/ (2026-07-06)
- https://www.workflowpicks.com/reviews/clickup-review/ (2026-06-25)
- https://www.morgen.so/blog-posts/clickup-review (2026-01-13)
- https://www.g2.com/products/clickup/reviews (2026)
- https://www.capterra.com/p/158833/ClickUp/reviews/ (2026)
