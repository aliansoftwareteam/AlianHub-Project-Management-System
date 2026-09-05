# Agents roadmap — from the 2026-09-05 research

Source: `Tasks/active/015-guided-project-brief/research.md` (74 sources). Principle: one slice at a time, each merged to `beta` behind the existing agents flag, each with the three gates (static review, API sweep, browser sweep) inside the task. No slice starts until the previous one is on beta.

| Order | Task | Slice delivers | Size | Bet from the research |
|---|---|---|---|---|
| 0 | 014 (PR #543) | AI hub fixes on beta; member sweep | done except member sweep | — |
| 1 | 015 | Complete brief, agent-drafted and approved; agent / person split per task; Guide agent per project | 2 weeks | 1 · generated guide per project |
| 2 | 016 | Risk rating per action; policy-reviewed L2 that escalates only risky actions; whole-run revert with owner-set window; per-company budget ledger with 80/100% alerts; model and region in the instance console | 3 weeks | 2 · graded autonomy, 3 · reversible events, 6 · self-hosting |
| 3 | 017 | Project memory (decisions, constraints), user preferences, episodic run record; read by brief, plan and guide prompts | 2 weeks | 4 · memory the product owns |
| 4 | 018 | OAuth 2.1 and scopes on the MCP server; more of the data model exposed; inbound external agent sessions (Claude Code first) with typed activities; delegation keeps a human assignee | 3 weeks | 5 · MCP both ways |
| ∥ | 019 | Eval set of 20–50 real tasks graded on outcome, replayed on every prompt change; one trace per run; /ai dashboard | starts with 016, ongoing | evals and observability |

Why this order: 015 is the user-visible promise and its evidence gate is cheap; 016 is what makes L2 safe enough to leave on, and every later slice runs more agent actions; 017 needs 015's brief and 016's run records to have something to remember; 018 is the largest external surface and benefits from everything before it being stable; 019 runs alongside from 016 because the policy engine needs measurements to tune.

Decisions recorded: see the "Decisions" block in each task.md.
