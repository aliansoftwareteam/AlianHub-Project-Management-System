# Repository Structure Audit Report

**Project:** AlianHub Project Management System  
**Branch Audited:** `main` (read-only)  
**Audit Date:** 2026-05-06  
**Audited By:** QA + Claude AI

---

## Overall Score: ⚠️ 60/100

| Category | Status | Score |
|----------|--------|-------|
| Top-Level Structure | ✅ Pass | 90/100 |
| Module Pattern Compliance | ⚠️ Warning | 58/100 |
| Naming Conventions | ⚠️ Warning | 60/100 |
| Config & Environment | ❌ Fail | 40/100 |
| Orphaned / Runtime Folders | ⚠️ Warning | 75/100 |
| API Route Versioning | ❌ Fail | 35/100 |

---

## Phase 1 — Top-Level Structure ✅

Most root-level files are appropriate. Minor issues:

| Item | Status | Note |
|------|--------|------|
| `index.js`, `server.js`, `package.json` | ✅ | Core files in place |
| `Config/`, `Modules/`, `utils/`, `socket/` | ✅ | Correct placement |
| `Dockerfile`, `docker-compose.yml` | ✅ | Present |
| `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | ✅ | Present |
| `wasabiUploads/`, `wasabiUploadsLocal/` | ⚠️ | Runtime-generated — should be in `.gitignore` |
| `thumbnails/` | ⚠️ | Runtime-generated — should be in `.gitignore` |
| `log/` | ⚠️ | Runtime-generated — should be in `.gitignore` |
| `brandSettings.json`, `thumbnail.json` | ⚠️ | Should be in `Config/` not root |
| `time-tracker-app/` | ⚠️ | Separate Electron app — should have its own repo or be clearly documented |

---

## Phase 2 — Module Structure ⚠️

**Expected pattern per module:**
```
ModuleName/
├── init.js         ← route registration
├── routes.js       ← route definitions  
├── controller.js   ← business logic
└── model.js        ← DB schema (if needed)
```

**Total modules:** 54 | **Compliant:** ~42 (78%) | **Deviations:** 12

### Modules with Deviations

| Module | Issue | Severity |
|--------|-------|----------|
| `Apps` | Uses `controllers.js` (plural) | ⚠️ Low |
| `trackerDownload` | Uses `controllers.js` (plural) | ⚠️ Low |
| `logTime` | Uses `controllerV2.js` instead of `controller.js` | ⚠️ Low |
| `Company` | Has `controller.js` + `controller/` subfolder + `controller2.js` | ⚠️ Medium |
| `Project` | Has `controller/` subfolder instead of `controller.js` | ⚠️ Medium |
| `TimeSheet` | Has `controller/` subfolder instead of `controller.js` | ⚠️ Medium |
| `tasks` | Has `controller/` subfolder + `helpers/` subfolder | ⚠️ Medium |
| `auth` | Has `routes.js` + `routes2.js` + `controller/` subfolder | ⚠️ Medium |
| `notification` | Complex nested structure (5 sub-modules) | ⚠️ By design |
| `notification1` | Appears to be duplicate/orphaned module | ❌ High |
| `Template` | Email templates only — no init/routes (correct, but no README) | ⚠️ Low |
| `settings` | 15 sub-setting modules — no top-level init/routes (correct by design) | ✅ Acceptable |

### `notification1` — Possible Orphan
`Modules/notification1/` appears to be a legacy or duplicate of the main `notification` module. Needs investigation — if unused, should be removed.

---

## Phase 3 — Naming Conventions ⚠️

**No consistent folder naming convention across the project.**

| Convention | Count | Examples |
|------------|-------|---------|
| PascalCase | 24 | `AI`, `Company`, `Invoice`, `MainChats`, `Teams` |
| camelCase | 17 | `auth`, `createProject`, `logTime`, `usersModule` |
| kebab-case | 5 | `email-notification`, `notification-count` |
| lowercase | 5 | `common`, `settings`, `storage`, `sprints` |
| mixed | 3 | `AdvanceGlobalFilter`, `checkinstallstep`, `swaggerAPI` |

### File Naming Issues

| Issue | Files Affected |
|-------|---------------|
| Plural `controllers.js` instead of `controller.js` | `Apps/`, `trackerDownload/` |
| Version suffix `controllerV2.js` instead of `controller.js` | `logTime/`, `notification/` sub-modules |
| Two route files `routes.js` + `routes2.js` | `auth/` |
| Two controller versions `controller.js` + `controller2.js` | `Company/` |

---

## Phase 4 — Config & Environment ❌

### `.env.example` vs `config.js` Mismatch

`.env.example` has **15 keys**. `config.js` exports **31 keys**. **22 keys are undocumented.**

#### Keys in `config.js` but MISSING from `.env.example`
```
MONGODB_URL              ← Critical — not documented!
NODEMAILER_HOST
NODEMAILER_PORT
NODEMAILER_EMAIL
NODEMAILER_EMAIL_PASSWORD
FIREBASE_APIKEY
FIREBASE_AUTODOMAIN
FIREBASE_PROJECTID
FIREBASE_STORAGEBUCKET
FIREBASE_MESSAGINGSENDERID
FIREBASE_APPID
FIREBASE_MEASUREMENTID
AWS_SES_KEY
AWS_SES_SECRET
AWS_SES_REGION
AWS_SES_FROM_DEFAULT
ENDPOINT_KEY
ERRORRECIVEREMAIL
AI_API_KEY
AI_MODEL
STORAGE_TYPE
UNDER_MAINTENANCE
USERPROFILEBUCKET
RESEND_API_KEY
RESEND_FROM_EMAIL
WASABI_ACCESS_KEY
WASABI_SECRET_ACCESS_KEY
WASABI_USERID
```

#### Keys in `.env.example` but NOT in `config.js`
```
MONGO_CLOUD_URL     ← Stale / unused
JWT_EXP             ← Used in jwt.js but not exported via config.js
JWT_ALGORITHM       ← Same as above
```

### Other Config Issues

| Issue | File | Severity |
|-------|------|----------|
| `MONGODB_URL` not in `.env.example` | `.env.example` | ❌ Critical |
| `JWT_SECRET` in `.env.example` but loaded via `process.env` directly in `jwt.js`, not via `config.js` | `Config/jwt.js` | ⚠️ Medium |
| `MONGO_CLOUD_URL` appears stale/unused | `.env.example` | ⚠️ Low |
| Firebase keys not grouped clearly in `.env.example` | `.env.example` | ⚠️ Low |

---

## Phase 5 — Orphaned / Runtime Folders ⚠️

| Folder | Status | Action |
|--------|--------|--------|
| `wasabiUploads/` | ⚠️ Runtime generated | Add to `.gitignore` |
| `wasabiUploadsLocal/` | ⚠️ Runtime generated | Add to `.gitignore` |
| `thumbnails/` | ⚠️ Runtime generated | Add to `.gitignore` |
| `log/` | ⚠️ Runtime generated | Add to `.gitignore` |
| `middlewares/mongoConnector/` | ⚠️ Single file — should live in `utils/` | Move or document |
| `Modules/notification1/` | ❌ Likely orphaned | Investigate & remove if unused |
| `Modules/typesense/` | ✅ Intentional search config | OK |
| `utils/mongo-handler/` | ✅ Intentional | OK |

---

## Phase 6 — API Route Versioning ❌

**7 modules mix `/api/v1/` and `/api/v2/` in the same route file.**

| Module | V1 Routes | V2 Routes | Issue |
|--------|-----------|-----------|-------|
| `auth/routes.js` | 3 | 23 | ⚠️ Mixed |
| `auth/routes2.js` | 8 | 13 | ⚠️ Mixed |
| `Company/routes.js` | 8 | 3 | ⚠️ Mixed |
| `logTime/routes.js` | 1 | 11 | ⚠️ Mixed |
| `tasks/routes.js` | 9 | 2 | ⚠️ Mixed |
| `notification-middleware/routes.js` | 2 | 2 | ⚠️ Mixed |
| `prepare-notification-data/routes.js` | 2 | 2 | ⚠️ Mixed |

**Note:** V1 endpoints likely exist because they are consumed by the time tracker app or legacy frontend. Do not remove without confirming no active consumers.

---

## Fix Priority Plan

### 🟢 Quick Wins — Fix Now (fix/repo-structure branch)

| # | Fix | Files |
|---|-----|-------|
| 1 | Update `.env.example` with all keys, mark required vs optional | `.env.example` |
| 2 | Add runtime folders to `.gitignore` | `.gitignore` |
| 3 | Move `brandSettings.json`, `thumbnail.json` to `Config/` | Root → `Config/` |
| 4 | Rename `Apps/controllers.js` → `controller.js` | `Modules/Apps/` |
| 5 | Rename `trackerDownload/controllers.js` → `controller.js` | `Modules/trackerDownload/` |
| 6 | Investigate & remove `notification1/` if unused | `Modules/notification1/` |

### 🟡 Medium Effort — Plan for Later

| # | Fix | Effort |
|---|-----|--------|
| 7 | Standardize folder naming to PascalCase across all Modules | Medium |
| 8 | Merge `auth/routes2.js` into `auth/routes.js` cleanly | Medium |
| 9 | Rename `logTime/controllerV2.js` → `controller.js` | Low |
| 10 | Move `Company/controller2.js` logic into `controller/` subfolder | Medium |

### 🔴 Large Refactor — Backlog

| # | Fix | Effort |
|---|-----|--------|
| 11 | Migrate all remaining `/api/v1/` routes to `/api/v2/` | High |
| 12 | Add `model.js` pattern to modules using inline schema definitions | High |
| 13 | Document and enforce module structure in `CONTRIBUTING.md` | Medium |

---

## Summary

| Priority | Count | Action |
|----------|-------|--------|
| 🟢 Fix now | 6 | Create `fix/repo-structure` branch |
| 🟡 Plan later | 4 | Add to backlog |
| 🔴 Large refactor | 3 | Backlog — separate effort |

---

*Audit completed: 2026-05-06 | Branch: main (read-only) | No changes made during audit*
