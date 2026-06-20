# Time-Entry Reminders — Test Cases

**Feature:** TIME-06 — daily nudge to members who haven't logged time
**Backend:** `Modules/TimeSheet/helpers/reminderRules.js` (pure) + `timeReminders.js` (service: `sendTimeRemindersForCompany`, `runRemindersForAllCompanies`, `triggerReminders`)
**Schedule:** prod cron daily 17:00 (`cron.js`); manual trigger `POST /api/v1/timesheet/send-reminders`
**Delivery:** email via `service.SendEmail` (Resend/SMTP; degrades gracefully when unconfigured)
**Unit tests:** `tests/reminder-rules.test.js` (7 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| TR-01 | Manual trigger | Logged in; mail configured | `POST /api/v1/timesheet/send-reminders` | `{status:true, data:{ reminded, total, users[] }}`; emails sent to members who haven't logged today | | ⬜ |
| TR-02 | Logged members skipped | A member logged time today | Trigger | That member is NOT in the reminder list | | ⬜ |
| TR-03 | No-email members skipped | A member without an email | Trigger | That member is skipped | | ⬜ |
| TR-04 | Reminder content | A member with no time today | Trigger | They receive a "log your time" email greeting them by first name | | ⬜ |
| TR-05 | Daily cron (prod) | Production | Wait for 17:00 (CRON_TZ) | `runRemindersForAllCompanies` runs for every company | | ⬜ |
| TR-06 | Graceful without mail | Local dev, no SMTP/Resend | Trigger | No crash; `sent:false` per user; the list of who'd be reminded still returns | | ⬜ |
| TR-07 | Per-company scope | Two companies | Trigger for company A | Only A's members are considered | | ⬜ |

**Total:** 7 cases (API/cron — run on the dev server). Reminder rules covered by 7 automated unit tests.
