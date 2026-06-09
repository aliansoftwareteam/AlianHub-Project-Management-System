# My Profile — Test Cases

**Location:** Settings → My Profile · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Profile

| ID     | Title                                                         | Precondition                            | Steps                                                  | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|--------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_001 | Profile page loads with existing user data pre-filled         | Logged in as any user                   | 1. Open Settings → My Profile                          | First name, last name, email, time format, timezone, language pre-filled |               | ⏳     |
| MP_002 | Profile picture shown if uploaded; initials shown if not      | User has a profile picture              | 1. Open Settings → My Profile  2. Observe the avatar   | Profile picture displayed; if no picture, first letter of first name shown |             | ⏳     |
| MP_003 | Email field is read-only (disabled)                           | Logged in as any user                   | 1. Open Settings → My Profile  2. Try to edit email    | Email field is disabled; cannot be changed                               |               | ⏳     |

---

## Edit Profile

| ID     | Title                                                         | Precondition                            | Steps                                                                       | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_004 | Update first name and save                                    | Logged in as any user                   | 1. Change first name  2. Click "Save Changes"                               | Toast: "Profile updated successfully"; new name reflected in sidebar     |               | ⏳     |
| MP_005 | Update last name and save                                     | Logged in as any user                   | 1. Change last name  2. Click "Save Changes"                                | Toast: "Profile updated successfully"; full name updated                 |               | ⏳     |
| MP_006 | Cannot save with empty first name                             | Logged in as any user                   | 1. Clear the first name field  2. Click "Save Changes"                      | Validation error shown; profile not saved                                |               | ⏳     |
| MP_007 | Cannot save with empty last name                             | Logged in as any user                   | 1. Clear the last name field  2. Click "Save Changes"                       | Validation error shown; profile not saved                                |               | ⏳     |
| MP_008 | Saving without any changes shows "Nothing to update"          | No fields were changed                  | 1. Open My Profile  2. Click "Save Changes" immediately                     | Toast: "Nothing to update"                                               |               | ⏳     |

---

## Time Format

| ID     | Title                                                         | Precondition                            | Steps                                                                       | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_009 | Switch time format to 12-hour and save                        | Currently set to 24-hour format         | 1. Select "12 hours" radio  2. Click "Save Changes"                         | Toast: "Profile updated successfully"; time displayed in 12h format      |               | ⏳     |
| MP_010 | Switch time format to 24-hour and save                        | Currently set to 12-hour format         | 1. Select "24 hours" radio  2. Click "Save Changes"                         | Toast: "Profile updated successfully"; time displayed in 24h format      |               | ⏳     |

---

## Timezone

| ID     | Title                                                         | Precondition                            | Steps                                                                       | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_011 | Change timezone and save                                      | Logged in as any user                   | 1. Open timezone dropdown  2. Select a different timezone  3. Save Changes  | Toast: "Profile updated successfully"; timezone updated                  |               | ⏳     |
| MP_012 | Timezone dropdown supports keyboard arrow-key navigation      | Timezone dropdown is open               | 1. Open timezone dropdown  2. Use ↑ / ↓ arrow keys                         | Highlighted option moves through the list; Enter selects it              |               | ⏳     |

---

## Language

| ID     | Title                                                         | Precondition                            | Steps                                                                       | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_013 | Change language and save                                      | More than one language is available     | 1. Open language dropdown  2. Select a different language  3. Save Changes  | UI language switches immediately to the selected language                |               | ⏳     |
| MP_014 | Language preference is persisted across sessions              | Language was changed and saved          | 1. Log out  2. Log back in                                                  | App loads in the previously selected language                            |               | ⏳     |

---

## Profile Picture

| ID     | Title                                                         | Precondition                            | Steps                                                                       | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------------|-----------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| MP_015 | Click avatar opens cropping tool                              | Logged in as any user                   | 1. Click on the profile picture / avatar area                                | File picker opens; after selecting an image, cropping tool is shown      |               | ⏳     |
| MP_016 | Cropped image saved as profile picture                        | Cropping tool is open with an image     | 1. Adjust crop  2. Confirm crop  3. Click "Save Changes"                    | Toast: "Profile updated successfully"; cropped image shown as avatar     |               | ⏳     |
| MP_017 | Old profile picture is removed when a new one is uploaded     | User has an existing profile picture    | 1. Upload a new profile picture  2. Save                                    | Old picture replaced by new one; old file removed from storage           |               | ⏳     |

---

**Total:** 17 test cases · **All status:** ⏳ Pending
