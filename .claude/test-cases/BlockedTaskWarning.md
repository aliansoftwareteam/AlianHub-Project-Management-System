# Blocked-Task Warning — Test Cases

**Feature:** A task that is `blocked_by` one or more still-open tasks shows a clear "⚠ Blocked by N open task(s)" banner in its Linked Tasks panel. Makes AlianHub's blocked-task alert real.

**Location:**
- Frontend: Task detail → **Linked Tasks** panel — `frontend/src/components/organisms/LinkedTasks/LinkedTasks.vue` (computed `openBlockers`, banner).
- Backend: `POST /api/v2/tasks/relations` action `openBlockers` → `getOpenBlockers` (`Modules/Tasks/helpers/taskMongo/relations.js`); pure helper `selectOpenBlockers` (`relationRules.js`). A blocker counts only while `statusType !== 'close'` and not soft-deleted.

**Legend:** ✅ Pass · ❌ Fail · ⏳ Pending (not yet run in the app)

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| BW_001 | Warning shows for an open blocker | Task B is `blocked_by` Task A; A is open | Open Task B → Linked Tasks panel | Amber banner: "⚠ Blocked by 1 open task(s): {A.key}" | | ⏳ Pending |
| BW_002 | Warning clears when the blocker closes | As BW_001 | Move Task A to a Done/closed status; reopen Task B | Banner disappears (0 open blockers) | | ⏳ Pending |
| BW_003 | Only `blocked_by` counts | Task B `blocks` Task A (B blocks, isn't blocked) | Open Task B | No banner on B | | ⏳ Pending |
| BW_004 | Multiple open blockers listed | B `blocked_by` A and C, both open | Open Task B | Banner shows count 2 and both keys | | ⏳ Pending |
| BW_005 | Soft-deleted blocker ignored | B `blocked_by` A; A soft-deleted | Open Task B | A not counted in the banner | | ⏳ Pending |
| BW_006 | `openBlockers` API action | B `blocked_by` A (open) | POST /api/v2/tasks/relations {action:'openBlockers', taskId:B} | `{ status:true, data:[A summary] }` | | ⏳ Pending |
| BW_007 | duplicates / relates_to never block | B `relates_to`/`duplicates` A | Open Task B | No banner | | ⏳ Pending |

**Unit coverage:** `selectOpenBlockers` + `isClosedStatusType` fully covered in `tests/task-relations-rules.test.js` (open / closed / deleted / wrong-type / null / mixed).

**Total:** 7 manual cases · pure logic unit-tested (green).
