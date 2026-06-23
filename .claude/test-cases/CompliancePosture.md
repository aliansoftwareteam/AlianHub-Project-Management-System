# Compliance Posture — Review Checklist

**Feature:** SEC-07 — compliance posture (SOC 2 / ISO 27001 / HIPAA)
**Type:** docs / process (no code) — "tests" are a review checklist.
**Files:** `docs/compliance/{README,security-whitepaper,control-mapping,shared-responsibility,gaps}.md`, linked from `SECURITY.md`.
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Check | Expected | Status |
|----|-------|-------|----------|--------|
| COMP-01 | Docs published | `docs/compliance/` exists with 5 markdown files | All present; render on GitHub + sync to GitBook | ✅ |
| COMP-02 | Discoverable | SECURITY.md links the pack | Link to `docs/compliance/README.md` present | ✅ |
| COMP-03 | Whitepaper coverage | Read security-whitepaper.md | Covers authn, authz/RBAC, tenant isolation, audit, data protection, hardening, vuln mgmt | ✅ |
| COMP-04 | All three frameworks mapped | Read control-mapping.md | Separate tables for SOC 2 TSC, ISO 27001:2022 Annex A, HIPAA Security Rule | ✅ |
| COMP-05 | Shared-responsibility | Read shared-responsibility.md | Responsibility matrix + operator hardening checklist | ✅ |
| COMP-06 | Gaps tracked | Read gaps.md | Gap register with ID, owner, severity, status, target | ✅ |
| COMP-07 | Accuracy — controls real | Cross-check cited controls vs. code | Each cited control is actually implemented (bcrypt, 2FA, SSO, SCIM, RBAC, audit logs, companyId isolation, Helmet, rate limiting) | ⬜ |
| COMP-08 | Accuracy — no over-claim | Read framing | States AlianHub OSS is NOT certified; self-hosting is shared responsibility; no false certification claims | ✅ |
| COMP-09 | Links resolve | Click internal links | README ↔ whitepaper ↔ mapping ↔ shared-responsibility ↔ gaps ↔ SECURITY.md all resolve | ⬜ |
| COMP-10 | Maintainable | Read gaps.md footer | Defines review cadence + how to close a gap | ✅ |

**Total:** 10 checks. COMP-07 (control-accuracy cross-check) and COMP-09 (link rendering) to be confirmed by a human reviewer before publishing externally. The docs are intentionally honest about gaps rather than aspirational.
