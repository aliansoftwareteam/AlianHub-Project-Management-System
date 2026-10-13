# Live API / MCP sweep (agent F, 2026-09-04) — summary

PASS: registry/spend/team/routable/pipeline/release/runs-summary/policy/account shapes; 401 without auth or companyid; agent create/update/pause/resume with DB rows; runs refused without a task, with a bad agent, unknown task, or schedule below L3; qa-review / brief.parse / digest.ceo / risk.today / pr.summary / risk.flags all reach waiting_approval with spend recorded; approve applies 6/6 with agent-attributed comments and subtasks and closes the run; double approve → 409; decline; undo within the window reverts everything with audit rows; L2 acts directly; PAT refused on token routes; pause-all stops open runs and blocks new ones; MCP tools/list = 11 and every tool behaves (status.set refuses To Do/Done with audit rows; task.link validates URLs; timelog start/stop; unknown tool -32601; bad token 401); policy PUT validated.

Defects (ranked) — queued for the backend fix agent after workstream H lands:
F1. Manual/API runs skip finding memory → repeat qa-review re-files the same 5 subtasks (findingMemory only wired in Automations/engine/actions/runAgent.js:45-53, not Agents/runs.js:149-186).
F2. MCP with a plain PAT (scripts/issue-api-token.js, no kind:'agent') is attributed as human: Mcp/server.js:34 → actor.js:17 needs kind:'agent'; the req.mcp marker at actor.js:45 is never set → audit actorType human, actorName "", viaAccount null; comments/timesheets unmarked.
F3. docs.read returns text:"" — Mcp/tools.js:150 reads plainText||html; pages store content.html / rawText.
F4. L2 run fails wholesale on an action outside allowedActions (runs.js:163-167 decides mayAct from autonomy only; perform throws RefusedError) instead of dropping that action with a reason.
F5. Double audit rows per agent action (Automations/engine/tools.js:71,118 automation.task.* + agent.action) → 12 rows for 6 actions on GET /runs/:id.
F6. PUT agents/:id {autonomy:9} silently clamped to 3 (controller.js:54) — should be 400.
F7. pause-all (runs.js:136) stops waiting_approval runs but leaves proposals pending; a later approve re-marks the run done — pause-all should only stop running runs.
(Also confirms #7 of the static review: stopped run overwritten to waiting_approval with a live proposal and spend recorded.)

Skipped: member-level guard checks (company has no real member with a userId).
Cleanup: 22 test tasks trashed; test agent left paused ("agent-f sweep finished"); its token revoked.
