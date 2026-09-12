# Progress: Sprint 4 — the model router

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: Model and provider on the chat options; a provider registry that includes a Google adapter alongside OpenAI, A — #660 (build 135): provider registry, Google adapter, normalised options, contract test
- [x] Step 2: Task classes with a quality floor, latency target and input budget each; a per-tenant policy table; per-agent  — #664 (build 140): four task classes, per-workspace policy, pins validated against the priced catalogue, migration 014
- [x] Step 3: Health tracking per provider and model with a circuit breaker, half-open probes, failover to the next candidat — #663 (build 138): health window, breaker with half-open probes, failover, token buckets, retry, providers console
- [ ] Step 4: Pre-flight token estimate, reservation against the tenant budget, reconciliation after; the routing decision a
- [x] Interface: Instance console → providers (new) — #663 (build 138); owner and member sweep still to record
- [x] Interface: Workspace settings → routing policy (new) — #664 (build 140); owner and member sweep still to record
- [x] Interface: Agent and skill settings → model pin (extend) — #664 (build 140) for agents; the per-skill pin is stored and validated but has no editor until Sprint 6
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 4) |
| 2026-09-12 | Started. Step 1 (provider registry with a Google adapter, model and provider on the chat options, per-provider normalisation) is in progress on `feat/sprint-4-provider-registry`. Steps 2–4 wait for it, because they build on the registry. Task 035's follow-ups are closed apart from the owner decisions and items 14, 26 and 48–51. |
| 2026-09-12 | Steps 1–3 merged: #660 (build 135), #663 (build 138), #664 (build 140). Everything sits behind `AI_MODEL_ROUTER`, default off, so behaviour is unchanged until a policy is set. Step 1's new contract test caught a redaction gap (a Google key could appear in an error message). Step 4 (token estimate, budget reservation, routing decision on the span and replay record) is in progress. |
| 2026-09-12 | Browser sweep on the local server at build 141, as the demo admin (Rahul Mehta, roleType 2) and a demo member (Priya Shah, roleType 3), signed in with `npm run demo:token` sessions. Admin: AI health renders with the alerts card and per-agent error, approval, duration and cost; the agent settings page shows the model pin and revision history; the audit log lists agent events with actor and reason. Member: AI health shows "Owners and admins only" with no figures and the metrics call is refused; the agent page hides Stop and the revision history; the audit log and the instance console redirect away. Still to sweep, because they need an instance-owner login the demo set does not include: Instance console → providers, workspace routing policy, the AI agents spend card, and Stats/Upgrade. |
| 2026-09-12 | Owner sweep on the local server at build 141, signed in as the instance owner (Local PM) with a one-hour session the owner authorised. Verified: Instance settings → AI shows the monthly budget, this month's spend, the 80% and 100% alert lines and the per-feature breakdown; Instance console → AI providers lists each provider and model with health, breaker state, calls, latency, last error, rate-limit budget and unpriced warnings, naming the node it answers for; Instance → Stats shows the build label with commit, channel and Node version; Instance → Upgrade lists builds since v14.35.0 with their pull requests; an agent's run detail shows TRACE, REPLAY with its redaction note, the PINNED revision and the revert control correctly disabled once the undo window has passed; the agent settings page shows revision history and a pinned-model selector listing only priced models, defaulting to the workspace routing policy. Not swept: the routing policy screen, which is being moved from the instance console into workspace settings. |
| 2026-09-12 | Step 4 merged as #668 `7331c646` (pre-flight estimate, budget reservation with crash-safe expiry, routing decision on the span and replay row). Exit gate passed in #670 `6fa88bc4`: with one provider blackholed, runs complete on the fallback, the decision names the skip reason, the breaker opens and the console reports it, a half-open probe closes it, and with the flag off there is no failover. |

## Last step
Step 4 in progress; then the owner and member sweeps and the blackholed-provider exit gate.
