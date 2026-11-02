# Progress: Connectors — Inbox approval cards and quota settings screens

## Checklist
- [x] Approval cards
- [x] Quota settings
- [x] i18n backfill + checks
- [ ] Run on the real app with a real connection, after 066
- [ ] Decide who may read a card (see 2026-11-02)

## Last step
Built on `feat/078-connectors-approval-quota-screens`, cut from `upstream/feat/per-user-connectors`. Committed locally, not pushed, no PR.

## Blockers
None for the code. A real run waits on 066: until then `resolveConnection` refuses every call.

## Log

### 2026-11-02
- `ConnectorWriteCard.vue` draws `changes[].card` in the Inbox queue, the queue's bulk review and the AI Inbox. It replaces the preview 071 asked for: the card is what FR-33 names.
- The Inbox queue dropped `card` from its rows, so `Modules/Inbox/helpers/approvalQueue.js` now sends it.
- Edit: a tool names what its owner may retype with `editable`, checked at load. Only free text qualifies, so `notifyAttendees` and Meet's `accessType` cannot be changed on the card; the person declines instead. An edit is sent through the existing `reshown` path and the new card replaces the old in place. The button says "Check and show again" so nobody thinks that click sends.
- A field the write never named stays unnamed when typed in and emptied, because a blank clears it at Google.
- The AI Inbox no longer shows the owner-or-admin note on a `connection_owner` gate.
- New `GET /api/v2/connectors/admin/quotas`, the read 070 left out. Docs PR after merge: run `npm run api:doc`.
- Quota screen: `ConnectorQuotas.vue` on the Connections page, since 072 puts the connection screens there. Owners and admins only. A value above the ceiling is refused on screen before any call; the server holds the same rule.
- Open decision from 071, not changed here: a card shows to whoever the proposal is shown to, so owners and admins read a member's pending write text and attendees. `GET /agents/proposals` already gave them the same data; the card only makes it visible.
- Checked in a browser with the real components and a mocked API, at desktop and phone width, light and dark: over-ceiling refusal, save, edit, re-show, locked row. Not run against the real server or a real connection.
- Unit: connector and inbox suites pass. Convention and `homeInboxDocsPolish` failures are the same 26 and 2 on a clean checkout of this branch's base, so none come from this task. Integration suites were not run.

### 2026-10-31
- From 071: render a card's `targetLabel` and `rows` of `{ label, value | valueLabel }` with `$t`, and never clamp `text` or a row, because the server refuses a card too long to show whole.
- From 071: `intentPreview.js` has no preview for connector writes, so FR-33 needs one.
- From 071, needs a decision: owners and admins can read a member's pending MCP connector proposals, event text and attendees included, and project members can read agent-filed ones.
- From 071: 066 should not reach users before this task, because the owner approves from this card.

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
