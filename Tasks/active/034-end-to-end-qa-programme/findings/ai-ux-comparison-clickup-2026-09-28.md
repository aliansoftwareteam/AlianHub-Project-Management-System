# AI UX comparison: AlianHub vs ClickUp Brain (task 034, 2026-09-28)

A deeper follow-up to [ux-comparison-clickup-2026-09-24.md](ux-comparison-clickup-2026-09-24.md), covering AI surfaces only. Written against `beta` at `9f8b0ecf` (build 519).

- **AlianHub:** a code read of every AI surface, plus a live walk-through of the owner's local server (build 519, signed in as Local PM, 1440 px): AI Home, Ask, AI Inbox, AI Agents, Teammates, the task panel and the ⌘K palette.
- **ClickUp:** public sources only (clickup.com, the ClickUp feedback board and changelog, help.clickup.com via search snippets because direct fetches return 403, and 2025–2026 press and reviews). The Sources section at the end lists them. The current generation is Brain2 (June 2026), Super Agents (GA February 2026) and Brain MAX.

## Executive summary

AlianHub's AI **engine** is ahead of ClickUp's where self-hosters care:

- your own model (any OpenAI-compatible endpoint), with instance and workspace off switches;
- no per-seat credits;
- agents with an allowed-action list, autonomy levels, spend caps, traces and replay;
- an approvals inbox where every change says whether it can be undone, can be edited before approval, and has an Undo chip;
- "Why this answer" showing the exact retrieved passages.

ClickUp's own users complain about the things AlianHub already does well: agents that drift from their instructions, opaque credit burn, and not knowing what a request costs.

The AI **experience** is behind. ClickUp puts one assistant everywhere: the ⌘K bar, the sidebar, `@brain` in any comment, and agents in the assignee picker. AlianHub spreads AI over many pages, starts on a placeholder, and has dead buttons and one-shot answers. The gaps are mostly wiring and placement, not missing capability.

### Observed live on build 519

1. **The AI rail opens on a stub.** AI Home says "Coming next … nothing on this screen is wired yet". Analytics is the same stub (`router/ai/index.js`, `views/Ai/AiSoon.vue`).
2. **Ask, the real front door, sits under "Setup"** in the AI sidebar, together with Health and Audit log (`views/Ai/AiSidebar.vue:73-94`).
3. **Ask answered a basic question wrongly.** Asked "Which tasks in Local Smoke are overdue?" while Home listed 3 overdue Local Smoke tasks, Ask replied that its sources had nothing about Local Smoke. "Why this answer" showed passages from AlianHub Platform only. Ask is text retrieval: it ignores a project named in the question and cannot filter by due date, status or assignee.
4. **Asking from ⌘K doesn't answer.** The palette moves you to `/ai/ask?q=…` with the question filled in, and you press Ask a second time (`CommandPalette.vue:376`). ClickUp answers inside the bar.
5. **Contradictory agent state.** The AI sidebar says "No agents running" while the global LIVE strip shows "Daily PM is on AP-116 · Code Reviewer is on AR-1".
6. **Internal ids shown as copy.**
   - AI Inbox titles read "pr.summary: 1 change(s) on AR-1" and "brief.parse: 7 change(s)".
   - Agent cards show "L1 · SUGGEST", "brief.parse", "manual only".
   - The inbox holds 9 proposals that are 5–18 days old, with no nudge that they have gone stale.
7. **Teammates layout.** Member emails overlap the Role column. Agent rows show the "AGENT" tag where the agent's name should be.
8. **Task panel.** It offers "Write with AI", "Suggest Checklists" and an unlabeled ✦ estimate icon. There is no "Ask about this task", and agents are not in the assignee picker.

### Verified in code

- **Chat AI is dead.**
  - The header "Summarize" button emits `summarize` (`MainChatHeader.vue:20`).
  - The composer's Ask AI commands and Talk-to-text emit `command` (`MainChatComposer.vue:66-69,241`).
  - `MainChatPanel.vue` binds neither event (`:6-17`, `:69-82`).
- **AI estimate overwrites without preview.** It posts `force=true` and writes `totalEstimatedTime` directly, and the only feedback is a toast (`TaskDetailRightSide.vue:861-895`).
- **Docs compose replaces the page with no preview** (`PageComposeRail.vue:112`). **`/ai` in a comment overwrites the draft** (`TaskDetailPanel.vue:925`).
- **Agents cannot be @mentioned in a real comment or chat message.** `AgentMentionBox` only exists on the Teammates page (`AgentTeammates.vue:43-49`), yet the server's error message tells people to "mention the agent in a comment" (`Modules/Agents/controller.js:470`).
- **Ask is disabled when the model is "unpriced"** (`AskPage.vue:90,311-315`). This contradicts `router/ai/gate.js`, where a missing provider must never hide a screen.
- **Five overlapping gates**, applied unevenly: `aiUsable`, the project AI app, `planFeature.aiPermission`, the `artificial_intelligence` permission, and "model priced". With AI off, the estimate, checklist, docs Ask, "AI assist" and the rail tile still show.
- **Approvals behave three ways.** The AI Inbox is rich. The global Inbox only offers approve or decline. The "Why" button in Approvals has no click handler (`Approvals.vue:54`).
- **✦ appears on features that call no model**: the automation compiler (`AutomationsPage.vue:19`) and team standup (`TeamPage.vue:8`).
- **Only the legacy prompt sidebar streams** (`molecules/AISidebar/AISidebar.vue`, behind an icon-only toolbar button). Every newer surface waits for the full answer.

## Side by side

| Area | ClickUp (Sept 2026) | AlianHub (build 519) | Verdict |
|---|---|---|---|
| **Front door** | ⌘K AI Command Bar: search, navigate and a cited AI answer in one place. The Brain sidebar is always one click away. The Brain MAX desktop app has a global hotkey. | ⌘K palette with an Ask row that hands off to a separate page. The AI rail lands on a stub, and Ask is under Setup. | **Behind** |
| **Ask / Q&A** | A threaded chat with history ("AI Chats"), memory across sessions, and answers you turn into a task, doc or message. It reads structured task data as well as text. | Single-shot. No thread, history or streaming, and plain-text answers. Scope picker, Research depth, model picker and dictation. "Why this answer" is excellent. Structured questions fail. | **Behind** on the conversation and on structured questions, **ahead** on transparency |
| **Writing in place** | `/ai` in any editor, and Improve/Edit on a text selection. Results offer Replace, Insert below, Try again. | Description: input → clarify → preview → apply (good). Docs compose and `/ai` in comments overwrite with no preview. | **Mixed**; one pattern to copy across |
| **Task AI** | Comment summaries, `@brain` in comments, AI Fields (summary, progress, translation, action items), and bulk "fill with AI". | Automatic comment summary, write description, checklist, and an estimate that overwrites. The agent run strip is an advantage. No Ask about this task. | **On par** in scope, **behind** on consistency |
| **Agents: creating** | The Super Agent Builder chat asks clarifying questions. A template catalogue by department. Manual setup. | A 3-step wizard (template → actions → autonomy, scope, cap). Templates on an empty hub. Raw action keys and L0–L2 in the copy. | **Behind** on approachability, **ahead** on explicit scope |
| **Agents: triggering** | @mention in any comment, doc or chat; **assign a task to the agent**; DM; a schedule; an event. | "Run now" with a task picker, Routing, and a mention box on the Teammates page only. Not in the assignee picker, comments or chat. | **Behind**, and this is the biggest gap |
| **Agents as teammates** | Avatar, profile, in pickers and @lists, DM-able, in the org chart. | An AGENT tag on comments, provenance badges, a LIVE strip. A Teammates page with layout bugs. | **Behind** |
| **Approval and trust** | Approval before high-impact actions. Activity log by day, filtered by agent, user and type. Agents are **public by default**, and their private data can leak to anyone who can trigger them (ClickUp warns about this). | Proposals with a reversible flag per change, edit-then-approve, decline reasons, Undo, gate and taint banners, run traces and replay, an audit log, spend caps. | **Ahead**; this is the story to tell |
| **Automations with AI** | "Automate with AI" writes a draft rule into the normal editor (beta, uses credits). | A plain-sentence compiler with a **backtest** and a dry run, and no credits. It is marked ✦ although no model is called. | **Ahead** (fix the label) |
| **Home / reporting** | An AI StandUp card in My Tasks, AI Cards on dashboards. | No AI on Home. Dashboard AI cards are listed in the catalogue but not built. | **Behind** |
| **Meetings** | AI Notetaker for Zoom, Meet and Teams → a private Doc and action items as tasks. | Call notes in WebRTC calls only. | **Behind** (lower priority) |
| **Chat AI** | `@brain` in chat, thread summaries, a channel agent that answers from company knowledge. | Summarize and Ask AI buttons exist but are **dead**. | **Broken** |
| **Cost and control** | Per-seat add-on at $9–28 on top of the plan, with credits. Banners at 80% and 100%, then premium features lock. The model list changes over time. | Your own key or model, a spend line per agent, a month total, "Pause all". The instance and workspace switches work, but five gates confuse the off state. | **Ahead** on cost, **behind** on how clearly the off state is shown |
| **Mobile** | Brain MAX on iOS and Android (June 2026), Brain in the mobile app. | The AI tab is in the phone tab bar, but the AI sidebar is gone below 768 px, so the AI Inbox is hard to reach. | **Behind** |

## What not to copy

- **Credits and upgrade walls.** ClickUp's most-voted AI complaints are unclear credit use and features that lock mid-month. AlianHub's pitch is "your model, your bill".
- **Agents public by default.** ClickUp has to warn that private data given to an agent can leak to anyone who can trigger it. Keep AlianHub's model, where an agent retrieves only what the run's starter can see, limited to the agent's projects.
- **AI buttons everywhere.** Reviewers call ClickUp cluttered. Put one entry point in each place (⌘K, `@agent`, one ✦ menu on a task) rather than a banner in every panel.

## Recommendations (ranked)

Effort: S, M or L. Impact: H, M or L.

| # | Change | Effort | Impact | Where |
|---|---|---|---|---|
| 1 | **Fix what is broken.** Wire chat Summarize and the composer commands, or hide them. Wire the Approvals "Why" button. Make the sidebar's running count use the same source as the LIVE strip. Fix the Teammates column overlap and the missing agent names. | S | H | `MainChatPanel.vue`, `Approvals.vue:54`, `AiSidebar.vue`, `AgentTeammates.vue` |
| 2 | **Make Ask the AI home.** Route `/ai` to Ask, move Ask to the top of the sidebar, and delete the "Coming next" stub, or show the pending proposals and live runs there. Move Analytics out of the nav until it is built. | S | H | `router/ai/index.js`, `AiSidebar.vue`, `AiSoon.vue` |
| 3 | **Answer inside ⌘K.** Pressing Enter on the Ask row sends the question and shows the answer in the palette (cited keys as rows), with "Open in Ask" to continue. | M | H | `CommandPalette.vue`, `AskAnswer.vue` |
| 4 | **Ask understands structure.** Before retrieval, parse project, status, assignee, due or overdue, and sprint from the question into a scoped task query (the router already does a scoped query for the backlog read), then let the model answer over those rows plus passages. Add the failing question above as a held-out eval. | M | H | BE Ask/knowledge controller, task 019 evals |
| 5 | **Ask is a conversation.** Follow-ups in a thread, a history list in the sidebar, streamed answers, Markdown rendering, and "Make a task / Post to chat" from an answer. Reuse the legacy sidebar's streaming transport. | M–L | H | `AskPage.vue`, `AskAnswer.vue`, `molecules/AISidebar` (streaming) |
| 6 | **Agents where people work.** List agents in the assignee picker (assigning starts a run at the agent's autonomy level). `@agent` in task comments and chat triggers `startRun trigger:"mention"`. The run strip links to the run and its proposal. | M | H | `AgentMentionBox.vue`, assignee picker, `Comment` composer, `TaskAgentStrip.vue`, `Modules/Agents/controller.js` |
| 7 | **One "preview, then apply" pattern.** Give the AI estimate, docs compose and `/ai` in comments the description flow's preview with Replace / Insert / Try again / Undo. | S–M | H | `TaskDetailRightSide.vue:861`, `PageComposeRail.vue:112`, `TaskDetailPanel.vue:925` |
| 8 | **Plain-language agents.** Name skills in the UI ("Summarise a pull request", not `pr.summary`). Show autonomy as "Suggests changes" / "Acts, you approve" / "Acts". Pluralise "change(s)". Nudge proposals that have waited more than 3 days. Optionally, a builder chat that turns a sentence into the wizard's three steps. | S–M | M | `AgentWizard.vue`, `AiHub.vue:55`, `AiInbox.vue`, locales |
| 9 | **One AI availability state.** Merge the five gates into `aiAvailability` (off / unconfigured / usable / not permitted). Hide every entry point when AI is off, including the rail tile. Allow Ask when the model is unpriced. Remove ✦ from features that call no model. | M | M | `composable/aiAvailability.js`, `router/ai/gate.js`, `AskPage.vue:311`, `AutomationsPage.vue:19`, `TeamPage.vue:8` |
| 10 | **AI on Home and in dashboards.** A "Waiting on you" card (proposals and approvals) and a model-free standup card, then build the At-risk and Agent spend dashboard cards already in the catalogue. On phones, add AI Inbox to the AI tab's landing page. | M | M | `views/Home/TodayOverdue.vue`, `plugins/dashboard/cardCatalog.js:103-105`, `sidebar.css:43-61` |

Deliberately left out for now: a meeting notetaker (L; needs calendar and bot infrastructure) and a desktop hotkey app (the Electron app could add one later).

## Sources

Official ClickUp:

- https://clickup.com/brain/pricing
- https://clickup.com/brain/agents
- https://clickup.com/brain/max
- https://clickup.com/brain/enterprise-search
- https://clickup.com/blog/super-agents-launch/ (2025-12-28)
- https://feedback.clickup.com/changelog/introducing-super-agents-the-worlds-first-human-like-ai-agents
- https://feedback.clickup.com/ai-super-agents/p/super-agent-not-ready-for-primetime (2026-01-30)
- https://feedback.clickup.com/ai-super-agents/p/ai-super-credit-from-monthly-to-accumulable

Help Center articles (read from search snippets):

- https://help.clickup.com/hc/en-us/articles/37033397273111-Create-a-Super-Agent
- https://help.clickup.com/hc/en-us/articles/36926065055127-Super-Agent-privacy-security-and-permissions
- https://help.clickup.com/hc/en-us/articles/36455020912919-Super-Agents-Activity
- https://help.clickup.com/hc/en-us/articles/6533695640343-What-is-the-AI-Command-Bar
- https://help.clickup.com/hc/en-us/articles/14800632845975-Write-with-Brain-AI
- https://help.clickup.com/hc/en-us/articles/31938907279127-Use-Brain-on-task-comments
- https://help.clickup.com/hc/en-us/articles/18450100382871-Generate-task-summaries-and-updates-with-AI-Custom-Fields
- https://help.clickup.com/hc/en-us/articles/20690779238423-Build-Automations-with-ClickUp-AI
- https://help.clickup.com/hc/en-us/articles/34741383911959-Track-your-Workspace-s-ClickUp-AI-usage
- https://help.clickup.com/hc/en-us/articles/15428419095831-ClickUp-AI-models-privacy-and-security-FAQ

Third party:

- https://techcrunch.com/2025/11/04/clickup-adds-new-ai-assistant-to-better-compete-with-slack-and-notion (2025-11-04)
- https://siliconangle.com/2026/05/12/exclusive-clickup-endows-brain-assistant-agentic-capabilities/ (2026-05-12)
- https://www.zenpilot.com/blog/clickup-brain-2-review/ (2026)
- https://www.usecarly.com/blog/clickup-ai/ (2026)
- https://aipmtools.org/articles/state-of-clickup-2026 (2026)
- https://learn.g2.com/clickup-review (2026)
