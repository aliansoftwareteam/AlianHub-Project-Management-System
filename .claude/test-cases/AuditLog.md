# Audit Log — Test Cases

**Feature:** SEC-04 — tamper-evident audit logs with retention
**Backend:** `Modules/Audit/{recorder,controller,routes,init}.js`, `Modules/Audit/helpers/auditRules.js`, `audit_logs` collection, `GET /api/v1/audit-logs`, daily 02:00 retention cron (`cron.js`)
**Frontend:** `frontend/src/views/Settings/Audit/AuditLog.vue` (Settings → Audit Log tab)
**Hooks (initial):** `member.update` (Members controller), `sso.config_update` (SSO config)
**Unit-tested:** `tests/audit-rules.test.js` (`normalizeAuditEntry`, `retentionCutoff`) — in the Node suite (29 suites / 327 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| AUD-01 | Member change is audited | Logged in as owner/admin | Settings → Members, change a member's role (or guest projects / status), save | A new row appears in Audit Log: action `member.update`, entity `member: <id>`, your name as actor, meta lists the changed fields | | ⬜ |
| AUD-02 | SSO config change is audited | Owner/admin; SSO module configured | Settings → SSO, toggle Enabled or edit a field, Save | A new `sso.config_update` row appears with meta `{provider, isEnabled}` | | ⬜ |
| AUD-03 | Owner/admin can view the log | Logged in as owner or admin | Open Settings → Audit Log | Table loads with recent events, newest first; pagination footer shows totals | | ⬜ |
| AUD-04 | Non-privileged user is blocked | Logged in as a normal member (roleType 3) | Call `GET /api/v1/audit-logs` (or open the tab if visible) | `403` with `Owner/admin only.`; no rows returned | | ⬜ |
| AUD-05 | Filter by action | Several events of different actions exist | Type `member.update` in Action, click Apply | Only `member.update` rows shown; total updates accordingly | | ⬜ |
| AUD-06 | Filter by entity type | Mixed entity events exist | Type `sso` in Entity type, Apply | Only `sso`-entity rows shown | | ⬜ |
| AUD-07 | Filter by date range | Events span multiple days | Set From/To to a window that excludes today, Apply | Only rows within the window shown; today's rows excluded | | ⬜ |
| AUD-08 | Pagination | More than 25 events exist | Click Next | Page 2 loads (next 25), newest-first order preserved; Prev returns to page 1 | | ⬜ |
| AUD-09 | Clear filters | Filters applied | Click Clear | All filters reset, page returns to 1, full list reloads | | ⬜ |
| AUD-10 | Logging never breaks the action | — | Force a recorder failure (e.g. bad companyId in a dev hook) and perform a member update | The member update still succeeds (HTTP 200); the audit write fails silently (fire-and-forget) | | ⬜ |
| AUD-11 | Immutable trail | Audit rows exist | Attempt to edit/delete a row via any normal API | No app endpoint mutates or deletes individual rows; only the retention cron prunes by age | | ⬜ |
| AUD-12 | Retention prune | Rows older than `AUDIT_RETENTION_DAYS` exist (default 365); set a small value in dev | Run `auditRecorder.runAuditRetentionForAllCompanies()` (or wait for the 02:00 cron) | Rows older than the cutoff are deleted; newer rows remain | | ⬜ |
| AUD-13 | Multi-tenant isolation | Two companies with audit rows | As company A's admin, open Audit Log | Only company A's events are visible; company B's are never returned | | ⬜ |
| AUD-14 | Entry normalization (unit) | — | `npx jest tests/audit-rules.test.js` | `action` required; over-long fields bounded; non-plain `meta` rejected; `retentionCutoff` correct — all green | | ✅ |

**Total:** 14 cases (1 unit-automated, 13 runtime/manual). First hooks are member + SSO changes; more mutation hooks can be added incrementally using `recordAuditFromReq`.
