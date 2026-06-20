# Portfolio / Cross-Project Rollup — Test Cases

**Feature:** REP-01 — cross-project Portfolio rollup (leadership / CEO single-pane view)
**Backend:** `Modules/Portfolio/{helpers/portfolioRules.js,controller.js,routes.js,init.js}`, `portfolios` collection; endpoints `POST/GET /api/v1/portfolio`, `GET /api/v1/portfolio/:id`, `PUT/DELETE /api/v1/portfolio/:id`, `GET /api/v1/portfolio/:id/rollup`
**Frontend:** `frontend/src/views/Portfolio/Portfolio.vue` (top-nav **Portfolio** → `/:cid/portfolio`)
**Rollup math:** done = `statusType` in (close, done); overdue = open task past `DueDate`; health = on-track / at-risk / off-track; portfolio totals aggregate per-project summaries; milestones counted by date.
**Unit-tested:** `tests/portfolio-rules.test.js` (done/overdue, project summary, health, milestone split, portfolio totals) — Node suite (33 suites / 382 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| PF-01 | Nav entry | Logged in | Look at the top navigation | A **Portfolio** item appears; clicking opens `/:cid/portfolio` | | ⬜ |
| PF-02 | Create portfolio | ≥2 projects exist | Click "New portfolio", name it, tick several projects, Save | Portfolio created and listed; selecting it loads the rollup | | ⬜ |
| PF-03 | Rollup from real data | A portfolio with projects that have tasks | Select the portfolio | Each project card shows real progress % = done/total, done/total counts, and overdue count | | ⬜ |
| PF-04 | Portfolio totals | Same | Read the totals strip | Projects count, overall progress %, on-track / at-risk / off-track counts, total overdue — all aggregated correctly | | ⬜ |
| PF-05 | Done detection | A project with some `close`/`done` tasks | Inspect its card | Done count matches tasks whose statusType is close/done | | ⬜ |
| PF-06 | Overdue detection | A project with an open task past its due date | Inspect its card | That task counts as overdue; a done task past due does NOT | | ⬜ |
| PF-07 | Health signal | Projects with varying overdue/progress | View cards | on-track (no overdue), at-risk (some overdue, good progress), off-track (overdue + low progress) — colored accordingly | | ⬜ |
| PF-08 | Milestones rollup | A project with milestones | View its card | Milestone total shown; past-due milestones flagged | | ⬜ |
| PF-09 | Edit members | Existing portfolio | Edit → change ticked projects → Save | Rollup updates to the new project set | | ⬜ |
| PF-10 | Delete | Existing portfolio | Delete | Portfolio removed from the list (soft-deleted; `deletedStatusKey=1`) | | ⬜ |
| PF-11 | Deleted project skipped | A portfolio referencing a since-deleted project | Open rollup | The deleted project is silently skipped; others still render | | ⬜ |
| PF-12 | Empty portfolio | Portfolio with no projects | Open rollup | Totals are zero; "no accessible projects" shown; no error | | ⬜ |
| PF-13 | Tenant isolation | Two companies with portfolios | Open as company A | Only company A's portfolios + its projects' data; company B never visible (companyId-scoped) | | ⬜ |
| PF-14 | Rules (unit) | — | `npx jest tests/portfolio-rules.test.js` | All green — done/overdue, summary, health, milestone split, totals | | ✅ |

**Total:** 14 cases (1 unit-automated, 13 runtime/manual). Done-when met: a portfolio holds multiple projects and renders rolled-up progress / at-risk / milestones from real data.
