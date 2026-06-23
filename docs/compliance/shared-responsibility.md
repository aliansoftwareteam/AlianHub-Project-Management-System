# Shared Responsibility Model

**Last reviewed:** 2026-06-20 · **Applies to:** AlianHub v14.5.0+

Because AlianHub is **self-hosted**, compliance is split between the software (AlianHub)
and the organization running it (the **operator**). This is the same model cloud providers
use, adapted for an open-source app you host yourself.

## Responsibility matrix

| Domain | AlianHub (software) | Operator (you) |
|---|---|---|
| Authentication mechanisms | ✅ Passwords (bcrypt), 2FA, OAuth, SSO, SCIM | Enforce policy (MFA mandate, password rules), manage the IdP |
| Authorization / RBAC | ✅ Roles + server-side rules engine, guest scoping | Assign roles; review access periodically |
| Multi-tenant isolation | ✅ `companyId` scoping, per-company DBs, JWT audience | — |
| Audit logging | ✅ Immutable `audit_logs` + retention | Ship logs to a SIEM; review; set retention to policy |
| Encryption in transit | Supports TLS | ✅ Terminate TLS, manage certificates, enforce HTTPS/HSTS |
| Encryption at rest | Uses operator storage | ✅ Encrypt DB volumes / MongoDB / object storage (SSE) |
| Secrets management | Reads from env vars | ✅ Provide strong secrets; use a vault; rotate |
| Network security | App-level hardening (Helmet, rate limits) | ✅ Firewalls, WAF, network segmentation, DDoS |
| Backups & DR | Stateless app tier | ✅ Back up MongoDB + storage; test restores; define RPO/RTO |
| Availability / scaling | Horizontally scalable | ✅ Redundancy, monitoring, capacity, uptime |
| OS / runtime patching | Tracks dependencies | ✅ Patch host, Node, MongoDB; run SCA |
| Physical security | — | ✅ Data-center / cloud-region controls |
| Personnel & process | — | ✅ Background checks, training, access reviews, policies |
| Vendor / BAA (HIPAA) | Provides controls | ✅ Sign BAAs with *your* sub-processors; you are CE/BA |
| Data-subject rights | ✅ Export / edit / delete tooling | ✅ Receive and fulfill requests; you are the controller |

✅ = primary owner.

## Operator hardening checklist

Minimum steps to run AlianHub securely in a regulated environment:

- [ ] Serve only over **HTTPS/TLS 1.2+**; enable HSTS; redirect HTTP→HTTPS.
- [ ] Set a strong, unique **`JWT_SECRET`** and rotate on suspected compromise.
- [ ] Enable **encryption at rest** for MongoDB and object storage (S3 SSE / encrypted volumes).
- [ ] Restrict MongoDB to private networking; require auth; least-privilege DB users.
- [ ] Put the app behind a **reverse proxy / WAF**; keep `express-rate-limit` enabled.
- [ ] **Mandate 2FA** and/or SSO; disable local passwords if using SSO exclusively.
- [ ] Configure **SCIM** so deprovisioning is automatic when an employee leaves.
- [ ] Ship application + audit logs to a **SIEM**; set `audit_logs` retention to policy.
- [ ] Automate **encrypted backups** of MongoDB and storage; **test restores** regularly.
- [ ] Run **dependency/SCA scanning** (`npm audit`) and OS patching in CI/cron.
- [ ] Define and document **access review**, **incident response**, and **change management** processes.
- [ ] For PHI: sign **BAAs** with your hosting/storage/email providers; restrict data residency.

Keep evidence (config, logs, tickets, review records) — auditors assess *operating
effectiveness over time*, not just that a control exists.
