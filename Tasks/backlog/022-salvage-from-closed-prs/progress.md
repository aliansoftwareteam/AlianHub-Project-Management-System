# Progress: Pieces worth porting from the closed pre-redesign PRs

## Checklist
- [x] #442 chunk recovery (`chunkRecovery.js` + `main.js` hook): test f5b32ddb, code 5e29c3f4
- [ ] #523 per-task recurrence + Gantt FS collision hint, rebuilt on RecurringTasks / GanttView
  - [x] Gantt FS collision hint: test c527c72b, code 903b85a9
  - [ ] per-task due-date recurrence: declined for now, see 2026-09-23
- [ ] #519 windowed standup grouping as a Reporter skill option: declined for now
- [ ] #520 / #522 preview-then-apply custom-field autofill, re-skinned: declined for now
- [ ] #517 Project Guide mentionable from CommentInput: declined for now
- [ ] #389 dev-agent pairing runner: declined for now
- [ ] #220 Docker Hub credential auto-detect: declined for now
- [ ] #206 Upwork proposal review: declined for now
- [ ] #515 / #516 Workspace Ask, page-to-tasks, citation chips: declined for now

## Last step
2026-09-23: re-checked every piece against beta and ported the two small ones on
`feat/salvage-closed-pr-pieces`.

## Blockers
None. Each remaining item needs a product call or is too large to port as a salvage.

## Log

### 2026-09-23
Re-checked each piece against `origin/beta` (code read, `git log -S`, source PR):

| Piece | Still missing on beta? | Size | Risk | Outcome |
|---|---|---|---|---|
| #442 chunk recovery | Yes: no `router.onError`, `errorHandler` or `unhandledrejection` handling | ~70 lines + 2 in `main.js` | Low | Ported |
| #523 Gantt FS collision hint | Yes: beta's Gantt draws FS arrows and a critical path but never flags a successor that starts before its blocker is due | ~40 lines | Low, CSS class only | Ported |
| #523 per-task due-date recurrence | Yes: no `recurrence` / `maybeSpawnNextOnComplete` | ~450 lines incl. a task schema field, a `permissionGuard` change and a task-complete hook | Medium: new task field, spawns tasks on completion | Declined: too large, touches the task schema and permissions; needs a product call against RecurringTasks |
| #519 windowed standup grouping | Yes: Reporter (`digest.ceo`) only knows "moved in 24h"; `team.standup` is board-based | ~380-line helper plus a new reader option in the skill vocabulary | Medium | Declined: needs a decision on how a window is exposed on the skill |
| #520 / #522 custom-field autofill | Yes | ~1,600 lines (helpers of 577 and 395 lines, kiln UI) | Medium: AI writes task fields | Declined: too large, UI needs a re-skin |
| #517 @Alian / Project Guide mentions | Partly: `mention` is a declared agent trigger, but CommentInput only offers users | ~800 lines in the source PR | Medium: starting agent runs from comments has spend and permission implications | Declined: needs a product call on which agents are mentionable and who pays |
| #389 dev-agent pairing runner | Yes | +6,329 lines | High: server-brokered runner on a developer machine | Declined |
| #220 Docker Hub auto-detect | Yes: `docker.yml` still carries the commented Docker Hub lines | ~50 lines, but `docker.yml` has since moved to per-arch builds plus a manifest merge job | Registry credentials, publishing | Declined: no Docker Hub account yet, needs rework for the merge job, testable only in CI |
| #206 Upwork proposal review | Yes | +1,203 lines | Medium | Declined: separate product |
| #515 / #516 Workspace Ask, page-to-tasks, citation chips | Yes: no Workspace Ask or citation chips on beta | +2,095 and +506 lines | Medium | Declined: too large, kiln UI |

### 2026-09-10
- Task created after the owner closed PRs 515–523, 442, 389, 220, 206 and 32; the list records what has no equivalent on beta.
