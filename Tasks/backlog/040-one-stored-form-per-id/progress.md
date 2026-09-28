# Progress — 040 One stored form per id

## Checklist
- [ ] Owner confirms the PRD, the canonical form (ObjectId) and the Phase 2 order
- [ ] Phase 1.1 `taskMongo/internals.js:159` aggregate match on the raw string
- [ ] Phase 1.2 comments.taskId ObjectId-only filters
- [ ] Phase 1.3 `$lookup` on `sprintArray.folderId`
- [ ] Phase 1.4 projectSetting string-only matches on `sprintArray`
- [ ] Phase 2 field groups, one PR each (sprintArray first)

## Log
- 2026-09-26: Created from follow-up 124 at the owner's request. The survey of `origin/beta` at 6ae0b891 was done by a read-only research pass; the four Phase 1 paths were found in that survey and are not yet reproduced by tests.
