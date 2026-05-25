# Project statuses, task statuses, task types

These three are project-specific. They reflect how this team's work
actually flows. You design them per project — there are no defaults.

## Project statuses (`projectStatusData`)

The states the PROJECT as a whole moves through, from kickoff to finished.
Pick names that describe how this project ages, not how each task moves.

Examples (do not copy verbatim — they're shapes, not templates):

- Software build → "Planning", "Building", "Beta", "Launched", "Maintenance"
- Marketing campaign → "Strategy", "In Flight", "Wrapping Up", "Closed"
- Research study → "Designing", "Collecting Data", "Analyzing", "Published"
- Sales account → "Prospecting", "Active Pursuit", "Won", "Lost"

Exactly one entry should have `type: "default_active"` — the state a fresh
project starts in. Exactly one should have `type: "close"` — the terminal
state. Other middle states use `type: "active"`.

## Task statuses (`taskStatusData`)

The workflow each task moves through. This is where domain language matters
most — the columns on the team's board.

Examples:

- Software dev → "Backlog", "In Progress", "Code Review", "QA", "Released"
- Content creation → "Idea", "Drafting", "Editing", "Awaiting Approval",
  "Scheduled", "Published"
- Sales pipeline (per-deal task) → "Prospect", "Qualified", "Discovery",
  "Proposal", "Negotiation", "Closed Won", "Closed Lost"
- Bug-tracker style → "Reported", "Triaged", "Reproduced", "In Fix",
  "Awaiting QA", "Verified"

Pick the language the team would actually use in a standup. Don't list two
near-synonyms ("Done" + "Completed"). Don't put a generic catch-all like
"Other" or "Misc".

Exactly one entry should have `type: "default_active"` — the state a new
task lands in. Exactly one should have `type: "close"` — the terminal
state. Tag the others `type: "active"`. Every `task.status` you emit
later MUST match one of these entries' `name` exactly.

## Task types (`taskTypeCounts`)

The kinds of work this project has. "Task" alone is fine for simple
projects. Richer projects benefit from richer labels.

Examples:

- Software → "Task", "Bug", "Story", "Epic"
- Content → "Article", "Video", "Social Post", "Newsletter"
- Sales → "Call", "Meeting", "Demo", "Proposal", "Follow-up"
- Research → "Experiment", "Literature Review", "Data Cleanup", "Write-up"

Choose what the team will actually use. If everything in this project is
roughly the same kind of work, a single "Task" entry is the right answer.

Each entry needs an integer `key` starting at 1 and incrementing. Tasks
later reference these keys via `TaskTypeKey`.

## Generic kanban is not forbidden

If the project genuinely is generic software with no special domain
flavor, "Backlog / In Progress / Review / Done" is honest, not lazy.
Don't invent domain-specific words just to look bespoke. Match the
project's actual character.
