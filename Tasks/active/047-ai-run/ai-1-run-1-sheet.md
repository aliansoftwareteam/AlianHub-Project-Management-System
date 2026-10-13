# AI-1, first measured run: the sheet to follow

For the owner, 2026-10-08. Your Claude Code is connected over OAuth as "alianhub-oauth" with Manage tasks, Write docs and Read chat.

## Before you start (once, about 5 minutes)

1. Open a terminal and start `claude`. Check `/mcp` lists **alianhub-oauth** as connected.
2. Paste this one setup message to your Claude. It makes the start state the jobs need, in QA Sandbox. It is not measured.

> In AlianHub, in the project QA Sandbox: make a list "[AI bench] list". In it add tasks "[AI bench] bulk 01" to "[AI bench] bulk 20", one task "[AI bench] Other", a task "[AI bench] Parent" with a subtask "[AI bench] Child", a task "[AI bench] Design" from this Thursday to Friday and a task "[AI bench] Build" from next Monday to Tuesday. Add a dropdown field "Stage" with options Alpha and Beta, and a number field "Cost"; set Cost to 100 on "[AI bench] Other", 50 on "[AI bench] Child" and 20 on "[AI bench] bulk 01". Tell me what you made and anything you could not.

3. Approve what it asks for in AlianHub (Inbox, "Needs your approval"). Tell the coordinator "setup done".
4. Job 3 needs a chat channel called "scratch" in QA Sandbox whose last message is "[AI bench] Please fix the login page". Post that message yourself.

## The run

For each job: open the screen named under "Start" in AlianHub, start a **fresh** conversation (`/clear` in Claude Code), paste the sentence once, and do only what it asks (approve in the Inbox when it says something waits). Do not help it with extra hints. Write the result in the last column: **pass**, **pass with one approval**, or **fail** with a few words.

| # | Start | Say this, once | Result |
|---|---|---|---|
| 1 | The list | Add a task "[AI bench] Write release note" for me, due tomorrow, high priority. | |
| 2 | Home | Add a task "[AI bench] Call supplier" to [AI bench] list. | |
| 3 | The chat | Make a task in [AI bench] list from the last message in the scratch channel. | |
| 7 | The list | Set "[AI bench] bulk 01" to "bulk 20" to high priority and assign them all to (name your teammate). | |
| 8 | The list | Show me this list grouped by Stage. | |
| 9 | The list | Show my tasks due this week and save it as a view called "[AI bench] Mine this week". | |
| 10 | Home | Show me all my tasks across every project. | |
| 11 | The list | Move "[AI bench] Design" to In Progress. | |
| 12 | The list | Add fields to this project: a text field Note, a number field Cost, a dropdown Stage with Alpha and Beta, a date field Review date and a people field Reviewer. On "[AI bench] Write release note" set them to: ok, 120, Beta, tomorrow, me. | |
| 13 | The list | Show the total of Cost for each group, and show on "[AI bench] Parent" the total Cost of its subtasks. | |
| 15 | Docs | Create a doc "[AI bench] Launch notes" in QA Sandbox with the line "First draft", and tell me who can see it. | |
| 17 | The task "[AI bench] Write release note" | Start a timer on this task and stop it, then log 1 hour 30 minutes on it for today. | |
| 19 | The list | Make "[AI bench] Build" wait on "[AI bench] Design", then move Design two working days later. | |
| 23 | Home | Show me each person's workload in QA Sandbox for this week, counted in tasks. | |
| 24 | Home | Open the task about the supplier, and open the doc about the launch. | |

Job 12 asks for fields that the setup already made (Stage, Cost); a good answer reuses them or says they exist.

## Good to know

- The project lets an agent change at most 10 tasks in 10 minutes; the 11th waits. Job 7 is one batch and waits for your approval as one proposal: that is expected.
- Everything the agent does is in Settings, Audit log, and can be undone from the change's card.
- When you are done, tell the coordinator "run done". The coordinator reads the Inbox and the audit log, checks each end condition, and fills the measured columns of `ai-benchmark.md`.
