# Billing Rates + Invoicing — Test Cases

**Feature:** TIME-07 — hourly rates → invoice generation from billable time
**Backend:** `billing_rates` collection; `Modules/TimeSheet/helpers/billingRules.js` (resolveRate + buildInvoice) + `billing.js` (`setRate`, `listRates`, `generateInvoice`)
**Endpoints:** `POST/GET /api/v1/timesheet/rates`, `POST /api/v1/timesheet/generate-invoice`
**Frontend:** `TimesheetInvoice.vue` — rate input + "Invoice" button in the User Timesheet toolbar (downloads an invoice CSV)
**Depends on:** TIME-02 (billable flag)
**Unit tests:** `tests/billing-rules.test.js` (12 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| BI-01 | Set a default rate | — | `POST /rates {scope:'default', rate:40}` | Saved; appears in `GET /rates` | | ⬜ |
| BI-02 | Set a user rate | — | `POST /rates {scope:'user', refId:<uid>, rate:60}` | Saved (upsert — repeat updates, not duplicates) | | ⬜ |
| BI-03 | Validation | — | `POST /rates {scope:'user', rate:60}` (no refId) | Rejected with a clear message | | ⬜ |
| BI-04 | Generate invoice | Billable entries + rates exist | `POST /generate-invoice {start,end}` (seconds) | `{ currency, lineItems:[{userId,hours,amount}], subtotal, total }` correct | | ⬜ |
| BI-05 | Rate precedence | user + project + default rates set | Generate | Each entry billed at user > project > default rate | | ⬜ |
| BI-06 | Non-billable excluded | Mix of billable/non-billable | Generate | Only billable time is invoiced | | ⬜ |
| BI-07 | Default-rate fallback | No configured rate | Generate with a `defaultRate` (UI rate field) | Unrated time billed at the default rate | | ⬜ |
| BI-08 | UI download | On User Timesheet | Enter a $/h, click **Invoice** | An `invoice-<start>_<end>.csv` downloads with per-user rows + Total | | ⬜ |

**Total:** 8 cases (API/UI — run on the dev server). Rate resolution + invoice math covered by 12 automated unit tests.
