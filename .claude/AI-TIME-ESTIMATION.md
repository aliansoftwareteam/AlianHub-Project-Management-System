# AI Task Time Estimation — How It Works

This doc explains how AlianHub estimates the time needed to finish a task,
in plain language.

---

## The Big Idea

When a task is created, we ask an AI model: **"If an AI coding agent
(Claude Code) did this task end-to-end, how many minutes would it take?"**

The answer is saved on the task as `totalEstimatedTime` (in minutes).

That's it. No rules. No formulas. Just a smart guess based on what the
task actually says.

---

## What the AI Looks At

The AI gets these pieces of info about the task:

1. **Task title** — the headline.
2. **Task type** — bug, story, task, etc.
3. **Priority** — LOW, MEDIUM, HIGH, URGENT.
4. **Parent or subtask?** — subtasks are usually smaller.
5. **Description** — the most important input. This is what the AI
   reads to understand the actual work.

If the description is empty, the AI is told so and will be more
conservative (since it only has the title to go on).

---

## The 5 Things the AI Thinks About

The prompt walks the AI through these **in order**. Each one pushes
the estimate up or down.

### 1. What is the deliverable?

What kind of work is this? Different shapes have different floors:

- **Copy or config change** → small.
- **Bug fix** → medium, depends on how deep the bug is.
- **New feature** → medium to big.
- **Refactor** → big, because it touches many files.
- **Migration** → big, because data is at risk.
- **Integration** → big, because external systems bring surprises.

### 2. How much surface area is involved?

The AI counts the things the description mentions or implies:

- How many files?
- How many modules?
- Any APIs, schemas, or UI screens?
- Any third-party services?
- Are tests needed?

More things = more time.

### 3. How clear is the description?

This is a big one.

- **Clear description** → faster. The AI agent knows exactly what to do.
- **Vague description** → slower. The AI agent has to figure things
  out as it goes, and that takes real time.

### 4. How will the work be verified?

Some work is "done" when tests pass. Other work has to be seen and
clicked.

- **Internal refactor** → run tests, done. Fast.
- **Anything touching UI, data, auth, or payments** → run the app,
  click around, watch what happens, fix issues. Slower.

### 5. Iteration loops

In real work, the first try is rarely the last. The agent writes
code, runs it, sees what breaks, fixes it, runs again. The prompt
tells the AI to bake in 1–2 iteration rounds for anything that isn't
trivial.

---

## What the Estimate Does NOT Include

The number is the AI agent's **focused work time**. It does NOT count:

- Human review or approval time.
- Waiting for CI, builds, or deploys.
- Meetings, handoffs, status updates.
- External system queues.

So an estimate of 60 minutes means *the agent works for 60 minutes* —
not that the task is done in 60 minutes of calendar time on a real team.

---

## Safety Bounds

We never trust the AI's number blindly.

- **Minimum: 5 minutes.** Even the smallest task has some overhead.
- **Maximum: 10080 minutes (7 days).** If a task would genuinely take
  longer, it should be split into smaller tasks.

If the AI returns something outside these bounds (like 0 or 9999999),
we clamp it back inside. If the AI returns total garbage we can't
parse, the task just stays without an estimate — no broken data ever
gets saved.

---

## The Single Biggest Driver

**The description content drives the number more than anything else.**

- The title and priority give the AI a starting feel.
- The description tells the AI the actual scope.

Two tasks both called "Fix login bug" can land at 30 minutes or 8
hours depending on what their descriptions say. The prompt is built
to make sure the AI actually reads the description before answering,
and to discourage lazy round-number guesses like 60 / 120 / 240.

---

## How It Runs in the App

- After a task is created, we fire the estimator in the background.
- It does NOT block the create API — the response is returned first.
- When the estimate comes back (usually a few seconds), we update
  the task and send a Socket.io event so connected screens refresh
  the value automatically.
- If no AI provider is configured in `.env`, the estimator quietly
  does nothing and task creation works exactly like before.

---

## Where the Pieces Live

| What | File |
|---|---|
| The prompt the AI reads | `Modules/AIProjectGenerator/prompts/project-plan/task-time-estimate.md` |
| The estimator code | `Modules/EstimatedTime/aiTaskEstimator.js` |
| Single-task hook | `Modules/Tasks/helpers/taskMongo/create.js` |
| AI Project Generator bulk hook | `Modules/AIProjectGenerator/orchestrator.js` |
| DB field | `tasks.totalEstimatedTime` (Number, in minutes) |

---

## In One Sentence

> The AI reads the task description, judges how much real work the
> description describes (size, clarity, verification needs, iteration),
> and returns a minute estimate — which we clamp to safe bounds and
> save on the task.
