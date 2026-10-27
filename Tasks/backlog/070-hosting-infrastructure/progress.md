# Progress: Hosting infrastructure on DigitalOcean — account, hosts, network, edge, TLS, registry, storage, mail

## Checklist

- [ ] T1 — Team, limits (Tier 4), scoped tokens, API client
- [ ] T2 — Region, VPC, firewalls by tag, reserved IPs
- [ ] T3 — Control plane Droplets, managed MongoDB, monitoring Droplet, secrets
- [ ] T4 — Host classes, golden snapshot, cloud-init, data volume, hardening, placement by measured use
- [ ] T5 — Cloudflare Pro zone, Origin CA, authenticated origin pulls, Traefik middlewares
- [ ] T6 — GHCR + DOCR mirror, short-lived pull credentials, GC
- [ ] T7 — Wasabi tenant bucket + per-instance IAM; Spaces backups via presigned PUT; downloads bucket
- [ ] T8 — Resend sending domain, webhooks
- [ ] T9 — DO metrics agent, tag alert policies, canary uptime checks
- [ ] T10 — `infra/` as code, bastion and break-glass SSH
- [ ] T11 — Staging environment

## Last step

Not yet started.

## Blockers

None to start: BLR1 (Q5) and Wasabi (Q26) are decided, and building runs on the new-account limit.
Q25 (prepay or limit request, 1–2 weeks lead time) is due at the start of M4, before real customers.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060), based on resources/digitalocean.md.
