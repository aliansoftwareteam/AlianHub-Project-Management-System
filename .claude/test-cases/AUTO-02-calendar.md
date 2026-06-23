# Test Cases — AUTO-02 Calendar (AHE-3736)

**Credential-free core:** a tokenized, read-only **iCal feed** of task due-dates,
subscribable in Google / Outlook / Apple Calendar. (2-way Google/Microsoft OAuth is
the documented config-gated extension.) Feed config lives in the **GLOBAL** db
(token-keyed) so the unauthenticated `.ics` URL resolves its company + scope.

**Endpoints:**
- `POST /api/v1/calendar/feeds` (JWT) `{scope:'my'|'project', projectId?, name?, userData}`
- `GET  /api/v1/calendar/feeds` (JWT) — list, each with its subscription `url`
- `DELETE /api/v1/calendar/feeds/:id` (JWT)
- `GET  /api/v1/calendar/ics/:token` — **PUBLIC**, rate-limited, returns `text/calendar`

**Frontend:** Integrations hub → **Calendar** section (scope picker, subscription URL + copy, subscribe guide).

## Pure-rule unit tests (`tests/ical-rules.test.js`) — 9/9 passing

| Group | Cases |
|-------|-------|
| feed tokens | 36-hex, unique, recognised · junk rejected |
| fmtDate | UTC all-day `YYYYMMDD` · invalid → null |
| escapeText | escapes `;` `,` `\` and newlines (RFC 5545) |
| buildIcs | valid VCALENDAR envelope · VEVENT rendered, escaped, all-day `DTSTART;VALUE=DATE` · skips bad-date events · CRLF endings |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create "My tasks" feed | Calendar → scope My → Create | Feed appears with a subscription URL |
| M2 | Subscribe | Paste URL into Google/Outlook "add from URL" | Tasks with due dates show as all-day events |
| M3 | Project feed | scope Project → pick project → Create | Feed includes that project's due-dated tasks only |
| M4 | Live update | Change a task's due date | Calendar app reflects it on next refresh (feed is generated live) |
| M5 | Disabled/deleted feed | Delete the feed, refetch the URL | 404 "Feed not found." |
| M6 | Bad token | GET /calendar/ics/xxx | 400 "Invalid feed token." |
| M7 | Rate limit | > 60 feed fetches/min/IP | 429 |
| M8 | companyId isolation | Token resolves its own company | Only that company's tasks appear |
| M9 | Content type | Fetch the URL | `Content-Type: text/calendar`, valid VCALENDAR body |

## Guards / non-regression
- Read-only — the feed only **reads** tasks (DueDate present, not deleted); no writes, no socket, no core mutation.
- Public route is token-authenticated (36-hex), rate-limited; only `/api/v1/calendar/feeds` is JWT-mounted, so `/api/v1/calendar/ics/:token` stays public.
- New `calendar_feeds` collection + new route prefix; additive only.
- DTSTAMP passed in by the controller so the pure builder stays deterministic/testable.

## OAuth extension (documented, config-gated)
2-way sync (push AlianHub due-dates into Google/MS as editable events + pull back) requires a Google/Microsoft OAuth app (client id/secret). When those env vars are present, a connect flow can be enabled; the iCal feed already covers the read-only "see my tasks in my calendar" need with zero setup.
