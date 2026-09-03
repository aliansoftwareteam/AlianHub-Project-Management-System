# Progress: Dogfood the redesign in AlianHub

## Checklist
- [ ] Wait for task 009 agents to land; build + tests green on a quiet tree
- [ ] Create the "AlianHub Redesign" project through the UI
- [ ] Five sprints, one per handoff stage
- [ ] Load the backlog from coverage.md with option ids as task keys
- [ ] Use it for real; log friction below
- [ ] Raise blocking gaps as their own tasks

## Last step
Queued 2026-09-03. Coverage map captured and verified.

## Blockers
Waiting on task 009. The dev server cannot stay up while agents are editing `Modules/` — nodemon restarts on every save.

## Friction & product gaps found by using it
_(nothing yet — this is the deliverable)_

## Log

### 2026-09-03
- Task queued at the user's request, after the coverage map showed 61 built / 42 in flight / 9 not started / 2 cut / 15 with no screen.
- Correction worth recording: an earlier attempt to create a project through the UI appeared to show a dead "Create project" button on the Home checklist. That was not a product bug — the API had crashed on a stale merge-conflict fatal, and concurrent agent edits were restarting nodemon continuously. Re-test this flow for real when the instance is stable before concluding anything about it.
