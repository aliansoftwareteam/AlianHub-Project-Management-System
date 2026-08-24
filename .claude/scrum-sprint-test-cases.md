# Scrum sprint management — manual test cases

Covers the whole feature: **AHE-3915 … AHE-3923**. Everything below is
clickable — no console needed except for the two bypass checks in Part E.

Both dev servers are already running (`:4000` API, `:8080` app).

**Use a throwaway project for Parts B–D.** Completing a sprint moves real tasks.

---

## Part A — Regression: nothing that worked should change

A project that never opts a list into Scrum must look and behave exactly as it
does today. This is the pass that matters most.

| # | Do this | Expect |
|---|---|---|
| A1 | Open a project's sprint list | Identical to before. No chips, no new menu items on plain lists |
| A2 | Create a sprint | Appears in the list |
| A3 | Rename a sprint | Updates live |
| A4 | Move a sprint into a folder, then back to root | Regroups live; a task's breadcrumb follows |
| A5 | Archive a sprint, then restore it | Works, with its tasks |
| A6 | Close a sprint (existing Close) | Works as before |
| A7 | Delete a sprint | Works as before |
| A8 | Private on, add a member, remove, private off | All four work |
| A9 | Add and remove a watcher | Both work |
| A10 | Star and unstar a sprint | Both work |
| A11 | Create a task → count up. Delete it → count down | Counts correct, no reload |
| A12 | Bulk-move tasks between sprints | Both counts correct, no reload |
| A13 | Chat → create a channel, rename, change icon, add/remove a member | All work. **No sprint chips or Start/Complete anywhere in Chat** |
| A14 | Repeat A2–A7 from the **Task List dashboard** | Same behaviour |
| A15 | Reports → Burndown on a plain list | Same chart as before, running to today |

---

## Part B — Set up and start a sprint

### B1 — Turn a list into a sprint

Sprint row → **⋯ menu → Make it a sprint**.

- [ ] The dialog opens with the sprint's name at the top
- [ ] Ticking **Run this list as a sprint** reveals Goal, Start date, Duration, End date
- [ ] Duration defaults to **1 week**; End date fills in automatically and is read-only
- [ ] Switching Duration to **2 weeks** moves End date accordingly
- [ ] Switching to **Custom** makes End date editable
- [ ] Setting End date *before* Start date shows a red message and disables Save
- [ ] Enter a goal, keep 1 week, **Save**
- [ ] Toast "Sprint updated"; the row now shows a grey **PLANNED** chip and the date range
- [ ] The goal appears in italics next to the dates
- [ ] Reopen **Sprint settings** — it comes back on **1 week**, not Custom

### B2 — Start it

Put 3–4 tasks in the sprint first, with story points and estimates on some.

**⋯ menu → Start sprint**.

- [ ] Toast "Sprint started"
- [ ] The chip turns green **ACTIVE** and a day counter appears ("4 days left")
- [ ] The ⋯ menu now offers **Complete sprint** instead of Start sprint

### B3 — One sprint at a time

Set up a **second** sprint (B1) in the same project and try **Start sprint**.

- [ ] Refused, and the red toast **names the sprint that is in the way**
- [ ] The second sprint stays PLANNED

### B4 — A sprint with no dates will not start

Make a third list a sprint but clear its dates before saving.

- [ ] Save is blocked with "A sprint needs both a start date and an end date."

---

## Part C — Work it, then complete it

In the active sprint:

- [ ] Move **one** task to a Complete/Done status
- [ ] **Add a new task** to the sprint (this is the scope-added case)
- [ ] Give one unfinished task a **subtask**

### C1 — The dialog tells the truth

**⋯ menu → Complete sprint**.

- [ ] Three tiles: Completed = 1, Not completed = the rest, **Added after start = 1**
- [ ] The unfinished tasks are listed **by key and name**
- [ ] It says subtasks move with their parent
- [ ] The destination dropdown offers: a new sprint (with its dates spelled out),
      **The backlog**, and every other open sprint in the project by name

### C2 — Complete into a new sprint

Choose the "A new sprint — …" option and confirm.

- [ ] Toast "Sprint completed"
- [ ] A **new sprint appears** with the suggested name, PLANNED, starting the day
      after the old one ended
- [ ] The unfinished tasks are in it — **and so are their subtasks**
- [ ] The finished task **stayed** in the old sprint and is still done
- [ ] Both sprints' task counts are right **without a reload**
- [ ] The old sprint is still **visible**, now with a grey **CLOSED** chip — it is
      not archived
- [ ] The old sprint's ⋯ menu no longer offers Start, Complete or Sprint settings

### C3 — Complete into the backlog

Start another sprint, leave work unfinished, complete it choosing **The backlog**.

- [ ] A sprint named **Backlog** appears in the list if it did not exist
- [ ] The unfinished work is in it
- [ ] The Backlog row has **no** Start/Complete/Sprint settings in its ⋯ menu
- [ ] Do it again from another sprint — **only one Backlog** exists

### C4 — Complete into a named sprint

- [ ] Picking a specific sprint from the dropdown puts the work there

### C5 — A sprint with nothing left open

Complete every task, then Complete sprint.

- [ ] The dialog says everything is done and no destination is asked for
- [ ] It closes cleanly and creates no new sprint

---

## Part D — Reports

Open the project's **Reports**.

### D1 — Burndown

- [ ] Picking a **completed sprint** draws a chart that **stops on its end date**,
      not a flat line running to today
- [ ] Above the chart: the state chip, the date range and the goal
- [ ] Picking a **running sprint**: the line stops at today and the rest of the
      box is **empty**, not zero
- [ ] The grey ideal line spans the **whole box**, reaching zero on the last day
- [ ] Picking a **plain list**: no box line above the chart, and the chart runs
      to today exactly as before

### D2 — Velocity

- [ ] **No chat channels** and **no Backlog** appear as bars
- [ ] Only completed sprints appear
- [ ] Committed and Completed are **different** where the sprint missed —
      before this they were equal by construction
- [ ] A project with no completed sprints shows the explanation, not "no data"
- [ ] If older sprints were skipped, the count is shown

### D3 — Sprint Report (new tab)

- [ ] Opens on the most recent sprint
- [ ] Four tiles: Committed, Completed, Unfinished, Scope added — each with
      points and hours
- [ ] Unfinished work is listed; anything that left the sprint is tagged
      **moved out**
- [ ] Scope added lists the task from C
- [ ] A sprint that was never started shows the "no commitment" notice rather
      than reporting zero committed

### D4 — Cumulative Flow

- [ ] It now shows **data**. It has returned "No tasks yet." for every project
      since it shipped — that is the bug fixed here

---

## Part E — The guards

### E1 — A running sprint cannot be archived behind its back ⭐

With a sprint **ACTIVE**, try **Archive** from its ⋯ menu.

- [ ] Not archived
- [ ] A **red toast** says the sprint is still running and to complete it first
      — *not* "something went wrong", and *not* a success toast
- [ ] The row still shows its name and count (it does not go blank)
- [ ] **Close** — same refusal
- [ ] **Delete** — still allowed
- [ ] The same three actions on a **plain list** — all work exactly as before

### E2 — The lifecycle cannot be bypassed

In DevTools console on the app, with a sprint open so the URL contains
`/project/<projectId>/s/<sprintId>`:

```js
const id = location.pathname.match(/\/s\/([0-9a-f]{24})/i)[1];
await (await fetch(`/api/v1/sprint/${id}`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + document.cookie.match(/accessToken=([^;]+)/)[1],
    companyId: localStorage.getItem('selectedCompany'),
  },
  body: JSON.stringify({
    companyId: localStorage.getItem('selectedCompany'),
    type: 'updateSprint',
    updateObject: { $set: { state: 'closed' } },
  }),
})).json();
```

- [ ] `status: false`, saying `state` is managed by the sprint lifecycle
- [ ] Same for `endDate`, `commitment`, `closeReport`
- [ ] Change it to `{ $set: { name: 'Still editable' } }` — this **works**

### E3 — A chat channel is not a sprint

In the same console, swap the id for a channel id from the Chat page URL and
call `/api/v2/sprints/scrum` with `{ sprintId, isScrum: true }`.

- [ ] Refused: "That is a chat channel, not a sprint."
- [ ] Chat still works normally

---

## Known and expected

- A completed sprint stays **visible** with a CLOSED chip. `state` describes the
  time box; `deletedStatusKey` remains the archive lifecycle, so archiving a
  finished sprint is still its own separate action.
- A Forms response list **can** be made a sprint. It is an ordinary sprint
  someone pointed a form at, carries no marker of its own, and running it as a
  sprint breaks nothing — submissions still file into it.
- The Backlog is created the first time something needs it, never by migration.
  A project that never uses it never grows one.
- The nightly auto-close cadence is **not** in this release. Completing a sprint
  is a deliberate action.
- Non-English locales show the new strings in English until they are translated.

## If something fails

Send the step number, and for a console step the full response it printed.
