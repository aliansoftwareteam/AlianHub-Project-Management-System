---
id: 106
title: Integrations and Connectors — two places, each saying what it holds; App connections moves into Integrations
status: active
priority: high
depends_on: [101]
created: 2026-11-13
---

# 106 — Integrations and Connectors: two places, each saying what it holds

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, PRD v2.1). Decisions 30–32 and FR-37, FR-38, FR-38a and FR-63 of that PRD apply.

## Goal
Outside apps live in exactly two places that never get confused: **Integrations**, set up once for the whole workspace and running on their own, and **Connectors**, each person's own accounts that AI uses when asked. The GitHub pull-request sync keeps working, now on the Integrations page.

## Scope
- The App connections page becomes a section of the Integrations page (`IntegrationsHub.vue`): the integration list, connect, pause, disconnect, last sync and errors, and GitHub's repositories per project with its egress notice. Owners and admins manage it; other members see it read-only, as now.
- The left-bar **App connections** entry goes (`navItems.js`).
- `/:cid/app-connections` leads to the Integrations page at that section, keeping its query, so a GitHub sign-in that returns there (`?github=…`) still finishes. The redirect to Connectors from 101 is removed.
- The project GitHub card's "Set up" link (`ProjectGithubCard.vue`) opens that section.
- One line at the top of each page, pointing to the other (FR-38a):
  - Integrations: "Set up once for the whole workspace. Your own accounts for AI are under AI › Customize › Connectors."
  - Connectors: "Your own accounts, used by AI when you ask. Workspace-wide apps are under Integrations."
- An app on both sides says on its card which job it does: GitHub (pull requests linked automatically, for the workspace / your own GitHub for AI), Slack (the `/alianhub` command / your own Slack for AI), Google (calendar feed / your own Google for AI).
- Copy: no screen calls an integration a connector or the other way round. The `AppConnections.*` strings that stay are renamed where they say "App connections".
- 079's GitHub half is dropped; this task takes over its "remove `AppConnections.vue` and its route" item as the move above.
- Strings through i18n, colours from tokens, specs for the moved section, the redirect and the two pointer lines.

## Out of scope
- Any change to how the GitHub sync works, or to `Modules/Integrations` beyond the sign-in return address.
- Moving Integrations or Connectors to another menu position.
- New connector tools (for example creating a pull request).

## Acceptance criteria
- [x] The left bar has no App connections entry; the Integrations page shows the integration list and GitHub's repositories per project, and an owner or admin can connect, pause and disconnect GitHub there.
- [x] `/:cid/app-connections` and a GitHub sign-in that returns to it land on that section, and the sign-in finishes.
- [x] The project GitHub card's "Set up" link opens that section.
- [x] Each page's top line says what it holds and links to the other.
- [x] GitHub, Slack and Google cards on both pages each say which job they do there.
- [x] A member who is not an owner or admin sees the section read-only, as today.
- [x] `i18n:check` and `style:check` pass; the moved section keeps its tests.

## Constraints & notes
- Track: A — screens. Phase 2.
- `APP_CONNECTIONS` still switches the GitHub sync on; nothing about it changes.
- Builds on `feat/connectors-mcp-transport`, where 101's redirect lives.
