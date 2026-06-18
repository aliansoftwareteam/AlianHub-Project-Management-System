# Trello Importer — Test Cases

**Location:** Project board toolbar → `...` (More) → Import Trello · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Setup & Basic Import

| ID      | Title                                    | Precondition                                                                                          | Steps                                                                                                                        | Expected Result                                                              | Actual Result | Status |
|---------|------------------------------------------|------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| TRL_001 | Export a Trello board to JSON (3rd-party) | A Trello board with lists + cards; for rich-import coverage add a checklist, comment, label, attachment and a member to a card | 1. Open the board → board menu (`⋯` / "Show menu")  2. "Print, export, and share" → "Export as JSON"  3. Save the `.json` file | A Trello board JSON export file is obtained (no API key/token needed)        |               | ⏳     |
| TRL_002 | Import the board                         | TRL_001 done; a sprint to import into                                                                | 1. Project → `...` → Import Trello  2. Upload the `.json`  3. Confirm the "X lists, Y cards" preview  4. Pick a sprint  5. Import | Lists → statuses, cards → tasks in the sprint; card name / description / due-date mapped |               | ⏳     |

---

## Rich Import (S3-01)

| ID      | Title                          | Precondition                                            | Steps                                  | Expected Result                                                                       | Actual Result | Status |
|---------|--------------------------------|---------------------------------------------------------|----------------------------------------|---------------------------------------------------------------------------------------|---------------|--------|
| TRL_003 | Checklists imported            | A card with a checklist                                 | 1. Import  2. Open the task            | Task has the checklist with items in order and correct checked/unchecked state        |               | ⏳     |
| TRL_004 | Comments imported              | A card with comments                                    | 1. Import  2. Open the task comments   | Comments imported as task comments (author + text)                                    |               | ⏳     |
| TRL_005 | Labels folded into description | A card with labels                                      | 1. Import  2. Open the task            | Labels appended to the description ("Labels: …")                                       |               | ⏳     |
| TRL_006 | Attachments as link references | A card with attachments                                 | 1. Import  2. Open the task            | Attachments imported as link references (filename + URL; not re-downloaded)           |               | ⏳     |
| TRL_007 | Member email → assignee        | A card whose member email matches an AlianHub user      | 1. Import  2. Open the task            | That user added as a task assignee (best-effort; only when the export includes emails) |               | ⏳     |
| TRL_008 | Closed / nameless skipped      | A board with closed lists/cards + a nameless card       | 1. Import                              | Closed and nameless items are skipped; valid cards still import                        |               | ⏳     |

---

**Total:** 8 test cases · **All status:** ⏳ Pending
