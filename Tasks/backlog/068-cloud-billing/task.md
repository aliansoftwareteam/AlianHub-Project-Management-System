---
id: 068
title: Cloud billing — subscriptions, add-ons, dunning, tax and the revenue ledger
status: backlog
priority: high
depends_on: [060]
created: 2026-10-27
---

# Cloud billing — subscriptions, add-ons, dunning, tax and the revenue ledger

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M5 (last) · Repo: `alianhub-cloud` (new)

> **The owner put the payment gateway last (27 Oct 2026)** and the provider is not chosen yet (Q3).
> Everything upstream — entitlements, lifecycle states, suspension, plan changes — is built and
> exercised earlier through `cloudctl` (069) and the back office (072), so this task plugs a
> provider into flows that already work. The entitlements builder (T6) is the one piece needed
> earlier: build it in M2 with 069, priced plans or not.

## Goal

Money is taken correctly every month without anyone touching it: the first payment creates an
instance, renewals keep it running, plan and add-on changes are prorated and switch on within a
minute, failed payments walk the instance through `past_due → read_only → suspended → cancelled →
deleted` on a predictable timetable with an email at every step, and finance can close a month from
an append-only ledger that agrees with the payment provider to the cent.

## Where we start

- No billing exists in the cloud product. The old in-app Chargebee code in AlianHub
  (`/api/v2/createSubscriptionChargebee`, `frontend/src/plugins/chargebee`) is **not** reused; 061
  hides it in managed mode. Q18 default: no Chargebee customers to migrate.
- Contracts: lifecycle and the subscription → instance mapping (architecture §11), entitlements
  (§9), plans and add-ons (§12), collections (§13).
- Provider is open (Q3). The engine is written against an adapter so the choice changes one module.
- Consumers: the portal (067) calls previews and changes; the orchestrator (069) consumes the
  normalized events this task emits; the back office (072) reads the ledger and runs refunds.

## Scope — the work, task by task

### T1 — Provider adapter

`server/modules/Billing/providers/<name>.js`, one file per provider, each implementing:

```js
// server/modules/Billing/providers/contract.js
createCustomer(account)                 → { providerCustomerId }
updateCustomer(account)                 → void
createCheckout({ account, subscription, lines,
  couponCode, successUrl, cancelUrl })  → { kind, url|token,
                                             providerCheckoutId }
managementUrl(account)                  → { url }   // card, invoices
previewChange(subscription, nextLines,
  { prorate, effective })               → { amountDueNow,
                                             nextInvoiceAmount,
                                             currency, taxAmount }
applyChange(subscription, nextLines,
  { prorate, effective, idempotencyKey })
                                        → { providerSubscription }
cancel(subscription, { atPeriodEnd })   → void
resume(subscription)                    → void
refund(invoice, { amount, reason })     → { providerRefundId }
fetchSubscription(providerSubscriptionId) → providerSubscription
listInvoices(providerCustomerId, since) → providerInvoice[]
verifyWebhook(rawBody, headers)         → { ok, event }
normalize(event)                        → NormalizedEvent[]
syncCatalog(plans, addons, prices)      → priceIdMap
```

- **Paddle Billing** (merchant of record) and **Razorpay Subscriptions** first, whichever Q3 picks;
  **Stripe Billing** behind the same contract. A provider is chosen per account at checkout
  (`accounts.billingProvider`), so India-only Razorpay and global Paddle can run side by side later.
- Provider keys in env (`PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`),
  sandbox vs live by `BILLING_MODE=sandbox|live`; the back office shows a red "SANDBOX" badge in
  sandbox.
- Contract test suite (`server/modules/Billing/providers/contract.test.js`) runs against each
  adapter with recorded sandbox fixtures.

### T2 — Catalog and price sync

Collections (architecture §13):

```
plans  { key: 'starter'|'pro'|'business', name, order,
         limits{seats,guests,workspaces,storageBytes,
                maxFileBytes,emailsPerDay},
         features{timeTracker:'addon'|'included:10',
                  customDomain, ownSmtp, backupDownload,
                  backupsKept, compute, sla},
         addonsAllowed[], status:'draft'|'live'|'retired',
         version, updatedBy, updatedAt }
addons { key: 'storage_50gb'|'time_tracker'|'seats_10'
              |'custom_domain',
         grants{storageBytes|seats|trackerSeats|customDomain},
         minQuantity, maxQuantity, plans[], status, version }
prices { itemKey, itemType:'plan'|'addon', currency,
         interval:'month'|'year', amount (minor units),
         provider, providerPriceId, status:'live'|'retired',
         createdAt }
```

- Prices are immutable. Changing a price creates a new `prices` row and retires the old one;
  existing subscriptions stay on the old price (grandfathered) until a staff member runs a price
  migration (072 T6) with a 30-day notice email.
- `syncCatalog` job (`billing.catalog.sync`) runs when 072 publishes a catalog version: creates
  provider products/prices, stores `providerPriceId`, refuses to publish if any provider call fails.
- Currencies: USD everywhere; INR when Razorpay or Stripe India is used; EUR optional. Annual price
  = 10 × monthly ("2 months free", architecture §12).

### T3 — Checkout

- `subscriptions` document is created by 067 T5 in `status: 'incomplete'`:

```
subscriptions {
  _id, accountId, instanceId (null until paid),
  provider, providerSubscriptionId, providerCheckoutId,
  plan, interval, currency,
  lines: [{ itemKey, itemType, priceId, quantity }],
  couponCode, status, currentPeriodStart,
  currentPeriodEnd, cancelAtPeriodEnd, cancelledAt,
  pastDueSince, lastPaymentError,
  pendingChange{ plan, interval, lines, effectiveAt,
                 previewId },
  subdomain, workspaceName, teamFocus, region,
  entitlementsVersion, createdAt, updatedAt
}
```

- `createCheckout` passes metadata `{ accountId, subscriptionId, reservationId }` so the webhook
  can find everything without trusting anything else in the payload.
- Success URL `/setup/<subscriptionId>`, cancel URL back to step 4 with the hold kept.
- One open checkout per subscription; a new attempt reuses the provider checkout if still valid.

### T4 — Webhook receiver

- `POST /api/v1/billing/webhooks/:provider` — raw body kept for signature checks; verified with the
  provider secret; unverified requests answer 400 and are logged (not stored).
- Every verified event is written first to `webhookEvents { provider, providerEventId (unique),
  type, receivedAt, payload, processedAt, error, attempts }` and the request answers 200 at once.
- An Agenda job `billing.webhook.process` handles events in order of `receivedAt`, idempotent by
  `providerEventId`. It never trusts the event body for state: it calls
  `fetchSubscription` / invoice lookups and applies the provider's current truth. That makes
  out-of-order and duplicate deliveries harmless.
- Failed processing retries with backoff (1 m, 5 m, 30 m, 2 h, 12 h); after 5 attempts it raises a
  back-office alert (072) with the event and error.
- Replay tool: `npm run billing:replay -- <providerEventId>` and a back-office button (admin only).

### T5 — Normalized events and the state mapping

Every provider event becomes zero or more normalized events, stored in `events`
(`type: 'billing.*'`) and handed to the orchestrator (069) by an Agenda job:

| Normalized event | When | Orchestrator does |
|---|---|---|
| `subscription.activated` | first payment captured | create instance (`provisioning`), queue provisioning |
| `subscription.renewed` | renewal invoice paid | nothing, unless state ≠ `active` → `lifecycle.set active` |
| `subscription.updated` | plan, interval, add-on, quantity change took effect | rebuild + push entitlements; resize or move host if compute tier changed |
| `subscription.payment_failed` | renewal or change charge failed | set `pastDueSince` if empty; lifecycle tick decides the state |
| `subscription.payment_recovered` | a past-due invoice got paid | `lifecycle.set active`, push entitlements |
| `subscription.cancel_scheduled` | cancel at period end requested | email; nothing in the instance |
| `subscription.cancel_unscheduled` | customer kept the plan | email |
| `subscription.cancelled` | period ended after cancel, or unpaid end | `lifecycle → cancelled`, `stack.stop` |
| `invoice.paid` / `invoice.refunded` | money moved | ledger entries (T14) |

Normalized subscription status: `incomplete`, `active`, `past_due`, `unpaid`, `cancelled`
(+ `trialing` only if Q4 changes). Instance mapping exactly as architecture §11.

### T6 — Entitlements builder

- Pure function `buildEntitlements(subscription, plan, addons, lifecycle) → document` in
  `server/modules/Billing/entitlements.js`:
  - `limits.seats = plan.limits.seats + 10 × qty(seats_10)`
  - `limits.storageBytes = plan.limits.storageBytes + 50 GiB × qty(storage_50gb)`
  - `features.timeTracker = { enabled: qty(time_tracker) > 0 || plan includes, seats: qty + included }`
  - `features.customDomain = plan.features.customDomain || qty(custom_domain) > 0`
  - `lifecycle`, `graceUntil` from T11.
- `version` = `subscriptions.entitlementsVersion + 1`, stored before the push; 069 signs (Ed25519,
  `kid`) and pushes. The same builder serves the instance's pull endpoint
  `GET /api/v1/instances/:instanceId/entitlements` (069 owns the route and its auth).
- Unit tests for every plan × add-on × lifecycle combination; snapshot of the JSON shape against
  architecture §9.

### T7 — Plan changes and proration

- **Preview** (`GET /api/v1/instances/:id/plan-change/preview`, used by 067 T8):
  1. Compute target lines.
  2. **Usage gate** for anything that lowers a limit: compare the latest `usageSnapshots` row with
     the target entitlements — seats (`active + pending`), guests, workspaces, storage bytes,
     tracker seats used. Any excess → `allowed: false` with `blocking[]`. A snapshot older than
     30 minutes triggers a fresh usage poll (069) before answering.
  3. `previewChange` from the provider for amounts and tax.
  4. Store `pendingChange.previewId` (valid 15 minutes) so confirm cannot drift.
- **Upgrades** (higher plan, more add-on units, monthly → annual): immediate, prorated, charged now.
  If the charge fails the change is not applied and the customer sees the provider's reason.
- **Downgrades** (lower plan, fewer units, annual → monthly): scheduled for `currentPeriodEnd`. At
  the period end the job `billing.pendingChange.apply` re-runs the usage gate; if usage still
  exceeds the target, the change is **not** applied, the subscription renews on the current plan,
  and the owner gets "Your downgrade to Starter is on hold" with the blocking list.
- **Compute tier changes**: Starter ↔ Pro → 069 `stack.update` with new limits (≈20 s restart);
  Pro → Business → host move in the customer's chosen window (069); Business → Pro → move back to
  a shared host at period end.

### T8 — Add-ons

| Key | Quantity rule | Lowering is blocked when |
|---|---|---|
| `storage_50gb` | 0–20 units, Pro and Business | stored bytes > new storage limit |
| `time_tracker` | 0 or ≥ 5 users | tracker seats in use > new quantity |
| `seats_10` | 0–50 units, Pro and Business | active + pending seats > new limit |
| `custom_domain` | 0–1, Pro (Business includes it) | a custom domain is still attached |

- Same preview/confirm pattern as T7; increases are immediate and prorated; decreases at period end.
- Add-ons are lines on the same provider subscription (one invoice per period).

### T9 — Coupons

- `coupons { code, kind:'percent'|'amount', value, currency, duration:'once'|'repeating'|'forever',
  months, plans[], addonsIncluded, maxRedemptions, redeemed, expiresAt, providerCouponId,
  createdBy, status }`.
- Validated at checkout and on plan change; synced to the provider; one coupon per subscription.
- Launch coupons: `BETA50` (50% for 6 months, beta customers, 073 T9), `ANNUAL` is not a coupon —
  annual pricing is a price.

### T10 — Annual billing

- Annual price = 10 × monthly. Renewal reminder email 30 days and 7 days before an annual renewal
  (required by some card networks and consumer laws), with the amount and a cancel link.
- Switching monthly → annual is immediate with credit for the unused month; annual → monthly at
  the end of the year.

### T11 — Dunning and the lifecycle timetable

Defaults from Q13 (configurable in `billingSettings` edited in 072):

| Day after failed renewal | Instance state | Email (subject) |
|---|---|---|
| 0 | `past_due` | "Payment for acme.alianhub.com failed" |
| 3 | `past_due` | "Reminder: update your payment method" |
| 6 | `past_due` | "Tomorrow acme.alianhub.com becomes read-only" |
| 7 | `read_only` | "acme.alianhub.com is now read-only" |
| 13 | `read_only` | "Tomorrow acme.alianhub.com will be suspended" |
| 14 | `suspended` | "acme.alianhub.com is suspended" |
| 25 | `suspended` | "acme.alianhub.com will be stopped in 5 days" |
| 30 | `cancelled` (stack stopped, data kept) | "acme.alianhub.com is cancelled — data kept until …" |
| 53 | `cancelled` | "Your data will be deleted in 7 days" |
| 60 | `deleted` (final backup kept 30 more days) | "acme.alianhub.com has been deleted" |

- The provider's own retry schedule (smart retries) keeps trying the card during days 0–14; our
  emails do not duplicate the provider's receipt emails (provider customer emails off where it
  allows, so customers get one consistent set — 073 T3).
- `billing.lifecycle.tick` runs hourly: for every subscription with `pastDueSince`, computes the
  target state from the table and, if different from the instance's state, emits
  `lifecycle.set { state, reason: 'payment', graceUntil }` to 069. It never moves a state backwards
  except on `subscription.payment_recovered`.
- Staff can extend grace (072 T8) — stored as `subscriptions.graceExtendedUntil`, respected by the
  tick, audited.
- Recovery at any point before `deleted`: payment → `active` within 1 minute; from `cancelled` the
  stack is started again (069 `stack.start`).

### T12 — Refunds and credits

- 14-day money-back (Q4 default): available to the customer once per account on the first payment
  of the first subscription; refunds the full first invoice, cancels immediately, instance →
  `cancelled` (data kept 30 days, so the customer can still change their mind by paying again).
- Staff refunds (072 T8): full or partial, with a reason code (`service_issue`, `billing_error`,
  `goodwill`, `duplicate`, `chargeback_prevention`), finance or admin role, audited.
- Account credit (Stripe customer balance / Paddle credit) for SLA credits on Business: 10% of the
  month for availability < 99.9%, 25% for < 99.0% (073 T1 defines the SLA text).
- Chargebacks: `dispute.created` webhook → back-office alert, instance unchanged; lost dispute →
  `cancelled` after a staff review, never automatically.

### T13 — Tax, invoices and the India specifics

- **Merchant of record (Paddle / Lemon Squeezy):** the provider is the seller of record, calculates
  and remits VAT/GST/sales tax, issues the customer invoice. We record their payout statements.
- **Stripe or Razorpay (we are the seller):**
  - Collect country, state (India: place of supply) and tax id (GSTIN, EU VAT, UK VAT) at checkout;
    validate GSTIN format and checksum, VAT through VIES.
  - India domestic B2B/B2C: GST 18% (CGST 9% + SGST 9% intra-state, IGST 18% inter-state).
  - Export of services from India: zero-rated under LUT; invoice states "Supply meant for export
    under LUT without payment of IGST".
  - Stripe Tax for other jurisdictions if registered; otherwise sell only where registered.
  - Invoice numbering: one gapless series per financial year, `AHC/2026-27/000123`, generated by us
    when the provider cannot follow Indian rules.
- `invoices` mirror: `{ accountId, subscriptionId, provider, providerInvoiceId, number, issuedAt,
  currency, subtotal, discount, tax[{name, rate, amount}], total, amountPaid, status, pdfUrl,
  lines[], periodStart, periodEnd }`.
- RBI e-mandate: Razorpay/Stripe India handle the additional factor of authentication on the
  first payment and pre-debit notifications; recurring charges above ₹15,000 need AFA every time —
  Business monthly in INR stays below it or uses annual invoicing by bank transfer (Q3).

### T14 — Revenue ledger

- `ledgerEntries` (append-only, never updated):
  `{ at, accountId, subscriptionId, invoiceId, kind: 'charge'|'refund'|'credit'|'fee'|'tax'|
  'payout'|'adjustment', amount, currency, fxRateToUSD, providerRef, note, createdBy }`.
- Written from `invoice.paid`, refunds, provider fees (from balance transactions / payout reports)
  and staff adjustments.
- Metrics computed nightly into `metricsDaily { date, mrr, newMrr, expansionMrr, contractionMrr,
  churnMrr, reactivationMrr, activeSubscriptions{starter,pro,business}, arpa, refunds, fees }`
  (072 T10 reads it). MRR rules: annual ÷ 12, net of discounts, excluding tax, in USD at the
  invoice-date rate.
- Month close export: CSV of ledger + invoices per month for the accountant.

### T15 — Reconciliation

- Nightly `billing.reconcile`: for each live subscription compare status, plan, lines, period end
  and last invoice with the provider; compare the day's ledger total with the provider's balance
  report.
- Mismatches create a back-office alert (`billing.mismatch`) with both sides; the job **never**
  suspends or cancels anything on its own — a person decides.

### T16 — Billing settings

`billingSettings` (single document, edited in 072, audited): dunning timetable (T11), money-back
days, renewal reminder days, enabled currencies, enabled providers per country, default tax
behaviour, descriptor text.

### T17 — Test harness

- Sandbox accounts per provider; Stripe test clocks / Paddle simulations / Razorpay test mode to
  fast-forward renewals and failures.
- Scenario tests: new subscription → renewal → failed renewal → day 7 read-only → recovery;
  upgrade with proration; blocked downgrade; add-on decrease at period end; refund within 14 days;
  duplicate and out-of-order webhooks; webhook arriving before the checkout redirect.

## How it looks

Normalized event as stored in `events`:

```json
{
  "type": "billing.subscription.payment_failed",
  "at": "2026-11-27T04:10:22Z",
  "accountId": "acc_01jd…",
  "subscriptionId": "sub_01jd…",
  "instanceId": "ins_01jd3k…",
  "providerEventId": "evt_8f2…",
  "data": { "invoiceId": "inv_…", "amount": 8900,
            "currency": "USD", "attempt": 1,
            "error": "card_declined" }
}
```

Plan-change preview response (portal):

```json
{
  "status": true,
  "data": {
    "previewId": "pv_01jd…",
    "allowed": true,
    "effectiveAt": "2026-11-02T10:00:00Z",
    "amountDueNow": 11240,
    "nextInvoiceAmount": 24900,
    "currency": "USD",
    "tax": 0,
    "hostMove": true,
    "blocking": []
  }
}
```

Blocked downgrade:

```json
{
  "status": true,
  "data": {
    "allowed": false,
    "blocking": [
      { "limit": "seats", "used": 23, "target": 10 },
      { "limit": "workspaces", "used": 2, "target": 1 }
    ]
  }
}
```

Dunning email, day 0:

```
Subject: Payment for acme.alianhub.com failed

Hi Riya,

We couldn't charge $89.00 to the Visa ending 4242
for acme.alianhub.com (Pro, monthly).

Everything keeps working until 4 Dec. After that
acme.alianhub.com becomes read-only until the
payment goes through.

[ Update payment method ]

Reason from the bank: card declined.
```

Read-only email, day 7:

```
Subject: acme.alianhub.com is now read-only

Your team can still sign in, read and export.
Changes are paused until the $89.00 payment
goes through. On 11 Dec the workspace will be
suspended.

[ Pay now ]
```

Invoice (seller-of-record case, India export):

```
AlianHub Cloud · Alian Software Pvt Ltd
GSTIN 24XXXXXXXXXXXXX
Invoice AHC/2026-27/000123   27 Nov 2026
Bill to: Acme Inc, Berlin, DE  VAT DE123…

Pro plan, 27 Nov – 27 Dec          $79.00
Time tracker × 5                   $10.00
Discount BETA50                   −$44.50
IGST 0% (export under LUT)          $0.00
Total                              $44.50

Supply meant for export under LUT
without payment of IGST.
```

Ledger CSV row (month close):

```
date,account,invoice,kind,amount,currency,usd
2026-11-27,acc_01jd,AHC/2026-27/000123,
charge,4450,USD,44.50
```

## Platform view

- **PCI scope:** no card data touches our servers (provider-hosted checkout and card update) →
  SAQ A. Never log provider payloads that contain card fingerprints beyond the last four digits.
- **Webhook security:** signature verification, timestamp tolerance 5 minutes, raw body preserved,
  endpoint behind Cloudflare with the provider's IP ranges allowed (where published); secrets
  rotated twice a year with overlap.
- **Idempotency everywhere:** unique `providerEventId`; every `applyChange`/`refund` call carries an
  idempotency key `<subscriptionId>:<previewId>` or `<invoiceId>:refund:<n>`.
- **Provider outage:** checkout unavailable → portal shows it; renewals are the provider's job and
  continue when it recovers; our webhook backlog drains in order. Lifecycle tick does not advance a
  subscription whose latest provider fetch failed (no suspension on our or their outage).
- **Clock and timezone:** all timetable math in UTC from `pastDueSince`; emails render dates in the
  account's timezone.
- **Monitoring:** alert on webhook processing lag > 5 minutes, any event failing 5 times,
  reconciliation mismatches, a spike of `payment_failed` (> 3× the 7-day average), and catalog sync
  failures.
- **Secrets:** provider keys only in the control plane's env; the master key (architecture §13)
  does not protect them — they are never in the database.

## Management view

- **Provider cost comparison (to settle Q3):**

| Provider | Fee (approx.) | Tax handling | Fit |
|---|---|---|---|
| Paddle Billing | 5% + $0.50 | MoR: global VAT/GST done for us | Global customers, smallest finance load |
| Lemon Squeezy | 5% + $0.50 | MoR | Same, simpler, fewer B2B features |
| Stripe Billing | 2.9% + $0.30 card, +0.7% Billing, +0.5% Tax | We file tax | Cheapest at scale; needs entity/eligibility |
| Razorpay Subs | ~2% domestic, ~3% international | We file GST | India-first customers |

  On a $79 Pro plan: Paddle ≈ $4.45, Stripe ≈ $3.43 + tax work, Razorpay ≈ $1.58–2.37.
- **Metrics to watch** (072 T10): MRR and its movements, involuntary churn (target < 1.5% of MRR
  per month), dunning recovery rate (target > 50% of failed renewals recovered before `suspended`),
  refund rate (< 3% of new subscriptions), downgrade blocks per month (signal of plan design),
  add-on attach rate (tracker and storage), annual share of MRR.
- **Finance workflow:** monthly close from the ledger CSV + provider payout report; GST returns
  (GSTR-1/3B) from the invoice series when we are the seller; LUT renewed each financial year.
- **Risks:** wrong proration erodes trust → previews must equal charges (acceptance test);
  aggressive suspension of a paying customer due to our bug → no automatic state move without a
  fresh provider fetch, staff override available; tax registration gaps if not MoR → start with MoR
  if customers are global.
- **Staffing:** one backend developer for ~4 weeks; finance input on invoice format and GST;
  a lawyer reviews refund and auto-renewal wording (073 T1).

## Out of scope

- Usage-based (metered) pricing; overage charges (limits block instead, per Q12).
- Multiple subscriptions consolidated on one invoice for agencies/resellers.
- Bank-transfer / purchase-order invoicing for enterprises (manual for now, recorded via a staff
  adjustment).
- Crypto or wallet payments beyond what the provider offers by default.
- Revenue recognition schedules for audited accounts (export only).

## Acceptance criteria

- [ ] Switching providers needs only a new adapter file; the contract test suite passes for each
      implemented adapter.
- [ ] Catalog publish creates provider prices and refuses to publish on any provider error.
- [ ] A paid checkout creates exactly one instance even when the webhook is delivered three times
      and before the customer returns from checkout.
- [ ] Out-of-order webhooks leave the subscription equal to the provider's current state.
- [ ] The amount shown in a preview equals the amount charged (tested for upgrade, add-on increase,
      interval change).
- [ ] A downgrade that exceeds usage is refused at preview and again at period end, and the
      customer is told why.
- [ ] Entitlements produced for every plan × add-on × lifecycle match architecture §9 (snapshot
      tests); a change reaches the instance within 1 minute of payment confirmation.
- [ ] With a failed renewal in a test clock, the instance passes through `past_due` (day 0),
      `read_only` (day 7), `suspended` (day 14), `cancelled` (day 30), `deleted` (day 60), with
      each email sent once; paying on any day before deletion returns it to `active` within
      1 minute.
- [ ] A provider fetch failure never advances a lifecycle state.
- [ ] 14-day money-back works once per account and cancels immediately.
- [ ] Ledger totals for a test month equal the provider's report to the cent; the month-close CSV
      exports.
- [ ] Nightly reconciliation flags a deliberately altered subscription and changes nothing.
- [ ] India invoices (when we are the seller) carry GSTIN, place of supply, the right tax split or
      the LUT export line, and a gapless number.

## Dependencies

- 060 contracts and Q3 (provider), Q1/Q2 (catalog numbers), Q4 (trial), Q13 (timetable).
- 069 consumes normalized events, owns signing/pushing entitlements and the instance pull route.
- 067 calls checkout, previews and changes; 072 edits catalog, coupons, billing settings, runs
  refunds and reads metrics.
- 073 for legal text (auto-renewal, refunds, SLA credits) and email copy.

## Open questions

- Q1 / Q2 — flat plans with seat caps; numbers live in the catalog, not in code.
- Q3 — adapter first for Paddle (global) or Razorpay (India); Stripe behind the same contract.
- Q4 — no trial; 14-day money-back.
- Q12 — `storage_50gb` at $10/month; no overage, uploads blocked at 100%.
- Q13 — the timetable in T11.
- Q18 — no Chargebee migration.

## Estimate

About 4 weeks for one backend developer for one provider (T1–T6: 2 weeks; T7–T12: 1 week;
T13–T17: 1 week), plus ~1 week per additional provider adapter.
