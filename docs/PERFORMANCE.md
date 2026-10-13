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
| Everything: first usable paint (first task rows visible), ungrouped and grouped | under 1.5 s |
| Everything API: every request the page makes (a first page, the counts of a grouping, one page of a group) | under 300 ms |

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

**Optional: many small projects.** One project does not exercise a read across projects, which names every project the person can open. `--small-projects N` (1 to 500) adds N projects beside the big one, in the same company: "Scale Small 001" (key `SS001`) onwards, each with one list and ten tasks (the first ten the generator makes, which have no subtasks), no comments and no custom fields. Only the owner is put on them; their tasks are assigned to the company's members. It needs the company to exist, creates only what is missing, and is removed by `--drop` with everything else.

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
npm run scale:seed -- --small-projects 300   # add 300 small projects to the same company
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
npm run scale:measure -- --only everything          # the Everything endpoint and page, nothing else
npm run scale:measure -- --no-explain               # without the query plans
```

It needs a running server with a built frontend, and the seeded company. It prints a markdown table to paste under [Results](#results), then the same numbers as JSON.

**API timings** are plain HTTP requests with the owner's token, each run 20 times after 2 warm-up runs:

- the task queries the web app sends to `POST /api/v1/task/find`: one status group of the largest list (35 rows and a count), all six groups at once (what opening the List or the Board sends), a filter by assignee, a filter by priority and a name search (all three for the whole project and not paged, as the app sends them), and the List's subtask-progress `$group`;
- a count per status over the whole project, which the app does not send;
- the project load: `GET /api/v1/project` and the project's lists;
- the global search, `POST /api/v2/search`.

**The Everything view** (`POST /api/v2/tasks/everything`) is measured with the requests the page itself builds (`frontend/src/views/Everything/everythingRequest.js`), one at a time with a 50 ms pause between calls:

- the first page with no filter, 50 rows and the total, newest first;
- the counts alone for a grouping by status, by assignee, by project and by due date, which is what a grouped view sends first;
- a first page filtered by one assignee, with done work hidden (the page's default), searching names for "login", and searching for a word no task has, which makes the server read every task;
- a first page sorted by due date, and one with subtasks shown;
- every page of the largest status group, following the cursor to the end: the time per page, and whether each row came exactly once.

Beside each time the script prints what MongoDB did for the same request. It builds the pipelines with the server's own query builder (`Modules/Tasks/helpers/everythingQuery.js`) for the projects the owner can open, runs `explain('executionStats')` on them through the driver, and reports the index used, whether the order came from the index or from a sort in memory, and how many index keys and documents were read for the rows returned. Explain runs the query and writes nothing. A server older than the Everything view is reported as "not measured" and the rest of the run goes on.

**Browser timings** use Playwright's Chromium, headless, one page at a time, at 1440 × 900. They run only when that browser is already installed; nothing is downloaded.

- *First rows* and *first cards*: from navigation to the frame after the one that first shows a task row or a card. Each view is loaded 5 times in a fresh page; the first load has an empty browser cache.
- *Status change*: from the click on a status in the picker to the row showing the new status, three times there and back on the first row, so the data ends as it started. The save request is timed separately.
- *Task panel*: from the click on a task name to the panel being visible, and to the task being shown in it.
- *Scroll*: frames per second while the list scrolls for 3 seconds, three times.
- *DOM nodes* and *JS heap*: after the view has loaded, read from the browser after a garbage collection.
- *Everything, first rows*: the same measurement on `/#/<company>/everything`, to the first task row, three ways: a first visit (the browser holds nothing, so the page reads the person's saved views before its tasks; that request is not counted as a task query), and the page as the browser kept it grouped by status and grouped by project. Beside each: how many task queries the page had sent and how many rows it had drawn once it was quiet.

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

## The Everything view

Measured on 2026-10-01 against build 14.36.0-beta.752 (Apple M1 Pro, 8 cores, 16 GB; server and MongoDB 7.0 on the same machine, one-minute load average 4 to 6; Chromium 153 headless), signed in as the company's owner, who can open every project. Twice: with the one project of 10,000 tasks and 2,076 subtasks, and again after `--small-projects 300` (301 projects, 13,000 tasks, the same subtasks).

### The endpoint

20 runs after 2 warm-ups, one request at a time. Budget: 300 ms on the median.

| Request | One project: median (p95) | 301 projects: median (p95) | Answer | Result |
| --- | --- | --- | --- | --- |
| First page, no filter, newest first (50 rows and the total) | 38.5 ms (46.1) | 59.2 ms (64.8) | 30.8 kB | met |
| Counts by status | 39.4 ms (47.0) | 61.0 ms (67.0) | 2.8 kB | met |
| Counts by assignee | 37.3 ms (49.2) | 58.3 ms (74.7) | 4 kB | met |
| Counts by project | 33.1 ms (39.2) | 76.2 ms (82.9) | 2.7 kB, **537.6 kB** with 301 projects | met |
| Counts by due date | 40.5 ms (47.8) | 72.3 ms (77.4) | 14 kB | met |
| First page, one assignee | 21.5 ms (33.1) | 37.0 ms (48.9) | 31.3 kB | met |
| First page, done work hidden (the page's default) | 33.2 ms (40.9) | 60.9 ms (65.0) | 30.8 kB | met |
| First page, names searched for "login" | 30.0 ms (34.9) | 63.5 ms (66.0) | 30.2 kB | met |
| A search that matches nothing | 25.6 ms (28.8) | 59.3 ms (63.4) | 0.1 kB | met |
| First page sorted by due date | 31.4 ms (41.0) | 62.0 ms (66.9) | 30.9 kB | met |
| First page with subtasks shown | 25.2 ms (29.5) | 62.5 ms (67.5) | 31.8 kB | met |
| Paging one status group to its end, per page | 17.8 ms (32.8), 47 pages | 64.6 ms (74.0), 71 pages | every row once | met |

A first run with 301 projects, a few minutes earlier, gave 45 to 74 ms for the same requests; the table is the second.

What MongoDB did for them (`explain`, the same pipelines the server builds):

| Part | One project | 301 projects |
| --- | --- | --- |
| The rows of a first page | `ProjectID, deletedStatusKey, updatedAt, _id`, **order from the index**: 74 documents read for 51 returned (68 by due date, 84 with done work hidden, 1,214 for "login") | the same index, **sorted in memory: all 15,076 documents read** for 51 returned (12,636 by due date) |
| The total, or the counts of a grouping | every matching document: 12,076 read | every matching document: 15,076 read |
| One assignee | `AssigneeUserId`, sorted in memory: that person's 510 documents | the same |
| A search with no match | all 12,076 read, twice (rows and total) | all 15,076 read, twice |
| A later page | 222 documents read for the last page | sorted in memory: everything older than the cursor; 98 documents for the last page |

### The page

5 loads in a fresh page, 1440 × 900. Budget: 1.5 s on the median. Measured with 301 projects (the first visit also with one project: 557 ms).

| Opened as | First rows: median (p95) | Task queries until quiet | Rows drawn | DOM nodes | JS heap | Result |
| --- | --- | --- | --- | --- | --- | --- |
| A first visit, ungrouped | 526 ms (778) | 1 | 50 | 2,160 | 20.9 MB | met |
| Grouped by status | 666 ms (958) | 6 | 250 | 8,800 | 32.5 MB | met |
| Grouped by project | 648 ms (830) | 10 | 130 | 8,983 | 29.4 MB | met |

A first visit: scripts ready at 0.29 s, the task query sent at 0.41 s and answered by 0.49 s, rows on screen at 0.53 s. A row is about 43 DOM nodes; a List row is about 150.

### Reading it

**Every budget is met, with room: the slowest request is a quarter of its budget and the slowest first paint under half.** Nothing had to change for the view to meet its budget at 10,000 tasks. What was expected before the run, and what it showed:

| Expected | Found |
| --- | --- |
| One project: order from the index, about 60 documents for a page | yes: 74 |
| More than 200 projects: sorted in memory, every task read for one page | **yes.** MongoDB keeps the order by merging one index range per project and stops doing that above 200 (`internalQueryMaxScansToExplode`). A page costs 65 ms instead of 18 |
| Counts read every task; 20 to 80 ms | yes: they are most of a first page's time even with one project, where the rows need 74 documents and the total 12,076 |
| Counts by project with hundreds of projects: a large answer | **yes: 537.6 kB.** Fixed, below |
| A search with no match is the worst case for a page | no worse than any other request once the sort is in memory; with one project it is cheap (26 ms) |
| Paging stays flat | yes, and gets cheaper towards the end; every row came once |
| The page waits for its saved views before asking for tasks | it costs about 15 ms: the query leaves at 0.41 s on a first visit and at 0.39 to 0.40 s when the browser kept the page |
| A grouped view loads every group on screen at once | by status, yes: all five groups, 250 rows. By project it stops at nine groups, because the rows that arrive push the other headings off screen |

**Changed: a project that is only counted is sent as a heading.** Grouping by project named every counted project with a whole card: statuses, task types, apps and edit rights. The page reads those from the cards that come with the rows it draws and never from this answer. A counted project now carries its name, code, icon, state and whether it is personal; a project with a row on the page still carries the whole card. Timed inside the server process against the same data, since the running build does not have the change:

| Counts by project, 301 projects | Before | After |
| --- | --- | --- |
| Answer | 537.6 kB | 76.2 kB |
| Handler and JSON, median of 20 | 66.1 ms | 53.0 ms |

**Not changed: the sort in memory above 200 projects.** An index that leads with the sort key, `{ deletedStatusKey, updatedAt, _id, ProjectID }` and its due-date twin, would give the order back. It is not added, for three reasons: the requests it would speed up take 60 ms against 300; the counts read every task either way, so a first page would keep most of its cost; and it is two more indexes to maintain on every task write in every company, one of them on a field that changes with each write. From these two runs a first page costs roughly 15 ms plus 3 ms for each 1,000 tasks and subtasks the person can see when they are spread over more than 200 projects, so the budget is reached somewhere near 90,000, and by then it is the counts that need attention first (an index that covers them, or counts kept as tasks change). That is an estimate from two sizes, not a measurement.

**Not measured:** anything at 50,000 tasks; a person who can open only some projects (the owner opens all, so the access rules add nothing here); the Board and Table modes in the browser; the grouped page with one project; the page after the change above, which needs a frontend build only to show the smaller answer on the wire.

## First-load size

What a browser must download before it can draw anything: the files `index.html` names, which are the entry script (`js/app.*.js`), the initial vendor script (`js/chunk-vendors.*.js`) and their two stylesheets. Everything else is a chunk fetched when a screen asks for it.

**Budget: 2,270,000 bytes**, uncompressed, for those four files together. The number lives in `frontend/firstPaintBudget.js` and nowhere else; `frontend/vue.config.js` hands it to webpack (`performance.maxEntrypointSize`, `hints: 'error'`), so a production build that goes over fails and names the files. It is the measured size plus ten percent. Chunks fetched later are not budgeted.

Measured on 2026-10-01 with one production build before and one after the change, in bytes:

| File | Before | After | After, gzipped |
| --- | --- | --- | --- |
| `js/chunk-vendors.*.js` | 3,648,627 | 643,751 | 202,125 |
| `js/app.*.js` | 2,704,288 | 1,380,079 | 479,998 |
| `css/chunk-vendors.*.css` | 140,863 | 117,582 | 21,820 |
| `css/app.*.css` | 595,624 | 198,401 | 37,045 |
| **First load** | **7,089,402** | **2,339,813** | **740,988** |

Gzipped, the first load was 2,131,233 bytes before. `en.js` is 533 kB of the entry that remains.

The chunks that took the rest, fetched when a screen needs them:

| Chunk | Bytes | What it holds |
| --- | --- | --- |
| `charts` | 578,218 | apexcharts |
| `xlsx` | 431,587 | the spreadsheet reader |
| `formkit` | 407,545 | FormKit and its Pro inputs |
| `task-detail` | 286,026 | the task panel; the block editor, attachments and recording sit in shared chunks loaded with it |
| `custom-fields` | 243,708 | the field components |
| `grid-layout` | 141,578 | the dashboard grid |
| `date-picker` | 138,757 | the calendar date picker |
| `dashboard-cards` | 116,240 | the legacy dashboard's cards |
| `user-import` | 61,888 | the user import screen |

### What keeps it small

| Rule | Where |
| --- | --- |
| One language at a time: English in the entry, every other language a `locale-<code>` chunk | `src/utils/localeLoader.js` |
| Libraries only some screens draw with are registered by name behind a loader: charts, the calendar date picker, the dashboard grid | `src/config/lazyGlobals.js` |
| The task panel is a chunk (`task-detail`); its host stays in the shell | `TaskDetailOverlay/lazyPanel.js` |
| Plugin components are registered behind loaders: fields (`custom-fields`), dashboard cards (`dashboard-cards`), the two import screens | each `src/plugins/*/*Plugin.js` |
| FormKit is installed on the running app when a field first draws with it | `src/plugins/customFieldView/lazyFormKit.js` |
| The spreadsheet reader is fetched when a file is picked | `src/utils/loadXlsx.js` |
| moment ships without its locale files; the app never switches moment's locale | `vue.config.js` |
| Every route is a dynamic import | `src/router/` |
| The shell's command palette, quick create, task-template and AI-field dialogs and the notepad, clips, recorder and talk-to-text panels are chunks that draw nothing until opened; a failed fetch shows the general error toast | `src/config/shellParts.js`, `src/config/lazyShell.js` |
| `sweetalert2` is fetched the first time a confirmation is asked for | `src/utils/lazySwal.js` |

The task panel, the field components, FormKit and the shell parts above are needed within the first minute of nearly every session, so `src/config/warmChunks.js` fetches them once the shell is up and the browser is idle. They no longer hold up the first paint, and opening a task does not wait on the network.

`tests/unit/firstPaintSet.spec.js` walks the plain imports from `src/main.js` and fails when one of those libraries, the task panel, a plugin screen or a second language is reachable again without a dynamic import. That catches the cause without a build; the budget catches the size.

### Left in the first load, and why

| What | Why |
| --- | --- |
| `locales/en.js` | the fallback language; every missing key reads from it |
| The shell: rail, reminders panel, call overlay | drawn or listening on every signed-in screen |
| The tour (`driver.js`) | the shell provides it as a ref that screens call without waiting |
| `moment`, `axios`, `socket.io-client`, `lodash/isEqual` | used by the store, the request layer or the shell itself |
| Images under 8 kB stay inlined as data URLs | `WasabiIamgeCompp`, `wasabVideo`, `wasabAudio` and `MainChatAvatar` tell a bundled image from a stored path by its `data:` prefix. The default avatar, the priority icons and the default status icon are drawn only because they are inlined; lowering the limit would turn them into storage lookups |

### Moving a component out of the first load changes where its styles sit

The entry's stylesheet ends with the global sheets (`assets/css/index.css` and what it imports), so in the first load a utility class beats a component's own unscoped rule of the same weight. A chunk's stylesheet is added to the page later, after the global sheets, and there the component's rule wins instead. An element that carries both a utility and a component class which set the same property will change when its component moves.

When these components moved, thirteen such rules were found by comparing each moved component's rules with the global sheets, and each was made independent of the order: the component's declaration was removed where the utility is always present, or scoped with `:where(:not(.utility))`, which adds no weight. The comparison reads the class names written in a template and misses classes built at run time, so a moved screen still deserves a look.

### When the build fails on the budget

Find what entered the first load before raising the number: `firstPaintSet.spec.js` usually names it. Reach a library through `import()` at the place it is used, or register a component with `defineAsyncComponent`. Raise the budget only for something every first paint needs, and write the new measurement here.

To measure: `cd frontend && npx vue-cli-service build --dest /tmp/ah-size`, then add up the sizes of the `src` and `href` files in `/tmp/ah-size/index.html`.
