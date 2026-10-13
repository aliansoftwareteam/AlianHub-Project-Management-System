# AP-490 — The generator's wider plan (S-2) and the built-in workspace agent (T-2)

Task 047, "Later, optional (with a server key)". Both items need a configured, priced server model; neither is on the connected-AI path the owner chose as the main road (decision 30).

## 1. What is built and live

**S-2, the connected-AI road (done)**
- `project.setup` sets up an existing project from one plan (#1420, build 771).
- `project.create` proposes a new project with its setup (#1433, build 772).
- The approver picks the parts; a plan holds rules and first tasks; browser test of the whole flow (#1496, build 802). Card fixes after a first look (#1508, build 803).
- A plan filed on the web route is stored and shown as one filed over MCP; owner-or-admin parts shown locked (#1515, build 806).
- Parts the approver's role may not make are locked with who can approve; what is left waits as its own row; the AI Inbox card has part ticks; the finished card lists what was not made (#1536, build 812).
- Part-by-part approval on Home's "Waiting on you" and on Approvals (#1554, build 815).
- Shared code: `Modules/Agents/projectSetup.js` (`planOf`, `planProblem`, `carryOut`, undo), `planWork.js` (rules and first tasks), `planFiling.js`, `planChoice.js`, `planLocks.js`, `projectCreate.js`; web card `frontend/src/components/molecules/IntentPreview/planPicks.js`.

**S-2, the in-product generator (as before 047)**
- `Modules/AIProjectGenerator/`: brief, follow-up questions, plan, then a project with statuses, task types, lists, tasks and up to 30 fields. Views are a fixed allowlist (`AI_PROJECT_VIEW_KEYS` in `orchestrator.js`): no named or configured views, no rules, no dashboard. Its preview is its own step in `AiProjectCreator.vue`, not the shared plan card. It creates directly as the person (no proposal), so there is no undo of the whole project.

**T-2 (done)**
- The connected AI as a named member: Members row, assignee picker, @ in task comments, handed tasks in its work queue, withdrawal (#1410, build 769; naming fix #1432, build 772).
- "@" your own connected AI in chat puts the question in its work queue (#1537, build 812, migration 073 `asked-in-chat` index).
- Already there: the generator makes one "<Project> Guide" agent per generated project (`executeAgents.createGuideAgent`, skill `project.guide`, mention-triggered), only when the generated project has a brief or guide.

**T-2, not built:** "With a server key: one built-in workspace agent is on from the start, made from the Project Guide template." No agent is created for a company today unless a person adds one, or the generator makes a per-project Guide. The `project.guide` skill also skips any project without a stored guide (`readers.js`, `requireGuide`), so a workspace-wide agent built from it would answer almost nowhere.

## 2. Remaining slices

### S2-A — The generator's plan gains views
- **Goal:** a generated project starts with named, configured views (for example "Board by assignee", "Due this week"), not only the fixed allowlist.
- **Behaviour:** the plan step shows the views the model proposes; the created project has them.
- **Files:** `Modules/AIProjectGenerator/prompts/project-plan/`, `schemaValidator.js`, `orchestrator.js` (after the project exists, run the views through `projectSetup.carryOut` as the person), `AiProjectCreator.vue` (list views in the plan step), `en.js`.
- **Size:** M. **Depends on:** nothing new.
- **Acceptance:** up to 5 views, kinds list/board/table/calendar/workload, checked by `projectSetup.planProblem`; a bad view is reported beside the parts that worked and does not stop the project; the allowlist views still appear.

### S2-B — The generator's plan gains rules, switched off
- **Goal:** the plan proposes up to 3 automations from the recipe catalogue (`Modules/Automations/templates.js`).
- **Behaviour:** rules are listed in the plan step; they are created off; the done screen says "turn them on in Automations".
- **Files:** prompt, `schemaValidator.js`, `orchestrator.js` (made through `planWork` rules, each with its own audit row), `AiProjectCreator.vue`, `en.js`.
- **Size:** M. **Depends on:** S2-A (same hand-off into the shared executor).
- **Acceptance:** every rule is a catalogue recipe checked like a `project.setup` rule; created off; a person without the right to make rules gets the project without them and a line saying why.

### S2-C — The generator shows the shared plan card
- **Goal:** one preview for both roads.
- **Behaviour:** the generator's plan step uses the plan card with part ticks (`planPicks.js`); only ticked parts are made; locked parts read as on the AI Inbox card.
- **Files:** `AiProjectCreator.vue`, `IntentPreview/`, `planPicks.js`, `controller.js` (`execute` takes the picks), `en.js`.
- **Size:** M. **Depends on:** S2-A, S2-B.
- **Acceptance:** unticking a part means it is not made; the card matches the one a connected AI's plan shows.

### S2-D — A dashboard as a plan part (both roads)
- **Goal:** "views, rules and a dashboard as part of a setup", as task.md asks.
- **Behaviour:** a plan may hold one project dashboard with up to 6 cards from the editor's no-input set (`dashboardRequests.js`); `project.setup`, `project.create` and the generator all accept it; undo removes it.
- **Files:** `projectSetup.js` (new part, maker, inverse), `planFiling.js`, `planChoice.js`, `dashboardRequests.js`, `Modules/Mcp/` tool schemas, `docs/MCP-AGENT-GUIDE.md`, the card, `en.js`.
- **Size:** M. **Depends on:** S2-C for the generator side; the MCP side can go first.
- **Acceptance:** the dashboard is made as the approver, private to them unless they may share; undo removes it unless someone changed it since.

### T2-A — The guide answers on a project with no stored guide
- **Goal:** prerequisite for a workspace agent.
- **Behaviour:** mentioned on any task, the guide answers from the project's plan, description and the task; with a stored guide it behaves as today.
- **Files:** `Modules/Agents/skills/seeds/projectGuide.js` (or a sibling seed `workspace.guide`), `skills/readers.js`, skill tests.
- **Size:** S. **Depends on:** nothing.
- **Acceptance:** no "has no stored guide" skip; the answer names no tasks the mentioning person cannot open.

### T2-B — One built-in workspace agent, on from the start
- **Goal:** with a server key, every workspace has one agent people can @ on any task or in chat.
- **Behaviour:** "Workspace Guide" appears on the Team board and in the @ menu, marked built-in, mention-only, read plus comment and propose (no direct writes). An admin can rename, pause or remove it; a removed one is not made again. With no priced model it does not appear (T-2 rule: show nothing that would fail).
- **Files:** `Modules/Agents/agentRecord.js` (an `ensureWorkspaceAgent`), a migration for existing companies, the company-create path, `team.js`, `AgentTeammates.vue`, `useRunnableAgents.js`, `en.js`.
- **Size:** M. **Depends on:** T2-A; owner decision below.
- **Acceptance:** one per company, idempotent; mention-only, so no scheduled spend; runs count against the daily run limit, per-agent spend cap and company budget; hidden when the model is unset.

## 3. Order and the first slice

Order: **S2-A, S2-B, S2-C, S2-D**, with **T2-A** in parallel (it is small and independent), then **T2-B** once the owner answers.

S-2 goes first because it needs no owner decision and reuses the checked, undoable plan executor. T2-B starts spending model money without anyone asking for it, so it waits.

### PRD — S2-A: the generator's plan gains views

**Goal.** A project made by the in-product AI generator starts with the views its plan names, made and checked the way a connected AI's plan makes views.

**Scope**
- The plan prompt and the plan schema (`schemaValidator.js`) gain `views`: 0 to 5, each `{ name, kind, look, showFields }` in the shape `projectSetup.viewOf` takes.
- The plan step in `AiProjectCreator.vue` lists the proposed views by name and kind (read-only in this slice).
- After `executePlan` has made the project, its lists, fields and tasks, the views go through `projectSetup.carryOut` (views part only) as the person who ran the generator, so the same route, rights and checks apply.
- A view that cannot be made is reported on the done screen beside what was made; the project stays.
- `/plan` runs `projectSetup.planProblem` on the views and drops an invalid one with a reason, rather than failing the plan.
- New strings in `en.js` under `AiProject`, then `npm run i18n:backfill`.

**Out of scope:** rules (S2-B), the shared plan card and ticks (S2-C), dashboards (S2-D), changing the allowlist, undo of a generated project.

**Acceptance criteria**
- [ ] A brief asking for "a board by person and a calendar of due dates" ends in a project with those two views beside the allowlist views.
- [ ] A plan with a 6th view, an unknown kind or a duplicate name is trimmed at `/plan` with a reason shown in the plan step.
- [ ] A person who may not add views on that project gets the project without them and a line saying why.
- [ ] Views are made by the same web route `project.setup` uses; no new write path.
- [ ] Server tests: schema, the hand-off to `carryOut`, a failed view not stopping the project. A web spec for the plan step listing views.
- [ ] Used once on the local build with a priced model before the slice is called done.

## Needs the owner

- **Money (T2-B):** a built-in agent on every workspace by default means server-key spend whenever anyone mentions it. Is it on by default for new workspaces, for existing ones through a migration, or opt-in from the AI settings? Default suggestion: on for new workspaces only, mention-only, inside the existing $50/day budget; existing workspaces get a one-click "Add the Workspace Guide".
- **No security loosening** in any slice: everything runs as the person through existing routes and checks.
