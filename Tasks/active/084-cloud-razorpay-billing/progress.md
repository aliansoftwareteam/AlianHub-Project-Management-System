# Progress: Razorpay billing for AlianHub Cloud

## Checklist
- [ ] T1 — Razorpay adapter
- [ ] T2 — Razorpay plans per price
- [ ] T3 — Checkout at Get started
- [ ] T4 — Webhooks
- [ ] T5 — Renewals and state
- [ ] T6 — Dunning tick and emails
- [ ] T7 — Pay now
- [ ] T8 — Plan and add-on changes, cancel
- [ ] T9 — Back office overrides
- [ ] T10 — Billing settings
- [ ] T11 — Invoices and GST
- [ ] T12 — Ledger and metrics
- [ ] T13 — Reconciliation

## Last step
PRD written; waiting for the owner's go-ahead.

## Blockers
None. Seller details and tax-inclusive pricing (open questions 1–2) are needed before live, not before building.

## Log

### 2026-10-31
- Owner chose Razorpay, INR + USD, pay replaces approval, Razorpay retries + Pay now, stop day 3, backup + delete day 15, cancel runs to period end.
- Razorpay test keys placed in alianhub-cloud `.env` (gitignored) with a generated webhook secret; a read-only API call succeeded.
