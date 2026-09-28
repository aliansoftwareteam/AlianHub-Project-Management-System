# 041 — AI UX fixes from the ClickUp AI comparison

## Goal
Fix the broken AI buttons and make Ask the way into AI. This covers recommendations 1 and 2 of `Tasks/active/034-end-to-end-qa-programme/findings/ai-ux-comparison-clickup-2026-09-28.md`. The owner asked on 2026-09-28 to start both.

## Scope (one slice and one PR each)
1. **Chat AI buttons do something.**
   - The chat header's Summarize, the composer's Ask AI commands (summarize, task, clip) and Talk-to-text are wired in `MainChatPanel.vue`.
   - A command with no working back end is hidden rather than left as a dead button.
2. **Approvals and Teammates.**
   - The Approvals "Why" button opens the proposal's reason, or links to it in the AI Inbox (`views/Approvals/Approvals.vue:54`).
   - On Agents as teammates, member emails no longer overlap the Role column, and agent rows show the agent's name.
3. **Ask is the AI home.**
   - `/ai` opens Ask.
   - Ask sits at the top of the AI sidebar, outside the collapsed Setup group.
   - The "Coming next" AI Home stub and the Analytics stub leave the navigation.
   - The sidebar's running count uses the same source as the LIVE strip, so it can't say "No agents running" while agents run.
   - Old `/ai/home` and `/ai/analytics` links redirect instead of breaking.

## Out of scope
- Answering inside ⌘K, structured Ask, and Ask threads (recommendations 3–5).
- Agents in pickers and comments (6), preview for every AI action (7), plain-language copy (8), merging the AI gates (9), and Home AI cards (10).

## Acceptance
- Failing-first tests for each slice (vitest for components; e2e where a route changes).
- Every string goes through i18n and the allowlist does not grow.
- Dark mode and 390 px checked; keyboard access and accessible names on every changed control; no regression in the axe checks.
- AI off still hides the model-driven screens (`router/ai/gate.js`), and access rules are unchanged.
