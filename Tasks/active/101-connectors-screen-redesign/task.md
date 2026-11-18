---
id: 101
title: Connectors — screen redesign: AI → Customize → Connectors, like Claude's
status: active
priority: high
depends_on: [072]
created: 2026-11-12
---

# 101 — Connectors — screen redesign: AI → Customize → Connectors, like Claude's

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
One light, easy screen where a member sees their connectors, browses and connects available ones, and manages each, and where owners and admins oversee the workspace. It replaces the pages connectors are spread over today, reusing 072's built components where they fit.

## Scope
- **Place (FR-63):** the AI sidebar's **Customize** entry replaces Connections and Connect your AI. Customize has the tabs **Connectors** (default) and **Connect your AI** (the existing `ConnectYourAi.vue` moves in). The old `/connections` and `/app-connections` routes redirect.
- **Your connectors (FR-64):** logo, account label (owner only), status dot, last used. A connector that needs attention comes first, with Reconnect.
- **Browse (FR-65):**
  - Cards with logo, name, one line and category; search; category filter; Connect on the card.
  - An app this install cannot sign in to says why to members ("Your admin needs to set up Google") and links owners and admins to its setup.
- **Sign-in dialog:** OAuth (opens the app and returns), the personal-token field (100), product ticks for Google.
- **Connector detail, a side panel (FR-67):**
  - Account, products, status, usage this week.
  - The tools, with read/write labels and an on/off per tool for the member's own use; Disconnect.
  - Owners and admins also see tools to review.
- **Workspace tab, for owners and admins (FR-68):** 072's admin overview (FR-30) and company apps (FR-32) move here; also the custom servers list (filled by 096) and a link to quotas (078).
- **Add custom connector:** the button is shown to holders of the right; the flow is 096 (FR-66).
- **Remove the old pages:**
  - The connector parts of `IntegrationsHub.vue` (Calendar, Slack) and the old `ConnectionsPage.vue` layout, plus `GoogleConnection.vue`.
  - Integrations that are not connectors stay on the Integrations page (FR-38). `AppConnections.vue` goes with 079.
- **Standards:** all strings under `Connectors.*` (FR-34), tokens and `ah-` components only, usable by keyboard and screen reader, works at phone width.

## Out of scope
- Inbox approval cards and quota settings (078, built)
- The custom-server flow itself (096)
- The AI chat's connector picker (097) and agent settings (098)

## Acceptance criteria
- [x] From Customize → Connectors a member connects, ticks products, turns a tool off, reconnects and disconnects without leaving the page
- [x] A member sees only their own account labels; an admin can end a connection, but no route lets them use it
- [x] Browse search and category filter work; an app the install cannot sign in to explains why
- [x] The old routes redirect; no other page offers connector sign-in
- [ ] Usable by keyboard and at 375 px wide
- [x] `i18n:check` and `style:check` pass

## Constraints & notes
- Track: A — connections (getting and keeping a person's access)
- Phase 1. Depends on: 072 (built)
- Follow the shape of Claude's connector settings: the connected list first, then a directory to browse, one clear Add button, and a detail panel. One page, with no nested settings pages.
- No new colours (Rule 5); reuse 072's components and the `ah-` card, chip, dialog and side-panel components.
- The per-tool on/off needs a `toolsOff` list on the connection row (PRD §8); record the field in 063's contract.
