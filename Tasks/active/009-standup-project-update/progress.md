# Progress: Standup / project update from real task history

## Checklist
- [x] Evaluate existing compose rail, Ask pack, and task/comment history
- [x] Add `standup` compose action, window filter, and grouped briefing
- [x] Hide control until a project is selected
- [x] Tests: window, permission pack, invented ids, project gate
- [ ] Draft stacked PR; tests green

## Last step
Standup compose action implemented. Page tests 65/65 passing; frontend build succeeded.

## Blockers
None.

## Log

### 2026-08-27
- Task created. Smallest reuse is a compose `standup` action (same pattern as transcript), not a second endpoint or AI stack.
- Implemented `pageStandup.js` + `gatherStandupContext`, rail chip gated on `projectId`, 24h/7d windows, grouped kiln briefing with `apply: false`.
- Jest: page-standup + page-standup-gather + page-transcript + page-content + page-rules + alian-mention = 65 passed. Frontend `npm run build` succeeded.
