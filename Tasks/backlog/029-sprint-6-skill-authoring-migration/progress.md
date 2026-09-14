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
| 2026-09-14 | Step 2 built on `feat/skills-as-data`: `digest.ceo` and `project.guide` are documents; their code files are deleted |

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


## Step 2 — what shipped

**Both skills are documents.** `digest.ceo` and `project.guide` were JavaScript modules the engine ran
bespoke `gather`, `buildUserPrompt`, `verify` and `toChanges` functions for. They are now entries in
`Modules/Agents/skills/seeds/`, written in the closed vocabulary, and `Modules/Agents/skills/digest.js`
and `Modules/Agents/skills/projectGuide.js` are **deleted**. Nothing branches on which of the two kinds
a skill is: `compile()` moved out of `skillRecord.js` into `skills/compile.js` and is now the single
function that turns a document — a company's own or a built-in one — into the generic-skill contract.
`skills/index.js` compiles the seeds instead of requiring code modules, so the built-in reporter and
the guide reach the orchestrator by exactly the path an admin's skill reaches it.

**Resolution, in order:** the company's own row, then the built-in seed, then a code skill. The middle
step is new and it is what makes deleting the code files safe: a migration record is written once
globally, so a workspace created after 022 runs would never have been seeded, and without the built-in
it would have lost both skills. `qa-review` and `pr.summary` stay code, as ADR 003 §3 requires, because
their evidence layer reads what the vocabulary does not carry.

**Three things the vocabulary could not say, now catalogue entries:**
- `fallback` — a template rendered from gathered data alone and posted when the model answered nothing.
  This is where the reporter's deterministic digest went; without it a data skill whose provider is down
  proposes nothing, which is the regression the code skill existed to avoid.
- `grounded` — `{ keys, numbers, fields, mustNameKey, allowHours }`. The reporter's hand-written
  ground-truth check, generalised: any skill can now hold named answer fields to the tasks and counts
  its readers actually measured. `skills/grounding.js` is the one implementation.
- The `project.tasks` reader gained the board split (`dueSoon`, `inReview`, `moved`, the five bucket
  lists, `plan` by sprint, `next`, and the `keys`/`counts` a grounded skill checks against), and
  `project` gained `requireGuide`, which is how the guide still skips a project with no stored guide.

**Model pin: already satisfied by step 1, not rebuilt.** `SkillEditor.vue` exposes the per-skill pin,
`validateSkill` checks it through `AICore/modelPin`, `model` is in `EDITABLE` and `compile()` carries it.
Worth recording separately: the pin is stored and validated but **not yet forwarded to the provider** —
`AICore/modelCall.js:askModel` builds its request from `getProvider()` and never reads `skill.model`,
and the same is true of the agent-level pin. The router already accepts a pinned model
(`llmProvider/router.js`, `decision.js` `pin_dropped`), so honouring the pin is the cost-and-routing
half of ADR 003 phase 3, not the migration half this step covers.

**The `agent` label semantics and `project.guide`'s split are unchanged.** Both skills declare
`project_task`, whose scope is `project`, so neither is ever the agent for one task and both read
`agent-after`. `tests/agent-split.test.js` and `tests/ai-project-execute-agents.test.js` passed
**untouched**, the same evidence pattern step 1 used, and `tests/agent-skills-as-data.test.js` now pins
the guide's `agent-after` explicitly so it cannot move silently again.

**Deviations, recorded.**
- The guide's comment used to list the proposed task titles; a template filter takes numbers only, so it
  now says "Proposed N follow-up task(s)" and each title appears on its own subtask change. This is the
  wording `brief.parse` already uses, and the subtask mappings run before the comment so the count is
  available — which puts the subtasks ahead of the comment in the proposed list.
- The reporter's deterministic fallback listed 8 overdue and 5 blocked rows; both are now
  `rowsPerBucket` (10).
- A dropped item's wording changed with the generalised gate ("it names no task from the data" rather
  than "look-first item names a task not in the data"). What is dropped is identical, including that
  "24 hours" is the skill's own window while "24 days" is a claim.

## Gates (step 2)

| Gate | Result |
|---|---|
| `jest --selectProjects unit conventions` | 303 suites, 4398 tests, green (302/4381 before) |
| `vitest run` (frontend) | 47 files, 384 tests, green |
| `node scripts/i18n-backfill.js` | 9 keys filled in 10 locales; ja/ko/ptBr inherit `en.js` |
| `node scripts/i18n-check.js` | 8036/8036 in every locale, 0 missing, exit 0; bare-string baseline unchanged |
| eslint (backend + `vue-cli-service lint`) | 0 errors |
| `vue-cli-service build` | complete |
| In-process sweep, real database | read-only, below |

**Revert checks (tests proven non-vacuous).**
- `fallback` and `grounded` unwired in `compile()` → **5 failures**: the reporter's digest without a
  model, its end-to-end orchestrator run, the ground-truth gate and the gate applied by the
  orchestrator, and the guide's gathered plan.
- `project.guide`'s declared `inputs` emptied in its seed → **3 failures**, including
  "still reads agent-after for the project guide, as step 1 recorded".

**In-process sweep, real database** (company `6a8ee973…`, project **AlianHub Platform**, read-only,
no model, no writes): the reader returned 58 tasks — 38 open, 20 done, 10 unassigned — grouped by sprint
with `next` = "AP-1 Assign yourself the onboarding checklist". `digest.ceo` built its prompt and, with no
provider, proposed one `task.comment` carrying "38 open task(s): 0 overdue, 0 blocked, 0 in review,
10 unassigned." Its ground-truth gate, given an answer naming `ZZ-999`, dropped both the sentence and
the look-first item and kept "There are 38 open tasks." `project.guide` skipped with "AlianHub Platform
has no stored guide yet — generate one from the project page first", the message the deleted code skill
gave, now produced by the `requireGuide` reader param.

New tests: `tests/agent-skills-as-data.test.js` (17). `tests/agent-skills.test.js` and
`tests/ai-project-guide.test.js` keep every behavioural assertion, rewritten off the deleted modules'
internals and onto the document.

## Still open

- Owner and member browser sweeps of the Skill Library, the editor's new fallback and ground-truth
  fields, and a run of either migrated skill. Not run here: the owner's dev server runs the main
  checkout, and a second server against the same database would run migrations at start.
- The exit-gate acceptance bullet still needs a live model; `AI_API_KEY` is empty on this instance, so
  every check above is the no-model path.
- A brand-new workspace sees both skills as `source: "code"` until it writes its own copy, because the
  built-in seed is not a stored row. Editing one from the Library would need copy-on-write, which no
  interface row asks for yet.
- `brief.parse` still keeps a code skill beside its seed; folding it onto the built-in-seed path the
  same way is a tidy-up this step did not take.
- Honouring the per-skill and per-agent model pin at the call, against a priced allowlist, with the
  unpriced-model warning — the other half of ADR 003 phase 3.

## Last step
Step 2 on `feat/skills-as-data`; the model-pin clause was already met by step 1 and was not rebuilt.
