# Progress — 040 One stored form per id

## Checklist
- [x] Owner confirms the PRD, the canonical form (ObjectId) and the Phase 2 order — 2026-09-27 ("process")
- [x] Phase 1.1 `taskMongo/internals.js:159` aggregate match on the raw string — #1057 (522)
- [x] Phase 1.2 comments.taskId ObjectId-only filters — #1059 (524); more reads #1068 (534)
- [x] Phase 1.3 `$lookup` on `sprintArray.folderId` — #1060 (525)
- [x] Phase 1.4 projectSetting string-only matches on `sprintArray` — #1061 (527); relinks settle #1069 (535)
- [ ] Phase 2 field groups, one PR each (sprintArray first)

## Log
- 2026-09-26: Created from follow-up 124 at the owner's request. The survey of `origin/beta` at 6ae0b891 was done by a read-only research pass; the four Phase 1 paths were found in that survey and are not yet reproduced by tests.
- 2026-09-27: owner said "process" (PRD, ObjectId and the order confirmed).
- 2026-09-28: Phase 1 and 1b merged (builds 522–535), plus custom time reports for limited viewers (#1085, 546). Phase 2 uses a schema setter (`utils/mongo-handler/objectIdKeys.js`) instead of typed ObjectId paths, so the both-forms filters stay uncast: sprintArray ids `044-task-sprint-ids` (#1077, 536); milestone project ids `045` (#1082, 544); sprint placement repair `046` (#1086, 556); time records `047`/`048` (#1087 readers 550, #1089 writers 551). Still to do: project ids in history, notifications, mentions, projectRules, calls, userDashboard and the agent collections; customFields; task ids; the one-release removal of both-forms matching.
