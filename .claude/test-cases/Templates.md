# Templates — Test Cases

**Location:** Settings → Templates · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Browse Default Templates

| ID      | Title                                                           | Precondition                                   | Steps                                                                              | Expected Result                                                               | Actual Result | Status |
|---------|-----------------------------------------------------------------|------------------------------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| TPL_001 | Default templates loaded on page open                           | Logged in, global templates exist              | 1. Open Settings → Templates                                                       | Default templates grouped by category appear in the right panel               |               | ⏳     |
| TPL_002 | Categories listed in the left panel                             | Global templates have categories               | 1. Open Settings → Templates  2. Look at the left sidebar                         | All available template categories shown as a list                             |               | ⏳     |
| TPL_003 | Selecting a category filters templates on the right             | Multiple template categories exist             | 1. Click a different category in the left panel                                    | Right panel updates to show only templates in the selected category           |               | ⏳     |
| TPL_004 | Active category is highlighted                                  | At least one category is selected              | 1. Open Settings → Templates  2. Click a category                                 | Selected category has a blue/active highlight; others do not                  |               | ⏳     |
| TPL_005 | Empty category shows "No data found"                            | A category exists but has no templates         | 1. Click a category with no templates                                              | "No data found" message shown in the right panel                              |               | ⏳     |
| TPL_006 | Clicking a template opens its detail view                       | At least one template exists in selected cat.  | 1. Click on a template card                                                        | Template detail view/preview opens                                            |               | ⏳     |

---

## Company Templates

| ID      | Title                                                           | Precondition                                   | Steps                                                                              | Expected Result                                                               | Actual Result | Status |
|---------|-----------------------------------------------------------------|------------------------------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| TPL_007 | Company's own templates section visible in left panel           | Logged in with a company                       | 1. Open Settings → Templates  2. Scroll to the company section in the left panel  | "<Company Name>'s Templates" entry shown in the left panel                    |               | ⏳     |
| TPL_008 | Clicking company templates section shows company-created ones   | Company has at least one custom template       | 1. Click "<Company>'s Templates" in the left panel                                 | Only templates created by this company are shown on the right                 |               | ⏳     |
| TPL_009 | Empty state when company has no templates                       | Company has not created any templates          | 1. Click "<Company>'s Templates"                                                   | "No data found" state shown in the right panel                                |               | ⏳     |
| TPL_010 | Company templates sorted by creation date (newest first)        | Company has 3+ custom templates                | 1. Click "<Company>'s Templates"  2. Observe the order                             | Most recently created template appears first                                  |               | ⏳     |

---

## Create Template

| ID      | Title                                                           | Precondition                                   | Steps                                                                              | Expected Result                                                               | Actual Result | Status |
|---------|-----------------------------------------------------------------|------------------------------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| TPL_011 | "Add New Template" button is visible                            | Logged in                                      | 1. Open Settings → Templates  2. Observe the top header                            | "+ Add New Template" button shown in the header                               |               | ⏳     |
| TPL_012 | Clicking "Add New Template" opens the create sidebar           | On the main template listing view              | 1. Click "+ Add New Template"                                                      | Create Template sidebar/wizard opens                                          |               | ⏳     |
| TPL_013 | Cancel button in create sidebar closes without saving           | Create Template sidebar is open                | 1. Enter some template details  2. Click "Cancel"                                  | Sidebar closes; no new template created                                       |               | ⏳     |
| TPL_014 | Newly created template appears in company templates list        | Create Template sidebar is completed           | 1. Create a template  2. Click "<Company>'s Templates" in the left panel           | Newly created template appears at the top of the company list                 |               | ⏳     |

---

## Template Detail / Export

| ID      | Title                                                           | Precondition                                   | Steps                                                                              | Expected Result                                                               | Actual Result | Status |
|---------|-----------------------------------------------------------------|------------------------------------------------|------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| TPL_015 | Template detail view shows template information                 | A template is selected                         | 1. Click on any template card                                                      | Template detail shows name, category, and template configuration              |               | ⏳     |
| TPL_016 | Back/close from detail returns to template list                 | Template detail is open                        | 1. Close/back from the detail view                                                 | Returns to the template list with the previously selected category active     |               | ⏳     |
| TPL_017 | Export template option available on detail view                 | Viewing a company-created template             | 1. Open a company template detail  2. Look for export option                       | Export/download template option visible                                       |               | ⏳     |

---

**Total:** 17 test cases · **All status:** ⏳ Pending
