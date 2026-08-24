# Scrum sprint lifecycle — manual test cases

Covers **AHE-3915** (data model) and **AHE-3916** (start / complete). Both are
backend-only, so there is **no Start or Complete button in the app yet** — that
arrives with AHE-3920–3923. Part B below drives the new endpoints from the
browser console instead.

Part A is the one that matters most: it is the "nothing broke" pass, and none of
it needs the console.

---

## Setup

Both dev servers are already running (`:4000` API, `:8080` app). The app proxies
`/api` to the backend, so relative paths work from the console.

1. Open the app at `http://localhost:8080` and log in.
2. Open a sprint so the address bar reads
   `/<cid>/project/<projectId>/s/<sprintId>` (or `.../fs/<folderId>/<sprintId>`
   for a sprint inside a folder). The helper reads both ids straight from the URL.
3. Open DevTools → Console and paste this once:

```js
window.T = (() => {
  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (document.cookie.match(/accessToken=([^;]+)/) || [])[1],
    companyId: localStorage.getItem('selectedCompany'),
  });
  const call = async (method, path, body) => {
    const r = await fetch(path, { method, headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) });
    const out = await r.json().catch(() => '(not json)');
    console.log(`%c${method} ${path}`, 'color:#2f3a8f;font-weight:600', out);
    return out;
  };
  const ids = () => {
    const m = location.pathname.match(/\/project\/([0-9a-f]{24})\/(?:s|fs\/[0-9a-f]{24})\/([0-9a-f]{24})/i);
    if (!m) { console.warn('Open a sprint first — the URL must contain /project/<id>/s/<sprintId>'); return {}; }
    return { projectId: m[1], sprintId: m[2] };
  };
  const me = { Employee_Name: 'Manual test' };
  return {
    ids,
    setup: (startDate, endDate, goal) => call('POST', '/api/v2/sprints/scrum', { sprintId: ids().sprintId, isScrum: true, startDate, endDate, goal }),
    off: () => call('POST', '/api/v2/sprints/scrum', { sprintId: ids().sprintId, isScrum: false }),
    start: () => call('POST', '/api/v2/sprints/start', { sprintId: ids().sprintId, userData: me }),
    preview: () => call('GET', `/api/v2/sprints/complete-preview?sprintId=${ids().sprintId}`),
    complete: (dest = 'next') => call('POST', '/api/v2/sprints/complete', { sprintId: ids().sprintId, incompleteDestination: dest, userData: me }),
    call,
  };
})();
```

`T.ids()` should print the two ids. If it warns, the URL is wrong.

**Use a throwaway project** for Part B. Completing a sprint moves real tasks.

---

## Part A — Regression: everything that already worked

Click-through only. Expected result for every row: **exactly as before today's
changes.** This is the whole point of the pass.

| # | Do this | Expect |
|---|---|---|
| A1 | Create a sprint | Appears in the list |
| A2 | Rename a sprint | Name updates, no reload needed |
| A3 | Move a sprint into a folder | Row regroups live; open a task in it — breadcrumb shows the new folder |
| A4 | Move the same sprint back to root | Regroups back |
| A5 | Archive a sprint | Moves to archived, success toast, its tasks archive with it |
| A6 | Restore that sprint | Comes back with its tasks |
| A7 | Close a sprint (the existing Close) | Closes as before |
| A8 | Delete a sprint | Deletes as before |
| A9 | Make a sprint private, add a member, remove a member, make it public | All four work |
| A10 | Add a watcher, then remove them | Both work |
| A11 | Star (favourite) a sprint, then unstar | Both work |
| A12 | Create a task in a sprint | Sprint task count goes **up by one** |
| A13 | Delete that task | Count goes **down by one** |
| A14 | Bulk-move several tasks to another sprint | Both sprint counts correct **without a reload** |
| A15 | Archive a task | Count moves from tasks to archived count |
| A16 | Chat → create a channel, rename it, change its icon, add and remove a member | All work; channel count unaffected |
| A17 | Do A1–A8 from the **Task List dashboard** sprint list too | Same behaviour |

> A5/A7/A8 also cover the new refusal plumbing: on success you must still get the
> normal success toast, and the row must not go blank.

---

## Part B — The new lifecycle

Work through these in order, in one sprint, in a throwaway project.

### B1 — Turn a list into a sprint

```js
await T.setup('2026-08-24', '2026-08-28', 'Ship Scrum management')
```

- [ ] `status: true`
- [ ] `data.isScrum` is `true`, `data.state` is `"planned"`
- [ ] `data.goal` is the text you passed
- [ ] The sprint list looks **completely unchanged** (no UI for this yet — correct)

### B2 — Start it

Put at least 3 tasks in the sprint first, some with story points and estimates.

```js
await T.start()
```

- [ ] `status: true`, `data.state` is `"active"`
- [ ] `data.commitment` has `tasks`, `points`, `minutes` and a `taskIds` list
- [ ] `points` and `minutes` match the totals of the tasks actually in the sprint

### B3 — Work the sprint

In the UI:

- [ ] Move **one** task to a Complete/Done status
- [ ] Add **one new** task to the sprint (this is the "scope added" case)
- [ ] Give one of the unfinished tasks a **subtask**

### B4 — Preview the close

```js
await T.preview()
```

- [ ] `done.tasks` is 1
- [ ] `notDone.tasks` matches what is still open
- [ ] `notDone.list` names those tasks
- [ ] `addedAfterStart` is **1** (the task from B3)
- [ ] `suggestedNext.name` is your sprint name with a sensible next name
- [ ] `suggestedNext.startDate` is the day **after** this sprint's end date
- [ ] Re-run `T.preview()` — the sprint is still `active`, nothing changed

### B5 — Complete it

```js
await T.complete('next')
```

- [ ] `status: true`, `data.state` is `"closed"`
- [ ] `data.closeReport` has `done`, `notDone`, `addedAfterStart` and `movedTo`
- [ ] A **new sprint** appears in the list, named from `suggestedNext`
- [ ] The unfinished tasks are now in it, **with their subtasks**
- [ ] The finished task **stayed** in the old sprint and is **still done**
- [ ] Both sprints' task counts are right **without a reload**
- [ ] The old sprint is still **visible** in the list, not archived
- [ ] Project history shows a "completed sprint" entry naming the counts

### B6 — Complete it again

```js
await T.complete('next')
```

- [ ] `status: true` with "already completed"
- [ ] **Nothing moves.** No second sprint is created, no counts change

### B7 — Complete into a sprint you pick

Set up a second sprint, start it, then:

```js
await T.complete('<paste the destination sprintId>')
```

- [ ] Unfinished work lands in that sprint, not a new one

---

## Part C — The guards

### C1 — One running sprint per project

With a sprint already `active`, open a different sprint, `T.setup(...)` it, then:

```js
await T.start()
```

- [ ] `status: false`, and the message **names the sprint that is in the way**
- [ ] The refused sprint is still `planned`

### C2 — A sprint with no dates will not start

```js
await T.call('POST', '/api/v2/sprints/scrum', { sprintId: T.ids().sprintId, isScrum: true })
await T.start()
```

- [ ] Refused, asking for dates

### C3 — Backwards dates

```js
await T.setup('2026-08-28', '2026-08-24', 'nope')
```

- [ ] Refused: end date must be after the start date

### C4 — A chat channel is not a sprint

Get a channel id from the Chat page URL, then:

```js
await T.call('POST', '/api/v2/sprints/scrum', { sprintId: '<channel id>', isScrum: true })
```

- [ ] Refused: "That is a chat channel, not a sprint."
- [ ] Chat still works normally afterwards

### C5 — A running sprint cannot be archived behind its back ⭐

**This is the important one.** With a sprint `active`, in the **UI**, try to
Archive it from the sprint list.

- [ ] It is **not** archived
- [ ] A **red toast** appears saying the sprint is still running and to complete
      it first — *not* "something went wrong", and *not* a success toast
- [ ] The sprint row still shows its name and count (it does not go blank)
- [ ] Try **Close** as well — same refusal
- [ ] Try **Delete** — this **is** still allowed (deleting is not a silent rollover)
- [ ] Repeat all of the above on a **plain, non-Scrum list** — everything works
      exactly as it always did

### C6 — The lifecycle cannot be bypassed

```js
await T.call('PATCH', `/api/v1/sprint/${T.ids().sprintId}`, {
  companyId: localStorage.getItem('selectedCompany'),
  projectId: T.ids().projectId,
  type: 'updateSprint',
  updateObject: { $set: { state: 'closed' } },
})
```

- [ ] `status: false`, saying `state` is managed by the sprint lifecycle
- [ ] Repeat with `endDate`, `commitment`, `closeReport` — all refused
- [ ] Repeat with `{ $set: { name: 'Still editable' } }` — this **works**

### C7 — Turning Scrum off

- [ ] `T.off()` on a `planned` sprint works and it becomes a plain list again
- [ ] `T.off()` on an `active` sprint is refused

---

## Known and expected

- No Start / Complete UI yet — Part B is console-only by design.
- `T.complete('backlog')` returns "not available yet". The backlog sprint is
  AHE-3917, the next subtask.
- A completed sprint stays **visible** in the list. That is deliberate: `state`
  describes the time box, `deletedStatusKey` stays the archive lifecycle, and
  the sprint list needs a closed sprint to show a Closed chip against.
- A Forms response list **can** be turned into a sprint. It is an ordinary
  sprint someone pointed a form at and carries no marker; running it as a sprint
  breaks nothing and submissions still file into it.

## If something fails

Send the console output of the failing call (it prints the full response) and
which step number it was.
