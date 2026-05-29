# Custom Field Manager — Test Cases

**Location:** Settings → Custom Field Manager · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Custom Field Listing

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_001 | All company custom fields listed on page open                   | Company has custom fields created                   | 1. Open Settings → Custom Field Manager                                | All custom fields listed, sorted by creation date (newest first)             |               | ⏳     |
| CFM_002 | Empty state when no custom fields exist                         | No custom fields have been created for the company  | 1. Open Settings → Custom Field Manager                                | Empty state shown (no fields listed)                                         |               | ⏳     |
| CFM_003 | Fields are sorted newest first                                  | At least 3 custom fields exist with different dates | 1. Open Settings → Custom Field Manager  2. Observe field order        | Most recently created custom field appears at the top                        |               | ⏳     |

---

## Create Custom Field

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_004 | Create a new custom field via sidebar                           | Logged in with settings.settings_custom_field perm  | 1. Click "Add Custom Field"  2. Fill in field details  3. Save         | Toast: "Field Added Successfully"; new field appears at top of the list      |               | ⏳     |
| CFM_005 | Newly created field is marked as global                         | A custom field was just created from Settings       | 1. Create a custom field from Settings → Custom Field Manager          | Field is marked global (available across all projects)                       |               | ⏳     |
| CFM_006 | Cancel in create sidebar closes without saving                  | Create sidebar is open                              | 1. Open create sidebar  2. Enter field details  3. Click Cancel        | Sidebar closes; no new field added to the list                               |               | ⏳     |

---

## Edit Custom Field

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_007 | Edit an existing custom field                                   | At least one custom field exists                    | 1. Click edit on a custom field  2. Update field details  3. Save      | Toast: "Field Updated Successfully"; updated details reflected in the list   |               | ⏳     |
| CFM_008 | Edit sidebar pre-fills with existing field data                 | At least one custom field exists                    | 1. Click edit on a custom field                                        | Sidebar opens with existing name, type, and settings already filled in       |               | ⏳     |
| CFM_009 | Cancel in edit sidebar closes without saving changes            | Edit sidebar is open with unsaved changes           | 1. Change field name  2. Click Cancel                                  | Sidebar closes; original field data unchanged                                |               | ⏳     |

---

## Update Field Type

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_010 | Change the type of a custom field                               | At least one custom field exists                    | 1. Change the field type from the list  2. Confirm                     | Toast: "Field Updated Successfully"; type updated in the list                |               | ⏳     |

---

## Project Scope

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_011 | A global custom field is available in all projects              | A global custom field has been created              | 1. Open any project's custom fields                                    | The global field appears as an available custom field                        |               | ⏳     |
| CFM_012 | Scoping a field to specific projects restricts its visibility   | A global field exists                               | 1. Edit a custom field  2. Set it to specific projects  3. Save        | Toast: "Field Updated Successfully"; field no longer shows in other projects |               | ⏳     |
| CFM_013 | Changing a project-specific field back to global makes it visible everywhere | A project-scoped field exists        | 1. Edit field  2. Set global = true  3. Save                           | Field becomes available in all projects again                                |               | ⏳     |

---

## Permission-based Access

| ID      | Title                                                           | Precondition                                        | Steps                                                                  | Expected Result                                                              | Actual Result | Status |
|---------|-----------------------------------------------------------------|-----------------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CFM_014 | User without settings_custom_field permission sees Access Denied | User lacks settings.settings_custom_field perm     | 1. Open Settings → Custom Field Manager                                | Access Denied shown; custom field list not visible                           |               | ⏳     |

---

**Total:** 14 test cases · **All status:** ⏳ Pending
