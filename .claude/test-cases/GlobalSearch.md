# Global Search (Search All) — Test Cases

**Location:** Project board toolbar → `...` (More) → Search all · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Searching

| ID     | Title                                        | Precondition                                                       | Steps                                                                        | Expected Result                                                                                  | Actual Result | Status |
|--------|----------------------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------|--------|
| GS_001 | Results grouped by tasks, projects, comments | A keyword (e.g. "web") exists in a task, a project and a comment   | 1. Open `...` → Search all  2. Type the keyword (2+ characters)              | Grouped results appear under TASKS, PROJECTS and CHAT; task rows show key, name, status chip    |               | ⏳     |
| GS_002 | No search under 2 characters                 | Search modal open                                                  | 1. Type a single character                                                   | No results render until the query is at least 2 characters                                      |               | ⏳     |
| GS_003 | Matching is case-insensitive substring       | A task named in lowercase exists                                   | 1. Search an UPPERCASE fragment of its name                                  | The task is found                                                                               |               | ⏳     |
| GS_004 | No-results state                             | Search modal open                                                  | 1. Search a nonsense string like "zzqqxx"                                    | A clear "no results" message; no stale results from the previous query                          |               | ⏳     |

---

## Opening Results

| ID     | Title                                        | Precondition                                                       | Steps                                                                        | Expected Result                                                                                  | Actual Result | Status |
|--------|----------------------------------------------|--------------------------------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------|--------|
| GS_005 | Clicking a task result opens the task        | GS_001 done                                                        | 1. Click a task row in the results                                           | Modal closes; app routes to the task detail (works for folder and non-folder sprints)           |               | ⏳     |
| GS_006 | Clicking a project result opens its board    | GS_001 done                                                        | 1. Search a project by name  2. Click the project row                        | App opens that project's first sprint with the List view tab — no "Page not found"              |               | ⏳     |

---

**Total:** 6 test cases · **All status:** ⏳ Pending
