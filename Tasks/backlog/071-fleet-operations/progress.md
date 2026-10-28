# Progress: Fleet operations — staged upgrades, nightly backups, restore, monitoring and on-call

## Checklist

- [ ] T1 — Release rings, health gates, automatic rollback, maintenance windows
- [ ] T2 — Nightly encrypted backups, retention, write protection, nightly restore verification
- [ ] T3 — Restore runbooks scripted in `cloudctl` and timed
- [ ] T4 — Monitoring: outside-in checks, hosts, containers, app, control plane, logs
- [ ] T5 — Alerting tiers and on-call rotation
- [ ] T6 — Weekly capacity and cost report
- [ ] T7 — Runbooks

## Last step

Not yet started.

## Blockers

None. Backups go to Spaces through presigned URLs; per-tenant health is polled by the control plane
(DigitalOcean allows only 100 uptime checks per account).

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
