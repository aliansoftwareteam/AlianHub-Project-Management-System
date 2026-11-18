# Projects and planning — QA findings (task 034)

Area slug `projects`, finding prefix `PRJ`. Swept on the local server (http://localhost:4000,
beta, company `6a8ee973d625fca52e519a12` / Local360) as owner (browser pane), and via one-hour
demo tokens for admin (`rahul.manager`), member (`priya.frontend`, `arjun.backend`), and guest
(`kabir.intern`). Mutation data was created under the `[QA projects]` prefix and in QA Sandbox,
then archived/deleted; nothing `[QA projects]` remains (verified via the project list, feeds,
templates, folders).

Modules: Project, createProject, projectSetting, projectRules, projectTabs, projectClose,
ProjectTemplates, ProjectDashboard, Milestone, Epics, Sprints, Portfolio, CapacityPlanning,
Calendar, RecurringTasks.

## Coverage

### API routes — 89 registered, 89 exercised

Every route was hit at least once. Role columns: "exercised" means the route was called as that
role. Members have no role-3 permission rules in Local360 and the server's `requirePermission`
guard only runs for PAT (API-token) requests — JWT/web sessions bypass it (see
`Config/permissionGuard.js` "HARD ISOLATION") — so member/guest reached almost everything a
session can call.

| Module | Routes | owner | admin | member | guest | anon |
|---|---|---|---|---|---|---|
| Project | 15 | 15 | 15 | 15 | 15 | 2 |
| createProject | 2 | 2 | 2 | 2 | 2 | 1 |
| projectSetting | 7 | 7 | 7 | 7 | 7 | 0 |
| projectRules | 3 | 3 | 3 | 3 | 3 | 0 |
| projectTabs | 1 | 1 | 1 | 1 | 1 | 1 |
| projectClose | 2 | 2 | 2 | 2 | 2 | 1 |
| ProjectTemplates | 4 | 4 | 4 | 4 | 4 | 1 |
| ProjectDashboard | 1 | 1 | 1 | 1 | 1 | 0 |
| Milestone | 18 | 18 | 18 | 18 | 18 | 0 |
| Epics | 6 | 6 | 6 | 6 | 6 | 1 |
| Sprints | 12 | 12 | 12 | 12 | 12 | 0 |
| Portfolio | 6 | 6 | 6 | 6 | 6 | 1 |
| CapacityPlanning | 2 | 2 | 2 | 2 | 2 | 1 |
| Calendar | 4 | 4 | 4 | 4 | 4 | 2 |
| RecurringTasks | 6 | 6 | 6 | 6 | 6 | 0 |

`Milestone` v2 billing routes and the AI template/portfolio-summary generators were exercised up
to the LLM boundary only (no AI provider is configured locally; each returns its no-provider
branch). `POST /api/v1/recurring-tasks/run-due` and `/:id/run-now` were run against QA data.

### Screens — 15 in the area, 15 opened as owner

`/:cid/project` (list), `/:cid/project/:id/p`, `/:cid/project/:id/s/:sprintId`,
`/:cid/project/:id/s/:sprintId/:taskId`, `/:cid/project/:id/f/:folderId` (**PRJ-07**),
`/:cid/project/:id/fs/:folderId/:sprintId` (**PRJ-07**),
`/:cid/project/:id/fs/:folderId/:sprintId/:taskId`, `/:cid/project/:id/recurring`,
`/:cid/portfolio`, `/:cid/reports/capacity`, `/:cid/report/milestone`, `/:cid/reports/sprint`,
`/:cid/reports/velocity`, `/:cid/reports/milestones`, `/:cid/project/:id/billing`. All rendered
except the two folder routes (PRJ-07). No console errors on the others (capacity is
desktop-only by design and shows its copy on a narrow pane).

---

## Findings

### PRJ-01 — Personal calendar feed tokens are exposed to every company member
- Severity: **critical** (data leak)
- Role: member, guest (any authenticated company user)
- Request: `GET /api/v1/calendar/feeds`, then `GET /api/v1/calendar/ics/:token` (unauthenticated)
- Expected: a user sees only their own feeds; a personal ("my") feed's token, which grants
  unauthenticated read of that user's assigned-task list, is never handed to another user.
- Actual: `listFeeds` returns **every feed in the company, including the raw `token`**, to any
  member or guest. A guest listed the admin's personal feed and read the admin's `.ics`
  (assigned tasks with keys, names, due dates) by fetching `/api/v1/calendar/ics/<that token>`
  with no auth at all.
- Reproduction: as admin create a personal feed (`POST /api/v1/calendar/feeds {scope:'my'}`);
  as guest `GET /api/v1/calendar/feeds` — the admin feed and its token are present; fetch
  `/api/v1/calendar/ics/<token>` anonymously — returns the admin's task calendar (200,
  `text/calendar`).
- Suspected file/line: `Modules/Calendar/controller.js` `listFeeds` (~573-582) queries only by
  `companyId` and returns the token via `withUrl`; it should scope personal feeds to
  `userId === req.uid` and never expose other users' tokens.

### PRJ-02 — Private-project contents are readable by any company user by ID
- Severity: **critical** (cross-project data leak)
- Role: member, guest (users not assigned to the private project)
- Request: any by-ID read against a private project (`isPrivateSpace:true`) they are not a member
  of — e.g. `GET /api/v1/project/:id`, `POST /api/v1/get-remaining-projects {dataIds:[id]}`,
  `GET /api/v1/project/sprintFolder/:id`, `GET /api/v1/projectdata/taskData`,
  `GET /api/v1/project-dashboard/:id`, `GET /api/v2/epics?projectId=`,
  `POST /api/v2/sprints/burndown|hours|backlog`, `GET /api/v2/sprints/complete-preview|report`,
  `GET /api/v1/milestone/project/:pid`, `GET /api/v2/billing/contract|hourly|client-view`,
  `GET /api/v1/portfolio/:id/rollup`, `GET /api/v1/calendar/ics/:token` (project feed).
- Expected: the list endpoints already hide private projects a user is not assigned to
  (`getProjectList` / `project/search` do this correctly). Direct by-ID reads should apply the
  same membership check and refuse (404/403) for non-members.
- Actual: every by-ID read returns full private-project data to member and guest. The billing
  endpoints additionally leak internal money (logged hours, cost rate, margin, invoices). A
  guest-created project feed on a private project yields an `.ics` of that project's tasks over
  an unauthenticated URL.
- Reproduction: as admin create `POST /api/v1/createproject {isPrivateSpace:true, AssigneeUserId:[adminId]}`
  and add a task; as member/guest call any endpoint above with that project/sprint id — 200 with
  the data. The list endpoints correctly omit it for the same users.
- Suspected file/line: none of the read controllers check project membership for a JWT session —
  `Config/permissionGuard.js` deliberately bypasses enforcement for non-PAT requests
  ("HARD ISOLATION", ~line 60), and controllers such as
  `Modules/Project/controller/getProjectById.js`, `Modules/Epics/controller.js` `listEpics`,
  `Modules/Milestone/controller/billing.js`, `Modules/Sprints/*`, `Modules/Portfolio/controller.js`
  `getRollup`, `Modules/Calendar/controller.js` `getIcs` scope only by `companyId`. A shared
  project-membership guard is needed. (Distinct from the known `PUT /api/v1/project/:id` edit
  gap, which is not re-filed here.)

### PRJ-03 — Private-project contents are writable by any company user by ID
- Severity: **high** (wrong role/membership enforcement; data tampering)
- Role: member, guest (users not assigned to the private project)
- Request: by-ID writes against a private project they are not a member of — e.g.
  `POST /api/v2/epics` + `PUT/DELETE /api/v2/epics/:id` + `/assign` + `/:id/recount`;
  `POST /api/v1/sprint`, `PATCH /api/v1/sprint/:id` (editSprintName/updateSprint/deleteChannel),
  `POST /api/v1/folder`, `PATCH /api/v1/folder/:id`, `POST /api/v2/sprints/scrum|start|complete`;
  `POST /api/v2/billing/milestone`, `PATCH /api/v2/billing/milestone/:id`,
  `PUT /api/v2/billing/contract`, `POST /api/v1/draggablemilestone`,
  `POST /api/v2/billing/client-view/message`;
  `POST /api/v1/projectSetting/autoArchive|estimationScale|taskStatus/wipLimit`;
  `DELETE /api/v1/projectRules/delete/:pid`;
  `POST /api/v1/recurring-tasks` + `PATCH/DELETE /:id` + `/:id/run-now`;
  `POST /api/v1/calendar/feeds {scope:'project'}`; `PUT /api/v1/project/sprint/:id`.
- Expected: a non-member (especially guest) cannot mutate a private project's sprints, epics,
  milestones, settings, rules, recurring definitions or calendar feeds.
- Actual: all of the above returned 200/`status:true` as member and guest and persisted the
  change. E.g. a guest started and completed the admin's private sprint, renamed and deleted its
  folders, created a billing milestone and edited the contract, and created a recurring
  definition that then instantiated a real task.
- Reproduction: same private project as PRJ-02; run any write above as member/guest.
- Suspected file/line: same root cause as PRJ-02 — the `requirePermission` guards on
  `POST /api/v1/sprint` and `/api/v2/sprints/{scrum,start,complete}` (`Modules/Sprints/routes.js`)
  are bypassed for JWT sessions, and the other controllers do no membership/role check. Guest
  billing writes should also be blocked by `refuseGuest` but are not (see PRJ note on guest role
  id below).

### PRJ-04 — `PUT /api/v1/project/allTask/:id` ignores its own `:id`; `findObject` can reach another project's tasks
- Severity: **high** (cross-project mass mutation)
- Role: owner, admin, member, guest (reproduced for all)
- Request: `PUT /api/v1/project/allTask/<projectA>` with body
  `{ findObject: { ProjectID: <projectB>, _id: <taskInB> }, updateObject: { TaskName: "…" } }`
- Expected: the route updates tasks in the project named in the URL only; `findObject` should be
  constrained to `:id`.
- Actual: the controller builds `{ ProjectID: ObjectId(:id), ...req.body.findObject }` and
  `req.body.findObject.ProjectID` overrides the URL id, so an `updateMany` runs against a
  different project — including a private one the caller cannot otherwise touch. The task in
  project B was renamed. (`updateMany` also silently proceeds with no membership check.)
- Reproduction: create private project B with a task; as any role call
  `PUT /api/v1/project/allTask/<publicA>` with `findObject.ProjectID = B` and the task `_id`;
  read the task back — renamed.
- Suspected file/line: `Modules/Project/controller/projectAlltaskUpdate.js:21-31` — spreads
  `req.body.findObject` after setting `ProjectID`, letting the body overwrite the scope. Force
  `ProjectID` from the validated `:id` (set it last) and reject a conflicting `findObject.ProjectID`.

### PRJ-05 — `DELETE /api/v1/project/filter/delete/:cid/:id` trusts the URL company id
- Severity: **medium** (defense-in-depth / tenant scoping gap)
- Role: member, guest
- Request: `DELETE /api/v1/project/filter/delete/<anyCompanyId>/<filterId>`
- Expected: the company scope comes from the JWT audience; a company id in the URL that is not in
  the caller's token is rejected (as the header-based routes are).
- Actual: the controller calls `MongoDbCrudOpration(cid, …)` with the raw path param, and the
  `requireCompanyAud` middleware does not catch it because it inspects `req.params.companyId`
  while this route names the param `cid`. A foreign `cid` is accepted (returns 200/`status:true`);
  no cross-tenant row was actually deleted in the test only because the `_id` lives in a different
  database, but the tenant check is absent. `saveFilter`/`updateFilter`/`deleteFilter` all take
  the company id from the body/params rather than the token.
- Reproduction: `DELETE /api/v1/project/filter/delete/0000000000000000000000a1/<ownFilterId>`
  as guest → 200 `status:true`.
- Suspected file/line: `Modules/Project/controller/manageGlobalFilter.js` `deleteFilter` (~98)
  and `Modules/Project/routes.js:23` (param `:cid`); use `req.uid`/token company, or rename the
  param to `companyId` so `requireCompanyAud` enforces it. Related: `GET /api/v1/project/filter/:userId`
  returns another user's saved filters (IDOR, low sensitivity — filters carry no private data).

### PRJ-06 — Bad input returns HTTP 500 with a raw Mongoose/empty error instead of a clean 4xx
- Severity: **medium** (bad error handling; schema leak)
- Role: all
- Requests and actual responses:
  - `POST /api/v1/project/filter/create` with no `name` → **500**, body is a raw Mongoose
    `ValidatorError` (`GLOBALFILTER` requires `name`).
  - `POST /api/v1/project/template/custom` with a partial `data` object → **500**, body echoes the
    Mongoose validation error and leaks required schema field names
    (`ProjectRequiredDefaultComponent`, `ProjectCurrency`, …). A valid full payload works.
  - `POST /api/v1/get-remaining-projects` with no `dataIds` → **500** with an empty `error` object
    (the commented-out guard means `dataIds.map` throws).
- Expected: `{ status:false, statusText }` with a 4xx, matching the project response convention;
  never surface the schema or a stack.
- Reproduction: the three calls above.
- Suspected file/line: `Modules/Project/controller/manageGlobalFilter.js` `saveFilter`,
  `Modules/ProjectTemplates/controller.js` `createTemplate`,
  `Modules/Project/controller/getProjectFilterData.js` `getRemainingProject` (~1034, restore the
  `dataIds` guard).

### PRJ-07 — Folder and folder-sprint deep links throw and fail to open the folder view
- Severity: **medium** (broken secondary function)
- Role: owner (browser pane)
- Screen: `/:cid/project/:id/f/:folderId` and `/:cid/project/:id/fs/:folderId/:sprintId`
- Expected: opening/reloading a folder or folder-sprint URL renders that folder's board.
- Actual: on a fresh load the page throws repeated `TypeError: Cannot read properties of
  undefined (reading '<folderId>')` / `(reading 'length')` (minified `chunk-vendors`) and falls
  back to the plain project List view; the folder is never shown. The sibling routes `…/p`,
  `…/s/:sprintId` and `…/s/:sprintId/:taskId` load cleanly, so it is specific to the folder
  routes. Reproduced with a freshly created QA Sandbox folder + folder-sprint.
- Reproduction: create a folder and a sprint inside it; navigate to
  `#/<cid>/project/<pid>/f/<folderId>` and reload → console errors, redirect to the list.
- Suspected file/line: `frontend/src/views/Projects/Projects.vue:1073-1097` — reads
  `project.sprintsfolders[route.params.folderId].sprintsObj` before `sprintsfolders` is populated
  on a cold deep-link; guard the folder lookup until project data has loaded.

### PRJ-08 — `PUT /api/v1/project/filter/update` never reports success
- Severity: **low**
- Role: all
- Request: `PUT /api/v1/project/filter/update`
- Expected: updating an existing saved filter returns `status:true`.
- Actual: the controller passes `data: req.body` straight into a `findOneAndUpdate`, which returns
  `null`, so the endpoint answers `404 { status:false }` even when the caller-owned filter exists.
- Suspected file/line: `Modules/Project/controller/manageGlobalFilter.js` `updateFilter` (~71) —
  the Mongo op receives the wrong argument shape (needs `[filter, update, opts]`).

---

## Checks that passed

- **List endpoints hide private projects correctly.** `GET /api/v1/project` and
  `POST /api/v1/project/search` omit a private project a user is not assigned to, for member and
  guest (this is the correct behaviour that PRJ-02 by-ID reads violate).
- **companyId scoping via the JWT audience works** for header/body/query company ids: a foreign
  `companyid` on `GET /api/v1/project/:id` and `GET /api/v2/epics` is rejected (401/403 by
  `requireCompanyAud`).
- **Unauthenticated access is refused** (401) on every project/epics/portfolio/calendar/
  milestone/template/project-close route tried without a token; `POST /api/v1/createproject`
  anonymous → 401.
- **`PUT /api/v1/project-close` enforces owner/admin** — member and guest get a real 403 (this is
  the one server-side role gate in the area that works for web sessions, because it checks
  `company_users.roleType` directly rather than via `requirePermission`). `GET` is readable by
  any member, as intended.
- **Calendar `.ics` token validation** rejects a malformed token (400) and a missing feed (404).
- **Sprint lifecycle invariants** hold: `setScrum`/`startSprint`/`completeSprint` enforce
  one-active-sprint-per-project, require both dates, reject a completed sprint, and are
  idempotent on double-complete; `PATCH /api/v1/sprint/:id` rejects an unknown `type` (400) and
  only dispatches the allow-listed lifecycle actions.
- **Epic progress** is recomputed from live task status on read (`listEpics`), and a deleted epic
  soft-deletes and unlinks its tasks rather than deleting them.
- **Portfolio rollup / summary** compute from real project + task + milestone data; with no AI
  provider the summary returns `{summary:null, reason:'no-provider'|'no-projects'}` rather than
  erroring, and `summary` with no `portfolioId` is rejected.
- **CapacityPlanning** requires `from`/`to` (400 otherwise) and returns per-user capacity minus
  approved PTO.
- **Screens render** without console errors as owner: projects list, project shell, sprint view,
  sprint-task, recurring tasks (empty state), portfolio (with digest), capacity (desktop),
  milestone report, sprint report, velocity/flow, milestones report, and project billing.

## Notes / blocked

- The **guest billing refusal** (`refuseGuest` in `Modules/Milestone/controller/billing.js`
  checks `roleType === 4`, but the seeded guest is `roleType 0`) does not fire, so guests reach
  the billing money endpoints. This is the already-known **guest role-id mismatch**
  (`fix/guest-role-id`); it is the reason PRJ-02/PRJ-03 also expose billing to the guest, and is
  not re-filed.
- Member/guest reaching write endpoints at all is the already-known **member-permission-rules**
  gap (`fix/member-permission-rules`) combined with the JWT bypass in `permissionGuard.js`;
  PRJ-02/03 record the concrete private-project consequences, which are broader than a missing
  rule set (the by-ID endpoints have no membership check even for a correctly-configured member).
- AI-backed paths (`project/template/custom/ai-generate`, `portfolio/summary`) were tested only
  to their no-provider branch — no AI provider is configured locally.
