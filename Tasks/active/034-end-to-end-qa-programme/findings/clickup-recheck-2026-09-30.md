# What's left against ClickUp at build 645 (task 034, 2026-09-30)

This re-checks every gap in the three 2026-09-28 comparisons against the code at `14.36.0-beta.645` (`d7e144bf`), now that tasks 041, 042 and 043 and their follow-ups (builds 567–645) are merged:
- [AI UX](ai-ux-comparison-clickup-2026-09-28.md)
- [non-AI UX](ux-comparison-clickup-2026-09-28.md)
- [ClickUp AI hands-on](clickup-ai-hands-on-2026-09-28.md)

Status is taken from the code (file paths below), not from progress files. For ClickUp, the latest release is still 4.08 (2026-09-18); nothing newer shipped.

## ClickUp since the last comparison

- **4.08 (2026-09-18):**
  - a Meetings Hub for notes and recordings from SyncUps, Zoom, Meet and Teams;
  - Super Agent Clone and org-wide Agent Templates;
  - List "one assignee per group";
  - ZoomInfo through App Center MCP templates.
- **Pricing (unannounced, reported by third parties):** a quiet rollout of new plans named Core, Business, Business Plus, Enterprise and **MAX**. AI allowances are pooled into these plans, reported at $8/$24/$100 per user a month billed yearly. The public page still shows the old grid with the AI add-ons ($9/$28 per user).
- **Where to position against ClickUp (2026 reviews):**
  - slow at scale (over about 2,000 active tasks);
  - a steep learning curve;
  - bugs after fast releases;
  - a weak mobile app offline;
  - credits that expire monthly and agents that burn them;
  - approvals, form logic, audit logs and SAML/SCIM kept on higher tiers;
  - SaaS only.

## Closed since 2026-09-28 (highlights)

- **AI:**
  - Ask is the AI home and answers inside ⌘K.
  - Ask reads structure (project, status, assignee, due), keeps threads, streams answers, and can make tasks or a doc from an answer.
  - Chat AI buttons work.
  - One AI availability state; plain-language agents.
  - Agents in the assignee picker and in comments.
  - Preview before apply; AI on Home; personal memory; the agent catalogue and builder.
  - Scheduled agents, AI fields, `@ai` in comments and chat, notes to tasks, Automate with AI, AI assignment rules, and feedback with a Quality page.
- **Non-AI:**
  - every view type can be added;
  - saved views keep their setup;
  - custom-field columns and inline edit in Table;
  - threaded and assigned comments;
  - task templates;
  - project tree and favourites;
  - ClickUp import and workspace export;
  - one task detail;
  - keyboard and accessibility basics;
  - recurrence and time on the task;
  - List row menu and sort;
  - phone layout.
- **Already there, contrary to the earlier documents:**
  - Gantt baselines, critical path and dependency drag (`GanttView.vue`);
  - Inbox Later and reminders;
  - timesheet approval;
  - Me mode per view.

## Still open, ranked by user impact

| # | Gap | Effort | Where |
|---|---|---|---|
| 1 | Filter, group and sort by custom field; sort by points, estimate or assignee. Group options today are status, assignee, priority and due only. | M | `views/Projects/Projects.vue:763`, `TaskFilter/FieldsTable.vue`, `composables/viewSort.js`, `Modules/Project/helpers/viewSettings.js` |
| 2 | Missing custom field types: people, URL, rating, progress and files first; then location, relationship, button, signature, voting. | L | `composables/projectCustomFields.js:8`, `Modules/CustomField` |
| 3 | Docs: @mentions of people and docs, image upload (URL only today), and comments on docs (none at all). | M–L | `molecules/Pages/blockTools.js`, `PageBlockEditor.vue`, `Modules/Pages`, `Modules/MediaFiles` |
| 4 | Subtasks editable and selectable in List rows. | S–M | `ListView/ListRow.vue:12,101-123` |
| 5 | Retire the legacy BulkActionBar; add move-to-project and convert to ListBulkBar. | M | `Projects.vue:421,1043`, `ListView/ListBulkBar.vue` |
| 6 | Custom fields on Board cards (points only today). | S | `composables/viewColumns.js:55`, `Kanban/BoardViewDisplayCardComponent.vue` |
| 7 | Form responses link to the created task (key shown as text). | S | `FormsView/FormSubmissions.vue:44` |
| 8 | Automation rule template gallery and an "Automate" button in projects. | M | `views/Automations/AutomationsPage.vue`, `components/ProjectActionsBar.vue` |
| 9 | Recents: a Home card, and palette recents for projects, docs and sprints (tasks only today). | S–M | `Modules/RecentVisits/controller.js:36`, `CommandPalette.vue:331` |
| 10 | Restore settings on a new device. `localePreferences` is saved to the server (#1148) but read only from localStorage; the task tray is localStorage only. | S | `Settings/Language/localePrefs.js:50`, `TaskDetailOverlay/minimizedTray.js` |
| 11 | Task types decide which custom fields show (ClickUp 4.07). | M | `Modules/CustomField`, `projectCustomFields.js` |
| 12 | Stale agent templates: Field Filler still says "needs AI fields" after #1166; PRD Writer is blocked although the `page.draft` action exists. | S | `views/Ai/agentCatalogue.js:48-51`, `Modules/Agents/actions.js:307` |
| 13 | Burndown, Velocity and "Ask a question" dashboard cards (the report pages exist). | M | `plugins/dashboard/cardCatalog.js:104-105,114` |
| 14 | The ⌘K palette closes on a route change; retire the legacy GlobalSearchModal. | S / M | `CommandPalette.vue:535-549`, `ProjectFiltersToolbar.vue:209,237` |
| 15 | Invite entry in "+ New" and in the palette. | S | `views/Home/TodayOverdue.vue:16-21`, `CommandPalette.vue` |
| 16 | "Who can see this" explainer on projects, sprints and docs. | M | project share and permission panels |
| 17 | Board and List card-menu parity (Board lacks copy link, new tab and save as template; List lacks convert and merge). | S | `ListRowActions.vue`, `BoardViewDisplayCardComponent.vue:64-108` |
| 18 | Workload in points or task count (hours only). | S–M | `WorkloadView.vue:208-246` |
| 19 | `@agent` in chat and DMs to agents (`@ai` works; named agents need a task). | M | `Modules/Agents/triggers.js:23-27` |
| 20 | Home "Manage cards": add from the catalogue and reorder (show or hide 3 cards only). | M | `molecules/Home/homeCards.js`, `views/Dashboards/CardPicker.vue` |

**Also open, lower priority:**
- Moving a blocker in Gantt doesn't reschedule its dependants. S–M.
- Bulk approve for timesheets. S.
- AI fields limited to text and dropdown outputs. M.
- Login forces a full reload. S.
- The task tray has no height cap on phones. S.
- Whiteboard positions are per browser with no label. S.
- List density. S.
- View templates. M.
- "Post to chat" from an Ask answer. S.
- A PWA app shell. M.
- Two-way calendar sync. L.

## Waiting for an owner decision

- **Hierarchy:** nested subtasks (one level today, enforced in `Modules/Tasks/helpers/taskMongo/bulk.js:1002`); a task in several lists; subfolders.
- **Views:** an "Everything" view across projects; view templates.
- **Goals and OKRs.**
- **Chat threads** (task comments have threads, chat has quote-reply).
- **Docs** live cursors and version history (history was removed on purpose, `Modules/Pages/controller.js:29`).
- **In-form conditional logic** (the public form page runs no script by design, `Modules/Forms/publicForm.js:20`).
- **Connectors for agents** (Gmail, Calendar, Slack, one at a time); a meeting notetaker bot; a desktop hotkey app; a web-search tool so "Research this" can be shown; a PWA shell.

## Sources

- ClickUp changelog, fetched 2026-09-30: https://feedback.clickup.com/changelog
- Release Notes 4.08, 2026-09-18: https://feedback.clickup.com/changelog/release-notes-408
- Pricing page, fetched 2026-09-30: https://clickup.com/pricing
- PageDog pricing, 2026-09-12: https://www.pagedog.app/blog/clickup-pricing
- Releasebot tracker, updated 2026-09-19: https://releasebot.io/updates/clickup
- Morgen 30-day review, 2026: https://www.morgen.so/blog-posts/clickup-review
- CheckThat.ai review aggregation, 2026: https://checkthat.ai/brands/clickup/reviews
