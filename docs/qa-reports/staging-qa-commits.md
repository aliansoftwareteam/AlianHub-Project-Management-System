# Staging QA — Commit Reference

**Branch:** `staging`  
**Last Updated:** 2026-05-06

---

## Auth Module QA Fixes

| Date & Time | Commit Hash | Message |
|-------------|-------------|---------|
| 2026-05-06 15:21 | `79587c8` | fix(email): use Resend HTTP API to bypass SMTP port blocks on Render free tier |
| 2026-05-06 14:14 | `3b54205` | Merge fix/auth-reset-token-reuse into staging |
| 2026-05-06 14:14 | `629d87c` | fix(auth): prevent reset token reuse, fix logout session error, fix invite link typo |

### What each fix covers

| Commit | Bug | File Changed |
|--------|-----|--------------|
| `629d87c` | BUG-AUTH-001 — Reset token reuse (CRITICAL) | `Modules/auth/controller.js` |
| `629d87c` | BUG-AUTH-002 — Broken verify-invitation URL | `Modules/auth/controller/sendInvitation.js` |
| `629d87c` | BUG-AUTH-003 — Logout returns 400 session not found | `Modules/auth/session.js` |
| `79587c8` | INFRA-001 — Email sending fails on Render (SMTP blocked) | `Modules/service.js`, `Config/config.js`, `generate-env.js` |

---

## Staging Infrastructure Setup Commits

| Date & Time | Commit Hash | Message |
|-------------|-------------|---------|
| 2026-05-06 10:14 | `607c8d6` | fix(staging): skip authSource for mongodb+srv — Atlas SRV TXT records handle auth |
| 2026-05-06 10:10 | `6aca45f` | fix(staging): strip trailing slash from MONGODB_URL before appending db name |
| 2026-05-06 09:41 | `3c82883` | fix(staging): harden firebaseConfig to not crash when SERVICE_FILE unset |
| 2026-05-06 09:37 | `76a0da8` | fix(staging): add .node-version file to pin Node.js 20.11.1 on Render |
| 2026-05-06 09:35 | `c483e72` | fix(staging): pin Node.js to 20.x — firebase-admin incompatible with Node 24 |
| 2026-05-06 09:31 | `1c92891` | chore(staging): add global error handlers to expose crash reason |
| 2026-05-05 19:36 | `0f56203` | chore(staging): add generate-env.js for Render deployment |
| 2026-05-05 19:30 | `edce645` | chore(staging): commit pre-built frontend dist for Render deploy |

---

## QA Module Status

| Module | Status | Bugs Found | Bugs Fixed |
|--------|--------|------------|------------|
| Auth | ✅ Complete | 3 | 3 |
| Tasks | 🔲 Pending | — | — |
| Projects | 🔲 Pending | — | — |
| Users/Members | 🔲 Pending | — | — |
| Chat/Comments | 🔲 Pending | — | — |
| Notifications | 🔲 Pending | — | — |
| Reports/Timesheets | 🔲 Pending | — | — |
