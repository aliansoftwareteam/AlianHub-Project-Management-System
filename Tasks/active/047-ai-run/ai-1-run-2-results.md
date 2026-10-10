# AI-1, second measured run: results

Run on 2026-10-10, on build 852, on the owner's local install. Build 858 went live at about 11:41 UTC, during the third run of the reserves (job 24's third run straddled the restart; jobs 4, 5 and 20's third runs ran on 858). The agent was the owner's own Claude Code 2.1.294 (model `claude-fable-5-1`), connected over OAuth as Local PM ("alianhub-oauth": Manage tasks, Write docs, Read chat). Each run was one fresh non-interactive call, `claude -p '<sentence>' --allowedTools "mcp__alianhub-oauth" --output-format json`, started from the home folder. The sentence was sent once and bare, with no follow-up. Before each run the job's start screen was opened in the Browser pane, signed in as Local PM, so `person.place` read it. Proposals were approved as Local PM through the app's own route (`POST /api/v2/agents/proposals/:id/approve`) from that signed-in page. Only proposals made by Claude Code in QA Sandbox after the run started were approved. Start state: `ai-1-run-1-sheet.md`, put back before each round through Claude Code setup calls, with their proposals approved the same way. Steps are the run's turns. Cost is what Claude Code reports for the run (`total_cost_usd`). It is plan usage, not API spend.

Jobs: run 1's list, as the owner decided on 2026-10-09 (decision 15: "the jobs stay as they are"). The fifteen are 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 15, 17, 19, 23 and 24, with reserves 4, 5 and 20. **`task.md` names a different list** (1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 17, 19, 20 and 21, reserves 5, 15 and 22). The score under that list is at the end.

## Score

**15 of 15 pass** under the 2-of-3 rule (task.md, AI-1). Every job had at least two clean passes and no run changed anything it was not asked to.
- 14 jobs passed all three runs. Job 19 passed two of three.
- 7 jobs need no approval: 8, 10, 11, 12, 17, 23 and 24.
- 8 jobs pass with exactly one approval: 1, 2, 3, 7, 9, 13, 15 and 19.

The three reserves fail all three runs, as the sheet predicted. They do not count, because none of the fifteen failed.

Of the 54 runs: 44 clean passes (21 with no approval, 23 with one), 10 fails (1 in the fifteen, 9 in the reserves). Together they took 2,190 seconds and 475 steps and used $47.63 of plan usage. One more run of job 3 was voided (see job 3).

## The runs

Steps, seconds and cost per run. "Appr." is the number of approvals in AlianHub. The Claude Code calls asked for none: tools were pre-allowed.

### Job 1, create a task. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 6 | 24 | $0.67 |
| 2 | pass with approval | 1 | 8 | 41 | $0.74 |
| 3 | pass with approval | 1 | 7 | 40 | $0.74 |

Each run filed the same `task.create`: the open list, me, due 2026-10-11, High. The create now waits for approval (in run 1 it was applied at once; defect 1).

### Job 2, quick-create. Start: Home. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 17 | 31 | $0.91 |
| 2 | pass with approval | 1 | 17 | 50 | $0.91 |
| 3 | pass with approval | 1 | 17 | 45 | $0.88 |

Each run found the named list across the 12 projects and filed the create.

### Job 3, message to task. Start: the chat. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| (void) | asked where | 0 | 13 | 34 | $0.84 |
| 1 | pass with approval | 1 | 14 | 27 | $0.88 |
| 2 | pass with approval | 1 | 14 | 23 | $0.85 |
| 3 | pass with approval | 1 | 14 | 24 | $0.88 |

No channel named "scratch" existed, although the sheet asks for one; run 1 had passed by taking "[QA 046] channel". The first try here said there was no scratch channel and asked which one was meant. It is voided as a start-state fault. I then made the channel "scratch" as Local PM and posted "[AI bench] Please fix the login page" there, as the sheet says. After that, every run made the task from that message, with a link back to it, as one proposal.

### Job 7, bulk-edit twenty. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 5 | 40 | $0.99 |
| 2 | pass with approval | 1 | 6 | 64 | $1.04 |
| 3 | pass with approval | 1 | 6 | 46 | $1.02 |

Each run filed one batch of 40 changes (High and Rahul Mehta on twenty tasks). Every approval applied all 40, with nothing left unmade.

### Job 8, group by Stage. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 4 | 17 | $0.67 |
| 2 | pass | 0 | 4 | 15 | $0.64 |
| 3 | pass | 0 | 4 | 14 | $0.66 |

Each run gave the link to the "By Stage" view that run 1's rerun saved. That view stays because no tool removes or renames a view, so this job was easier than in run 1, where the view had to be made. As in run 1, the view groups by the seed's Stage field, under which the bench tasks show as "No value".

### Job 9, filter and save a view. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 7 | 46 | $0.85 |
| 2 | pass with approval | 1 | 6 | 32 | $0.78 |
| 3 | pass with approval | 1 | 8 | 46 | $0.89 |

Each run listed the tasks and filed `view.create` with `mine` and `due: this_week`. Each made another view named "[AI bench] Mine this week", alongside run 1's, without saying a view of that name existed (defect 4). Runs 2 and 3 showed the release note as due "today, Sat 10 Oct" when it is due on the 11th (defect 5).

### Job 10, everything list. Start: Home. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 17 | 47 | $1.13 |
| 2 | pass | 0 | 5 | 44 | $0.99 |
| 3 | pass | 0 | 7 | 48 | $1.02 |

41 to 42 open tasks across 4 of 12 projects, overdue first. Run 1 was made before the Browser pane was signed in. Job 10 does not use the place, so it is kept.

### Job 11, move a card. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 7 | 29 | $0.73 |
| 2 | pass | 0 | 6 | 17 | $0.67 |
| 3 | pass | 0 | 7 | 48 | $0.71 |

Design moved from To Do to In Progress at once. In runs 1 and 3 the first `task.status.set` was refused as "changed since you read it" right after `tasks.search`. The agent read the task again and the retry went through (defect 3).

### Job 12, five custom fields. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 12 | 45 | $1.02 |
| 2 | pass | 0 | 14 | 93 | $1.15 |
| 3 | pass | 0 | 11 | 64 | $0.97 |

Note, Review date and Reviewer already existed from run 1, and no tool renames a field. So each run reused the existing fields and set the five values at once, with no approval. Run 1 needed one approval to make them. As in run 1, Beta went on "[AI bench] Stage", because the project's own Stage has other options and no tool adds options. Each run said so.

### Job 13, totals of a number field. Start: the list. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 13 | 77 | $1.29 |
| 2 | pass with approval | 1 | 12 | 53 | $1.18 |
| 3 | pass with approval | 1 | 13 | 46 | $1.44 |

The rollup "[AI bench] Cost total" from run 1 already showed 50 on Parent, and each run said so. Each run filed one view grouped by status with the Cost and rollup columns. Runs 1 and 3 both named it "[AI bench] Cost by group"; run 2 named it "[AI bench] Cost totals". None saw the views of the runs before (defect 4).

### Job 15, share a doc. Start: Docs. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 5 | 32 | $0.68 |
| 2 | pass with approval | 1 | 6 | 41 | $0.70 |
| 3 | pass with approval | 1 | 5 | 35 | $0.68 |

`page.create` now waits for approval; in run 1 it made an agent's draft at once. Each run named the project's ten people, with the guest Kabir Joshi flagged. Runs 1 and 2 called Mevil Bhojani "you", but the connection acts as Local PM. That probably comes from Claude Code's own memory of its user, not from AlianHub.

### Job 17, timer and manual time. Start: the task "[AI bench] Write release note". **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 6 | 36 | $0.69 |
| 2 | pass | 0 | 6 | 19 | $0.69 |
| 3 | pass | 0 | 6 | 19 | $0.66 |

A 0-minute timer entry and a 90-minute entry for today, on the open task, both made at once.

### Job 19, dependency and shift. Start: the list. **2 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass with approval | 1 | 12 | 63 | $1.13 |
| 2 | **fail** | 1 | 9 | 56 | $0.90 |
| 3 | pass with approval | 1 | 13 | 87 | $1.09 |

`task.relation.add` now waits for approval, while the date change is applied at once. So Design moves before the link exists, and the server's shift of the waiting task does not happen. In runs 1 and 3 the agent saw this and moved Build two working days itself (Design 19 to 20 Oct, Build 21 to 22 Oct). In run 2 it left Build on 19 to 20 Oct, overlapping Design, and offered to move it: the end condition was not reached (defect 2).

### Job 23, workload. Start: Home. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 8 | 31 | $1.33 |
| 2 | pass | 0 | 6 | 37 | $0.77 |
| 3 | pass | 0 | 7 | 38 | $0.77 |

Each run gave a row per person for the week (Local PM 5, the other nine 0) and the link to the Workload view. Several weekdays and one due day in the answers were a day off (defect 5).

### Job 24, search and open. Start: Home. **3 of 3 pass**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | pass | 0 | 10 | 29 | $0.81 |
| 2 | pass | 0 | 10 | 47 | $0.81 |
| 3 | pass | 0 | 10 | 25 | $0.80 |

The live supplier task and the newest launch doc, with links. Each run chose the place the person last worked and named the older copies it skipped.

### Reserve 4, three levels of subtasks. Start: the task "[AI bench] Parent". **0 of 3**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | fail | 0 | 9 | 40 | $0.82 |
| 2 | fail | 0 | 9 | 34 | $0.80 |
| 3 | fail | 0 | 9 | 34 | $0.80 |

Child and Grandchild were made at once. Great-grandchild was refused by the product rule (three levels at most), and each run quoted the refusal.

### Reserve 5, folder, subfolder, list, move. Start: the list. **0 of 3**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | fail | 1 | 6 | 25 | $0.78 |
| 2 | fail | 1 | 8 | 31 | $0.84 |
| 3 | fail | 1 | 2 | 14 | $0.93 |

One proposal makes the folder, the subfolder and the list. The move needs that list's id, so each run stopped and asked to be told once it was approved: a second sentence and a second approval. I declined the proposals to keep the start state.

### Reserve 20, sprint. Start: the list. **0 of 3**

| Run | Result | Appr. | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| 1 | fail | 1 | 8 | 52 | $0.96 |
| 2 | fail | 1 | 8 | 32 | $0.91 |
| 3 | fail | 1 | 9 | 101 | $0.97 |

`list.create` now waits for approval, so the dates and the five moves cannot follow in the same conversation. Each run asked to be told once the list exists. I declined the proposals.

## Totals

| | Runs | Clean passes | Steps | Seconds | Cost |
|---|---|---|---|---|---|
| The fifteen | 45 | 44 | 407 | 1,828 | $39.83 |
| The reserves | 9 | 0 | 68 | 362 | $7.80 |
| Measured, together | 54 | 44 | 475 | 2,190 | $47.63 |
| Voided job 3 run | 1 | | 13 | 34 | $0.84 |
| Three start-state setups | 3 | | 75 | 271 | $4.77 |
| **Plan usage, all of it** | | | | | **$53.24** |

Against run 1 (builds 815 to 819, one run each), a run of the fifteen took 41 s and 9.0 steps on average here, against 56 s and 9.9 steps there. Approvals went the other way: 24 of the 45 runs asked for one, against 5 of 15 jobs in run 1 (defect 1).

## Under the list in `task.md`

Of `task.md`'s fifteen, twelve were measured here and pass: 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 17, 19. Jobs 4 and 20 fail all three runs. Job 21 was not run. Of its reserves, 15 passes, 5 fails and 22 was not run. That makes **13 of 15 measured**, with 21 and 22 still to run.

## Defects found on the way

1. **Since run 1, creates and links from the Claude Code client wait for approval.** That covers `task.create`, `task.from_message`, `page.create`, `task.relation.add`, `list.create` and `task.archive`. The reason given is "it came from an outside client (https://claude.ai/oauth/claude-code-client-metadata), so it needs a person's approval". In run 1 (build 819) these were applied at once. The tool descriptions still say "Creates a task in a project at once" and "Creates a list in a project at once". Edits, status, field values and time entries are still applied at once. Effect: jobs 1, 2, 3, 15 and 19 went from no approval to one, and reserve 20 can no longer finish in one conversation. Which change did this, and whether it is meant, is to settle.
2. **A link that waits and a date move that does not leave dependent tasks behind (job 19).** The move runs before the link exists, so the server does not shift the waiting task. The agent has to notice and move it by hand. It did in two runs of three; in the third, Build ended overlapping Design. Either the link and the move go into one proposal, or the server shifts the waiting task when the link is approved.
3. **"Changed since you read it" fires when nothing changed for the person.** Filing a proposal on a task (the relation removal in a setup call) made the next date write on that task refused. In job 11, `task.status.set` right after `tasks.search` was refused twice in three runs; the retry after `task.get` went through.
4. **No tool lists a project's saved views, and `view.create` does not warn about a name in use.** The run left three views named "[AI bench] Mine this week" and two named "[AI bench] Cost by group". Twice an agent said no such view existed when one did.
5. **Dates in tool output are UTC instants (for example `2026-10-10T18:30Z` for 11 Oct in Asia/Kolkata), and the model misreads the day.** In jobs 9, 10, 11 and 23 the answers called the release note (due 11 Oct) due "today, 10 Oct", gave Design's dates a day early, and gave wrong weekdays. The stored values and the web app are right. Only the agent's answers are wrong, so no end condition failed.
6. **Job 3's start state was missing in run 1.** There was no "scratch" channel, and run 1's pass came from another channel. The channel now exists in the workspace with the message.

Not product defects, seen on the way:
- Answers carry Claude Code's "Insight" boxes from the owner's output style. They are not from AlianHub.
- Job 15: the agent called Mevil Bhojani "you" on a connection that acts as Local PM.
- Build 858 went live mid-run (about 11:41 UTC). Job 24's third run straddled the restart; jobs 4, 5 and 20's third runs ran on 858. None of them changed result.

## Not measured

- Jobs 21 and 22 (`task.md`'s list), and 6, 14, 16, 18 and 25, which no list picks.
- The start state of jobs 8, 12 and 13 could not be fully put back. Run 1's "By Stage" view, its Note, Review date, Reviewer and "[AI bench] Stage" fields, and its "[AI bench] Cost total" rollup stayed, because no tool removes or renames views or fields and nothing was to be deleted. Those three jobs were easier here than a clean start would make them. Job 8 never had to make a view, and job 12 never had to make fields.
- Plan usage as Claude's own limit sees it. The cost above is Claude Code's own figure per run.
- The replay fixtures (AI-1b) are not refreshed from this run.

## Left in QA Sandbox

Everything is named `[AI bench] …`. Nothing was deleted.
- Archived: the release-note, supplier and login-page tasks of runs 1 and 2 of this run and of run 1 (QAS-166 to 168, 178 to 180, 183 to 185), and the "Child" subtrees of reserve 4's runs 1 and 2 (QAS-181, 186).
- Live, from round 3: "[AI bench] Write release note" (QAS-188) with Note, Cost 120, "[AI bench] Stage" Beta, Review date, Reviewer, and two time entries; "[AI bench] Call supplier" (QAS-189); "[AI bench] Please fix the login page"; the Child and Grandchild of reserve 4's round 3 (QAS-191, 192).
- bulk 01 to 20: High, assigned to Rahul Mehta. Design: In Progress, 19 to 20 Oct. Build: 21 to 22 Oct, blocked by Design.
- Docs: "[AI bench] Launch notes" (round 3), "[AI bench] run2-1 notes" and "[AI bench] run2-2 notes" (the earlier rounds), and "[AI bench] r1 notes" (run 1).
- Views: "[AI bench] Mine this week" (three, plus run 1's), "[AI bench] Cost by group" (two), "[AI bench] Cost totals".
- Chat: the channel "scratch", with one message.
- Time entries: a 0-minute and a 90-minute entry on each round's release-note task.
- Declined proposals: three folder requests (reserve 5) and three list requests (reserve 20).
