# QA sweep — Tasks and collaboration (area `tasks`, prefix `TSK`)

Swept on the local beta server (`http://localhost:4000`, company `6a8ee973d625fca52e519a12` / Local360) as owner (in-app browser pane), and as admin, member and guest via one-hour demo-team tokens. Modules: Tasks, taskIndex, Comments, Reactions, CustomField, AdvancedGlobalFilter, GlobalSearch, History, RecentVisits, PersonalList, Notes, Clips, MediaFiles, storage, CloudStorage, Trash.

Known-issue exclusions from the brief were honoured: members have no permission rules in Local360 (`fix/member-permission-rules`), project edits skip membership (`fix/project-edit-membership`), the unauthenticated v1 route set in `fix/unauthenticated-v1-routes` (that branch adds only `/api/v1/removeCache`), guest role-id mismatch, refresh-token uniqueness. Findings below are additional and not covered by those branches. No destructive delete was executed against real data; the two data-loss findings are code-level with a safe read demonstration.

## Coverage

`STORAGE_TYPE=server`, so the 8 `Modules/storage/wasabi` routes are not registered on this instance and are marked N/A.

| Group | Routes | Exercised (owner) | admin | member | guest | anon |
|---|---|---|---|---|---|---|
| Tasks (`Modules/Tasks`) | 16 | 12 | 8 | 8 | 6 | 5 |
| taskIndex | 2 | 2 (UI) | 0 | 0 | 0 | 0 |
| Comments | 4 | 4 (UI+API) | 1 | 1 | 1 | 1 |
| Reactions | 1 | 1 | 1 | 1 | 1 | 1 |
| CustomField | 6 | 4 | 2 | 2 | 2 | 1 |
| AdvancedGlobalFilter | 9 | 5 | 3 | 3 | 3 | 3 |
| GlobalSearch | 1 | 1 | 1 | 1 | 1 | 0 |
| History | 1 | 1 | 1 | 1 | 1 | 1 |
| RecentVisits | 2 | 2 | 1 | 1 | 2 | 0 |
| PersonalList | 1 | 1 (UI+API) | 0 | 0 | 0 | 1 |
| Notes | 4 | 4 | 1 | 1 | 1 | 1 |
| Clips | 4 | 3 | 1 | 1 | 1 | 1 |
| MediaFiles | 2 | 2 | 0 | 0 | 0 | 1 |
| storage/server | 12 | 6 | 2 | 2 | 3 | 4 |
| storage/wasabi | 8 (N/A) | — | — | — | — | — |
| CloudStorage | 10 | 4 | 2 | 2 | 3 | 2 |
| Trash | 3 | 3 (UI+API) | 1 | 1 | 2 | 1 |
| **Total (server storage)** | **78** | **55** | **25** | **25** | **29** | **22** |

Screens opened as owner without console errors: Trash (`/:cid/trash`), Personal List (`/:cid/personal`), Project sprint board and Task Detail overlay (`/:cid/project/:id/s/:sprintId[/:taskId]`) — global search modal, custom fields, comments, reactions, notepad and clips panels reached through the project shell. The only console error seen was a benign 404 for a task-type thumbnail file missing from local `storage/` (no seeded binary), unrelated to the area code.

---

### TSK-01 — POST /api/v1/task/find runs a client-supplied aggregation pipeline (cross-collection read)

- Severity: **critical** (data leak)
- Role: any authenticated user (member, guest)
- Request: `POST /api/v1/task/find` body `{ findQuery: [ … arbitrary aggregation stages … ] }`
- Expected: the endpoint should only accept a constrained filter for the tasks collection, scoped to the caller's visible projects.
- Actual: `getTaskByQyery` (`Modules/Tasks/helpers/getTasksData.js:6`) takes the whole `findQuery` array from the body, runs `replaceObjectKey` on it, and passes it straight to `MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [taskQuery] }, 'aggregate')`. A `$lookup` stage reads any other collection in the tenant database.
- Reproduction: as `priya.frontend@demo.test`, `POST /api/v1/task/find` with
  `findQuery: [{ "$limit": 1 }, { "$lookup": { "from": "company_users", "pipeline": [{ "$project": { "roleType": 1 } }], "as": "x" } }, { "$project": { "n": { "$size": "$x" } } }]`
  returns `200 [{ n: 14 }]` — the caller has read the entire `company_users` collection (roles of every member) through the tasks endpoint. Any collection (sessions, users, invoices) is reachable the same way.
- Suspected file/line: `Modules/Tasks/helpers/getTasksData.js:6-38` (`getTaskByQyery`). Fix: reject any pipeline containing `$lookup`/`$unionWith`/`$out`/`$merge` and force a `$match` on the caller's visible `ProjectID`s; do not accept raw stages from the client.

### TSK-02 — PUT /api/v1/task dispatches an arbitrary Mongoose operation named by the client

- Severity: **critical** (data loss / auth bypass)
- Role: any authenticated user (member, guest)
- Request: `PUT /api/v1/task` body `{ firstParameter, secondParameter, key, isConvertFirstParameter, isConvertSecondParameter }`
- Expected: only a small allow-list of task operations should be dispatchable, gated by permission.
- Actual: `updateTask` (`Modules/Tasks/helpers/getTasksData.js:70`) validates the *body key names* but not the `key` *value*, then calls `MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [first, second] }, key)`. `key` is any Mongoose collection method, so `deleteMany`, `updateMany`, `findOneAndDelete` etc. run against the tasks collection with client-controlled arguments, bypassing every permission check.
- Reproduction (non-destructive): as `priya.frontend@demo.test`, `PUT /api/v1/task` with `{ firstParameter: {}, secondParameter: { _id: 1 }, key: "estimatedDocumentCount", isConvertFirstParameter: false }` returns `200 226` — an operation that is not a legitimate task edit executed and counted every task in the company. `key: "deleteMany"` with `firstParameter: {}` would remove all tasks; this was **not** executed against live data.
- Suspected file/line: `Modules/Tasks/helpers/getTasksData.js:70-115`. Fix: replace the dynamic `key` with an explicit whitelist (e.g. `findOne`, `find`) and route real edits through `taskMongo`/`PATCH /api/v2/tasks` which carry the permission guard.

### TSK-03 — Storage bucket routes have no tenant binding (cross-tenant read / delete)

- Severity: **high** (wrong scope enforcement, potential data loss)
- Role: any authenticated user
- Requests: `GET /api/v1/getBucket/:bucketId`, `GET /api/v1/getBucketSize/:bucketId`, `DELETE /api/v1/removeBucket/:bucketId`
- Expected: a caller may only read or remove the bucket of their own company.
- Actual: these routes are guarded by `verifyJWTToken` only (`Config/setMiddleware.js` `verifyJWTToken` list). `requireCompanyAud` inspects `body/params.companyId/query/companyid header` — none of which is the `:bucketId` path param — so when the attacker passes their own valid `companyid` header the check passes while `:bucketId` points at another company's bucket. `removeBucketOnStorage` (`Modules/storage/server/controller.js:165`) then `findOneAndDelete`s the global `buckets` row and `fs.rmdirSync`s `storage/<bucketId>` recursively. No membership/aud comparison against the bucket id.
- Reproduction: as guest, `GET /api/v1/getBucket/6a8ee973d625fca52e519a12` returns the bucket document (`200 [ {…} ]`). Only one company exists on this instance, so a second-tenant delete could not be safely demonstrated; the delete path was not executed. The missing scope is unambiguous in code.
- Suspected file/line: `Modules/storage/server/routes.js:7-15`, `Modules/storage/server/controller.js:165-215`. Fix: derive the bucket/company from the session and reject a `:bucketId` that is not the caller's company (or an owned attachment bucket).

### TSK-04 — POST /api/v1/getUserProfile and /api/v1/getTaskTypeImage are unauthenticated and mint signed URLs for any company

- Severity: **high** (auth bypass, cross-tenant file access)
- Role: unauthenticated (anon)
- Requests: `POST /api/v1/getUserProfile`, `POST /api/v1/getTaskTypeImage`
- Expected: minting a signed download URL requires a session scoped to the company owning the file.
- Actual: both routes are registered by `Modules/storage/server/routes.js:26-27` and appear in **neither** middleware list in `Config/setMiddleware.js`, so no JWT runs. `handleTaskTypeImageGet` (`common-storage/common-server.js:160`) signs `generateSignedUrl(req.body.companyId, req.body.path, …)` with the server `JWT_SECRET` for whatever `companyId`/`path` the anonymous caller supplies, and returns a `/api/v1/download/<companyId>/<path>?token=…` URL that the download route honours.
- Reproduction: anon `POST /api/v1/getTaskTypeImage` `{ companyId: "6a8f09301f05e701eaf45c9a", path: "setting/task_type/task.png" }` returns `200 { status: true, statusText: "http://localhost:4000/api/v1/download/6a8f09301f05e701eaf45c9a/setting/task_type/task.png?token=eyJ…" }` — a working signed URL for a company the caller has no session for. (The referenced demo file is absent from local `storage/`, so the follow-up download 404s here, but the URL is validly signed.) This is separate from `fix/unauthenticated-v1-routes`, whose diff adds only `/api/v1/removeCache`.
- Suspected file/line: `Modules/storage/server/routes.js:26-27`; add both paths to `verifyJWTTokenWithCRoute` and scope `companyId` to the session aud.

### TSK-05 — Global search returns tasks, comments, pages and projects from projects the caller cannot see

- Severity: **high** (data leak)
- Role: member, guest
- Request: `POST /api/v2/search` body `{ query }`
- Expected: results limited to projects the caller is a member of (and non-private sprints), matching the per-project visibility the sidebar enforces.
- Actual: `globalSearch` (`Modules/GlobalSearch/controller.js:14`) queries TASKS/PROJECTS/COMMENTS/PAGES filtered only by `companyId` and soft-delete — no `AssigneeUserId`/membership/`isPrivateSpace` filter.
- Reproduction: as `kabir.intern@demo.test` (guest, member of QA Sandbox only), `POST /api/v2/search { query: "Smoke" }` returns 7 tasks + 9 comments + 3 pages all from the `Local Smoke` project (a single-member owner project the guest is not on); `{ query: "Sweep" }` returns tasks from `Sweep Project W2*`. The guest reads task names, comment bodies and page titles of projects it has no access to.
- Suspected file/line: `Modules/GlobalSearch/controller.js:24-58`. Fix: resolve the caller's visible project ids first and `$in`-filter every branch (and drop private-sprint tasks/comments) as `AdvancedGlobalFilter.searchTasks` already does with its `sprintPrivacyFilter`.

### TSK-06 — Activity log is readable for any project in the company (no membership check)

- Severity: **high** (data leak)
- Role: member, guest
- Request: `GET /api/v1/activity-log?fromProject=true&projectId=<any project in company>`
- Expected: history returned only for a project the caller belongs to.
- Actual: `getActivityLog` (`Modules/History/controller.js:5`) matches `ProjectId`/`TaskId` from the query with only the `companyid` header scoping; there is no check that the caller is a member of that project.
- Reproduction: as `kabir.intern@demo.test` (not a member of `Sweep Project W2`), `GET /api/v1/activity-log?fromProject=true&projectId=6a9a9faf69b6a2b96f1ea5a0&skip=0&limit=5` returns `200` with a history row for that project.
- Suspected file/line: `Modules/History/controller.js:5-49`. Fix: verify project membership before running the aggregation.

### TSK-07 — Saved task/advanced filters have no ownership binding (IDOR)

- Severity: **medium** (broken access control on secondary data)
- Role: any authenticated user
- Requests: `GET /api/v1/task/filter/:userId`, `PUT /api/v1/task/filter/update`, `DELETE /api/v1/task/filter/delete/:cid/:id`, and the mirror `/api/v1/advance/filter/*`
- Expected: a user can only read/update/delete filters they own.
- Actual: `getFilter` (`Modules/Tasks/helpers/manageGlobalFilter.js:11`) queries by the `:userId` path param, and `updateFilter`/`deleteFilter` operate on a `_id`/`companyId` taken from the body/params with no comparison to `req.uid`. A caller can pass another user's id (or filter `_id`) and read, overwrite or delete their saved filters. The `AdvancedGlobalFilter` controller has the same shape (`getFilter`/`updateFilter`/`deleteFilter`).
- Suspected file/line: `Modules/Tasks/helpers/manageGlobalFilter.js:11-151`, `Modules/AdvancedGlobalFilter/controller.js:59-207`. Fix: bind every filter query/mutation to `req.uid`.

### TSK-08 — Recent visits are readable and writable for arbitrary users (IDOR)

- Severity: **medium**
- Role: any authenticated user
- Requests: `GET /api/v2/recent-visits?uid=<other user>`, `POST /api/v2/recent-visits`
- Expected: a user sees and records only their own recent visits.
- Actual: `listVisits` (`Modules/RecentVisits/controller.js:listVisits`) reads the list for whatever `?uid=` is supplied, and `recordVisit` takes the author from `userData.id` in the body rather than `req.uid`. A caller can read another user's recently-visited tasks and record visits as someone else.
- Reproduction: as guest, `GET /api/v2/recent-visits?uid=<admin userId>` returns the admin's list (empty here only because the admin had no visits yet); the handler applies no `req.uid` check.
- Suspected file/line: `Modules/RecentVisits/controller.js`. Fix: use `req.uid` for both the write author and the read filter; ignore body/query user ids.

### TSK-09 — Clip records are attributed to a client-supplied user id

- Severity: **low**
- Role: any authenticated user
- Request: `POST /api/v1/clips`
- Expected: the clip owner is the authenticated caller.
- Actual: `resolveUserId` in `Modules/Clips/controller.js` reads the user from `req.user`/`userid` header/`body.userId`/`body.userData.id`/`?userId=` and never from `req.uid` (unlike `Modules/Notes/controller.js`, which prefers `req.uid`). A member can create a clip owned by another user, and list another user's clips by passing `?userId=`.
- Suspected file/line: `Modules/Clips/controller.js` (`resolveUserId`). Fix: prefer `req.uid` as Notes does.

---

## Checks that passed

- Auth is enforced on the collaboration write/read APIs for anon callers: `POST /api/v2/reactions`, `GET /api/v1/notes`, `GET /api/v1/comments/get-paginated-messages`, `GET /api/v1/mediaFiles`, `GET /api/v1/cloud-storage/settings`, `POST /api/v2/tasks/bulk`, `PATCH /api/tasks/`, `POST /api/v1/project/personal`, `POST /api/v1/storage/uploadFileBase64`, `GET /api/v1/activity-log`, `GET /api/v1/customField` all return `401 Unauthorized` without a token.
- `POST /api/v2/tasks` is guarded by `requirePermission('task.task_create')` and `PATCH /api/v2/tasks` by `requireTaskActionPermission()` for PAT/MCP callers (Config/permissionGuard.js); the web JWT session path is intentionally unaffected.
- Response envelopes are consistent `{ status, statusText/data }` on Reactions, RecentVisits, Notes, Clips, Trash, GlobalSearch.
- Cross-company header spoofing is refused: a demo token with a `companyid` header for a different company returns `401` (JWT audience check in `Config/jwt.js`).
- `POST /api/v2/search` validates the query length (`< 2 chars` → `status:false`).
- `POST /api/v2/tasks/relations` (`action:list`) and `PATCH /api/v2/tasks` bulk-dispatch guards reject unknown/invalid actions with `status:false` rather than throwing.
- Trash: `GET /api/v2/trash` lists soft-deleted projects/lists/tasks/docs correctly and the owner Trash screen renders them; `restore`/`sample-data` validate `kind` and object-id inputs.
- Reactions toggle uses `timestamps:false` so reacting does not mark a comment edited (regression guard present in code).
- Comment edit/delete is author-or-privileged only, with a pin-only exception, in `Modules/Comments/controller.js:update`.
- Personal List screen creates the private `Personal`/`ME` project via `POST /api/v1/project/personal` (scoped to `req.uid`) and renders "Only you".
- CloudStorage settings are read-only per the area rule (no external account connected); `GET settings`/`providers` return the field catalogue and redacted config without exposing secrets.
