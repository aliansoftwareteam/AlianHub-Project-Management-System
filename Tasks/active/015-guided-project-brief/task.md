# 015 — Guided project start: complete brief, honest agent/human split

Status: proposed · 2026-09-05 · branch `feat/guided-project-brief` (from `beta`) · depends on 014 landing

## Goal
When someone starts a project from a goal ("Shopify store from scratch"), the system gets a complete brief out of them with at most a handful of questions, drafts the improved brief for approval, and produces a plan where every task says up front whether an agent can do it or a person must.

## What already exists (do not rebuild)
`Modules/AIProjectGenerator` + `frontend/src/components/organisms/AiProjectCreator/AiProjectCreator.vue`, reached from the new-project sidebar's "Generate with AI" tile:
- description (≥ 20 chars) + optional uploaded brief (`briefExtractor.js`);
- `/api/v1/ai/project/clarify` — LLM-generated questions (`clarifier.js`, `prompts/clarify/*`, cap 14, rich option types, `required`, `skipped` answers);
- `/api/v1/ai/project/plan` — sprints + tasks ≤ 2 h (`planRules.js`), member assignment, company skills; answers reach the plan as `clarifications`;
- `/api/v1/ai/project/execute` — creates project, sprints, tasks.
`Modules/Agents`: skills (`brief.parse`, `qa-review`, `pr.summary`, `digest.ceo`), the router (`frontend/src/views/Ai/agentFit.js` + `Modules/Agents/taskInputs.js`) that labels a task agent-eligible only when the skill's input exists, and `needs a person — <reason>` refusals.

## Gaps this task closes
1. Clarify has no completeness bar: it asks whatever the model fancies, up to 14 questions, regardless of what the brief already answers.
2. Nothing drafts the improved brief. Answers go straight into the plan prompt; the user never sees or approves the brief the plan was built from, and it is not stored on the project.
3. The plan assigns people only. It never says which tasks an agent could take, so the AI hub's router is a separate manual step nobody finds.
4. Skipped questions vanish. The plan does not state the assumptions it made in their place.

## Scope

### A · Brief completeness bar (backend `Modules/AIProjectGenerator`)
- A brief is scored against five points: (1) what and for whom, (2) done-when in one customer-visible sentence, (3) what already exists (accounts, repo, theme, data, brand), (4) constraints (date, budget, must-use tools), (5) who is on the team and what they can do themselves.
- `clarify` returns `coverage: { point: 'met' | 'missing' }` and asks **only** about missing points: max 3 questions per round, max 2 rounds. A brief that meets all five returns zero questions (today's behaviour for "detailed enough" becomes explicit).
- Every question offers "I don't know yet". That answer, and a skip, becomes an **assumption** the agent states in the brief and the plan.

### B · Agent-drafted brief with approval (backend + `AiProjectCreator.vue`)
- New step between Clarify and Plan: `POST /api/v1/ai/project/brief` returns the rewritten brief (the five points as headed sections + an "Assumptions" section) from description + upload + answers.
- The UI shows it as an editable draft with the original beside it (diff or side-by-side). "Approve brief" is required before "Generate plan"; the plan is built from the approved text only.
- `execute` stores the approved brief on the project (description block) and the assumptions list, so the project page shows what the plan was based on.

### C · Agent/human split in the plan (backend + `AiProjectCreator.vue`)
- After the plan is generated, each task is classified with the same rules the router uses (`agentFit.classifyTask` + skill input requirements, shared as a server-side module so the creator and the router cannot drift): `agent` (named skill, input present), `agent-after` (agent could, once a person adds X — say X), or `person` (with the reason).
- The plan view shows the split per task and a summary line: "N tasks an agent can start · M need a person · K need a person first".
- On execute, tasks labelled `agent` are queued through the existing run engine (`runs.create` → `executeSkill`) under the workspace's autonomy and spend rules; nothing bypasses the controls landed in 014. Tasks labelled `person` get the assignee from the plan and a due date inside their sprint.

### D · Evidence gate before UI work
- Run the five-point scorer and the clarify prompt on three real thin briefs (one is "Shopify store from scratch", two-line). Keep only if at least two of three question sets are ones the owner would answer. Record the three transcripts in `evidence.md`.

## Out of scope (slice 2 candidates)
- Vertical playbooks (a curated Shopify step list with pre-labelled agent/human steps). Slice 1 proves the generic path; the playbook fits in as a deterministic question and task source afterwards.
- New agent skills. The split uses the four skills that exist; a task no skill can do is `person`.
- Re-planning after the project starts; editing the brief later regenerating the plan.
- Member-role permissions for who may approve a brief (owner/admin/any member is a product decision; default: whoever creates the project).

## Acceptance criteria
- [ ] A two-line brief gets ≤ 3 questions in round one and ≤ 6 in total; a brief that covers all five points gets none. (`tests/ai-project-coverage.test.js`)
- [ ] "I don't know yet" on any question produces an assumption line in the drafted brief and the plan. (unit + browser)
- [ ] The plan cannot be generated until the brief is approved; the approved text is what `plan` receives and what `execute` stores. (API test + browser)
- [ ] Every task in the plan view carries `agent` / `agent-after` / `person` with a reason; the classification for a task equals what `/api/v2/agents/routable` + `agentFit` would give for the same task. (unit: shared module; API: one round trip)
- [ ] Executing a plan with agent-labelled tasks creates runs that respect pause, spend cap and daily limit; a paused workspace creates none and says so. (`tests/ai-project-execute-agents.test.js`)
- [ ] Every new string goes through i18n (`npm run i18n:check` green); `npm test`, frontend `vitest`, `npm run lint` green; production build succeeds.
- [ ] Browser sweep of the whole flow as owner, recorded in `progress.md` with screenshots of: coverage questions, the brief diff, the split summary.

## Workstreams (parallel, disjoint files)
| | Owner | Files |
|---|---|---|
| A+B backend | agent | `Modules/AIProjectGenerator/{clarifier,controller,promptBuilder,schemaValidator,orchestrator}.js`, `prompts/clarify/*`, new `prompts/brief/*`, `routes.js`, tests |
| C backend | agent | new `Modules/Agents/taskSplit.js` (shared classifier, consumed by `agentFit.js` and the generator's plan post-processing), `Modules/AIProjectGenerator/execute` hook into `runs`, tests |
| UI | agent | `AiProjectCreator.vue` (new Brief step, split badges, summary line), `frontend/src/locales/en.js` (`AiProject` namespace), unit specs |

## Open questions for the owner
1. Is Shopify a real first customer? If yes, slice 2 starts with its playbook; if it is an example, slice 2 is a second real vertical.
2. In a two-founder company the "person" tasks land on the same person reading the plan. Should slice 1 already set due dates and reminders for them, or is the label enough for now?
