# Progress: 052, industry demo experience

## Checklist

- [x] Explore the product, the live demo and the tenancy, agent, automation and UI code
- [x] Compare A and B and decide (A with process projects inside, one shared engine)
- [x] Engine, guard and command (`npm run demo:industries`)
- [x] Scenario files: TechNova, FinEdge, SwiftLogix, PeopleFirst
- [x] `simulated` on runs, proposals and comments, and the "Simulated" chip
- [x] Industry label in the workspace picker and switcher; banner links
- [x] Scenario coherence, guard, build and drop unit tests (`tests/demo-industries.test.js`), banner spec
- [x] Docs: `docs/DEMO-INDUSTRIES.md`
- [x] Seeded on a real database
- [x] Validated in the browser on a local build

## Log

### 2026-10-17
- Live demo checked through "Try the demo": one workspace, a "Development Project" of placeholder tasks, the setup checklist half done.
- Decision recorded in task.md. Building started the same day as the brief asked.
- Docker Desktop on this machine fails to start (stale `dockerInference` socket), so there was no local MongoDB. The owner supplied a demo database instead (the one demo.alianhub.com uses; its connection string is kept out of the repository).
- That database holds the live demo workspace, so the companies were seeded under a separate account (`demo.visitor@industries.demo.test`), not `DEMO_EMAIL`: the public demo is unchanged until the owner re-runs the command with `--owner` after this ships.
- First run (FinEdge alone) worked end to end. Found: a status name the company already has ("In Progress") keeps the company's spelling on the project while tasks stored the scenario's; tasks now take each status and type as the project stored it, by key.
- `--reset` then built all four: 25 people, 12 projects, 108 tasks, 25 agents, 14 automation runs (all `success`), 14 simulated runs, 11 pending proposals. Checked in the database: automations changed the tasks (status, priority, assignee, comment), every seeded run, agent comment and proposal carries `simulated: true` with zero spend, role agents are paused with a $2 cap, the guide page id is on each company's marker.
- Tests: the new backend file (25) and frontend spec (6) pass. The full suites fail some files on this Windows worktree; the same files fail on a clean checkout of the base commit (line endings, paths, timeouts), and the rest pass when run on their own. No failure is new.
- A local server against the shared database runs with `MIGRATIONS_AUTO=false`, `CRON_ENABLED=false`, `AUTOMATION_QUEUE_DRIVER=inline` and `KNOWLEDGE_INDEXER=off`, so it neither migrates the live demo nor picks up its jobs.

- Browser check on a local build against the same database (signed in with "Try the demo"): the workspace picker lists the four companies with their industry; the banner shows the industry, Guide and Switch industry; Home shows the proposals waiting with the Simulated chip; the AP board, task panel (custom fields, checklist, agent comment marked Agent and Simulated, automation comment), Inbox approvals, AI agents, run page, Goals and Automations all show the seeded story.
- Done for real in the browser: approving the Reconciliation Checker's proposal set INV-4531 to High and posted the comment, with Undo; moving INV-4536 to Exception through the list's status menu made the running server fire its automation; Run now on the Engineering Daily Digest posted a digest counted from the board, with no model and no spend.
- Fixed from the browser check: the guide showed raw markdown (the app's converter has no bold or tables), so the seed writes its own editor blocks with tables and callouts; rule sentences read "changes to undefined" until the condition carried its status label; an agent comment read "(edited)" because the simulated flag was a second write (now written without touching updatedAt); docs take visibility project or private, not workspace; the Home "Waiting on you" card had no Simulated chip; the digest agents proposed their comment instead of posting it (now at "Acts, you approve the rest"); the guide named an "AI menu" that does not exist (now AI, Agents, Run now); the workspace set-up checklist is dismissed for the account the seed makes.
- Validated against the owner's demo database rather than an empty local one (no local MongoDB on this machine). A second plain run created nothing; `--reset` removed and rebuilt all four, removing the demo account with the last company that held it.
- Seen but not caused by this work: in the browser pane, a list or task status menu opens at the far right edge of the viewport; the item had to be triggered by script.

### 2026-10-19
- Merged into `staging` in [#1696](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/1696) (build 7, `14.40.0-beta.7`), together with tasks 053 and 054; the beta log records the build in the follow-up docs PR.

## Last step

Done. On the live demo, run `npm run demo:industries -- --owner <DEMO_EMAIL>` (with the `--only` list the database can hold; see `docs/DEMO-INDUSTRIES.md`) once the release is deployed; until then the industry companies there belong to `demo.visitor@industries.demo.test`.
