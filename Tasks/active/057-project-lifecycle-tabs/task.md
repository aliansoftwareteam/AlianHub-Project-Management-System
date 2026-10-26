---
id: 057
title: Projects settings — Open, Archived and Closed tabs; every undo returns the exact previous state
status: active
priority: high
depends_on: []
created: 2026-10-26
---

# Projects settings — Open, Archived and Closed tabs; every undo returns the exact previous state

## Goal
Settings › Projects lists projects as Open, Archived and Closed, each with the actions that fit its state. Restore, Reopen and Trash restore bring a project and its tasks back to exactly the state they had before, whichever screen the action starts from.

## Root cause
- Settings › Projects drops archived projects (`deletedStatusKey` 2), so its Restore and Delete items never appear.
- Three web copies of the task cascade each guess which tasks to move:
  - Projects page Restore (`useProjectLifecycle.js`) and sidebar Restore (`Item.vue`) pick the task key from the last confirm dialog's mode (`mode ? 8 : 7`). After an Archive or Delete on the same page, the project comes back with its tasks hidden.
  - Settings Close (`ProjectsListingSetting.vue`) moves tasks 8→0 instead of 0→8, so a closed project keeps active tasks.
- Trash restore always returns a project as Open and revives tasks deleted one by one before the project (every key 1 or 7 goes to 0).

## Decisions (with the user)
- Open: Close project, Archive. Closed: Reopen project, Archive. Archived: Restore project, Delete project. A closed project that is archived shows under Archived with a "Closed" chip; Restore returns it to Closed.
- Reopen returns the project to the status it had before it was closed. Projects closed before this change fall back to the default status.
- Trash restore is in scope: a project archived and then deleted comes back as Archived, and tasks deleted one by one before the project stay in Trash.

## State model
A project's live tasks carry one key decided by the project's state (precedence trashed > archived > closed > open): open 0, closed 8, archived 7, trashed 1 with `trashedWithProject: true`. A lifecycle change moves tasks from the before-state key to the after-state key and touches no other task. The project remembers `statusBeforeClose` (for Reopen) and `trashedFromKey` (for Trash restore). A trashed project without `trashedFromKey` keeps the old restore.

## Scope
- Server: one lifecycle helper used by the project update route, Trash restore and auto-close. The route does the task cascade, with a socket update per task, as the task cascade route does today.
- Schema: `statusBeforeClose`, `trashedFromKey` on projects; `trashedWithProject` on tasks.
- Web: the three tabs and per-state menu in Settings › Projects; per-action permissions; the web cascades removed; a project-specific archive confirmation; `reopenStatusOf` in `utils/lifecycle.js`.
- i18n keys through `en.js` and the backfill; colours through tokens.

## Out of scope
- The main Projects page filter (Active / Archived over non-closed projects).
- Restoring folders, lists and docs that sample-project removal trashes.
- Tasks created in a closed or archived project by recurring rules or automations.
- Removing `PUT /api/v1/project/allTask` (other clients may still call it).

## Acceptance criteria
- [ ] Settings › Projects shows Open (n), Archived (n) and Closed (n); each row's menu offers the actions above, each gated by its own permission
- [ ] Archived and closed rows are read-only; an archived closed project shows a "Closed" chip
- [ ] Archive then Restore (from Settings, the Projects page or the sidebar) brings back exactly the tasks that were active; tasks archived, closed or trashed on their own stay so
- [ ] Close then Reopen returns the pre-close project status and reactivates exactly the tasks the close moved
- [ ] A closed project archived and restored is closed again, with its tasks closed
- [ ] An archived project deleted and restored from Trash is archived again; a task deleted before the project stays in Trash
- [ ] Auto-close stamps the pre-close status, so a reopened auto-closed project returns to it
- [ ] The archive confirmation for a project talks about a project, not a List
- [ ] Backend and frontend tests cover the lifecycle table, `reopenStatusOf` and the Settings tabs; `i18n:check` and `style:check` pass
