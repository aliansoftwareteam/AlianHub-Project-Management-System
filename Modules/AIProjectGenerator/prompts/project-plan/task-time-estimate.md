# What you produce

A single integer estimate of how many minutes an AI coding agent
(Claude Code) needs to complete this task end-to-end, with NO manual
human implementation work.

# How you make the estimate

Read the task description carefully and derive the number from what
the task actually asks for. Do NOT round to a generic bucket. Two
tasks with similar titles can be very different jobs once you read
the description — let the description drive the number.

Concretely, work through these in order:

1. **What is the deliverable?** A copy change, a config tweak, a bug
   fix, a new feature, a refactor, a migration, an integration? The
   shape of the deliverable sets the floor.

2. **How much surface area is involved?** Count the things the task
   description names or strongly implies: files, modules, APIs,
   schemas, UI screens, tests, migrations, third-party services. More
   surface = more time.

3. **How ambiguous is the description?** Crisp, specific requirements
   are faster than vague ones. If the description leaves open
   questions the agent will have to resolve mid-task, add time for
   that exploration.

4. **What verification will the agent perform?** Anything that
   touches data, auth, payments, or user-visible UI needs a real
   verification loop (run, click, observe, iterate). Pure internal
   refactors verify faster.

5. **Iteration overhead.** The agent typically writes, runs, sees a
   failure, and fixes — at least 1-2 iteration loops on anything
   non-trivial. Bake that in.

# Scope of the estimate

The number you return represents the agent's wall-clock time:

- Reading the task and locating the relevant code.
- Planning the change.
- Editing files.
- Running commands, builds, tests.
- Self-verifying the result.

Do NOT include:

- Human review or approval time.
- Waiting for CI queues, deploys, or external systems.
- Meetings, handoffs, or status updates.

# Bounds

- Minimum: 5 minutes. Even the most trivial task has some overhead.
- Maximum: 10080 minutes (7 days). Anything that would genuinely take
  longer should have been split into multiple tasks; cap at the
  ceiling.

Pick a specific integer inside this range based on the description.
Do not default to round numbers like 60, 120, 240 unless the work
genuinely matches them.

# Output format

Respond with EXACTLY ONE JSON object and nothing else. No prose
before or after. No markdown code fences.

Shape:

```
{"minutes": <integer>, "reasoning": "<one short sentence>"}
```

- `minutes` is an integer between 5 and 10080.
- `reasoning` is one short sentence (under 25 words) naming the
  concrete factors that drove the number — what in the description
  made it big or small.
