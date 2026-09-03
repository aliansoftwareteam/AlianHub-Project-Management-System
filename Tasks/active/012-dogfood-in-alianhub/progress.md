# Progress: Dogfood the redesign in AlianHub

## Checklist
- [x] Wait for task 009 agents to land; build + tests green on a quiet tree
- [x] Create the "AlianHub Redesign" project through the UI
- [x] Five sprints, one per handoff stage
- [x] Load the backlog: 9 not-started screens, each titled with its option id
- [ ] Use it for real; log friction below
- [ ] Raise blocking gaps as their own tasks

## Last step
Queued 2026-09-03. Coverage map captured and verified.

## Blockers
None. The dev server cannot stay up while agents are editing `Modules/` — nodemon restarts on every save.

## Friction & product gaps found by using it
**1. Project creation was broken in this workspace, and took the Personal List with it.**
The `settings` collection has no `task_type` document. `createProject` guarded that in one place (`taskTypeData[0]?.totalStatus`) but dereferenced it unguarded two lines later (`taskTypeData[0].settings.find`), so every "New project" click and every `getOrCreatePersonalProject` died with "Cannot read properties of undefined (reading 'settings')". Fixed: all six settings reads now go through one guard.

**2. The real error was swallowed.** The catch reported `error in getting template with category` for any failure in the merge — pointing debugging at templates when the cause was a missing settings document. Fixed: the catch now reports the actual message and logs the stack.

**3. A missing settings document silently produced null keys.** With the crash fixed, the project created but no task could be added to it: the key counter was seeded from `taskTypeData[0]?.totalStatus`, so `undefined += 1` gave `NaN`, stored as `null`, and the schema needs a Number. Fixed with a `totalOf` seed that falls back to 0. This one only appeared *because* the first fix removed the crash hiding it.

**4. "Include the sample tasks" did nothing — my own regression.** Two seeding paths were merged in PR #524: one gated on the checkbox, one that always seeded a built-in template's examples. Keeping the second dropped the opt-out, so unchecking the box still produced 8 sample tasks. Fixed: an explicit `false` now returns before the fallback, and the flag is passed to the seeder (it was being deleted from the payload before seeding ran).

**5. Failures return HTTP 200** with `{status:false}` in the body. Anything watching status codes would never see a failed project creation. Not changed — the frontend reads the `status` field and altering it risks other callers — but worth a decision.

All four fixes carry regression tests in `tests/create-project-settings.test.js`.

## Log

### 2026-09-03
- Task queued at the user's request, after the coverage map showed 61 built / 42 in flight / 9 not started / 2 cut / 15 with no screen.
- Correction worth recording: an earlier attempt to create a project through the UI appeared to show a dead "Create project" button on the Home checklist. That was not a product bug — the API had crashed on a stale merge-conflict fatal, and concurrent agent edits were restarting nodemon continuously. Re-test this flow for real when the instance is stable before concluding anything about it.
