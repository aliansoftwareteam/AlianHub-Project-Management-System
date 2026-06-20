# AlianHub Security Whitepaper

**Last reviewed:** 2026-06-20 · **Applies to:** AlianHub v14.5.0+

This whitepaper describes the security controls **built into AlianHub**. Infrastructure
and operational controls are the operator's responsibility — see
[shared-responsibility.md](shared-responsibility.md).

---

## 1. Architecture overview

AlianHub is a multi-tenant Node.js/Express application backed by MongoDB, with a Vue.js
web client and an optional Electron desktop time-tracker. Real-time updates use Socket.io.

- **Multi-tenancy:** every tenant is a *company*. Application data is **scoped by
  `companyId`** on every query; user identity and authentication records live in a
  separate **`global`** database, while per-company databases hold that tenant's
  projects, tasks, comments, and files.
- **Stateless API:** authentication is via signed JWTs; there is no server session state
  to compromise at rest.
- **Storage:** file attachments are stored in S3-compatible object storage (Wasabi) or
  on the local filesystem, selected by the operator.

## 2. Data classification & flows

| Data | Examples | Where it lives |
|---|---|---|
| Authentication data | password hashes, 2FA secrets, SSO/SCIM identifiers | `global` DB |
| Tenant business data | projects, tasks, comments, time logs | per-company DB |
| Files | attachments, screenshots | object storage / filesystem |
| Audit trail | sensitive-action log | per-company DB (`audit_logs`) |

Data in transit is protected by TLS (operator-terminated). Data at rest is protected by
the operator's storage/database encryption configuration.

## 3. Authentication

- **Passwords** are hashed with **bcrypt** (never stored or logged in plaintext).
- **Two-factor authentication (2FA)** via TOTP (RFC 6238, `otplib`) with a validation
  step decoupled from the main session token.
- **OAuth** sign-in: Google, GitHub, GitLab.
- **Enterprise SSO** (SEC-02): **SAML 2.0 and OIDC**, configured per company. IdP secrets
  are stored server-side and never exposed to the client; the public login endpoint
  returns only non-secret metadata.
- **JWT** access tokens are short-lived and paired with refresh tokens; tokens carry the
  company *audience*, which is re-checked server-side (`requireCompanyAud`).
- **Personal API tokens (PATs)** are hashed at rest; token-management endpoints are
  themselves protected and PATs cannot manage other tokens.

## 4. Authorization & access control (RBAC)

- Roles: **Owner (1), Admin (2), Member (3), Guest (4)**.
- A **rules engine** (`Config/permissionGuard.js`) evaluates per-key permissions
  (read/none/write) and is the **single source of truth enforced server-side** — not just
  in the UI — so API/MCP clients obey the same model.
- **Privilege escalation is constrained:** granting Owner/Admin is Owner-only.
- **Guest scoping (SEC-01):** guests see only explicitly-assigned projects; project, task,
  and comment endpoints enforce this server-side for all clients.
- **Automated provisioning (SEC-05):** SCIM 2.0 create/deactivate from the IdP, so access
  is granted and **revoked** centrally.

## 5. Multi-tenant isolation

- Every data-access path is scoped by `companyId`; cross-company reads are structurally
  prevented by separate per-company databases.
- The JWT audience is validated against the requested company on company-scoped routes.
- Role caches are invalidated immediately on role/membership changes.

## 6. Audit & monitoring (SEC-04)

- An **immutable, insert-only `audit_logs`** collection records sensitive actions
  (e.g. member/role changes, SSO and SCIM configuration changes) with actor, entity, IP,
  and timestamp.
- Logs are **owner/admin-readable** via a filterable API + Settings viewer, and are
  **retained for a configurable window** (default 365 days) with an automated prune job.
- Structured application logging via Winston (operator ships logs to their SIEM).

## 7. Data protection

- **In transit:** TLS, terminated by the operator's reverse proxy / load balancer.
- **At rest:** provided by the operator's database/storage encryption (e.g. encrypted
  volumes, MongoDB encryption-at-rest, S3 SSE). See the gap register.
- **Secrets:** supplied via environment variables (`JWT_SECRET`, storage keys, etc.);
  never hard-coded.
- **Screenshot retention:** time-tracker screenshots have per-tenant retention with
  automated cleanup.

## 8. Application hardening

- **Security headers** via Helmet.
- **Rate limiting** via `express-rate-limit` on sensitive endpoints.
- **CORS** configured by the operator.
- **Input validation** at the API boundary; consistent error envelopes that avoid leaking
  internals.
- Dependencies are tracked in `package.json`; operators should run `npm audit` / SCA in CI.

## 9. Availability & resilience

Availability is **operator-owned**: backups, replication, scaling, and disaster recovery
depend on the deployment. AlianHub is stateless at the app tier (horizontally scalable);
durability rests on the operator's MongoDB and object-storage configuration.

## 10. Vulnerability management

Coordinated disclosure via GitHub Security Advisories — see [SECURITY.md](../../SECURITY.md).
Fixes are released best-effort to the latest version; operators are expected to stay current.

## 11. Sub-processors & privacy

A self-hosted AlianHub instance has **no AlianHub-operated sub-processors** — the operator
chooses any third parties (object storage, email/SMTP, push, optional AI). For data-subject
rights (GDPR/CCPA), the operator is the controller; AlianHub provides the tooling
(export, edit, delete) to service requests.
