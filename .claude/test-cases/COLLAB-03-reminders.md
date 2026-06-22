# Test Cases — COLLAB-03 Personal Reminders (AHE-3754)

Personal deadline/task reminders. A reminder is scheduled for a time; when that time
passes, it **fires** — an in-app notification is delivered to the owner. Built **additively**
by mirroring `Modules/RecurringTasks/` (new collection + module + node-schedule cron +
local-test endpoints); no shared write path touched.

## Architecture
- **Collection** `reminders` (new): `{ userId, companyId, taskId, projectId, reminderText, reminderAt, fired, firedAt, createdBy, deletedStatusKey }`. Registered across schemaType / collections / schema.js / createSchema.js (indexed `{userId,fired,reminderAt}`) / mongoQueries (checkType+tableType) — all additive.
- **Module** `Modules/Reminders/` — init/routes/controller/helper + `remindersRules.js` (pure logic).
- **Endpoints:** `POST /api/v1/reminders` (create), `GET /api/v1/reminders` (mine), `PATCH /:id`, `DELETE /:id` (soft), `POST /api/v1/reminders/run-due` (process due for company — manual/test), `POST /api/v1/reminders/:id/run-now` (fire one — test).
- **Cron** (`cron.js`): every minute, `runRemindersForAllCompanies()` fires due un-fired reminders across companies (prod). The `fired` flag makes it idempotent; `run-due`/`run-now` exercise the same path in dev.
- **Firing** reuses the existing notification path (`controllerV2` createNotificationsBody + createCommonNotificationsBody): per-company notifications doc + global copy + `globalNotification:insert` socket emit + bell-count bump (`updateUnReadCommentsCountFun`, key 5). Isolated — the shared pipeline code is untouched.
- **UI:** a "Remind me" action in the task-detail action menu → a date-time modal → `POST /reminders`.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create a reminder | task ⋯ menu → Remind me → pick a time + note → Save | success toast; reminder persisted (`fired:false`) |
| M2 | **Fires at time** (core) | create a reminder with `reminderAt` in the **past** → `POST /api/v1/reminders/run-due` | response reports `fired:1`; an in-app **bell notification** appears for you; reminder now `fired:true, firedAt` set |
| M3 | run-now | `POST /api/v1/reminders/:id/run-now` | that reminder fires immediately; marked fired |
| M4 | Idempotent | run-due twice | a fired reminder is **not** re-fired (fired flag) |
| M5 | Not-yet-due | reminder with future `reminderAt` → run-due | not fired (skipped) |
| M6 | List mine | `GET /api/v1/reminders` | returns the caller's non-deleted reminders |
| M7 | Edit re-arms | PATCH a fired reminder's time to the future | `fired` reset → it will fire again at the new time |
| M8 | Delete | DELETE /:id | soft-deleted (deletedStatusKey=1); excluded from run-due |
| M9 | Cron (prod) | wait for the minute cron | due reminders fire automatically |

## Guards / non-regression
- New collection + module + cron block + one module-init line — additive; existing schema/switch/cron untouched. jest 495 pass (incl. the new rules suite); frontend build clean.
- Firing persists a notification + emits live; the in-app bell updates in all environments (FCM/email path stays prod-only, as for other notifications).
- ⚠️ Live firing verified by logic + unit tests; smoke-test on a dev server (M2) to confirm the bell notification end-to-end.
