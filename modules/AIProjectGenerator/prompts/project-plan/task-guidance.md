# Tasks

A task is a thing one person can pick up and do. Each task has a name and
a description. Both matter — the name is how the team scans the board, the
description is the contract between you and whoever does the work.

## Task name

A short action-oriented phrase. "Wire JWT issuance for /login", not
"Authentication". 4-80 characters. Use the imperative voice — start with a
verb.

## Task description — the contract

This is what the user specifically asked you to get right. A teammate who
didn't sit in on the planning should be able to open a task and start work
without asking questions.

Every description has four parts, in this order:

1. **Context** — one or two sentences. Why does this task exist? What does
   it contribute to the sprint's goal? Don't restate the title.

2. **What to do** — concrete, ordered steps. Name files, components,
   APIs, libraries, tables, endpoints, deliverables wherever it's
   reasonable. The team should not have to guess at the intent.

   - Weak: "Implement user authentication"
   - Strong: "Add POST /login. bcrypt-compare the password against
     `users.passwordHash`. On match, sign a 24-hour JWT with `JWT_SECRET`
     and return `{ token, user }`. On mismatch, return 401."

3. **Acceptance criteria** — observable outcomes that let someone verify
   the task is done. "User can log in" is too vague. "POST /login with
   valid credentials returns 200 and a token; invalid credentials return
   401; password is never logged" is right.

4. **Depends on** — only if this task can't start until another task
   finishes. Reference the other task by name. Omit this part entirely
   when there's no dependency.

## Calibrate detail to task complexity

Match description length to what the task actually needs. The examples
below show fully-fleshed tasks because they're complex; copying that
density onto every simple task wastes tokens and reads like padding.

- **Simple tasks** (e.g. "Submit show to Apple Podcasts", "Add favicon"):
  context paragraph + 2-3 steps + 2-3 acceptance criteria is plenty.
- **Normal tasks** (most tasks in a real project): 3-5 steps + 3-4 criteria.
- **Complex tasks** (architecture, multi-system features): 5-7 steps + 4-5
  criteria. Past 7 steps, split the task in two instead.

A task description that takes a teammate 20 seconds to read is doing its
job. A task description that takes 90 seconds to read is doing too much —
the team will skim it and miss the key points.

## The Editor.js block format

The description goes in `descriptionBlocks` as Editor.js blocks. Use these
block types exactly — do not invent new ones:

- `{ "type": "paragraph", "data": { "text": "<text>" } }`
- `{ "type": "header", "data": { "text": "<text>", "level": 4 } }` (use level 4 only)
- `{ "type": "list", "data": { "style": "ordered", "items": ["<item>", "<item>"] } }`
- `{ "type": "list", "data": { "style": "unordered", "items": ["<item>", "<item>"] } }`

The skeleton for every task description, in this order:

1. One `paragraph` block — the context.
2. One `header` block with text `"What to do"`.
3. One `list` block (`ordered`) — the steps.
4. One `header` block with text `"Acceptance criteria"`.
5. One `list` block (`unordered`) — the criteria.
6. Optionally one more `paragraph` block starting with `"Depends on: "` — only if there's a real dependency.

You may include more paragraphs inside the "What to do" section if the
steps need extra explanation, but do not skip any of the five required
blocks or change their order.

## Priority

Each task has a `priority` of `Low`, `Medium`, `High`, or `Urgent`.
Choose deliberately — don't default everything to `Medium`.

- **Urgent** — blockers, security/critical bugs, things that must happen first
- **High** — work that's on the critical path for the sprint's goal
- **Medium** — normal work
- **Low** — polish, optional extras, nice-to-haves

In a typical project, most tasks are Medium, with a handful of High and
Low. Urgent is rare. If everything is Urgent, nothing is.
