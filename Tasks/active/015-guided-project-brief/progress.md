# 015 — progress

Branch `feat/guided-project-brief` (from `beta` 1989b987). Contract agreed first (`contract.md`), three parallel workstreams, merged to `beta` as PR #546, merge commit `1d8cd48d`, build `14.36.0-beta.23`. Two of the three UI-sweep findings were fixed by PR #549, build 26.

## Checklist

One line per bullet of `task.md` "## Acceptance criteria", plus the section E evidence gate. Verified against `origin/beta` at `71c9332f` on 2026-09-12.

- [x] A two-line brief gets ≤ 3 questions in round one and ≤ 6 in total; a brief that covers all five points gets none — `Modules/AIProjectGenerator/clarifier.js:34-36` sets the three caps and `planRound()` at `:169-182` enforces them (`Math.min(3, MAX_TOTAL - answers.length, askPoints.length)`), with a second guard in the question loop at `:241`; the five points are in `schemaValidator.js:430` and `coverage` is returned by `controller.js:512`; `tests/ai-project-coverage.test.js` (9 cases, including the zero-question path) — `1d8cd48d` (#546)
- [x] "I don't know yet" on any question produces an assumption line in the drafted brief and the plan — `allowUnknown: true` on every question (`clarifier.js:240`), `gaveUp()` at `:159` treats skip and unknown alike, `requiredAssumptionsFor()` at `:254-274` emits one per given-up answer and per still-missing point, and `coversRequired`/`fallbackAssumption` at `:278-300` guarantee the line even when the model omits it; it reaches the plan via `promptBuilder.js:169` and the project via `aiAssumptions` — `1d8cd48d` (#546)
- [x] The plan cannot be generated until the brief is approved; the approved text is what `plan` receives and what `execute` stores — `POST /api/v1/ai/project/brief` at `routes.js:59`; `BriefStep.vue:86` disables Generate plan on `!approved` and editing the draft revokes approval (`AiProjectCreator.vue:955`); `promptBuilder.js:161-172` feeds the approved brief and leaves description and upload out rather than sending them twice; `orchestrator.js:1047` stores it on the project; `tests/ai-project-brief.test.js` — `1d8cd48d` (#546). Noted: `AiProjectCreator.vue:975` keeps an `onSkipBrief()` escape hatch that plans with an empty approved brief, deliberately, for when `/brief` is unavailable.
- [x] Every task in the plan view carries `agent` / `agent-after` / `person` with a reason, and matches what `/api/v2/agents/routable` + `agentFit` would give — `Modules/Agents/taskSplit.js` is the shared classifier; `tests/agent-split-parity.test.js` pins it against `frontend/src/views/Ai/agentFit.js` by regex source, kind order and input rules; `planSplit.js:51` attaches the labels and `splitSummary` — `1d8cd48d` (#546)
- [x] Executing a plan with agent-labelled tasks creates runs that respect pause, spend cap and daily limit; a paused workspace creates none and says so — `executeAgents.queueRuns()` goes through `runs.canStart`, and `prepare()` loads agents with `includePaused: true` so a pause since `/plan` surfaces as a refusal rather than a silent relabel; `tests/ai-project-execute-agents.test.js` (13 cases, including the all-paused and cap/limit ones) — `1d8cd48d` (#546)
- [x] Executing a plan creates a project-scoped Guide agent; mentioning it produces a next-step answer grounded in the plan and the stored guide, and nothing outside the project — `POST /api/v1/ai/project/guide` at `routes.js:75`; `executeAgents.createGuideAgent` sets skill `project.guide`, autonomy 1, `trigger: 'mention'`, `projectIds: [projectId]` and read/comment actions; `Modules/Agents/skills/projectGuide.js`; `tests/ai-project-guide.test.js` (18 cases) — `1d8cd48d` (#546)
- [x] No domain-specific code anywhere in the flow — 0 matches for vertical names across the generator, `taskSplit.js` and `projectGuide.js`; the stages come from the model (`prompts/guide/system.md` rule 1) and `tests/ai-project-guide.test.js:24-39` fails if a template stage list or a `stages: […]` literal ever appears — `1d8cd48d` (#546)
- [x] Section E evidence gate — three thin briefs from three domains through coverage → clarify → brief, recorded in `evidence.md` (`## Online store` L33, `## Mobile app` L131, `## Multi-team system (ERP rollout)` L230), each with its coverage table, both rounds and the drafted brief. Passed 3 of 3
- [x] Every new string goes through i18n; `npm test`, vitest and lint green; production build succeeds — 62 keys backfilled at merge with the hardcoded-text baseline falling 385 → 372; CI on the tip of `beta` is green (`gh pr checks 684`: backend, frontend, e2e) — `1d8cd48d` (#546)
- [ ] Browser sweep of the whole flow as owner **on the three domain briefs**, recorded with screenshots of the coverage questions, the brief diff and the split summary — **partly delivered.** The 2026-09-05 sweep below walked the whole wizard end to end as owner and passed every step, but on **one** brief (the gym mobile app), not three, and the evidence is the table below rather than screenshots. The other two domains were only exercised through the API for the section E gate.

**Open beyond the acceptance list**

- [ ] **Finding 3 — needs an owner decision, filed nowhere.** Implementation tasks such as "Implement user login flow" are labelled `agent` because a *planning* skill fits the work kind and the task carries a brief. The reason text ("Daily PM can run project.plan on it") is accurate, but the badge alone reads as "an agent will implement this". Both sweeps below raised it and asked for a distinct label or wording. Nothing changed: `git log 1d8cd48d..HEAD -- Modules/Agents/taskSplit.js frontend/src/views/Ai/agentFit.js` returns 0 commits, `taskSplit.js:71` still maps `^(brief\.parse|project\.plan)$` to a plain `agent`, and a repo-wide search finds the idea recorded only in this file.
- [ ] **Member-role pass — outstanding.** Not one of this task's acceptance bullets (bullet 8 says "as owner"), but recorded as open since the sweep. The guided-brief surface was never swept as a member: task 034's ten findings files, progress and follow-ups have 0 matches for the brief, clarify or wizard routes. The blocker is gone — `docs/QA-DEMO-TEAM.md` and `npm run demo:token` now provide members, an admin and a guest.

## Last step

Audited 2026-09-12. Nine of the ten acceptance bullets are delivered and on `beta`, and the section E gate passed. The task stays in `active/` because the browser sweep covered one of the three domain briefs rather than three, because finding 3 is an open product question with no home anywhere, and because the member pass was never run.

## Blockers

None. The member account that blocked the member pass exists now (`docs/QA-DEMO-TEAM.md`, `npm run demo:token`).

## Log

### 2026-09-05 — evidence gate (section E) — passed 3 of 3
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

## 2026-09-12 — record audited

Checklist above rebuilt from `task.md` "## Acceptance criteria" and checked against `origin/beta` at `71c9332f`.

- The coverage bar, the approved-brief gate, the shared split classifier with its parity test, the execute-time run queueing and the Guide agent are all present on `beta` with their five test suites; the domain-agnostic rule is enforced by a test that fails if a template stage list ever appears.
- The status line said "planned", which was three states out of date: the work was built, merged on 2026-09-05 as PR #546 (build 23) and partly followed up by PR #549 (build 26). It now names what remains.
- Findings 1 and 2 from the sweep below are confirmed fixed on `beta` today: the Source field gates all five Continue buttons (`AiProjectCreator.vue:576` + five `:disabled` bindings) and the done-screen total counts subtasks (`:632-641`, `:1152`, with the SSE overwrite removed). Finding 3 was never acted on and is recorded nowhere else, so it stays here as an owner decision.
- YAML frontmatter added to `task.md` (it had none). Task stays in `active/`.
