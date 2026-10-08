# Cloud session briefs (2026-10-01)

Paste one brief into one new cloud session opened on this repository. Each is self-contained. This file is a working note and is not committed.

## Rules every brief relies on (already included in each)

- Repository: `aliansoftwareteam/AlianHub-Project-Management-System`. Work on a new branch from `origin/beta`. Pull requests target `beta`, never `main`.
- Read `CLAUDE.md` first: minimal comments, every user-visible string through i18n (`frontend/src/locales/en.js`, then `npm run i18n:backfill` and `npm run i18n:check`), Conventional Commit titles.
- Stored fields must be declared in `utils/mongo-handler/schema.js`; every query is company-scoped; use the `SCHEMA_TYPE` enum.
- UI uses design tokens only (`var(--surface)`, `--ink`, `--ink-2`, `--brand`, …); no hex colours.
- Do not merge the pull request. Report the PR link, what was tested, and what was not verified by eye.
- Do not touch anything about access rules or security beyond what the brief names.

---

## Brief 1: a goal's AI summary, made on request

```
You are working on AlianHub (Express + MongoDB + Vue 3). Read CLAUDE.md first and follow its hard rules.
Branch `feat/goal-summary-on-request` from `origin/beta`; the pull request targets `beta`.

Build: a "Summarise" button on a goal's panel (frontend/src/views/Goals/GoalPanel.vue) that asks the
server for a short written summary of the goal's progress, shown under the progress bar.

Rules:
- The summary is built ONLY from the goal's name, dates, targets and their numbers. Never from the
  names of the lists or tasks a target counts (those differ per viewer), so one stored summary is
  safe for every reader of the goal.
- It is made only when a person presses the button: no model call on open, on poll, or on a socket
  event. Store it on the goal with a hash of its inputs and the time; show "from <time>" and offer
  "Regenerate" when the inputs have changed since. Declare the stored fields in
  utils/mongo-handler/schema.js.
- Follow the existing pattern for kept AI values: Modules/AI/taskAiValues.js, taskSummary.js and
  Modules/AI/withTimeout.js. Book the spend to the AI budget the way
  tests/ai-task-category-spend.test.js expects (a ledger row with feature, workspace and user; refuse
  with `ai_budget_exhausted` before calling the model when the budget is spent).
- Access: whoever can read the goal may read its summary; whoever can edit the goal may generate one
  (reuse Modules/Goals/helpers/goalAccess.js). A goal the caller cannot read answers as a missing one.
- When no AI provider is configured, the button is not shown.
- New route under the existing /api/v2/goals prefix; run tests/conventions/v2-guard.test.js and
  route-guard-coverage.test.js.

Tests: server tests for access (owner, a named reader, a member who cannot read, a guest), for
"no model call on read", the stale marker, the budget refusal, and that the prompt holds no source
names; frontend specs for the button, the stale state and the hidden state. Run the full backend and
frontend suites before pushing.
Do not merge. Report the PR link, what you tested, and what you could not see in a browser.
```

## Brief 2: totals per group in the Table view

```
You are working on AlianHub (Express + MongoDB + Vue 3). Read CLAUDE.md first and follow its hard rules.
Branch `feat/table-group-totals` from `origin/beta`; the pull request targets `beta`.

The List view already ends each group with a "Total" row that sums number and money custom fields
and story points for the whole group, even when only part of the group is loaded
(frontend/src/views/Projects/composables/groupTotals.js and the group-counts query in
frontend/src/store/ProjectData/taskQueries.js; server test tests/list-group-totals-query.test.js).
The Table view (frontend/src/views/Projects/TableView/) only adds story points over loaded rows.

Build: the same Total row in the Table, per group, under each shown number or money column
(formula and rollup fields that produce a number included), using the SAME composable and the same
server query, so the two views can never disagree. Money shows the field's symbol. Subtasks are left
out, as in the List. Sum only.

Constraints:
- Do not change the server query's access rules: totals must come from the same match the rows use,
  under the caller's own visibility.
- Another open pull request (#1347) adds a small "home list" mark to Table rows: keep your edits to
  the group footer and the totals wiring so the two merge cleanly.
- The row uses design tokens and follows the density setting like the rest of the Table.

Tests: specs for a fully loaded group, a partly loaded group, a group with no number column (no row),
money formatting, and that List and Table show the same total for the same data. Run the full
frontend suite and the related backend test before pushing.
Do not merge. Report the PR link, what you tested, and what you could not see in a browser.
```

## Brief 3: end-to-end tests, second batch

```
You are working on AlianHub (Express + MongoDB + Vue 3). Read CLAUDE.md first.
Check whether pull requests #1323 and #1346 are merged (`gh pr view <n> --json state`).
If #1323 is merged, branch `test/e2e-core-flows-2` from `origin/beta`; if not, branch from
`origin/test/e2e-core-flows-1` and say in your PR that #1323 must merge first. The pull request
targets `beta`.

Read docs/E2E-FLOWS.md (the 30 most-used flows and which are covered), docs/TESTING-E2E.md,
e2e/support/ (test.js, pages.js, fixtures.js, consoleGuard.js) and the three flows-*.spec.js files.

Add browser tests, in the same style, for the flows still marked "not yet" or "partly", in this order:
1. Archive a task and restore it (toolbar More, Show Archive, row menu Restore).
2. Inbox: open a notification (seed one the way inbox-triage.spec.js does).
3. Invite a member: assert the pending row only; no email is sent in CI.
4. Theme and look on /settings/my-profile (radiogroups "Theme" and "Look"), and the accent colour.
5. Create a list, a folder and a subfolder; move a list into a folder from the list's own menu.
6. Move a task to another list; duplicate a project.
7. Everything view: filter, group, switch to Board.
8. Then as many as fit of: edit a description, attach a file, drag a Board card, edit a Table cell,
   log time and see it in the timesheet, create a doc and see it save by itself, reply in a chat thread,
   add a custom field with only a name.
Each test is independent, creates what it needs under a unique name, and runs in under about 30
seconds. Prefer roles and accessible names over CSS classes; where a control has no accessible name,
add one through i18n rather than selecting by class.

If #1346 is merged: remove the three `skipConsoleGuard` calls (projects.spec.js, task-navigation.spec.js,
tasks.spec.js) and the `/api/v2/workflows/approvals` entry from the console guard's allowlist, and
confirm those tests pass with the guard on.

Update docs/E2E-FLOWS.md with the new coverage counts. Do not weaken an existing assertion.
Run the e2e suite in your environment if it has a database; otherwise push and read the `e2e` job's
result on your pull request, fixing until it is green.
Do not merge. Report the PR link, the flow counts before and after, and every product bug the tests found.
```

## Brief 4: a scheduled check that tests do not depend on the date

```
You are working on AlianHub (Express + MongoDB + Vue 3). Read CLAUDE.md first.
Branch `ci/tests-with-a-moved-clock` from `origin/beta`; the pull request targets `beta`.

Twice this week a test started failing on every branch because the code under test reads the real
clock while the test's data used fixed dates near today (tests/chat-threads.test.js and
tests/ai-ask-structured.test.js, both fixed). Reading test files cannot catch this, because the clock
is read by the handler, not the test. The reliable guard is to run the suites with the clock moved
forward.

Build:
1. A small preload module, e.g. tests/support/shift-clock.js, that moves `Date` (constructor with no
   arguments, `Date.now`) forward by the number of days in an environment variable, leaving explicit
   dates untouched and leaving timers alone. Unit-test it.
2. A jest config or CLI wiring that loads it for the unit project, and the same for the frontend's
   vitest (a setup file).
3. A new workflow, .github/workflows/clock.yml, that runs on a weekly schedule and on demand
   (`workflow_dispatch`), NOT on pull requests: the backend unit suite and the frontend unit suite
   with the clock moved by +3, +40 and +400 days (a matrix). Split the backend run into two shards:
   one in-band process over all 780+ files runs out of memory. Tests that fail only because a TLS
   certificate looks expired under a moved clock go on a short, commented skip list.
4. When a run fails, the job summary names each failing test and the offset.
5. One paragraph in docs/DEVELOPER-GUIDE.md on what the job is and how to run one offset locally.

Do not change any product code. If the moved clock finds a failing test today, fix the test so it
owns its clock (pin both sides, or the file's existing fake-timer helper) in the same pull request and
list it in your report.
Do not merge. Report the PR link, what each offset found, and the run time of each matrix job.
```
