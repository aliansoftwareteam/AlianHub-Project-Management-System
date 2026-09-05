# 016 — Agent trust layer: risk-rated actions, policy-reviewed L2, whole-run revert, budgets

Status: planned · runs in parallel with 015 · branch `feat/agent-trust-layer` (from `beta`)

## Goal
An owner can leave an agent at L2 and trust it: every action is rated for risk, a policy decides per action whether to act or to propose, any run can be reverted as a whole inside a window the owner sets, and spend is capped and alerted per company.

## Why now
Anthropic's measurement (research [50]): people approve 97% of agent actions and catch 13.6% of planted dangerous ones; a classifier caught 89%. A product that gates everything on Approve gets rubber-stamped. Replit's outage (research [52]) is what happens without a revert path.

## Scope
- **Risk rating on the registry.** Each action in `Modules/Agents/actions.js` carries `{ write, reversible, scope: task|project|workspace, money }`. The never-list stays absolute.
- **Policy-reviewed L2.** `Modules/Agents/policy.js`: given agent (allowedActions, projectIds, caps), action rating and run context, returns `act | propose | refuse` with a reason. L2 runs call it per action; `propose` files a proposal for that action only, the run continues. Every decision is recorded on the run (`decisions[]`) so the escalation rate can be measured.
- **Whole-run revert.** `POST /agents/runs/:id/revert` walks the run's audit rows in reverse using their undo descriptors; window is `company.settings.agentUndoHours` (default 24, owner-set in the instance console); partial failures reported per action.
- **Budgets.** Per-company monthly agent budget with 80% and 100% alerts (existing notification pipeline), runs refused at 100% with the reason; spend rows keyed by company, agent, run, model. Instance console shows model provider, key presence, allowed region, budget.
- **UI.** Run detail shows each decision and its reason; agent settings show "what L2 will do without asking" from the ratings; instance console budget and model panel.

## Out of scope
- Classifier-based review (an LLM judging each action). Policy is rule-based first; the eval set in 019 decides whether a classifier is worth adding.
- Per-user budgets.

## Acceptance
- [ ] Every registry action has a rating; a test fails when one is added without it.
- [ ] L2 run with one risky action: the safe actions apply, the risky one becomes a proposal, the run ends `waiting_approval` with `decisions[]` explaining each.
- [ ] Revert of a run with 6 actions restores all 6; a revert after the window is refused with the reason; partial failure reports which actions did not revert.
- [ ] Company at 100% budget: new runs refused, rule-triggered runs refused, owner notified once.
- [ ] Gates: `npm test`, vitest, i18n check, lint, build, browser sweep as owner and member.

## Decisions
- Default autonomy for a new agent: **L1 Suggest** (owner, 2026-09-05).
- Undo window default: 24 h, owner-set in the instance console.
- Ships to beta; one release to main at the end of the programme.
