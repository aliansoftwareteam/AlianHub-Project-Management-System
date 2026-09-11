# Findings — Pages, forms, import and export (slug `pages`, prefix `PAG`)

Sweep of task 034 against the local beta server (`http://localhost:4000`, company `6a8ee973d625fca52e519a12` / Local360), using the demo team tokens. Modules covered: Pages, Forms, PublicShares, Export, ExportJobs, Importers, ImportSettings, Apps.

Roles exercised: **owner** (Local PM, in-app browser tab), **admin** (`rahul.manager`), **member** (`priya.frontend` / `arjun.backend`), **guest** (`kabir.intern`). "anon" = no token, used for the public `/share` and `/form` routes and to confirm the authenticated prefixes refuse.

## Coverage

### API routes

| Module | Routes | Exercised | Notes |
|---|---|---|---|
| Pages | 10 | 10 | `POST/GET/PUT/DELETE /api/v2/pages`, `/:id`, `/:id/review`, `/:id/approve`, `/:id/restore`, `ai-status`, `ai` |
| Forms | 10 | 10 | 8 authenticated + public `GET/POST /form/:token` |
| PublicShares | 10 | 10 | 6 authenticated + `GET/POST /share/:token`, `/share/:token/page/:pageId`, `/share/:token/intake` |
| Export | 3 | 3 | `POST /api/v1/export/{pdf,csv,xlsx}` |
| ExportJobs | 3 | 3 | `POST /api/v2/exports`, `GET /api/v2/exports`, `GET /api/v2/exports/:id/download` |
| Importers | 7 | 7 | csv, csv/preview, jira, trello, asana, monday, `GET /api/v2/imports` |
| ImportSettings | 4 | 4 | importSettings, importTemplate, importSettingsProjectFunction, importSettingsNotification (validation-path only — see note) |
| Apps | 1 | 1 | `GET /api/v1/projects-apps` |
| **Total** | **48** | **48** | every route hit anon + at least the applicable roles |

Per-role request counts (distinct route×role calls made): owner via browser UI (Docs screen) + admin ~48, member ~30, guest ~35, anon ~14. Guest is the restricted role in this company (the demo Guest, roleType 0).

Note on ImportSettings: these v1 endpoints re-import / **overwrite company-wide** settings, roles, rules, designations and templates (`importCompanyRules` runs `deleteMany` on the rules collection). To honour the data rules I only sent payloads that stop at input validation; I did **not** run the destructive path against Local360. The authorization gap (PAG-04) is judged from the code and the fact that the validation guard, not any role check, is what refused each role.

### Frontend screens

| Screen | Route / location | Opened as owner | Console errors |
|---|---|---|---|
| Docs hub | `/:cid/pages` (`PagesSpace.vue`) | yes | none |
| Doc editor | `/:cid/pages/:pageId` (`PageEditorView.vue`) | (same bundle, hub verified) | none |
| Forms view | in-project tab `FormsView.vue` | component, covered by Playwright | — |
| Import dialog | `ImportDialog.vue` (project toolbar) | component, covered by Playwright | — |
| Export dropdown | `ExportTasksDropdown.vue` (project toolbar) | component, covered by Playwright | — |
| Public share modal | `PublicShareModal.vue` (sprint/board) | component, covered by Playwright | — |

Only Pages registers dedicated router entries (`frontend/src/router/pages/index.js`); the rest of the area lives as components inside the Projects view. The Docs hub rendered clean as the owner (no console errors). Broader owner UI sweeping was limited by the shared browser-pane tab cap (10 QA agents running in parallel); the in-project components are covered by the Playwright spec against the throwaway DB instead.

---

## PAG-01 — Any authenticated user can read and download another user's export jobs (uid taken from the query string)

- **Severity:** critical
- **Role:** any authenticated role (reproduced as guest reading the admin's jobs)
- **Request:** `GET /api/v2/exports?uid=<victimUserId>` and `GET /api/v2/exports/:id/download?uid=<victimUserId>`
- **Expected:** a user sees and downloads only their own export jobs; another user's `uid` is refused.
- **Actual:** both handlers scope the query solely by `userId = req.query.uid` and never compare it to `req.uid`. Passing any other user's id in the query returns that user's job list, and downloading with the victim's id streams their generated file. Reproduced: guest listed the admin's 4 export jobs (HTTP 200) and downloaded an admin job whose CSV contained a task from a **private project the guest is not a member of** (`contains SECRET: true`).
- **Reproduction:**
  1. admin: `POST /api/v2/exports {format:'csv', projectId, userData:{id:<adminId>}}`, wait for it to finish.
  2. guest: `GET /api/v2/exports?uid=<adminId>` → 200, admin's jobs.
  3. guest: `GET /api/v2/exports/<adminJobId>/download?uid=<adminId>` → 200, the admin's CSV.
- **Suspected file:** `Modules/ExportJobs/controller.js` — `listExports` (~L657, `const userId = String(req.query?.uid || '')`) and `downloadExport` (~L676, filter `{ _id, userId }` with `userId` from the query). **Fix:** take the owning user from `req.uid`, not `req.query.uid`; ignore/deny a mismatched query `uid`.

## PAG-02 — Export ignores project membership: any member can export a private project's tasks

- **Severity:** high
- **Role:** guest / any member of the company
- **Request:** `POST /api/v2/exports {format:'csv', projectId:<privateProjectId>, userData:{id:<self>}}` then `GET /api/v2/exports/:id/download?uid=<self>`
- **Expected:** you can only export a project you can see; a private project you are not a member of is refused.
- **Actual:** `createExport`/`processJob` validate only the shape of `projectId` and then query tasks by `ProjectID` + company — no check that the caller is a member of that project. A guest created a CSV export of a private project they were never added to and downloaded every task (`TaskName`, assignees, dates). Confirmed with a freshly created private project (`isPrivateSpace:true`, admin-only) — guest export succeeded and the file contained the private task.
- **Reproduction:** create a private project as admin, add one task; as guest `POST /api/v2/exports` with that `projectId`; download → the private project's tasks come back.
- **Suspected file:** `Modules/ExportJobs/controller.js` `createExport` (~L623) / `processJob` (~L571 task query). **Fix:** resolve the project and verify the caller's visibility/membership (as the Pages module does for docs) before queuing the job.

## PAG-03 — Import history is readable across users (same uid-from-query pattern)

- **Severity:** high
- **Role:** any authenticated role (reproduced as guest)
- **Request:** `GET /api/v2/imports?uid=<victimUserId>`
- **Expected:** a caller sees only their own import jobs.
- **Actual:** `listImports` filters by `{ userId: req.query.uid }` with no comparison to `req.uid`; guest retrieved the admin's 8 import-job records (source, counts, timestamps, error lists) with HTTP 200.
- **Reproduction:** guest `GET /api/v2/imports?uid=<adminId>` → 200 with the admin's jobs.
- **Suspected file:** `Modules/Importers/controller.js` `listImports` (~L44). **Fix:** derive `userId` from `req.uid`.

## PAG-04 — Company-wide settings/rules import endpoints have no owner/admin gate

- **Severity:** high
- **Role:** any authenticated role (member, guest)
- **Request:** `POST /api/v1/importSettings`, `POST /api/v1/importTemplate`, `POST /api/v1/importSettingsProjectFunction`
- **Expected:** re-importing company defaults — roles, permission rules, designations, task/project status templates — is an owner-only action.
- **Actual:** the routes are only JWT-authenticated (`Config/setMiddleware.js` lists them under `verifyJWTTokenWithCRoute`); no handler checks `roleType`. Each refused my probe **only** because a required field was missing, not because of the caller's role — a guest supplying valid parameters would run the import. `importSettingsProjectFunction` → `utils/data.js importCompanyRules` runs `deleteMany` on the rules collection before re-inserting, so a non-owner could wipe/reset the company's configured permission rules. I deliberately did not execute the destructive payload against Local360.
- **Reproduction (validation-safe):** as guest `POST /api/v1/importSettingsProjectFunction {}` → `Company id is required` (reaches the handler, no role refusal); the same call with a real `companyId` + `type` would execute.
- **Suspected file:** `Modules/ImportSettings/controller.js` (`importSettings`, `importTemplate`, `importSettingsProjectFunction`) and `utils/data.js` (`importCompanyRules`). **Fix:** gate these behind an owner/admin check on the tenant `company_users` row (as `Modules/ScreenshotRetention` does).

## PAG-05 — Export CSV/XLSX writers do not neutralise spreadsheet-formula injection

- **Severity:** medium
- **Role:** any (the payload is task/table data, e.g. a task name typed by a member or a public form submitter)
- **Request:** `POST /api/v1/export/csv` (and `/xlsx`), and the async `POST /api/v2/exports`
- **Expected:** a cell whose text begins with `=`, `+`, `-` or `@` is prefixed/quoted so a spreadsheet does not execute it as a formula.
- **Actual:** `toCsv`/`rowsToCsv` apply only RFC-4180 quoting. A value like `=HYPERLINK("http://x","y")` is emitted as `"=HYPERLINK(...)"` — still a live formula when opened in Excel/Sheets. Since task names and imported/form-submitted content flow straight into exports, a crafted task name becomes an executable cell in any exported report.
- **Reproduction:** `POST /api/v1/export/csv {tableRows:[['=HYPERLINK("http://evil","x")']]}` → the cell is present verbatim, no leading apostrophe/guard.
- **Suspected file:** `Modules/Export/helpers/exportRules.js` `csvEscape`/`toCsv`/`toAoa` and `Modules/ExportJobs/helpers/exportRules.js` `csvEscape`. **Fix:** prefix a leading `'` (or space) when a cell starts with `= + - @`. (Borderline vs. the task-031 security scope, but it is a defect of the Export module's core output, so filed here.)

## PAG-06 — `GET /api/v1/projects-apps` breaks the standard response envelope

- **Severity:** low
- **Role:** all
- **Request:** `GET /api/v1/projects-apps`
- **Expected:** `{ status, statusText, data }` per CLAUDE.md; errors as `{ status:false, ... }` with an appropriate code.
- **Actual:** returns a bare JSON array on success (`res.status(200).json(data)`), and `res.status(404).json({message,error})` on failure — neither matches the documented shape, so every caller special-cases this endpoint. Not a data or auth problem; a consistency/contract defect.
- **Suspected file:** `Modules/Apps/controller.js` `getApps`.

## PAG-07 — `POST /api/v1/export/{csv,xlsx,pdf}` are unauthenticated

- **Severity:** low
- **Role:** anon
- **Request:** `POST /api/v1/export/csv` (and `/xlsx`, `/pdf`)
- **Expected:** an authenticated session (these sit alongside DB-backed endpoints).
- **Actual:** the `/api/v1/export/*` prefix is in neither JWT list in `Config/setMiddleware.js`, so an anonymous caller gets a 200 and a rendered file. **No data leak:** these endpoints only format the table/params the client sends in the body — they never read the tenant DB — so an anonymous caller only gets their own posted data back. The concern is a small open abuse surface (each call runs pdfmake/xlsx), not confidentiality. Same class as the `fix/unauthenticated-v1-routes` work.
- **Suspected file:** `Config/setMiddleware.js` (add `/api/v1/export` to `verifyJWTTokenWithCRoute`) / `Modules/Export/routes.js`.

## PAG-08 — Anyone in the company can mint a public link to a sprint of a project they cannot access

- **Severity:** critical
- **Role:** guest (any company user)
- **Request:** `POST /api/v2/public-shares {entityType:'sprint', entityId:<sprint of a private project>}`, then anonymous `GET /share/:token`
- **Expected:** a share can only be created for an entity the caller can open; a sprint of a private project the caller is not in is refused.
- **Actual:** `canShareEntity` only checks `entityType === 'page'`; sprints, reports and client views pass unchecked. Live sweep: guest created a link to the sprint of `[QA pages] private` (admin-only, private) and an unauthenticated visitor received HTTP 200 with the sprint name and its task board. `GET /api/v2/public-shares?entityId=` likewise hands an existing sprint token to any role.
- **Reproduction:** admin creates a private project; guest `POST /api/v2/public-shares` with its sprint id → `Public link created.`; open `/share/<token>` logged out → board renders.
- **Suspected file:** `Modules/PublicShares/controller.js` `canShareEntity` (~L34) and `getShare` (~L111). **Fix:** resolve the sprint/report/client view to its project and require the caller to see that project before creating or returning a token.

## PAG-09 — Docs, forms and form submissions of a project the caller is not in are readable

- **Severity:** high
- **Role:** guest
- **Request:** `GET /api/v2/pages?projectId=<private>`, `GET /api/v2/pages/:id`, `GET /api/v2/forms?projectId=<private>`, `GET /api/v2/forms/:id`, `GET /api/v2/forms/:id/submissions`
- **Expected:** content of a project the caller is not a member of is hidden.
- **Actual:** Pages apply only the private-doc rule and Forms apply no project check at all. Live sweep against `[QA pages] private` (admin-only): guest listed and opened the doc (1), listed and opened the form (1) and read its submissions (which carry public submitters' answers and emails).
- **Suspected file:** `Modules/Pages/controller.js` `listPages`/`getPage`; `Modules/Forms/controller.js` `listForms`/`getForm`/`listSubmissions`/`updateForm`/`publishForm`/`deleteForm`. **Fix:** check project membership/visibility of `ProjectID` before serving or changing the row.

## PAG-10 — Any user can delete another user's private doc (and its subtree)

- **Severity:** high
- **Role:** member
- **Request:** `DELETE /api/v2/pages/:id` on someone else's private page
- **Expected:** refused with the same "Page not found." every other handler returns.
- **Actual:** `deletePage` never loads the page or applies `pageVisibleTo`; it soft-deletes the id and every descendant, including other users' private children. Live: member deleted the admin's private doc (`Page deleted.`); the admin had to restore it from trash. An unknown id also answers `Page deleted.` with `deleted: 1`.
- **Suspected file:** `Modules/Pages/controller.js` `deletePage` (~L380). **Fix:** use `findVisiblePage` first and 404 otherwise; walk only visible descendants.

## PAG-11 — Form submissions never record the key of the task they filed

- **Severity:** medium
- **Role:** anon submitter / anyone reading responses
- **Request:** `POST /form/:token`, then `GET /api/v2/forms/:id/submissions`
- **Expected:** each submission row carries the created task's key, so the response table links to it.
- **Actual:** the task is created (`QAS-14` in the live sweep, verified in Mongo), but `taskKey` is always `''`. `taskMongo.create` resolves `{ status, id }` without `data`, so `result.data.TaskKey` is undefined and the fallback is an empty string.
- **Suspected file:** `Modules/Forms/publicForm.js` ~L508-509. **Fix:** read the id from `result.id` and fetch or return the task key from the create path.

## PAG-12 — `POST /api/v1/importSettingsNotification` runs without a token

- **Severity:** critical
- **Role:** anon
- **Request:** `POST /api/v1/importSettingsNotification {companyId, userId}`
- **Expected:** 401.
- **Actual:** the route is in neither JWT list (the `/api/v1/importSettings` prefix does not match `/api/v1/importSettingsNotification`), so an anonymous caller reaches the handler, which upserts default notification settings for any `userId` in any `companyId` taken from the body, overwriting that user's preferences. Live sweep reached the handler anonymously (`User id is required.`). `POST /api/v1/importTemplate` is also absent from the lists; it answered anonymously in the live sweep and writes project templates into the company named in the body. Neither is covered by `fix/unauthenticated-v1-routes`, which only adds `/api/v1/removeCache`.
- **Suspected file:** `Config/setMiddleware.js`. **Fix:** list both routes under `verifyJWTTokenWithCRoute` and take the company from the verified header.

---

## Checks that passed (no finding)

**Pages**
- The private-doc visibility rule holds on every read path: a private page never appeared in another user's `list` (project, `scope=all`, task-linked) and `GET /:id` returned the same "Page not found." for "not yours" as for "does not exist" (`pageVisibleTo` / `pageVisibilityFilter`).
- Author is taken from the JWT (`req.uid`), not the body, on create/update/review/approve.
- Company scoping: an ObjectId `companyid` header for another company is rejected by the JWT audience check (401); the visibility filter is always applied.
- Validation: empty/oversized title, non-ObjectId `projectId`/`parentPageId`/`linkedTasks`, oversized content, invalid AI `action` all refuse cleanly.
- `deletePage` soft-deletes the whole subtree; `restorePage` only from trash; `approvePage` refuses non-agent pages.
- Docs hub screen renders as owner with no console errors.

**Forms**
- Public `/form/:token` serves only the published form, shows questions but **not** the project name; a bad/rotated/unpublished token 404s; missing required answers re-render with the error and store nothing; a valid submission 303-redirects and creates both a `form_submissions` row and a task in the mapped sprint (verified in Mongo, task `QAS-14`).
- Publishing refuses a form with no questions, no task-name question (when it files tasks), or a sprint belonging to another project (`buildSnapshots` names the project in the filter); deleting a live form is refused until unpublished.
- Author taken from `req.uid`; company scoping via header/audience.

**PublicShares**
- A page share can be minted only for a doc the caller can open; a private doc is refused with identical wording whether "not yours" or "not there" (`canShareEntity`).
- Shared doc renders the root + non-private descendants; a **private** child is excluded from both the tree and the `/page/:pageId` fragment (the fragment falls back to the root rather than serving it).
- Password gate works (correct unlocks, wrong re-prompts), past `expiresAt` 404s, hard `DELETE` revoke removes the global token index so the link and intake both stop working; `passwordHash` is never returned (sanitised, including the "already exists" path).
- Doc HTML goes through the allow-list sanitizer and a per-response CSP nonce; intake fields are validated and length-capped.

**Export / ExportJobs**
- v1 exporters stream the correct content types (`text/csv`, xlsx mime, `application/pdf`); missing `type` refused; async jobs run to `done` and the download carries the header row; bad job id / missing uid / a job id that isn't the caller's own uid all refuse; format restricted to csv/xlsx.

**Importers**
- csv/preview reports per-row issues, unknown statuses and unmatched users without writing; each importer (csv, jira, trello, asana, monday) creates tasks into the target sprint and records an `importJobs` row; every importer validates project/sprint ids, row caps and a name/summary column; unknown `projectId` refused.
- Small generated CSVs only; all imports went into a throwaway `[QA pages] import` project which was deleted afterwards.

**Apps / ImportSettings**
- `projects-apps` is company-scoped and cache-tagged; ImportSettings endpoints refuse missing companyId/email/userId/templates.

**Cross-cutting**
- Every `/api/v2/*` and listed `/api/v1/*` route in the area refuses an anonymous request (401), confirming the middleware prefixes are registered.
- All sweep data was created inside QA Sandbox or under `[QA pages]*` names and cleaned up (pages soft-deleted, shares revoked, forms deleted, the `[QA pages]` projects and their tasks soft-deleted, the form-created task `QAS-14` bulk-deleted).

### Known issues that blocked role checks (not re-filed)

Per the brief, these are already being fixed and are the reason many member/guest refusals did not fire — several area routes accept a guest/member action that should be an admin/owner one inside a project they belong to (guest published, edited and deleted the admin's form; guest disabled and revoked the admin's public share and read its intake submitters; guest approved an agent-drafted page). These trace to `fix/member-permission-rules` (no member permission rules in Local360) and `fix/guest-role-id`, so they are noted here rather than filed. Anything that crosses a project the caller is not in, another user's private data, or needs no token at all is independent of that work and is filed (PAG-01 to PAG-04 and PAG-07 to PAG-12).
