---
id: 006
title: AI-native Pages space and distinctive shell
status: active
priority: high
depends_on: []
created: 2026-08-26
---

# AI-native Pages space and distinctive shell

## Goal
Give AlianHub a first-class, AI-native Pages space next to tasks, and a visual identity that is not a ClickUp or Notion lookalike — so documents sit in the workspace as a real surface, not a buried overlay.

## Scope
- Design tokens and restyle of the main app shell (header + nav) and Pages screens.
- Workspace-level Pages route that reuses `Modules/Pages` (nested pages, companyId, JWT).
- Block editor (existing Editor.js stack) for page bodies, with HTML kept for search/share.
- AI draft / expand / summarize / outline / rewrite / ask via the existing `llmProvider` factory.
- Workspace Ask over recent pages + task titles the caller can access.
- Turn a page into tasks by reusing `AiTaskCreator` / `useAiTaskGenerator`.
- Restyle project Docs view / Pages panel with the same tokens.

## Out of scope
- Rewriting PM views (list/board/table/calendar).
- A parallel AI stack or new LLM vendor.
- Version history, comments-on-blocks, realtime CRDT editing.
- Copying ClickUp purple, Notion gray, or their IA/iconography.

## Acceptance criteria
- [x] Workspace Pages is reachable from the main nav and can create/nest/edit/save pages.
- [x] Page editor is block-based; existing HTML-only pages still open.
- [x] AI compose uses the repo's LLM provider and can write or summarize page content.
- [x] Ask answers a question about the current page without replacing it.
- [x] Workspace Ask answers from pages + task titles the caller can access.
- [x] Turn this page into tasks reuses AiTaskCreator with the page body as initialRequirements.
- [x] Header + Pages screens use the new tokens (not #2F3990 / Notion gray).
- [x] Auth, companyId scoping, and socket emit-after-mutation patterns preserved.
- [x] App frontend builds; page helper unit tests pass.

## Constraints & notes
- Extend `Modules/Pages` and `Modules/AIProjectGenerator/llmProvider` rather than forking.
- Distinctive direction: warm paper, pine ink, copper accent, serif display type, top bar (not a left purple/gray tree).
- PagesPanel stays the single editor implementation (embedded + overlay + workspace).

## Resources
- Investigation notes live in `progress.md`.
