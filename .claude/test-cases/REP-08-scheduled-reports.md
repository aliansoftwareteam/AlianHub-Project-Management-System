# Test Cases — REP-08 Scheduled / Emailed Reports (AHE-3725)

Emails a saved report (REP-02) to recipients on a cadence. Mirrors the existing
recurring-tasks / time-reminders cron pattern: a prod-only hourly cron runs
`runScheduledReportsForAllCompanies`; dev exercises the exact same path via
`POST /run-due`. Delivery uses `service.SendEmail` (Resend HTTP API or SMTP),
which **fails gracefully** when mail isn't configured — never throws into a request
or a cron tick.

**New collection:** `report_schedules` (companyId-scoped) — `{savedReportId, cadence,
recipients[], active, lastRunAt, nextRunAt}`.

**Endpoints** (under JWT-scoped `/api/v1/reports/schedules`):
- `GET  /` — list schedules (with saved-report name)
- `POST /` `{savedReportId, cadence, recipients}` — create
- `PUT  /:id` — update cadence / recipients / active
- `DELETE /:id` — soft-delete
- `POST /:id/run-now` — send once now (does not advance the schedule)
- `POST /run-due` — process due schedules for the caller's company (dev mirror of the cron)

**Frontend:** "Scheduled emails" panel on the Custom Report page — create form (report + cadence + recipients) and a list with Send-now / Delete.

## Pure-rule unit tests (`tests/schedule-rules.test.js`) — 15/15 passing

| Group | Cases |
|-------|-------|
| `validateSchedule` | valid (string recipients) · missing id + no valid email (2 errors) · unknown cadence → weekly · dedupe+lowercase recipients |
| `computeNextRun` | daily +1d · weekly +7d · monthly +1mo · invalid date → null |
| `isDue` | active+past → due · active+future → not · inactive → not · never-run+active → due · deleted → not |
| `reportEmailHtml` | renders rows + HTML-escapes · empty rows → "No data." |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create schedule | Pick a saved report, "Weekly", enter 2 emails, Schedule | Schedule appears: "weekly · 2 recipient(s)"; nextRunAt = now + 7d |
| M2 | Invalid recipients | recipients = "garbage" | 400 "at least one valid recipient email is required" |
| M3 | Unknown report | POST with bad savedReportId | 404 "Saved report not found." |
| M4 | Send now (mail configured) | Click "Send now" | Recipients receive an HTML table of the report's current data |
| M5 | Send now (mail NOT configured, e.g. localhost) | Click "Send now" | 200, `data.sent=false`, message "Could not send — mail may not be configured."; **no crash** |
| M6 | run-due idempotency | `POST /run-due` twice in a row | First processes due ones and advances nextRunAt; second finds none due |
| M7 | Cadence change | Edit a schedule daily→monthly | nextRunAt recomputed (now + 1 month) |
| M8 | Deactivate | Set active=false | Skipped by run-due / cron |
| M9 | Deleted report | Delete the saved report, then run-due | Schedule's delivery is skipped (report-missing), schedule still advances (no repeated failures) |
| M10 | companyId isolation | Two companies | Each only sees/sends its own schedules |

## Guards / non-regression
- **Cron is prod-only** (`index.js` gates `require('./cron.js')` on `NODE_ENV==='production'`) — adding a cron entry cannot run on localhost/staging-dev. Dev uses `/run-due`.
- The runner advances `nextRunAt` **regardless of send outcome**, so a misconfigured mailer can't re-fire the same report every tick.
- Report data is produced by the REP-02 whitelist engine (`reportRules.buildPipeline`) — no raw fields/operators.
- New collection + new route prefix; reuses the shared mailer. No existing endpoint, schema, collection or cron job modified — only additive entries.
- All loops wrapped in `.catch` + `logger.error`; a single bad company/schedule can't abort the sweep.
