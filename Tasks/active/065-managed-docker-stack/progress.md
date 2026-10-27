# Progress: Hosting-ready image and compose template — many customers per server, one command up

## Checklist

- [ ] T1 — Self-hosted compose without fixed names (with a legacy-names path)
- [ ] T2 — Managed compose template, tiers, read-only root filesystem
- [ ] T3 — `deploy/managed/up.sh`, `down.sh`, `destroy.sh`
- [ ] T4 — Release digests, `releases/index.json`, registry per Q24, cosign
- [ ] T5 — Image hardening, Trivy, size target
- [ ] T6 — `managed-smoke` CI job with two tenants

## Last step

Not yet started.

## Blockers

None. Registry per resources/digitalocean.md: GHCR as the source, DOCR mirror from M4.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
