# Progress: Cloud back office — the staff console at ops.alianhub.com

## Checklist
- [x] T1 — Access, staff accounts and roles
- [x] T2 — Customers
- [ ] T3 — Instances — partly: no health data until 071 and no signed entitlements document until 069; limits are computed from plan and add-ons
- [x] T4 — Provisioning failures queue
- [x] T5 — Hosts and capacity
- [ ] T6 — Catalog editor — partly: editing and versions work; sync to the payment provider is a seam until 068
- [ ] T7 — Coupons — partly: coupons are stored and editable; applied by billing in M5
- [x] T8 — Manual actions, each with a reason
- [x] T9 — Support access sessions
- [ ] T10 — Business dashboards — partly: list-price revenue, sign-up funnel and operations numbers; margin and checkout steps come with 068
- [x] T11 — Audit log viewer
- [x] T12 — Alerts inbox
- [x] T13 — Back-office API

## Last step
Built on `feat/back-office` in `F:/Projects/alianhub-cloud` and merged into `main` with the portal (067). Lint, 320 tests and the build pass.

## Blockers
Refunds and invoice re-sends stay disabled until 068 (M5). On production, create the database role that makes `events` insert/find-only (decision 89). `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are needed before ops.alianhub.com goes live.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).

### 2026-10-28
- Back office built at `/api/ops/v1` with its own session (`__Host-ahc_ops`): Cloudflare Access JWT check (logged bypass in dev), staff TOTP with enrolment on first sign-in, role check on every route, `npm run staff:create` for the first admin.
- Added for the pre-payment period: the plan requests queue (approve runs `grantPlan` or the orchestrator change; reject with a note; the customer is emailed either way) and invite codes (create, list, revoke).
- Manual actions take a reason and reason code; restore and delete-now, and the 21st destructive action in an hour, need a second admin within 24 hours.
- At merge with the portal there is one `startSupportSession()` (the portal's: grant check and first-use email) on the instance action `support.session`; the back office writes the audit row with the reason. Back-office decisions are numbered 64–89.
