# Company Settings — Test Cases

**Location:** Settings → (Company) Settings · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Company Info

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_001 | Update company name                               | Logged in as Admin                  | 1. Open Settings  2. Edit "Company/Individual Name"  3. Click "Save Changes"                  | New name saved and reflected in the sidebar/header                 |               | ⏳     |
| CS_002 | Update company phone number                       | Logged in as Admin                  | 1. Open Settings  2. Select country code  3. Enter phone number  4. Click "Save Changes"      | Phone number saved successfully                                    |               | ⏳     |
| CS_003 | Update country                                    | Logged in as Admin                  | 1. Open Settings  2. Edit "Country" field  3. Click "Save Changes"                            | Country updated and saved                                          |               | ⏳     |
| CS_004 | Update state                                      | Logged in as Admin                  | 1. Open Settings  2. Edit "State" field  3. Click "Save Changes"                              | State updated and saved                                            |               | ⏳     |
| CS_005 | Update city                                       | Logged in as Admin                  | 1. Open Settings  2. Edit "City" field  3. Click "Save Changes"                               | City updated and saved                                             |               | ⏳     |
| CS_006 | Change date format                                | Logged in as Admin                  | 1. Open Settings  2. Click "Select Date Format"  3. Choose a different format  4. Save Changes | Date format updated; reflected across the app (tasks, timesheets)  |               | ⏳     |
| CS_007 | Upload company logo                               | Logged in as Admin                  | 1. Open Settings  2. Click the company avatar  3. Upload an image  4. Save Changes            | New logo appears in the sidebar and settings page                  |               | ⏳     |
| CS_008 | Cannot save company name as empty                 | Logged in as Admin                  | 1. Open Settings  2. Clear the company name field  3. Click "Save Changes"                    | Validation error shown; settings not saved                         |               | ⏳     |

---

## Task Priority

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_009 | Add a new task priority with name only            | Logged in as Admin                  | 1. Enter priority name  2. Click "Save"                                                       | New priority appears in the priority list below                    |               | ⏳     |
| CS_010 | Add a new task priority with name and icon        | Logged in as Admin                  | 1. Enter priority name  2. Upload an icon (≤ 250×250px)  3. Click "Save"                     | Priority saved with the custom icon visible in the list            |               | ⏳     |
| CS_011 | Cannot save priority without a name               | Logged in as Admin                  | 1. Leave priority name empty  2. Click "Save"                                                 | Validation error shown; priority not created                       |               | ⏳     |
| CS_012 | Icon upload rejects oversized image               | Logged in as Admin                  | 1. Try to upload an image larger than 250×250px                                               | Error shown stating max image size is 250×250px                    |               | ⏳     |
| CS_013 | Cancel clears the priority form                   | Logged in as Admin                  | 1. Enter a priority name  2. Click "Cancel"                                                   | Name field cleared; no priority created                            |               | ⏳     |
| CS_014 | Existing priorities displayed in the list         | At least one custom priority exists | 1. Open Settings                                                                              | All existing priorities (High, Medium, Low, Highest, custom) shown |               | ⏳     |
| CS_015 | New priority is available on tasks immediately    | A new priority was just added       | 1. Open any task  2. Click the priority field                                                 | Newly added priority appears as an option                          |               | ⏳     |

---

## Milestone Weekly Range

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_016 | Current milestone weekly range is displayed       | Logged in as Admin                  | 1. Open Settings  2. Scroll to "Milestone Weekly Range"                                       | Current range shown (e.g. Mon – Sun)                               |               | ⏳     |
| CS_017 | Change the milestone weekly range                 | Logged in as Admin                  | 1. Click the weekly range  2. Select a different start/end day  3. Save                       | New range saved and reflected in milestone calendar views          |               | ⏳     |

---

## File Extensions

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_018 | Allowed file extensions are listed               | Logged in as Admin                  | 1. Open Settings  2. Scroll to "File Extensions"                                              | Currently allowed file extensions are displayed                    |               | ⏳     |
| CS_019 | Add a new allowed file extension                 | Logged in as Admin                  | 1. Open File Extensions  2. Enter an extension (e.g. ".svg")  3. Save                        | Extension added to the allowed list                                |               | ⏳     |
| CS_020 | Remove an allowed file extension                 | At least one custom extension exists | 1. Open File Extensions  2. Click remove on an extension  3. Confirm                         | Extension removed; files of that type blocked on upload            |               | ⏳     |

---

## Project Milestone Status

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_021 | Existing milestone statuses are listed            | Logged in as Admin                  | 1. Open Settings  2. Scroll to "Project Milestone Status"                                     | All existing statuses shown (e.g. Not Funded, Funded, Released)    |               | ⏳     |
| CS_022 | Add a new milestone status with name only         | Logged in as Admin                  | 1. Enter a status name  2. Click "Save"                                                       | New status appears in the milestone status list                    |               | ⏳     |
| CS_023 | Add milestone status with "Past" calendar display | Logged in as Admin                  | 1. Enter a status name  2. Tick "Past"  3. Click "Save"                                      | Status saved; calendar shows it for past dates                     |               | ⏳     |
| CS_024 | Add milestone status with "Future" calendar display | Logged in as Admin                | 1. Enter a status name  2. Tick "Future"  3. Click "Save"                                    | Status saved; calendar shows it for future dates                   |               | ⏳     |
| CS_025 | Add milestone status with both Past and Future    | Logged in as Admin                  | 1. Enter a status name  2. Tick both "Past" and "Future"  3. Click "Save"                    | Status saved; shown for both past and future dates in calendar     |               | ⏳     |
| CS_026 | Cannot save milestone status without a name       | Logged in as Admin                  | 1. Leave status name empty  2. Click "Save"                                                   | Validation error shown; status not created                         |               | ⏳     |
| CS_027 | Cancel clears the milestone status form           | Logged in as Admin                  | 1. Enter a status name  2. Click "Cancel"                                                     | Name field cleared; no status created                              |               | ⏳     |
| CS_028 | Edit an existing milestone status                 | At least one milestone status exists | 1. Click ··· on a status  2. Edit name or calendar setting  3. Save                          | Updated status reflected in the list                               |               | ⏳     |
| CS_029 | Delete an existing milestone status               | At least one milestone status exists | 1. Click ··· on a status  2. Click Delete  3. Confirm                                        | Status removed from the list                                       |               | ⏳     |
| CS_030 | New milestone status available in project milestones | A new status was just added       | 1. Open any project → Project Details  2. Change a milestone status                          | Newly created status appears as an option                          |               | ⏳     |

---

## Currencies

| ID    | Title                                              | Precondition                        | Steps                                                                                         | Expected Result                                                    | Actual Result | Status |
|-------|----------------------------------------------------|-------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| CS_031 | Enabled currencies are displayed                  | Logged in as Admin                  | 1. Open Settings  2. Scroll to "Currencies"                                                   | All currently enabled currencies shown as chips                    |               | ⏳     |
| CS_032 | Add a new currency                                | Logged in as Admin                  | 1. Click "Add/Remove Currencies"  2. Enable a currency  3. Save                               | New currency chip appears in the currencies list                   |               | ⏳     |
| CS_033 | Remove an existing currency                       | At least 2 currencies enabled       | 1. Click "Add/Remove Currencies"  2. Disable a currency  3. Save                              | Currency chip removed from the list                                |               | ⏳     |

---

**Total:** 33 test cases · **All status:** ⏳ Pending
