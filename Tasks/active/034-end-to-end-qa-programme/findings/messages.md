# Messages and inbox — QA sweep (task 034, area `messages`)

Server: http://localhost:4000 (beta), company `6a8ee973d625fca52e519a12` (Local360), demo team.
Roles exercised through `npm run demo:token`: admin (`rahul.manager`), member (`priya.frontend`, `arjun.backend`), guest (`kabir.intern`). Owner via the in-app browser pane.
SMTP is off, so mail delivery failures are expected and are only counted below when the error is unhandled.

## Coverage

### Routes (48 registered across the area's modules)

| Module | Routes | Exercised | Notes |
|---|---|---|---|
| notification/app-notification | 7 | 7 | anon (401), admin, member, guest |
| notification/notification-middleware (`email-cron-handler`, `send-fcm`) | 2 | 2 | anon (401), guest |
| notification/prepare-notification-data | 1 | 1 | anon (401), guest |
| notification/sendEmail (`single-notification-email`) | 1 | 1 | anon (401), guest |
| notification1 (`handleHistory`, `handleNotification`) | 2 | 2 | anon (401), guest |
| notification-count (`updateunreadcommentscount`, `push…`, `unsetCommentCounts`) | 3 | 3 | anon, guest |
| EmailNotification (`sendMail`) | 1 | 1 | anon (401), guest — SMTP off |
| emailTemplate (`updateEmailTemplate`) | 1 | 1 | read-only per area rules; validation probe only |
| EmailIn (`email-in/inboxes` CRUD + `:token` webhook) | 5 | 5 | read-only per area rules; reads + refusals only |
| Inbox (`/inbox`, `/counts`, `/read`, `/read-all`) | 4 | 4 | anon (401), admin, member, guest, owner |
| MainChats (`main-chats`, `main-chats/find`) | 2 | 2 | anon (401), admin, member, guest, owner |
| Calls (`ice-config`, `notes` ×4) | 5 | 5 | anon (401), member, member2, admin, guest, owner |
| Reminders (task-scoped, 6) | 6 | 6 | anon, member, guest |
| GeneralReminders (6) | 6 | 6 | anon (401), member, member2, owner |
| Changelog (`/api/v2/changelog`) | 1 | 1 | anon (public), owner |
| tours (`/api/v1/tours`) | 1 | 1 | anon (401), admin, member, guest |

`/api/v1/insertnotification` in `Modules/notification/routes.js` is **not registered** (index.js never requires `Modules/notification/init`); see MSG-08. Not counted above.

### Screens (7, all opened as owner without console errors)

| Screen | Route | Opened |
|---|---|---|
| Inbox | `/:cid/inbox` | ✓ |
| Chat (workspace) | `/:cid/chat` | ✓ |
| Chat (project) | `/:cid/chat/:pid` | ✓ |
| Chat (channel) | `/:cid/chat/:pid/:sid` | same component as above |
| Call/meeting notes | `/:cid/chat-notes/:noteId` | ✓ ("Notes not found." for a non-participant, correct) |
| What's New (Changelog) | `/:cid/whats-new` | ✓ |
| Notification preferences | `/:cid/settings/notifications` | ✓ |

All opened tabs reported no console errors (`read_console_messages`).

---

## Findings

### MSG-01 — Task reminders API is unauthenticated and has no ownership scoping
- **Severity:** critical (auth bypass + cross-tenant + cross-user data tamper)
- **Role:** anonymous, and any signed-in role
- **Requests:** `GET/POST /api/v1/reminders`, `PATCH/DELETE /api/v1/reminders/:id`, `POST /api/v1/reminders/:id/run-now`, `POST /api/v1/reminders/run-due`
- **Expected:** the prefix is behind `verifyJWTTokenWithCV2` (like `/api/v1/general-reminders`), the acting user is `req.uid`, and reads/writes are scoped to the owner within the JWT's company.
- **Actual:** `/api/v1/reminders` is in **neither** JWT list in `Config/setMiddleware.js`, so `app.use` never runs a token check on it. Every route answers with no session:
  - `POST /api/v1/reminders` with headers `companyid: <any>` + `userid: <any>` creates a reminder owned by that user in that company (`200 {status:true}`).
  - `GET /api/v1/reminders` with those headers lists that user's reminders.
  - `PATCH /api/v1/reminders/:id` and `DELETE /api/v1/reminders/:id` edit/soft-delete **any** reminder by id — the controller/helper filter on `_id` only, with no `userId` and no company-membership check. A signed-in guest edited a member's reminder (`reminderText` became `"[QA messages] hijacked by guest"`); a fully anonymous `DELETE` removed it.
  - `POST /api/v1/reminders/:id/run-now` and `/run-due` fire in-app notifications with no session.
- **Reproduction:**
  1. `TOKEN` not needed. `curl -s -X POST localhost:4000/api/v1/reminders -H 'companyid: 6a8ee973d625fca52e519a12' -H 'userid: <memberUid>' -H 'content-type: application/json' -d '{"reminderAt":"2027-01-01T00:00:00Z","reminderText":"x"}'` → `200 {status:true}`.
  2. `curl -s -X DELETE localhost:4000/api/v1/reminders/<thatId> -H 'companyid: 6a8ee973d625fca52e519a12'` → `200 {status:true,statusText:"Deleted"}`.
- **Suspected fix:** add `'/api/v1/reminders'` to `verifyJWTTokenWithCRoute` in `Config/setMiddleware.js` (next to `/api/v1/general-reminders`, ~line 165); make `resolveUserId` in `Modules/Reminders/controller.js` take the user from `req.uid` only; and give `Modules/Reminders/helper.js updateReminder(companyId, id, patch)` a `userId` filter (as `Modules/GeneralReminders/helper.js` already does). `listMine`, `updateReminder`, `deleteReminder`, `runNow` must all scope by owner.

### MSG-02 — app-notification reads and writes trust a `userId` parameter, so any user can read/alter another user's notifications
- **Severity:** high (wrong access enforcement / IDOR within a company)
- **Role:** any signed-in role (shown with guest against a member)
- **Requests:** `GET /api/v1/app-notification/notification?userId=<other>`, `GET /api/v1/app-notification/mentions?userId=<other>`, `PUT /api/v1/app-notification/mark-read`, `PUT /api/v1/app-notification/mark-all-read`, `PUT /api/v1/push-mark-read`
- **Expected:** these endpoints are behind JWT (they are), but the recipient must be `req.uid`; one user must not be able to read or change another user's notification/mention feed.
- **Actual:** `Modules/notification/app-notification/controller.js` reads `userId` straight from `req.query`/`req.body` and never compares it to `req.uid`. Signed in as the guest, `GET /api/v1/app-notification/notification?userId=<memberUid>&filter=unread` returned the member's unread rows (every row `receiverID === memberUid`). `PUT …/mark-read {key:'notifications', id:<member row>, userId:<memberUid>}` returned `matchedCount:1` and the member's unread count dropped from 2 to 1 — a different user silently marked the member's notification read.
- **Reproduction:** with any demo token, `GET /api/v1/app-notification/notification?userId=<anotherUsersId>&filter=unread` returns that user's rows.
- **Note:** the newer `/api/v1/inbox` surface takes the user from `req.uid` and is not affected; this is the legacy bell/mention API that still backs the header dropdowns.
- **Suspected fix:** in `Modules/notification/app-notification/controller.js`, ignore `req.query.userId`/`req.body.userId` and use `req.uid` for `getNotificationMessages`, `getMentionsMessages`, `updateMarkRead`, `updateMarkAllRead`.

### MSG-03 — app-notification mark-read with a malformed id returns HTTP 500 with a raw driver message
- **Severity:** medium (unhandled error / bad error handling)
- **Role:** any signed-in role
- **Request:** `PUT /api/v1/app-notification/mark-read` with `{key:'mentions', id:'nope', userId:<uid>}`
- **Expected:** a 400/`{status:false}` with a clean message (a malformed id is a client error).
- **Actual:** `500 {"message":"An error occurred while mark read message","error":"input must be a 24 character hex string, 12 byte Uint8Array, or an integer"}` — `new mongoose.Types.ObjectId(id)` throws before validation and the raw exception is returned to the client.
- **Suspected fix:** validate `id` with a 24-hex guard in `updateMarkRead` (`Modules/notification/app-notification/controller.js`) before constructing the ObjectId, and answer `{status:false}`.

### MSG-04 — General reminders assigned to another user become unmanageable, and edit/delete report a false success
- **Severity:** medium (broken secondary function + misleading response)
- **Role:** member (author) / member2 (assignee)
- **Requests:** `POST /api/v1/general-reminders {assignedTo}`, then `PATCH`/`DELETE /api/v1/general-reminders/:id` by the author
- **Expected:** if the author can still see a reminder they raised for someone else (it shows under `?filter=assigned`), they should be able to edit/delete it — or the response should say they can't.
- **Actual:** on create with `assignedTo`, the document's `userId` is set to the assignee and `createdBy` to the author. `updateReminder`/`deleteReminder` in `Modules/GeneralReminders/helper.js` filter by `userId === req.uid`, so the author's `PATCH`/`DELETE` match **nothing** — yet the controller still returns `200 {status:true, statusText:'Updated'/'Deleted', data:null}`. The assignee keeps the untouched reminder (verified: after the author "deleted" it, member2 still listed it with the original title). A caller cannot tell a no-op from a real change.
- **Reproduction:** member `POST /api/v1/general-reminders {title, remindAt, notifyBefore:-1, assignedTo:<member2Uid>}`; member `DELETE /api/v1/general-reminders/:id` → `200 Deleted` but member2 `GET /api/v1/general-reminders` still returns it.
- **Suspected fix:** in `Modules/GeneralReminders/controller.js`, scope by `createdBy` OR `userId` (so the author can manage what they raised), and return `{status:false}` when the update/delete matched no document instead of a blanket success.

### MSG-05 — `unsetCommentCounts` shadows the Express `res`, so a successful unset throws and answers 404
- **Severity:** medium (broken function + wrong status/shape)
- **Role:** any signed-in role
- **Request:** `POST /api/v1/unsetCommentCounts`
- **Expected:** the standard `{status, statusText}` envelope; a successful unset returns `200 {status:true}`.
- **Actual:** in `Modules/notification-count/routes.js` the handler does `ctrl.unsetAllCounts(...).then((res) => { res.send(res.statusText) })` — the promise-result parameter `res` shadows the Express `res`, so on success `res.send` is not a function, the `.then` throws, and the outer `catch` answers `res.status(404).send(error)`. Validation paths also answer `404` with a bare string/`{}` (`"companyId is required"`, `{}`) instead of the envelope. Observed `404 {}` for a well-formed request against a non-matching project.
- **Suspected fix:** rename the `.then` parameter (e.g. `(result)`), send the standard envelope, and use 400 for validation errors in `Modules/notification-count/routes.js`.

### MSG-06 — `POST /api/v1/handleNotification` hangs (never responds) when required fields are missing
- **Severity:** medium (unhandled path holds the connection open)
- **Role:** any signed-in role
- **Request:** `POST /api/v1/handleNotification` with an empty/partial body
- **Expected:** a prompt `{status:false}` describing the missing field (the sibling `POST /api/v1/handleHistory` returns `200 {status:false}` at once).
- **Actual:** the request never returns; the client aborted after 15s. `Modules/notification1/routes.js` calls `HandleBothNotification(req.body)` (`Modules/Tasks/helpers/handleNotification.js`), whose promise neither resolves nor rejects on a missing `type`/`taskId`, so the `.then/.catch` in the route never fire and no response is sent.
- **Reproduction:** with any demo token, `POST /api/v1/handleNotification` `{}` — the request hangs.
- **Suspected fix:** validate the body in `Modules/notification1/routes.js` before calling, and ensure `HandleBothNotification` always settles (`Modules/Tasks/helpers/handleNotification.js`).

### MSG-07 — General reminder `assignedTo` accepts an arbitrary / non-member user id
- **Severity:** low
- **Role:** member
- **Request:** `POST /api/v1/general-reminders {assignedTo:'000000000000000000000000'}`
- **Expected:** `assignedTo` is validated against the company's members.
- **Actual:** `200 {status:true, statusText:'Reminder created'}` for a user id that is not a member of the company; the reminder is created owned by an id nobody can see. No membership check on `assignedTo` in `Modules/GeneralReminders/controller.js createReminder`.
- **Suspected fix:** verify `assignedTo` is an active member of `companyId` before assigning.

### MSG-08 — `/api/v1/insertnotification` is defined but never registered (dead route)
- **Severity:** low
- **Role:** n/a
- **Request:** `POST /api/v1/insertnotification`
- **Expected:** either the route is mounted or the file is removed.
- **Actual:** `Modules/notification/routes.js` (`app.post('/api/v1/insertnotification', …)`) is only reachable through `Modules/notification/init`, which `index.js` never requires (it requires the four sub-module inits under `Modules/notification/*` but not the root one). The route is dead code.
- **Suspected fix:** delete `Modules/notification/routes.js`/its init, or wire it up if still needed.

---

## Checks that passed

- Every JWT-guarded route answered `401` with no token: app-notification (comment/mentions/notification/mark-read/mark-all-read), `email-cron-handler`, `send-fcm`, `prepare-notification-data`, `single-notification-email`, `sendMail`, `email-in/inboxes` (all verbs), `inbox` (all verbs), `main-chats` + `main-chats/find`, `calls/*`, `general-reminders` (all verbs), `tours`.
- A valid member token with a **different** `companyid` header (`000…001`) was rejected `401` on inbox, general-reminders, calls, email-in and main-chats (JWT audience check holds; no cross-company read).
- `POST /api/v1/main-chats/find` ignores a client-supplied query and only returns the caller's own main-chat conversations (`AssigneeUserId = req.uid`); a `findQuery` that is not an array returns `[]`, not a dump. Guest saw none (correctly).
- Calls meeting-notes are participant-scoped: a non-participant (`member2`, guest) got `Notes not found.` on GET/PATCH; a participant added at create time (admin) saw the note; bad ids returned `Invalid id.`; missing `callId` returned a clean `{status:false}`.
- `GET /api/v2/calls/ice-config` returned a STUN-only config with `hasTurn:false` and a short TTL (no TURN secret leaked; SMTP/TURN not configured locally).
- `updateunreadcommentscount` rejects a `companyId` body value that disagrees with the `companyid` header ("companyId mismatch") — no cross-tenant count writes.
- Inbox counts/list/read/read-all are scoped to `req.uid`; `read-all` on `archive`/`done` is refused ("Those are already read."); a guest marking a member's notification read via the legacy API (MSG-02) could be fully reversed through `POST /api/v1/inbox/read {read:false}` and counts returned to baseline.
- `GET /api/v2/changelog` served the parsed CHANGELOG.md (current + latest version, releases) publicly, and the What's New screen rendered it.
- `POST /api/v2/sendMail` and `POST /api/v2/single-notification-email` failed cleanly with `{status:false}` (SMTP off) rather than crashing — expected, not counted as findings.
- Email-in inbox management (`/inboxes`) and the public `:token` webhook validate the token format and return `Inbox not found.`/`Invalid inbox token.`; treated as read-only per area rules.
- `emailTemplate` validation (`updateEmailTemplate`) returns `{status:false}` for a missing body; treated as read-only per area rules (not exercised for writes).
- Owner UI: Inbox, Chat (workspace/project/channel/notes), What's New and Settings › Notifications all rendered without console errors.
