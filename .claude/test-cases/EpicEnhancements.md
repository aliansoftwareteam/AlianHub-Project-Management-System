# Epic Enhancements (dates / owner / priority / status / progress) — Test Cases

**Feature:** Epics gain **start/due dates**, an **owner**, a **priority** (low/medium/high), an **in_progress** status (alongside open/done), and a visible **progress bar with %** — turning the thin v1 into a usable progress layer.

**Location:**
- Frontend: **Epics** panel — `frontend/src/components/molecules/Epics/EpicsPanel.vue` (create form fields, priority badge, status select, owner + dates, % label).
- Backend: `Modules/Epics/controller.js` (create/update accept the new fields), `helpers/epicRules.js` (`EPIC_PRIORITIES`, `parseEpicDates`, extended `EPIC_STATUSES`), schema `utils/mongo-handler/schema.js` (epics: priority, ownerUserId, startDate, dueDate).

**Legend:** ✅ Pass · ❌ Fail · ⏳ Pending (not yet run in the app)

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| EE_001 | Create epic with priority + dates | Project open; Epics panel open | Enter name, pick priority **High**, set start + due, click Add | Epic created; owner defaults to creator | | ⏳ Pending |
| EE_002 | Row renders new metadata | EE_001 done | View the epic row | Priority badge (High), owner name, due date all shown | | ⏳ Pending |
| EE_003 | Progress bar + % label | Epic has 4 tasks, 1 closed | View epic row | Bar ≈25%, label "25% · 1/4" | | ⏳ Pending |
| EE_004 | Set status In progress | Epic exists | Pick "In progress" in the row status select | Persists (PUT /epics/:id); chip tinted amber | | ⏳ Pending |
| EE_005 | Set status Done | Epic exists | Pick "Done" | Persists; chip tinted green | | ⏳ Pending |
| EE_006 | Invalid priority rejected (API) | — | PUT /api/v2/epics/:id {priority:'urgent'} | `{ status:false, "Invalid priority." }` | | ⏳ Pending |
| EE_007 | start-after-due rejected (API) | — | POST /api/v2/epics {startDate:'2026-07-01', dueDate:'2026-06-01', …} | `{ status:false, "startDate must be on or before dueDate." }` | | ⏳ Pending |
| EE_008 | Owner shows Unassigned when empty | Epic with no ownerUserId | View the row | Owner: "Unassigned" | | ⏳ Pending |

**Unit coverage:** `validateEpicInput` (priority), `parseEpicDates` (valid / clear / partial / unparseable / start>due), and `EPIC_STATUSES`/`EPIC_PRIORITIES` covered in `tests/epic-rules.test.js`.

**Total:** 8 manual cases · pure logic unit-tested (green).
