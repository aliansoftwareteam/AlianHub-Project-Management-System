# Progress: Sprint 6 — skill authoring and migration

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: The Skill Library becomes a library: create, edit, dry-run against a chosen task, risk preview from the union 
- [ ] Step 2: The reporter
- [ ] Interface: Skill Library (extend)
- [ ] Interface: Agent settings → skills (extend)
- [ ] Interface: Agent and skill settings → model pin (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 6) |
| 2026-09-14 | Step 1 built on `feat/skill-library-manifest`: the three duplicated input tables are gone, the Skill Library is a library, agent settings pick from the manifest |

## Step 1 — what shipped

**The three duplicated input tables are gone.** `Modules/Agents/workKinds.js` is now the one copy of the
work kinds and of what a task carries; the frontend picker reads it through the `@agentWork` alias
(the `@pageContent` pattern), so `agentFit.js` no longer restates `WORK_KINDS`, `SKILL_INPUTS` or
`taskInputs`. Which skill needs which input comes from the skill's own declared `inputs`, answered by
`Modules/Agents/skills/inputRules.js` against `INPUT_CATALOGUE` and carried on the manifest as
`requires: { code, needs, scope }`. `taskSplit.js` resolves an agent's skill keys (and aliases)
through that manifest; `skillInputs.js` reads `requires` off the skill the server sent.
`tests/agent-split-parity.test.js` is deleted — there is nothing left to keep in parity.

**`agent` label semantics are unchanged.** An input whose scope is `project` (`project_task`) marks a
skill that reports on a project, so it is never the agent for one task — the rule the old
`needs: () => false` row encoded. `tests/agent-split.test.js` and `tests/ai-project-execute-agents.test.js`
passed untouched through the rewrite.

**Deviation, recorded:** `project.guide` was in none of the old tables, so it was skipped entirely and
its tasks fell to a person. It declares `project_task`, so it now behaves like `digest.ceo` —
`agent-after`, "it reports on a whole project, not on one task". No task becomes `agent` that was not
one before.

**Dry run.** `POST /api/v2/agents/skills/:key/dry-run` resolves the skill, gathers what it would read,
renders the prompt it would send and states the risk from the union of the actions it emits, cut to a
chosen agent's allowed actions. No model call and no write, so it works with `AI_API_KEY` unset.

**Interface rows.**
- *Skill Library* — lists every skill the workspace can run (data and built-in), with source, risk,
  requirement and emitted actions; create, edit, dry-run, retire. The action registry stays as a
  reference table at the foot of the page.
- *Agent settings → skills* — every live manifest skill is offered; per skill the chips are the
  effective actions (the intersection with the agent's allowed actions) with the rest struck through.
  Stored skills no longer carry their own `actions` copy.
- *Model pin* — per-skill pin in the editor, validated by `AICore/modelPin` at save time.

## Gates

| Gate | Result |
|---|---|
| `jest --selectProjects unit conventions` | 302 suites, 4381 tests, green |
| `vitest run` (frontend) | 47 files, 384 tests, green |
| `node scripts/i18n-backfill.js` | 68 keys filled in 10 locales; ja/ko/ptBr inherit `en.js` |
| `node scripts/i18n-check.js` | 8027/8027 in every locale, 0 missing; bare-string baseline unchanged |
| eslint (backend + `vue-cli-service lint`) | 0 errors |
| `vue-cli-service build` | complete |
| In-process sweep, real database | manifest, `enrichAgentSkills`, board split and three dry runs against company `6a8ee973…`, project **AlianHub Platform** — read-only |

**Revert checks (tests proven non-vacuous).**
- `inputRules.inputsDeclaredBy` made to return nothing → 10 failures across `agent-split`,
  `agent-fit`, `agent-skill-dry-run` and `agent-effective-actions`.
- The dry run's generic-only prompt guard removed → "gathers a page-audit skill without building the
  prompt it cannot render yet" fails.

New tests: `tests/agent-skill-dry-run.test.js` (7), rewritten `frontend/tests/unit/skillInputs.spec.js`
(6, manifest-driven), `tests/agent-fit.test.js` now feeds the picker the real manifest.

## Still open for step 1

- Owner and member browser sweeps of the Skill Library, the editor, the dry-run panel and agent
  settings → skills. Not run here: the owner's dev server runs the main checkout, and booting a
  second server against the same database would run migrations at start.
- The exit-gate acceptance bullet — an admin creating a skill, assigning it and running it on a task
  end to end — needs a live model, which this instance has no key for.
- Step 2 (the reporter and project-guide skills re-expressed as data) belongs to another change.

## Last step
Step 1 on `feat/skill-library-manifest`; step 2 not started.
