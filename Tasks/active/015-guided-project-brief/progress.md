# 015 — progress

Branch `feat/guided-project-brief` (from `beta` 1989b987). Contract agreed first (`contract.md`), three parallel workstreams, merged 2026-09-05.

## Evidence gate (section E) — passed 3 of 3
`evidence.md`: three two-line briefs (online store, mobile app, ERP rollout across three departments) through coverage → clarify → brief on the repo's configured model. Store 3 questions, app 3, ERP 2; every unknown answer became exactly one assumption; about $0.03–0.04 per brief. Caveat: the store run echoed the prompt's own example closely; the app and ERP runs are the honest signal.

| Item | What landed | Tests |
|---|---|---|
| Brief completeness bar | Coverage scored against the five points; `/clarify` asks only about missing points, ≤ 3 per round, ≤ 2 rounds, ≤ 6 total, every question `allowUnknown`; server drops questions on met points and forces `required: false` | `ai-project-coverage` (9) |
| Agent-drafted brief | `POST /api/v1/ai/project/brief` → five headed sections + assumptions (one per skipped/unknown answer and per still-missing point) + markdown; instruction-shaped text in a brief always becomes an assumption | `ai-project-brief` (12) |
| Approved brief into the plan | `/plan` takes `approvedBrief` + `assumptions` as DATA and ignores description/upload when present | same |
| Agent / person split | `Modules/Agents/taskSplit.js` (shared with the router, parity test against agentFit.js); `planSplit.attachSplit` labels every task `agent`, `agent-after` (with `need`) or `person` (with reason) and adds `splitSummary`; wired at the end of `generatePlanForJob` | `agent-split`, `agent-split-parity` |
| Guide agent | `POST /guide` generates stages, essentials, escalations and style from the brief (no fixed list; a test asserts none); skill `project.guide` answers a mention with the next step and proposes up to 3 tasks at L1 | `ai-project-guide` |
| Execute | Stores approved brief + assumptions as the project description, `aiGuide` and `aiAssumptions` on the project; creates "<Project> Guide" at L1 scoped to the project; recomputes the split and queues `agent` tasks through `canStart → create → executeSkill`; refusals (paused, capped, limited) returned per task; `person` tasks get assignee and due date | `ai-project-execute-agents` |
| UI | Five steps: Describe → Clarify (coverage chips, "I don't know yet", round 2 only for never-asked points) → Brief (draft beside original, editable, Approve gates Generate plan) → Review plan (split badges, summary line, assumptions, guide preview) → Create (runs queued / refused, link to the Guide agent) | vitest `aiProjectCreator` (9) |

Gates on the merged branch: `npm test` 1506 (128 suites), lint 0 errors, vitest 45, i18n check clean (62 keys backfilled; hardcoded-text baseline shrank 385 → 372).

Notes for review
- `/execute` still answers `{ jobId }`; `guideAgentId`, `runsQueued`, `runsRefused`, `splitSummary` arrive on the SSE `complete` event and the UI reads them there.
- `created` is now emitted when the user clicks "Open project", so the summary screen is visible.
- Assumptions are not individually editable in the UI; editing the markdown does not change the array sent.
- `Modules/Agents/agentRecord.js` duplicates `controller.createAgent` defaults; one-line dedupe once 016 lands (016 sets the default to L1 there).
- Agents schema gained `trigger`; projects gained `aiGuide`, `aiAssumptions`.

Open
- Browser sweep of the whole flow on the three domain briefs (owner), then member.
