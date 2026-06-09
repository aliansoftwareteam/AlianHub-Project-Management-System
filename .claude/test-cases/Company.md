# Company (Workspaces) — Test Cases

**Location:** Settings → Company · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Workspaces

| ID      | Title                                                        | Precondition                                 | Steps                                                        | Expected Result                                                              | Actual Result | Status |
|---------|--------------------------------------------------------------|----------------------------------------------|--------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CMP_001 | All companies/workspaces the user belongs to are shown       | User belongs to at least one company         | 1. Open Settings → Company                                   | All companies the user is a member of are listed with logo and name          |               | ⏳     |
| CMP_002 | Company logo shown if available, initial shown otherwise     | One company has a logo, another does not     | 1. Open Settings → Company  2. Observe company list entries  | Companies with a logo show the logo; others show the first letter of the name |              | ⏳     |
| CMP_003 | Company name shown under each workspace entry                | User has 2+ company memberships              | 1. Open Settings → Company                                   | Each workspace shows its company name below or beside the logo               |               | ⏳     |

---

## Create New Workspace

| ID      | Title                                                        | Precondition                                 | Steps                                                                       | Expected Result                                                              | Actual Result | Status |
|---------|--------------------------------------------------------------|----------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CMP_004 | Create new company/workspace option is available             | Logged in as any user                        | 1. Open Settings → Company  2. Observe the UI                               | A "Create Company" or "+" button/option is visible in the list               |               | ⏳     |
| CMP_005 | Clicking create new company opens the sidebar                | Logged in as any user                        | 1. Click the create company button                                           | Free plan limit is checked; create company sidebar opens if limit not reached |              | ⏳     |
| CMP_006 | Cannot create new company when free plan limit is reached    | User has reached the free company limit      | 1. Click the create company button                                           | Alert shown with the names of companies at the limit; sidebar does not open  |               | ⏳     |
| CMP_007 | New company creation process shows a progress bar            | Create company sidebar is active             | 1. Fill in company details  2. Submit                                        | Progress bar / processing model shown while the new company is being created |               | ⏳     |
| CMP_008 | Newly created company appears in the workspace list          | Company was just created                     | 1. Complete the create company flow  2. Observe the list                     | New company entry appears in the workspace list                              |               | ⏳     |

---

## Wasabi / HTTP Image Display

| ID      | Title                                                        | Precondition                                 | Steps                                                                       | Expected Result                                                              | Actual Result | Status |
|---------|--------------------------------------------------------------|----------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| CMP_009 | HTTP-based company logo displayed directly via img tag       | A company's logo URL starts with "http"      | 1. Open Settings → Company                                                  | Logo loaded directly via the URL without going through Wasabi component      |               | ⏳     |
| CMP_010 | Wasabi-stored company logo displayed via WasabiImage comp    | A company's logo is stored in Wasabi/local   | 1. Open Settings → Company                                                  | Logo loaded correctly via the WasabiImage component                          |               | ⏳     |

---

**Total:** 10 test cases · **All status:** ⏳ Pending
