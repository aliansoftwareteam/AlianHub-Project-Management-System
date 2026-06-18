# CSV Importer — Test Cases

**Location:** Project board toolbar → `...` (More) → Import CSV · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Import Flow

| ID      | Title                              | Precondition                                                            | Steps                                                                                              | Expected Result                                                                          | Actual Result | Status |
|---------|------------------------------------|-------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|---------------|--------|
| CSV_001 | Import a valid CSV                 | A CSV with a header row (Task Name, Status, Priority, Due Date, Description); a sprint to import into | 1. Open `...` → Import CSV  2. Upload the file  3. Confirm the auto-detected column mapping  4. Pick the target sprint  5. Import | Success message with created count; tasks appear in the sprint with mapped name/status/priority/due |               | ⏳     |
| CSV_002 | Manual column-mapping override     | A CSV whose headers differ (e.g. "Summary" not "Task Name")             | 1. Upload  2. Adjust the column-mapping dropdowns manually  3. Import                              | Import respects the manual mapping                                                       |               | ⏳     |
| CSV_003 | Row missing a task name is skipped | A CSV where one row has no task name                                    | 1. Import                                                                                          | That row is skipped; created count excludes it; import does not abort                    |               | ⏳     |
| CSV_004 | Unknown status falls back          | A CSV with a status not configured in the project                       | 1. Import                                                                                          | Task falls back to the project's first status                                            |               | ⏳     |
| CSV_005 | Priority mapping                   | A CSV with Highest / High / Medium / Low                                | 1. Import  2. Open the tasks                                                                       | Priorities mapped (e.g. Highest→Urgent, High→High, Medium→Normal)                        |               | ⏳     |
| CSV_006 | XLSX upload                        | An `.xlsx` file with the same columns                                   | 1. Upload the .xlsx and import                                                                     | Parses and imports the same as CSV                                                       |               | ⏳     |
| CSV_007 | Import history                     | A completed import                                                      | 1. Re-open the import modal / import history                                                       | Job listed as source "csv" with total / processed / created counts                       |               | ⏳     |
| CSV_008 | Invalid file handled               | Import modal open                                                       | 1. Try an empty file  2. Try a non-CSV renamed to `.csv`                                           | Readable error in both cases; nothing created; modal stays usable                        |               | ⏳     |

---

**Total:** 8 test cases · **All status:** ⏳ Pending
