# Progress: Connectors — Inbox approval cards and quota settings screens

## Checklist
- [ ] Approval cards
- [ ] Quota settings
- [ ] i18n backfill + checks

## Last step
Not yet started.

## Blockers
Waits on 069, 070.

## Log

### 2026-10-31
- From 071: render a card's `targetLabel` and `rows` of `{ label, value | valueLabel }` with `$t`, and never clamp `text` or a row, because the server refuses a card too long to show whole.
- From 071: `intentPreview.js` has no preview for connector writes, so FR-33 needs one.
- From 071, needs a decision: owners and admins can read a member's pending MCP connector proposals, event text and attendees included, and project members can read agent-filed ones.
- From 071: 066 should not reach users before this task, because the owner approves from this card.

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.
