# Progress: Connectors — My connections, admin overview and company apps screens

## Checklist
- [x] Shared labels module (connectorLabels.js)
- [x] My connections (MyConnections.vue)
- [x] Admin overview (AdminConnections.vue)
- [x] Company apps (CompanyApps.vue) + getApps catalog
- [x] Wire into ConnectionsPage + css
- [x] i18n keys under Connectors.conn.* + backfill
- [x] i18n:check + style:check pass

## Last step
All three screens built as components the Connections page composes. Checks green: `i18n:check` and `style:check` exit 0 (0 findings in the new files), `vue-cli-service lint` clean on the new files, backend `controller.js` lints and loads. Committed on `feat/task-072-connectors-connection-screens`; not pushed — left for Hetvi to push.

## Blockers
None (066 merged into the base).

## Runtime verification (2026-11-02)
Ran the full stack locally (mongod on a fresh temp dbpath, backend on :4000 with CONNECTORS=google,google_calendar + dummy Google client, frontend dev server on :8080), created a test owner, opened the Connections page:
- All three screens render with live data: My connections (Google + Calendar/Meet/Drive + Connect), Everyone's connections (empty state), Company OAuth apps (Google, built-in app, redirect URI, Copy, Set).
- `GET /api/v2/connectors`, `/members`, `/apps` all 200. No console errors from the new components.
- CompanyApps set-form opens, submits, and surfaces the backend refusal inline (tested with the secrets store off → "The secrets store is off").
- The page-level "Request failed with status code 404" is the host ConnectionsPage's own `/mcp/manifest` + `/health` fetches (pre-existing, not 072).

Not completed: the company-app set happy path (secrets store on). Enabling the store needed a backend restart, which hit the machine being out of disk (C: ~0.19 GB free) and low RAM — a local environment limit, not a code issue. No code bug was found in the 072 components.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-02
- 066 confirmed merged into `feat/per-user-connectors`; branched 072 from it and moved the task to active.
- Settled the plan: three components composed by the Connections page; only backend touch is a read-only `catalog` on `getApps` for the company-apps screen. Admin overview uses the shipped `GET /api/v2/connectors/members`.
