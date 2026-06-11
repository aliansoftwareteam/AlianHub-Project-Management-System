# Jira Importer — Test Cases

**Location:** Project board toolbar → `...` (More) → Import Jira · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Import Flow

| ID     | Title                                  | Precondition                                       | Steps                                                              | Expected Result                                                                                       | Actual Result | Status |
|--------|----------------------------------------|----------------------------------------------------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|---------------|--------|
| JI_001 | Import a valid Jira CSV                | A Jira CSV export with 3–5 rows; sprint selected   | 1. Open `...` → Import Jira  2. Choose the CSV  3. Start the import | Success message with the created count; new tasks appear on the board with names from Jira summaries  |               | ⏳     |
| JI_002 | Imported task fields are sensible      | JI_001 done                                        | 1. Open one imported task                                          | Name = Jira summary; description carried over; valid status in the chosen sprint — no blank cards     |               | ⏳     |
| JI_003 | Invalid file shows a readable error    | Import modal open                                  | 1. Try an empty CSV  2. Try a non-CSV file renamed to .csv         | Readable error toast in both cases; nothing is created; modal stays usable                            |               | ⏳     |
| JI_004 | Malformed rows are skipped, not fatal  | A CSV where one row lacks a Summary                | 1. Import it                                                       | Valid rows import; the bad row is skipped; the import does not abort halfway                          |               | ⏳     |

---

**Total:** 4 test cases · **All status:** ⏳ Pending
