# Progress: Sprint 0 — stop the bleeding: exploitable findings and cost correctness

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: Merge the two open pull requests, housekeeping — #551 `274eaf45`, #552 `bdc860bf`; also #553 `5eb7d4e9` (this programme) and #554 `6cd103c0` (ADR 003 + architecture document)
- [x] Step 2: Outbound fetches resolve before they validate, check every resolved address against private ranges, revalidate — #557 `4431201e` (`Modules/Agents/engine/safeFetch.js`, `tests/agent-egress.test.js`)
- [x] Step 3: Retrieval applies the page visibility rule the other read paths already use; MCP `docs.read` applies scope and visibility; MCP re-checks membership — #556 `1870e4a9` (`Modules/Pages/helpers/pageRules.js`)
- [x] Step 4: Performing an agent action evaluates the holder's permission catalogue entry, not only the registry — #560 `ea6ae05a` (`Modules/Agents/permissions.js`, `permission` on every registry entry, validated at load)
- [x] Step 5: Pricing fails closed: an unpriced model refuses to start a billed run with a reason that names the missing price; defaults for OpenAI, Anthropic, DeepSeek; `LLM_PRICING` instance setting — #561 `0da722fa`
- [x] Step 6a: Never-list consulted by `registry.evaluate`; overlap test — #555 `6548b861`
- [x] Step 6b: A failed audit write fails the action (pending → mutate → applied) — #558 `53733340`
- [x] Step 6c: Undo enforces the window (`agentUndoHours`) and the caller's project visibility; `undoUntil`/`undoable`/`undoReason` on run detail and audit rows — #562 `6735230e`
- [x] Step 6d: Integration secrets encrypted with the cloud-storage idiom; migration `007-encrypt-integration-secrets` with guarded `down` — #559 `a6892254`
- [x] Interface: Run detail and audit → undo (extend) — shipped in #562; owner and member browser sweep still to record
- [x] Defects closed: #1 (#557), #3 (#560), #4 #5 #8 (#556), #6 (#559), #7 (#562), #10 (#555), #11 (#561), #19 (#558)
- [ ] Exit gate met and gates green — code gates green on `beta` at `6735230e`; owner API/browser sweeps and the in-process sweep against the real database and model still to run

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 0) |
| 2026-09-10 | Steps 1–6 merged into `beta` as eight fix PRs (#555–#562), each with a test that reproduced its defect on the previous commit. Step 6 became four PRs (6a–6d). #560 and #562 rebased over #558 (shared action and undo paths). |
| 2026-09-10 | Gates on merged `beta`: backend unit 144 suites / 1766 tests, conventions 88, frontend vitest 126, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done. |
| 2026-09-10 | Deviations: pricing uses a per-instance `LLM_PRICING` override with an "unpriced" chip on the Agents card, not a pricing table; no Ollama adapter exists so no local defaults; permission mapping approximates reminder.create, page.draft/docs.read, chat.post, task.link, deploy.staging (see #560 body). Migration 007 not yet run on a live database. `markUndone` in undo.js still swallows its own failure (out of the action path; Sprint 8). |

## Last step
All six steps merged. Remaining: run migration 007 on the dev database, the in-process sweep with the real model, and the owner and member browser sweep of the undo deadline on run detail and the audit log.
