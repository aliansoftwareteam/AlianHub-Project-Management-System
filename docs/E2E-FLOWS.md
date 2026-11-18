# The 30 most-used flows and their browser tests

What people do in AlianHub every day, and which Playwright spec in `e2e/specs/` proves each flow still works. This is the list behind "end-to-end tests for the 30 most-used flows" (task 046, track C3). How the suite runs is in [TESTING-E2E.md](TESTING-E2E.md).

- **Covered**: a spec drives the flow in the browser and checks the result on the server or after a reload.
- **Partly**: a spec covers a part of the flow; the line says which part is missing.
- **Not yet**: no browser spec. A spec that only opens the screen does not count.

Checked on 2026-10-02 against `beta` after build 766 and the third batch: 29 covered, 1 partly, 0 not yet. Before that batch: 23 covered, 4 partly, 3 not yet. Before the second batch: 12 covered, 3 partly, 15 not yet.

| # | Flow | Status | Spec |
|---|------|--------|------|
| 1 | Sign in with email and password | Covered | `smoke.spec.js` |
| 2 | Create a project | Covered | `flows-create-project.spec.js` (from Home and from Projects; a short name is refused; private) |
| 3 | Create a list, a folder and a subfolder, and move a list into a folder | Covered | `flows-project-structure.spec.js` |
| 4 | Create a task from the List | Covered | `flows-list.spec.js` |
| 5 | Edit a task from its List row: rename, assign, due date, priority | Covered | `flows-list.spec.js`, `list-inline-edit.spec.js` (assign) |
| 6 | Close a task from the List by changing its status | Covered | `list-inline-edit.spec.js` |
| 7 | Edit a task's description in the task panel | Covered | `flows-task-panel-more.spec.js` |
| 8 | Comment on a task and mention a teammate | Covered | `flows-task-panel.spec.js` |
| 9 | Add subtasks, down to three levels | Covered | `flows-task-panel.spec.js` |
| 10 | Attach a file to a task | Covered | `flows-task-panel-more.spec.js` |
| 11 | Drag a card to another column on the Board | Covered | `flows-board-table.spec.js` |
| 12 | Edit a cell in the Table | Covered | `flows-board-table.spec.js` (the status cell) |
| 13 | Filter, group and sort a view, and save it | Covered | `list-filters.spec.js` (filter, group, save), `flows-list-sort.spec.js` (sort, reset, save) |
| 14 | Select several tasks and change their status | Covered | `bulk-edit.spec.js`, `a11y.spec.js` |
| 15 | Move a task to another list | Covered | `flows-archive-move.spec.js` |
| 16 | Duplicate a task | Covered | `flows-list.spec.js` |
| 17 | Archive a task and restore it | Covered | `flows-archive-move.spec.js` |
| 18 | Delete a task and restore it from the Trash | Covered | `flows-list.spec.js` |
| 19 | Search from the command palette and open the result | Covered | `flows-workspace.spec.js` |
| 20 | Home and My work | Covered | `smoke.spec.js` (Home opens after sign-in), `flows-my-work.spec.js` (add, tick off, Done, Delegated, sort) |
| 21 | Open a notification from the Inbox | Covered | `flows-inbox-settings.spec.js`, `inbox-triage.spec.js` (keyboard triage) |
| 22 | Log time on a task and see it in the timesheet | Covered | `flows-time-docs.spec.js` |
| 23 | A doc: create, edit, comment, version history | Covered | `flows-time-docs.spec.js` (create, title saved by itself), `flows-docs-more.spec.js` (body, comments, reply, resolve, versions, restore) |
| 24 | Chat: send a message and reply in a thread | Partly | `flows-chat-channel.spec.js` (new channel, message, thread reply). The first message of a new direct conversation is not covered: `flows-chat.spec.js` is `test.fixme` because the first message is refused with a 404 from `POST /api/v1/comments` |
| 25 | Everything: find a task across projects and open it | Covered | `flows-workspace.spec.js`, `flows-everything.spec.js` (filter, group, Board). The Table mode is not driven |
| 26 | Add a custom field and fill it | Covered | `flows-custom-field.spec.js` (a field made with only a name), `flows-custom-field-fill.spec.js` (a text field filled in the task panel) |
| 27 | An automation rule fires | Covered | `flows-automation-fires.spec.js` (switch on, build from a sentence, run history, switch off and delete); the API layer is in `tests/integration/automations.int.test.js` |
| 28 | Invite a member (the pending row; no email is sent in CI) | Covered | `flows-inbox-settings.spec.js` |
| 29 | Switch theme and look, and set the accent colour | Covered | `flows-inbox-settings.spec.js` |
| 30 | Sign out | Covered | `flows-workspace.spec.js` |

## Keeping this list true

- A new spec for a flow changes that flow's row and the counts in the same pull request.
- A flow marked `test.fixme` or `test.fail` is not Covered. Say why in the row.
- Every spec runs under the console guard (`e2e/support/consoleGuard.js`): an uncaught error in the page, or a `console.error` that is not on the guard's allowlist, fails the test.
