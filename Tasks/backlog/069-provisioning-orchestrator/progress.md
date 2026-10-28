# Progress: Provisioning orchestrator and host agent — paid to live in three minutes, and every change after

## Checklist

- [ ] T1 — Data model and Agenda-based workflow engine (idempotent steps, retries, locks)
- [ ] T2 — Adapters: compute, dns, objectStore, mailRelay, registry (+ fakes)
- [ ] T3 — Host agent (claim/run/report, render, cosign verify, instance.call, self-update)
- [ ] T4 — Provision workflow (paid → live)
- [ ] T5 — Change workflows (entitlements, resize, move, lifecycle, cancel, reactivate, delete, rename, rotate, upgrade)
- [ ] T6 — Agent and instance-facing control-plane endpoints
- [ ] T7 — `cloudctl` CLI for the M2 beta
- [ ] T8 — Placement and capacity, warm spare host
- [ ] T9 — Unit, contract, end-to-end and chaos tests

## Last step

Not yet started.

## Blockers

None for the engine. Adapters follow resources/digitalocean.md (DO API v2, Cloudflare, Wasabi IAM,
Spaces presigned backups, Resend, DOCR mirror); Q26 can swap the file-storage adapter.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- 074 (local Docker host) builds the first slice of this task: step runner, provision and change
  workflows, entitlement signing, with local host/DNS/storage adapters; M2 adds the cloud adapters.
