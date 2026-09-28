# 041 — AI UX fixes from the ClickUp AI comparison

## Goal
Fix the broken AI buttons and make Ask the way into AI. This covers recommendations 1–5 of `Tasks/active/034-end-to-end-qa-programme/findings/ai-ux-comparison-clickup-2026-09-28.md`. The owner asked on 2026-09-28 to start 1 and 2, then 3 to 5.

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
4. **Ask answers inside ⌘K.**
   - Enter on the palette's Ask row sends the question and shows the answer in the palette: a short answer, with cited tasks and docs as rows you can open.
   - "Continue in Ask" opens the Ask page with the question and answer.
   - While the answer loads, Esc cancels it.
5. **Ask understands structure.**
   - Before retrieval, the question is read for a project, status, assignee ("me" or a name), due or overdue, and sprint.
   - The matching tasks, visible to the asker only, go to the model as sources beside the text passages.
   - "Which tasks in Local Smoke are overdue?" lists those tasks.
   - A held-out question set covers the structured cases.
6. **Ask is a conversation.**
   - Follow-up questions keep the thread's context.
   - The user's own threads are listed on the Ask page, private to them, and removed by erasure-by-person.
   - Answers stream in and render as sanitised Markdown with citations.
   - "Make a task" and "Copy" act on an answer.

## Out of scope
- Agents in pickers and comments (6), preview for every AI action (7), plain-language copy (8), merging the AI gates (9), and Home AI cards (10).

## Acceptance
- Failing-first tests for each slice (vitest for components; e2e where a route changes).
- Every string goes through i18n and the allowlist does not grow.
- Dark mode and 390 px checked; keyboard access and accessible names on every changed control; no regression in the axe checks.
- AI off still hides the model-driven screens (`router/ai/gate.js`), and access rules are unchanged.
