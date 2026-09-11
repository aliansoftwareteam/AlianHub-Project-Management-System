# Findings — Instance and administration

Area modules: Instance, settings, Admin, Audit, common, Template, swaggerAPI, typesense.
Swept 2026-09-11 on the local server (beta, builds 14.36.0-beta.68 to beta.73 while other merges landed), company Local360, and in the throwaway harness (Mongo on 27110).

Specs: `tests/integration/instance.int.test.js`, `e2e/specs/instance.spec.js`.

## Coverage

Routes are every `app.get|post|put|patch|delete|use` the area modules register, plus `/health` and `/version` from `index.js`.

| Module | Routes |
|---|---|
| Instance (`/api/v2/instance/*`) | 21 |
| Audit (`/api/v1/audit-logs*`) | 3 |
| settings (Members 7, templates 14, ProjectStatusTemplate 4, settingMilestone 4, settingNotifications 3, Roles 2, Designation 2, ProjectSkills 2, securityPermissions 2, settingCurrency 2, taskPriority 2, fileExtensions 2, commonDateFormate 2, Category 1, CompanyUserStatus 1, restrictedExtensions 1) | 51 |
| common (`getTime`, `getEmailTemplates`, `/connections/:id`, `versionUpdateNotify`) | 4 |
| Admin (`getlogo`, `getBrandSettingsData`) | 2 |
| swaggerAPI (`/apidocs`) | 1 |
| typesense | 0 (a schema file only, no routes, nothing wired) |
| `/health`, `/version` | 2 |
| **Total** | **84** |

Routes exercised, per role:

| Role | Local server | Harness (integration + Playwright) |
|---|---|---|
| Owner (Local PM, browser session) | 38 (every read of the console, audit, settings, admin routes; no mutations, per area rules) | 62 |
| Admin (rahul.manager / fixture admin) | 53 | 44 |
| Member (priya.frontend, sara.qa / fixture member) | 53 | 47 |
| Guest (kabir.intern / fixture guest) | 53 | 52 |
| No session | 53 | 55 |
| **Any role** | 55 | 81 |

Not exercised anywhere: `PUT /api/v1/setting/taskType`, `PUT /api/v1/setting/taskStatus`, `PUT /api/v1/setting/projectStatus` (each appends a permanent entry to the company catalogue and has no delete route, so they were kept out of both Local360 and the shared harness), and the success path of `POST /api/v1/audit-logs/:id/undo` (needs an agent action row; the 404 path was exercised).

Screens (from `frontend/src/router/settings/index.js`): 16 in the area — Instance Health, Settings, Backups, Upgrade, Logs, Stats; Settings General, Language & Region, Members, Projects, Templates, Security & Permissions, Notifications, Company, Time Tracking, Audit Log.

| Role | Local server | Harness |
|---|---|---|
| Owner | 16 of 16 opened | 16 of 16 opened |
| Admin | — | 2 (Notifications shell, Instance address) plus Audit Log link |
| Member, guest | — | 2 each (Notifications shell, Instance address) |

## Findings

| Severity | Count | Ids |
|---|---|---|
| Critical | 5 | INS-01, INS-02, INS-03, INS-04, INS-05 |
| High | 2 | INS-06, INS-07 |
| Medium | 4 | INS-08, INS-09, INS-10, INS-11 |
| Low | 1 | INS-12 |

### INS-01 — A member can promote themselves to owner through `PUT /api/v1/members`

- **Severity:** critical (privilege escalation)
- **Role:** member (any signed-in member of the company)
- **Request:** `PUT /api/v1/members` with `{ id: <own company_users _id>, data: { roleType: 1 } }`
- **Expected:** refused (403); only an owner grants owner or admin, and only a user with `settings.settings_member_list` edits members.
- **Actual:** 200 `{status: true}`; the stored `roleType` becomes 1. Confirmed in the harness: a fresh member read back `roleType` 3 before and 1 after. Owner-only routes open for them once the 60-second role cache (`roleType:<company>:<uid>`) expires.
- **Reproduce:** sign in as a member; `GET /api/v1/members/<own userId>` to read `_id`; send the PUT above; `GET` again as the owner.
- **Suspected:** `Config/permissionGuard.js:172` — `requirePermission` returns `next()` for every request that is not an API token, so the route guard in `Modules/settings/Members/routes.js:15` never runs for the web app; `Modules/settings/Members/controller.js:248` limits the owner-only role check to `req.apiToken`. The controller `$set`s whatever `data` holds.
- **Fix direction:** enforce the owner/admin rule for session requests too (at least for `roleType`, `status`, `isDelete`), and allow-list the fields a member may change.
- **Regression test:** `INS-01 refuses a member promoting themselves to owner through PUT /api/v1/members` (`it.failing`).

### INS-02 — A guest can promote themselves to admin through `PUT /api/v1/root-members`

- **Severity:** critical (privilege escalation)
- **Role:** guest (any signed-in user)
- **Request:** `PUT /api/v1/root-members` with `{ id: <own company_users _id>, data: { roleType: 2 }, companyId }`
- **Expected:** refused; this route exists for invite acceptance and should only link `userId` and set `status` on the caller's own pending invite.
- **Actual:** 200 `{status: true}`; stored `roleType` goes from 0 to 2 (harness).
- **Reproduce:** as a guest, read your own `company_users` row from `GET /api/v1/members/<userId>`, send the PUT above, read it back as the owner.
- **Suspected:** `Modules/settings/Members/controller.js:377` (`rootUpdateMember` spreads `data` into `$set` with no field allow-list); `Modules/settings/Members/routes.js:16` relies on the same API-token-only `requirePermission`; `Config/setMiddleware.js` lists it under `verifyJWTToken`, which checks the session but not the role.
- **Regression test:** `INS-02 refuses a guest promoting themselves to admin through PUT /api/v1/root-members` (`it.failing`).

### INS-03 — Notification settings are readable and writable without a session

- **Severity:** critical (authentication bypass)
- **Role:** no session
- **Requests:** `GET /api/v1/notifications/:userId` and `PUT /api/v1/notifications`, with only a `companyid` header.
- **Expected:** 401 without a session; a user can only read or change their own settings.
- **Actual:**
  - On Local360, an anonymous `GET /api/v1/notifications/<userId>` returned 200 with the user's full notification settings.
  - In the harness, an anonymous `PUT` flipped another member's `chat.items[0].email` from false to true (`modifiedCount: 1`).
  - The GET also runs `ensureNotificationDefaults` for any `companyid` value, so an anonymous caller can create databases. On local Mongo, my sweep's single request with a made-up company id created database `0123456789abcdef01234567` holding one `notifications_settings` document; see "Could not do" below.
- **Reproduce:** `curl -H 'companyid: <companyId>' http://localhost:4000/api/v1/notifications/<userId>`.
- **Suspected:** `Config/setMiddleware.js:139-140` lists `'api/v1/notifications'` and `'api/v1/notifications/:id'` without the leading slash, so the JWT middleware never matches them (`/api/v1/notifications/preferences` on line 232 is correct and guarded). `Modules/settings/settingNotifications/controller.js:8` takes `userId` from the body and never compares it with `req.uid`; `:90` creates defaults for any company. Not covered by `fix/unauthenticated-v1-routes`, which only adds `/api/v1/removeCache`.
- **Regression tests:** `INS-03/INS-04 refuses /api/v1/notifications/<id> without a session`, `INS-03 refuses an anonymous change to someone else notification settings` (`it.failing`).

### INS-04 — Project skills can be changed without a session; milestone range readable without one

- **Severity:** critical (authentication bypass on a company setting write)
- **Role:** no session
- **Requests:** `PUT /api/v1/setting/skills` `{ operation: 'add', name }`; `GET /api/v1/setting/skills`; `GET /api/v1/milestoneRange`; each with only a `companyid` header.
- **Expected:** 401.
- **Actual:**
  - `PUT` returned 200 and stored `{ key: 49, name: 'Anonymous Skill', active: true }` (harness).
  - Both GETs return 200 on Local360, and also for a company id the caller does not belong to.
- **Reproduce:** `curl -X PUT -H 'companyid: <companyId>' -H 'content-type: application/json' -d '{"operation":"add","name":"x"}' http://localhost:4000/api/v1/setting/skills` (harness only).
- **Suspected:** neither `/api/v1/setting/skills` nor `/api/v1/milestoneRange` is in either list in `Config/setMiddleware.js`; `Modules/settings/ProjectSkills/routes.js:6` relies on `requirePermission`, which passes non-token requests (`Config/permissionGuard.js:172`).
- **Regression tests:** `INS-03/INS-04 refuses /api/v1/milestoneRange|/api/v1/setting/skills without a session`, `INS-04 refuses an anonymous project skill write` (`it.failing`).

### INS-05 — `PUT /api/v1/currency/:cid/:id` writes to the company named in the path

- **Severity:** critical (cross-tenant write)
- **Role:** admin (any signed-in member)
- **Request:** `PUT /api/v1/currency/<another companyId>/<currencyId>` `{ key: '$set', updateObject: {...} }` with the caller's own `companyid` header.
- **Expected:** refused unless the path company is the session's company.
- **Actual:** 200 with the other database's update result (`acknowledged: true, matchedCount: 0` against a made-up company; a real company id with a matching currency `_id` would be modified). The client also chooses the update operator (`key`).
- **Reproduce:** harness, as admin: `GET /api/v1/currency`, take `_id`, send the PUT with a different 24-hex company id.
- **Suspected:** `Modules/settings/settingCurrency/controller.js:35` uses `req.params.cid` for `MongoDbCrudOpration`; `verifyJWTTokenWithCV2` (`Config/jwt.js`) only checks the `companyid` header against the token audience.
- **Regression test:** `INS-05 refuses a currency write aimed at another company` (`it.failing`).

### INS-06 — Company settings writes have no role check, and some accept arbitrary update documents

- **Severity:** high (wrong role enforcement)
- **Role:** guest (and therefore member)
- **Requests, all accepted for a guest in the harness:**
  - `PUT /api/v1/setting/roles/update` and `PUT /api/v1/setting/designation/update`: `{ queryFilter, queryObj }` is passed straight to `findOneAndUpdate` with `upsert: true` on the settings collection. A guest wrote `qaMarker` onto the real `roles` document and could just as well overwrite or `$unset` the role catalogue.
  - `PUT /api/v1/commonDateFormate`, `PUT /api/v1/taskPriority`, `PUT /api/v1/fileExtensions`, `PUT /api/v1/milestoneStatus`: the client picks the update operator through `key`.
  - `POST /api/v1/templates/taskStatus` (and the other template create, update and delete routes).
  - `PUT /api/v1/securityPermissions`: a guest modified a permission rule document (`modifiedCount: 1`), so a guest can grant themselves any permission.
- **Expected:** refused for anyone below admin, or below the matching `settings.*` permission; never a client-supplied filter or operator.
- **Actual:** 200 for every request above.
- **Reproduce:** harness, as guest: `PUT /api/v1/setting/roles/update` `{ "queryFilter": { "name": "roles" }, "queryObj": { "$set": { "qaMarker": true } } }`.
- **Suspected:** `Modules/settings/Roles/controller.js:40`, `Modules/settings/Designation/controller.js:40`, the `update*` handlers in `commonDateFormate`, `taskPriority`, `fileExtensions`, `settingMilestone`, `templates`, `ProjectStatusTemplate`; `Modules/settings/securityPermissions/routes.js:11` and `ProjectSkills/routes.js:6` rely on `requirePermission`, which is API-token-only (`Config/permissionGuard.js:172`). `ProjectSkills` already shows the safer shape (explicit operations, no passthrough).
- **Regression tests:** `INS-06 refuses a guest on <route>` (7 routes) and `INS-06 refuses a guest editing a security permission rule` (`it.failing`).

### INS-07 — Instance settings cannot be saved from the owner's session

- **Severity:** high (broken core function)
- **Role:** owner
- **Request / screen:** Settings › Instance › Settings, change any value, Save → `PUT /api/v2/instance/settings`.
- **Expected:** 200 "Saved." and the value applied.
- **Actual:**
  - The API answers 400 `{ statusText: 'Some settings are not valid.', data: { errors: { refreshToken: 'unknown' } } }` for every session request.
  - On screen nothing happens: `InstanceSettings.vue` copies the field errors into `errors`, but no field row exists for `refreshToken`, so no toast and no error is shown.
  - Saving only works with `INSTANCE_ADMIN_KEY`.
- **Reproduce:** harness, as owner: `PUT /api/v2/instance/settings` `{ "APP_NAME": "x" }`. On Local360 this was not attempted (area rule: no instance setting changes).
- **Suspected:** `Config/jwt.js:229` (`checkToken` writes `req.body.refreshToken`) meets `Modules/Instance/controller.js:30` → `validateSettings` (`Modules/Instance/settingsCatalog.js:80`), which rejects unknown keys. Drop `refreshToken` before validating (other controllers allow-list it), and have `InstanceSettings.vue:131-133` toast errors that match no row.
- **Regression tests:** `INS-07 saves a setting from the owner session, shows it in the public config and restores it` (`it.failing`), `INS-07 saves a changed setting from Instance > Settings` (`test.fail`).

### INS-08 — Audit log CSV export stops at 100 rows

- **Severity:** medium
- **Role:** owner, admin
- **Request:** `GET /api/v1/audit-logs/export?entityId=<id>` for a filter with 101 rows.
- **Expected:** every row of the filter, up to the documented 1000 cap.
- **Actual:** 100 rows; the list reports `metadata.total: 101`.
- **Reproduce:** harness: 101 × owner `PUT /api/v1/members` on one member, then export with `entityId`.
- **Suspected:** `Modules/Audit/controller.js:123` asks `listAuditLogs` for `limit: 1000`, but `:70` caps `limit` at 100.
- **Regression test:** `INS-08 exports every row of the filter, not only the first 100` (`it.failing`).

### INS-09 — Audit rows take the actor name from the request body; CSV cells are not neutralised

- **Severity:** medium (audit integrity)
- **Role:** any caller of an audited route
- **Request:** `PUT /api/v1/members` with `userData: { name: '=HYPERLINK("http://example.invalid","Rahul")' }` in the body.
- **Expected:** `actorName` resolved from `req.uid`; exported cells starting with `= + - @` prefixed so a spreadsheet does not run them.
- **Actual:** the audit row stores the body-supplied name and the export writes it unchanged.
- **Suspected:** `Modules/Audit/recorder.js:27` (`actorName: userData.name || ...` from `req.body.userData`); `Modules/Audit/controller.js:129` and `Modules/Instance/controller.js` `csvCell` escape quotes only.
- **Regression test:** `INS-09 records the signed-in actor, not a name from the request body` (`it.failing`).

### INS-10 — A member can edit another member's private views

- **Severity:** medium
- **Role:** member
- **Request:** `POST /api/v1/members/private-view` `{ id: <another member's company_users _id>, operation: 'push', data: {...} }`
- **Expected:** refused unless `id` is the caller's own row.
- **Actual:** 200 `{status: true}`; the view is pushed onto the other member's `ProjectRequiredComponent` (harness). `delete` and `update` work the same way.
- **Suspected:** `Modules/settings/Members/controller.js:156` (`handlePrivateView` never checks `req.uid` against the row's `userId`).
- **Regression test:** `INS-10 refuses a member editing another member private views` (`it.failing`).

### INS-11 — `POST /api/v1/versionUpdateNotify` works without a session

- **Severity:** medium (unauthenticated write, limited to one flag)
- **Role:** no session
- **Request:** `POST /api/v1/versionUpdateNotify` `{ flag: true|false }`
- **Expected:** 401; only the instance owner (or the release process) sets it.
- **Actual:** 200 `{status: true}`; `users.isVesionUpdate` of the product owner is set to the body value.
- **Suspected:** `Modules/common/routes.js:59` with no entry in `Config/setMiddleware.js`; `Modules/common/controller.js` updates the owner record unconditionally.
- **Regression test:** `INS-11 refuses an anonymous version update flag` (`it.failing`).

### INS-12 — `GET /api/v1/getTime` without a zone answers 200 with plain text

- **Severity:** low
- **Role:** any
- **Request:** `GET /api/v1/getTime`
- **Expected:** `{ status: false, statusText: 'zone is required' }` with a 400.
- **Actual:** 200 `No zone specified` as text; the success path is a bare JSON string rather than `{status, data}`. The sibling `getEmailTemplates` also returns a bare object with the misspelt key `invitationEamil`.
- **Suspected:** `Modules/common/routes.js:13-25`.
- **Regression test:** `INS-12 answers getTime without a zone with the standard error shape` (`it.failing`).

## Checks that passed

- `/version`, `/health`, Instance › Stats and Instance › Upgrade all show the beta build label on Local360 (`14.36.0-beta.73`, channel `beta`, commit and build log present; Upgrade lists 20 builds and "Next release: v14.36.0"). The harness asserts the four agree.
- The instance console guard: all 20 admin routes answer 403 for admin, member and guest, and 401 without a session, locally and in the harness, including restore, delete, maintenance, migrations and settings writes. `public-config` is open by design.
- In the harness, as owner: settings read, invalid keys and unknown test groups refused with 400, health, maintenance on (other API calls answer 503 while health and the console stay up) and off, migrations run, log list and tail, unknown log kinds 400, log download refuses a traversal name (404), backup create, list, manifest, download, wrong-confirm restore 400, a real restore of a fresh backup (the instance keeps serving), delete, stats, companies and the company history CSV.
- Audit log: owner and admin list and export; member and guest get 403; no session 401; another company's id 401; a member update is recorded and filterable by entity; undo of an unknown row 404.
- Every settings catalogue read requires a session (401 without), refuses another company (401), and answers every role with the company's data.
- Owner writes: task status and task type templates (create, rename, delete), project status templates (create, rename, delete), project skills (add, hide), and member updates recorded in the audit log.
- `PUT /api/v1/notifications/preferences` only changes the caller's own document (404 for someone else's).
- `getlogo`, `getBrandSettingsData`, `getEmailTemplates` and `/apidocs` are available without a session. `/connections/:id` refuses without the preset key. Every logo folder `getlogo` can read exists, so no request reaches the `readdir` error path.
- On screen: all 16 area screens render for the owner, with no Instance error banner and no page errors. The Audit log offers Export CSV and the export returns `text/csv`. The admin sees Audit Log but not Instance. Member and guest see neither, and opening an Instance address shows no console.

## Could not do / notes

- The owner browser pane was at its tab cap for most of the sweep; owner live checks ran once a tab could be opened (tab closed afterwards).
- My first anonymous `GET /api/v1/notifications/<userId>` with a made-up `companyid` (part of INS-03) created database `0123456789abcdef01234567` with one `notifications_settings` document in the local `alianhub-mongo`. Dropping it was refused by the permission classifier, so it is still there; it is safe to drop.
- Instance › Upgrade calls `api.github.com` for the latest release (cached 6 h). Opening the screen locally triggered it; the harness test hits it too and tolerates failure.
- typesense has no routes or wiring in this build, and swagger (`/apidocs`) documents Instance but not Audit or settings; availability only was checked.
- Playwright is not installed in the main checkout's `node_modules`; the spec was run with the `@playwright/test` 1.63.0 install of another worktree through `NODE_PATH`, without installing anything.
