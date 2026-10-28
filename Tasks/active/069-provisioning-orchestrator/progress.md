# Progress: Provisioning orchestrator and host agent — paid to live in three minutes, and every change after

## Checklist

- [x] T1 — Step engine: idempotent `{ name, run, verify }` steps, one `jobs` row per attempt, retries, resume, one workflow per instance (an in-process runner over `jobs`; Agenda not used)
- [ ] T2 — Adapters — partly: compute (DigitalOcean), dns (Route 53), objectStore (Wasabi bucket per installation), backups, tls (Let's Encrypt), fakes and dry run; not built: mailRelay (instance mail is a Resend key pushed by config), registry credentials (GHCR by digest only)
- [ ] T3 — Host agent — partly: claim/run/report, render, up/update/restart/down/destroy, backup/restore, instance.call, edge.tls, sealed secrets; not built: cosign check, self-update, token rotation
- [x] T4 — Provision workflow (paid → live)
- [ ] T5 — Change workflows — partly: entitlements, resize, lifecycle, cancel, reactivate, delete, rename, restart, backup, restore, upgrade; not built: move_host, rotate_secrets
- [ ] T6 — Endpoints — partly: `/agent/v1` (claim, result, report, host tarballs); not built: the entitlements pull endpoint and the mail webhook
- [x] T7 — `cloudctl` CLI for the M2 beta
- [x] T8 — Placement and capacity, new host when full, capacity alert under 20%
- [ ] T9 — Tests — partly: unit tests for every part and a live run on this PC; not run: provider sandboxes, chaos

## Last step

Built and run end to end on this PC in cloud mode with a host registered by hand. Waiting for the
owner's DigitalOcean, Route 53 and Wasabi keys to run `npm run cloud:check` and the first real host.

## Blockers

None for the engine. Adapters follow resources/digitalocean.md (DO API v2, Cloudflare, Wasabi IAM,
Spaces presigned backups, Resend, DOCR mirror); Q26 can swap the file-storage adapter.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- 074 (local Docker host) builds the first slice of this task: step runner, provision and change
  workflows, entitlement signing, with local host/DNS/storage adapters; M2 adds the cloud adapters.

### 2026-10-28 (night)
- Built overnight in `F:/Projects/alianhub-cloud` (merged into its local `main`), on three branches
  plus an integration branch: `feat/cloud-adapters`, `feat/host-agent`, `feat/fleet-ops`,
  `feat/m2-integration`. Contracts are in that repository's `docs/m2-contracts.md`; setup steps for
  the keys are in `docs/hosting-setup.md`.
- Owner decisions recorded above: Route 53 for DNS, a Wasabi bucket and IAM user per
  installation, keys added by the owner later.
- Live on this PC, `ORCHESTRATOR_MODE=cloud` with `COMPUTE_PROVIDER=manual`, `DNS_PROVIDER=localhost`
  and `OBJECT_STORE=seaweed`:
  - **Host:** `cloudctl host register` issued the token; the real agent reported and the host
    became active.
  - **Lifecycle:** provision of a Pro instance reached `active` through all 11 steps through the
    agent; a plan push, suspend and resume worked.
  - **Backup and restore:** a backup landed in SeaweedFS (35 KB); a restore ran with its
    pre-restore backup and health came back 200.
  - **Upgrade:** to the same digest, so a no-op; the real update path did not run live.
  - **Delete:** left no containers, volumes or tenant folder.
- `npm run cloud:check` with no keys names every missing setting per provider. A dry-run `tls renew`
  logs the Route 53 `_acme-challenge` change and pushes nothing.
- Tests in `alianhub-cloud`: 312 server, 25 agent, 52 shared, 41 portal, 20 back office; lint and
  the build pass.
