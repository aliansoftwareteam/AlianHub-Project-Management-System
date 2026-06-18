# Recurring Tasks — Test Cases

**Location:** Project → `+ View` → Recurring Tasks · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky
>
> **Setup:** add the **Recurring Tasks** view to the project via `+ View`.

---

## Definitions & Execution

| ID      | Title                          | Precondition                                                       | Steps                                                                                                                  | Expected Result                                                          | Actual Result | Status |
|---------|--------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| REC_001 | Create a recurring definition  | Recurring Tasks view added                                         | 1. `+ View` → Recurring Tasks  2. `+ New`  3. Fill definition name, task title, frequency (daily/weekly/monthly), interval, time, priority  4. Create | Definition appears in the list with a computed **Next run**              |               | ⏳     |
| REC_002 | Run now creates a task         | REC_001 done                                                       | 1. Click **Run now** on a definition  2. Open the project task list                                                    | A task is created immediately; the definition's **Runs** count increments |               | ⏳     |
| REC_003 | Pause / resume                 | An enabled definition                                              | 1. Click Pause  2. Click Resume                                                                                        | Enabled flag toggles; paused rows are dimmed and won't auto-run          |               | ⏳     |
| REC_004 | Delete a definition            | A definition exists                                                | 1. Click Delete                                                                                                        | Definition is removed from the list                                      |               | ⏳     |
| REC_005 | Skip if previous still open    | A definition with "Skip if previous still open" and an open prior instance | 1. Run now once (leave the created task open)  2. Run now again                                                | Second run is skipped ("previous instance still open")                   |               | ⏳     |
| REC_006 | Weekly schedule summary        | —                                                                  | 1. Create a weekly definition with specific weekdays + time                                                           | Schedule summary and **Next run** reflect the chosen day/time            |               | ⏳     |
| REC_007 | Scheduled auto-creation        | A due definition (nextRunAt ≤ now)                                 | 1. Production: wait for the 15-min cron. Local: `POST /api/v1/recurring-tasks/run-due`                                 | Due definitions instantiate tasks on schedule (cron is production-only; use Run now / run-due locally) |               | ⏳     |

---

**Total:** 7 test cases · **All status:** ⏳ Pending
