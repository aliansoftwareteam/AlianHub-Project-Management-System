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

### 2026-09-03 (the loop closed)
The project now runs itself from inside AlianHub. Work is pulled through the MCP server
we built, not from notes.

- Minted a scoped personal token via `POST /api/v2/api-tokens/mcp` — a route that had a
  controller but no registration until today, so the mint was unreachable.
- Handshook `POST /mcp` (protocol 2025-06-18, ten tools), pulled the backlog with
  `tasks.search`, and read AR-9 with `task.get`, which returned a brief — goal, sprint,
  acceptance criteria, relations, thread digest and the `youMayNot` boundary — not a row.
- `task.status.set("Done")` was refused over the wire with an audit id, exactly as the
  registry specifies. The boundary holds in production paths, not only in unit tests.
- All status moves and review comments since have gone through MCP, so every one is audited.

Nine handoff screens built (27a–27d, 28a, 28c, 29b, 25e, 24d) and eight functional gaps
filed as real tasks in the right sprints. Six of the eight are built and In Review.

Board at last check: 17 In Review, 1 To Do (gap-7, the HTTP 200-on-failure convention,
which needs a product decision).

**gap-9 (AR-26) filed and fixed from a re-test.** The Home checklist "Create project" CTA I once
wrongly called broken was re-tested live and works; the same pass found two steps (`board`,
`notifications`) that were real dead buttons. Filed through the app's own List quick-add — MCP has
no `task.create`, only `subtask.create`, which is a gap in the agent surface worth its own row —
then commented and moved to In Review over MCP so it is audited like the rest.

**Two non-findings, recorded so nobody chases them:** Enter in the quick-add row looked dead and
"Try the Board view" looked unclickable; both were the browser tool failing to deliver events
(no keydown reached a focused input; a click landed on a Planner sheet that had opened over the
checklist). Instrumenting with capture listeners before concluding is what separated the one real
bug from the two false ones — the third time this session that habit prevented a wrong report.

**A bug found in MCP by using it:** `status` was returned as the stored
`{text, key, type}` object while the tool description promised a string, so an agent
reading it got an object. Fixed.

**Correction worth recording:** gap-3 was moved to In Progress and then not dispatched
for a while — I built gap-6 and gap-8 myself, sent two agents out, and that one fell
through the gap. Caught on a board read, not by anything automated. A task sitting In
Progress with nothing behind it is exactly the failure this dogfooding was meant to
surface, and it surfaced.
