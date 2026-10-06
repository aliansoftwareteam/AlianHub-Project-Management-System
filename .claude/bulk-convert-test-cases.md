# Bulk move + bulk Convert to Subtask + bulk Convert to Task — manual test cases

Covers the three changes sitting in the working tree together:

- **AHE-3927** — bulk move was leaving a task's subtasks behind
- **AHE-3925** — Convert to Subtask added to the bulk action bar
- **AHE-3926** — Convert to Task added to the bulk action bar

Both dev servers are up (`:4000` API, `:8080` app). The changes are **uncommitted**,
so make sure nodemon has restarted the API and the app has hot-reloaded before
starting — the first bulk move you try will tell you either way.

**Use a throwaway project.** These actions reparent, promote and move real tasks.

---

## Part A — Regression: the single-task actions must not have changed

None of the single-task code was touched, and this is the pass that proves it.

| # | Do this | Expect |
|---|---|---|
| A1 | On a task with 2 subtasks, use **Move** from the task's own ⋯ menu | Task moves, both subtasks move with it, exactly as before |
| A2 | Open it in the destination and expand it | Both subtasks are there, each with **its own** assignees |
| A3 | Move a task that has **no** subtasks | Works as before |
| A4 | Move a **subtask** on its own from its ⋯ menu | Works as before |
| A5 | Move a task to a **different project** | The status/type mapping step still appears and still applies |
| A6 | **Convert to Subtask** on a single task from its ⋯ menu | Picks a parent and converts, exactly as before |
| A7 | Convert a task that **has** subtasks | Its subtasks come across and sit beside it under the new parent |
| A8 | Convert a **subtask** to be under a different parent | Works; the old parent's subtask count drops by one |
| A9 | Drag a task onto another task in the list to make it a subtask | Works as before |
| A10 | **Convert to Task** on a single subtask from its ⋯ menu | Promotes it, exactly as before |
| A11 | Convert a subtask to a task **in a different sprint** | Lands in the chosen sprint; the old parent's count drops |

---

## Part B — Bulk move now carries subtasks

### B1 — The bug itself

1. Take a task with **2 subtasks**. Give each subtask a **different assignee** from the parent.
2. Select only the parent with its checkbox.
3. Bulk action bar → **Move** → pick another sprint → confirm.

- [ ] Toast reports **3 tasks updated**, not 1
- [ ] In the destination sprint, expanding the parent shows **both subtasks**
- [ ] Each subtask still has **its own** assignee — not the parent's ⭐
- [ ] The old sprint no longer holds them
- [ ] Both sprints' task-count badges are right **with no reload**

### B2 — Parent and its own subtask selected together

Select a parent **and** one of its own subtasks, then Move.

- [ ] The whole family lands in the destination
- [ ] The toast counts each task **once** — a parent with 2 subtasks reports 3, not 4
- [ ] The sprint badges are right

### B3 — Move on subtasks offers parent tasks, not sprints ⭐

Select **only subtasks** (not their parent) and press **Move**.

- [ ] The sidebar lists **parent tasks**, not sprints — the same picker the
      single-task Move shows for a subtask
- [ ] The header says "Move task" and the button says **Move**
- [ ] Choosing a parent moves them under it
- [ ] The old parent's subtask count drops; the new one's goes up
- [ ] If the new parent is in another sprint, both sprint badges are right with
      no reload

Now select **a parent task as well** and press Move again.

- [ ] This time the sidebar lists **sprints**, because the selection is no longer
      only subtasks
- [ ] The parent and its subtasks move together

> A subtask has nowhere to go but under another task: the list renders subtasks
> nested and looks them up one sprint at a time, so a subtask in a sprint its
> parent is not in shows up in neither. The single-task action has always
> branched on this — Move on a parent picks a sprint, Move on a subtask picks a
> parent task. Bulk offered the sprint picker for both, which is what produced
> the invisible subtasks.
>
> A subtask whose parent is also selected is not "loose": it travels with the
> parent through the ordinary sprint move. Only a selection that is *entirely*
> loose subtasks switches the picker.

### B4 — Rescuing already-stranded subtasks

If this project has subtasks stranded by the old behaviour — a parent that shows
"2 subtasks" but opens empty — select that parent and Move it anywhere.

- [ ] The missing subtasks reappear under it in the destination
- [ ] If you have no stranded ones, skip this — do not create some on purpose

### B5 — Nothing else about bulk move changed

- [ ] A childless task still bulk-moves fine
- [ ] Moving to a **different project** still maps status and type
- [ ] Moving to the sprint the task is already in still reports it as skipped
- [ ] Selecting an **archived** task still skips it

---

## Part C — Bulk Convert to Subtask

### C1 — The button

- [ ] Select two or more tasks → the bar shows **Convert to Subtask**
- [ ] With a role that lacks convert or subtask-create permission, it is disabled
      with a reason on hover

### C2 — The happy path

1. Select **3 tasks** in the same sprint
2. **Convert to Subtask** → pick a parent task from the list → **Convert**

- [ ] Toast reports **3 tasks updated**
- [ ] All three now sit nested under the chosen parent
- [ ] The parent's subtask count went up by **3**
- [ ] They are gone from the top level of the list
- [ ] The parent's progress bar reflects the new subtasks

### C3 — The skip rules, each with a readable reason

Each of these should be **skipped with a reason in the toast**, not silently ignored:

- [ ] Select a task **and** the task you then choose as the parent → the parent is
      skipped ("it is the parent you chose")
- [ ] Select a task that is **already a subtask of that parent** → skipped
      ("already a subtask of that task")
- [ ] Select a parent **and one of its own subtasks** → the subtask is skipped
      ("moved with its parent task"), and the toast counts it once

### C4 — A selected task that has its own subtasks

Select a task that has 2 subtasks of its own, and convert it under a parent.

- [ ] It becomes a subtask of the chosen parent
- [ ] **Its own 2 subtasks come across and sit beside it** under the same parent —
      not left behind, because only one level of nesting exists
- [ ] The parent's subtask count went up by **3**

### C5 — Converting into a parent in a different sprint

Pick a parent that lives in **another sprint**.

- [ ] The converted tasks move to the parent's sprint
- [ ] **Both sprints' task-count badges are right with no reload** ⭐
- [ ] The task detail breadcrumb shows the new sprint

### C6 — Converting into a parent in a different project

- [ ] It works, and the tasks land with a valid status and type in the destination
      project (mapped by name where the names match)

### C7 — Refusals

- [ ] Choosing a **subtask** as the parent is refused
- [ ] Converting with nothing selected does not offer the action at all

### C8 — Existing subtasks re-parented

Select a subtask that belongs to **another** parent, and convert it under a new one.

- [ ] It moves under the new parent
- [ ] The **old** parent's subtask count drops by one
- [ ] The new parent's goes up by one

---

## Part D — Bulk Convert to Task

### D1 — The button

- [ ] Select two or more tasks → the bar shows **Convert to Task**
- [ ] With a role that lacks convert or task-create permission, it is disabled

### D2 — The happy path

1. Expand a parent and select **3 of its subtasks**
2. **Convert to Task** → pick a project and sprint → confirm

- [ ] Toast reports **3 tasks updated**
- [ ] All three are now top-level tasks in the chosen sprint
- [ ] None of them is nested under anything any more
- [ ] The old parent's subtask count dropped by **3**
- [ ] Sprint badges on both sprints are right **with no reload**

### D3 — Promoting into the sprint they are already in

Select subtasks and convert them into **their own current sprint**.

- [ ] They become top-level tasks in that same sprint
- [ ] The sprint's task count does **not** change — nothing entered or left it ⭐

### D4 — A task that is already top-level

Select a mix: two subtasks and one ordinary task.

- [ ] The two subtasks are promoted
- [ ] The ordinary task is **skipped** with "already a task, not a subtask"
- [ ] It is not touched at all — same sprint, same status

### D5 — Subtasks from different parents at once

Select subtasks belonging to **two different parents**.

- [ ] All are promoted
- [ ] **Each** parent's subtask count drops by the right amount

### D6 — Promoting into a different project

- [ ] It works, and the tasks land with a valid status and type in the destination
- [ ] Converting within the **same** project does **not** change any status or type ⭐
      (the two are told apart by a comparison that was easy to get wrong)

### D7 — Nothing disappears ⭐

This is the one that matters most. The conversion marks a task deleted first and
rewrites it second, so a failure in between used to leave it gone from the board.

- [ ] Convert a batch of subtasks and confirm **every single one** is visible
      afterwards — either promoted, or still where it was
- [ ] Count the tasks on the board before and after: nothing has vanished
- [ ] If any task reports an error in the toast, find it — it should still be on
      the board, exactly as it was, **not** missing

---

## Part E — The other bulk actions are untouched

The bulk endpoint gained a permission middleware. For anyone signed in through
the app it does nothing at all, but check the actions still work:

- [ ] Bulk status change
- [ ] Bulk priority
- [ ] Bulk assignee add and remove
- [ ] Bulk due date
- [ ] Bulk tags
- [ ] Bulk archive and restore
- [ ] Bulk delete
- [ ] Bulk duplicate
- [ ] Bulk move (Part B already covers it)

---

## Known and expected

- The parent picker for Convert to Subtask lists **every** task, including ones
  you have selected. The server skips a selected task that turns out to be the
  parent and says so in the toast, rather than the picker hiding it — that would
  have meant threading the selection through three components.
- Converting a parent flattens its subtasks to sit beside it, rather than nesting
  them two deep. That is the existing single-task behaviour; only one level of
  nesting exists in the data model.
- A partial result shows an amber toast ("Updated 2 tasks — 1 skipped — 1 failed"),
  not a green one.
- Selecting a parent task also selects its loaded subtasks, and selecting every
  subtask selects the parent. That is existing behaviour; the bulk actions now
  count such a family once instead of twice.
- Moving a parent gathers its subtasks by parentage rather than by sprint, so one
  that had been separated is pulled back to the family. That also means completing
  a sprint can pull in a subtask living in another sprint, if its parent is in the
  sprint being closed.
- Bulk Move now branches on the selection, exactly as the single-task action
  does: subtasks get the parent-task picker, anything else gets the sprint
  picker. The server refuses a loose subtask sent to a sprint regardless, so the
  invisible state cannot be reached even by a direct request. Sprint completion
  is unaffected — it only ever hands parent tasks to the move.
- Convert to Task has no history entry, the same as the single action. Not added
  here.

## If something fails

Send the step number, the toast text, and — for anything about counts — what the
sprint badge said before and after. For **D7**, say which task went missing and
what the toast said.
