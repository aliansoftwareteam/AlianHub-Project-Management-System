# Tasks

Project task tracking. Each task is a folder with its own definition, progress log, and input resources.

## Structure

```
Tasks/
├── README.md       ← this file
├── index.md        ← summary table of all tasks
├── active/         ← currently being worked on
├── backlog/        ← defined but not yet started
└── done/           ← completed (kept for history)
```

Each task folder follows the pattern `<id>-<slug>/`:

```
001-refactor-auth/
├── task.md         ← goal, scope, acceptance criteria (rarely edited after creation)
├── progress.md     ← checklist, log, last-step pointer (updated as work happens)
└── resources/      ← input files: specs, designs, references
```

## Conventions

- **IDs are global and stable.** A task keeps its ID forever, even when it moves between folders.
- **`task.md` is roughly immutable.** Edit it only when the goal genuinely changes. Don't edit it to record progress.
- **`progress.md` is append-mostly.** Add to the log, update the checklist, refresh "Last step." Don't rewrite history.
- **Status follows the folder.** A task in `active/` has `status: active` in its frontmatter. If they disagree, the folder wins.
- **Resources are inputs only.** Specs, designs, screenshots, reference docs — things you read while working. Work products go in the actual codebase, not the task folder.

## Working with tasks

If this project has Claude available, the `task-manager` skill handles creation, updates, queries, and closure automatically. Just describe what you want:

- "Create a task to add OAuth login"
- "Work on task 003"
- "What's open right now?"
- "Mark task 001 done"

Otherwise, follow the conventions above and update `index.md` by hand.

## index.md

A markdown table mirroring the YAML frontmatter from every `task.md`. It's the at-a-glance view — for details, open the task folder itself.
