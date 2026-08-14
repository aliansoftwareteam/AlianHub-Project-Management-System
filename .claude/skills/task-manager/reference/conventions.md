# Task Manager Conventions (Reference)

Detailed conventions and edge cases. Loaded only when needed — `SKILL.md` covers the common path.

## Filling out `task.md` from a user description

When the user describes a task in natural language, extract:

- **Title** — short, action-oriented. "Refactor auth module" not "Auth stuff."
- **Goal** — the *why*, in one or two sentences. If the user only said "fix the login bug," ask what the bug is and what success looks like before creating the task.
- **Scope** — what's covered. Be specific. If the user is vague, list your interpretation and ask them to confirm.
- **Out of scope** — anything the user mentioned ruling out, plus things you might reasonably assume are covered but aren't. Useful for preventing scope creep.
- **Acceptance criteria** — concrete, checkable. "Login works" is not a criterion. "User can log in with email + password and is redirected to /dashboard on success" is.
- **Constraints** — anything the user mentioned avoiding, prior decisions, tech constraints.

If the user gives you a one-line task ("add a dark mode toggle"), it's fine to create the task with thin content — but draft sensible defaults and tell the user what you assumed so they can correct it.

## Filling out `progress.md` at creation time

At creation, `progress.md` is mostly empty:

- **Checklist** — a first pass at the steps to reach the acceptance criteria. It's OK if this evolves significantly as work happens. Better to start with 3-5 rough steps than 15 imagined ones.
- **Last step** — `Not yet started.`
- **Blockers** — `None.`
- **Log** — a single entry: the creation date and "Task created."

## Updating `progress.md` during work

Three things change:

1. **Check off completed checklist items** as they're done. Don't delete unchecked items — they remain until acceptance criteria are met.
2. **Update "Last step"** with one line every time a session ends or work pauses. Future-you (or the next AI session) reads this first to know where to resume.
3. **Append to the log** when something meaningful happens: a decision is made, a step completes, a blocker is hit or cleared, scope is clarified. Don't log trivial actions ("opened the file") — log outcomes ("decided to use Argon2 instead of bcrypt because of FIPS requirements").

The log is chronological, newest at the bottom. Use date headers (`### YYYY-MM-DD`) and group entries under them.

## Edge cases

### Renaming a task

Change the title in `task.md` frontmatter and `progress.md` heading. Do **not** rename the folder — the ID-slug folder name is a stable identifier referenced from `index.md` and possibly from other tasks. If the slug becomes very misleading, you can rename the folder, but update every reference in `index.md` and any `depends_on` fields.

### Splitting a task

If a task grows too large, create new tasks for the spun-off work and link them with `depends_on`. In the original task's `progress.md` log, record the split: "Spun off 008-foo and 009-bar from this task." Don't delete the original — either close it (if remaining work is genuinely done) or narrow its scope.

### Merging tasks

Pick one task to keep. In the other(s), append a final log entry pointing to the kept task, then move them to `done/` with `status: done` in frontmatter. Update `index.md` accordingly. Don't delete merged tasks — the history is useful.

### Reordering priorities

Edit the `priority` field in frontmatter and the corresponding cell in `index.md`. No folder move needed — priority is independent of lifecycle.

### Dependencies

Use the `depends_on` frontmatter list. When closing a task, check whether any other task lists it in `depends_on` and mention this to the user — the dependent task may now be unblocked.

### Tasks that span sessions

`progress.md` is the handoff document. Whoever resumes (human or AI) reads "Last step" first, then the latest log entries, then the checklist. If you're ending a session, update "Last step" before stopping — even if it feels obvious, it won't be a week later.

### When `index.md` and reality disagree

Reality (the folders and frontmatter) wins. Regenerate `index.md` by walking `/Tasks/`, reading every `task.md` frontmatter, and rebuilding the table. Order by ID.

## Bulk extraction from documents

When extracting tasks from a PRD, spec, or document, granularity is the main thing to get right. Three failure modes:

**Too fine.** Splitting "implement login" into separate tasks for the form, validation, submit handler, error states, and redirect creates 5 tasks that are all blocked on each other and should be done together. Rule of thumb: if two candidate tasks would always be worked on in the same session by the same person, they're one task.

**Too coarse.** Lumping "build the entire auth system" into one task means `progress.md` becomes a thousand-line log and there's no meaningful checkpoint for half-done work. Rule of thumb: if a task can't plausibly be completed in 1-3 focused sessions, split it.

**Mistaking non-tasks for tasks.** PRDs often include success metrics, user research summaries, business justification, and competitive analysis. These are context, not work. Don't create a task for "increase conversion by 5%" — that's a measure of whether the real tasks succeeded.

### Detecting dependencies during extraction

Common dependency signals in documents:
- Explicit prerequisite language: "after X is built," "once Y exists," "depends on Z"
- Data flow: Task B reads data that Task A creates
- UI hierarchy: Task B is a settings page inside an app shell built by Task A
- Auth: Anything user-specific depends on the auth task

When unsure whether a dependency is real, leave `depends_on` empty and mention the maybe-dependency in the candidate list (`possibly depends on 2`). Let the user decide.

### Handling documents that change after extraction

If the user updates the source PRD after you've already created tasks from it, treat the existing tasks as the source of truth for *what was decided*. Don't silently re-extract. Ask the user which tasks need updating, then update those specifically. The tasks aren't a live mirror of the document — they're a fork.

### When the document is just a feature list

If the input is a flat list with no narrative ("dark mode, OAuth login, export to CSV, undo button"), each line is probably one task. Skip the propose step's flagging of dependencies (there's no narrative to extract them from) but still confirm the list with the user before creating folders — the user might have meant "and pick the most important one for me to start on."

## Examples

### Well-formed task.md (excerpt)

```markdown
---
id: 007
title: Add password reset flow
status: active
priority: high
depends_on: [001]
created: 2025-11-12
---

# Add password reset flow

## Goal
Let users recover access when they forget their password, via an email-based reset link.

## Scope
- "Forgot password" link on /login
- Email with time-limited reset token (15 min expiry)
- /reset-password page that validates token and accepts new password
- Token invalidation after use

## Out of scope
- SMS-based reset (separate task if needed)
- Account recovery via security questions
- Rate limiting (handled globally by 005-add-rate-limiting)

## Acceptance criteria
- [ ] Forgot-password link visible on /login
- [ ] Reset email sent within 5s of submission
- [ ] Token expires after 15 minutes
- [ ] Used tokens cannot be reused
- [ ] Successful reset logs the user in and redirects to /dashboard
```

### Well-formed progress.md (excerpt)

```markdown
# Progress: Add password reset flow

## Checklist
- [x] Add "Forgot password?" link to /login
- [x] Create POST /api/auth/forgot endpoint
- [ ] Wire up email sending (SendGrid)
- [ ] Build /reset-password page
- [ ] Add token invalidation on successful reset

## Last step
Email sending stubbed — needs real SendGrid integration. SendGrid API key is in
the resources folder but not committed to env yet.

## Blockers
None.

## Log

### 2025-11-12
- Task created.

### 2025-11-13
- Added forgot-password link and POST /api/auth/forgot endpoint.
- Decided to use 15-minute token expiry (shorter than the 24h some sites use, but
  password reset emails should be acted on quickly).
- Stored tokens hashed in DB so a DB leak doesn't expose live reset tokens.

### 2025-11-14
- Wired up SendGrid sandbox. Real key needs to go in .env before this can ship.
```