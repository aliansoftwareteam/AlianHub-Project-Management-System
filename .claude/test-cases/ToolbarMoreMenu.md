# Toolbar More Menu (`...`) — Test Cases

**Location:** Project board toolbar, next to the Subtask control · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Menu Behavior

| ID     | Title                                          | Precondition               | Steps                                                                                  | Expected Result                                                                                                     | Actual Result | Status |
|--------|------------------------------------------------|----------------------------|----------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|---------------|--------|
| TM_001 | Menu lists all nine feature entries            | Project open on its board  | 1. Click the `...` button on the toolbar                                               | Dropdown shows: Search all, Recent, Burndown, Epics, Pages, Export, Public link, Import Jira, Auto-archive          |               | ⏳     |
| TM_002 | Each entry opens its feature and closes the menu | TM_001 done              | 1. Open the menu  2. Click an entry  3. Repeat for every entry                         | The matching modal/panel opens each time; the dropdown closes itself before the modal appears                       |               | ⏳     |
| TM_003 | Menu closes without selection                  | Menu open                  | 1. Click anywhere outside the dropdown                                                 | Menu closes; nothing opens                                                                                          |               | ⏳     |
| TM_004 | Toolbar stays on one line                      | Default board view, normal desktop width | 1. Look at the toolbar with search, filters, Group by, Subtask and `...` visible | Controls fit on a single line — no second-line wrap caused by feature buttons                                       |               | ⏳     |
| TM_005 | Old standalone buttons are gone                | Project open on its board  | 1. Inspect the toolbar                                                                 | No separate Burndown/Recent/etc. buttons remain — the nine features exist only inside the `...` menu                |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
