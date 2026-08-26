---
id: 006
title: Workspace Ask with real citations
status: active
priority: high
depends_on: []
created: 2026-08-26
---

# Workspace Ask with real citations

## Goal
Workspace Ask already returns markdown plus `{ pages: count, tasks: count }`. Product goal: answers must cite the specific pages and tasks that were used, so the UI can show clickable sources (title + id + type), like Notion AI citations.

## Scope
- Backend `answerWorkspaceQuestion` / `pageWorkspaceAsk` / `askWorkspace`: structured `data.citations` from the context pack actually sent to the LLM.
- Optional model `used` hints filtered against that pack; fall back to top N pack items.
- Keep existing permission filters (private pages, visible projects).
- Frontend WorkspaceAskPopover and Pages compose Ask (workspace chip): citation chips under the answer.
- Page citations navigate to the Pages route with `?page=<id>` when possible; tasks without a known open-route stay as labeled text with data attributes.
- Unit tests for citation shaping / `formatContextPack` extension.
- i18n keys under Projects/Header; kiln styling.

## Out of scope
- A second AI stack (must reuse `Modules/AIProjectGenerator/llmProvider`).
- Overwriting page content on Ask.
- ClickUp/Notion chrome clones.
- Live-sync, comments-on-blocks, version history.

## Acceptance criteria
- [ ] API returns real citation objects `{ type: 'page'|'task', id, title, projectId? }` for a non-empty pack
- [ ] Citations are deterministic from the pack (no invented IDs)
- [ ] Model `used` hints are filtered to the pack; empty/invalid hints fall back to top N pack items
- [ ] UI shows citation chips under the Workspace Ask answer
- [ ] Ask still does not replace page content
- [ ] Existing page-content tests stay green; new citation tests pass
- [ ] Draft PR opened for S1.1

## Constraints & notes
- Branch from PR 515 (`cursor/ai-native-pages-shell-c793`) which already has `POST /api/v2/pages/ask-workspace` and `WorkspaceAskPopover`.
- Branch name: `feat/workspace-ask-citations-27ed` (CI prefers `feat/` over `cursor/`).
- Do not commit `.env`, secrets, or firebase credentials.
