# Security & Permissions — Test Cases

**Location:** Settings → Security & Permissions · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Permissions Table

| ID      | Title                                                                | Precondition                                           | Steps                                                                          | Expected Result                                                                  | Actual Result | Status |
|---------|----------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| SEC_001 | Permissions table loads with all roles as columns                    | Logged in as Admin, roles exist (excluding Owner)      | 1. Open Settings → Security & Permissions                                      | All non-Owner roles appear as column headers in the permissions table            |               | ⏳     |
| SEC_002 | Permission rows are shown with parent and child structure            | Rules have been set up with parent/child hierarchy     | 1. Open Settings → Security & Permissions                                      | Parent rows visible; child rows listed under their parent                        |               | ⏳     |
| SEC_003 | Search field filters the permission rows                             | Multiple permission rows exist                         | 1. Type a partial permission name in the search field                          | Only rows whose names match the search term are shown                            |               | ⏳     |
| SEC_004 | Row highlight flashes briefly when a permission is toggled           | Table is loaded with permissions                       | 1. Toggle any permission checkbox/value for a role                             | The affected row briefly highlights (flash animation) to confirm the change      |               | ⏳     |
| SEC_005 | Toggling a parent permission cascades to all its child permissions   | A parent row with children exists                      | 1. Change the permission on a parent row for any role                          | All child rows for that same role update to match the parent's value             |               | ⏳     |

---

## Save Permissions

| ID      | Title                                                                | Precondition                                           | Steps                                                                          | Expected Result                                                                  | Actual Result | Status |
|---------|----------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| SEC_006 | Save button is visible for users with edit permission                | User has settings.settings_security_permissions = true | 1. Open Settings → Security & Permissions  2. Observe top right                | "Save" button is visible                                                         |               | ⏳     |
| SEC_007 | Saving changed permissions shows "Permission updated successfully"   | At least one permission was changed                    | 1. Change a permission value  2. Click "Save"                                  | Toast: "Permission updated successfully"; spinner disappears                     |               | ⏳     |
| SEC_008 | Saving with no changes shows "Nothing to update"                     | No permissions were changed since last save            | 1. Click "Save" without changing anything                                      | Toast: "Nothing to update"                                                       |               | ⏳     |
| SEC_009 | Spinner shown while saving                                           | At least one permission was changed                    | 1. Change a permission  2. Click "Save"  3. Observe during the API call        | Spinner/loading indicator visible while the save request is in progress          |               | ⏳     |
| SEC_010 | Rule and UserProjectData caches are cleared after successful save    | Permissions were just saved successfully               | 1. Save permissions  2. Immediately navigate to a permission-dependent page    | Updated permissions are reflected immediately without stale cache                |               | ⏳     |

---

## AI Generate Limit Validation

| ID      | Title                                                                | Precondition                                           | Steps                                                                          | Expected Result                                                                  | Actual Result | Status |
|---------|----------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| SEC_011 | Valid integer within plan range is accepted for AI limit             | Plan has a defined AI request limit                    | 1. Enter a valid integer in the AI generate limit field  2. Click Save         | Save succeeds; "Permission updated successfully" toast shown                     |               | ⏳     |
| SEC_012 | Non-integer value is rejected for AI limit                           | AI limit field is visible                              | 1. Enter a decimal (e.g. 1.5) in the AI limit field  2. Click Save             | Toast: "Per User Generate Limit value is not valid"; permissions not saved       |               | ⏳     |
| SEC_013 | Value exceeding plan maximum is rejected for AI limit                | Plan has a defined maximum AI request limit            | 1. Enter a number greater than the plan maximum  2. Click Save                 | Toast: "Per User Generate Limit value is not valid"; permissions not saved       |               | ⏳     |
| SEC_014 | Value below zero is rejected for AI limit                            | AI limit field is visible                              | 1. Enter a negative number  2. Click Save                                      | Toast: "Per User Generate Limit value is not valid"; permissions not saved       |               | ⏳     |

---

## Plan Feature Gate

| ID      | Title                                                                | Precondition                                           | Steps                                                                          | Expected Result                                                                  | Actual Result | Status |
|---------|----------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| SEC_015 | Upgrade Plan screen shown when global permissions not in plan        | Company plan does not include globalPermison feature   | 1. Open Settings → Security & Permissions                                      | Upgrade Plan screen shown; permissions table visible but blurred/disabled        |               | ⏳     |
| SEC_016 | Save button disabled when plan does not include global permissions   | Company plan does not include globalPermison feature   | 1. Open Settings → Security & Permissions  2. Attempt to click Save            | Save button is greyed out / no action when clicked                               |               | ⏳     |

---

## Permission-based Access

| ID      | Title                                                                | Precondition                                           | Steps                                                                          | Expected Result                                                                  | Actual Result | Status |
|---------|----------------------------------------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------|---------------|--------|
| SEC_017 | Admin (roleType 1) can access the page                               | Logged in as Admin                                     | 1. Open Settings → Security & Permissions                                      | Permissions table visible                                                        |               | ⏳     |
| SEC_018 | Manager (roleType 2) can access the page                             | Logged in as Manager                                   | 1. Open Settings → Security & Permissions                                      | Permissions table visible                                                        |               | ⏳     |
| SEC_019 | User with settings_security_permissions perm can access the page     | User has settings.settings_security_permissions != null | 1. Open Settings → Security & Permissions                                     | Permissions table visible                                                        |               | ⏳     |
| SEC_020 | Other users see Access Denied                                        | Logged in as Member without the required permission    | 1. Open Settings → Security & Permissions                                      | Access Denied image shown; permissions table not visible                         |               | ⏳     |

---

**Total:** 20 test cases · **All status:** ⏳ Pending
