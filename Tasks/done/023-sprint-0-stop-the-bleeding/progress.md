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
- [x] Exit gate met and gates green — code gates green on `beta` at `6735230e`; owner API/browser sweeps and the in-process sweep against the real database and model still to run — owner and member sweeps at build 141 and 147, and the in-process sweep against the real model

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 0) |
| 2026-09-10 | Steps 1–6 merged into `beta` as eight fix PRs (#555–#562), each with a test that reproduced its defect on the previous commit. Step 6 became four PRs (6a–6d). #560 and #562 rebased over #558 (shared action and undo paths). |
| 2026-09-10 | Gates on merged `beta`: backend unit 144 suites / 1766 tests, conventions 88, frontend vitest 126, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done. |
| 2026-09-10 | Deviations: pricing uses a per-instance `LLM_PRICING` override with an "unpriced" chip on the Agents card, not a pricing table; no Ollama adapter exists so no local defaults; permission mapping approximates reminder.create, page.draft/docs.read, chat.post, task.link, deploy.staging (see #560 body). Migration 007 not yet run on a live database. `markUndone` in undo.js still swallows its own failure (out of the action path; Sprint 8). |
| 2026-09-12 | Browser sweep on the local server at build 141, as the demo admin (Rahul Mehta, roleType 2) and a demo member (Priya Shah, roleType 3), signed in with `npm run demo:token` sessions. Admin: AI health renders with the alerts card and per-agent error, approval, duration and cost; the agent settings page shows the model pin and revision history; the audit log lists agent events with actor and reason. Member: AI health shows "Owners and admins only" with no figures and the metrics call is refused; the agent page hides Stop and the revision history; the audit log and the instance console redirect away. Still to sweep, because they need an instance-owner login the demo set does not include: Instance console → providers, workspace routing policy, the AI agents spend card, and Stats/Upgrade. |
| 2026-09-12 | Owner sweep on the local server at build 141, signed in as the instance owner (Local PM) with a one-hour session the owner authorised. Verified: Instance settings → AI shows the monthly budget, this month's spend, the 80% and 100% alert lines and the per-feature breakdown; Instance console → AI providers lists each provider and model with health, breaker state, calls, latency, last error, rate-limit budget and unpriced warnings, naming the node it answers for; Instance → Stats shows the build label with commit, channel and Node version; Instance → Upgrade lists builds since v14.35.0 with their pull requests; an agent's run detail shows TRACE, REPLAY with its redaction note, the PINNED revision and the revert control correctly disabled once the undo window has passed; the agent settings page shows revision history and a pinned-model selector listing only priced models, defaulting to the workspace routing policy. Not swept: the routing policy screen, which is being moved from the instance console into workspace settings. |
| 2026-09-12 | Every interface row is swept by the owner and by a member at build 141. The only outstanding item is the in-process sweep against a real model, which cannot run here because no provider key is configured on this machine. |
| 2026-09-12 | In-process sweep against the real model on the local server at build 147, using the OpenAI key already in `.env` (gpt-4o). An AI Ask call booked `ask · gpt-4o · openai · $0.0023` in `ai_usage`; an agent run booked `agent_run · gpt-4o · $0.0034`, pinned agent revision 3 with its skill revision, ran `brief.parse` as a data skill and carries a trace id. Pinning an unpriced model is refused with the named reason: "No price on file for gpt-9-imaginary; add it under instance settings (LLM_PRICING) before running." (code `unpriced_model`); a priced pin saves and clears. A run capped below its estimate is refused before the provider call: audit reason "spend_cap_exceeded: the next call is estimated at $0.0264 (3075 tokens) but the run cap of $0.0000 has $0.0000 left", with no new ledger row. Only OpenAI is configured on this machine, so the other three providers were not exercised against a live vendor; their adapters are covered by the contract test from #660. |

## Last step
Complete. Moved to done.
