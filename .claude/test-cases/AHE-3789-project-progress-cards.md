# AHE-3789 — Project-progress & resource dashboard cards

Five new **read-only** dashboard cards, added to the customizable card system.
All additive — no existing card, endpoint, or data path was modified.

> **Work by Category** (point 5) is the redesign of the earlier "Users by Work
> Category" prototype: **task count** per category (distinct tasks each user
> logged time on in the window), a **totals** row, and a team-split **summary
> bar**. All filters use the **standard edit-card settings modal** (Projects /
> Teams-Users / Include-subtasks) plus a category→task-type **template** editor
> embedded in that same modal — no separate config modal. Unmapped task types
> are **ignored** (no "Uncategorized"). **Active Time Trackers** (formerly "Live
> Work") is a table with a tracker-memo column.

**Cards**
| Card key | Title | Source |
|----------|-------|--------|
| `ActiveProjectsCard` | Active Projects | `metric: active_projects` (company-wide count) |
| `ProjectsByTypeCard` | Projects by Type | `metric: projects_by_type` (company-wide) |
| `RunningProjectsCard` | Running Projects | `metric: running_projects` (period) |
| `LiveWorkTableCard` | Active Time Trackers | `metric: live_work` — who's tracking now + task/project + tracker memo |
| `UsersByCategoryCard` | Work by Category | `metric: users_by_category` — task count per user, bucketed into user-defined categories |

**Files**
- Backend: `Modules/UserDashboard/controller.js` (`getProjectProgressMetric`), `routes.js` (`POST /api/v1/dashboard/project-metrics`)
- Frontend: `ProjectMetricsCard.vue` (Active Projects, Projects by Type), `ProjectResourceCard.vue` (Running Projects), `LiveWorkCard.vue` (Active Time Trackers), `UsersByCategoryCard.vue` (Work by Category), `CategoryTaskTypeMapper.vue` (category template, embedded in the edit-card modal), `CardFieldComponent.vue` (renders the mapper for this card), `DashBoardCard.vue` (header period + refresh), `HomePage.vue` (register/wire), `utils/cardComponent.json`, `composable/commonFunction.js`, `locales/en.js`

---

## Prerequisites
1. **Restart the backend** (catalog is `require`d from `cardComponent.json` at boot).
2. Frontend dev server / built app.
3. **Log in as Owner/Admin (roleType 1/2)** — Running Projects, Active Time Trackers & Work by Category are role-scoped for non-admins.
4. Seed: ≥ 3 active projects w/ different `ProjectType` + ≥ 1 closed; time logged today/this week across ≥ 2 task types; a running tracker (with a memo).

---

## Test cases

| ID | Card / area | Steps | Expected | Status |
|----|-------------|-------|----------|:--:|
| PPC-01 | Catalog | Add Card | "Project Progress" category lists **5** cards, readable titles/descriptions. | ⬜ |
| PPC-02 | Active Projects | Add | Company-wide count (`statusType !== 'close'`, not deleted); matches DB `activeProjects`. | ⬜ |
| PPC-03 | Projects by Type | Add | Bars per `ProjectType` sum to Active count; untyped → "Unspecified". | ⬜ |
| PPC-04 | Running Projects | Header period Today → wider | Distinct active projects with logged time in the period; grows for wider window; persists. | ⬜ |
| PPC-05 | Running Projects | Log time in a closed project | Not counted (active only). | ⬜ |
| PPC-06 | Active Time Trackers | Start a tracker (with memo) → refresh | Table row: name + live dot, task, project, **Working on** memo. Clicking the task opens the **TaskDetail sidebar**. | ⬜ |
| PPC-07 | Active Time Trackers | Header **N users tracking** + **user search** | Count = distinct users; table filters by user name; stop tracker + refresh → row leaves. | ⬜ |
| PPC-08 | Role — member | Non-admin views the activity cards | Reflects only **their** activity (role-scoped). | ⬜ |
| PPC-09 | Header UI | All cards | Refresh re-fetches; skeleton while loading; period dropdown (Running Projects, Work by Category) sits before the gear; cards resize narrow without the header breaking. | ⬜ |
| PPC-10 | Regression | Existing cards + add/edit/remove/drag | Work as before; **no console errors**. | ⬜ |
| PPC-11 | Boot integrity | Restart backend; `GET /api/v1/cardcomponent` | Returns **24** cards; no JSON parse error. | ⬜ |
| PPC-12 | Multi-tenant | Second company | Each card shows only the current company's data. | ⬜ |
| WBC-01 | Work by Category — first add | Add the card | Shows a **"Set up categories"** prompt pointing to the **⚙ settings** (no template yet). | ⬜ |
| WBC-02 | Settings — template | Card **settings (⚙)** → **Category template** → pick **Development**, tick 2 task types; pick **QA**, tick 1 → **Save** | Table columns appear per non-empty category; each ticked type belongs to exactly **one** category (re-ticking moves it). Template **persists** after reload. | ⬜ |
| WBC-03 | Data correctness | With time logged across the mapped types | Per-user rows show the **count of distinct tasks** they logged in each category (centered under each column header); **tfoot Total row** = column sums; summary bar segments match the category totals. | ⬜ |
| WBC-04 | Unmapped types | Log time on a task whose type isn't mapped to any category | It is **not** counted anywhere — no "Uncategorized" column; only mapped-category tasks appear. | ⬜ |
| WBC-05 | Settings — projects | Settings (⚙) → **Location** (project) picker → choose a subset → Save | Only the selected projects' logged time counts. | ⬜ |
| WBC-06 | Settings — teams/users | Settings (⚙) → **Show Assignees** → pick a team and/or users → Save | Only those users' time counts (team expands to member ids). | ⬜ |
| WBC-07 | Settings — subtasks | Settings (⚙) → **Include subtasks** off → Save | Time logged on subtasks (`isParentTask:false`) is excluded. | ⬜ |
| WBC-08 | Period + refresh | Change header period; click refresh | Re-fetches for the window; period persists on the card. | ⬜ |
| WBC-09 | Sorting | Click column headers | Rows sort by user / any category / total (asc↔desc). | ⬜ |
| WBC-10 | Role — member | Non-admin views the card | Only **their** logged time, still bucketed by the template. | ⬜ |

---

## Notes
- **Active Projects / Projects by Type** — server-side, company-wide (`statusType !== 'close'`, not deleted).
- **Running Projects** — distinct active projects with logged time in the period; role-scoped; header period dropdown.
- **Active Time Trackers** — trackers running within the last **10 min**; **Working on** = the tracker's `LogDescription`; user count + user search + click-to-open TaskDetail; refresh via header icon.
- **Work by Category** — per user, the **count of distinct tasks** they logged time on in the window, per category (bucketed via the task's `TaskType` against `categoryMap`); unmapped types are **ignored** (no uncategorized). **All filters live in the standard edit-card settings modal** (⚙): Projects (`projectId`/Location), Teams-Users (`AssigneeUserId`/Show Assignees), Include-subtasks (`isParentTask` toggle), and the **category template** via the embedded `CategoryTaskTypeMapper` — saved into `cardData` through the normal card-config submit path (no custom modal). Team ids (`tId_*`) expand to member user ids before the request. Period + refresh in the card chrome (default This Week); role-scoped.
- All queries are read-only and companyId-scoped.
