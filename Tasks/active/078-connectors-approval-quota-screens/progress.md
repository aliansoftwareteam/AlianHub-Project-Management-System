# Progress: Connectors — Inbox approval cards and quota settings screens

## Checklist
- [x] Approval cards
- [x] Quota settings
- [x] i18n backfill + checks
- [ ] Run on the real app with a real connection, now that 066 has landed
- [x] Decide who may read a card (see 2026-11-02)

## Last step
Built on `feat/078-connectors-approval-quota-screens`, cut from `upstream/feat/per-user-connectors`, then tested on a real server and in the real UI. Committed locally, not pushed, no PR.

## Blockers
None for the code. 066 landed on `upstream/feat/per-user-connectors` after this branch was cut, so a run with a real Google connection needs this branch merged with it and a Google OAuth client. The screens have no call to the generic connect route until 072, so that run has to connect through the API.

## Log

### 2026-11-02
- `ConnectorWriteCard.vue` draws `changes[].card` in the Inbox queue, the queue's bulk review and the AI Inbox. It replaces the preview 071 asked for: the card is what FR-33 names.
- The Inbox queue dropped `card` from its rows, so `Modules/Inbox/helpers/approvalQueue.js` now sends it.
- Edit: a tool names what its owner may retype with `editable`, checked at load. Only free text qualifies, so `notifyAttendees` and Meet's `accessType` cannot be changed on the card; the person declines instead. An edit is sent through the existing `reshown` path and the new card replaces the old in place. The button says "Check and show again" so nobody thinks that click sends.
- A field the write never named stays unnamed when typed in and emptied, because a blank clears it at Google.
- The AI Inbox no longer shows the owner-or-admin note on a `connection_owner` gate.
- New `GET /api/v2/connectors/admin/quotas`, the read 070 left out. Docs PR after merge: run `npm run api:doc`.
- Quota screen: `ConnectorQuotas.vue` on the Connections page, since 072 puts the connection screens there. Owners and admins only. A value above the ceiling is refused on screen before any call; the server holds the same rule.
- Decided by Prinsa, closing the question from 071: a card stays visible to whoever the proposal is shown to, so owners and admins read a member's pending write text and attendees and can decline with it in front of them. `GET /agents/proposals` already gave them the same data; the card only makes it visible.
- Checked in a browser with the real components and a mocked API, at desktop and phone width, light and dark: over-ceiling refusal, save, edit, re-show, locked row. Not run against the real server or a real connection.
- Unit: connector and inbox suites pass. Convention and `homeInboxDocsPolish` failures are the same 26 and 2 on a clean checkout of this branch's base, so none come from this task. Integration suites were not run.
- Deeper testing: an independent review, the real server on a throwaway MongoDB, and the built app in a browser, with only `resolveConnection` and the outbound call stubbed. Defects found and fixed:
  - An MCP-filed write showed a "1 change" summary and no card in both Inboxes, because `forBatches` stood in for it. Writes are now left out of batches. Only the browser pass caught this.
  - Home and Approvals offered one-click Approve on a write with no card. Both now send the person to the Inbox.
  - Undo was offered after a send and set the proposal to `undone` while the event stayed at Google. A proposal with a connector write now gets no undo window, and undo is refused.
  - "Done editing" in the queue dropped the edit, so Approve sent the old text. Done now checks the edit and shows it again, on both screens.
  - A card edited in another tab could be approved from the old one. `revision` moves on each edit, the screens send the one they read, and a mismatch is refused.
  - The AI Inbox offered edits on MCP writes that the server always refuses. The button is gone.
  - An update that left the name alone showed its event id as the title. `headline` now names the row and the title stays blank.
  - A former member's limit could not be taken away, unreadable number input silently cleared a limit, and a limit above a lowered ceiling read as in force.
  - "Check and show again" showed even after the write itself was dropped.
  - `editedAt` was dropped by the strict schema. `CONNECTORS=google` alone hid the quota screen: the catalogue now says `connectorLimits`. The promise about sending showed on cards no longer waiting. Edit refusals started with `bad_input:`.
- Second round of fixes:
  - The owner can now turn Google's emails off and change who joins a Meet: `editable` takes a toggle and a choice, as well as text. Ids stay out, since a mistyped one would act on something else.
  - No Edit on a lone write with nothing to change. The read card stays in sight above the form.
  - The revision check and the claim are one step now, so an edit racing an approval never sends the old text.
  - An edit writes its own audit row (`card_edited`).
  - The AI Inbox list marks a failed send "Not sent". The Inbox says what failed even when that was its last row.
  - A failed agent list no longer reads as "Deleted agent".
- Left as they are:
  - A proposal mixing a write with other changes loses its undo window as a whole; the audit log still undoes the rest.
  - A failed send stays `approved`, as 069 chose.
  - The proposal's headline is not rewritten by an edit.
  - `slack.message.post` has the same undo fault. 079 removes that path, so it is not fixed here.
- For track A, read against 066 and not fixed here:
  - A reconnect to a different Google account keeps the same connection id, so a waiting write goes to the new account. The card names no account.
  - Disconnect then reconnect gives a new id, so a waiting write is refused: the owner asks again. The send attempt still ends `approved` with "Not sent".
  - `resolveConnection.js` does not export `recordHealth`, so `health.js` records nothing after a provider call (070's open check).
  - A token failure such as `refresh_failed` reaches the card in developer wording.
- First final run, before the last small fixes: real server checks 57/57; integration 104/104 (connector, inbox, agents, MCP tools); unit 3768/3768 (connector, inbox, proposal, undo, intent, MCP); frontend specs 328/328 for the screens touched, not the whole frontend suite; convention failures still the same 26.

### 2026-10-31
- From 071: render a card's `targetLabel` and `rows` of `{ label, value | valueLabel }` with `$t`, and never clamp `text` or a row, because the server refuses a card too long to show whole.
- From 071: `intentPreview.js` has no preview for connector writes, so FR-33 needs one.
- From 071, needs a decision: owners and admins can read a member's pending MCP connector proposals, event text and attendees included, and project members can read agent-filed ones.
- From 071: 066 should not reach users before this task, because the owner approves from this card.

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
