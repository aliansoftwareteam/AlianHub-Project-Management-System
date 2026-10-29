# Progress: Fleet operations — staged upgrades, nightly backups, restore, monitoring and on-call

## Checklist

- [ ] T1 — Release rings — partly: canary, 10%, 50%, all, paused with an alert above 5% failures or two in a row, per-instance rollback; not built: maintenance windows, health gates between rings, release UI
- [ ] T2 — Backups — partly: nightly backups spread over the night, retention by plan, write-only presigned URLs, `backup.sh`/`restore.sh` in AlianHub's `deploy/managed`; not built: client-side encryption (M4), nightly restore verification
- [ ] T3 — Restore — partly: `cloudctl restore` in place, run live; not built: restore as a side instance, host evacuation, timed drills
- [ ] T4 — Monitoring — partly: per-instance health every 60 s, host reports for disk, memory and silence; not built: metrics and logs stack
- [ ] T5 — Alerting — partly: alerts with severities in the back office; not built: paging and on-call rotation
- [ ] T6 — Capacity and cost report — not built
- [ ] T7 — Runbooks — partly: `docs/m2-fleet-ops.md`, `docs/hosting-setup.md`

## Last step

Backup, restore and upgrade workflows and the fleet loops run in local and cloud mode. The backup
scripts are on `feat/managed-backup-scripts` in the AlianHub repository, PR into `chore/pre-staging`.

## Blockers

None. Backups go to Spaces through presigned URLs; per-tenant health is polled by the control plane
(DigitalOcean allows only 100 uptime checks per account).

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28 (night)
- Built overnight in `F:/Projects/alianhub-cloud` (merged into its local `main`), on three branches
  plus an integration branch: `feat/cloud-adapters`, `feat/host-agent`, `feat/fleet-ops`,
  `feat/m2-integration`. Contracts are in that repository's `docs/m2-contracts.md`; setup steps for
  the keys are in `docs/hosting-setup.md`.
- AlianHub repository: `deploy/managed/backup.sh` and `restore.sh` (with exit code 6 for failed
  transfers). They were run live on throwaway stacks, including a stopped one, and in cloud mode
  through the agent.
- Backups are on Wasabi (owner's choice of S3), written only through presigned URLs. Locally they
  go to SeaweedFS's `ahc-backups` bucket.
