# Guest / Client Role — Test Cases

**Feature:** SEC-01 — external guests (roleType 4) restricted to assigned projects, enforced server-side
**Backend:** `Modules/Auth/helpers/guestAccessRules.js` (pure) + `requireGuestProjectAccess` / `requireGuestTaskAccess` in `Config/permissionGuard.js`; `guestProjectIds` on `company_users`; project-list scoping in `getProjectList`
**Guards applied:** project `:id` (detail/update/allTask/sprintFolder), project list, `task/:id`, `/projectdata/taskData`, `tabSyncTask` (by pid), `task/find` (guests denied), comments (by projectId)
**Assignment:** `PUT /api/v1/members {id, data:{roleType:4, guestProjectIds:[...]}}` (role cache invalidated on change)
**Unit tests:** `tests/guest-access-rules.test.js` (10 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| GR-01 | Assign a guest | Owner/admin | `PUT /members` set `roleType:4` + `guestProjectIds:[P1]` | company_users updated; role cache invalidated (takes effect at once) | | ⬜ |
| GR-02 | Project list scoped | User is a guest assigned [P1] | `GET /api/v1/project` | Only P1 returned (not public/other projects) | | ⬜ |
| GR-03 | Project detail 403 | Guest assigned [P1] | `GET /api/v1/project/P2` (unassigned) | 403 Forbidden; `GET .../P1` → 200 | | ⬜ |
| GR-04 | Task detail 403 | Guest assigned [P1]; task T2 in P2 | `GET /api/v1/task/T2` | 403; a task in P1 → 200 | | ⬜ |
| GR-05 | Board sync scoped | Guest assigned [P1] | `POST /tabSyncTask {pid:P2}` | 403; `{pid:P1}` → 200 | | ⬜ |
| GR-06 | Arbitrary task query denied | Guest | `POST /api/v1/task/find` | 403 (guests use the scoped board, not free queries) | | ⬜ |
| GR-07 | Comments scoped | Guest assigned [P1] | view/post comments on P2 vs P1 | P2 → 403; P1 → allowed | | ⬜ |
| GR-08 | No admin nav | Logged in as a guest | open the app | No Settings/admin nav (checkPermission returns null for a guest's keys) | | ⬜ |
| GR-09 | Role change is immediate | Change a user's role to/from guest | retry a previously-allowed call | New scoping applies right away (no 60s cache lag) | | ⬜ |
| GR-10 | Non-guests unaffected | Owner / admin / member | normal usage | All guards pass through; behaviour byte-for-byte unchanged | | ⬜ |

**Total:** 10 cases (API/UI — run on the dev server). Guest-access rules covered by 10 automated unit tests.

**Follow-up (usability, not blocking):** an admin-facing "Guest" role option + per-guest project picker in the Members UI (assignment works via the members API today).
