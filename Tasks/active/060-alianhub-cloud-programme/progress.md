# Progress: AlianHub Cloud — sell and run hosted AlianHub instances (programme)

## Checklist

- [x] Map what exists (Docker, instance settings, admin key API, plan limits, storage, tracker, billing leftovers)
- [x] Write the shared contracts (resources/architecture.md)
- [x] Write the open questions with defaults (resources/open-questions.md)
- [x] DigitalOcean research and API decision (resources/digitalocean.md)
- [x] Child PRDs 061–073 written
- [x] Owner answers the first questions (27 Oct 2026; Q3 and Q6 left open on purpose)
- [ ] M1 build (061–066) merged to staging — built on local branches 28 Oct 2026, not pushed
- [ ] M2 infrastructure: orchestrator, host agent, upgrades, backups on DigitalOcean
- [ ] M3 portal and back office (plans by invite code / staff approval) — built in the local `alianhub-cloud` repository 28 Oct 2026; needs a GitHub repository
- [ ] M4 DigitalOcean limits raised, production hosts, hardening and drills
- [ ] M5 payment gateway and public launch

## Last step
M1 and M3 built while the owner was away (28 Oct 2026). M1 sits on six local branches, stacked 061 → 062 (with 063 merged in) → 064, plus 063, 065 and 066 on their own; M3 sits in the local repository `F:/Projects/alianhub-cloud`. Nothing is pushed: the owner decides when the branches go up as PRs to staging and where the cloud repository lives.

## Blockers
M2 (infrastructure) needs the DigitalOcean, Cloudflare, Wasabi and Resend accounts. Q3 (payment provider) is needed only at M5; Q6 (shared vs dedicated servers) before production hosts in M4. Signing the tracker needs an Apple Developer account and a Windows signing certificate.

## Log

### 2026-10-27
- Programme created from the owner's brief: hosted AlianHub on `<sub>.alianhub.com`, Docker per
  customer, MongoDB inside the stack, SMTP and S3 provided by us, env overrides lock settings,
  credentials passed by API, three plans plus storage and time-tracker add-ons, monthly auto-renewal.
- Owner chose DigitalOcean as the hosting provider (Q5) mid-planning; research commissioned into
  resources/digitalocean.md.
- Found the env-locks-settings mechanism and the admin-key API already exist; the build is mostly
  a managed-mode layer on top of them.
- DigitalOcean research: SMTP ports blocked on all Droplets (mail via Resend HTTPS), new accounts
  limited to 3 small Droplets, 64 GiB host $336/month (Starter margin depends on density), App
  Platform/LB/DOKS do not fit, Spaces keys cannot be scoped to a prefix, 100 uptime checks per
  account. Plan and PRDs corrected.
- Owner's answers: Q1 defaults, Q5 BLR1, Q7 Mongo per stack, Q8 `<name>.alianhub.com`, Q11 one
  tracker app, Q17 automatic waves, Q18 no old customers, Q20 owner-granted support access,
  Q26 Wasabi Singapore; Q16/Q22 defaults. Q3 and Q6 open.
- Owner's order: infrastructure first, DigitalOcean limits second to last, payment gateway last.
  Phases re-cut to M1 build → M2 infrastructure → M3 portal + back office → M4 scale + harden →
  M5 payments + launch.

### 2026-10-28
- Owner: "Start with M1 … continue it then start with M3", while away from the PC. Plan committed on
  `docs/alianhub-cloud-plan` (from staging); 061–066, then 067 and 072, moved to active.
- M1 branches: `feat/managed-mode-settings` (061), `feat/s3-prefix-storage` (063),
  `feat/managed-docker-stack` (065), `feat/tracker-any-workspace` (066), `feat/platform-api` (062, on
  061 with 063 merged in), `feat/plan-entitlements` (064, on 062). Each task's progress.md lists what
  ran and what could not run here (no Docker daemon, no MongoDB, no real buckets or certificates).
- M3: new local repository `F:/Projects/alianhub-cloud` — foundation, portal (067) and back office
  (072) merged into `main`; lint, 320 tests and the build pass. Until M5 plans come from invite
  codes or staff-approved plan requests.
- M2 (owner, evening): "complete the M2 overnight". The keys are placeholders until the owner adds
  them. DNS moves to AWS Route 53 and files to a Wasabi bucket per installation (architecture §15
  and §18 updated). 069, 070 and 071 moved to active and built in `alianhub-cloud`:
  - provider adapters, host agent, cloud mode, placement, `cloudctl`;
  - backup, restore and upgrade workflows, fleet loops;
  - `deploy/managed/backup.sh` and `restore.sh` in this repository.
  Cloud mode ran end to end on this PC with a host registered by hand. What is left is in each
  task's progress.
