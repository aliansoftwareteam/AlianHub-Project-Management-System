# Time and money — QA findings (task 034, area `time`, prefix `TIM`)

Sweep run against the local beta server at `http://localhost:4000`, company `6a8ee973d625fca52e519a12` (Local360), using demo-team session tokens (admin = Rahul, members = Priya/Arjun/Sara/Neha/Vikram/Anita, guest = Kabir) plus the owner (Local PM) in the in-app browser pane. All write/test data was created in the QA Sandbox project (`QAS`, `6aa3b13ed1b2a9fd26131a1e`) or tagged `[QA time]` and removed at the end (verified: 0 residual rows).

Modules covered: TimeSheet, LogTime, TimesheetApproval, EstimatedTime, Pto, ScreenshotRetention, trackerDownload, Invoice, SubscriptionPlan, subscription, PlanFeature, Affiliate, VarianceReport.

## Coverage

### Routes

| Module | Registered | Exercised | Notes on gaps |
|---|---|---|---|
| TimeSheet | 21 | 21 | all reads + writes (rates, entries/billable, workload-move, generate-invoice, export-csv, send-reminders) |
| LogTime | 11 | 8 | manualLogtime add/edit/delete + running/trim/timelog exercised; full tracker start→capture→end cycle (v2/v3/v4 capture, v3 start) checked for auth/validation only — a real desktop capture needs the `isTrackerUser` flag and screenshot upload |
| TimesheetApproval | 6 | 6 | submit/status/mine/pending/queue/review all hit (see TIM-01/02) |
| EstimatedTime | 4 | 4 | GET, PUT upsert, POST aggregate, POST /ai/:tid (AI trigger reached; no AI key locally) |
| Pto | 5 | 5 | create/list/capacity/status/delete, all roles |
| ScreenshotRetention | 3 | 3 | read-only per area rules; owner-gate verified without mutating |
| trackerDownload | 4 | 4 | GET exercised; create/update/delete reached (auth-gap proven) but **not mutated** (global registry, uncleanable) |
| Invoice | 8 | 5 | list, draft-from-milestone, draft-from-month, invoice/find hit; get/:id, update/:id, send, paid not run — draft-only rule forbids issuing/paying |
| SubscriptionPlan | 4 | 3 | read routes hit; PUT /subscription not run (read-only rule) |
| subscription | 2 | 2 | both read routes |
| PlanFeature | 3 | 3 | all reads |
| Affiliate | 2 | 2 | both (stub endpoints) |
| VarianceReport | 2 | 2 | report + summary |
| **Total** | **75** | **68** | 7 not exercised are either blocked by area rules (invoice issue/pay, subscription write) or need the desktop tracker |

Per role (distinct routes touched): owner (UI + API) 60+; admin 68; member (Priya) ~42; guest (Kabir) ~30; unauthenticated probe 45.

### Screens (owner, in-app browser pane)

| Screen | Route | Result |
|---|---|---|
| My timesheet | `/timesheet/user` | renders, week grid + Log/Export/Submit controls |
| Workload sheet | `/timesheet/workload` | renders |
| Project timesheet | `/timesheet/project` | renders |
| Tracker timesheet | `/timesheet/tracker` | renders |
| Log time | `/time/log` | renders |
| Approvals | `/approvals` | renders (but backend refuses the queue — TIM-02) |
| Time off | `/settings/time-off` | renders, add form + list |
| Variance report | `/reports/variance` | renders |
| Billing | `/project/:id/billing` | renders, contract tab loads |
| Time tracking (settings) | `/settings/time-tracking` | renders |

Screens total 10, opened 10. No screen threw a Vue/JS console error. There are recurring `net::ERR_CONNECTION_REFUSED` console lines on every screen; they are a socket/telemetry reconnect attempt that is environmental (not area-specific) and appear across the whole app, so not filed here.

---

### TIM-01 — Timesheet-approval API is unauthenticated and cross-tenant readable/writable
- **Severity:** critical (auth bypass + cross-tenant data exposure + spoofable write)
- **Role:** unauthenticated / any
- **Request:** `GET /api/v2/timesheet-approval/mine?userId=<anyUserId>&companyId=<anyCompanyId>`, `GET .../status`, `POST .../submit`
- **Expected:** every `/api/v2/timesheet-approval/*` route requires a valid JWT and enforces the `companyid`↔token-audience match, as all other authenticated routes do.
- **Actual:** the prefix `/api/v2/timesheet-approval` is listed in **neither** `verifyJWTTokenWithCRoute` **nor** `verifyJWTToken` in `Config/setMiddleware.js`, so no JWT/company middleware runs. With no token at all:
  - `GET /api/v2/timesheet-approval/mine?userId=<X>&companyId=<Y>` returns `{status:true, data:[...]}` — the full submission history of any user in any company, selected purely by the query params (no audience check).
  - `GET .../status?userId=&companyId=` likewise returns the row.
  - `POST .../submit` with `{userId, companyId, userData:{id}}` creates/updates an approval row on behalf of any user — the actor is taken from `req.body.userData.id` because `req.uid` is unset (`actorId` in `Modules/TimesheetApproval/controller.js` falls back to the body).
- **Reproduction:**
  1. `curl -s 'http://localhost:4000/api/v2/timesheet-approval/mine?userId=6aa3b0d0d500d16621768eb5&companyId=6a8ee973d625fca52e519a12'` (no Authorization header) → `200 {status:true,data:[…]}`.
  2. `curl -s -XPOST -H 'content-type: application/json' -d '{"periodStart":"2026-08-01","periodEnd":"2026-08-07","userId":"6aa3b0d0d500d16621768eb5","companyId":"6a8ee973d625fca52e519a12","userData":{"id":"6aa3b0d0d500d16621768eb5"}}' http://localhost:4000/api/v2/timesheet-approval/submit` → `200 {status:true,…}` (row created with no auth).
- **Suspected file/line:** `Config/setMiddleware.js` — add `'/api/v2/timesheet-approval'` to the `verifyJWTTokenWithCRoute` array (alongside `/api/v1/pto`, `/api/v2/agents`, etc.). The controller already reads the actor from `req.uid` first, so once the middleware runs the spoof path closes too.

### TIM-02 — Timesheet approval review workflow is unusable for every role (owner/admin included)
- **Severity:** high (broken core function)
- **Role:** owner, admin
- **Request:** `GET /api/v2/timesheet-approval/pending`, `GET .../queue`, `POST .../:id/review`
- **Expected:** an owner or admin can list the pending queue and approve/reject/reopen a submitted timesheet.
- **Actual:** all three always return `{status:false, statusText:"Only an owner or admin can review timesheets."}`, even for Rahul (roleType 2, confirmed in `company_users`) and the owner. Root cause is the same missing middleware as TIM-01: `req.uid` is never populated, so `actorId(req)` is `''`, `getRoleType(companyId, '')` returns `null`, and `callerCanReview` fails for everyone. The result is that a member can submit a period (the `/submit` path tolerates the empty uid via the body fallback) but no one can ever review it — the Approvals screen loads but its queue call comes back refused.
- **Reproduction:** as admin (valid token) `GET /api/v2/timesheet-approval/pending` with `companyid` header → `{status:false, "Only an owner or admin can review timesheets."}`. Submit a timesheet as a member, then try to approve it as admin — same refusal.
- **Suspected file/line:** same fix as TIM-01 (`Config/setMiddleware.js`). Once `/api/v2/timesheet-approval` is JWT-guarded, `req.uid` is set and `getRoleType` resolves the reviewer's role. Regression covered as `it.failing('TIM-02 …')` in `tests/integration/time.int.test.js`.

### TIM-03 — trackerDownload create/update/delete are unauthenticated writes to the global download registry
- **Severity:** high (broken access control / integrity of a distributed artifact)
- **Role:** unauthenticated / any
- **Request:** `POST /api/v1/tracker/create`, `PUT /api/v1/tracker/update`, `DELETE /api/v1/tracker/delete/:id` (and `GET /api/v1/tracker`)
- **Expected:** creating, editing or deleting the desktop-tracker download entries (instance-wide, stored in the `global.timeTrackerDownload` collection) is an owner/admin action behind a JWT.
- **Actual:** none of the `/api/v1/tracker*` routes appear in either middleware list in `Config/setMiddleware.js`, so they run with no authentication. With no token, `POST /api/v1/tracker/create` reaches the controller and returns `400 "Missing required data"` (not `401`), `PUT /api/v1/tracker/update` returns `400 "Missing required data or ID"`, and `DELETE /api/v1/tracker/delete/<id>` returns `404 "Item not found"` — all controller-level responses, proving no auth gate. A populated `dataObj` would therefore let an anonymous caller add or overwrite the download link users run, or delete legitimate entries. (I did **not** send a valid mutation — the registry is global and uncleanable — the 400/404 controller responses are sufficient proof of the missing gate.)
- **Reproduction:** `curl -s -XPOST -H 'content-type: application/json' -d '{}' http://localhost:4000/api/v1/tracker/create` → `400 {status:false,"Missing required data"}` with no Authorization header (a 401 is expected instead).
- **Suspected file/line:** `Config/setMiddleware.js` — add the tracker mutation routes (`/api/v1/tracker/create`, `/api/v1/tracker/update`, `/api/v1/tracker/delete/:id`) to `verifyJWTToken` (they are global, not company-scoped) with an owner/admin check in `Modules/trackerDownload/controller.js`. The public read (`GET /api/v1/tracker`) may stay open if the download page is meant to be anonymous. Related to the tracked `fix/unauthenticated-v1-routes`, but that PR only added `removeCache`; these routes are still open.

### TIM-04 — Guest (and any member) can read company-wide time/variance data
- **Severity:** medium (information disclosure / missing role scoping)
- **Role:** guest, member
- **Request:** `GET /api/v1/timesheet/hours-by-source`, `POST /api/v1/timesheet/billable-summary`, `GET /api/v1/reports/variance`, `GET /api/v1/reports/variance/summary`
- **Expected:** a Guest is a client with a login and should not see internal, company-wide logged hours or estimate-vs-actual across every user — the billing module already refuses guests via `refuseGuest` for exactly this reason.
- **Actual:** as Kabir (guest, roleType 0): `GET /api/v1/timesheet/hours-by-source?start=1&end=9999999999` returns `{peopleHours:0.03, entryCount:2}` — the whole company's logged entries, though the guest has logged nothing; `GET /api/v1/reports/variance?projectId=<QAS>` returns totals over all 13 tasks and every user's actuals. These controllers only check `companyId` presence, never the caller's role or membership of the project/users being reported on. `billable-summary`, `export-csv`, and the raw aggregate reads (`/timesheet/user|project|workload|tracker`, `/timesheet` aggregate) share the same "trust the client" pattern.
- **Reproduction:** with a guest token + `companyid` header, `GET /api/v1/timesheet/hours-by-source?start=1&end=9999999999` → company-wide `entryCount`.
- **Suspected file/line:** `Modules/TimeSheet/controller/hoursBySource.js`, `billableSummary.js`, and `Modules/VarianceReport/controller.js` — add a guest refusal (mirror `Modules/Milestone/controller/billing.js#refuseGuest`) and, ideally, scope non-privileged callers to their own `Loggeduser`/assigned projects.

### TIM-05 — `POST /api/v1/invoice/find` 500s on a non-pipeline body
- **Severity:** low (error handling)
- **Role:** any authenticated
- **Request:** `POST /api/v1/invoice/find` with `{ findQuery: { companyId: "…" } }`
- **Expected:** a malformed `findQuery` (object rather than an aggregation-pipeline array) is rejected with a 400 and a clear message.
- **Actual:** returns `500 {message:"An error occurred while fetching the invoice.", error:"Arguments must be aggregate pipeline operators"}` — the body is passed straight into a Mongo `aggregate` (against the legacy global `INVOICES` collection) with no shape validation. A pipeline array works, but the object form crashes.
- **Reproduction:** `POST /api/v1/invoice/find` with `{"findQuery":{"companyId":"6a8ee973d625fca52e519a12"}}` → 500.
- **Suspected file/line:** `Modules/Invoice/controller.js#getInvoice` — validate `Array.isArray(findQuery)` before aggregating and return 400 otherwise.

### TIM-06 — Project invoices can be drafted but never deleted via the API
- **Severity:** low (operational gap)
- **Role:** owner/admin (non-guest)
- **Request:** `POST /api/v2/invoices/draft-from-month`, `POST /api/v2/invoices/draft-from-milestone`
- **Expected:** a mistaken draft can be removed (soft-deleted) through the API.
- **Actual:** `Modules/Invoice/routes.js` registers list/get/draft-from-*/update/send/paid but no delete route, so a draft can only ever move forward (`draft → sent → paid`). During the sweep `draft-from-month` also created a numbered draft (`INV-2026-001`) on a project with **no billing contract** (a default contract was synthesised, `clientName` empty), which is easy to do by accident and then impossible to undo without direct DB access. I removed the created draft directly in Mongo (no API path exists).
- **Suspected file/line:** `Modules/Invoice/routes.js` / `Modules/Invoice/controller/projectInvoices.js` — add a `DELETE /api/v2/invoices/:id` that soft-deletes a `draft` (guest-refused, audited), and consider refusing `draft-from-month` when no contract exists.

---

## Checks that passed

- **Role enforcement (correct refusals):**
  - `PUT /api/v1/timesheet/reminder-settings` → 403 for a member; owner/admin only. GET is readable by any member.
  - ScreenshotRetention: `GET /api/v1/screenshot-retention` readable by any member; `GET /screenshot-retention/preview` and `PUT /screenshot-retention` → 403 for member/guest (owner/admin only).
  - PTO: a member creates their own entry (201, forced `pending`); `PUT /api/v1/pto/:id/status` → 403 for guest and for the member approving their own; admin approve works; an `approved` entry cannot be deleted by anyone; a member can delete only their own pending entry.
  - `POST /api/v1/timesheet/workload-move` between two different people → 403 for a member (owner/admin only).
- **Multi-tenant scoping:** a member sending a `companyid` header for another company → `401 Unauthorized` (JWT audience mismatch, `requireCompanyAud`), on `/timesheet/week` and `/pto`.
- **Time logging:** `POST /api/v2/manualLogtime` as a member on a QAS task → 200, entry appears in `GET /api/v1/timesheet/week`; add/edit/delete all honour the approved-period lock guard (`isPeriodLocked`).
- **EstimatedTime:** `PUT /api/v1/estimatedTime` upsert then `POST /api/v1/estimatedTime` aggregate returns the row; `GET /:pid/:tid` works.
- **Billing rates:** `POST /api/v1/timesheet/rates` upsert + `GET /api/v1/timesheet/rates` list.
- **Reminders:** `POST /api/v1/timesheet/send-reminders` respects the opt-in gate (`skipped:"disabled"` by default — no mail sent).
- **Reports/reads:** `/timesheet/user|project|workload|tracker|timelog|logDetail|milestone`, the `/timesheet` aggregate, `billable-summary`, `hours-by-source`, `generate-invoice` (compute-only), and VarianceReport report+summary all return `{status:true|200}` and are `companyId`-scoped (see TIM-04 for the missing per-role scoping).
- **Input validation:** bad dates on `/timesheet/week` → 400; missing dates on `/timesheet/workload-grid` → 400; missing `from/to` on `/pto/capacity` → 400; missing `projectId/sprintId` on variance → 400.
- **Read-only money endpoints:** subscription, subscription-by-id, plan-feature(-display), admin/plan-feature(-display) and the affiliate stubs are reachable read-only and return empty/404 with no data seeded (no checkout, plan change or payment path was touched).
- **Guest invoice view:** `GET /api/v2/invoices` returns only the client-visible list; the guest-refusal (`refuseGuest`) is enforced on the money-bearing billing routes.
