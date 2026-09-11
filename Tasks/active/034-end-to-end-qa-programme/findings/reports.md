# Reports and integrations — QA sweep (area `reports`, prefix `REP`)

Server: local `http://localhost:4000`, beta, company `6a8ee973d625fca52e519a12` (Local360).
Roles via `demo:token`: admin `rahul.manager`, members `priya.frontend` / `arjun.backend`, guest `kabir.intern`. Owner via the in-app browser pane (Local PM).
Modules: UserDashboard, CustomReports, AgileReports, ScheduledReports, Webhooks, Integrations.
All data created under `[QA reports]` names or the QA Sandbox project (QAS); every record was deleted after testing (verified 0 leftovers). Webhooks pointed only at `127.0.0.1`; schedules were created inactive; no integration used a real third-party account.

## Coverage

Routes registered by the six modules: **56**. Exercised: **55** (every route except `POST /api/v1/reports/schedules/:id/run-now`, deliberately skipped on the live server so no report email is attempted; it is covered in the integration spec against the throwaway database, where mail points at a closed port).

| Module | Routes | Owner | Admin | Member | Guest | Anon |
|---|---|---|---|---|---|---|
| UserDashboard | 23 | 23 | 23 | 23 | 23 | 3 (refused) |
| CustomReports | 9 | 9 | 9 | 9 | 9 | 2 (refused) |
| AgileReports | 6 | 6 | 6 | 6 | 6 | 1 (refused) |
| ScheduledReports | 6 | 5 | 5 | 5 | 5 | 1 (refused) |
| Webhooks | 6 | 6 | 6 | 6 | 6 | 0 |
| Integrations | 6 | 5 | 5 | 5 | 5 | 1 (slackCommand, public) |

Every authenticated route requires a JWT: anonymous calls to the `/api/v1/reports/*`, `/api/v1/dashboard(s)`, `/api/v1/agile`, `/api/v2/webhooks` and `/api/v1/integrations` prefixes return 401 (the public `POST /api/v1/slack/command/:companyId` is intentionally open and authenticates with a per-workspace token). Cross-tenant is enforced: a JWT for Local360 with a foreign `companyid` header returns 401/403 (`requireCompanyAud` / `verifyJWTTokenWithCV2`).

Screens opened as owner (10, all render, no console errors):
`/:cid/dashboards`, `/:cid/dashboards/:id`, `/:cid/custom-reports`, `/:cid/reports/sprint`, `/:cid/reports/velocity`, `/:cid/reports/milestones`, `/:cid/integrations`, `/:cid/connections`, `/:cid/external-data`, `/:cid/settings/integrations`.

---

### REP-01 — Legacy `POST /api/v1/dashboard` runs an arbitrary Mongo method with a body-supplied query

- **Severity:** critical (cross-user data read, tampering, loss; cross-collection read)
- **Role:** any authenticated role, including guest (roleType 0)
- **Request:** `POST /api/v1/dashboard` body `{ queryObject, method, userId? }`
- **Expected:** the dashboard write path should only let a caller change their own dashboard, and only through safe operations — the same ownership model the new `/api/v1/dashboards` routes enforce (`canEditDashboard`, owner === uid).
- **Actual:** `updateDashboard` (Modules/UserDashboard/controller.js:205) passes `req.body.method` straight into `MongoDbCrudOpration(companyId, { type: USERDASHBOARD, data: queryObject }, method)` with `queryObject` also taken verbatim from the body. The method and the query are entirely attacker-controlled (scoped only to the company database). Confirmed as guest:
  - `method:"findOne", queryObject:[{ _id:<admin's private dashboard id> }]` -> 200, returned another user's private dashboard in full (title, ownerId, cards). The sibling `GET /api/v1/dashboards/:id` correctly returns 403 for the same document, so this route bypasses that gate.
  - `method:"updateOne", queryObject:[{ _id:<other user's dashboard> }, { $set:{ title:"..." } }]` -> 200 `modifiedCount:1`; the owner then saw the overwritten title. Arbitrary write to any dashboard in the company.
  - `method:"aggregate", queryObject:[[ ..., { $unionWith:{ coll:"saved_reports", pipeline:[...] } } ]]` -> 200, returned rows from the `saved_reports` collection. `$unionWith` / `$lookup` turn this into an arbitrary read of any collection in the company database.
  - `method` is unrestricted, so `deleteMany`/`deleteOne` with a body-supplied filter would delete other users' dashboards (data loss) — not executed against real data.
- **Reproduction:** mint a guest token; `POST /api/v1/dashboard` with `{ method:"updateOne", queryObject:[{ _id:"<any dashboard id>" }, { $set:{ title:"pwned" }}] }` and companyid header -> 200, change lands.
- **Suspected fix:** Modules/UserDashboard/controller.js:205 `updateDashboard`. This endpoint predates the owned-dashboard model and should be retired or rewritten to (a) resolve the target by the caller's own `req.uid` only, (b) accept a fixed field set instead of a raw `queryObject`, and (c) never accept `method` from the body. Registered at Modules/UserDashboard/routes.js:5, listed in the `verifyJWTToken` allow-list at Config/setMiddleware.js:355 as `/api/v1/dashboard`.

### REP-02 — Saved custom reports and their schedules have no per-user or role scoping

- **Severity:** high (wrong access enforcement; a guest can redirect where another user's report data is emailed)
- **Role:** any authenticated role, including guest
- **Request:** `GET/PUT/DELETE /api/v1/reports/custom(/:id ...)`, `PUT /api/v1/reports/schedules/:id`
- **Expected:** a saved report and its schedule belong to the person who made them (the code records `createdBy`), so another user — least of all the most restricted role — should not be able to read, rewrite or delete them, nor change a schedule's recipient list.
- **Actual:** `listReports` (Modules/CustomReports/controller.js) queries `{ deletedStatusKey: { $ne: 1 } }` with **no `createdBy` filter**, so every role sees every report in the company; `updateReport` / `deleteReport` / `duplicateReport` / `getReportResult` match on `_id` only. `listSchedules` / `updateSchedule` / `deleteSchedule` (Modules/ScheduledReports/controller.js) are the same. Confirmed: as guest, `PUT /api/v1/reports/custom/<admin's report id>` renamed it (200), and `PUT /api/v1/reports/schedules/<admin's schedule id>` with `recipients:["qa-reports-guest@example.invalid"]` returned 200 with the new recipient stored. Once SMTP is configured, that reroutes another user's report to an address the guest chose.
- **Reproduction:** admin saves a report and a schedule; mint a guest token; `PUT` either by id -> 200, change lands.
- **Suspected fix:** add a `createdBy: req.uid` clause to the match on every read/update/delete in Modules/CustomReports/controller.js and Modules/ScheduledReports/controller.js (mirror the owner-in-the-match pattern Modules/Webhooks/controller.js already uses), or add an explicit admin/owner role gate if reports are meant to be shared.

### REP-03 — Integration connections can be managed by the most restricted role

- **Severity:** high (wrong role enforcement over company-wide configuration and data egress)
- **Role:** any authenticated role, including guest
- **Request:** `POST/PUT/DELETE /api/v1/integrations/connections(/:id)`
- **Expected:** connecting, disabling or disconnecting a workspace integration (Slack slash-command token, Microsoft Teams / Zapier egress webhooks, embedded apps) is an administrative act; a guest should not be able to do it.
- **Actual:** `connect` / `updateConnection` / `disconnect` (Modules/Integrations/controller.js) apply no role check and no owner scoping — they read only `companyId` from the header. Confirmed: as guest, created a `custom_iframe` connection, toggled `enabled`, and disconnected an admin-created connection, all 200. A guest can therefore disable the company's Slack integration or point a new egress connection wherever they like.
- **Reproduction:** mint a guest token; `POST /api/v1/integrations/connections { type:"zapier", config:{ hook_url:"https://..." } }` -> 200 "Connected"; `DELETE /api/v1/integrations/connections/:id` on any connection -> 200.
- **Suspected fix:** gate the write handlers in Modules/Integrations/controller.js on owner/admin roleType (resolve it from `company_users` by `req.uid`, as UserDashboard's `resolveCallerRoleType` does), not on the request body.

### REP-04 — Webhook URLs are not restricted to public hosts (blind SSRF)

- **Severity:** high (server-side request forgery to internal/loopback/link-local addresses)
- **Role:** any authenticated role
- **Request:** `POST /api/v2/webhooks` with an internal `url`
- **Expected:** an outgoing-webhook target should be limited to public hosts (or private hosts refused by design, as the area brief anticipates). The dispatcher (Modules/Webhooks/dispatcher.js) POSTs to `hook.url` on every task event, so an internal URL is an SSRF sink.
- **Actual:** `isValidUrl` (Modules/Webhooks/helpers/webhookRules.js) only checks the protocol is `http`/`https`. `http://127.0.0.1:9/...` and `http://169.254.169.254/latest/meta-data` (the cloud instance-metadata endpoint) were both accepted and the webhook stored. The delivery attempt fires from the server to that address. It is "blind" — delivery logs record only status code/duration, not the response body — but internal services that act on a POST can still be reached, and the loopback/link-local range is exactly what should be blocked.
- **Reproduction:** `POST /api/v2/webhooks { name:"x", url:"http://169.254.169.254/latest/meta-data", events:["*"] }` -> 200, webhook created; a task change triggers the POST.
- **Suspected fix:** in `isValidUrl` (Modules/Webhooks/helpers/webhookRules.js) reject hostnames that resolve to loopback, private (RFC1918), link-local (169.254/16) and other reserved ranges, and re-validate the resolved address at delivery time in the dispatcher to defeat DNS rebinding. If private hosts are meant to be allowed in self-hosted setups, gate it behind an explicit instance setting.

### REP-05 — Integration connect stores obviously invalid configuration and reports success

- **Severity:** medium (bad validation / misleading secondary function)
- **Role:** any authenticated role
- **Request:** `POST /api/v1/integrations/connections`
- **Expected:** saving a connection with plainly invalid values (a Zapier "hook URL" that is not a URL, an empty Microsoft Teams webhook URL) should be refused, per the area brief ("validates obviously fake values").
- **Actual:** `validateConnection` (Modules/Integrations/helpers/integrationsRules.js) validates a URL only for `multiple` types (`custom_iframe`). For every other catalog entry it keeps any non-empty string for the allow-listed fields and returns valid. Confirmed: `zapier { hook_url:"not a url" }` -> 200 "Connected"; `microsoft_teams {}` (no webhook URL at all) -> 200 "Connected"; `github { token:"fake", repo:"not/../valid repo" }` -> 200 "Connected". The UI then shows the integration as connected though it can never work. (`custom_iframe` is validated correctly — `javascript:` and `http:` URLs are refused.)
- **Reproduction:** `POST /api/v1/integrations/connections { type:"microsoft_teams", config:{} }` -> 200 "Connected".
- **Suspected fix:** in Modules/Integrations/helpers/integrationsRules.js add per-field validation (URL fields must be valid `https` URLs, required fields must be present) for every catalog entry, not only `multiple` ones; mark which catalog fields are required.

### REP-06 — Financial figures reach every role through the custom-report `revenue` metric

- **Severity:** medium (inconsistent exposure of billing data)
- **Role:** any authenticated role, including guest
- **Request:** `POST /api/v1/reports/custom/run { source:"timelogs", metric:"revenue", dimension:"person" }`
- **Expected:** the dedicated financial widget (`POST /api/v1/dashboard/milestone-summary`) is correctly restricted to owner/admin and returns `{ restricted:true }` for everyone else. Company revenue derived from billing rates should be gated the same way.
- **Actual:** the custom-report engine resolves `billing_rates x timesheet minutes` company-wide with no role or project-membership check (Modules/CustomReports/controller.js `foldRevenue` / `runConfig`). Confirmed: as guest, `run` with `source:"timelogs", metric:"revenue"` returned billed-amount rows. So the same financial data the milestone card hides is freely computable by a guest through Custom Reports.
- **Reproduction:** mint a guest token; `POST /api/v1/reports/custom/run { source:"timelogs", dimension:"person", metric:"revenue", filters:{ range:"all" } }` -> 200 with amounts.
- **Suspected fix:** apply the same owner/admin gate used by `getMilestoneSummary` to the `revenue` metric in Modules/CustomReports/controller.js (or scope non-privileged callers to their own logs), so financial exposure is consistent across the reporting surface.

### REP-07 — Invalid report id returns a raw 500; a valid-but-unknown id deletes "successfully"

- **Severity:** low (error handling / response shape)
- **Role:** any authenticated role
- **Request:** `GET /api/v1/reports/custom/:id/run`, `DELETE /api/v1/reports/custom/:id`
- **Expected:** a malformed id should be a 400 with a clean message; deleting a non-existent report should be a 404.
- **Actual:** a non-24-hex id throws inside `new mongoose.Types.ObjectId(...)` and surfaces as HTTP 500 with the raw driver message `"input must be a 24 character hex string, ..."` (the `oid` helper in CustomReports uses the throwing constructor, unlike ScheduledReports/Integrations which use a try/catch `oid`). A well-formed but non-existent id on `DELETE` runs `updateOne` that matches nothing yet returns 200 `"Report removed."`. Neither is a security issue; both are sloppy contracts.
- **Suspected fix:** use the safe `oidOrNull` already defined in Modules/CustomReports/controller.js for `:id` params and return 400 on null; have `deleteReport` check the update matched a document and return 404 otherwise.

---

## Checks that passed

- All 56 module routes require authentication except the intentionally-public Slack slash-command endpoint; anonymous access is refused with 401.
- Cross-tenant isolation holds: a Local360 JWT with a foreign `companyid` header is refused (401/403), and a fake companyid with a real one in the query does not widen scope.
- Webhook ownership is correctly enforced: a guest listing/updating/deleting/reading-logs of an admin's webhook gets "Webhook not found" (ownership is part of the Mongo match), and the HMAC secret is returned only once on create and masked everywhere else.
- Webhook input validation is solid: empty name, non-http protocol, empty events, unknown event names and unknown formats are all rejected; `active` accepts only a real boolean.
- Custom-report config validation is safe against injection: only allow-listed dimensions/metrics/filters reach the pipeline; `dimension:"$where"` and unknown keys are rejected with 400.
- Schedule validation rejects invalid recipient emails and unknown cadence; schedules created inactive do not fire, and `run-due` respects the active flag (0 due / 0 delivered) so no mail is attempted.
- Dashboard sharing (the new `/api/v1/dashboards` routes) enforces visibility and ownership correctly: private dashboards 403 to non-owners on GET/PUT/DELETE; only the owner can edit; a duplicate is always private to the copier.
- Role-based dashboard visibility is enforced server-side from `company_users` (never the body): `milestone-summary` returns `restricted:true` to member/guest; `employee-workload` returns only the caller for a member/guest vs 9 employees for admin; `tasks-by-status` reports `scope:"self"` for member/guest and `scope:"company"` for admin.
- Agile reports (burndown, velocity, cfd, sprint-insights, milestones, provenance) and all dashboard cards return the `{ status, statusText/data }` shape and are companyId-scoped.
- Integration secrets are sealed on write and redacted on read (the `secrets` map exposes only whether each secret is set); `custom_iframe` embed URLs must be `https`.
