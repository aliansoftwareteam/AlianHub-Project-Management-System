# Plan — Milestone Report Card (dashboard, Owner/Admin only)

**Branch:** `claude/milestone-card-management-41f47e`
**Date:** 2026-07-09
**Scope (finalized):** A **simple Milestone report card** on the dashboard, visible to **Owner/Admin only**. Shows **totals + a mini list**. Overdue detection and reason-on-date-change are **out of scope** (dropped by request).

---

## 1. How milestones work today (review)

> ⚠️ In AlianHub a "milestone" is a **billing/financial milestone on a project** (Fix-price or Hourly) — it carries an `amount`, currency, status history, and refunds. Not a timeline marker.

### Backend
- **Module:** `Modules/Milestone/` — `controller/crud.js` (add/update/delete), `controller/status.js`, `controller/query.js` (get/list/**report**), `controller/helpers.js`.
- **Schema:** centralized in `utils/mongo-handler/schema.js` (~line 1950), type `MILESTONE`. Fields: `milestoneName, amount, projectId, startDate, endDate, dueDate, statusDate, statusId, statusArray[], refundedAmount[], order, …`. No per-doc `companyId` (DB-scoped via `MongoDbCrudOpration(companyId, …)`).
- **Existing report endpoint:** `POST /api/v1/milestoneReport` (`controller/query.js:getMilestoneReport`) — aggregation over milestones filtered by `projectId $in [...]` and a date range, used by the Milestone Report page. This is the reuse target.
- **List endpoint:** `GET /api/v1/milestone/project/:pid`. No Socket.io events; project-scoped only.

### Frontend
- **Milestone Report page:** `views/MilestoneReport/MilestoneReport.vue` (+ atoms `MilestoneReportThead|Tbody|TbodyProject|TbodyMilestone|MilestoneTotal`), route `/:cid/report/milestone` (`router/milestonesheet/index.js`). Calls `apiRequest("post", env.MILESTONE_REPORT, {startDate,endDate,element,cancel})`. Already gated to Owner/Admin (`roleType !== 1 && !== 2` guard at `MilestoneReport.vue:175,186`).
- **Milestone management UI:** `organisms/FixMilestone/`, `HourlyMilestone/` in `ProjectDetail.vue`.

### Dashboard + access control
- `plugins/dashboard/views/HomePage.vue` drives a `grid-layout-plus` grid. Card catalog is **server-driven from the `CARDCOMPONENT` collection**; a `getComponent(componentId)` switch (~363–431) maps ids → components. Card chrome = `components/molecules/DashBoardCard/DashBoardCard.vue`. Content-card pattern to copy = `components/organisms/MyAchievementsCard/MyAchievementsCard.vue` (props `cardUID, cardData, filterData, refreshTrigger, companyUserDetail`; `CardSkeleton`; `apiRequest`).
- **Role gating:** getter `settings/companyUserDetail.roleType` → **Owner = 1, Admin = 2**; guard `[1,2].includes(roleType)`. `HomePage.vue` already passes `:companyUserDetail` into every card.

---

## 2. What the card shows (finalized)
**Totals + mini list**, Owner/Admin only:
- **Top — totals:** total milestone amount **per currency** + counts by status, across the company's projects (within the dashboard's date range).
- **Below — mini list:** short list of the most recent milestones (project · milestone name · amount · status · date).
- **Footer link:** "View full report" → existing Milestone Report page.

---

## 3. Implementation

### Backend
1. **Company-wide project list:** the card needs all project ids for the company. Reuse the existing project-list helper, then call the milestone aggregation.
2. **Endpoint:** prefer reusing `POST /api/v1/milestoneReport` if it can accept the full company `element` (project ids) list + range and return per-currency totals. If its shape doesn't fit a compact card cleanly, add a thin `GET /api/v1/milestone/summary` in `controller/query.js` returning `{ totalsByCurrency: [{currency, total, count}], byStatus: [{statusId, count, amount}], recent: [{projectId, projectName, milestoneName, amount, currency, statusId, date}] }`. Add route + `config/env.js` const.
3. **Register the card** in the `CARDCOMPONENT` collection (seed/migration) so it appears in "Add card".

### Frontend
1. **New card** `components/organisms/MilestoneReportCard/MilestoneReportCard.vue` following the `MyAchievementsCard` pattern: `CardSkeleton` while loading, `apiRequest` to the summary endpoint, reacts to `refreshTrigger` / `cardData` / dashboard range. Renders totals block + mini list + "View full report" link (router push to the milestone report route).
2. **Wire up:** import + `case` in `HomePage.vue getComponent`; add `env.MILESTONE_SUMMARY` (or reuse `MILESTONE_REPORT`).
3. **Owner/Admin gate:** `const isManagement = computed(() => [1,2].includes(companyUserDetail.value?.roleType))` — hide content for non-management and/or filter it out of the card catalog.

### Testing / delivery
- Test cases: totals math per currency, role gating (non-management can't see/add it), empty state. Local verify against a Fix + Hourly project. Then PR to staging + staging QA checklist (dashboard is CI-built on staging).

---

## 4. Estimate

| Phase | Est. |
|---|---|
| Backend: company-wide milestone summary (reuse `milestoneReport` or thin new endpoint) | 2–3h |
| Register card in `CARDCOMPONENT` | 1–2h |
| New `MilestoneReportCard` (totals + mini list + link) | 4–5h |
| `getComponent` wiring + Owner/Admin gating + test cases + staging QA | 2h |
| **Total** | **~9–12h ≈ 1.5–2 working days** |
