# Known serious issues

The promise this file keeps: no serious bug is known and unlisted. A bug is serious when a person would lose work, see wrong data, be unable to finish an everyday flow, or be unable to get something back.

Last checked: 2026-10-01, against `beta` at build 742.
Sources: `Tasks/active/046-better-than-clickup/followups.md` and `dogfood-findings.md` (both written at build 720), with the pull requests merged since then taken off. Each line below was read from those files; none was reproduced again for this check.

## Open

| Area | What happens | Tracked in |
|------|--------------|------------|
| Subtasks | A task with more than 35 subtasks shows only the first 35, in the List and in the task panel. | followups.md, List (#1254) and Task panel (#1240) |
| List | Dropping a task that has several labels onto another group of a dropdown field replaces all its labels. | followups.md, List (#1191) |
| Tasks | Merging a task into one of its own subtasks leaves that subtask under the deleted task. | followups.md, Tasks and subtasks (#1245) |
| Views | "Save for me" on a shared view can overwrite a private view of the same kind that was made from a template. | followups.md, Views (#1251) |
| Trash | Restoring a folder brings back every trashed task in its lists, including tasks that were deleted on their own earlier. | followups.md, Folders (#1247) |
| Trash | A deleted chat category cannot be restored. | followups.md, Folders (#1247) |
| Custom fields | A field's project list is saved as a whole from the browser, so a tab that was open before a change can drop a project from the field on its next edit. | followups.md, Projects (found by #1257) |
| Docs | A publicly shared doc does not show its uploaded images. | followups.md, Docs (#1196) |
| Everything | Grouping by due date answers with a server error for a time zone that the server accepts and the database rejects. | followups.md, Everything (#1250) |
| Server | Heavy use from one address (an office, an agent) can get requests from that address refused as too many for a short while. | followups.md, Agents and polling (#1230); dogfood-findings.md, finding 6 |

Access and security: tracked privately.

## Not listed, and why

- The dogfood findings about agents (the statuses an agent can set, one call per subtask field, tools that are off by default, token lifetime) are limits of the agent tools, described in `docs/MCP-AGENT-GUIDE.md`. Nobody loses work through them.
- Speed against its budgets is under "Speed" in followups.md.
- Items in followups.md about looks, wording, or a screen nobody has checked by hand yet stay there.

## Keeping this list true

- A fix removes its line in the same pull request.
- A serious bug found by use, by a test or by a report gets a line here on the day it is found, with where it is tracked.
- An access or security problem never gets a line with detail: it is counted under "tracked privately".
- A browser test that fails because of a product bug is marked `test.fail` or `test.fixme` with the reason, and the bug gets a line here if it is serious. The flows and their tests are in [E2E-FLOWS.md](E2E-FLOWS.md).
