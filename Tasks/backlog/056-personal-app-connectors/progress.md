# 056 — Progress

## Checklist
- [x] Definition written from the owner interview
- [x] PRD v1 in `task.md` (Rule 2: the task file is the PRD)
- [x] Owner answers to the v1 open questions (decisions 13–17)
- [ ] Owner corrections
- [ ] Phase 0 research matrix in `resources/`
- [ ] Phase 1 connector module
- [ ] Phase 2 Google Calendar, Slack, GitHub moved
- [ ] Phase 3 new connectors

## Log
- 2026-10-23: Surveyed the existing connection models and interviewed the owner; decisions 1–12 in `task.md`. Changes earlier decisions: decision 30 of 047 (connectors now also served over MCP), 046 design decision 3 (Slack becomes personal OAuth) and task 049 (GitHub sync retired for personal, on-demand use).

- 2026-10-23: PRD v1 written into `task.md`: problem, roles, stories, FR-1 to FR-38, data model, API sketch, phases, acceptance criteria, risks. Open questions left for the owner; FR-21 assumes MCP writes are approved in the Inbox.

- 2026-10-23: Owner answered the five open questions: MCP writes approved in the Inbox; quotas 500 reads / 50 write proposals per person and 200 reads per agent a day, admin-set under an instance ceiling; no Gmail in the Google pilot, Gmail via company Internal apps, hosted-instance CASA decided later from quotes; the Drive/Dropbox picker joins the module (checked: its client secret is stored unsealed and disconnect does not revoke); connectors easiest first, Shopify last. PRD v1.1 adds FR-39 and FR-40 and restores the connector list.

- 2026-10-28: Split into sub tasks 061–077 (Phase 0 research, Phase 1 module, Phase 2 migration), each with its FRs and dependencies; table in `task.md` §11. Phase 3 connector tasks wait for 062's ranking.

- 2026-10-28: Re-cut for two interns working independently. Track A (connections): 061, 063–067, 072, 073, 076, 077. Track B (tools): 062, 068–071, 078, 074, 075, 079. The only shared step is the contract in 063 (definition shape, schema, `resolveConnection`), written together on day 1. 072 and 077 split (new 078, 079); Slack and GitHub research moved from 061 into 074 and 075; 073 no longer waits on 071; Google setup page moved from 071 to 077. Joint end-to-end tests after Phase 1 and Phase 2 stay with this task.

## Last step
Two-track split done. Next: owner corrections, then the contract day for 063; 061 (A) and 062 (B) can start alongside.
