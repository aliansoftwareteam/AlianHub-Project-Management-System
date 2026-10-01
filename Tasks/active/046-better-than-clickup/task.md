# 046 — The plan to be great next to ClickUp

Status: **confirmed by the owner on 2026-10-01** ("use the draft and start M1"). M1 is in progress; see `progress.md`.

## Goal
Reach a point where we can say, with evidence, that AlianHub is a great choice next to ClickUp. That means two things at once: the features people expect are there, and the product looks and feels finished. The owner asked for both on 2026-10-01: "need to work on both new feature + visual refresh".

"Great" here does not mean copying every ClickUp feature. It means that a team choosing between the two finds nothing important missing, finds the product pleasant and fast, and gets things ClickUp does not offer.

## What "great" means (the finish line)

The owner chose the recommended draft on 2026-10-01. The judge is a team of 5 to 200 people that wants control of its data and AI without per-seat credits. We call the product great when all seven hold:

1. **Nothing important missing.** Every area in the scorecard below is "Level" or "Ahead", except items the owner has declined in writing.
2. **Everyday work is as quick.** On a fixed list of 25 everyday jobs (create a task, plan a sprint, find last week's doc, report time, and so on), AlianHub needs the same or fewer steps than ClickUp on at least 22.
3. **Fast at scale.** With 10,000 tasks in one project, List and Board open in under 1.5 seconds and no click takes longer than 150 ms to respond. This is where ClickUp's own users complain.
4. **Looks finished.** Every screen uses the design system (no legacy colour classes, no hard-coded colours), is clean in dark mode and at 390 px, and the owner has signed off the 12 core screens.
5. **Our advantages are real and easy to show.** Self-hosted, the workspace's own AI model with no credits, a preview before AI writes anything, AI that only reads what the person may open, and a full audit trail.
6. **Stable.** No known serious bug, CI green, and the 30 most-used flows covered by end-to-end tests.
7. **Easy to switch.** A real ClickUp workspace imports with its tasks, comments, custom fields and docs.

## Where we stand today (honest scorecard)

Ratings: **Ahead**, **Level**, **Close** (small gaps), **Behind** (large gaps), **Not measured**. Based on the code audit at build 645 and the 19 slices merged since.

| Area | Today | What is missing |
|---|---|---|
| Tasks, List, Board, Table | Level | List density; Board and List menu parity |
| Custom fields | Close | Field types: people, URL, rating, progress, files; later relationship, location, button, voting |
| Views | Close | An "Everything" view across projects; view templates |
| Hierarchy | **Behind** | Subtasks one level deep; a task lives in one list; no subfolders; no Goals |
| Docs | Close | Version history and live presence (history was removed on purpose) |
| Chat | Close | Threads |
| Dashboards and reports | Level | Per-card settings on Home |
| Time tracking and timesheets | Level to Ahead | Bulk approve |
| Automations | Close | Triggers for "due date passed" and "all subtasks done"; a notify action |
| AI | Level, Ahead in principle | Connectors (Gmail, Calendar, Slack), web research, a meeting notetaker |
| Search and navigation | Level | — |
| Integrations | **Behind** | Few ready-made integrations; API tokens, webhooks and MCP exist. Two-way calendar sync is missing |
| Mobile | **Behind** | No app shell that works offline; no native apps; phone layouts exist |
| Look and feel | **Behind** | 274 of 662 components use the design system; about 58 files still use legacy white-page classes; about 2,900 hard-coded colours; date pickers have no dark theme |
| Speed at scale | **Not measured** | No test data set, no budgets, no measurements |
| Security, permissions, self-hosting, audit | Ahead | Two small access follow-ups recorded privately |
| Switching from ClickUp | Close | The importer exists; coverage of comments, attachments, fields and docs is unverified |
| Price | Ahead | No per-seat AI credits |

## The plan: three tracks, four milestones

The tracks run side by side. Each line below is roughly one pull request ("slice") unless marked L (two or three).

### Track A — Features
- **A1 Fields and views complete**
  - Field types: people, URL, rating, progress, files. Then relationship, location, button, voting.
  - AI fields use the new rating type; AI field columns sort from the Table header; number fields can be grouped.
  - View templates; List density; Board and List menu parity; bulk timesheet approve.
- **A2 Hierarchy** (needs the owner's decisions, see below)
  - Nested subtasks (L). Subfolders. An "Everything" view across projects (L).
  - A task in several lists (L). Goals and key results (L).
- **A3 Collaboration depth**
  - Chat threads. Doc version history and presence (L). Doc comments: assign, react, attach.
  - Whiteboard saved on the server. Two-way calendar sync (L). Form logic that needs no script on the public page.
  - Automation engine: the two missing triggers and a notify action; then restore the three adapted templates.
- **A4 AI lead**
  - A web research tool, so "Research this" can be switched on. "Post to chat" from an Ask answer.
  - Agent connectors, one at a time: Gmail, Google Calendar, Slack (L each).
  - Working-days setting for the company, used by Gantt shifts and agents.
  - Later, not in this plan: a meeting notetaker bot and a desktop hotkey app.
- **A5 Platform**
  - App shell that installs and opens offline (PWA). Importer coverage for comments, attachments, fields and docs.
  - A project template gallery. Public API reference.
  - Save a project as a template (moved here from M2 on 2026-10-01; "duplicate a project" was built in its place).
- **A6 MCP parity** (added on 2026-10-01 at the owner's direction)
  - An outside agent connected through MCP can do what a person does in the web app, under that person's access rules. A team can then work with Claude on its own plan without paying for AlianHub's AI API. This is a difference from ClickUp worth showing.
  - Part 1: update, assign, move, archive and restore tasks; set a field; list fields, subtasks and members.
  - Part 2: the list in `dogfood-findings.md`.
  - In-app AI (the Ask card, AI fields, Write with AI, agents that run unattended) still needs an API key on the server.

### Track B — Visual refresh
- **B0 Direction** (needs the owner's eyes; cannot be done in parallel)
  - Screenshot every screen: light, dark, desktop and 390 px. Score each against the 2026-09 redesign.
  - Refresh three reference screens (Home, List, Task detail) in two or three variants of density, type and elevation. The owner picks one.
- **B1 Design system**
  - Tokens only: a convention test with a shrink-only baseline for hard-coded colours and legacy classes.
  - One set of components: buttons, inputs, menus, dialogs, tables, date picker (with a dark theme), toasts, empty states, loading skeletons, icons.
  - A visual regression test that compares screenshots, so the refresh cannot slip back.
- **B2 Core screens** (where people spend most of their time)
  - Shell (rail, header, sidebar), Home, List, Board, Table, Task detail, Gantt, Calendar, Docs, Chat, Inbox, Dashboards.
- **B3 Legacy screens**
  - Timesheets, Settings, Reports, older dialogs. Remove the legacy stylesheets once nothing uses them.
- **B4 Finish**
  - Motion and transitions, optimistic updates, keyboard hints, illustrated empty states, a density switch, accent colour choice, a refreshed first-run tour.

### Track C — Proof and quality
- **C1 Speed at scale:** seed projects with 10,000 and 50,000 tasks; set budgets; measure; fix (virtual lists, paging, indexes). Publish the numbers.
- **C2 Phone:** every screen at 390 px, installable, readable offline.
- **C3 Reliability:** end-to-end tests for the 30 most-used flows; no console errors; a "no known serious bug" list kept in the repo.
- **C4 Switching:** import a real ClickUp export end to end and write the "move in ten minutes" guide.
- **C5 The benchmark:** the 25 everyday jobs, done side by side in ClickUp and AlianHub, with steps counted and recorded.

### Milestones

| Milestone | What ships | We can say |
|---|---|---|
| **M1 Foundation** | B0, B1, A1, the C1 data set and budgets, the C3 screenshot test | "The direction is agreed, fields are complete, and we measure speed." |
| **M2 Core** | B2, A2, C1 fixes | "The screens people live in look finished, hierarchy matches, and it is fast at 10,000 tasks." |
| **M3 Depth** | B3, A3, A5, C2 | "No legacy screens, collaboration matches, and it works on a phone." |
| **M4 Lead and proof** | B4, A4, C3, C4, C5 | "Great next to ClickUp", with the scorecard, the benchmark and the speed numbers to show for it. |

### How long
This is an estimate, not a promise.
- The plan is about 105 slices: Track A about 45, Track B about 40, Track C about 20.
- This week 19 slices merged in two working days, but that pace overloaded the PC. With agents leaving the test suites to CI, a steady pace is 8 to 10 merged slices a day.
- That is 11 to 13 working days of agent time. Add the owner's review at each milestone and the B0 choice, which only the owner can make.
- **Realistic: 4 to 6 weeks**, if decisions are answered within a day. M1 in week 1, M2 in weeks 2–3, M3 in weeks 3–4, M4 in weeks 5–6.
- The largest risks to that: nested subtasks and tasks in several lists (they touch every query), the doc history rebuild, and the connectors (each depends on an outside service).

## Decisions

On 2026-10-01 the owner said: "Don't wait for my input, you can continue work, you make your own decision." The integrator took every recommendation below on that day. Each is its own slice or a setting, so the owner can overrule any of them later.

| # | Decision | Decided |
|---|---|---|
| 1 | Who is the judge of "great"? | Teams of 5–200 that want control and AI without credits (the draft above) |
| 2 | Hierarchy: nested subtasks, subfolders, an Everything view, a task in several lists, Goals | Yes to nested subtasks (three levels), subfolders and Everything in M2; a task in several lists and Goals in M3 |
| 3 | Visual direction: finish the 2026-09 redesign, or start a new one | Finish and refine it: 274 components already use it |
| 4 | Phone: installable web app first, or native apps | Installable web app first; native later |
| 5 | Docs history and presence, removed earlier on purpose: bring back? | Yes, history first; presence after |
| 6 | Forms: allow a small script on the public form page for conditional logic? | Keep it script-free; do the logic with server-rendered steps |
| 7 | Where the working-days setting lives | Per company, with a per-project override |

### Taken during the work on 2026-10-01

The integrator took these while building, under the same instruction. The owner can overrule each one; the last column says how. Decisions 16, 17 and 26 are recorded from the PR descriptions; the others are in the integrator's notes. The ten hierarchy decisions are in `design-hierarchy.md`.

| # | Decision | Reason | The owner can overrule it by |
|---|---|---|---|
| 8 | The convention rule that hard-coded colours and legacy style classes may only shrink (a new Rule 5 in `CLAUDE.md`) stays in #1210 | It keeps the visual refresh from slipping back, the way the i18n baseline does | Dropping the rule before #1210 merges |
| 9 | Date pickers take the brand colours in light mode too (#1209) | One colour mapping serves both themes | A follow-up slice that restores the old light colours |
| 10 | The session stays on the owner's PC and is not moved to a cloud machine | A cloud session cannot rebuild the local server or check screens on it | Saying so; the session can be moved at any time |
| 11 | The access follow-ups were started without waiting, and local data was checked for roles with no private-projects setting (none found) | Both were open questions from the last handoff; see the private notes | Nothing to undo |
| 12 | A company that has not chosen a week works Monday to Friday, so Gantt shifts skip weekends by default (#1225) | The shift is previewed before it is applied, and ticking all seven days brings calendar days back | Ticking all seven days in Settings > General, or asking for a seven-day default |
| 13 | Erasure by person leaves doc version rows in place (#1231) | It matches the existing rule: erasure acts on the knowledge index only | A follow-up slice that also removes the person's versions |
| 14 | Version rows from the old doc history are shown to anyone who can read the doc now (#1231) | They were written before private docs existed | A follow-up slice that hides them |
| 15 | On copy and import paths, a people field keeps the people who pass the check and leaves the others out (#1236) | The task is still saved; the value is cut down, not dropped | A follow-up slice that refuses the whole value |
| 16 | Files field (#1243): files go through the existing upload route; removing a file from the field deletes it from storage; deleting the field or the task keeps the stored files; a duplicate copies field files only when "Attachments" is ticked; a files field cannot be sorted or grouped; imports, AI fields and automations cannot write one | Each matches what task attachments do today, and no new permanent deletion was added | A follow-up slice per rule |
| 17 | Creating a subtask under a parent in another project is refused, not followed (#1226) | The create permission is judged in the project the request names | A follow-up slice that checks both projects |
| 18 | Migration numbers: 064 task chains, 065 catch-up, 066 repair, 067 Everything indexes | N1 and N2 merged first, N3b needed its own repair, and the Everything indexes took the next free number | Nothing to undo; the numbers are merged |
| 19 | Nested subtasks merged as one unit: N1 and N2 first; N3a only together with N3b; then N3b, N4 (the List), and N5a (the task panel) last | A convert without chain upkeep would make a cascade carry the wrong rows, and after N3b a convert stores a third level that the List could not show yet | Nothing to undo; #1240 is the only part still open |
| 20 | "Duplicate a project" was built now in place of F3; "save a project as a template" moves to M3 | F3 as designed had nothing to keep: neither feature existed | Moving the template slice back into M2 |
| 21 | A duplicated project's tasks are copied by a quiet batch insert (#1257) | The normal create path would fire an event, every automation, a notification and two history lines for each row | A follow-up slice that writes history for the copies |
| 22 | A duplicated project links the source's project-level custom fields; it does not clone them (#1257) | Values, view settings and automations keep meaning the same field. Editing a definition then changes both projects | A follow-up slice that clones the definitions |
| 23 | A duplicated project leaves behind private lists the caller is not on, and its automations arrive switched off (#1257) | By design in #1257; the answer reports both | Turning the copied rules on; a follow-up slice for the lists |
| 24 | Design variant B (dense: 34 px rows, regular-weight group headers, squarer cards) is the default. The former look stays as "Classic", and the switch stays in My Settings (#1259, in review) | Most rows per screen, least name truncation, closest to a work tool. A is the fallback; C is too airy for lists | Picking another look in My Settings, or not merging #1259 |
| 25 | Under a due-date group, a task whose position is repaired goes after the project's last due-date position (#1255, in review) | A due-date group is a moving window of days, so no stored value names it | Asking for a date comparison before #1255 merges |
| 26 | On raw timesheet and planned-hours queries, a join into tasks or comments is narrowed the way a direct read is, and a join that cannot be narrowed is refused (#1244) | See the private notes | A follow-up slice |

## Out of scope
- A meeting notetaker bot and a desktop hotkey app.
- Native iOS and Android apps.
- ClickUp features outside project work: Clips, the built-in email client, CRM templates.

## Acceptance
- Each milestone ends with the scorecard updated in this file and the owner's sign-off.
- Every slice: failing test first, i18n for every string, dark mode and 390 px, stored fields declared in the schema, company-scoped reads, nothing shown that the viewer cannot open.
- Visual slices also update the screenshot baseline.
- M4 ends with three files in the repo: the scorecard, the 25-job benchmark, and the speed measurements.
