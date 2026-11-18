# AI hub sweep — browser (owner, 1280px), 2026-09-04

| Screen / flow | Result | Evidence |
|---|---|---|
| /ai hub: agent cards, autonomy ladder | PASS | 4 seeded agents + spend/runs per card |
| New agent wizard (3 steps: job+template, actions, autonomy+cap) | PASS | "Sweep Intake" from Intake template, listed after Create |
| Run now from a card | FAIL (design) | always toasts "needs a task" — no task picker (useAgents.js:115 posts without taskId; controller.js:215 refuses) |
| Pause / Resume | PASS | POST pause/resume 200, card badge "Paused" |
| Agent detail: autonomy L2 + spend cap, Save | PASS | PUT 200; persisted after reload |
| AI Inbox: Waiting → Approve → Undo → Decline | PASS | approve/undo/decline 200, toasts Applied/Reverted/Declined |
| AI Inbox counts + Done by AI / Declined tabs | FAIL | counts stay 0 after actions (AiInbox reads counts.pending/approved, API sends waiting/doneByAi/declined; done/declined tabs filter by bucket) |
| Skill library | PASS (read) | registry table with risk/undoable; CLI snippet lacks ?companyId (SkillLibrary.vue:70) |
| Teammates page | PASS (read) | people + agents list; person assignment is a no-op (AgentTeammates.vue:233) |
| Routing: select 8 → Route → Assign 8 | PASS (works) / WEAK | 8 runs started (POST /agents/runs); router picked Code Reviewer for 6/8 incl. tasks with no PR; "0 left for a person" |
| Ask (GPT-4o) | PASS | cited answer listing AR-48, AR-53 |
| Pipeline / Release | PASS (read) | pipeline lists agent tasks; release shows "CI not connected", no notes |
| Accounts | PASS | linked personal account, tokens, policy, corrected CLI command |

DB evidence (last 40 min): 18 runs — Code Reviewer pr.summary "done" ×6 on tasks with no PR link (skips counted as done), 3 waiting_approval, Sweep Intake brief.parse failed ×1 (task without a brief), agent-f qa.review failed ×1; proposals approved 1 / undone 2 / declined 2 / pending 4; SPWC-15 has no comment after approve→undo (revert worked).
