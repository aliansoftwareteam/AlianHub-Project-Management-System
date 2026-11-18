# Functional gaps the new UI exposed

Each is a place a redesigned screen asks for behaviour the backend does not have.
The UI currently states the absence honestly instead of faking a value; these are
the tasks that would let it show something real.

| # | Screen | What the UI wants | What is missing | Size |
|---|---|---|---|---|
| 1 | `10b` Board | WIP limit chip per column | No `wipLimit` on the status document. Board reads `column.wipLimit` then a per-viewer localStorage fallback, so adding the field takes over with no UI change. | S |
| 2 | `13c` Table | AREA / category column | No categorisation endpoint. `Modules/AI` has description, summary, transcribe, meeting-notes only. Needs `POST /api/v1/ai/task-category` + cache. | M |
| 3 | `25c` People | Org chart, "reports to" | No manager field anywhere in the schema. Needs a `managerId` on the company-user record plus a tree view. | M |
| 4 | `14e` Forms | "On submit" automation | The automation registry has no `form.submitted` trigger, so the rule panel is read-only. Needs the trigger + the event emit on form submission. | M |
| 5 | `17c` Recurring | Weekly interval | The scheduler ignores `interval` for weekly rules — "every 2 weeks" fires weekly. Already queued as a background task. | S |
| 6 | `27c` Accounts | Human hours by source | Nothing splits *human* logged hours by where the work happened; only agent runs carry `viaAccount`. | M |
| 7 | `28c` Release | Deploy target, CI status, PR rows | No deploy-capable integration and nothing records deploys or CI. Needs a real integration before the screen can show anything. | L |
| 8 | `19c` Invoice | Export to Stripe | No Stripe integration in `Modules/Integrations`. | L |
| 9 | `20b–d` Dashboards | 17 catalogue cards incl. 3 AI cards | Shipped 6 against real endpoints per the handoff's own instruction. The AI cards need an endpoint that answers a saved question on a schedule. | L |
| 10 | API-wide | Failures return HTTP 200 with `{status:false}` | A monitoring tool watching status codes never sees a failed create. Changing it risks callers that read the `status` field, so it needs a deliberate migration. | M |

Not gaps — deliberately cut by the handoff's own build order (turn 23a):
whiteboard (`17a`) and mind map (`17b`).
