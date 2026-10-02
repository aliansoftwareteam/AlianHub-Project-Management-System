# The 30 most-used flows and their browser tests

What people do in AlianHub every day, and which Playwright spec in `e2e/specs/` proves each flow still works. This is the list behind "end-to-end tests for the 30 most-used flows" (task 046, track C3). How the suite runs is in [TESTING-E2E.md](TESTING-E2E.md).

- **Covered**: a spec drives the flow in the browser and checks the result on the server or after a reload.
- **Partly**: a spec covers a part of the flow; the line says which part is missing.
- **Not yet**: no browser spec. A spec that only opens the screen does not count.

Checked on 2026-10-01 against `beta` at build 742: 12 covered, 3 partly, 15 not yet.

| # | Flow | Status | Spec |
|---|------|--------|------|
| 1 | Sign in with email and password | Covered | `smoke.spec.js` |
| 2 | Create a project | Not yet | |
| 3 | Create a list, a folder and a subfolder | Not yet | `projects.spec.js` opens a folder made through the API |
| 4 | Create a task from the List | Covered | `flows-list.spec.js` |
| 5 | Edit a task from its List row: rename, assign, due date, priority | Covered | `flows-list.spec.js`, `list-inline-edit.spec.js` (assign) |
| 6 | Close a task from the List by changing its status | Covered | `list-inline-edit.spec.js` |
| 7 | Edit a task's description in the task panel | Not yet | |
| 8 | Comment on a task and mention a teammate | Covered | `flows-task-panel.spec.js` |
| 9 | Add subtasks, down to three levels | Covered | `flows-task-panel.spec.js` |
| 10 | Attach a file to a task | Not yet | |
| 11 | Drag a card to another column on the Board | Not yet | |
| 12 | Edit a cell in the Table | Not yet | |
| 13 | Filter, group and sort a view, and save it | Partly | `list-filters.spec.js` (filter, group, save). Sort is missing |
| 14 | Select several tasks and change their status | Covered | `bulk-edit.spec.js`, `a11y.spec.js` |
| 15 | Move a task to another list | Not yet | |
| 16 | Duplicate a task | Covered | `flows-list.spec.js` |
| 17 | Archive a task and restore it | Not yet | |
| 18 | Delete a task and restore it from the Trash | Covered | `flows-list.spec.js` |
| 19 | Search from the command palette and open the result | Covered | `flows-workspace.spec.js` |
| 20 | Home and My work | Partly | `smoke.spec.js` (Home opens after sign-in). My work is missing |
| 21 | Open a notification from the Inbox | Partly | `inbox-triage.spec.js` (keyboard triage). Opening the task is missing |
| 22 | Log time on a task and see it in the timesheet | Not yet | `task-time.spec.js` reads the API only |
| 23 | A doc: create, edit, comment, version history | Not yet | `pages.spec.js` lists a doc made through the API |
| 24 | Chat: send a message and reply in a thread | Not yet | |
| 25 | Everything: find a task across projects and open it | Covered | `flows-workspace.spec.js`. Filters, groups, Board and Table are missing |
| 26 | Add a custom field and fill it | Not yet | |
| 27 | An automation rule fires | Not yet | The API layer covers it: `tests/integration/automations.int.test.js` |
| 28 | Invite a member (the pending row; no email is sent in CI) | Not yet | |
| 29 | Switch theme and density | Not yet | |
| 30 | Sign out | Covered | `flows-workspace.spec.js` |

## Keeping this list true

- A new spec for a flow changes that flow's row and the counts in the same pull request.
- A flow marked `test.fixme` or `test.fail` is not Covered. Say why in the row.
- Every spec runs under the console guard (`e2e/support/consoleGuard.js`): an uncaught error in the page, or a `console.error` that is not on the guard's allowlist, fails the test.
