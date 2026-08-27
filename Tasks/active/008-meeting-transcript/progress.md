# Progress: Meeting transcript to summary, action items, and linked tasks

## Checklist
- [ ] Investigate Pages compose, `/api/v2/pages/ai`, page-to-tasks, Ask
- [ ] Backend: transcript action, parse action items, drop invented ids, clamp output
- [ ] Compose rail: paste path, kiln briefing, project-gated turn into tasks
- [ ] Tests and frontend build
- [ ] Stacked draft PR

## Last step
Implementation on `feat/meeting-transcript-ee23`: compose-rail Transcript action, `apply: false` briefing, project-gated Turn into tasks.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Decision: add a `transcript` compose action to the existing Pages AI endpoint rather than a second AI stack or a dedicated transcript route. Ask already uses `apply: false`; transcript follows that path and seeds `AiTaskCreator` with `requirementsText`.
- Backend: `pageTranscript.js` parses action items, drops invented pack ids, clamps gpt-4o output to 4096 tokens, and gathers permission-aware pages/tasks via `gatherWorkspaceAskContext`.
- UI: Transcript chip + paste textarea on `PageComposeRail`; kiln briefing; Turn into tasks hidden until `taskProjectId` is set.
