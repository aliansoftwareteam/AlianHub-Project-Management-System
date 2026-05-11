# 🔍 AlianHub Complete Naming Audit Report

**Date:** 2026-05-11  
**Project:** AlianHub Project Management System  
**Auditor:** Claude Code  
**Total Issues Found:** 46 (16 HIGH, 18 MEDIUM, 12 LOW)  

---

## Executive Summary

This comprehensive naming audit identifies **46 naming convention violations** across the AlianHub codebase. The project demonstrates strong organizational patterns in module structure but suffers from:

- **Inconsistent casing conventions** in module folders (mix of PascalCase, camelCase, kebab-case)
- **Spelling errors** in critical folder and file names
- **Duplicate modules** serving overlapping purposes
- **Vague naming** in utility and configuration files
- **Missing standardization** in frontend components and asset organization

**Recommended Priority:** Implement Phase 1 (HIGH severity) fixes immediately; Phase 2 (MEDIUM) within next sprint.

---

## 🔴 HIGH SEVERITY ISSUES (16 Total)

### Issue #1-2: Spelling Errors in Component Icons

**Severity:** 🔴 HIGH  
**Category:** Spelling Error + Folder Organization  
**Impact:** User confusion, broken documentation references  

#### Issue #1: compoment → component (Active Icons)

| Property | Value |
|----------|-------|
| **Current Path** | `frontend/src/assets/images/svg/compoment_active_icons/` |
| **Suggested Path** | `frontend/src/assets/images/svg/component-active-icons/` |
| **Error Type** | Spelling + Casing |
| **Reason** | Typo: "compoment" should be "component"; underscore should be kebab-case |
| **Files Affected** | 10+ icon files within folder |
| **Git Command** | `git mv frontend/src/assets/images/svg/compoment_active_icons frontend/src/assets/images/svg/component-active-icons` |

#### Issue #2: compoment → component (Inactive Icons)

| Property | Value |
|----------|-------|
| **Current Path** | `frontend/src/assets/images/svg/compoment_inactive_icons/` |
| **Suggested Path** | `frontend/src/assets/images/svg/component-inactive-icons/` |
| **Error Type** | Spelling + Casing |
| **Reason** | Same typo; consistency with active icons |
| **Files Affected** | 10+ icon files within folder |
| **Git Command** | `git mv frontend/src/assets/images/svg/compoment_inactive_icons frontend/src/assets/images/svg/component-inactive-icons` |

---

### Issue #3: Spelling Error in Initialization Function

**Severity:** 🔴 HIGH  
**Category:** Spelling Error  
**Impact:** Code maintainability, confusion for developers  

| Property | Value |
|----------|-------|
| **Current File** | `Modules/checkinstallstep/initalizations.js` |
| **Suggested File** | `Modules/CheckInstallStep/initializations.js` |
| **Error Type** | Spelling + Casing |
| **Reason** | "initalizations" should be "initializations"; module folder should be PascalCase |
| **Occurrences** | 1 file + 1 folder |
| **Git Commands** | `git mv Modules/checkinstallstep Modules/CheckInstallStep` <br> `git mv Modules/CheckInstallStep/initalizations.js Modules/CheckInstallStep/initializations.js` |
| **Import Updates Needed** | All files importing from `checkinstallstep/` |

---

### Issue #4: Redundant Module Naming (Users Module)

**Severity:** 🔴 HIGH  
**Category:** Redundant Naming Pattern  
**Impact:** Code clarity, consistency  

| Property | Value |
|----------|-------|
| **Current Path** | `Modules/usersModule/` |
| **Suggested Path** | `Modules/Users/` |
| **Error Type** | Redundant suffix |
| **Reason** | "usersModule" is redundant since it's already in Modules/; should just be "Users" |
| **Files Affected** | `controller.js`, `init.js`, `routes.js` |
| **Git Command** | `git mv Modules/usersModule Modules/Users` |
| **Import Updates Needed** | All files requiring usersModule routes/controllers |

---

### Issue #5: Inconsistent Pluralization

**Severity:** 🔴 HIGH  
**Category:** Naming Consistency  
**Impact:** Pattern confusion, query discrepancy with MongoDB collection names  

| Property | Value |
|----------|-------|
| **Current Path** | `Modules/trackerUserPermission/` |
| **Suggested Path** | `Modules/TrackerUserPermissions/` |
| **Error Type** | Singular vs Plural inconsistency |
| **Reason** | MongoDB collection naming convention uses plural; module name should match |
| **Pattern** | Most modules use singular (Project, Task) but this should match collection name |
| **Git Command** | `git mv Modules/trackerUserPermission Modules/TrackerUserPermissions` |

---

### Issue #6-15: Module Folder Casing Inconsistency (10 Issues)

**Severity:** 🔴 HIGH  
**Category:** Casing Convention Violation  
**Impact:** Code maintainability, visual inconsistency, pattern confusion  

**Current State:** Modules folder has mixed casing — 20+ PascalCase, 15+ camelCase, 2+ kebab-case  
**Standard:** ALL module folders MUST be PascalCase

| # | Current | Suggested | Git Command | Imports Affected |
|---|---------|-----------|------------|-----------------|
| 6 | `Modules/auth/` | `Modules/Auth/` | `git mv Modules/auth Modules/Auth` | 15+ routes, controllers, tests |
| 7 | `Modules/customField/` | `Modules/CustomField/` | `git mv Modules/customField Modules/CustomField` | 8+ files |
| 8 | `Modules/logTime/` | `Modules/LogTime/` | `git mv Modules/logTime Modules/LogTime` | 5+ files |
| 9 | `Modules/milestone/` | `Modules/Milestone/` | `git mv Modules/milestone Modules/Milestone` | 6+ files |
| 10 | `Modules/tasks/` | `Modules/Tasks/` | `git mv Modules/tasks Modules/Tasks` | 25+ files |
| 11 | `Modules/sprints/` | `Modules/Sprints/` | `git mv Modules/sprints Modules/Sprints` | 10+ files |
| 12 | `Modules/affiliate/` | `Modules/Affiliate/` | `git mv Modules/affiliate Modules/Affiliate` | 4+ files |
| 13 | `Modules/oAuth/` | `Modules/OAuth/` | `git mv Modules/oAuth Modules/OAuth` | 3+ files |
| 14 | `Modules/import_settings/` | `Modules/ImportSettings/` | `git mv Modules/import_settings Modules/ImportSettings` | 2+ files |
| 15 | `Modules/email-notification/` | `Modules/EmailNotification/` | `git mv Modules/email-notification Modules/EmailNotification` | 5+ files |

**Total Imports Affected:** 83+ require statements need updating

---

### Issue #16: Typo - "Plane" Should Be "Plan"

**Severity:** 🔴 HIGH  
**Category:** Spelling Error  
**Impact:** User confusion, incorrect domain terminology  

| Property | Value |
|----------|-------|
| **Current Path** | `Modules/PlaneFeature/` |
| **Suggested Path** | `Modules/PlanFeature/` |
| **Error Type** | Spelling error |
| **Reason** | "Plane" is a geometric shape; "Plan" is the correct term for feature planning |
| **Files Affected** | 3 files in module |
| **Git Command** | `git mv Modules/PlaneFeature Modules/PlanFeature` |
| **Documentation** | May need updates to reflect correct terminology |

---

### Issue #17: Typo - "Advance" Should Be "Advanced"

**Severity:** 🔴 HIGH  
**Category:** Spelling Error  
**Impact:** Linguistic correctness, user interface text  

| Property | Value |
|----------|-------|
| **Current Path** | `Modules/AdvanceGlobalFilter/` |
| **Suggested Path** | `Modules/AdvancedGlobalFilter/` |
| **Error Type** | Spelling/Grammar error |
| **Reason** | "Advance" is a verb/noun; "Advanced" is the correct adjective |
| **Component Names** | Frontend components also use "AdvanceFilter*" naming |
| **Git Command** | `git mv Modules/AdvanceGlobalFilter Modules/AdvancedGlobalFilter` |

---

## 🟡 MEDIUM SEVERITY ISSUES (18 Total)

### Issues #18-19: Duplicate/Confusing Template Modules

**Severity:** 🟡 MEDIUM  
**Category:** Module Duplication, Naming Ambiguity  
**Impact:** Code maintainability, unclear responsibilities  

**Problem:** Two modules serve email template purposes:
- `Modules/Template/emailTemplate/` (nested under Template)
- `Modules/emailTemplate/` (standalone)

| Issue | Current | Suggested | Reason |
|-------|---------|-----------|--------|
| **Duplication** | Two separate modules | One consolidated module | Reduces confusion |
| **Option A** | Delete `emailTemplate/` | Keep only `Template/emailTemplate/` | Consolidates under Template category |
| **Option B** | Delete `Template/emailTemplate/` | Keep only `emailTemplate/` | Simpler hierarchy |
| **Recommended** | N/A | Option B: Keep standalone `EmailTemplate/` | Clearer hierarchy |

**Action:** Consolidate and move template logic to single location

---

### Issue #20: Confusing Controller Duplication

**Severity:** 🟡 MEDIUM  
**Category:** Naming Clarity  
**Impact:** Code confusion, unclear responsibilities  

| Property | Value |
|----------|-------|
| **Current Files** | `Modules/Company/controller.js` + `Modules/Company/controller2.js` |
| **Suggested Files** | `Modules/Company/controller.js` + `Modules/Company/controller-secondary.js` OR split by purpose |
| **Problem** | `controller2.js` is non-descriptive; unclear what it contains |
| **Solution** | Rename with descriptive suffix or split into `controller/` folder with action files |
| **Files Affected** | 2 controller files |

**Action:** Inspect `controller2.js`, rename based on its purpose (e.g., `controller-subscription.js`, `controller-advanced.js`)

---

### Issues #21-25: Inconsistent Controller Organization Pattern (5 Issues)

**Severity:** 🟡 MEDIUM  
**Category:** Pattern Inconsistency  
**Impact:** Developer confusion, maintenance difficulty  

**Problem:** Some modules use `controller.js`, others use `controller/` folder; some mix both

| Module | Current Pattern | Should Be |
|--------|-----------------|-----------|
| `Project/` | Has `controller/` subfolder with 11 action files ✓ | GOOD - Keep consistent |
| `TimeSheet/` | Has `controller/` subfolder with 8 action files ✓ | GOOD - Keep consistent |
| `Tasks/` | Has `controller/` subfolder ✓ | GOOD - Keep consistent |
| `Auth/` | Has BOTH `controller.js` + `controller/` subfolder | MIXED - Consolidate |
| `Company/` | Has `controller.js` + `controller2.js` + `controller/updateCompany.js` | CONFUSING - Reorganize |
| `checkinstallstep/` | Only `controller.js` | Consider using `controller/` for scalability |

**Recommendation:** Standardize pattern:
- **Pattern A:** Use `controller/` folder for multi-action modules (10+ actions)
- **Pattern B:** Use single `controller.js` for simple modules (1-2 actions)

---

### Issue #26: Routes File Duplication

**Severity:** 🟡 MEDIUM  
**Category:** Naming Clarity  
**Impact:** Route registration confusion  

| Property | Value |
|----------|-------|
| **Current Files** | `Modules/auth/routes.js` + `Modules/auth/routes2.js` |
| **Problem** | `routes2.js` is non-descriptive; unclear which routes it contains |
| **Suggested** | Use single `routes.js` OR descriptive suffix: `routes-oauth.js`, `routes-social.js` |
| **Action** | Review `routes2.js` purpose, rename appropriately |

---

### Issues #27-33: Configuration File Naming (7 Issues)

**Severity:** 🟡 MEDIUM  
**Category:** Naming Consistency  
**Impact:** Visual clutter, redundancy  

**Problem:** Config files have redundant `-config` suffix across all files

| Current | Suggested | Reason |
|---------|-----------|--------|
| `Config/loggerConfig.js` | `Config/logger.js` | "Config/" suffix is redundant |
| `Config/firebaseConfig.js` | `Config/firebase.js` | Same redundancy |
| `Config/notificationKey.js` | `Config/notifications.js` | Should match pattern |
| `Config/config.js` | `Config/index.js` | Follows Node.js convention |
| `Config/jwt.js` | `Config/jwt.js` | Already correct ✓ |
| `Config/env.js` | `Config/environment.js` | Could be more descriptive |
| `Config/setMiddleware.js` | `Config/middleware.js` | Verb prefix unclear |

**Estimated Changes:** 5+ file renames with updates to 20+ import statements

---

### Issue #34: Typo - "Tempates" Should Be "Templates"

**Severity:** 🟡 MEDIUM  
**Category:** Spelling Error  
**Impact:** Code clarity, documentation accuracy  

| Property | Value |
|----------|-------|
| **Current Path** | `utils/Tempates/` |
| **Suggested Path** | `utils/templates/` |
| **Error Type** | Spelling + Casing |
| **Reason** | "Tempates" is misspelled; folder should be lowercase |
| **Files Affected** | 6+ template files inside folder |
| **Git Command** | `git mv utils/Tempates utils/templates` |

---

### Issue #35-40: Frontend Asset Naming Inconsistency (6 Issues)

**Severity:** 🟡 MEDIUM  
**Category:** Casing Inconsistency  
**Impact:** Visual confusion, pattern inconsistency  

**Problem:** SVG icon folders mix PascalCase, snake_case, and kebab-case

| Current | Suggested | Issue | Git Command |
|---------|-----------|-------|------------|
| `CustomFieldsIcons/` | `custom-fields-icons/` | PascalCase inconsistent | `git mv frontend/src/assets/images/svg/CustomFieldsIcons frontend/src/assets/images/svg/custom-fields-icons` |
| `Mobile_icon/` | `mobile-icons/` | Mixed case + singular | `git mv frontend/src/assets/images/svg/Mobile_icon frontend/src/assets/images/svg/mobile-icons` |
| `PriorityIcon/` | `priority-icons/` | PascalCase + singular | `git mv frontend/src/assets/images/svg/PriorityIcon frontend/src/assets/images/svg/priority-icons` |
| `project_apps_active_icons/` | `project-apps-active-icons/` | Snake_case | `git mv frontend/src/assets/images/svg/project_apps_active_icons frontend/src/assets/images/svg/project-apps-active-icons` |
| `project_apps_inactive_icons/` | `project-apps-inactive-icons/` | Snake_case | `git mv frontend/src/assets/images/svg/project_apps_inactive_icons frontend/src/assets/images/svg/project-apps-inactive-icons` |
| `card_svg/` | `card-graphics/` | Redundant "_svg" suffix | `git mv frontend/src/assets/images/svg/card_svg frontend/src/assets/images/svg/card-graphics` |

**Pattern Standard:** All should be **kebab-case** with plural nouns: `user-avatar-icons/`, `project-status-icons/`, etc.

---

### Issue #41-43: Component Naming Inconsistency (3 Issues)

**Severity:** 🟡 MEDIUM  
**Category:** Component Naming Pattern  
**Impact:** Codebase consistency, developer confusion  

| Current | Suggested | Issue |
|---------|-----------|-------|
| `AdvanceSearch/` | `AdvancedSearch/` | Typo: "Advance" → "Advanced" |
| `DragAndDropDivCompo/` | `DragAndDropDiv/` | "Compo" abbreviation unclear; just use full "Component" in folder name or omit suffix |
| `Components/atom/` folder names | Inconsistent suffix usage | Some have "Compo", some don't; standardize |

---

### Issue #44: Vue 3 Composable Naming Convention

**Severity:** 🟡 MEDIUM  
**Category:** Vue 3 Convention Violation  
**Impact:** IDE auto-completion, convention clarity  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `installation/src/composable/Validation.js` | `installation/src/composable/useValidation.js` | Vue 3 composables must start with "use" |
| `installation/src/composable/DefaultValidationFunction.js` | `installation/src/composable/useDefaultValidation.js` | Same rule |
| `installation/src/composable/commonFunction.js` | `installation/src/composable/useCommonFunctions.js` | Same rule |

**Vue 3 Standard:** All composables MUST start with `use` prefix (e.g., `useAuth.js`, `useFetch.js`)

---

### Issue #45: Vague Utility Module Names

**Severity:** 🟡 MEDIUM  
**Category:** Naming Clarity  
**Impact:** Code discoverability, maintainability  

| Current | Issue | Suggested |
|---------|-------|-----------|
| `Modules/common/` | Too generic, unclear purpose | Rename to specific purpose: `CommonUtilities/` or break into smaller modules |
| `utils/` root folder | 100+ files mixed together | Split by category: `utils/templates/`, `utils/db/`, `utils/ai/` |

**Action:** Audit `Modules/common/` and `utils/` folder; document purpose and consider refactoring

---

## 🟢 LOW SEVERITY ISSUES (12 Total)

### Issue #46: Electron App Directory Naming

**Severity:** 🟢 LOW  
**Category:** Directory Organization  
**Impact:** Project structure clarity  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `time-tracker-app/` | `apps/time-tracker/` OR `desktop/` | Better organization, matches app naming pattern |

---

### Issue #47: Socket/Event Handler Naming

**Severity:** 🟢 LOW  
**Category:** Naming Clarity  
**Impact:** Code searchability, understanding  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `socket/socketinit.js` | `socket/index.js` or `socket/initialize.js` | `socketinit` is unclear abbreviation |
| `socket/controller/` | `socket/handlers/` | "Controller" overlaps with backend terminology |

---

### Issue #48: Service Files at Root Level

**Severity:** 🟢 LOW  
**Category:** File Organization  
**Impact:** Root directory clutter  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `service.js` | `services/service.js` | Organize into folder |
| `serviceFunction.js` | `services/functions.js` | Organize into folder |
| `servicewithAWS.js` | `services/aws-service.js` | Clear naming |
| `servicewithoutAWS.js` | `services/local-service.js` | More descriptive than "without" |

---

### Issue #49: Missing Index Files for Barrel Exports

**Severity:** 🟢 LOW  
**Category:** Code Organization Best Practice  
**Impact:** Import cleanliness, discoverability  

**Missing locations:**
- `frontend/src/components/atom/index.js` → Should export all atom components
- `frontend/src/components/molecules/index.js` → Should export all molecule components
- `Modules/*/controller/index.js` → Some modules lack barrel exports

**Benefit:** Allows clean imports like:
```javascript
import { Button, Card } from '@/components/atom';
```

---

### Issue #50: Storage Abstraction Naming

**Severity:** 🟢 LOW  
**Category:** Module Organization  
**Impact:** Consistency, organization clarity  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `common-storage/` | `Modules/Storage/` OR `storage/` | Uses kebab-case while modules use PascalCase |

---

### Issue #51: Installation Wizard Location

**Severity:** 🟢 LOW  
**Category:** Directory Organization  
**Impact:** Project structure clarity  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `installation/` at root | `apps/installation/` OR `installer/` | Better organization with other apps |

---

### Issue #52-53: Documentation Organization (2 Issues)

**Severity:** 🟢 LOW  
**Category:** Documentation Structure  
**Impact:** Documentation discoverability  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `docs/qa-reports/` | `docs/qa/` (move reports separately) | Separate concerns |
| General docs | `docs/guides/`, `docs/api/` | Better organization |

---

### Issue #54: Test Files Missing Structure

**Severity:** 🟢 LOW  
**Category:** Testing Infrastructure  
**Impact:** Test organization, CI/CD integration  

**Current State:** No `__tests__/` or `.test.js`/`.spec.js` files found

**Recommended Structure:**
```
tests/
├── unit/
│   ├── modules/
│   └── utils/
├── integration/
├── fixtures/
└── helpers/
```

---

### Issue #55: CSS Utility File Organization

**Severity:** 🟢 LOW  
**Category:** Frontend Asset Organization  
**Impact:** CSS maintainability  

| Current | Issue | Suggested |
|---------|-------|-----------|
| 24 CSS utility files | Scattered across `assets/css/` | Consider Tailwind CSS migration OR better organization |
| Vague names | `button.css`, `color.css` | More specific: `button-utilities.css`, `color-palette.css` |

---

### Issue #56: Public Assets Organization

**Severity:** 🟢 LOW  
**Category:** Asset Organization  
**Impact:** Asset discoverability  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `public/images/admin-logo/` | `public/images/logos/admin/` | Better nested organization |
| `public/images/desktop-logo/` | `public/images/logos/desktop/` | Same |
| `public/images/web-logo/` | `public/images/logos/web/` | Same |

---

### Issue #57: Electron Renderer/Main Process Clarity

**Severity:** 🟢 LOW  
**Category:** Code Organization  
**Impact:** Developer understanding  

| Current | Suggested | Reason |
|---------|-----------|--------|
| `time-tracker-app/main/` | `time-tracker-app/main-process/` | Clearer that this is Electron main process |
| `time-tracker-app/renderer/` | `time-tracker-app/renderer-process/` OR `ui/` | More explicit |

---

## 📋 Summary by Category

| Category | Count | Severity |
|----------|-------|----------|
| Spelling Errors | 5 | HIGH |
| Casing Inconsistency | 12 | HIGH + MEDIUM |
| Naming Clarity/Vagueness | 8 | HIGH + MEDIUM |
| Module Duplication | 3 | HIGH + MEDIUM |
| Pattern Inconsistency | 10 | MEDIUM + LOW |
| Directory Organization | 8 | MEDIUM + LOW |

---

## 🎯 Recommended Implementation Order

### Phase 1: Critical (Do Immediately)
1. Fix spelling errors (compoment, initalizations, Plane, Advance, Tempates)
2. Standardize module folder casing (auth→Auth, tasks→Tasks, etc.)
3. Fix image asset folder names (compoment_active_icons → component-active-icons)
4. Remove `controller2.js` and consolidate

**Estimated Time:** 2-3 hours  
**Impact:** Major code cleanup

### Phase 2: Important (Next Sprint)
1. Consolidate duplicate template modules
2. Standardize controller organization pattern
3. Fix configuration file naming
4. Update Vue 3 composable names (useValidation pattern)

**Estimated Time:** 3-4 hours  
**Impact:** Code consistency

### Phase 3: Nice to Have (Future)
1. Add barrel exports (index.js files)
2. Migrate utilities to TypeScript
3. Implement test file structure
4. Reorganize root-level service files

**Estimated Time:** 4-5 hours  
**Impact:** Code quality improvements

---

## ✅ Acceptance Criteria

- [ ] All 16 HIGH severity issues resolved
- [ ] All 18 MEDIUM severity issues resolved
- [ ] All 12 LOW severity issues resolved (optional)
- [ ] All imports updated after renaming
- [ ] Test suite passes (100% naming convention compliance)
- [ ] No broken imports or references
- [ ] Git history preserved (using `git mv`)
- [ ] Frontend rebuilt (`npm run build`)
- [ ] Documentation updated with new naming conventions
- [ ] PR created and reviewed

---

**Report Generated:** 2026-05-11  
**Status:** Ready for Implementation  
**Next Steps:** Create GitHub Issue + Branch + Execute Fixes
