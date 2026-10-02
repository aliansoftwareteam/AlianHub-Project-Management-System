# Handoff — where to start next session

Updated 2026-10-02 01:10 IST. Read this first, then `Tasks/index.md` and the two `progress.md` files named below. Overwrite this file at the end of every session.

## State

- **Two tasks are in hand.**
  - Task 047, "AI-run" (`Tasks/active/047-ai-run/`): the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP (decision 30, confirmed by the owner). New agent slots go here.
  - Task 046, "great next to ClickUp" (`Tasks/active/046-better-than-clickup/`, tracker AP-441): no new parity features; fixes, proof and the held PRs remain.
  - In each folder, `progress.md` has every slice with its PR and build, the decisions and the open decisions for the owner. In 046, `followups.md` has what each PR left ("Added at build 766" is the newest part) and `dogfood-findings.md` has the hand-check sweeps.
- **`beta` is at build 766** (`14.36.0-beta.766`, #1405).
- **Live on localhost: build 766** (rebuilt at 00:56; migrations through 070 applied, none pending). Nothing is merged and not built.
- Hand-checked: builds 757, 759, 762, 764, 765 and 766, by the Supporter session. Nothing that needs a connected AI has been used by hand: the MCP flags are off locally.
- The next free migration number is 071. Check the open PRs before taking it.
- `docs/API.md` and `docs/api/openapi.json` are in sync with build 766 once this docs PR merges.

## Merged since the last handoff (builds 759 to 766)

| Build | PR | What it carried |
|---|---|---|
| 759 | #1357, third batch | #1344, #1355, #1345, #1352, #1346, #1347, #1348, #1349, #1350, #1351, #1354 and the calendar dark fix |
| 760 | #1376 | A draft PR skips the suites until it is marked ready |
| 761 | #1378, fourth batch | #1356, #1358, #1362, #1365, #1367, #1368, #1369, #1371, #1372, #1374, #1375 |
| 762 | #1395, fifth batch | #1360, #1363, #1366, #1373, #1377, #1379, #1381, #1382, #1384, #1385, #1388; and 047: #1380, #1383, #1386, #1387, #1390, #1391, #1392, #1393 |
| 763 | #1394 | 047 AI-4c, a project's policy for agents |
| 764 | #1399, sixth batch | #1359; and 047: #1396, #1397, #1398 |
| 765 | #1401, seventh batch | #1370 (the sample project); 047: #1400 |
| 766 | #1405, eighth batch | 047: #1402, #1404 |

The access fixes among them are listed by title in 046's `progress.md`; the detail is in the private notes.

## Open

| PR | What | State |
|---|---|---|
| #1408 | The ninth combined PR: #1406 (047 AI-5 part 2, "Always do this") and #1407 (047 S-3, plain words) | In CI. Its frontend round failed once and was fixed |
| #1409, #1410 | 047 T-4 (agent work visible) and T-2 (the connected AI as a member) | Drafts. Both are merged into `chore/integrate-batch-10`, which is pushed and has no PR yet. Open it when #1408 merges |
| #1389 | The Supporter's panel fixes: title saves on blur, panels follow their route, the bare avatar request, Undo on remove | Draft. The Supporter's notes call it final; the coordinator's log did not. Confirm, then batch it |
| #1403 | The Add View menu stays inside the window | Draft, final by the Supporter's notes. Not in the coordinator's log; batch it |
| #1361 | A cloud run's e2e flows, batch 2 | Written on an older base; its backend and e2e checks failed. A local agent must bring it up to date |
| #1364 | A cloud run's API reference catch-up | Replaced by this docs PR. Close it |
| #1306 | The installable app shell | Held: it merges alone, after its own rebuild and the 14 checks in `.claude/test-cases/PWA.md`. Its offline list must add the chunks #1351 split out |
| #1210 | Colours and legacy classes may only shrink | Held until the visual PRs are in; then regenerate its baseline once |
| This PR | Task docs, the beta log, the API reference, this handoff | Draft |

## Running when this was written

- No local agent was running. The coordinator held three to five overnight, to keep the weekly plan limit (24% at 01:00, about 2% an hour; extra usage is off).
- The Supporter session was sweeping build 766 and owed its write-up of the sweeps of batches 4 to 7; that write-up is now in 046's `dogfood-findings.md`.
- An advisor session answers product and plan questions while the owner is away. It cannot approve money, credentials, permanent deletion, outside messages or loosening security.
- The six cloud runs each opened a PR: four are merged (#1359, #1360, #1363, #1370), #1361 is open and #1364 is replaced. One duplicate of the moved-clock run could not be stopped from the session; the owner can stop it on claude.ai.

A new session cannot see other sessions' agents. Find their work with `gh pr list --base beta` and `git branch -r --sort=-committerdate`, and read each worktree under `.claude/worktrees/` before starting the same work again. The session's scratch folder (the queue scripts, the agent log) is wiped by a restart.

## The combined-PR method

1. Make a branch from `origin/beta`, or from the batch before it, in its own worktree (`chore/integrate-batch-N`).
2. Merge each PR's head into it with a commit titled `Merge pull request #N from <branch>`. For a stack, merge only the top.
3. Resolve conflicts by keeping both sides (registries, locales, route lists, events that need both a company and an actor). A defect only the combination shows gets its own commit.
4. Before the push, run on the combined branch:
   - each merged PR's own test files, and every frontend spec that mentions a changed file;
   - `tests/permission-task-write-keys.test.js` and the conventions project;
   - `node scripts/env-doc.js --check` and `npm run i18n:check`.
5. Push, open one PR that is not a draft, and queue it. Agents' own PRs stay drafts, so the suites run once.
6. The queue merges a PR only when it is not a draft and its backend, frontend and e2e checks succeeded. A skipped check is not a pass. A PR that changes only notes is merged by hand.
7. After the merge: check that each included PR shows as merged, rebuild the local server, check migrations and Home, say which build is live, and give the Supporter the list to sweep. Then `npm run version:log` and `npm run api:doc` in the next docs PR.

Push a batch only after the one below it has merged, so its diff is its own. An access fix can be queued alone ahead of a batch.

## Standing owner rules

- **Eight agents on the PC**, plus cloud runs for work that needs only the repository. Start the next one only when one finishes. Pace to the weekly plan limit.
- **Decisions in two lines.** Put the choice first.
- **Say what is live.** After every merge and every rebuild, say which build runs on localhost and what is merged but not built.
- **Say which task and slice** a piece of work belongs to when it starts, and keep the tracker current.
- **Credentials are typed by the owner only.** Build up to the sign-in step, then say so.
- **Security detail stays out of this repository.** An access fix pushes its test and its fix together, with neutral titles and text.
- **Keep working without asking.** Take product and plan decisions, record them, keep them reversible. Stop only for money, permanent deletion, credentials, messages to outside people, or loosening security.
- **Work targets `beta`.** One PR per change, no direct pushes, Conventional Commit titles, checks green before a merge.
- **Done means used.** A slice is done after its main flow is used on the local build. Green CI is not enough.
- **Light load.** An agent runs only the test files it touched, one worker. No full suites, no build, no `npm ci`. Node 20 for everything.
- **No new feature wave while more than 15 merged builds are unused**, and no more parity features in new slots.

## Waiting for the owner

The full lists are "Open decisions for the owner" in 046's `progress.md` and "Needs the owner" in 047's. The ones that block work:
1. Turn on `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` in the local `.env` and connect their Claude with the manage grant. 047's AI-4a, AI-4e and AI-1 wait for it, and so does every hand check of an MCP slice.
2. A new account, for the newcomer tests (047 S-6).
3. A second person for two hand checks: unread counts, and a doc as a view-only reader.
4. The Slack app and its `.env` lines (#1350 is live locally), and a Google client for connector slice 3 (#1381).
5. Close more than 86 tracker subtasks of merged PRs: an agent cannot set Done.
6. Stop the duplicate cloud session.
7. Money: a paid CI plan (recommended: stay on Free), and extra usage on the Claude plan.
8. Still undecided: `STORAGE_DOWNLOAD_SCOPE=enforce`, `PERMISSION_ENFORCEMENT_MODE=enforce`, the MCP flags on by default (an access review first), the default of new date fields, the Talk to Text price, `git config user.name` and `user.email` on this Mac.

## Private notes

Access findings and their state are in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/2026-10-01/`. Read that folder before working on any access item. Nothing from it is copied here.

## Next steps, in order

1. Merge #1408 when green; rebuild; say which build is live. Open the tenth combined PR from `chore/integrate-batch-10` (#1409, #1410), add #1389 and #1403 once confirmed final, and merge it.
2. Close #1364 with a note that this docs PR replaced it.
3. Give the Supporter the sweep list for batches 9 and 10, and the "By hand, not done yet" list in 046's `followups.md`.
4. 047, without the owner: T-5, S-2, AI-2 in the web app, AI-3 automations, more plain-words batches, the AI-1 and S-6 sheets as writing.
5. Fix the open defects from the sweeps (046 `followups.md`, "Added at build 766"): offline instant edits first, then the import update that does not refresh an open page, and the timer that loses its time when its week is approved.
6. Bring #1361 up to date with a local agent.
7. When the owner has switched the flags on: AI-4a, AI-4e, then the first AI-1 run.
8. Merge #1306 alone, after its hand check. Regenerate #1210's baseline and merge it. Give the screenshot check its baseline (`npm run visual:accept -- <run id>`).
9. A third benchmark run, on a build with the fixes of run 2; update `scorecard.md`; ask the owner to sign off M1 and M2.

## Learned on the night of 2026-10-01 to 02

- **A skipped check is not a pass.** #1394 was merged on a draft's skipped suites. Its own run passed afterwards; the queue script was fixed.
- **A spec that mounts `App.vue` must mock `@/config/warmChunks`.** It failed three batches. A mock whose factory imports the module it mocks hangs.
- **Never add a helper as a method of the task write mixins** (`Modules/Tasks/helpers/taskMongo/`): every method there is a task action. `tests/permission-task-write-keys.test.js` catches it.
- **A cloud PR written on an older base must be merged again by a local agent** that knows the day's rules. #1370 needed it; #1361 still does.
- **A cloud run is started with no schedule and then run.** A scheduled one that is also run by hand fires twice. Its brief must say to use no connector tools.
- **Small, tight briefs are cheap**, and agents report in at most 30 lines; the detail goes in the PR body.
- **After a fix push to a queued PR, wait about a minute** before restarting the queue runner, or it reads the old failed check.
- **Draft PRs skip the suites** (#1376). CI went from a queue of 12 runs to one run per batch of about 14 minutes.
- **The Claude plan's weekly limit is the real ceiling:** about 2% an hour at three to four agents.
- Earlier lessons (the two plan limits, the load test, the pinned-clock test, `/usr/bin/grep`, the jest argument order) are in the handoff of build 758: `git show 69a9a70be:Tasks/HANDOFF.md`. The history back to build 303 is in `git show ea651ebae:Tasks/HANDOFF.md`.

## Handy commands

```bash
npm run nodemon             # backend on :4000 under Node 20
npm run version:show
npm run version:log         # after merges, then commit docs/BETA-LOG.md
npm run api:doc             # after merges that add or change a route
npm run migrate -- status
npm run api:doc:check && node scripts/env-doc.js --check && npm run i18n:check
npx jest <file> --selectProjects unit --maxWorkers=1
cd frontend && npx vitest run <file> --maxWorkers=1 --minWorkers=1
```
