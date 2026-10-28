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

## Last step
Split into 061–077. Next: owner corrections, then 061, 062 and 064 can start in parallel.
