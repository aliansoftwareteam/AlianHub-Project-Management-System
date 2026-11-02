# Progress: Razorpay billing for AlianHub Cloud

## Checklist
- [x] T1 — Razorpay adapter
- [x] T2 — Razorpay plans per price
- [x] T3 — Checkout at Get started
- [x] T4 — Webhooks
- [x] T5 — Renewals and state
- [x] T6 — Dunning tick and emails (annual renewal reminder still to do)
- [x] T7 — Pay now
- [ ] T8 — Plan and add-on changes, cancel (cancel + resume done in PR 2; prorated changes in PR 2b)
- [ ] T9 — Back office overrides
- [ ] T10 — Billing settings
- [ ] T11 — Invoices and GST
- [ ] T12 — Ledger and metrics
- [ ] T13 — Reconciliation

## Last step
PR 1 merged (alianhub-cloud#21). Race fix open as #22. PR 2 (T6, T7, cancel/resume of T8) open as #23. Next: PR 2b (prorated plan and add-on changes, coupon-end plan switch), then PR 3 (T9–T13).

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

### 2026-11-02
- PR 1 merged into alianhub-cloud `main` (#21).
- A full test run found an activation race: when `subscription.activated` won, the first payment was not recorded and the confirm call returned no instance. Fixed in #22 (`fix/billing-activation-race`).
- PR 2 (#23, `feat/razorpay-dunning`): unpaid timetable (emails day 0–14, stop day 3, final backup + delete day 15; cancelled plans stop at period end and delete 15 days later), Pay now and Resume through a fresh Razorpay subscription (upfront add-on + future start), customer cancel straight to Razorpay at period end, portal banner and Billing Pay now. Server 399, portal 70, ops 34, shared 56; lint and builds clean.
- Razorpay test mode: future-start subscriptions with and without an upfront add-on create, list invoices and cancel through the adapter.
- Deviation: reminders go once per due-day, not at 09:00 account time (no account timezone yet). Annual renewal reminder not built.
