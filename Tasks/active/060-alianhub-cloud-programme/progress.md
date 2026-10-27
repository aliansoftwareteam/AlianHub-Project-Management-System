# Progress: AlianHub Cloud — sell and run hosted AlianHub instances (programme)

## Checklist

- [x] Map what exists (Docker, instance settings, admin key API, plan limits, storage, tracker, billing leftovers)
- [x] Write the shared contracts (resources/architecture.md)
- [x] Write the open questions with defaults (resources/open-questions.md)
- [x] DigitalOcean research and API decision (resources/digitalocean.md)
- [x] Child PRDs 061–073 written
- [x] Owner answers the first questions (27 Oct 2026; Q3 and Q6 left open on purpose)
- [ ] M1 build (061–066) merged to staging
- [ ] M2 infrastructure: orchestrator, host agent, upgrades, backups on DigitalOcean
- [ ] M3 portal and back office (plans by invite code / staff approval)
- [ ] M4 DigitalOcean limits raised, production hosts, hardening and drills
- [ ] M5 payment gateway and public launch

## Last step

All PRDs written and updated with the owner's answers and order. Plan not committed yet: the owner
is reviewing it on the phone.

## Blockers

None for M1. Q3 (payment provider) is needed only at M5; Q6 (shared vs dedicated servers) before
production hosts in M4.

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
