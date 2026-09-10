# Progress: Sprint 3 — observability foundation

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: OpenTelemetry with the trace identifier on the run row, every step row, every audit row and every log line; lo
- [ ] Step 2: The replay record per model call: prompt hash and reference, retrieved chunk identifiers, raw response, model 
- [ ] Step 3: A metrics endpoint behind admin auth: rate, errors and duration per workflow, step, agent and model; token and
- [ ] Step 4: Provider error codes preserved end to end and grouped, so an error tracker has something to group.
- [ ] Step 5: Alerts on rates: error rate per agent, approval rate falling, cost against forecast, queue age.
- [ ] Step 6: (added) The two competing uncaught-exception handlers collapse into one path that reports, flushes and exits.
- [ ] Interface: Run detail → trace (extend)
- [ ] Interface: Run detail → replay (new)
- [ ] Interface: AI hub → health (new)
- [ ] Interface: Notification settings (extend)
- [ ] Defects closed: #21
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 3) |

## Last step
Not started.
