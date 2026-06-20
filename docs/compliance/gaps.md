# Compliance Gap Register

**Last reviewed:** 2026-06-20 · **Applies to:** AlianHub v14.5.0+

Honest, tracked list of gaps between AlianHub today and a fully-certifiable posture.
This is the remediation backlog referenced by [control-mapping.md](control-mapping.md).

**Owner:** `AlianHub` (product/code change) · `Operator` (deployment responsibility) · `Shared`.
**Status:** `Open` · `Planned` · `By design` · `Operator-responsibility`.

| ID | Area | Gap | Frameworks | Owner | Severity | Status | Notes / target |
|---|---|---|---|---|---|---|---|
| GAP-01 | Certification | AlianHub OSS holds no SOC 2 / ISO 27001 report (certification attaches to an org running a system, not to code). | All | AlianHub | Info | By design | Certify the **AlianHub-hosted/demo** offering; track separately. |
| GAP-02 | Encryption at rest | Not enabled by default; depends on operator's DB/volume/object-storage config. | SOC 2 C1, ISO A.8.24, HIPAA §164.312(a)(2)(iv) | Operator | High | Operator-responsibility | Documented in [shared-responsibility.md](shared-responsibility.md); add a deploy preflight check. |
| GAP-03 | Secret-at-rest (2FA/SSO) | 2FA TOTP secrets and SSO IdP client secrets are stored server-side; not yet encrypted with a dedicated app-level key (PATs and SCIM tokens **are** hashed). | SOC 2 CC6.1, ISO A.8.24 | AlianHub | Medium | Planned | Envelope-encrypt secret fields with a `SECRET_ENC_KEY`. |
| GAP-04 | Audit tamper-evidence | `audit_logs` is insert-only at the app layer but not cryptographically tamper-evident (no hash-chain / WORM export). | SOC 2 CC7.2, ISO A.8.15, HIPAA §164.312(b)(c) | AlianHub | Medium | Planned | Add per-row hash-chaining + signed export to WORM storage. |
| GAP-05 | Penetration test | No published independent pen-test / SAST-DAST report. | SOC 2 CC4, ISO A.8.8 | AlianHub | Medium | Planned | Commission a third-party test per release train; publish summary. |
| GAP-06 | SBOM & SCA | No published SBOM; dependency scanning is operator-run. | ISO A.8.8 | Shared | Medium | Planned | Generate CycloneDX SBOM in CI; enable Dependabot/`npm audit` gate. |
| GAP-07 | Session revocation | No global "sign out everywhere" / server-side token revocation list. | SOC 2 CC6.3, HIPAA §164.312(a)(2)(iii) | AlianHub | Medium | Planned | Refresh-token revocation list + force-logout on role removal. |
| GAP-08 | Access reviews | No in-app periodic access-review/attestation workflow. | SOC 2 CC6.2, ISO A.5.18 | AlianHub | Low | Planned | Owner/admin "review members" reminder + export. |
| GAP-09 | Data residency | Residency depends entirely on the operator's hosting choice. | SOC 2 C1, ISO A.5.23, GDPR | Operator | Info | Operator-responsibility | Documented; no in-app region pinning. |
| GAP-10 | Backups / DR | No built-in scheduled backup or restore tooling. | SOC 2 A1, ISO A.5.30 | Operator | High | Operator-responsibility | Operator must automate + test restores; consider a documented backup script. |
| GAP-11 | Automatic logoff | Inactivity logoff is client-side; no enforced server idle timeout. | HIPAA §164.312(a)(2)(iii) | AlianHub | Low | Planned | Configurable server-side idle-token TTL. |
| GAP-12 | DPA / BAA | No standard DPA/BAA template for self-hosters to adapt. | HIPAA §164.314, GDPR Art.28 | AlianHub | Low | Planned | Publish template DPA/BAA the operator can use with *their* sub-processors. |

## How this register is maintained

- Reviewed each release train (and at minimum quarterly); `Last reviewed` updated above.
- New gaps from audits, pen-tests, or advisories are appended with an ID.
- `Planned` items should link to a tracker issue/PR as they're scheduled.
- Closing a gap: change status to a dated `Closed (YYYY-MM-DD, vX.Y.Z)` row and reflect it
  in [control-mapping.md](control-mapping.md).
