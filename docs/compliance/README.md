# AlianHub Compliance & Security Posture

**Last reviewed:** 2026-06-20 · **Applies to:** AlianHub v14.5.0+ · **Status:** Living document

This folder is AlianHub's compliance pack: what the software does for security, how
its controls map to the major frameworks, what a self-hosting operator must do, and
where the gaps are.

> **Read this first — the self-hosted nuance.**
> ClickUp and other SaaS tools hold their *own* certifications because they run the
> infrastructure. AlianHub is **open-source and self-hosted**: you (the operator) run
> it on your own servers. That means compliance is a **shared responsibility** —
> AlianHub provides application-layer controls; you own the infrastructure, process,
> and organizational controls. **Running AlianHub does not make a deployment certified.**
> These documents help you get there and document the boundary clearly.

## What's here

| Document | Purpose |
|---|---|
| [security-whitepaper.md](security-whitepaper.md) | How AlianHub is secured — architecture, authn/z, tenancy isolation, auditing, data protection, hardening. |
| [control-mapping.md](control-mapping.md) | AlianHub controls mapped to **SOC 2** (Trust Services Criteria), **ISO/IEC 27001:2022** (Annex A), and **HIPAA** (Security Rule). |
| [shared-responsibility.md](shared-responsibility.md) | Who owns what (AlianHub vs. operator) + an operator hardening checklist. |
| [gaps.md](gaps.md) | The certification gap register — honest, tracked, with status and owner. |

For **reporting a vulnerability**, see the repository [SECURITY.md](../../SECURITY.md)
(GitHub Security Advisories, responsible disclosure).

## How to use this pack

- **Evaluating AlianHub for a regulated environment?** Start with the whitepaper, then
  the control mapping to see which framework controls AlianHub satisfies out of the box
  vs. which you must implement.
- **Operating AlianHub?** Work through [shared-responsibility.md](shared-responsibility.md)'s
  hardening checklist and own the operator-side controls.
- **Pursuing certification (SOC 2 / ISO 27001 / HIPAA)?** Use the control mapping as your
  control inventory and [gaps.md](gaps.md) as your remediation backlog.

## Honest statement of certification

AlianHub (the open-source distribution) is **not itself certified** for SOC 2, ISO 27001,
or HIPAA, and cannot be — certification attaches to an *organization running a system*,
not to source code. AlianHub provides the technical controls that make a compliant
deployment achievable. Certification of the **AlianHub-hosted/demo offering** is tracked
as a roadmap item in [gaps.md](gaps.md).

If you deploy AlianHub to process **PHI** (HIPAA) you are the Covered Entity / Business
Associate; AlianHub the project is not a Business Associate and signs no BAA for
self-hosted deployments.
