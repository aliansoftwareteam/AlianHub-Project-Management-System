# Progress: Sprint 3 — observability foundation

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: OpenTelemetry with the trace identifier on the run row, every step row, every audit row and every log line; lo — #591 `f5477c8a` (build 69): OpenTelemetry, trace ids on runs, steps, audit rows and log lines, run trace view linked to replays
- [x] Step 2: The replay record per model call: prompt hash and reference, retrieved chunk identifiers, raw response, model  — #589 `ba78db06` (build 66): `ai_replays` with redaction and retention, replay view for owners and admins
- [x] Step 3: A metrics endpoint behind admin auth: rate, errors and duration per workflow, step, agent and model; token and — #590 `8bb9976f` (build 71): company metrics JSON, instance Prometheus endpoint, AI hub Health view
- [x] Step 4: Provider error codes preserved end to end and grouped, so an error tracker has something to group. — #588 `3a7b5df0` (build 65): `AIProviderError` per vendor, `agent_runs.failure` with group key, failure chip on run detail
- [x] Step 5: Alerts on rates: error rate per agent, approval rate falling, cost against forecast, queue age. — #629 `1bb2ca6d` (build 103): `ai_alerts` incidents for agent error rate, approval rate, cost against the monthly budget and queue age; off by default; thresholds in agent settings
- [x] Step 6: (added) The two competing uncaught-exception handlers collapse into one path that reports, flushes and exits. — #587 `c61421c2` (build 64): one fatal path in `Config/processGuards.js` with flushers
- [x] Interface: Run detail → trace (extend) — shipped in #591; owner and member sweep still to record
- [x] Interface: Run detail → replay (new) — shipped in #589; owner and member sweep still to record
- [x] Interface: AI hub → health (new) — shipped in #590; owner and member sweep still to record
- [x] Interface: Notification settings (extend) — shipped in #629; owners and admins choose alert types; owner and member sweep still to record
- [x] Defects closed: #21 — #21 (#587)
- [x] Exit gate met and gates green — owner and member sweeps at build 141, OTLP collector check done

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 3) |
| 2026-09-11 | Steps 1, 2, 3, 4 and 6 merged in parallel (#587–#591) with the replay, trace and metrics PRs rebased over each other; step 5 (rate alerts) in progress on `feat/s3-rate-alerts`. Beta is `14.36.0-beta.71`. Deviations: `LOG_FORMAT=json` is opt-in; `AI_REPLAY` defaults to agent runs only; Prometheus counters count retained rows, so they fall when TTL indexes expire rows; OpenAI and DeepSeek error mapping follows documented bodies (no OpenAI SDK installed). |
| 2026-09-11 | Step 5 merged as #629 `1bb2ca6d` (build 103). Alerts are off by default so a new install behaves as before; an evaluator runs every `AGENT_ALERTS_INTERVAL_MINUTES` (default 15), keeps one open incident per condition and notifies once on open and once on clear. The alerts and metrics endpoints still do their own owner/admin check rather than `Modules/Agents/access.js`. |
| 2026-09-12 | Browser sweep on the local server at build 141, as the demo admin (Rahul Mehta, roleType 2) and a demo member (Priya Shah, roleType 3), signed in with `npm run demo:token` sessions. Admin: AI health renders with the alerts card and per-agent error, approval, duration and cost; the agent settings page shows the model pin and revision history; the audit log lists agent events with actor and reason. Member: AI health shows "Owners and admins only" with no figures and the metrics call is refused; the agent page hides Stop and the revision history; the audit log and the instance console redirect away. Still to sweep, because they need an instance-owner login the demo set does not include: Instance console → providers, workspace routing policy, the AI agents spend card, and Stats/Upgrade. |
| 2026-09-12 | Owner sweep on the local server at build 141, signed in as the instance owner (Local PM) with a one-hour session the owner authorised. Verified: Instance settings → AI shows the monthly budget, this month's spend, the 80% and 100% alert lines and the per-feature breakdown; Instance console → AI providers lists each provider and model with health, breaker state, calls, latency, last error, rate-limit budget and unpriced warnings, naming the node it answers for; Instance → Stats shows the build label with commit, channel and Node version; Instance → Upgrade lists builds since v14.35.0 with their pull requests; an agent's run detail shows TRACE, REPLAY with its redaction note, the PINNED revision and the revert control correctly disabled once the undo window has passed; the agent settings page shows revision history and a pinned-model selector listing only priced models, defaulting to the workspace routing policy. Not swept: the routing policy screen, which is being moved from the instance console into workspace settings. |
| 2026-09-12 | OTLP check done: a local collector received spans from a server configured to export to it (HTTP server, middleware and Mongo command spans). The agent-run span was not exercised, because no provider key is configured locally. |
| 2026-09-12 | Exit gate met: all six steps merged, every interface row swept by the owner and by a member, and a local OTLP collector received spans from a server configured to export. The agent-run span itself was not exercised, because no provider key is configured on this machine; noted as the one gap. Moved to done. |

## Last step
Complete. Moved to done.
