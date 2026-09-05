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

## 2026-09-05 — API sweep on beta (owner token, real model)
Two-line brief: "A mobile app for a small gym so members can book classes and see their schedule. Needs to work on both phones."

| Step | Result |
|---|---|
| `/clarify` | coverage: what_for_whom met, four missing; 3 questions, each on a missing point, each `allowUnknown` |
| `/brief` (all three answered unknown) | five headed sections; 4 assumptions (one per unknown + the never-asked `team`), e.g. "No launch date or budget given; planning for a six-week first release on both iOS and Android" |
| `/plan` with the approved brief | 10 tasks over 5 sprints; `splitSummary` agent 5 · agent-after 2 · person 3; assumptions echoed; `person` reasons include "It asks for a decision…" and "no agent here has a skill for this kind of work" |
| `/guide` | 5 stages derived from the brief (Project Initialization → … → Testing and Launch Preparation), 4 essentials, 3 escalations; no fixed list |
| `/execute` | project created with `aiGuide` (5 stages) and 4 `aiAssumptions`; "Gym Class Booking App Guide" at L1, actions task.get/task.comment/subtask.create, scoped to the project, trigger mention; `runsQueued` 5, `runsRefused` 0 |
| the 5 runs | all ended `waiting_approval` as L1 requires; proposals carry a `rating` per change; spend $0.002–0.004 each, budget ledger $0.12 for the month |

Finding for review: "Implement user login flow" and similar implementation tasks are labelled `agent` because Daily PM's planning skill fits the work kind and the task carries a brief. The reason text says "Daily PM can run project.plan on it", which is accurate, but the badge alone reads as "an agent will implement this". Consider a distinct label (or wording) when the only matching skill plans rather than does.

Note: `/execute` requires the existing `source` field (upwork / fiverr / other); the UI already sends it. The sweep project "(sweep 015)" is left in the workspace for the browser look; trash it afterwards.

## 2026-09-05 — UI sweep on beta (owner, Browser pane, real model)
Same two-line gym brief through the "Create from a description" tile.

| Step | Result |
|---|---|
| Describe | textarea + Continue; the Source field is not enforced here (see finding) |
| Clarify, round 1 | coverage chips: What and for whom met, four missing; "Round 1 of 2 · only the missing points are asked"; question 1/3 with option cards and "I don't know yet"; all three answered unknown |
| Clarify, round 2 | exactly one question, the never-asked Team point; answered "External developer or agency" |
| Brief | chips now show Team met; original beside the drafted brief; three assumptions listed for the unknowns; **Generate plan disabled until Approve brief** (verified before/after) |
| Plan | "3 sprints · 4 tasks · $0.09"; summary line "3 tasks an agent can start · 4 need a person · 1 need a person first"; assumptions carried; badge "⏳ Agent after: a public URL in the task title or description (QA review)" on a task row; guide preview with 6 stages from this brief, essentials, escalations |
| Create everything | "All done!" — Project Done, Sprints 3/3, "⚡ 3 agent runs queued", "Open the Guide agent →"; the link opens the Guide agent's settings page at L1 with task.get / task.comment / subtask.create scoped to the project |

Findings (1 and 2 fixed in PR #549)
1. **Source not validated on step 1.** Continue is enabled without a Source; execute then fails with "Select where this project came from." and the wizard drops back to step 1. State survives the round trip (brief, plan and guide are kept, no new model call), but the check belongs on step 1.
2. **Done-screen counter reads "Tasks 8 / 4"**: created subtasks are counted against the planned task total.
3. As in the API sweep: implementation tasks labelled `agent` because a planning skill fits them; consider a distinct label when the only matching skill plans rather than does.

Cleanup: two sweep projects exist now ("Gym Class Booking App (sweep 015)" from the API run and "Gym Class Booking App" from the UI run) with their Guide agents; trash both when done.

Open
- Member-role pass — needs a member account.
