# Control Mapping — SOC 2 / ISO 27001 / HIPAA

**Last reviewed:** 2026-06-20 · **Applies to:** AlianHub v14.5.0+

Maps AlianHub's built-in controls to the major frameworks. **Responsibility** is
`AlianHub` (software provides it), `Operator` (you must implement it), or `Shared`.
**Status** reflects the AlianHub-provided portion: `Met`, `Partial` (provided but see
[gaps.md](gaps.md)), or `Operator` (AlianHub enables; operator owns).

## SOC 2 — Trust Services Criteria

| TSC | Criterion | AlianHub control | Responsibility | Status |
|---|---|---|---|---|
| CC6.1 | Logical access — authentication | JWT, bcrypt passwords, 2FA (TOTP), OAuth, SAML/OIDC SSO | AlianHub | Met |
| CC6.2 | Provisioning / authorization | RBAC roles + SCIM provisioning; Owner-only privilege grant | AlianHub | Met |
| CC6.3 | Access removal / modification | SCIM deactivation, role change with cache invalidation | AlianHub | Met |
| CC6.1 | Least privilege / segregation | Per-key permission rules engine, guest project scoping | AlianHub | Met |
| CC6.6 | Boundary protection | Helmet headers, `express-rate-limit`, CORS | Shared | Partial |
| CC6.7 | Data in transit | TLS support | Operator | Operator |
| CC6.1 | Tenant data segregation | `companyId` scoping + per-company DBs + JWT audience | AlianHub | Met |
| CC7.2 | Monitoring of controls | Immutable `audit_logs`; Winston app logs | Shared | Met |
| CC7.3–7.4 | Incident response | Coordinated disclosure ([SECURITY.md](../../SECURITY.md)) | Shared | Partial |
| CC8.1 | Change management | Git history, CI gates, semantic versioning | Operator | Operator |
| A1.1–A1.2 | Availability / backups | Stateless app tier (scalable); backups operator-owned | Operator | Operator |
| C1.1–C1.2 | Confidentiality | Tenant isolation; encryption at rest (operator) | Shared | Partial |
| P1–P8 | Privacy | Export/edit/delete tooling; operator is controller | Shared | Operator |

## ISO/IEC 27001:2022 — Annex A

| Control | Title | AlianHub control | Responsibility | Status |
|---|---|---|---|---|
| A.5.15 | Access control | RBAC + server-side rules engine | AlianHub | Met |
| A.5.16 | Identity management | SSO + SCIM lifecycle | AlianHub | Met |
| A.5.17 | Authentication information | bcrypt hashing, 2FA, hashed PATs | AlianHub | Met |
| A.5.18 | Access rights (grant/review/revoke) | Role mgmt, SCIM deprovisioning; reviews operator-run | Shared | Partial |
| A.8.2 | Privileged access rights | Owner-only Owner/Admin grant | AlianHub | Met |
| A.8.3 | Information access restriction | `companyId` isolation; guest scoping | AlianHub | Met |
| A.8.5 | Secure authentication | 2FA, SSO, short-lived JWT + refresh | AlianHub | Met |
| A.8.15 | Logging | Immutable `audit_logs` + retention | AlianHub | Met |
| A.8.16 | Monitoring activities | Winston → operator SIEM | Operator | Operator |
| A.8.24 | Use of cryptography | TLS (transit), bcrypt; at-rest operator-config | Shared | Partial |
| A.8.8 | Technical vulnerability mgmt | Disclosure policy; `npm audit`/SCA operator-run | Shared | Partial |
| A.5.23 | Cloud services security | Operator-chosen hosting/storage | Operator | Operator |
| A.5.30 | ICT readiness / continuity | Operator backups & DR | Operator | Operator |

## HIPAA — Security Rule (45 CFR §164.3xx)

> AlianHub the project is **not a Business Associate** and signs no BAA for self-hosted
> deployments. If you process PHI, you are the Covered Entity / Business Associate.

| Citation | Safeguard | AlianHub control | Responsibility | Status |
|---|---|---|---|---|
| §164.312(a)(1) | Access control | RBAC, tenant isolation, unique accounts | AlianHub | Met |
| §164.312(a)(2)(i) | Unique user identification | Per-user identities (no shared logins) | AlianHub | Met |
| §164.312(a)(2)(iii) | Automatic logoff | Short-lived JWT; UI inactivity | Shared | Partial |
| §164.312(a)(2)(iv) | Encryption/decryption (at rest) | Operator storage/DB encryption | Operator | Operator |
| §164.312(b) | Audit controls | Immutable `audit_logs` + viewer | AlianHub | Met |
| §164.312(c)(1) | Integrity | Insert-only audit trail; input validation | AlianHub | Partial |
| §164.312(d) | Person/entity authentication | 2FA, SSO, JWT | AlianHub | Met |
| §164.312(e)(1) | Transmission security | TLS | Operator | Operator |
| §164.308 | Administrative safeguards | SCIM aids access mgmt; policies operator-owned | Operator | Operator |
| §164.310 | Physical safeguards | Data-center / host controls | Operator | Operator |
| §164.314 | Business associate contracts | Operator signs BAAs with its sub-processors | Operator | Operator |

See [gaps.md](gaps.md) for every `Partial`/`Operator` item that AlianHub plans to strengthen.
