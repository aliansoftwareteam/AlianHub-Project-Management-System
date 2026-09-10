# Handoff coverage map

Every option id in `AlianHub Login Review.dc.html` (129 total), with its status as of 2026-09-04 (re-verified against the filesystem after wave 2 and the dogfood pass).
Verified against the filesystem, not assumed. This is the source for the AlianHub backlog in task.md.

| id | status | screen |
| --- | --- | --- |
| `24d` | built | Planner — one day at a time, drag from the tray below — `style.css` |
| `25e` | built | External data & coding agents — Notion 3.4's Workers/database-sync and externa — `ExternalData.vue` |
| `27a` | built | Three modes side by side. A workspace can allow more than one. — `AiAccounts.vue` |
| `27b` | built | Linking a personal account: an explicit, readable boundary — `AiAccounts.vue` |
| `27c` | built | Attribution: the team always knows who and what did the work — `AccountAttribution.vue` |
| `27d` | built | The awkward cases, decided in advance — `AiAccounts.vue` |
| `28a` | built | The pipeline — one task, five stages, one hard stop — `AiPipeline.vue` |
| `28c` | built | Release & deploy — the one screen where agent work meets production, and a hum — `AiRelease.vue` |
| `29b` | built | Where it appears — Done column, list column, and a filter — `ListRow.vue` |
| `10a` | built | Projects list — health, sprint, owner; empty state becomes a template picker — `ProjectsListPage.vue` |
| `10b` | built | Board view — views bar, WIP counts, AI Assist and agent activity in context — `BoardView.vue` |
| `10c` | built | Members — invite by email or link, role picked per invite with its one-line me — `*.vue` |
| `11c` | built | Portfolio report — one screen for the owner: health, burn-down, capacity, what — `*.vue` |
| `12d` | built | Dashboards Hub — shared dashboards with owners, plus your 30+ cards behind "+ — `DashboardsHub.vue` |
| `12e` | built | Mobile — Board (columns swipe), Chat, AI Inbox with swipe-to-approve — `MobileTabBar.vue` |
| `13b` | built | Agents as teammates — @mention in a comment, assign a task, and they appear in — `AgentTeammates*.vue` |
| `13c` | built | AI fields in Table view — summary, risk score, autofilled category; each cell — `TableView.vue` |
| `13d` | built | Automations — describe it in a sentence; the rule it compiles to is shown and — `*.vue` |
| `13e` | built | Connections — MCP servers, external agents, and app search sources; every conn — `ConnectionsPage.vue` |
| `13g` | built | Planner v2 — auto focus blocks around meetings, teammate availability, time zo — `Planner.vue` |
| `13h` | built | Team page — who's on what right now, one-click standup, workload balance, PTO — `*.vue` |
| `13i` | built | Ask — quick-action cards, sources it can search, Research mode for long report — `AskPage.vue` |
| `14a` | built | List — grouped by status, inline add per group, subtasks collapse, bulk bar on — `ListView.vue` |
| `14b` | built | Calendar — month with due dates, PTO and sprint bands; unscheduled tray on the — `*.vue` |
| `14c` | built | Gantt — dependencies, critical path, milestones, baseline vs actual, today lin — `*.vue` |
| `14d` | built | Workload — hours per person per day against capacity; PTO greyed; drag a task — `*.vue` |
| `14e` | built | Forms — builder with field mapping to task properties, live preview, and the " — `*.vue` |
| `16a` | built | Sprint report — one page a lead can read in 30 seconds: commitment vs done, sc — `SprintReport.vue` |
| `16b` | built | Velocity & cumulative flow — six sprints of history with a forecast band, and — `Velocity*.vue` |
| `16c` | built | Milestones — every dated commitment across projects, with what moved and why — `MilestonesReportPage.vue` |
| `16e` | built | Custom report builder — pick source, filters, grouping and a chart; save as a — `CustomReports.vue` |
| `17c` | built | Recurring tasks — the rule, the next few occurrences, and what happens if one — `*.vue` |
| `19a` | built | Contract setup — one screen, fixed-price or hourly, with the money maths visib — `BillingContract.vue` |
| `19b` | built | Hourly milestone — the same contract screen when billing is per hour: rates, c — `BillingHourly.vue` |
| `19c` | built | Invoice — drafted from the milestone or the month, with every line traceable t — `BillingInvoices.vue` |
| `19d` | built | Client view — a guest-safe page: progress, what needs their sign-off, invoices — `BillingClientView.vue` |
| `20a` | built | Card anatomy — every card obeys this, so 30 cards read as one product — `CardPicker.vue` |
| `20b` | built | My work — the personal family, incl. achievements and leave — `DashboardView.vue` |
| `20c` | built | Team & project — the shared family: pulse, live work, logged vs estimate, free — `DashboardView.vue` |
| `20d` | built | Chart, table and AI cards — plus the picker that keeps 30 cards findable — `CardPicker.vue` |
| `21d` | built | Relations, subtasks & quick menu — LinkedTasks, SubTasks, TaskQuickMenu, Proje — `TaskSubtaskList.vue` |
| `21e` | built | Sprints & folders — SprintsList + SideBarSprintFolderData: close a sprint and — `SprintsList.vue` |
| `22a` | built | Field builder — all 10 types in one list, with the type picker showing what ea — `FieldBuilder.vue` |
| `22b` | built | CSV import — four steps; the mapping step is where every import actually goes — `ImportWizard.vue` |
| `22d` | built | Language & region — 14 locales, and the two that change layout: RTL and non-La — `Language.vue` |
| `25c` | built | People directory — who does what, who's free, who reports to whom. Notion 3.2 — `PeopleDirectory.vue` |
| `28b` | built | Where it shows on screen — five places, all live, none of them a separate "AI — `TaskAgentStrip.vue` |
| `29c` | built | Rollups — sprint velocity and margin, split honestly — `AiAccounts.vue` |
| `30a` | built | The picker — agents ranked by fit for this task, with the reason stated — `AgentPicker.vue` |
| `30b` | built | Many at once — select tasks, route them, or write a rule so you stop doing it — `AgentRouting*.vue` |
| `30c` | built | When it's the wrong agent — decline, hand back, reassign — `AgentOutcomes.vue` |
| `10d` | built | Chat — channels per project, agent posts marked, make-a-task from a message |
| `10e` | built | Timesheet — your strength, in the new shell: week grid, live timer, approval s |
| `11a` | built | Skill library — a skill is a playbook (editable prompt), its allowed actions,  |
| `11b` | built | Audit log — humans and agents in one stream; every agent action links to its r |
| `11d` | built | Settings › Sign-in & SSO — providers as switches, SAML/OIDC with copy-paste va |
| `12a` | built | Task detail — opens as a right panel over any view; properties on the right, d |
| `12b` | built | Personal List — private, with its own views; the place to type before a projec |
| `12c` | built | Docs Hub — your collaborative Notes/Pages surfaced as a hub: recent, by projec |
| `12f` | built | Design spec — the tokens every screen above is built from. Hand to dev as CSS  |
| `13a` | built | New agent wizard — job → data & tools → autonomy & test; model picker with sco |
| `13f` | built | Meeting notes — from your existing call overlay: transcript, summary, action i |
| `15a` | built | Security & permissions — roles as columns, permissions grouped by object; agen |
| `15b` | built | Teams — a team is people + default projects + a default reviewer; used by work |
| `15c` | built | Integrations — connected first, each with what it actually does here; the rest |
| `15d` | built | Templates — what a template contains, shown plainly; create by hand or from a  |
| `16d` | built | Variance — estimate vs actual by project and person, so the next estimate is b |
| `17d` | built | Time off — request, balance, approval queue, and the team calendar it feeds |
| `17e` | built | Capacity planning — months ahead: committed work vs available hours per team,  |
| `18a` | built | My settings — profile, working hours that feed Planner and Workload, theme, se |
| `18b` | built | Notifications — a grid of event × channel, with quiet hours and one switch for |
| `18c` | built | Two-factor setup — QR, recovery codes, and what happens if you lose the device |
| `18d` | built | Inbox — notifications you can act on without leaving; Primary / Later split, a |
| `18e` | built | Search (⌘K) — one field for navigation, records, people, connected apps, and c |
| `18f` | built | Error & empty states — the four a self-hosted user actually hits |
| `18g` | built | Changelog — what shipped, what it means for the self-hoster, and whether an up |
| `21a` | built | Channel setup — from CreateChannelSidebar: who's in it, which project it belon |
| `21b` | built | Voice note & media — MainChatRecorder and MainChatMedia: record, transcribe, a |
| `21c` | built | Call — CallOverlay in a channel: start from chat, notetaker optional, screen s |
| `21f` | built | Product tour — TourComponet: four steps tied to the checklist, skippable and r |
| `22c` | built | Offline — the state a self-hosted user hits on a train: what still works, what |
| `24a` | built | Task detail — properties collapse into a sheet; comment box is always reachabl |
| `24b` | built | Log time — the one thing worth a dedicated mobile screen: fix a forgotten time |
| `24c` | built | Approvals — timesheets, leave and agent proposals in one queue for managers on |
| `25a` | built | Doc editor — slash menu, blocks, and the things a PM tool can do that a pure d |
| `25b` | built | Wiki — pages with an owner and a review date, so documentation stops rotting s |
| `25d` | built | Presentation mode — turn a doc or dashboard into slides for the client call, n |
| `26a` | built | Setup: one command per developer, one allow-list per agent |
| `26b` | built | What the agent sees: the task as a brief, not a ticket ID |
| `26c` | built | The loop back into AlianHub: findings as a comment, a PR link, time logged, hu |
| `26d` | built | The nine tools, and the rules that make this safe to switch on |
| `29a` | built | The completion record — three roles, never merged into one line |
| `5a` | built | Login — four labelled providers, SSO, magic link, inline error, footer links |
| `5b` | built | Auth states, one visual system — 2FA · resend verification · magic link sent · |
| `5c` | built | Home, day 30, light — global rail · Home sidebar with Favorites & Personal Lis |
| `5d` | built | Home, first run, dark theme — same shell; owner checklist, empty My Work with  |
| `5e` | built | Mobile — login and Today & Overdue |
| `6a` | built | SSO — email first, org detected, hand-off to the identity provider |
| `6b` | built | Personal List — private, its own views, always somewhere to type |
| `6c` | built | Planner — full page, week view, tasks dragged into time next to calendar event |
| `6d` | built | Docs hub — collab notes as first-class, with the same sidebar pattern |
| `6e` | built | Dashboards hub — shared dashboards, not per-user JSON files |
| `7a` | built | Task detail — collapsible sections left, comments / activity / relations in a  |
| `7b` | built | Inbox — Primary / Later tabs, reply inline, reminders arrive here on their due |
| `7c` | built | Settings › Security & Permissions — role descriptions, sensible defaults appli |
| `8a` | built | Signup — three screens, one question that seeds the demo project and template  |
| `8b` | built | Self-host install — database is the only required step; storage, mail, AI, pus |
| `8c` | built | Create Project — templates named after the job, each with a description, statu |
| `9a` | built | AI Hub — agents you run, what level they're on, what they did today |
| `9b` | built | AI Inbox — every proposal says what, why, and what it would change; approve, e |
| `9c` | built | Agent settings — skills, allowed actions (the safety boundary), autonomy, sche |
| `9d` | built | AI Assist inside a fresh project (AHE-3777) — requirements → plan preview (spr |
| `17a` | cut (handoff 23a) | Whiteboard — sticky clusters that convert to tasks; every converted note keeps |
| `17b` | cut (handoff 23a) | Mind map — project structure as a tree; each node is a real task, so editing h |
| `1a` | research/plan — no screen | Your current login, rebuilt from Login.vue + style.css. Numbered notes are the |
| `1b` | research/plan — no screen | Direction A — quiet card. Notion's approach: no marketing, providers first, on |
| `1c` | research/plan — no screen | Direction B — split with proof. ClickUp's approach, but the right half earns i |
| `23a` | research/plan — no screen | Five stages, roughly a quarter each |
| `23b` | research/plan — no screen | What actually differentiates AlianHub — worth protecting through every stage |
| `24e` | research/plan — no screen | Mobile rules — what earned a phone screen and what didn't |
| `25f` | research/plan — no screen | Deliberately not building — checked and rejected, with the reason |
| `2a` | research/plan — no screen | What a new user lands on today, rebuilt from Header.vue, Home.vue and HomePage |
| `2b` | research/plan — no screen | Redesigned Home. Preset layout from existing cards (Due Soon, My Time, Next Up |
| `3a` | research/plan — no screen | Login & auth |
| `3b` | research/plan — no screen | After login |
| `4a` | research/plan — no screen | Shell — how ClickUp 4.0 is laid out |
| `4b` | research/plan — no screen | Auth & onboarding |
| `4c` | research/plan — no screen | Communication |
| `4d` | research/plan — no screen | Work & views |
