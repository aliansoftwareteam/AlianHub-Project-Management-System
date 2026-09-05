# 015 — API contract (agreed before build; every workstream builds to this)

All routes under `/api/v1/ai/project/*` keep their existing auth (company from `companyid` header, user from JWT). Existing request fields keep working; new fields are additive.

## POST /clarify  (workstream A)
Request: `{ description, additionalRequirements?, briefId?, previousAnswers?: [{ id, question, answer, skipped, unknown }] }`
Response `data`:
```json
{
  "coverage": { "what_for_whom": "met|missing", "done_when": "met|missing", "existing": "met|missing", "constraints": "met|missing", "team": "met|missing" },
  "round": 1,
  "maxRounds": 2,
  "questions": [ { "id": "...", "point": "done_when", "question": "...", "type": "select_card|toggle_chips|segmented|text", "options": [...], "required": false, "allowUnknown": true, "hint": "..." } ],
  "understanding": "..."
}
```
Rules: ask only about `missing` points; ≤ 3 questions per round; round 2 only for points still missing; every question carries `allowUnknown: true` and the UI offers "I don't know yet" which posts `{ unknown: true }`.

## POST /brief  (workstream A, new)
Request: `{ description, additionalRequirements?, briefId?, answers: [{ id, point, question, answer, skipped, unknown }] }`
Response `data`:
```json
{
  "brief": {
    "sections": { "what_for_whom": "...", "done_when": "...", "existing": "...", "constraints": "...", "team": "..." },
    "assumptions": [ { "point": "constraints", "text": "No launch date given; planning for a 6-week first release." } ],
    "markdown": "## What and for whom\n...\n## Assumptions\n- ..."
  },
  "coverage": { ...same shape as /clarify... }
}
```
Every skipped or unknown answer produces one assumption. `markdown` is what the user edits and approves.

## POST /plan  (A adds input; C adds output)
Request adds: `{ approvedBrief: "<markdown>", assumptions: [...] }`. When `approvedBrief` is present the plan prompt uses it as the brief and ignores `description`/`briefText`.
Response: each task (and subtask) gains
```json
"split": { "label": "agent|agent-after|person", "skill": "qa-review|pr.summary|brief.parse|...|null", "reason": "...", "need": "public_url|pr_link|brief|project_task|null" }
```
and the plan gains `"splitSummary": { "agent": 0, "agentAfter": 0, "person": 0 }` and echoes `"assumptions": [...]`.
Label rules (server module `Modules/Agents/taskSplit.js`, shared with the router): `agent` when a workspace agent has a skill whose input the task already carries; `agent-after` when a skill matches but its input is missing (`need` says what); `person` otherwise, or when the work kind is a human decision / conversation.

## POST /guide  (workstream C, new)
Request: `{ approvedBrief, assumptions, plan? }`
Response `data`:
```json
{ "guide": { "stages": [ { "name": "...", "goal": "..." } ], "essentials": [ "..." ], "escalations": [ "..." ], "style": "...", "markdown": "..." } }
```
Domain-agnostic: stages come from the brief, never from a fixed list.

## POST /execute  (C adds)
Request adds: `{ approvedBrief, assumptions, guide }`.
Effects: project description block = approved brief + assumptions; `guide` stored on the project (`aiGuide` field); a Guide agent created for the project (name "<Project> Guide", skill `project.guide`, autonomy **1**, allowedActions read + `task.comment`, `projectIds: [projectId]`, trigger mention); tasks labelled `agent` queued through `runs.create` → `executeSkill` under the workspace's controls (paused / capped ⇒ not queued, reason returned); tasks labelled `person` get the plan's assignee and a due date inside their sprint.
Response adds: `{ guideAgentId, runsQueued: n, runsRefused: [ { taskId, reason } ] }`.

## Skill `project.guide`  (workstream C)
Mention trigger on a task in the project → answers with the clearest next step from the stored guide and the plan; may propose next tasks through the normal proposal flow (L1). Never acts outside `projectIds`.

## UI states  (workstream UI)
Step order: Describe → Clarify (0–2 rounds, or skipped when coverage is all met) → Brief (draft shown beside the original; edit; **Approve brief** enables Generate plan) → Plan (split badge per task, summary line "N tasks an agent can start · M need a person · K need a person first", assumptions list, guide preview) → Create.
Locale namespace: `AiProject.*` in `frontend/src/locales/en.js` only; do not run the backfill (the integrator runs it once at merge).
