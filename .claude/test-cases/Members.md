# Members — Test Cases

**Location:** Settings → Members · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Member Listing & Search

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_001 | All active members displayed in the list               | Logged in as Admin, company has members    | 1. Open Settings → Members                                                          | All active members listed with name, email, role, designation, status   |               | ⏳     |
| MBR_002 | Search member by name                                  | Company has 3+ members                     | 1. Type a partial name in the search box                                            | Only matching members shown; others hidden                              |               | ⏳     |
| MBR_003 | Search member by email                                 | Company has 3+ members                     | 1. Type a partial email in the search box                                           | Only members with a matching email shown                                |               | ⏳     |
| MBR_004 | Removed Members tab shows deactivated members          | At least one member has been removed       | 1. Click the "Removed Members" tab                                                  | Only removed/deactivated members listed; active members not shown       |               | ⏳     |
| MBR_005 | Member last active time is displayed                   | Members have previously logged in          | 1. Open Settings → Members  2. Look at each member row                              | Last active time shown (e.g. "2 hours ago", "3 days ago")               |               | ⏳     |

---

## Invite Member

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_006 | Invite a new member by email                           | Logged in as Admin, valid email available  | 1. Click "Invite Member"  2. Enter email  3. Select role and designation  4. Send   | Invitation sent; member appears in list with "Pending" status           |               | ⏳     |
| MBR_007 | Cannot invite with an invalid email format             | Logged in as Admin                         | 1. Click "Invite Member"  2. Enter an invalid email (e.g. "test@")  3. Send        | Validation error shown; invitation not sent                             |               | ⏳     |
| MBR_008 | Cannot invite an already active member                 | Member is already active in the company    | 1. Click "Invite Member"  2. Enter the active member's email  3. Send              | Error shown: user is already a member                                   |               | ⏳     |
| MBR_009 | Cannot invite an already pending member                | An invitation is pending for an email      | 1. Click "Invite Member"  2. Enter the same pending email  3. Send                 | Error shown: invitation already sent to this email                      |               | ⏳     |
| MBR_010 | Role and designation are required to send invite       | Logged in as Admin                         | 1. Click "Invite Member"  2. Enter email but leave role or designation empty  3. Send | Validation error shown; invitation not sent                          |               | ⏳     |

---

## Invitation Management

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_011 | Resend invitation to a pending member                  | At least one pending invitation exists     | 1. Click ··· on a pending member  2. Click "Resend Invitation"                     | Invitation email resent; member status remains "Pending"                |               | ⏳     |
| MBR_012 | Cancel a pending invitation                            | At least one pending invitation exists     | 1. Click ··· on a pending member  2. Click "Cancel Invitation"  3. Confirm         | Member removed from the list; invitation is void                        |               | ⏳     |

---

## Role Management

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_016 | Change a member's role                                 | Member exists, multiple roles available    | 1. Click the role dropdown on a member  2. Select a different role  3. Confirm     | Member's role updated; confirmation dialog shown before change          |               | ⏳     |
| MBR_017 | Create a new role                                      | Logged in as Admin                         | 1. Open role dropdown  2. Click "+ Add Role"  3. Enter role name  4. Save          | New role appears in the role dropdown for all members                   |               | ⏳     |
| MBR_018 | Edit an existing role name                             | At least one custom role exists            | 1. Open role dropdown  2. Click edit on a role  3. Change name  4. Save            | Updated role name reflected across all members using it                 |               | ⏳     |
| MBR_019 | Delete an unused role                                  | A role exists with no members assigned     | 1. Open role dropdown  2. Click delete on the role  3. Confirm                     | Role removed from the list                                              |               | ⏳     |
| MBR_020 | Cannot delete a role assigned to active members        | A role has at least one member assigned    | 1. Open role dropdown  2. Click delete on the assigned role                        | Error shown; role not deleted                                           |               | ⏳     |
| MBR_021 | Cannot change the Owner's role                         | Company has an Owner member                | 1. Click the role dropdown on the Owner member                                     | Role field is disabled or no change option available for Owner          |               | ⏳     |

---

## Designation Management

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_022 | Assign a designation to a member                       | Member has no designation, options exist   | 1. Click the designation dropdown on a member  2. Select a designation  3. Confirm | Designation saved and shown on the member row                           |               | ⏳     |
| MBR_023 | Create a new designation                               | Logged in as Admin                         | 1. Open designation dropdown  2. Click "+ Add Designation"  3. Enter name  4. Save | New designation appears in the dropdown for all members                 |               | ⏳     |
| MBR_024 | Edit an existing designation name                      | At least one custom designation exists     | 1. Open designation dropdown  2. Click edit  3. Change name  4. Save               | Updated designation name reflected across all members using it          |               | ⏳     |
| MBR_025 | Delete an unused designation                           | A designation exists with no members       | 1. Open designation dropdown  2. Click delete  3. Confirm                          | Designation removed from the list                                       |               | ⏳     |
| MBR_026 | Cannot delete a designation assigned to members        | A designation has at least one member      | 1. Open designation dropdown  2. Click delete on the assigned designation          | Error shown; designation not deleted                                    |               | ⏳     |

---

## Remove & Deactivate

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_027 | Remove an active member                                | Logged in as Admin, member is active       | 1. Click ··· on a member  2. Click "Remove"  3. Confirm                            | Member moved to "Removed Members" tab; no longer in active list         |               | ⏳     |
| MBR_028 | Removed member appears in Removed Members tab          | A member was just removed                  | 1. Click the "Removed Members" tab                                                  | Recently removed member listed there                                    |               | ⏳     |
| MBR_029 | Permanently delete a removed member                    | At least one member in Removed tab         | 1. Open "Removed Members" tab  2. Click ··· → "Delete Permanently"  3. Confirm     | Member record fully deleted; no longer appears anywhere                 |               | ⏳     |

---

## Reactivate Member

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_030 | Reactivate a removed member                            | At least one member in Removed tab         | 1. Open "Removed Members" tab  2. Click ··· → "Reactivate"  3. Confirm            | Member moved back to active list; re-invitation sent                    |               | ⏳     |

---

## Time Tracking Access

| ID      | Title                                                  | Precondition                               | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_031 | Enable time tracking for a member                      | Time Tracking feature available in plan    | 1. Find a member with tracking disabled  2. Toggle the time tracking switch ON      | Member gains tracker access; can start tracker on tasks                 |               | ⏳     |
| MBR_032 | Disable time tracking for a member                     | Member has time tracking enabled           | 1. Toggle the time tracking switch OFF for a member                                 | Member loses tracker access; tracker button hidden on tasks             |               | ⏳     |
| MBR_033 | Time tracker toggle respects plan user limit           | Plan has a fixed tracker user limit        | 1. Try to enable tracking for a member when limit is already reached                | Warning shown; toggle not applied until limit is increased/upgraded     |               | ⏳     |

---

## Permission-based Access

| ID      | Title                                                  | Precondition                                       | Steps                                                                               | Expected Result                                                         | Actual Result | Status |
|---------|--------------------------------------------------------|----------------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------|---------------|--------|
| MBR_034 | User without invite permission cannot see Invite button | Logged in as user without invite_member permission | 1. Open Settings → Members                                                         | "Invite Member" button is not visible                                   |               | ⏳     |
| MBR_035 | User without member list permission cannot access page  | Logged in as user without member_list permission   | 1. Navigate to Settings → Members                                                  | Page is hidden or "Access Denied" shown                                 |               | ⏳     |

---

**Total:** 32 test cases · **All status:** ⏳ Pending
