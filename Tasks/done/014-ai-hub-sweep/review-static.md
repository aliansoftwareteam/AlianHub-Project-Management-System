# Static review of the AI hub (agent G, 2026-09-04) — ranked defects

HIGH
1. Rule-triggered agent runs bypass every agent control — Modules/Automations/engine/actions/runAgent.js:23-35 calls orchestrator.run directly: no agent record, no runs.canStart (paused / pause-all / spend cap ignored), no run row, no recordSpend, no registry perform (no audit/undo). Fix: route through runs.create → runs.executeSkill for a named agent, or refuse when every agent is paused.
2. "Run now" on every agent card always fails — frontend/src/views/Ai/useAgents.js:115 posts {agentId, trigger} only; Modules/Agents/controller.js:215-218 rejects runs without taskId; AiHub.vue:51. Fix: task picker that calls startRun with a taskId (or remove the button).
3. API refusal reasons never reach the UI — frontend/src/services/index.js:179-199 rejects on non-2xx, so res?.data?.statusText in useAgents.js:78,116,126 and useParity.js:30,37 is dead; users see "Request failed with status code 409" instead of "Agent is paused", "Spend cap reached", "already approved", "undo window has closed" (controller.js:207,213,237,275). Fix: read error.response?.data?.statusText as useAccounts.js:22 does.
4. AI Inbox counts and tabs read fields the API never sends — AiInbox.vue:123-125,188,190, useAgents.js:32, AiSidebar.vue:45 read counts.pending/approved; Modules/Agents/proposals.js:283 sends waiting/doneByAi/declined/undone. switchBucket('done'|'declined') (AiInbox.vue:156) sends bucket=done but bucketOf (proposals.js:61-65) only yields primary|later for pending rows, so Done/Declined tabs are always empty. Fix: map keys; filter by status for those tabs.
5. Proposal approve/decline not atomic — proposals.js:100-129 checks status at 101-103 and writes at 129 after the perform loop; concurrent approves apply twice. Fix: findOneAndUpdate({_id, status:'pending'}, {$set:{status:'applying'}}) before performing.
6. Assigning a person in the teammate picker does nothing — AgentTeammates.vue:233-236 toasts without an API call. Fix: call the task assignee endpoint or hide people.

MEDIUM
7. Stopped runs get resurrected — runs.js:181,155,171,185 write waiting_approval/done/failed unconditionally after executeSkill even if stop/pauseAll set stopped; proposal still filed for a paused agent. No reaper: a restart mid-setImmediate (controller.js:223) leaves runs running forever. Fix: re-read status and bail unless running; reaper at boot marks stale running → failed.
8. Schedule and rate limit stored but never enforced — controller.js:58-59 persists schedule/rateLimitPerDay; nothing schedules or counts; AgentSettings.vue:54-63, AiHub.vue:119-125 promise it. Fix: hide the fields until implemented (or implement rateLimitPerDay in canStart).
9. Approval bypasses allowedActions — proposals.js:121 calls actions.perform without allowedActions (runs.js:167 passes them). Fix: pass the agent's allowedActions.
10. Skipped runs count as clean successes — runs.js:155 marks skipped (no URL / no PR link / brief too short; orchestrator.js:134-141, skills/prReview.js:28, briefParse.js:21) as done, inflating agentFit.js:110-111; only AgentOutcomes.vue shows the reason; the wizard never states requirements. Fix: distinct `skipped` status; requirement line per skill in the wizard/picker.
11. Routing rule sentence breaks on object skills — AgentRouting.vue:184-185 String(skill) on {key,name} → "[object Object]"; sentence hardcoded English.
12. Skill Library CLI command omits ?companyId= — SkillLibrary.vue:70 (Mcp/server.js:26-27 needs it); AiAccounts.vue:472 is right.
13. Task panel agent strip never fed — TaskAgentStrip.vue only rendered via TaskDetailPanel.vue:55 from an agentRun prop no parent supplies; run.onStop never provided.
14. Picker options ignored — AgentPicker.vue:105-106 emits notifyMe/stopOverCap; AgentTeammates.vue:231 drops them; "$2" cap hardcoded.
15. No way to delete an agent — no DELETE route; "Stop agent" only pauses.

LOW
16. Silent failures: useAgents.setPaused/pauseAll (:82-90), AiHub.vue:53, AgentSettings.vue:177-186, AiSidebar.vue:62-65, AgentLiveStrip.vue:106-114 have no error handling.
17. AgentSettings.vue:81 reads run.refusals.length; runs.js:53 stores a number.
18. AiHub.vue:127-131 / en.js "Today" but /agents/spend is month-to-date (controller.js:146-153).
19. L4 "Lifecycle" shown in the ladder (useAgents.js:11) but controller.js:54 clamps autonomy to 3.
20. Inbox.vue:561 "Review in AI inbox" routes to AiHub, not AiInbox.
21. Accounts: token expiry never set/shown (useAccounts.js:115-124, AiAccounts.vue:492-498); revoke errors only visible while minting (AiAccounts.vue:252,646); policy.requireCheckBeforeDone has no UI; antigravity/cursor/codex commands are invented syntax (AiAccounts.vue:486-488); pre-mint URL uses window.location.origin, minted uses APIURL.
22. i18n: hardcoded "AGENT" chip (TaskAgentStrip.vue:5, Inbox.vue:113); English reasons in agentFit.js:139-158,240; fallback strings in useAgents.js:78,116,126, useParity.js:30,37.
23. Missing states: no load-error state on AiInbox, SkillLibrary, AgentTeammates, AgentRouting, AiPipeline, AiRelease (AiRelease.vue:176-180 renders zeros); no loading state on SkillLibrary, AgentTeammates, AiAccounts.
24. Gate mismatch: any member sees Approve on owner/admin-gated proposals (AiInbox.vue:85), refused at proposals.js:104; any member can create/edit/pause agents and pause-all (controller.js:77-139) — product decision.

Browser sweep additions (findings-browser.md): the router picked Code Reviewer for 6/8 tasks including ones without a PR link and "0 left for a person" — agentFit should refuse tasks that lack the skill's input (PR link for pr.*, public URL for qa-review, a brief for brief.parse) instead of assigning them.

Verified fine: tenant scoping in Modules/Agents and Modules/Mcp; undo window server-side; approve/decline close the run; pause stops open runs; NEVER list / mayActDirectly / MCP→registry mapping; humanActor refuses agent tokens on mutating routes; setPolicy owner/admin only; Accounts endpoints match.
