# AHE-3776 — Subtask completion percentage badge on parent tasks

**Sprint:** v14.6.0 - Main
**Type:** Feature (frontend-only)
**Status:** Implemented locally — pending manual test (not committed)

---

## Summary

A parent task that has subtasks shows a **completion-percentage badge** computed from
how many of its subtasks are done. Example: a task with "Sub 1" (done) + "Sub 2"
(not done) shows **50%**.

The badge appears in **three places**:

- **A — Task-detail header:** a compact ring + `%` pill, placed just before the
  attachment icon (top-right of the task header).
- **C — Subtask section header:** a mini progress bar + `%` + `done/total` count,
  directly above the subtask list.
- **D — List view parent row:** the same compact ring + `%` pill, right after the
  subtask-count badge.

On the task-detail view, A and C read **one shared value**, so they never disagree.
The List-view pill (D) shows on **every** parent row, including collapsed ones: each parent
fetches a lightweight done/total count on load, then uses the live subtask list once expanded.

---

## How it works

- **Completed = `(status?.type || statusType) === 'close'`** — the same predicate the
  rest of the app uses for "done" (e.g. CanvasView, LinkedTasks). Covers both the
  "Done" and "Complete" board columns (both are status type `close`).
- **Percentage = `round(completed / total × 100)`**, where `total` = non-deleted
  subtasks (`deletedStatusKey` is `0` or `undefined`).
- **Single source of truth:** computed in `TaskDetail.vue` from the `subTasks` list
  the detail view already loads, then `provide`d to both the header
  (`TaskDetailAction.vue`) and the subtask section (`SubTasks.vue`).
- **Live:** `TaskDetail.getQueryFun()` reloads the subtasks on every subtask socket
  update, so the badge recomputes automatically when a subtask is completed, added,
  or removed — no page refresh.
- **Colour states:** `0%` = gray (not started), `1–99%` = blue (in progress),
  `100%` = green (done).

### Files changed
| File | Change |
|------|--------|
| `frontend/src/components/atom/SubtaskProgressBadge/SubtaskProgressBadge.vue` | **New** — presentational badge (props: `completed`, `total`, `variant`). |
| `frontend/src/views/TaskDetail/TaskDetail.vue` | Added `subtaskCompletion` computed + `provide`. |
| `frontend/src/components/molecules/TaskDetailAction/TaskDetailAction.vue` | Renders the `pill` badge (A) before the attachment icon. |
| `frontend/src/components/organisms/SubTasks/SubTasks.vue` | Renders the `bar` badge (C) in the section header. |
| `frontend/src/components/organisms/Task/Task.vue` | Renders the `pill` badge (D) after the subtask-count badge in the List view. |

---

## Test cases

> Run the frontend dev server (`cd frontend && npm run serve`, default `:8080`) against
> a backend on `:4000`. Open any project task.

### TC-1 — Parent with mixed subtasks shows the right %
1. Open a task and add two subtasks: `Sub 1`, `Sub 2`.
2. Move `Sub 1` to a Done/Complete status.
3. **Expect:** header pill = `50%` (blue); subtask section header = bar at 50% + `50%` + `1/2`.

### TC-2 — All subtasks complete → 100% (green)
1. Move `Sub 2` to Done as well.
2. **Expect:** both badges update to `100%` in green, bar full, count `2/2` — **without a manual refresh**.

### TC-3 — No subtasks complete → 0% (gray)
1. On a parent with 2 open subtasks (none done).
2. **Expect:** both badges show `0%` in gray; ring shows only the faint track; bar empty; count `0/2`.

### TC-4 — Task with no subtasks shows NO badge
1. Open a plain task (no subtasks) and a subtask opened on its own.
2. **Expect:** no badge in the header, no badge in the (empty) subtask section. Header icon row looks exactly as before.

### TC-5 — Live update on add / delete
1. With a parent at `1/2` (50%), add a third open subtask.
2. **Expect:** badge recomputes to `33%` and `1/3` (denominator changed).
3. Delete a subtask.
4. **Expect:** badge recomputes accordingly.

### TC-6 — Rounding
1. Parent with 3 subtasks, 1 done.
2. **Expect:** `33%` (round(33.33)). With 2 of 3 done → `67%`.

### TC-7 — No regression
- Header attachment / audio / more-menu / watchers / close icons all still work and are correctly spaced.
- Subtask section: "Suggest Subtasks" and "+ Add Subtask" still aligned to the right; list, scroll, and create still work.
- Opening a task detail with the badge present does not throw any console errors.

### TC-8 — List view badge (D)
1. In the project **List view** with rows **collapsed**, reload the page.
2. **Expect:** each parent with subtasks shows a `%` pill right after the subtask-count badge (e.g. Task 1 → `67%`) — without expanding.
3. Expand a parent and change a subtask's status → the pill updates live from the loaded subtasks.
4. A parent with no subtasks shows no pill; the row layout is otherwise unchanged.
5. **Note:** the collapsed badge is a load-time snapshot (refreshes on reload / on expand); while expanded it updates live.

---

## Notes / scope
- Counts subtasks one level deep (the current single-level subtask model).
- Percentage reflects the loaded subtask set (detail view loads up to 35); parents with
  more than 35 subtasks — which do not occur in practice — would reflect the loaded set.
- **List view (D):** each parent fetches a one-time, read-only done/total count on mount via
  the existing `/task/find` aggregate endpoint (no backend change), so the pill shows on
  collapsed rows right after reload; once expanded it switches to the live subtask list. The
  collapsed value is a load-time snapshot (refreshes on reload / expand), not live while
  collapsed. One lightweight grouped query per parent that has subtasks.
- No backend, schema, or API changes — purely additive frontend, so existing
  functionality is unaffected.
