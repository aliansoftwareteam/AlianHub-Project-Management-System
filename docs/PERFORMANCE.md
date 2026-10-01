# Performance at scale

How fast AlianHub is with a large project, what it has to reach, and how to measure it yourself. The data set and both scripts are local-only: they refuse a database that is not on `localhost` and refuse `NODE_ENV=production`.

## Budgets

The finish line is one project with **10,000 tasks**, on a warm server.

| What | Budget |
| --- | --- |
| List: first usable paint (first task rows visible) | under 1.5 s |
| Board: first usable paint (first cards visible) | under 1.5 s |
| Status change: click to visible response | under 150 ms |
| Inline edit: click to visible response | under 150 ms |
| Opening the task panel: click to visible response | under 150 ms |
| Scrolling | 50 frames per second or more |
| Task-query API, first page | under 300 ms |

A budget is judged on the **median** of the runs; the p95 is shown beside it. At **50,000 tasks** the same things are measured and reported as "measured, no budget yet".

## The data set

`scripts/seed-scale.js` creates a company named **Scale Test** with its own users and one project, **Scale Project** (key `SCL`).

| Part | Shape |
| --- | --- |
| Tasks | `--tasks N` top-level tasks (10,000 or 50,000 for the benchmark; any number from 1 to 50,000) |
| Subtasks | on about 10% of tasks, one to four each, on top of N (10,000 tasks come with about 2,100 subtasks) |
| Comments | on about 20% of tasks, one to five each |
| Statuses | the 6 of the default template: To Do, In Progress, In Review, Backlog, Done, Complete |
| Lists | 20: "List" and "Sprint 01" to "Sprint 19", the earlier ones larger |
| People | an owner and 30 members; a task has 0 to 3 assignees |
| Priorities | High 20%, Medium 50%, Low 30% |
| Dates | created one every ten minutes over the year before the seed day; 85% have a due date within about six months either side of it, half of those a start date |
| Estimates, points, tags | estimates on about 50% of tasks, points on about 40%, up to three of 12 project tags |
| Custom fields | 5 on the project (dropdown, number, date, text, checkbox), with values on about 60% of tasks |

The same task number always produces the same task, so 10,000 tasks are the first 10,000 of 50,000 and a second run with a larger number tops the project up.

### How it is written

The company, its settings, the users, the memberships, the project with its tags and custom fields, and the 20 lists go through the app's own code: `createFirstCompany`, `addUserMongodbV2`, `createProject`, `addSprintFun`. Tasks and comments are bulk inserts (`insertMany`) through the same Mongoose models and schemas the app saves with, 500 tasks at a time. `tests/scale-seed-shapes.test.js` checks every generated document against those schemas.

What the app would have derived while creating the tasks one by one, the seed sets itself:

| Field | Rule |
| --- | --- |
| `TaskKey` | `SCL-1`, `SCL-2`, … in creation order, each task followed by its subtasks |
| `groupByStatusIndex` | per status, the first task gets 0 and each later one 65,536 less, which is what `updateTaskIndex` gives a new task. Subtasks have none. The other three group indexes are left unset, as they are on a task created from the status grouping |
| `sprintArray` | `{ id, name }` of the task's list, the id as an ObjectId |
| `subTasks` on a parent | the number of its subtasks |
| `lastMessage`, `message` on a task | the date and text of its last comment |
| project `lastTaskId` | the number of stored tasks and subtasks |
| project `taskTypeCounts[].taskCount` | counted from the stored tasks, per task type |
| list `tasks` | counted from the stored tasks, per list |
| `_id` | built from the creation time and the task number, so a re-run recognises what is already stored |

A task created through the app after seeding fits in: on a project seeded with 200 tasks and 61 subtasks, `POST /api/v2/tasks` produced `SCL-262` with the next status index and the same stored fields as a seeded task.

Not seeded: history rows, notifications, unread counters, time logs, checklists and attachments.

### Isolation

Each company has its own MongoDB database, named by the company id. Everything above lives in the Scale Test company's database, plus these rows in the shared `global` database: the company, its storage bucket, the 31 users with their sign-in rows, and the sessions `--token` creates. On disk there is one folder, `storage/<company id>`.

- The company carries a mark, `scaleSeed: { by: 'seed-scale', anchor }`, and each user `scaleSeed: 'seed-scale'` and an address at `@scale-seed.test`.
- The seed writes to a company only through `openScaleCompany`, which reads the mark, the company name and the owner's mark first. No other id is ever written to.
- It refuses to start when a company named "Scale Test" exists without the mark, or when one of its addresses belongs to an account without the mark.
- `--drop` removes the marked company's database and folder and its own rows in `global`. A marked user who has since joined another company is kept.

## Seeding

```bash
npm run scale:seed -- --tasks 10000      # create the company, or top it up
npm run scale:seed -- --tasks 50000      # top the same project up to 50,000
npm run -s scale:seed -- --token         # a one-hour session token for the owner, on stdout
npm run scale:seed -- --drop             # remove the company and nothing else
```

Run them with Node 20 from the checkout the server runs from, so the storage folder lands where the server reads it. Seeding 10,000 tasks takes about ten seconds and 16 MB of data.

- Running the seed twice creates nothing new. A smaller `--tasks` than what is stored is refused; drop first.
- The owner signs in without a password: `--token` mints a session the way a password login does (the same approach as `npm run demo:token`, see [QA-DEMO-TEAM.md](QA-DEMO-TEAM.md)). The seeded passwords are random and are never shown or stored.
- To open the company in a browser, use the token as the `accessToken` cookie and set `userId` and `selectedCompany` in local storage; `scripts/scale/lib/browserProbes.js` does exactly that.
- Restart the server after `--drop`, so it forgets the company it had open.

## Measuring

```bash
npm run scale:measure                               # against http://localhost:4000
npm run scale:measure -- --base http://localhost:4000 --runs 20 --loads 5
npm run scale:measure -- --no-browser               # API timings only
npm run scale:measure -- --out results.json         # JSON to a file, the table to stdout
```

It needs a running server with a built frontend, and the seeded company. It prints a markdown table to paste under [Results](#results), then the same numbers as JSON.

**API timings** are plain HTTP requests with the owner's token, each run 20 times after 2 warm-up runs:

- the task queries the web app sends to `POST /api/v1/task/find`: one status group of the largest list (35 rows and a count), all six groups at once (what opening the List or the Board sends), a filter by assignee, a filter by priority and a name search (all three for the whole project and not paged, as the app sends them), and the List's subtask-progress `$group`;
- a count per status over the whole project, which the app does not send;
- the project load: `GET /api/v1/project` and the project's lists;
- the global search, `POST /api/v2/search`.

**Browser timings** use Playwright's Chromium, headless, one page at a time, at 1440 × 900. They run only when that browser is already installed; nothing is downloaded.

- *First rows* and *first cards*: from navigation to the frame after the one that first shows a task row or a card. Each view is loaded 5 times in a fresh page; the first load has an empty browser cache.
- *Status change*: from the click on a status in the picker to the row showing the new status, three times there and back on the first row, so the data ends as it started. The save request is timed separately.
- *Task panel*: from the click on a task name to the panel being visible, and to the task being shown in it.
- *Scroll*: frames per second while the list scrolls for 3 seconds, three times.
- *DOM nodes* and *JS heap*: after the view has loaded, read from the browser after a garbage collection.

A time is read inside the page at the start of the frame after the one that shows the change, so it includes the browser's layout and paint and is at most one frame (17 ms) late.

The server allows 1,000 API requests a minute per address (`GLOBAL_RATE_LIMIT_PER_MIN`). The script reads the allowance before each step and waits for the next minute rather than use the last 200, so a full run takes two to three minutes and does not lock anyone else out.

## Results

| Date | Build | Machine | Tasks | Metric | Median | p95 | Runs | Budget | Result | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: List first page (one status group, 35 rows) | 6.6 ms | 9 ms | 20 | < 300 ms | met | 35 rows, 47.2 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: List or Board open (all 6 status groups of one list, in parallel) | 15.2 ms | 22.7 ms | 20 | < 300 ms | met | 210 rows, 281.8 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Filter by one assignee (whole project, not paged) | 27.7 ms | 90.8 ms | 20 |  | no budget | 554 rows, 733.1 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Filter by priority High (whole project, not paged) | 111.6 ms | 160.5 ms | 20 |  | no budget | 2397 rows, 3094.4 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Search task names in the project for "login" (not paged) | 42.1 ms | 53.2 ms | 20 |  | no budget | 713 rows, 917.6 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Grouped query the List sends (subtask progress for one page) | 2.4 ms | 2.6 ms | 20 |  | no budget | 4 rows, 0.2 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Grouped query, tasks per status (whole project; the web app does not send it) | 23.5 ms | 27.5 ms | 20 |  | no budget | 6 rows, 0.1 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Project load (project list, cached by the server after the first call) | 1.3 ms | 1.5 ms | 20 |  | no budget | 1 row, 6.8 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Project load (lists of the project) | 6.4 ms | 9.9 ms | 20 |  | no budget | 20 rows, 6.6 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | API: Global search for "login" | 23.4 ms | 40.7 ms | 20 |  | no budget | 10 rows, 3.6 kB |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: first rows visible | 2267 ms | 2408.4 ms | 5 | < 1500 ms | missed by 767 ms | 210 rows shown; page scripts ready at 322 ms, task queries sent at 1720 ms and answered by 1770 ms; first load, with an empty browser cache, 2260 ms |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: DOM nodes after load | 31211 nodes | 31211 nodes | 1 |  | no budget |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: JS heap after load | 70.7 MB | 70.7 MB | 1 |  | no budget |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: scroll frame rate over 3 s | 60.1 fps | 60.1 fps | 3 | ≥ 50 fps | met | worst frame 17 ms, 9194 px to scroll |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: status change, click to visible change | 52.1 ms | 59.5 ms | 6 | < 150 ms | met |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: status change, the save request | 19.9 ms | 28.1 ms | 6 |  | no budget |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: open the task panel, click to panel visible | 71.4 ms | 95.1 ms | 3 | < 150 ms | met |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | List: open the task panel, click to the task shown in it | 103.7 ms | 202.9 ms | 3 |  | no budget |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | Board: first cards visible | 1370.4 ms | 1815.3 ms | 5 | < 1500 ms | met | 210 cards shown; page scripts ready at 299 ms, task queries sent at 655 ms and answered by 702 ms; first load, with an empty browser cache, 1370 ms |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | Board: DOM nodes after load | 24268 nodes | 24268 nodes | 1 |  | no budget |  |
| 2026-10-01 | 14.36.0-beta.672 | Apple M1 Pro, 8 cores, 16 GB, darwin 25.6.0 | 10000 | Board: JS heap after load | 69.8 MB | 69.8 MB | 1 |  | no budget |  |

The run: 10,000 tasks, 2,076 subtasks and 4,274 comments; the largest list ("List") holds 662 tasks and 137 subtasks. Server and MongoDB on the same machine, one-minute load average about 6 during the run, Chromium 153 headless, frontend built the same day.

### Reading the first run (2026-10-01)

**Met:** the first page of the task query (6.6 ms for one group, 15 ms for all six, against 300 ms), Board first cards (1.37 s, though one load in five took 1.8 s), the status change (52 ms), opening the task panel (71 ms), scrolling (60 frames a second).

**Missed:** List first rows, 2.27 s against 1.5 s, by 0.77 s.

**Not measured yet:** an inline edit other than the status, the filters and the search in the browser, anything at 50,000 tasks.

Where the List's 2.27 s goes:

| From | To | What |
| --- | --- | --- |
| 0 | 0.32 s | the page and its scripts |
| 0.32 s | 1.72 s | the app starts, then the List waits before asking for its tasks. The Board, after the same start, asks at 0.66 s. The difference is the fixed one-second timer in `ListView.vue` (`debouncer(1000)` in `init`) |
| 1.72 s | 1.77 s | the six task queries, 282 kB: 50 ms in the browser; the same six take 15 ms from a plain HTTP client |
| 1.77 s | 2.27 s | drawing 210 rows: 31,211 DOM nodes, about 150 a row |

The Board spends its time the same way without the timer: queries answered at 0.70 s, then 0.67 s drawing 210 cards (24,268 nodes).

So at this size the server and the payload are not the problem for first paint. The List is over budget because of a one-second wait it imposes on itself, and both views spend half a second or more drawing about 200 items.

Three things the numbers do not show on their face:

1. **Neither view loads the project.** Each asks for the first 35 tasks per status of one list, so first paint depends on the list (here 799 documents), not on the 12,076 in the project. MongoDB reads every task of that list through the `ProjectID, sprintId, deletedStatusKey` index and sorts them in memory to return 35; that is 10 ms here and grows with the list.
2. **The List cannot show the rest.** The "To Do" group says 165 and shows 35. Scrolling to the end loads nothing and there is no "load more". (The Board's code loads more as a column scrolls; this run did not exercise it.) The List meets its scroll budget on 210 rows, not on 10,000 tasks.
3. **Filters and search fetch the whole project in one answer.** A filter by priority High returns 2,397 full tasks, 3.1 MB, in 112 ms; MongoDB needs 14 ms of that (it reads all 12,076 tasks of the project), the rest is building and sending the answer. A name search returns 713 tasks, 0.9 MB. The browser then groups them itself, which this run did not time. These are the paths that grow with the project and the ones to watch at 50,000.
