# Change Password — Test Cases

**Location:** Settings → Change Password · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Successful Password Change

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_001 | Change password with valid current and new passwords               | Logged in, current password is known            | 1. Enter correct current password  2. Enter a valid new password  3. Enter the same in confirm  4. Click Save Changes | Toast: "Password reset has been successfully"; session deleted; user logged out |               | ⏳     |
| CP_002 | All fields are cleared after a password change attempt             | Password change was attempted (success or fail) | 1. Fill all fields  2. Click Save Changes                                                                             | All three password fields are cleared regardless of success or failure          |               | ⏳     |
| CP_003 | User is automatically logged out after successful password change  | Password was just changed successfully          | 1. Successfully change password                                                                                       | User redirected to login page; previous session is invalidated                  |               | ⏳     |

---

## Validation — Field Requirements

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_004 | Current password field is required                                 | Change Password page is open                    | 1. Leave current password empty  2. Click Save Changes                                                               | Validation error shown on current password field                                |               | ⏳     |
| CP_005 | New password field is required                                     | Change Password page is open                    | 1. Fill current password only  2. Click Save Changes                                                                 | Validation error shown on new password field                                    |               | ⏳     |
| CP_006 | Confirm password field is required                                 | Change Password page is open                    | 1. Fill current + new password  2. Leave confirm empty  3. Click Save Changes                                        | Error: "The confirm password field is required"                                 |               | ⏳     |

---

## Validation — Password Strength

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_007 | Password must be at least 8 characters                             | Change Password page is open                    | 1. Enter a 7-character password in New Password  2. Click Save Changes                                               | Validation error: minimum 8 characters required                                 |               | ⏳     |
| CP_008 | Password must contain at least one uppercase letter                | Change Password page is open                    | 1. Enter password with no uppercase letters  2. Click Save Changes                                                   | Validation error on the new password field                                      |               | ⏳     |
| CP_009 | Password must contain at least one lowercase letter                | Change Password page is open                    | 1. Enter password with no lowercase letters  2. Click Save Changes                                                   | Validation error on the new password field                                      |               | ⏳     |
| CP_010 | Password must contain at least one digit                           | Change Password page is open                    | 1. Enter password with no numbers  2. Click Save Changes                                                             | Validation error on the new password field                                      |               | ⏳     |
| CP_011 | Password must contain at least one special character               | Change Password page is open                    | 1. Enter password with no special character (e.g. "#?!@$%^&*-")  2. Click Save Changes                              | Validation error on the new password field                                      |               | ⏳     |
| CP_012 | Same strength rules apply to current password field                | Change Password page is open                    | 1. Enter a weak current password (< 8 chars)  2. Click Save Changes                                                  | Validation error shown on current password field                                |               | ⏳     |

---

## Validation — Confirm Password

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_013 | Confirm password must match new password                           | Valid new password entered                      | 1. Enter new password  2. Enter a different value in confirm  3. Click Save Changes                                  | Error: "The confirm password confirmation does not match"                        |               | ⏳     |
| CP_014 | Confirm password error updates live as new password changes        | Both new and confirm fields have values         | 1. Change the new password value  2. Observe confirm error without clicking Save                                     | Confirm mismatch error appears or clears in real time                           |               | ⏳     |

---

## API Error Cases

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_015 | Wrong current password shows appropriate error                     | Logged in as any user                           | 1. Enter wrong current password  2. Enter valid new + confirm password  3. Click Save Changes                        | Toast error shown (e.g. "password_wasnot_valid"); fields cleared                |               | ⏳     |
| CP_016 | Too many failed attempts shows rate-limit error                    | Multiple wrong password attempts made           | 1. Fail password change multiple times in quick succession                                                           | Toast: rate-limit error shown; no change applied                                |               | ⏳     |

---

## Show/Hide Password Toggles

| ID     | Title                                                              | Precondition                                    | Steps                                                                                                                | Expected Result                                                                 | Actual Result | Status |
|--------|--------------------------------------------------------------------|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|---------------|--------|
| CP_017 | Toggle shows/hides current password                                | Current password field has text                 | 1. Click the eye icon next to the current password field                                                             | Field switches between •••• and visible text; icon changes accordingly          |               | ⏳     |
| CP_018 | Toggle shows/hides new password                                    | New password field has text                     | 1. Click the eye icon next to the new password field                                                                 | Field switches between •••• and visible text                                    |               | ⏳     |
| CP_019 | Toggle shows/hides confirm password                                | Confirm password field has text                 | 1. Click the eye icon next to the confirm password field                                                             | Field switches between •••• and visible text                                    |               | ⏳     |
| CP_020 | Each toggle is independent                                         | All three fields have text                      | 1. Toggle only the new password field                                                                                | Only new password visible; current and confirm remain masked                    |               | ⏳     |

---

**Total:** 20 test cases · **All status:** ⏳ Pending
