---
id: 096
title: Connectors — custom MCP servers: added by address with a right, every tool reviewed
status: active
priority: medium
depends_on: [092, 100, 101]
created: 2026-11-12
---

# 096 — Connectors — custom MCP servers: added by address with a right, every tool reviewed

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A person with the right adds their team's own MCP server by its address, and each member connects their own account to it. Every tool is reviewed before any AI can use it.

## Scope
- New right "Add custom apps" in Security & Permissions (`Config/aiRights.js`), held by owners and admins by default (FR-52)
- The add flow from the Connectors screen's "Add custom connector" (FR-66): name and address. AlianHub then reads the server's sign-in metadata and continues with one of three sign-in kinds (FR-52):
  - the server registers itself;
  - a client id and secret, with the secret going to the secrets store;
  - personal tokens, one per member.
- Address checks: HTTPS, no private, loopback or link-local address (`safeFetch.js`), host added to the egress list on save (FR-53)
- Tool review list: every tool hidden until turned on and marked read or write; a later change hides it again (FR-54, FR-44)
- Servers on the Workspace tab: edit, remove (removing ends every connection to it)
- `CONNECTORS_CUSTOM=off` in `.env`; on hosted, a plan feature through `Modules/Entitlements` (FR-55)
- Strings via i18n; colours from tokens

## Out of scope
- Servers that sign nobody in; local (stdio) servers (056 §12)

## Acceptance criteria
- [x] Without the right, the Add button is hidden and the routes refuse
- [x] A private or plain-HTTP address is refused with the reason
- [x] A new server's tools are offered to no AI until reviewed; a changed tool hides again
- [x] Two members connect their own accounts to the same custom server and each reaches only their own
- [x] Removing the server ends all its connections
- [x] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: A — connections (getting and keeping a person's access)
- Phase 2. Depends on: 092, 100, 101
- New rights rows follow task 060 (`aiRights.mayUse()`); a new `.env` variable is described in `scripts/env-doc.meta.json`.
