# Settings — Projects — Test Cases

**Location:** Settings → Projects · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Project Listing

| ID      | Title                                                       | Precondition                                              | Steps                                                               | Expected Result                                                             | Actual Result | Status |
|---------|-------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| SP_001  | All active projects listed under "All Projects" tab         | Logged in as Admin, company has active projects           | 1. Open Settings → Projects                                         | All non-deleted, non-closed projects shown with name and code               |               | ⏳     |
| SP_002  | Closed projects shown under "Closed Projects" tab           | At least one closed project exists                        | 1. Open Settings → Projects  2. Click "Closed Projects" tab         | Only closed projects listed; active projects not shown                      |               | ⏳     |
| SP_003  | Tab shows project count in brackets                         | Company has multiple projects                             | 1. Open Settings → Projects  2. Observe both tab labels             | Each tab label shows the current count, e.g. "All Projects (12)"            |               | ⏳     |
| SP_004  | Projects sorted by creation date (newest first)             | Company has 5+ projects created on different dates        | 1. Open Settings → Projects                                         | Most recently created project appears at the top of the list                |               | ⏳     |
| SP_005  | Empty state shown when no projects in current tab           | Company has only active projects (no closed ones)         | 1. Click "Closed Projects" tab                                      | "No data found" image and message shown                                     |               | ⏳     |

---

## Search

| ID      | Title                                                       | Precondition                                              | Steps                                                               | Expected Result                                                             | Actual Result | Status |
|---------|-------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| SP_006  | Search by project name filters the list                     | Company has 3+ projects with different names              | 1. Type a partial project name in the search field                  | Only projects whose names match the search term are shown                   |               | ⏳     |
| SP_007  | Search by project code filters the list                     | Company has 3+ projects with different codes              | 1. Type a partial project code in the search field                  | Only projects whose code matches the search term are shown                  |               | ⏳     |
| SP_008  | Search is case-insensitive                                  | A project named "Marketing" exists                        | 1. Type "marketing" in the search field                             | "Marketing" project appears in results                                      |               | ⏳     |
| SP_009  | Search resets to page 1 when filter changes                 | Currently on page 2 of the list                           | 1. Type in the search field                                         | Pagination resets to page 1                                                 |               | ⏳     |
| SP_010  | Clearing search restores the full list                      | A search filter is active                                 | 1. Clear the search field                                           | Full project list restored                                                  |               | ⏳     |

---

## Pagination

| ID      | Title                                                       | Precondition                                              | Steps                                                               | Expected Result                                                             | Actual Result | Status |
|---------|-------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| SP_011  | Default items-per-page is 5                                 | Company has 6+ projects                                   | 1. Open Settings → Projects                                         | 5 projects shown; page 2 available                                          |               | ⏳     |
| SP_012  | Items-per-page can be changed to 10, 15, or 20              | Company has 15+ projects                                  | 1. Change "Items per page" dropdown to 10                           | 10 projects shown per page; total pages recalculated                        |               | ⏳     |
| SP_013  | "Showing X to Y of Z entries" label is accurate             | Company has 12 projects, default page size 5              | 1. Open Settings → Projects  2. Observe the entries label           | Label reads "Showing 1 to 5 of 12 entries"                                  |               | ⏳     |
| SP_014  | Next button advances to the next page                       | Currently on page 1 with more pages available             | 1. Click "Next"                                                     | Page 2 content shown; label updates accordingly                             |               | ⏳     |
| SP_015  | Previous button returns to the previous page                | Currently on page 2                                       | 1. Click "Previous"                                                 | Page 1 content shown                                                        |               | ⏳     |
| SP_016  | Direct page number click navigates to that page             | 3+ pages available                                        | 1. Click page number "3" in the pagination                          | Page 3 content shown; page 3 is highlighted                                 |               | ⏳     |
| SP_017  | Changing page scrolls back to top of the list               | Currently scrolled down on a long project list            | 1. Click any page number                                            | View scrolls smoothly back to the top of the project list                   |               | ⏳     |

---

## Add New Project

| ID      | Title                                                       | Precondition                                              | Steps                                                               | Expected Result                                                             | Actual Result | Status |
|---------|-------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| SP_018  | "Add New Projects" button visible for users with permission | User has project.project_list AND project.project_create  | 1. Open Settings → Projects  2. Observe the header                  | "+ Add New Projects" button shown in the top header area                    |               | ⏳     |
| SP_019  | "Add New Projects" button opens Create Project sidebar      | User has project creation permission                      | 1. Click "+ Add New Projects"                                       | Create Project sidebar opens                                                |               | ⏳     |
| SP_020  | "Add New Projects" button hidden without create permission  | User lacks project.project_create permission              | 1. Open Settings → Projects  2. Observe the header                  | "+ Add New Projects" button is not visible                                  |               | ⏳     |

---

## Permission-based Access

| ID      | Title                                                              | Precondition                                              | Steps                                                               | Expected Result                                                             | Actual Result | Status |
|---------|---------------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| SP_021  | Access Denied shown without settings_project_list permission        | User lacks settings.settings_project_list permission      | 1. Open Settings → Projects                                         | Access Denied image shown; project list not visible                         |               | ⏳     |
| SP_022  | Access Denied shown without project_details permission              | User lacks project.project_details permission             | 1. Open Settings → Projects                                         | Access Denied image shown; project list not visible                         |               | ⏳     |

---

**Total:** 22 test cases · **All status:** ⏳ Pending
