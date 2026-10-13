# 036 — ClickUp parity: command palette, task navigation, self-hosted AI, inbox snooze

## Goal
Close the four highest-value gaps found in the UX comparison with ClickUp (`Tasks/active/034-end-to-end-qa-programme/findings/ux-comparison-clickup-2026-09-24.md`, top 10 items 1, 3, 5 and 2), chosen by the owner on 2026-09-24.

## Scope (one slice and one PR each)
1. **Command palette (⌘K).** Opens with Cmd+K on macOS as well as Ctrl+K; navigation and search are not plan-gated (paid gating stays only on features that are paid); results carry type chips (tasks, projects, docs, people), each result's location and age, per-row actions (open, open in new tab, copy link, Ask AI) and a footer hint; results stay filtered by the caller's permissions.
2. **Task detail navigation and quick actions.** Previous/next arrows and `j`/`k` to move through the list the task was opened from; copy-ID in the header; a quiet action row (add subtask, relate, checklist, attach); empty fields shown as "Empty" and edited in place; one-click complete next to the status.
3. **Self-hosted AI endpoints.** Any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, a company gateway) can serve chat and embeddings through a configurable base URL and model names; an instance-level and a workspace-level "AI off" switch; clear UI when no provider is configured.
4. **Inbox snooze and cleared.** Server-stored snooze ("Later") with a return time and presets; a Cleared tab kept 30 days; Clear all; an "Other" tab for updates from items the user only watches; keyboard shortcuts for clear and snooze.

## Out of scope
Saved views, favourites, task templates, threaded comments, the migration wizard and the remaining top-10 items (later slices); a ClickUp importer.

## Acceptance
- Each slice ships with failing-first tests (unit and, where behaviour crosses the API, integration), i18n for every string (allowlist stays empty), dark mode and 390 px checked with screenshots, keyboard access and accessible names.
- No regression in the axe checks added by #944.
- Access rules unchanged: search results, inbox items and AI calls stay limited to what the caller may see.
- Slice 3 keeps working with no AI provider configured and never sends data to a provider when AI is off.
