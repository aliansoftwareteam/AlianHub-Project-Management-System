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
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 3) |
| 2026-09-11 | Steps 1, 2, 3, 4 and 6 merged in parallel (#587–#591) with the replay, trace and metrics PRs rebased over each other; step 5 (rate alerts) in progress on `feat/s3-rate-alerts`. Beta is `14.36.0-beta.71`. Deviations: `LOG_FORMAT=json` is opt-in; `AI_REPLAY` defaults to agent runs only; Prometheus counters count retained rows, so they fall when TTL indexes expire rows; OpenAI and DeepSeek error mapping follows documented bodies (no OpenAI SDK installed). |
| 2026-09-11 | Step 5 merged as #629 `1bb2ca6d` (build 103). Alerts are off by default so a new install behaves as before; an evaluator runs every `AGENT_ALERTS_INTERVAL_MINUTES` (default 15), keeps one open incident per condition and notifies once on open and once on clear. The alerts and metrics endpoints still do their own owner/admin check rather than `Modules/Agents/access.js`. |

## Last step
All six steps merged. Remaining for the exit gate: the owner and member sweeps of trace, replay, Health and Notification settings, and a live OTLP collector check.
