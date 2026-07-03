# Dashboard Enhancements v2 — On Leave card, drill-downs, period dropdowns, global date range

Four additive dashboard features on the home page. No existing endpoint semantics changed;
all new backend reads are companyId-scoped and read-only.

**Features**
1. **On Leave card** (`OnLeaveCard`) — leaves are managed as tickets in a PMS project
   (e.g. *Support → HR Support*). Card settings pick that project + the status(es) that
   mean "Leave approved". Card lists the tickets whose leave period (startDate–DueDate)
   overlaps the selected window, plus **AB/PR** headcounts:
   **AB (Absent)** = distinct applicants (first assignee of each ticket) · **PR (Present)** =
   active company members − AB.
2. **Project-count drill-downs** — Project Pulse (Active / Working counters + each type-mix
   bar), Active Projects, Projects by Type (each bar), Running Projects: clicking opens a
   modal listing the projects behind the number with **type + status** (+ *worked in period*
   for Project Pulse).
3. **Header period dropdown** — Project Pulse, Worked Tasks, Team Effort Breakdown,
   Team Logged vs ETA now use the card-header period `<select>` (like Running Projects)
   instead of a static "This Week" label.
4. **Global date range** — a from/to date picker at the top of the dashboard. Every
   period dropdown gains an **Auto** option (timerange 0): Auto cards follow the global
   range; the others keep their own preset. The global range persists per user
   (localStorage `dashboardGlobalRange_<userId>`), default = this week.

**Files**
- Backend: `Modules/UserDashboard/controller.js` (`getOnLeaveBoard`, `includeProjects`
  support in `getProjectUtilizationSummary` + `getProjectProgressMetric`),
  `routes.js` (`POST /api/v1/dashboard/on-leave`)
- Catalog: `utils/cardComponent.json` (OnLeaveCard entry; `auto_range` option on the four
  resource-card timerange fields)
- Frontend: `OnLeaveCard.vue`, `ProjectListModal.vue` (new); `ProjectPulseCard.vue`,
  `ProjectMetricsCard.vue`, `ProjectResourceCard.vue`, `WorkedTasksTableCard.vue`,
  `TeamCategoryBreakdownCard.vue`, `TeamLoggedVsEtaCard.vue`, `UsersByCategoryCard.vue`
  (drill-down / auto / label removal); `HomePage.vue` (range bar, provide, period cards);
  `useResourceWorkload.js` (`resolveCardRange`), `commonFunction.js` (card size),
  `locales/en.js`

## Prerequisites
1. **Restart the backend** (catalog is `require`d from `cardComponent.json` at boot).
2. Log in; have a project holding leave tickets with an "Approved" status, tickets with
   start/due dates in the current week.

## Test cases

| ID | Area | Steps | Expected | Status |
|----|------|-------|----------|:--:|
| OLV-01 | Catalog | Add Card → Resource Utilization | "On Leave" card listed with title/description. | ⬜ |
| OLV-02 | Setup | Add without configuring | Card shows the "pick the leave project" hint. | ⬜ |
| OLV-03 | Config | Settings ⚙ → Location = HR/Support project, Status = Approved → Save | Tickets overlapping the period appear: applicant (first assignee) avatar+name, ticket key/title, period (start – due), status chip in the status colour. | ⬜ |
| OLV-04 | AB/PR | With N distinct applicants on leave in range | AB = N; PR = active company members − N; Leave Tickets = row count. | ⬜ |
| OLV-05 | Overlap | Ticket spanning the whole window; ticket starting inside; ticket ending inside; ticket with no dates | First three counted; the dateless one excluded. | ⬜ |
| OLV-06 | Period | Header dropdown Today → This Month | Re-fetches; wider window ⊇ narrower; selection persists on reload. | ⬜ |
| DRL-01 | Project Pulse | Click the **Active** counter | Modal lists all active projects (name, type incl. In House by "IH" prefix, status, worked-in-period dot); count matches the counter. | ⬜ |
| DRL-02 | Project Pulse | Click the **Working** counter | Modal shows only projects with logged time in the period. | ⬜ |
| DRL-03 | Project Pulse | Click a type-mix bar (e.g. Hourly) | Modal shows only that type; row count = bar value. | ⬜ |
| DRL-04 | Active Projects card | Click the number | Modal lists the active projects; count matches. | ⬜ |
| DRL-05 | Projects by Type card | Click a bar | Modal filtered to that ProjectType. | ⬜ |
| DRL-06 | Running Projects card | Click the number | Modal lists active projects with logged time in the selected period. | ⬜ |
| DRL-07 | Modal UX | Esc / backdrop / ✕ | Modal closes; card unaffected; no console errors. | ⬜ |
| DRL-08 | Modal loading | Open a drill-down on a slow network | Shimmer **skeleton rows** (with table headers) show while loading; count in the title appears only after load. | ⬜ |
| DRL-09 | Status colours | Projects with different statuses in the modal | Each status renders a **coloured dot + status name** from the project's own `projectStatusData` palette (`textColor`); unmatched statuses fall back to a grey dot + humanized raw value. | ⬜ |
| PDD-01 | Period dropdowns | Project Pulse / Worked Tasks / Team Effort / Team Logged vs ETA | Header shows a period `<select>` (defaults: Today / This Week / This Week / This Week); the old in-card period label is gone. | ⬜ |
| PDD-02 | Persistence | Change a period, reload | Selection persisted (cardData.timerange) and data reflects it. | ⬜ |
| PDD-03 | Settings parity | Same timerange in settings ⚙ | Settings dropdown shows the value picked in the header (incl. Auto) and vice-versa. | ⬜ |
| GDR-01 | Global range | Dashboard top bar | Single **range picker** (CalenderCompo, same as timesheets): one input opens a two-date calendar with Current Week / Current Month presets and Apply/Cancel; default = this week; persists per user across reloads. | ⬜ |
| GDR-02 | Auto mode | Set a card's period to **Auto**, change the global range → Apply | Card re-fetches for the new window; non-Auto cards don't. | ⬜ |
| GDR-03 | Validation | Try to Apply with only one date picked / cancel mid-pick | Apply stays disabled until both dates are chosen; Cancel restores the previous range; future dates are selectable (needed for upcoming leaves). | ⬜ |
| GDR-04 | Cards with Auto | Running Projects, Work by Category, Project Pulse, Worked Tasks, Team Effort, Team Logged vs ETA, On Leave | All expose Auto and honour the global range. | ⬜ |
| OLV-07 | Avatars | Users with and without profile photos in the On Leave list | Photos render via the UserProfile atom (store `Employee_profileImageURL`, Wasabi keys handled); users without a photo get the default avatar — never a broken image. | ⬜ |
| OLV-08 | Ticket link | Click a ticket key/name in the On Leave list | The **TaskDetail sidebar** opens for that leave ticket (same as Active Time Trackers); closing it returns to the intact card. | ⬜ |
| PDD-04 | Refresh icons | All cards added in the recent dashboard PRs (Pulse, Active Work, Free Resources, Worked Tasks, Team Effort, Team Logged vs ETA, Tasks by Status/Project, Total Tasks, On Leave, …) | Header shows the refresh icon; clicking re-fetches that card only. | ⬜ |
| PDD-05 | Card skeletons | Reload the dashboard on a slow network | Every self-fetching card shows a shimmer **skeleton** while loading (shared `CardSkeleton` atom; counter blocks on Project Pulse / On Leave) — no bare "…" placeholders anywhere. | ⬜ |
| REG-01 | Regression | Existing cards, add/edit/remove/drag, refresh icons | Behave as before; `GET /api/v1/cardcomponent` returns 32 cards; no JSON parse error; no console errors. | ⬜ |
| REG-02 | Multi-tenant | Second company | On-leave rows/headcounts and drill-down lists show only that company's data. | ⬜ |

## Notes / assumptions
- **AB/PR** is interpreted as **Absent / Present** headcounts (attendance shorthand). The
  applicant is the ticket's **first assignee** — matches the HR-Support convention where
  the requester is assignee #1 and approvers are added after. If your workflow differs
  (e.g. creator = applicant), change `getOnLeaveBoard`'s `AssigneeUserId[0]` pick.
- On-leave board is **not role-gated** (same as the utilization summary): who-is-on-leave
  is team-visible information.
- Drill-down uses the same endpoints with `includeProjects: true` — no new list endpoints.
- The four resource cards keep their settings-modal timerange field; header dropdown and
  settings write the same `cardData.timerange`.
