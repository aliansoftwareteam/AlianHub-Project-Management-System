# Progress: Cloud portal — sign-up, plans, subdomain, checkout and the customer dashboard

## Checklist
- [x] T1 — Repository foundations
- [x] T2 — Accounts, sign-up, sign-in
- [x] T3 — Public plan catalog
- [x] T4 — Subdomain picker
- [ ] T5 — Checkout — partly: replaced until M5 by "Get started" (invite code or a plan request staff approve); "Pay now" comes with 068
- [x] T6 — Provisioning progress
- [x] T7 — Dashboard and instance detail
- [ ] T8 — Change plan and add-ons — partly: preview at list price plus a change request for staff; payment-side proration comes with 068
- [ ] T9 — Cancel and reactivate — partly: cancel and reactivate are requests staff approve; "Keep my plan" is immediate
- [x] T10 — Portal team and roles
- [ ] T11 — Billing pages — partly: "Invoiced by AlianHub", list prices and billing details; invoices list and payment method come with 068
- [x] T12 — "Open AlianHub" and activation emails
- [x] T13 — Time tracker download
- [ ] T14 — Support access grant — partly: grant, revoke and expiry email work; the session itself is started from the back office
- [x] T15 — Backups (Pro and Business)
- [x] T16 — Subdomain change
- [x] T17 — Portal emails
- [x] T18 — Account deletion and data rights

## Last step
Built in `alianhub-cloud` (`main`; private on GitHub at aliansoftwareteam/alianhub-cloud since 2026-10-29): foundation, sign-up and sign-in, then the portal on `feat/portal`, merged into `main` with the back office (072). Lint, 320 tests and the build pass.

## Blockers
T5 checkout waits for the payment gateway (068, M5). Not run: Playwright end to end, the container image, real Turnstile and Google widgets.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- Foundation (T1, T2): npm workspaces (`server/`, `portal/`, `ops/`, `packages/shared/`), Express 5 + Mongoose 8, MongoDB sessions (`__Host-ahc_session`), CSRF header, rate limits, i18n, fresh light/dark tokens, every §13 collection plus `inviteCodes`, `planRequests`, `portalInvitations`; sign-up, verify, sign-in with TOTP, Google, forgot/reset. Orchestrator seam with `ORCHESTRATOR_MODE=queue|simulate`; mail through Resend (console outbox in dev).
- Owner's order applied: no payment step until M5. A buyer either redeems an invite code (`grantPlan` provisions at once) or sends a plan request that staff approve in the back office; the requested address is held 14 days while pending.
- Portal T3–T18 built on `feat/portal` (decisions 38–63 in the repo's `docs/decisions.md`); walked through sign-up → setup over SSE → dashboard in a browser in simulate mode, light and dark, desktop and phone width.
- Node 20 left support in April 2026; move the repository to Node 22 or 24 before M4.

### 2026-10-29
- The repository is now private on GitHub, `aliansoftwareteam/alianhub-cloud`, with `main` and every
  feature branch pushed.
