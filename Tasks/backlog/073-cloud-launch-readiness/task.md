---
id: 073
title: Cloud launch readiness — legal, emails, support, security review, beta and go/no-go
status: backlog
priority: high
depends_on: [060, 067, 068, 069, 070, 071, 072]
created: 2026-10-27
---

# Cloud launch readiness — legal, emails, support, security review, beta and go/no-go

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M4 (harden) and M5 (launch, after payments) · Repo: `alianhub-cloud` (new), alianhub.com, help.alianhub.com, this repo for the AGPL link

## Goal

Everything around the software that a paid hosting service needs before strangers can buy it: the
contracts customers accept, every email they receive, a place to ask for help with promised response
times, a public status page, documentation, an external security test, proof that provisioning holds
up under load, a paying beta that shakes out the operations, a pricing page, and an explicit
go/no-go checklist so launch is a decision rather than a date.

## Where we start

- alianhub.com already links `terms-and-conditions/` and `privacy-policy/` (from
  `Modules/Admin/common/controller.js`) — written for the open-source product, not for a paid
  hosted service.
- help.alianhub.com exists for product docs.
- AlianHub is AGPL-3.0 (`LICENSE`); running a modified version for customers over a network
  triggers §13 (offer the corresponding source to every user).
- AlianHub has an email-in module (`Modules/EmailIn`, `inbox.alianhub.com`) that turns mail into
  tasks — usable for our own support desk.
- No status page, no transactional email set, no SLA, no pen test yet.

## Scope — the work, task by task

### T1 — Legal documents

Drafted by us, reviewed by a lawyer (India-governed, with GDPR terms for EU customers). Published at
`alianhub.com/cloud/<doc>` with a version and effective date; the portal stores acceptance.

| Document | Must cover |
|---|---|
| Cloud Terms of Service | subscription, auto-renewal, price changes with 30-day notice, cancellation at period end, the non-payment timetable (Q13: past_due 7 days → read-only → suspended → cancelled → deleted, with dates), suspension rights (non-payment, abuse, legal), data retention after cancellation, liability cap (12 months' fees), governing law and courts, changes to terms |
| Service Level Agreement (Business) | 99.9% monthly availability of the instance URL, exclusions (scheduled maintenance announced 48 h ahead, customer-caused, force majeure, Cloudflare/DigitalOcean region-wide incidents per the exclusion list), credits 10% < 99.9%, 25% < 99.0% (068 T12), claim within 30 days |
| Privacy Policy (cloud) | portal data we control (accounts, billing, usage); instance content we process for the customer; analytics; retention; rights; contact |
| Data Processing Agreement | GDPR Art. 28 terms, Standard Contractual Clauses for transfers, security measures annex, breach notice within 72 h, sub-processor list and change notice (30 days) |
| Sub-processors page | DigitalOcean (hosting — DigitalOcean specifics in 070), Cloudflare (DNS, proxy, WAF), object storage provider (063), mail relay (Q21), payment provider (Q3), status page and support desk vendors |
| Refund Policy | 14-day money-back on the first payment (Q4), no refunds for partial months otherwise, SLA credits, chargebacks |
| Acceptable Use Policy | no spam via invitations/mail, no phishing via public shares and forms, no illegal content, no crypto mining, no load testing without permission, reporting address `abuse@alianhub.com` |
| Cookie notice | portal and site cookies (session, CSRF, analytics if any) |

- Acceptance stored as `accounts.acceptedTerms { version, at, ip }`; a new terms version prompts at
  next portal sign-in and in the checkout step (067 T5).
- Business customers can request a countersigned DPA PDF (template, e-signature).

### T2 — AGPL §13 compliance and keeping licences straight

- **Instance side (this repo, small change folded into 061):** every instance shows
  "Source code" in the About/help menu and the login page footer, linking to the exact running
  version: `https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/tree/v<version>`
  (version from `buildInfo`). Managed-mode code lives in the public repo, so the link is complete.
- If a hosted build ever carries a patch not yet merged upstream, the release process publishes that
  tag first; the image label `org.opencontainers.image.source` + `revision` points at it.
- **Portal side:** `alianhub-cloud` is our proprietary code. It must not copy AlianHub source (Vue
  components, `tokens.css`, helpers) — doing so would make the portal a covered work. Shared visual
  language is re-implemented; a CI check greps for AlianHub file headers and known module paths.
- Third-party licence inventory for the portal (npm `license-checker`), stored in the repo.

### T3 — Transactional email set

Sender: `AlianHub Cloud <billing@alianhub.com>` for billing, `<hello@alianhub.com>` for account,
replies to `support@alianhub.com`. Every template has HTML and plain text, the account's language
when available, footer with company address and links to portal and help. Sent by the portal (067
T17) unless marked "instance".

| Key | Subject | Trigger | To |
|---|---|---|---|
| `verify_email` | Confirm your email for AlianHub Cloud | sign-up | user |
| `welcome` | Welcome to AlianHub Cloud | email verified | owner |
| `checkout_abandoned` | acme.alianhub.com is still free | 2 h after an unpaid hold | owner |
| `instance_ready` | Your AlianHub is ready — set your password | `owner_provisioned` | instance owner |
| `instance_delayed` | We're finishing acme.alianhub.com | `failed` or > 10 min | owner |
| `instance_failed_refunded` | We couldn't finish setting up acme.alianhub.com | 072 refund-and-cancel | owner |
| `receipt` | Receipt for acme.alianhub.com — $89.00 | `invoice.paid` (if provider receipts off) | billing users |
| `plan_changed` | acme.alianhub.com is now on Business | `subscription.updated` | owner, billing |
| `addon_changed` | Time tracker: 20 seats on acme.alianhub.com | add-on change | owner, billing |
| `downgrade_on_hold` | Your downgrade to Starter is on hold | 068 T7 period-end gate | owner |
| `payment_failed_d0` | Payment for acme.alianhub.com failed | 068 T11 day 0 | owner, billing |
| `payment_failed_d3` | Reminder: update your payment method | day 3 | owner, billing |
| `read_only_tomorrow` | Tomorrow acme.alianhub.com becomes read-only | day 6 | owner, billing, admins |
| `read_only` | acme.alianhub.com is now read-only | day 7 | owner, billing, admins |
| `suspend_tomorrow` | Tomorrow acme.alianhub.com will be suspended | day 13 | owner, billing |
| `suspended` | acme.alianhub.com is suspended | day 14 or staff | owner, billing |
| `stop_warning` | acme.alianhub.com will be stopped in 5 days | day 25 | owner, billing |
| `cancelled` | acme.alianhub.com is cancelled — data kept until 27 Dec | `cancelled` | owner, billing |
| `delete_warning` | Your data will be deleted in 7 days | 7 days before delete | owner |
| `deleted` | acme.alianhub.com has been deleted | `deleted` | owner |
| `cancel_scheduled` | Your cancellation is scheduled for 27 Nov | customer cancel | owner |
| `renewal_reminder` | Your annual plan renews on 27 Nov | 30 and 7 days before | owner, billing |
| `card_expiring` | Your card expires this month | provider event | billing |
| `price_change_notice` | Price change for your plan from 1 Jan | 072 T6 migration | owner, billing |
| `support_access_granted` | Support access to acme.alianhub.com granted | 067 T14 | portal admins |
| `support_access_used` | AlianHub support signed in to acme.alianhub.com | 072 T9 | portal admins |
| `maintenance_notice` | Scheduled maintenance on 2 Nov, 02:00–02:30 UTC | 071 rollout / host move | owner, admins |
| `host_move_scheduled` | Moving acme.alianhub.com to its own server | 067 T8 | owner |
| `storage_80` *(instance)* | Storage 80% used in Acme | 064 | instance owner, admins |
| `storage_full` *(instance)* | Storage is full in Acme — uploads paused | 064 | instance owner, admins |
| `seats_full` *(instance)* | All 60 seats in Acme are in use | 064 | instance owner |

- Payment-provider customer emails are switched off where the provider allows (Stripe, Razorpay),
  so customers receive one consistent set; with Paddle (MoR) the provider's receipts stay, and our
  `receipt` template is not sent.
- Mail domain: SPF, DKIM, DMARC (`p=quarantine` after two weeks of `p=none` reports) on
  `alianhub.com`; separate subdomain for instance notifications (architecture §16) so a tenant's
  reputation cannot hurt billing mail.
- Seed preview tool: `npm run mail:preview` renders every template with fixture data for review.

### T4 — Support desk and SLAs

- **Desk:** dogfood AlianHub — `support@alianhub.com` forwards to an AlianHub project via the
  email-in module; one task per ticket, custom fields for account, instance, plan, priority, SLA
  due. Agents reply from the task (comment-to-email). If dogfooding blocks something on day one,
  fall back to a hosted desk (Freshdesk free tier) and keep the same SLA fields.
- **Response targets** (first response, business hours IST, Mon–Fri):

| Plan | First response | Severity 1 (instance down) |
|---|---|---|
| Starter | 2 business days | 1 business day |
| Pro | 1 business day | 8 business hours |
| Business | 4 business hours | 1 hour, 24×7 via on-call |

- **Severity definitions:** S1 instance unreachable or data loss; S2 major feature broken for the
  whole team; S3 single-user or workaround exists; S4 question or request.
- **Macros** for the top issues: activation email missing, wrong subdomain, downgrade blocked,
  invoice/tax id, tracker connect, storage full, read-only after payment.
- **Escalation:** support → on-call engineer (071 rota) → founder; support may only use back-office
  actions allowed by their role (072 T1).
- **SOPs** linked from the back office: support access etiquette, abuse reports, data deletion
  requests, refund decisions.

### T5 — Status page

- `status.alianhub.com` on a hosted status service (Instatus / Better Stack), DNS CNAME.
- Components: Website & portal, Sign-up & provisioning, Instances — <region>, Email delivery,
  Payments, Time tracker downloads.
- Automatic incidents from 071 uptime checks for portal and provisioning; instance-level incidents
  only for region-wide problems (single-instance issues are handled by support).
- Incident templates (investigating / identified / monitoring / resolved) and a maintenance
  template; subscribers by email; link in the portal footer and in instances' help menu.

### T6 — Documentation on help.alianhub.com

New "AlianHub Cloud" section:

1. Getting started: from sign-up to inviting your team.
2. Plans, limits and what happens at a limit (seats, storage, workspaces, mail per day).
3. Billing: invoices, tax ids, changing plans, add-ons, cancelling, refunds.
4. When a payment fails: the timetable in plain words.
5. Time tracker: download, connect to `acme.alianhub.com`, seats.
6. Your data: export, backups (Pro+ download), restoring a backup into self-hosted AlianHub.
7. Security overview: isolation, encryption, backups, sub-processors, support access.
8. Changing your address (subdomain).
9. Moving from Cloud to self-hosted, and from self-hosted to Cloud (import path; manual in v1).

### T7 — Security review and penetration test

- **Internal threat-model review** of 061–072 before the external test, focused on:
  tenant isolation on shared hosts (container escape surface, networks, resource limits), the
  platform API edge block (`/api/v2/platform` unreachable from outside), setup-wizard lock in
  managed mode, per-instance S3 credentials scope, entitlements signature handling, host-agent
  token compromise, Cloudflare origin lock (only Cloudflare IPs reach hosts), subdomain takeover on
  deleted instances (DNS removed with the stack), portal cookie scope, back-office gates.
- **External pen test** (grey box, ~5–8 days): portal, back office through Access, one Starter and
  one Business instance, the platform API surface, a shared host's network position (from a test
  tenant). Fix all critical/high before launch; mediums with a dated plan.
- **Ongoing:** dependency scanning (npm audit / Dependabot) in both repos, container image scanning
  (Trivy) in CI, secret scanning, `security.txt` on alianhub.com, disclosure policy in `SECURITY.md`.
- **Drills before launch:** restore a backup to a fresh host and measure RTO (target ≤ 1 h for a
  single instance), host-loss drill (stop a shared host, recover its tenants), rotate a host-agent
  token and a platform key without downtime.

### T8 — Load and failure tests

- **Provisioning load:** 50 sign-ups in 10 minutes in staging with sandbox payments and real
  DigitalOcean resources (rate limits and quotas — DigitalOcean specifics in 070); target p95
  paid → active ≤ 3 minutes, zero failures, no DNS or S3 leftovers after cleanup.
- **Instance load:** k6 scenario for one Pro instance — 50 concurrent users, mixed list/board/task
  edits, uploads, Socket.io — p95 API < 500 ms at the Pro tier limits; same for Starter with 10 users.
- **Noisy neighbour:** one tenant on a shared host at 100% CPU; others' p95 stays within 20% of
  baseline thanks to limits.
- **Webhook storm:** 1,000 duplicated/out-of-order provider events; final state correct.
- Results recorded in `resources/` of this task during execution.

### T9 — Beta programme (M2)

- 3–5 friendly customers (existing self-host users or agency clients), hand-provisioned with
  `cloudctl` (069) before the portal exists, invoiced manually; on M3 they move to self-serve
  billing with coupon `BETA50` (50% for 6 months, 068 T9).
- Weekly 30-minute call; shared AlianHub project for their feedback; every incident written up.
- **Exit criteria:** 4 consecutive weeks without an S1, all beta instances upgraded at least twice
  without manual fixes, one backup restore done for real or as a drill on a beta copy, NPS ≥ 30.

### T10 — Pricing page on alianhub.com

- Built where alianhub.com is built today (Q23 default: the existing site, likely WordPress, with a
  small script/block reading `GET https://account.alianhub.com/api/v1/catalog`).
- Contents: monthly/annual toggle (annual shows "2 months free"), currency switch (USD/INR per
  enabled currencies), three plan cards, add-on table, full comparison table, FAQ (billing, limits,
  data, cancel, self-host vs cloud — "self-hosting stays free under AGPL"), trust row
  (backups, isolation, region).
- Buttons link to `https://account.alianhub.com/signup?plan=<key>&interval=<month|year>`.
- Fallback: if the catalog API is unreachable, the page shows the last cached catalog (built into
  the page at publish time).
- SEO: plan names and prices in plain HTML (rendered server-side or from the cached copy), schema.org
  `Product`/`Offer` markup.

### T11 — Analytics and funnel instrumentation

- Privacy-friendly analytics (Plausible or self-hosted Umami) on alianhub.com and the portal; no
  third-party ad trackers; cookie notice reflects it.
- Portal events: `signup_started`, `signup_completed`, `email_verified`, `checkout_started`,
  `checkout_paid`, `instance_active`, `owner_activated` (from 062 activation), `plan_changed`,
  `addon_added`, `cancel_started`, `cancel_completed` — sent server-side with account id hashed.

### T12 — Launch checklist and go/no-go

Go only when every line is true:

- [ ] Acceptance criteria of 061–072 met and signed off by the task owner.
- [ ] Zero open critical/high pen-test findings; mediums have dated fixes.
- [ ] Restore drill and host-loss drill passed within the RTO.
- [ ] Load test targets met (T8).
- [ ] Payment provider in live mode tested with a real card: purchase, upgrade, refund.
- [ ] Legal documents published, acceptance recorded at checkout, sub-processors page live.
- [ ] Every email in T3 rendered and sent once in staging; SPF/DKIM/DMARC pass.
- [ ] Status page live, alerts route to the on-call rota, rota staffed for the first 4 weeks.
- [ ] Support desk live with macros; response targets visible to the team.
- [ ] Beta exit criteria met (T9).
- [ ] Docs section published (T6); pricing page live behind a flag, switched on at launch.
- [ ] Back office access reviewed: only current staff, all with TOTP.
- [ ] Rollback plan: sign-up can be paused by a single setting (`signupsOpen=false`) without
      affecting existing customers.

### T13 — On-call and runbooks check

- 071 owns the runbooks; this task verifies each exists, was rehearsed once, and is linked from the
  alert that triggers it: provisioning failed, host down, instance unhealthy, disk full, mail
  blocked/complaint spike, webhook backlog, reconciliation mismatch, backup failed, restore, staff
  offboarding, break-glass suspend without the back office.
- Rota: two engineers alternating weeks; Business S1 pages 24×7, others business hours.

## How it looks

Instance login footer (AGPL link, 061):

```
┌──────────────────────────────────────┐
│            Sign in to Acme           │
│ …                                    │
│ AlianHub 14.40.0 · Source code ·     │
│ Status · Help                        │
└──────────────────────────────────────┘
```

Ready email:

```
Subject: Your AlianHub is ready — set your password

Hi Riya,

acme.alianhub.com is live.

[ Set your password ]   (link valid 7 days)

Then invite your team from Settings → Members.
Need the time tracker? Download it from
account.alianhub.com → Time tracker.

AlianHub Cloud · Alian Software Pvt Ltd
```

Status page:

```
┌──────────────────────────────────────┐
│ AlianHub Cloud status                │
│ ● All systems operational            │
│                                      │
│ Website & portal          ● 100.0%   │
│ Sign-up & provisioning    ● 99.98%   │
│ Instances — Bangalore     ● 99.99%   │
│ Email delivery            ● 100.0%   │
│ Payments                  ● 100.0%   │
│                                      │
│ [ Subscribe to updates ]             │
└──────────────────────────────────────┘
```

Pricing page (mobile):

```
┌──────────────────────────────────────┐
│ Simple plans. Your own AlianHub.     │
│ ( Monthly ) ( Annual -2 months )     │
│ USD ▾                                │
├──────────────────────────────────────┤
│ Starter            $29 / month       │
│ 10 users · 20 GB · 1 workspace       │
│ Daily backups (7 days)               │
│ [ Start with Starter ]               │
├──────────────────────────────────────┤
│ Pro  · most teams   $79 / month      │
│ 50 users · 100 GB · 3 workspaces     │
│ Backup download · add-ons            │
│ [ Start with Pro ]                   │
├──────────────────────────────────────┤
│ Business           $249 / month      │
│ 150 users · 500 GB · own server      │
│ 99.9% SLA · priority support         │
│ [ Start with Business ]              │
├──────────────────────────────────────┤
│ Add-ons: storage, time tracker,      │
│ seats, custom domain                 │
│ Prefer self-hosting? It's free.      │
└──────────────────────────────────────┘
```

Support ticket as an AlianHub task:

```
┌──────────────────────────────────────┐
│ [SUP-412] Tracker won't connect      │
│ From: dev@acme.com · Pro · acme      │
│ Severity S3 · SLA due 28 Oct 11:00   │
│ Status: Waiting on us                │
│ ──────────────────────────────────── │
│ "The tracker says workspace not      │
│  found when I type acme…"            │
│ [ Reply ] [ Macro ▾ ] [ Open acct ]  │
└──────────────────────────────────────┘
```

## Platform view

- Legal and email texts are inputs to code in 067/068/071; this task owns their content and the
  review, not their sending.
- The AGPL link is a hard launch requirement: it is the licence condition that lets us run the
  service.
- Pen test and drills run against staging built exactly like production (same hosts image, same
  Cloudflare setup); findings tracked as tasks with severity and due date.
- Status page automation must not page customers for single-instance problems — only components.
- `signupsOpen` kill switch (portal setting) to stop new sign-ups during an incident without
  touching existing customers.

## Management view

- **Costs (monthly, approx.):** status page $0–30, support desk $0 (dogfood) or ~$15/agent,
  analytics $0–9, lawyer review one-off (budget for ToS + DPA + SLA), external pen test one-off
  (scope 5–8 days), cyber/professional liability insurance (recommended before taking Business
  SLA customers).
- **Commitments we are making:** SLA credits on Business, response times per plan, a data deletion
  timetable, 72-hour breach notice — each must be operable by the team size in Q22.
- **Launch metrics** for the first 90 days: paid customers, setup p95, S1 incidents, first-response
  SLA attainment (target ≥ 95%), refund rate, churn, support tickets per 10 customers.
- **Risks:** launching before restore is proven (mitigated by the drill gate), promising 24×7 S1 for
  Business with a two-person rota (mitigated: Business only after the rota is staffed, or sell
  Business as "beta" first), abuse through public shares/forms on our domain (AUP + abuse address +
  072 suspend), legal mismatch between ToS timetable and code (both read Q13 defaults; checklist
  item).

## Out of scope

- Marketing campaigns, ads, partner programme.
- SOC 2 / ISO 27001 certification (later; the security overview and pen test are the first step).
- Multi-language legal documents (English only at launch).
- Phone support.

## Acceptance criteria

- [ ] All T1 documents reviewed by a lawyer, published with versions, and acceptance stored at
      sign-up/checkout.
- [ ] Every managed instance shows a working "Source code" link to its exact version tag.
- [ ] The portal repository contains no AlianHub source files (CI check passes).
- [ ] Every email in T3 exists in HTML and text, renders in the preview tool, and was received in
      staging with SPF/DKIM/DMARC passing.
- [ ] Support desk receives mail at support@alianhub.com as tickets with plan, instance and SLA due.
- [ ] status.alianhub.com is live with the listed components and automatic portal/provisioning
      incidents.
- [ ] The Cloud docs section (T6) is published.
- [ ] External pen test done; no open critical/high findings.
- [ ] Load test: 50 sign-ups in 10 minutes, p95 ≤ 3 minutes, zero failures.
- [ ] Beta exit criteria (T9) met.
- [ ] Pricing page reads the live catalog and degrades to the cached copy.
- [ ] The go/no-go checklist (T12) is fully ticked and signed off before public launch.

## Dependencies

- 061 (AGPL link in the instance UI), 064 (instance limit emails), 067 (portal emails, acceptance),
  068 (billing emails, refund and SLA credit mechanics), 069 (`cloudctl` for the beta), 070
  (DigitalOcean specifics, quotas), 071 (runbooks, alerts, drills), 072 (support roles, SOP links).

## Open questions

- Q4 — 14-day money-back, no trial: written into Refund Policy and ToS.
- Q13 — the timetable in the ToS matches 068 T11 exactly.
- Q20 — support access only with the customer's grant; stated in the Privacy Policy and DPA.
- Q21 — mail relay vendor named on the sub-processors page.
- Q22 — on-call staffing decides whether Business with 24×7 S1 sells at launch.
- Q23 — where the pricing page is built.

## Estimate

About 2 weeks of team time for M5 (legal review and pen test run in parallel and take calendar
time — book them at the start of M3), plus the M2 beta running 4–6 weeks alongside M3.
