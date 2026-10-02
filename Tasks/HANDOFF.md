# Handoff: where to start next session

Updated 2026-10-02 11:20 IST. Read this first, then `Tasks/index.md` and the two `progress.md` files named below. Overwrite this file at the end of every session.

## State

- **Two tasks are in hand.**
  - Task 047, "AI-run" (`Tasks/active/047-ai-run/`, tracker AP-441): the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP (decision 30). New agent slots go here.
  - Task 046, "great next to ClickUp" (`Tasks/active/046-better-than-clickup/`, tracker AP-441): no new parity features; fixes, proof and the held PRs remain.
  - In each folder, `progress.md` has every slice with its PR and build, the decisions and what waits for the owner. 047 also has `ai-benchmark.md` (the sheet for AI-1, with its gaps marked at build 772) and `newcomer-test.md` (the script for S-6).
- **`beta` is at build 772** (`14.36.0-beta.772`, #1434). This docs PR becomes the next build.
- **Live on localhost: build 772.** The server's `/version` answered 772 at 11:15. Nothing is merged and not built. No migration was added in builds 767 to 772; the next free number is still 071. Check the open PRs before taking it.
- **Hand-checked:** up to build 769 (the Supporter's seventh sweep). **Not hand-checked:** builds 770, 771 and 772. Nothing that needs a connected AI has been used by hand: the MCP flags are off locally.
- `docs/API.md` and `docs/api/openapi.json` are in sync with build 772 once this docs PR merges. The seven routes added since build 766 are described.

## Merged since the last handoff (builds 767 to 772)

| Build | PR | What it carried |
|---|---|---|
| 767 | #1408, ninth batch | 047: #1406 ("Always do this", decline notes), #1407 (plain-words test, batch 1) |
| 768 | #1411 | The docs PR for builds 759 to 766 |
| 769 | #1412, tenth batch | 047: #1409 (agent work in view), #1410 (the connected AI as a member). 046: #1389, #1403 |
| 770 | #1417, eleventh batch | 047: #1414 (several agents at once), #1413 (create where you are), #1415 (plain words, batch 2) |
| 771 | #1428, twelfth batch | 047: #1419 (the two sheets), #1420 (`project.setup`), #1421, #1423 (automations by proposal), #1424. 046: #1418 (sweep 3), #1422 (the kept timer) |
| 772 | #1434, thirteenth batch | 047: #1425, #1426, #1427 (a wide batch waits), #1429 (read tools), #1430 (an agent's change shown, with Undo), #1431, #1433 (`project.create`). 046: #1432 (sweep 7) |

Each PR's own title is in `docs/BETA-LOG.md` or on GitHub. The reversible choices they made are in 047's `progress.md`, under "Decisions taken on 2026-10-02" and "Choices to review".

## Open

| PR | What | State |
|---|---|---|
| #1435 | The fourteenth combined PR: #1361 (browser tests, batch 2) and #1210 (colours and legacy classes may only shrink) | Not a draft. Backend, frontend and e2e were running at 11:15 |
| #1416 | Browser tests of the AI-run screens | Not a draft. Backend passed; frontend and e2e were running |
| #1436 | "fix(agents): a project's agent settings and a proposal's decision each have one road" | Not a draft. Its checks were running |
| #1306 | The installable app shell | **Held.** It merges alone, after its own rebuild and the 14 checks in `.claude/test-cases/PWA.md`. Its offline list must add the chunks #1351 split out |
| #1364 | A cloud run's API reference catch-up | Replaced by #1411. Still open: close it |
| This PR | Task docs, the beta log, the API reference, this handoff | Not a draft, docs only |

## Running when this was written

- A coordinator session ran a wave of local agents. This file was written by one of them and cannot see the others.
- Find their work with `gh pr list --base beta` and `git branch -r --sort=-committerdate`, and read each worktree under `.claude/worktrees/` before starting the same work again. The session's scratch folder is wiped by a restart.
- The Supporter session does the hand checks. Its last recorded sweep is build 769.

## The combined-PR method

1. Make a branch from `origin/beta`, or from the batch before it, in its own worktree (`chore/integrate-batch-N`).
2. Merge each PR's head into it with a commit titled `Merge pull request #N from <branch>`. For a stack, merge only the top.
3. Resolve conflicts by keeping both sides (registries, locales, route lists). Locale pending files are joined key by key. A defect only the combination shows gets its own commit.
4. Before the push, run on the combined branch: each merged PR's own test files and every frontend spec that mentions a changed file; `tests/permission-task-write-keys.test.js` and the conventions project; `node scripts/env-doc.js --check` and `npm run i18n:check`.
5. Push, open one PR that is not a draft, and queue it. Agents' own PRs stay drafts, so the suites run once.
6. The queue merges a PR only when it is not a draft and its backend, frontend and e2e checks succeeded. A skipped check is not a pass.
7. After the merge: check that each included PR shows as merged, rebuild the local server, check migrations and Home, say which build is live, and give the Supporter the list to sweep. Then `npm run version:log` and `npm run api:doc` in the next docs PR.

Push a batch only after the one below it has merged, so its diff is its own.

## Standing owner rules

- **Eight agents on the PC**, plus cloud runs for work that needs only the repository. Pace to the weekly plan limit.
- **Decisions in two lines.** Put the choice first.
- **Say what is live.** After every merge and every rebuild, say which build runs on localhost and what is merged but not built.
- **Say which task and slice** a piece of work belongs to when it starts, and keep the tracker current.
- **Credentials are typed by the owner only.** Build up to the sign-in step, then say so. No agent edits the owner's `.env`.
- **Security detail stays out of this repository.** An access fix pushes its test and its fix together, with neutral titles and text.
- **Keep working without asking.** Take product and plan decisions, record them, keep them reversible. Stop only for money, permanent deletion, credentials, messages to outside people, or loosening security.
- **Work targets `beta`.** One PR per change, no direct pushes, Conventional Commit titles, checks green before a merge.
- **Done means used.** A slice is done after its main flow is used on the local build. Green CI is not enough.
- **Light load.** An agent runs only the test files it touched, one worker. No full suites, no build, no `npm ci`. Node 20 for everything.
- **No new feature wave while more than 15 merged builds are unused**, and no more parity features in new slots.

## Waiting for the owner

The full lists are "Needs the owner" in 047's `progress.md` and "Open decisions for the owner" in 046's. The ones that block work:
1. **The MCP flags and a connected Claude.** Turn on `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` in their own local `.env`, restart, and connect their Claude with the manage grant. 047's AI-4a, AI-4e and the first AI-1 run wait for it, and so does the hand check of sixteen MCP slices. For benchmark job 3 the connection also needs the chat permission ticked and approved.
2. **A new account**, for the newcomer test (047 S-6, `newcomer-test.md`).
3. **The one-week trial** on AlianHub's own project, with the project on "propose everything".
4. **The tracker subtasks.** An agent cannot set a subtask to Done, so the subtasks of merged PRs wait for the owner to close them (more than 86 at build 766, more since).
5. **#1306, the held PWA pull request:** it needs its own rebuild and the hand check before it merges alone.
6. Which fifteen benchmark jobs count (047 row 15). The sheet's own pick stands until the owner says.
7. A second person for two hand checks: unread counts, and a doc as a view-only reader.
8. The Slack app and its `.env` lines, and a Google client for connector slice 3 (#1381).
9. Money: a paid CI plan (recommended: stay on Free), and extra usage on the Claude plan.
10. Still undecided: `STORAGE_DOWNLOAD_SCOPE=enforce`, `PERMISSION_ENFORCEMENT_MODE=enforce`, the MCP flags on by default (an access review first), the default of new date fields, the Talk to Text price, `git config user.name` and `user.email` on this Mac.

## Private notes

Access findings and their state are in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/2026-10-01/`. Read that folder before working on any access item. Nothing from it is copied here.

## Next steps, in order

1. Merge #1435, #1416 and #1436 when green; rebuild; say which build is live. Close #1364.
2. Give the Supporter the sweep list for builds 770 to 772: Pause all agents and the limit card, quick create from Home, the offline edit, the kept timer, the "check before Done" card, the plan and automation cards in the Inbox, the batch card, the agent-change notice, the Add view menu at 1024 px, avatars on the Table.
3. Revise `ai-benchmark.md` against build 772: the "Tools today" and "Approvals" cells, a new sentence for job 4, and whether job 7 ends in one proposal or two.
4. 047, without the owner: folders and a sprint over MCP; S-2's unticked parts, rules and first tasks; group by who is working; "@" for a connected AI in chat; the last 30 plain-words keys.
5. When the owner has switched the flags on: AI-4a, AI-4e, then the first AI-1 run.
6. Merge #1306 alone, after its hand check. Give the screenshot check its baseline (`npm run visual:accept -- <run id>`).
7. A third benchmark run of task 046, on a build with the fixes of run 2; update `scorecard.md`; ask the owner to sign off M1 and M2.

## Learned on 2026-10-02

- **A fix that passes its spec can still fail on a build.** #1403's menu fix passed with a faked observer and failed in the browser; #1432 goes at the cause and has not been seen on a build yet. Jsdom has no layout: look at such a fix on a build.
- **The MCP instructions are full** (3,812 of 4,000 characters). A new slice puts its words in the tool's description.
- **Rewording a key:** delete it from every locale and every `*.pending.json`, then run the backfill, or the old text stays.
- **A branch cut from a batch branch** shows the batch's commits until the batch is on `beta`. Say so in the PR body.
- Earlier lessons (a skipped check is not a pass, the `warmChunks` mock, the task write mixins, cloud runs, the plan limit) are in the handoff of build 766: `git show 4a955e6bf:Tasks/HANDOFF.md`. Older ones: `git show 69a9a70be:Tasks/HANDOFF.md`.

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
