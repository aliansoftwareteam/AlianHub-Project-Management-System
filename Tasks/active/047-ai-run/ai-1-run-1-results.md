# AI-1, first measured run: results

Run on 2026-10-08, build 815 to 817, on the owner's local install with `MCP_OAUTH=both` and the three `MCP_TOOLS_*` flags on. The agent was the owner's own Claude Code, connected over OAuth as Local PM with Manage tasks, Write docs and Read chat, approved in Settings, Agent clients. Each job was one fresh non-interactive Claude Code run (`claude -p`), allowed only the AlianHub connection, with the job's start screen open in AlianHub as the same person. The sentence was sent once, with no follow-up. Approvals were given in AlianHub as the person who said the sentence would. Start state: `ai-1-run-1-sheet.md`.

## Score

**13 of 15 pass** under the pass rule (task.md, AI-1): 9 pass with no approval, 4 pass with exactly one approval. 2 fail.

| # | Job | Result | Approvals | Steps | Seconds | What happened |
|---|---|---|---|---|---|---|
| 1 | Create a task with assignee, date, priority | pass | 0 | 6 | 16 | Made in the open list, me, tomorrow, High. |
| 2 | Quick-create from Home | pass | 0 | 11 | 49 | Made in the named list. |
| 3 | Message to task | pass | 0 | 11 | 22 | The newest message in the channel became the task, with a link back. The start channel was "[QA 046] channel": there is no "scratch" channel in the seed. |
| 7 | Bulk-edit twenty tasks | pass with approval | 1 | 7 | 70 | One batch of 40 changes waited as one proposal; after approval all twenty show High and Rahul Mehta. The first batch call was refused: the batch takes step names with dots (`task.update`) while the MCP tool list names them with underscores. |
| 8 | Group by a custom field | **fail** | 0 | 33 | 50 | Answered with a table of every task instead of grouping the list, saving a grouped view or giving a link. Three "Stage" fields in the project (one from the seed) made it read every task's values. |
| 9 | Filter and save a view | pass with approval | 1 | 6 | 27 | The tasks, then one proposal for the view "[AI bench] Mine this week", relative "this week" and "mine". |
| 10 | Everything list | pass | 0 | 5 | 28 | 41 tasks across 4 projects, the urgent ones first. |
| 11 | Board drag (status) | pass | 0 | 5 | 15 | Design to In Progress at once. |
| 12 | Custom fields of the main types | pass with approval | 1 | 7 | 43 | One proposal: three new fields, the existing Cost reused, five values set. Stage was set on "[AI bench] Stage", because the project's own "Stage" has other options and the tools cannot add options. |
| 13 | Totals of a number field | pass with approval | 1 | 9 | 327 | One plan: a rollup field "[AI bench] Cost total" and a view grouped with column totals. After approval the parent reads 50, its subtask's Cost. (A first reading of the page took the 0 of another field, "[QA bench2] Cost total", and was corrected.) Slow: 5.5 minutes. |
| 15 | Share a doc | pass | 0 | 6 | 20 | The doc, marked agent-drafted, and who can see it. |
| 17 | Timer and manual time | pass | 0 | 6 | 29 | A timer entry and a 1 h 30 min entry for today. |
| 19 | Dependency and Gantt shift | **fail** | 0 | 9 | 46 | Build waits on Design and Design moved two working days, skipping the weekend; Build did not move with it, so it starts before Design ends. The agent saw it and offered to move Build. |
| 23 | Workload | pass | 0 | 18 | 75 | One row per person for the week, with the link to the Workload view. |
| 24 | Search and open | pass | 0 | 10 | 26 | The task and the doc, with links, picked by where the person last worked. |

All 15 runs together: 845 seconds and 149 steps.

## Defects found on the way

1. An approved `subtask.create` made nothing ("data.sprintArray.id must be an id.") and still answered "Done.". Fixed in #1566.
2. `tasks.batch` takes step names with dots; the tool list names the tools with underscores, so the first call of a batch is refused.
3. A formula field made or edited after its inputs exist stayed blank until an input changed (found while checking job 13; rollups were already filled at once).
4. Moving a task that others wait on over MCP does not move the waiting tasks (job 19).
5. "Show me this list grouped by …" has no road to the person's screen: no link with a grouping, and no guidance to save a view (job 8).
6. The Inbox's "Needs your approval" count and the Docs list do not follow new agent proposals and docs until a reload.
7. A proposal from Claude Code is named "claude.ai (MCP)", the client's publisher, not the app.

## Not measured here

Jobs 4, 5 and 20 (the reserves), 6, 14, 16, 18, 21, 22 and 25 are outside the fifteen. The replay test (AI-1b) needs these runs recorded as fixtures.

## Jobs 8 and 19 again, on build 819

Re-run on 2026-10-08 after #1569 (the fixes for defects 1, 2, 3, 4, 5 and 7), the same way: one fresh run each, started from the list.

| # | Job | Result | Approvals | Steps | Seconds | What happened |
|---|---|---|---|---|---|---|
| 8 | Group by a custom field | pass with approval | 1 | 6 | 27 | One proposal for a view "By Stage", grouped by Stage, and the list link. Of the three fields named Stage it took the seed's one (Design, Build, Triage) without saying others exist, so every bench task sits under "No value". The new view showed in the view tabs only after a reload. |
| 19 | Dependency and Gantt shift | pass | 0 | 11 | 48 | The link already existed, so it was kept. Design moved from Mon 12 to Tue 13 Oct to Wed 14 to Thu 15 Oct, and Build moved with it in the same change to Thu 15 to Fri 16 Oct. Build starts on the day Design ends, not the day after. |

With these two, **15 of 15 pass**: 10 with no approval, 5 with one. The proposal now names the app as "Claude Code (app · claude.ai)" (defect 7 fixed).

Left from this run:
- Several fields with the same name: an agent should say which one it took when names clash.
- A new view does not appear in the open project's view tabs until a reload.
- A waiting task may start on the day its blocker ends; whether that is right for finish-to-start links is to decide.
