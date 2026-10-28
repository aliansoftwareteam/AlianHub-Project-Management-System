---
id: 062
title: Connectors research — matrix and ranking for the new connectors and Gmail
status: backlog
priority: medium
depends_on: []
created: 2026-10-28
---

# 062 — Connectors research — matrix and ranking for the new connectors and Gmail

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Give the owner the facts to order Phase 3 (easiest first) and to decide on Gmail for the hosted instance.

## Scope
- Matrix rows for HubSpot, ClickUp, Notion, Upwork, Outlook (Microsoft Graph, multi-tenant, tenant admin consent), Supabase (Management API or project data), Canva, Figma, Shopify, Wispr Flow
- Wispr Flow verdict: any API or export, or dropped
- Gmail: restricted scopes, verification steps, current CASA lab quotes
- Final ranking for Phase 3 by build effort and app-review time

## Out of scope
- The four pilot and migration providers (task 061)
- Building any connector

## Acceptance criteria
- [ ] Every listed connector has a matrix row with a verdict and reason
- [ ] A ranked Phase 3 order with Shopify last
- [ ] Gmail CASA quotes from at least two labs, with dates
- [ ] Owner accepts the matrix and the order (recorded in 056 progress)

## Constraints & notes
- Depends on: nothing; can start now
- After the owner accepts the ranking, create one task per connector (one provider definition plus its tools each), and one for Gmail once its production path is decided.
