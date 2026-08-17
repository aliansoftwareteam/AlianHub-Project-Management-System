---
name: task-manager
description: Project-scoped task management system that lives in a /Tasks directory at the project root. Use this skill whenever the user wants to set up task tracking, create a new task, extract tasks from a PRD/spec/document, work on an existing task, check task status, mark a task done, list open tasks, move tasks between backlog/active/done, or otherwise manage structured work inside a codebase. Trigger on phrases like "set up tasks", "initialize tasks", "create a task", "add a task", "new task: X", "break this into tasks", "create tasks from this PRD", "extract tasks from this spec", "turn this doc into tasks", "split this into tickets", "work on task N", "continue task X", "what's next on this task", "what tasks are open", "show task progress", "mark task done", "close task", "this task is complete", "add a ticket", "what's in the backlog", or any time the user references a /Tasks folder. Also trigger when the user pastes a task description, PRD, spec, meeting notes, or feature list and asks Claude to track it, plan it, or break it down, or asks Claude to resume work from a previous session.
---

# Task Manager

A filesystem-based task tracking system for projects. Tasks live in `/Tasks/` at the project root and are organized by lifecycle (`backlog/`, `active/`, `done/`). Each task has its own folder with definition, progress log, and input resources.

## When this skill applies

Six workflows. Pick the one matching the user's intent:

1. **Setup** — first-time initialization of `/Tasks/` in a project
2. **Create** — add a single new task (usually to backlog or active)
3. **Extract** — break a PRD, spec, or document into multiple tasks
4. **Work** — resume or progress an existing task
5. **Query** — answer questions about task status
6. **Close** — mark a task complete and move to `done/`

If unsure which workflow applies, ask the user briefly. Don't guess — the wrong workflow can corrupt the task structure.

**Distinguishing Create vs Extract:** if the user's input describes one cohesive piece of work, use Create. If it's a document covering multiple features, sections, or deliverables, use Extract. When in doubt, ask: "Is this one task or should I break it into several?"

## Structure overview

```
/Tasks
├── README.md              ← human-facing conventions (from template)
├── index.md               ← machine-readable task registry (auto-regenerated)
├── /active                ← tasks currently being worked on
│   └── /001-task-slug
│       ├── task.md        ← immutable definition (goal, scope, criteria)
│       ├── progress.md    ← checklist + decision log (append-mostly)
│       └── /resources     ← input files: specs, designs, references
├── /backlog               ← defined but not started
└── /done                  ← completed (kept for history)
```

**Why this shape:** `task.md` and `progress.md` are split so the original intent doesn't get edited away as work happens. Lifecycle folders make state changes visible in `git mv` history. Numeric prefixes (`001-`, `002-`) give stable IDs for cross-referencing in commits and other tasks.

## Workflow 1: Setup

When the user asks to initialize task management in a project (and `/Tasks/` does not yet exist), run the setup script from the project root:

```bash
bash .claude/skills/task-manager/scripts/setup.sh
```

The script is idempotent — it creates the `/Tasks/` structure, copies `README.md` from templates, and creates an empty `index.md`. If `/Tasks/` already exists, it does nothing and tells the user.

After setup, briefly confirm to the user what was created and point them at `Tasks/README.md` for the conventions. Don't dump the full conventions inline — they're already in the file.

## Workflow 2: Create a single task

When the user asks to create one task, follow this order:

### Step A: Assess the input

The input is **thin** if any of these are missing or unclear:
- A clear goal (the *why*, not just the *what*)
- Scope boundaries (what's in, what's out)
- At least one concrete acceptance criterion

The input is **sufficient** when the user gave you a detailed paragraph, a spec, or explicit acceptance criteria. In that case, skip Step B and go directly to Step C.

### Step A.5: Check for multi-frame decomposition (UI tasks only)

If the task is UI / Figma-driven, count the distinct frames or state variants in the provided resources (PNG/CSS pairs, mockups, screenshots):

- **1-2 frames** (e.g. desktop only, or desktop + mobile) → keep as one task. Continue to Step B.
- **3+ frames** (desktop default + mobile + accordion-expanded + modal-open + scroll state + etc.) → **propose decomposition** before continuing. Pause and surface a split:
  - **Primary task**: build the default desktop frame end-to-end. Components are created in their default state.
  - **Follow-up task per additional frame / state**: mobile responsive, accordion expanded, modal open, scroll behavior, etc. Each reuses the components from the primary task and adds prop variants / responsive classes / state logic.

Why split: a single task spanning many frames invites conflating sizes, missing token gaps, and wide diffs that hide regressions. One frame per task = one source of truth, one acceptance screenshot, one tight iteration loop.

Wait for the user's call before proceeding. They may prefer to keep it omnibus for tiny designs, but for anything non-trivial (≥3 frames or ≥2 state variants beyond responsive), default to recommending the split.

### Step B: Ask 1-3 focused questions (only if thin)

Ask the **minimum** needed to fill missing fields. One question per missing field, maximum three. Bundle them into a single message so the user answers in one turn.

| Missing field | Ask something like |
|---|---|
| Goal | "What's the underlying problem this solves? / Why does this matter?" |
| Scope | "Should this also cover X, or is it limited to Y?" |
| Acceptance criteria | "How will you know this is done — what does success look like?" |

If the input has all three, don't ask anything. Asking unnecessary questions is worse than asking none.

After the user answers, **draft the task and create it** — don't go back for more rounds of questions. If something else is unclear, fill in a sensible default and tell the user what you assumed.

### Step C: Create the task

1. Determine the next task ID by looking at the highest-numbered folder across `active/`, `backlog/`, and `done/`. IDs are global, not per-folder. Increment by 1, zero-pad to 3 digits (`007`, `042`, `158`).
2. Build a slug from the task title: lowercase, hyphenated, ~3-5 words max. Example: "Refactor the authentication module" → `refactor-auth-module`.
3. Decide placement: `active/` if the user wants to start now or it's clearly in-flight, `backlog/` otherwise. If ambiguous, ask.
4. Create the folder `<placement>/<id>-<slug>/` with subfolder `resources/`.
5. Copy `templates/task.md` and `templates/progress.md` into the new folder, filling in the frontmatter and prose based on what the user provided.
6. Update `/Tasks/index.md` to include the new task (see "Updating the index" below).
7. Tell the user the task ID, where it landed, and any assumptions you made.

For details on filling out `task.md` and `progress.md`, see `reference/conventions.md`.

## Workflow 3: Extract tasks from a document

When the user pastes a PRD, spec, meeting notes, feature list, or other multi-task document, **do not start creating folders immediately**. Use a propose-confirm-create flow:

### Step A: Read and identify candidate tasks

Read the document fully. Identify discrete, independently-actionable pieces of work. Skip background, motivation, success metrics, and other non-task content.

Aim for tasks that are roughly comparable in size — if one section describes a feature in detail and another mentions it in one line, both might be one task. Don't split too fine; "implement login form" is one task, not five (markup, validation, submit handler, error states, success redirect).

### Step B: Propose the breakdown

Show the user a numbered list before creating anything. Format:

```
I see N candidate tasks in this document:

1. <Title> — <one-line summary>
2. <Title> — <one-line summary> (depends on 1)
3. <Title> — <one-line summary>
...

Want me to create all of these, or should I adjust? You can:
- Drop any (just say "skip 3")
- Merge any ("combine 2 and 4")
- Add ones I missed
- Reword titles
```

Flag dependencies you detect inline (`depends on 1`). Don't ask follow-up questions for each task at this stage — that turns into 30 questions. The propose-confirm loop is the only checkpoint.

### Step C: Create on confirmation

Once the user confirms (or after they adjust the list), create all approved tasks in sequence. For each:

1. Assign the next sequential ID.
2. Place in `backlog/` by default (extracted tasks rarely start active). If the user said "and let's start on task 1," put that one in `active/`.
3. Fill `task.md` from the document content — extract goal, scope, and any acceptance criteria you can find. For criteria not explicit in the doc, draft sensible ones and note in the log that they were inferred.
4. Set `depends_on` based on the dependencies you flagged.
5. Update `index.md` once at the end, after all tasks are created — not after each one.

### Step D: Summarize

After creating, give the user a single short summary: "Created tasks 003–008 in backlog. Task 003 also moved to active per your request." Don't recap every task.

## Workflow 4: Work on a task

When the user asks to work on, continue, or resume a task:

1. Find the task folder. The user may reference it by ID (`task 007`), slug (`the auth refactor`), or title. Search `active/` first, then `backlog/`. If found in backlog, ask whether to move it to active first.
2. Read `task.md` fully — this is the goal, scope, and acceptance criteria. Treat it as authoritative.
3. Read `progress.md` to see what's been done, what's checked off, what the last entry says, and any open blockers.
4. List the resources in `resources/` so the user knows what's available.
5. **Read the project's design/standards docs before grepping raw code.** If the project root (or a sibling docs project — e.g. `det-claude/`) contains `DESIGN.md`, `STANDARDS.md`, `ARCHITECTURE.md`, or similar, those are the source of truth for tokens, conventions, and patterns. Re-deriving from `tailwind.css` / `nuxt.config.ts` / etc. is fragile and wastes rounds.
6. **If the task is UI / Figma-driven**, consider invoking a specialized skill (`/figma-to-ui`, `/figma-to-nuxt`, etc.) rather than translating freehand. Those skills know the canonical extraction patterns (e.g. Figma `/* H5/Medium */` comment labels → design-system tokens).
7. Proceed with the work. After each meaningful step (a checklist item completed, a decision made, a blocker hit), append to `progress.md`. Do not edit `task.md` unless the user explicitly changes the goal.

Don't dump the full task content back to the user — summarize where things stand and propose the next step.

## Workflow 5: Query status

When the user asks about open tasks, what's next, or what's blocked:

- For a one-line overview: read `/Tasks/index.md` and summarize.
- For details on a specific task: read its `progress.md` (not `task.md` — progress is what changes).
- For dependencies: parse the `depends_on` frontmatter field across `active/` and `backlog/`.

Keep query responses short. The user wants the answer, not a recap of the structure.

## Workflow 6: Close a task

When the user says a task is done:

1. Confirm with the user that all acceptance criteria in `task.md` are met. If not, ask whether to close anyway or finish the remaining items.
2. Append a final entry to `progress.md` with the completion date and a 1-2 sentence summary of the outcome.
3. Move the task folder from `active/` to `done/` using `git mv` if the project is a git repo, otherwise plain `mv`.
4. Update `/Tasks/index.md` — change status to `done` and update the path.

## Updating the index

`/Tasks/index.md` is a markdown table that mirrors the YAML frontmatter of each `task.md`. Maintain it manually for now (Claude updates it as part of create/move/close workflows). The columns are:

| ID  | Title | Status | Priority | Depends on | Path |

When adding or changing a row, keep alphabetical/numerical ordering by ID. If the table gets out of sync, regenerate it by reading the frontmatter from every `task.md` under `/Tasks/` and rebuilding the table.

## Frontmatter format

Every `task.md` starts with YAML frontmatter. This is the source of truth for index.md and for any future tooling:

```yaml
---
id: 001
title: Refactor authentication module
status: active        # backlog | active | done
priority: high        # low | medium | high
depends_on: []        # list of task IDs, e.g. [002, 005]
created: 2025-11-14
---
```

Status should match the lifecycle folder the task lives in. If they disagree, the folder location wins (it's harder to fake) — fix the frontmatter.

## Reference files

For deeper detail, read these only when needed:

- `reference/conventions.md` — full conventions, template field meanings, examples of well-formed task.md and progress.md, edge cases (renaming, splitting, merging tasks)

## Notes

- Resources in `/resources` are **inputs** to the task (specs, designs, screenshots, reference docs). Work products go in the actual codebase, not the task folder.
- `progress.md` is committed to git. To keep history clean, batch progress updates into meaningful commits rather than committing after every checkbox tick.
- If the user works in a non-git project, the workflow is identical — just skip the `git mv` step.