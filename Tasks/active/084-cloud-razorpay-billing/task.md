---
id: 084
title: Razorpay billing for AlianHub Cloud — pay to start, auto-debit, dunning, GST invoices and the ledger
status: active
priority: high
depends_on: [067, 068, 069, 072]
created: 2026-10-31
---

# 084 — Razorpay billing for AlianHub Cloud (PRD)

> Delivers task 068 with **Razorpay** as the provider (068 Q3 settled by the owner, 31 Oct 2026).
> 068 stays the umbrella design; this task is what gets built. Repo: `alianhub-cloud` (code), this
> repo (task files only).

## 1. Goal

A customer picks a plan, pays in advance through Razorpay, and their AlianHub is created as soon as
the payment is captured. Razorpay then auto-debits every month or year. When a renewal is not paid,
the customer gets an email every day with a **Pay now** button; on day 3 the AlianHub is stopped,
and on day 15 a final backup is taken and the AlianHub is deleted. Every payment produces a GST
invoice the customer can download, every rupee and dollar lands in an append-only ledger, and staff
can override any of it from the back office.

## 2. Decisions taken with the owner (31 Oct 2026)

| Topic | Decision |
|---|---|
| Provider | Razorpay **Subscriptions** (Razorpay holds the card/UPI mandate and handles RBI e-mandate rules). |
| Currencies | **INR and USD.** USD needs international payments enabled on the Razorpay account; if Razorpay refuses a USD subscription the USD order falls back to the staff-approval path and the back office says why. |
| Get started | **Paying replaces "request approval".** Invite codes and 100%-off coupons still skip payment. Approval remains only where Razorpay cannot be used. |
| Payment timing | Always **in advance**: the first period is paid at checkout, each renewal on its period start. |
| Retries | **Razorpay's own retries** (about one a day for 3 days after the due date, then the subscription is `halted`), plus a **Pay now** button in every email and in the portal. |
| Unpaid timetable | Day 0 due and failed → `past_due`, AlianHub keeps working. **Day 3 → stopped** (`suspended`). Days 3–14 wait for payment. **Day 15 → final backup, then deleted.** One email every day from day 0 to day 14, and one on deletion. |
| Customer cancels auto-debit | Runs until the paid period ends, then stops; deleted 15 days after the period end unless they pay again. |
| Staff | Can override everything from the back office (§4 T9). |

## 3. Where we start (alianhub-cloud `main`)

Already built and reused:

- `grantPlan` creates the subscription and instance and starts provisioning (invite, coupon, approval).
- `subscriptions` already has `status`, `currentPeriodStart/End`, `cancelAtPeriodEnd`,
  `pastDueSince`, `graceExtendedUntil`, `billingProvider`, `providerSubscriptionId`.
- Instance lifecycle states (`past_due`, `suspended`, `deleted`), the back-office suspend /
  reactivate / delete actions, and delete with `keepFinalBackup`.
- Catalog `prices` per item × currency × interval in minor units; coupons with snapshot terms.
- Billing details (name, billing email, address, GSTIN / VAT) in the portal.
- Portal Billing page with an **empty** invoices section; back office Metrics computed from list
  prices.

Not built yet (part of this task): any payment, invoices, GST invoice PDFs, the ledger, dunning
emails, webhooks, billing settings.

## 4. Scope

### T1 — Razorpay adapter

`server/modules/billing/providers/razorpay.js` behind the 068 T1 contract (only the calls this task
uses): customers, plans, subscriptions (create, fetch, update plan at cycle end, cancel at cycle end,
cancel now), orders and payments (one-off **Pay now** and upgrade charges), refunds, webhook
signature check. Plain `fetch` with Basic auth, no SDK. Keys from env: `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BILLING_MODE=sandbox|live`; back office shows a
red **SANDBOX** badge in sandbox. A fake adapter with the same contract drives the tests.

### T2 — Razorpay plans per price

Razorpay subscriptions charge a fixed plan amount, while our orders combine plan + add-ons − coupon.
So a Razorpay plan is created **per distinct (amount, currency, interval)** on first use and cached in
`providerPlans { provider, currency, interval, amount, providerPlanId }` (unique). Nothing is
created when the catalog is published.

### T3 — Checkout at Get started

1. Portal step 4 (**Pay and create**) calls `POST /api/v1/billing/checkout` with the same order the
   approval request sends today (plan, interval, add-ons, subdomain, workspace, coupon, currency).
2. Server validates, holds the subdomain for 30 minutes, creates `subscriptions { status:
   'incomplete', source: 'provider', billingProvider: 'razorpay' }` and a Razorpay subscription
   (`notes: { accountId, subscriptionId }`, `customer_notify: 0`), and returns the key id and
   `subscription_id`.
3. Portal opens **Razorpay Checkout** (`checkout.razorpay.com/v1/checkout.js`); the first period is
   charged with the mandate authorisation.
4. Portal posts the handler result to `POST /api/v1/billing/checkout/:id/confirm`; the server checks
   the signature, fetches the subscription from Razorpay, and on `active` runs `grantPlan` (exactly
   once) and goes to `/setup/<instanceId>`.
5. The webhook (T4) does the same independently, so closing the tab after paying still creates the
   AlianHub. One instance even with three deliveries plus the confirm call.
6. Abandoned checkout: hold released after 30 minutes, the `incomplete` subscription cancelled at
   Razorpay and marked `cancelled`.

### T4 — Webhooks

- `POST /api/v1/billing/webhooks/razorpay`, raw body, `X-Razorpay-Signature` HMAC-SHA256 checked;
  bad signatures answer 400 and are logged, not stored.
- Stored first in `webhookEvents { provider, providerEventId (unique), type, receivedAt, payload,
  processedAt, error, attempts }`, answered 200, then processed by an in-process job (until 069 brings
  Agenda) with backoff 1 m, 5 m, 30 m, 2 h, 12 h; after 5 failures a back-office alert.
- Processing never trusts the body for state: it fetches the subscription / payment from Razorpay.
- Events handled: `subscription.authenticated|activated|charged|pending|halted|cancelled|completed`,
  `payment.captured|failed`, `refund.processed`, `payment.dispute.created`.

### T5 — Renewals and state

| Razorpay | Our subscription | Instance | Also |
|---|---|---|---|
| `charged` (first) | `active`, period set | created (T3) | invoice + ledger |
| `charged` (renewal) | `active`, period moved, `pastDueSince` cleared | back to `active` if it was `past_due`/`suspended` | invoice + ledger, "payment received" email |
| `pending` / `payment.failed` on a renewal | `past_due`, `pastDueSince` = due date (first failure only) | unchanged (dunning tick decides) | day-0 email |
| `halted` | `unpaid` | unchanged | — |
| `cancelled` at period end | `cancelled` | `suspended` at period end | countdown to deletion (day 15 after period end) |

### T6 — Dunning tick and emails

- `billing.dunning.tick` every 15 minutes, for each subscription with `pastDueSince` (or cancelled with
  a period end in the past and no deletion yet):
  - day ≥ 3 and instance `active`/`past_due` → `lifecycle suspended` (stack stopped);
  - day ≥ 15 → delete with final backup (`keepFinalBackup: true`), as the back-office delete does;
  - once per calendar day (account's timezone, 09:00) from day 0 to day 14 → the reminder email.
- Days and the email hour live in `billingSettings` (T10). `graceExtendedUntil` and a staff
  **pause dunning** flag stop the tick for that subscription. A failed Razorpay fetch never advances
  a state.
- Emails (through the existing mail templates, every string i18n): payment failed (day 0), daily
  reminder with days left before stop / deletion, stopped (day 3), deletion warning (day 13),
  deleted (day 15), payment received / AlianHub restarted, auto-debit cancelled, upcoming annual
  renewal (7 days before). Every email carries **Pay now**.

### T7 — Pay now

- Portal banner on the instance and Billing pages while `past_due`/`unpaid`/stopped, plus the email
  button (signed link → portal sign-in → payment).
- Pays the due invoice through a one-off Razorpay Order in Checkout. On capture: invoice paid,
  ledger entry, period moved forward, instance `active` (stack started if stopped) within a minute.
- If the Razorpay subscription is `halted` or cancelled, paying also creates a fresh subscription
  starting at the next period so auto-debit continues (customer authorises the mandate in the same
  Checkout).

### T8 — Plan and add-on changes, cancel

- **Upgrade / more add-ons / month → year:** the existing preview computes the prorated difference;
  the customer pays it now with a one-off Order; on capture the entitlements change at once and the
  Razorpay subscription moves to the new amount from the next cycle (`schedule_change_at:
  cycle_end`).
- **Downgrade / fewer add-ons / year → month:** scheduled for period end (existing usage gate re-run
  at period end), Razorpay plan updated at cycle end.
- Razorpay only updates card subscriptions; for UPI / e-mandate subscriptions the change cancels at
  cycle end and the customer re-authorises a new subscription from an email link.
- **Cancel** (existing cancel screen): Razorpay cancel at cycle end; **Resume** before the period
  end undoes it. Staff-approval change requests stay for customers not on Razorpay.

### T9 — Back office overrides (admin / finance, two-admin approval where 072 already requires it)

On the instance and account pages: extend grace (date), pause / resume dunning, mark an invoice paid
offline (bank transfer: amount, reference), refund full or partial via Razorpay (reason code),
cancel auto-debit now or at period end, restart a stopped instance without payment, skip deletion,
change the plan without charge (comp). Webhook events list with **Replay**. Every action audited.

### T10 — Billing settings

Single `billingSettings` document edited in the back office (admin): stop day (3), delete day (15),
reminder hour (09:00), annual renewal reminder days (7), seller details for invoices (legal name,
address, state, GSTIN, LUT number), invoice prefix (`AHC`), prices tax-inclusive or tax-exclusive.

### T11 — Invoices and GST

- `invoices { number, accountId, subscriptionId, instanceId, provider, providerPaymentId, issuedAt,
  currency, lines[], subtotal, discount, tax[{ name, rate, amount }], total, amountPaid, status,
  periodStart, periodEnd, billTo{}, seller{}, placeOfSupply }`.
- One gapless series per Indian financial year: `AHC/2026-27/000001`, allocated atomically.
- Tax: INR, customer in the seller's state → CGST 9% + SGST 9%; other Indian state → IGST 18%;
  outside India (USD) → 0% with "Supply meant for export under LUT without payment of IGST".
  Customer GSTIN printed when given (B2B). Credit notes for refunds.
- PDF rendered on the server (`pdfkit`), downloadable from the portal Billing page and the back
  office, and attached to the "payment received" email.

### T12 — Ledger and metrics

- `ledgerEntries` append-only: `charge`, `refund`, `fee` (Razorpay fee and tax from the payment),
  `tax`, `adjustment` (staff, with note), each with amount, currency, USD rate, provider reference.
- Back office **Ledger** page: filter by month, account, kind; totals per currency; month-close CSV.
- Metrics (MRR, new, churn, failed renewals, recovered) computed from subscriptions and the ledger
  instead of list prices.

### T13 — Reconciliation

Nightly: compare each live subscription's status and period end with Razorpay, and the day's
captured payments with ledger charges. Differences raise a `billing.mismatch` alert; nothing is
changed automatically.

## 5. Out of scope

Tax filing (GSTR exports beyond the CSV), metered usage, multiple subscriptions on one invoice,
other providers (the adapter keeps room for them), our own retry timetable (Razorpay's is used).

## 6. Acceptance criteria

- [ ] In test mode, Get started → Razorpay Checkout (test card) → AlianHub provisioning, with
      exactly one instance when the confirm call and three webhook deliveries race.
- [ ] Closing the tab right after paying still creates the AlianHub (webhook path).
- [ ] An INR order and a USD order both complete in test mode, or USD falls back to approval with
      the reason shown in the back office.
- [ ] A renewal charge creates an invoice, a ledger entry and a "payment received" email.
- [ ] A failed renewal (simulated): `past_due` day 0, stopped day 3, final backup + deleted day 15,
      one email each day; paying on any day before deletion restarts the AlianHub within a minute.
- [ ] Cancel → AlianHub runs to period end, stops, is deleted 15 days later; Resume before period
      end undoes it.
- [ ] Upgrade charges exactly the previewed amount; downgrade applies at period end.
- [ ] GST invoice: right CGST/SGST vs IGST vs LUT export line, gapless number, PDF downloads.
- [ ] Every back-office override works and is in the audit log; replay re-processes one event.
- [ ] Ledger month totals equal Razorpay's captured payments minus refunds for a test month; CSV
      exports.
- [ ] Bad webhook signature → 400, nothing stored; duplicate event → processed once.
- [ ] Tests (server, portal, ops) and lint pass; every string i18n; colours from tokens.

## 7. Open questions for the owner (defaults used until answered)

1. Seller details for invoices: legal name, address, state, GSTIN, LUT number — **default: blank,
   entered in Billing settings before going live.**
2. Are catalog prices tax-inclusive (GST inside the price) or exclusive (18% added for INR)? —
   **default: exclusive.**
3. USD subscriptions need Razorpay international payments enabled on the live account.

## 8. Delivery

alianhub-cloud PRs into `main`, in this order: (1) adapter, webhooks, checkout (T1–T5);
(2) dunning, Pay now, cancel, changes (T6–T8); (3) invoices, ledger, settings, back office (T9–T13).
Each PR is tested against Razorpay test mode; real webhooks need the owner's tunnel.
Estimate: about 3 weeks of focused work.
