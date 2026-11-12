# 056 — Progress

## Checklist
- [x] Definition written from the owner interview
- [x] PRD v1 in `task.md` (Rule 2: the task file is the PRD)
- [x] Owner answers to the v1 open questions (decisions 13–17)
- [x] Owner corrections: PRD v2.0 (decisions 18–29), approved 2026-11-12
- [x] Research matrix in `resources/` (061, 062, 074; MCP servers in section 10)
- [ ] Owner accepts the 061 and 062 research
- [x] v1.1 module built on `feat/per-user-connectors` (063–074, 076, 078)
- [ ] GitHub (075) and the old paths removed (077, 079)
- [ ] v2 Phase 1: MCP road (092, 100), hosted sign-in (093), Notion (094), GitHub (075), AI chat (097), Connectors screen (101); joint end-to-end test
- [ ] v2 Phase 2: six MCP apps (095), custom servers (096), agents (098)
- [ ] v2 Phase 3: Outlook (099); Shopify and Gmail decided

## Log
- 2026-10-23: Surveyed the existing connection models and interviewed the owner; decisions 1–12 in `task.md`. Changes earlier decisions: decision 30 of 047 (connectors now also served over MCP), 046 design decision 3 (Slack becomes personal OAuth) and task 049 (GitHub sync retired for personal, on-demand use).

- 2026-10-23: PRD v1 written into `task.md`: problem, roles, stories, FR-1 to FR-38, data model, API sketch, phases, acceptance criteria, risks. Open questions left for the owner; FR-21 assumes MCP writes are approved in the Inbox.

- 2026-10-23: Owner answered the five open questions: MCP writes approved in the Inbox; quotas 500 reads / 50 write proposals per person and 200 reads per agent a day, admin-set under an instance ceiling; no Gmail in the Google pilot, Gmail via company Internal apps, hosted-instance CASA decided later from quotes; the Drive/Dropbox picker joins the module (checked: its client secret is stored unsealed and disconnect does not revoke); connectors easiest first, Shopify last. PRD v1.1 adds FR-39 and FR-40 and restores the connector list.

- 2026-10-28: Split into sub tasks 061–077 (Phase 0 research, Phase 1 module, Phase 2 migration), each with its FRs and dependencies; table in `task.md` §11. Phase 3 connector tasks wait for 062's ranking.

- 2026-10-28: Re-cut for two interns working independently. Track A (connections): 061, 063–067, 072, 073, 076, 077. Track B (tools): 062, 068–071, 078, 074, 075, 079. The only shared step is the contract in 063 (definition shape, schema, `resolveConnection`), written together on day 1. 072 and 077 split (new 078, 079); Slack and GitHub research moved from 061 into 074 and 075; 073 no longer waits on 071; Google setup page moved from 071 to 077. Joint end-to-end tests after Phase 1 and Phase 2 stay with this task.

- 2026-11-12: Owner planning session (in a worktree cut from `main`). Questions:
  - Whether to use MCP instead of connectors.
  - How every member connects their own account.
  - How open-source and one-click hosted installs on white-label domains avoid registering apps per domain.
  - How easily more connectors are added.

  Web research found that GitHub, Slack and Google need a registered app even through MCP; Notion and Supabase register themselves; ClickUp and Figma admit only approved clients. Recorded in section 10 of the research matrix.

  Owner decisions 18–28:
  - MCP first, built where needed.
  - Twelve first-stage apps; ClickUp and Figma dropped.
  - Stable AlianHub tool names with an allow-list and review.
  - One shared sign-in address for hosted instances, built in alianhub-cloud.
  - Personal tokens.
  - Custom MCP servers behind a new right.
  - The AI chat as a third user, with a connector named or `@`-mentioned in the chat being used.
  - One Connectors screen under AI → Customize, like Claude's.
  - Notion and GitHub as the first MCP apps.
  - Agents tick their connectors.

  Decision 22 (personal tokens) was proposed during planning and accepted with the plan as a whole.

- 2026-11-12: Owner approved PRD v2.0 and asked to start development. The v2 plan had been drafted against `main`; this integration branch already holds the built v1.1 module (061–074, 076, 078). Re-applied v2 here:
  - Decision 29: what is built stays built; Google, Slack and the Dropbox picker are not redone on MCP.
  - §2 shows what is built; §6 lists the built module; §11 re-cut with a state per task.
  - Done tasks are left as they are.
  - New: 092 (MCP client and MCP provider definitions), 093 (hosted sign-in, instance side), 094 (Notion), 095 (six MCP apps), 096 (custom servers), 097 (AI chat), 098 (agents), 099 (Outlook), 100 (sign-in for MCP apps), 101 (Connectors screen redesign).
  - 075 rewritten for GitHub through its MCP server; 079 widened.
  - Development starts with 092 on `feat/connectors-mcp-transport`.

- 2026-11-12: Built the v2 tasks on `feat/connectors-mcp-transport` (not pushed):
  - 092 MCP client and MCP provider definitions; 100 sign-in for MCP apps; 093 hosted sign-in, instance side; tool review by shape (`02cd81e8f`, `643a77c5d`, `2265374be`, `48fd937cf`).
  - 094 Notion, 075 GitHub and 095 Supabase, Upwork, Wispr Flow, Dropbox, HubSpot and Canva through their MCP servers (`6d4e2eace`). Only reviewed tools are registered (`e01086f77`).
  - 099 Outlook, 097 the AI chat, 098 agents, 101 the Connectors screen, 096 custom servers, and 077 with the Slack half of 079, each built on its own branch and merged here.
  - Migrations: 083 agent connector ticks (098), 084 the Add custom apps right (096), 085 the legacy cutover (077).
  - Open: every MCP tool waits for its shape to be pinned with a test account (`scripts/connector-tool-shapes.js`, then its AgentActions label); the hosted sign-in service in alianhub-cloud; real-account checks; the phone and keyboard pass on the screen; usage this week; hosted plan gating of custom apps; the GitHub half of 079; `api:doc` and `version:log` in the docs PR.

## Last step
Every v2 task is built and merged on `feat/connectors-mcp-transport`; waiting for the owner to review it together before anything is pushed.
