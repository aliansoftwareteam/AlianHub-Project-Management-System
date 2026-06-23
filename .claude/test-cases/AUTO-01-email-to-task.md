# Test Cases — AUTO-01 Email-to-task / Email in (AHE-3735)

Turns inbound email into tasks. A per-project **inbox address** (`inbox+<token>@<domain>`)
is created; any inbound-email-parse provider (Mailgun / SendGrid / SES / Postmark)
POSTs the message to `/api/v1/email-in/<token>` and a task is created in the mapped
project/sprint. Mirrors the **RecurringTasks** pattern: project / sprint / user are
snapshotted at inbox-creation time so the inbound handler calls the canonical
`taskMongo.create(...)` with no re-loading.

**Collection:** `email_inboxes` — lives in the **GLOBAL** db keyed by `token` so the
unauthenticated inbound webhook can resolve token → company without auth.

**Endpoints:**
- `POST /api/v1/email-in/inboxes` (JWT) — create inbox for a project → returns `address`
- `GET  /api/v1/email-in/inboxes?projectId=` (JWT) — list
- `PUT  /api/v1/email-in/inboxes/:id` (JWT) — enable/disable / rename
- `DELETE /api/v1/email-in/inboxes/:id` (JWT) — soft-delete
- `POST /api/v1/email-in/:token` — **PUBLIC**, rate-limited inbound webhook

## Pure-rule unit tests (`tests/email-in-rules.test.js`) — 14/14 passing

| Group | Cases |
|-------|-------|
| tokens | 36-hex generated, unique, recognised · junk rejected · `inbox+token@domain` composed |
| extractToken | plain addr · "Name <addr>" · array of recipients · none → '' |
| extractEmail | angle-bracket · plain (lowercased) · garbage → '' |
| parseInbound | subject→name, text→desc, from→sender · missing subject → "(no subject)" · HTML fallback (strips `<script>`) · clamps long subject/body |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create inbox | POST /inboxes with projectData | 201, returns `inbox+<token>@<domain>` |
| M2 | Inbound creates task | POST /email-in/:token `{from, subject:"Fix bug", text:"…"}` | Task "Fix bug" created in the inbox's project/sprint; `data.taskId` returned |
| M3 | Body parsing | Send HTML-only email | Task description = stripped HTML text |
| M4 | Disabled inbox | PUT enabled=false, then POST inbound | 404 "Inbox not found." — no task |
| M5 | Bad token | POST /email-in/notarealtoken | 400 "Invalid inbox token." |
| M6 | Unknown token | POST /email-in/<valid-shape-but-missing> | 404 |
| M7 | Rate limit | > 30 inbound/min from one IP | 429 |
| M8 | Auth boundary | GET /inboxes without JWT | rejected; `POST /email-in/:token` stays public |
| M9 | companyId isolation | Two companies | each lists/deletes only its own inboxes; token resolves its own company |
| M10 | Stats | After M2 | inbox `receivedCount`++, `lastEmailFrom`, `lastTaskId` updated |

## Guards / non-regression
- Tasks are created through the **same** `taskMongo.create` path as the UI (TaskKey generation, history, socket emit, notifications) — no invariant bypassed.
- The public inbound route is **token-authenticated** (36-hex secret in the path), IP rate-limited, and `isInboxToken`-validated; only `/api/v1/email-in/inboxes` is JWT-mounted, and Express `app.use` segment matching means `/api/v1/email-in/<token>` never matches that mount.
- New collection + new route prefix; additive only — no existing endpoint, schema or collection modified.
- `EMAIL_IN_DOMAIN` is configurable via env (defaults to `inbox.alianhub.com`); a missing/misconfigured provider simply means no inbound calls — nothing breaks.

## Frontend
Per-project inbox manager (address + enable/disable/delete) — see follow-up; the feature is fully usable via API in the meantime.
