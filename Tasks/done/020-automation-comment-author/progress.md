# Progress: Automation comments show as Ghost User

## Checklist
- [x] Decide: prefix-aware author rendering, with the rule name stored on the row
- [x] Comment list shows the rule name and an automation icon
- [x] Notifications show the same (rule comments send none; nothing to change)
- [x] The `agent` actor renders as the agent (already done before this task was picked up)
- [x] Test

## Last step
Done.

## Blockers
None.

## Log

### 2026-09-10
- Task created from the open note in 005-automation-engine-foundation when that task closed.

### 2026-09-26
- Rule comments now store `actorType: "automation"` and `automationName` (the rule's name) beside `userId: "automation:<ruleId>"`.
- The comment list renders them with the rule name, a gear avatar and an AUTOMATION chip; older rows without a name read "An automation". Replies quoting a rule comment do the same.
- Agent comments already rendered as the agent (`agentAuthorOf`), so that half needed no change.
