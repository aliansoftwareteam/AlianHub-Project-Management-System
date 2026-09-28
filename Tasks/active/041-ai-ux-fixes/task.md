# 041 — AI UX fixes from the ClickUp AI comparison

## Goal
Fix the broken AI buttons and make Ask the way into AI. This covers recommendations 1–10 of `Tasks/active/034-end-to-end-qa-programme/findings/ai-ux-comparison-clickup-2026-09-28.md`. The owner asked on 2026-09-28 to start 1 and 2, then 3 to 5, then 6 to 10.

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

7. **Plain-language agents** (recommendation 8).
   - Skills are named in words in the UI ("Summarise a pull request", not `pr.summary`).
   - Autonomy reads "Suggests changes", "Acts, you approve" or "Acts" instead of L0–L2, SUGGEST or GATED.
   - Counts are pluralised ("1 change", "7 changes").
   - A proposal waiting more than 3 days is marked as waiting, and the AI Inbox can sort by age.
8. **Preview, then apply, for every AI write** (recommendation 7).
   - The AI estimate, docs compose and `/ai` in a comment show their result first, with Replace, Insert, Try again and Cancel, before anything is written.
   - Undo is offered after applying.
   - The description writer's flow is the model.
9. **Agents where people work** (recommendation 6).
   - Agents the user may run appear in the task assignee picker, marked as agents; assigning one starts a run at the agent's own autonomy level.
   - `@agent` in a task comment or a chat message starts a run on that task or thread.
   - The task's agent strip links to the run and its proposal.
   - Every existing trigger and access rule still applies.
10. **AI on Home** (recommendation 10).
    - Home has a "Waiting on you" card (proposals and approvals) and a standup card built from the user's own activity without a model.
    - The dashboard's At-risk and Agent spend cards are built.
    - On phones, the AI tab reaches the AI Inbox.
11. **One AI availability state** (recommendation 9).
    - `aiAvailability` answers off, unconfigured, usable or not permitted, and every AI entry point reads it.
    - With AI off, every entry point is hidden, including the rail tile, the estimate, the checklist, docs Ask and AI assist.
    - An unpriced model doesn't block Ask.
    - ✦ marks only features that call a model.

## Out of scope
- A meeting notetaker and a desktop hotkey app (see the findings).

## Acceptance
- Failing-first tests for each slice (vitest for components; e2e where a route changes).
- Every string goes through i18n and the allowlist does not grow.
- Dark mode and 390 px checked; keyboard access and accessible names on every changed control; no regression in the axe checks.
- AI off still hides the model-driven screens (`router/ai/gate.js`), and access rules are unchanged.
