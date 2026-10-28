# Progress: Hosting infrastructure on DigitalOcean — account, hosts, network, edge, TLS, registry, storage, mail

## Checklist

- [ ] T1 — Team, limits, tokens — partly: DigitalOcean API client and the token's scopes documented; the account, team and limit requests are the owner's
- [ ] T2 — Region and network — partly: Cloud Firewall by tag (80/443 open, SSH from `OPS_SSH_SOURCES`), VPC by `DO_VPC_UUID`; not built: reserved IPs
- [ ] T3 — Control plane hosting — not built
- [ ] T4 — Hosts — partly: cloud-init bootstrap (pinned Docker, data volume, Traefik, agent, ufw, fail2ban, unattended upgrades, swap); not built: golden snapshot, placement by measured memory
- [x] T5 — Edge and TLS, as decided on 2026-10-28: Route 53 records, one wildcard certificate issued by the control plane and pushed to every host, Traefik middlewares
- [ ] T6 — Registry — partly: GHCR pinned by digest; not built: DOCR mirror and short-lived pull credentials
- [x] T7 — Wasabi bucket, IAM user and key per installation; Wasabi backups bucket through presigned URLs (downloads bucket not built)
- [ ] T8 — Mail — partly: hosted instances get `INSTANCE_RESEND_API_KEY` through config; the sending domain and webhooks are not set up
- [ ] T9 — Provider monitoring hooks — not built
- [ ] T10 — Infrastructure as code and runbooks — partly: `docs/hosting-setup.md`; no `infra/` code, no bastion
- [ ] T11 — Staging environment — not built

## Last step

Hosts can be created on DigitalOcean (code, dry run and fakes only so far) or registered by hand
(run live on this PC). Waiting for the owner's keys.

## Blockers

None to start: BLR1 (Q5) and Wasabi (Q26) are decided, and building runs on the new-account limit.
Q25 (prepay or limit request, 1–2 weeks lead time) is due at the start of M4, before real customers.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060), based on resources/digitalocean.md.

### 2026-10-28 (night)
- Built overnight in `F:/Projects/alianhub-cloud` (merged into its local `main`), on three branches
  plus an integration branch: `feat/cloud-adapters`, `feat/host-agent`, `feat/fleet-ops`,
  `feat/m2-integration`. Contracts are in that repository's `docs/m2-contracts.md`; setup steps for
  the keys are in `docs/hosting-setup.md`.
- Owner: DNS on Route 53 instead of Cloudflare; files in a Wasabi bucket per installation.
- Not run on real infrastructure yet:
  - cloud-init on a Droplet;
  - Traefik reloading the pushed certificate;
  - a real Let's Encrypt order.
