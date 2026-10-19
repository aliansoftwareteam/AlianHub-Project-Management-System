# Progress: 053, industry demos with the dispatcher and workflows

## Checklist

- [x] Read task 052's seed, the dispatcher, the Company view, the workflow engine, templates and approvals
- [x] PRD (task.md)
- [x] Scenario data and validator
- [x] Build steps and adapter
- [x] Simulated marker on runs and steps; run page and approval chips
- [x] Guide and docs
- [x] Tests
- [x] Seeded on a real database
- [x] Checked in the browser

## Log

### 2026-10-17
- Task 052 is not committed yet; this branch starts from a snapshot commit of its worktree, to be rebased onto 052 once it lands.
- Found: the run page reads a `role_handoff` step as "Unknown step"; fixed here because every seeded run is made of them.
- Found: once the story's in-process automation engine is stopped, its inline queue keeps a driver with no handlers, so a workflow dispatched afterwards throws instead of ticking in process. The seed now returns the engine to its never-started state when the story ends.
- Workflow approvals live in **AI → Inbox → Approvals** (and Home's "Waiting on you"), not in the main Inbox's Approvals, which lists agent proposals; the guide says so.
- Seeded the four companies against the owner's demo database with `DISPATCHER=on WORKFLOW_ENGINE=on` and the four safety switches, under `demo.visitor@industries.demo.test` (`--owner`, as in 052), with `--reset`:
  - TechNova: 20 suggestions, 1 needing routing, 4 queued; 3 workflows (two templates off, its own on); run on SUP-2201 waits at "Pull the fix into this sprint" after the Support Agent and the Bug Triager.
  - FinEdge: 20 suggestions, 2 needing routing, 3 queued; run on INV-4523 waits at "Approve how the exception is settled".
  - SwiftLogix: 18 suggestions, 1 needing routing, 3 queued; run on SH-88231 waits at "Send the customer update".
  - PeopleFirst: 11 suggestions, 6 needing routing, 3 queued; run on Amara Nwosu waits at "Approve the offer".
- Read back through the app's own `orgChart` and `flowBoard` as the demo account: every role with its paused agent and the demo account as supervisor; per role, suggestions waiting and the accepted task queued. Each run is `running` and `simulated`, its finished hand-overs `simulated` with `finishedBy` the agent's name, the approval `pending`, owned by the demo account, due in seven days. The story's automation runs also became one-node workflow runs (the engine does that with the flag on), all `success`.
- Tests: `tests/demo-industries.test.js` 39 pass; the workflow and dispatcher backend files (230 tests) pass; `workflowRunView`, `workflowApprovalsInbox`, the Home "Waiting on you" specs and the banner spec pass; `i18n:check` and `style:check` pass. The convention suite fails 26 tests and `homeInboxDocsPolish.spec.js` 2, the same on the main checkout (Windows paths and line endings, CSS in jsdom).
- Browser check on a local build (port 4100, both flags on, the four safety switches; the 052 session's server holds 4000), signed in as the demo account, in TechNova:
  - **AI → Company view**: the org chart (IT company: Engineering with Bug Triager, Incident Scribe, Release Manager, Tech Lead; Support with Support Agent; each agent Paused, supervised by the demo account) and the flow board (Needs routing: SUP-2193; per role, waiting for a lead and in queue).
  - **AI → Inbox → Approvals**: "Pull the fix into this sprint", Simulated, due in 7 days; the detail shows the prompt, the owner and the chip; its lineage and run page show "Hand to a role · Succeeded · Simulated · Finished by Support Agent / Bug Triager", the approval pending, the Tech Lead step not started.
  - Approving it applied for real: the approval `approved`, the run moved on and SUP-2201 appeared in the Tech Lead's queue on the flow board. The browser's request stayed open: the local server's inline queue awaits the next hand-over's delayed re-checks (documented; a follow-up for the driver).
  - Home "Waiting on you": the long run name truncated the Simulated chip out of view; the name now truncates on its own and the chip stays visible (checked after a rebuild).
  - The Start-here guide renders "Who routes the work" as a table and the "Workflows" section with the run and where it waits.
- With both flags off (PeopleFirst, real database): the company builds, the command says each part is off, no dispatcher settings, decisions, workflow rows or guide sections are written, the marker records `layers: { dispatcher: false, workflows: false }`, and a later plain run with the flags on says `--reset` adds them. Rebuilt with the flags on afterwards.
- TechNova and FinEdge rebuilt afterwards (`--reset --only technova,finedge`) so TechNova's approval waits again and both guides carry the final wording; a plain second run creates nothing.

### 2026-10-19
- Merged into `staging` in [#1696](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/1696) (build 7, `14.40.0-beta.7`), together with tasks 052 and 054; the beta log records the build in the follow-up docs PR.

## Last step

Done. The demo shows these parts on an instance with `DISPATCHER=on` and `WORKFLOW_ENGINE=on`.
