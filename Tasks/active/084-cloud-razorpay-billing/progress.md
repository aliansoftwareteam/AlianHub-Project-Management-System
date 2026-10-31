# Progress: Razorpay billing for AlianHub Cloud

## Checklist
- [x] T1 — Razorpay adapter
- [x] T2 — Razorpay plans per price
- [x] T3 — Checkout at Get started
- [x] T4 — Webhooks
- [x] T5 — Renewals and state
- [ ] T6 — Dunning tick and emails
- [ ] T7 — Pay now
- [ ] T8 — Plan and add-on changes, cancel
- [ ] T9 — Back office overrides
- [ ] T10 — Billing settings
- [ ] T11 — Invoices and GST
- [ ] T12 — Ledger and metrics
- [ ] T13 — Reconciliation

## Last step
PR 1 (T1–T5) open as alianhub-cloud#21. Next: PR 2 (T6–T8: dunning, Pay now, cancel, changes).

## Blockers
- USD: the Razorpay account refuses USD plans ("Currency provided is not supported"); `RAZORPAY_CURRENCIES=INR` until Razorpay enables international currencies.
- Seller details and tax-inclusive pricing (open questions 1–2) are needed before live, not before building.

## Log

### 2026-10-31
- Owner chose Razorpay, INR + USD, pay replaces approval, Razorpay retries + Pay now, stop day 3, backup + delete day 15, cancel runs to period end.
- Razorpay test keys placed in alianhub-cloud `.env` (gitignored) with a generated webhook secret; a read-only API call succeeded.
- Owner said "start implementation".
- PR 1 (alianhub-cloud#21, `feat/razorpay-billing`): adapter, per-price Razorpay plans, checkout + confirm, webhooks with retries, renewal/failure state, expiry sweep, portal pay step, INR catalog for Indian accounts. Server 384, portal 66 tests passing; lint and builds clean.
- Razorpay test mode: INR customer/plan/subscription create + cancel work; USD refused by the account. Checkout opened on a local :4350 server (`F:/Projects/alianhub-test-data/cloud-rzp`, DB `alianhub_cloud_rzp`); the test payment itself was left for the owner to complete by hand.
