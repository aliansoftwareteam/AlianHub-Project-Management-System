# ClickUp AI hands-on (task 034, 2026-09-28)

I looked through ClickUp Brain² and Super Agents directly, in the owner's signed-in workspace, and only read. I created nothing and sent no prompts, so no credits were spent. This complements the public-source write-up in [ai-ux-comparison-clickup-2026-09-28.md](ai-ux-comparison-clickup-2026-09-28.md). No workspace data is reproduced here.

## What ClickUp shows

- **Brain² home** (`/ai/brain`):
  - The same Ask / Agents tabs as AlianHub's Ask page.
  - The prompt reads "Type your request: I'll search, answer, or build it for you", and cycles to "Plan, Build, / for skills, @ for context".
  - Controls: `+` to attach context and files, a Skills menu ("Create skill: package your expertise into a reusable skill"), a model picker ("Best models": Brain² Max, GPT-6 Luna and Gemini 3.8 Flash, each with Auto, plus Show more), and a microphone for Talk to Text.
  - Starter cards: Project Update, New Task, Find Work (urgent pending items), Email Draft.
- **Memory** ("Brain Memories & Preferences"):
  - Nickname, role, "My Preferences" (tone, style, working preferences) with an on/off switch.
  - "Bring your memories from another AI": copy a prompt into ChatGPT, Gemini or Claude, then paste the answer back.
- **Agents tab**:
  - "Start from scratch" opens a single prompt: "What should your new teammate work with you on?", with example personas.
  - Connectors with "Superpowers": ClickUp (300+), Gmail, Google Calendar, Drive, Slack, GitHub.
  - A catalogue by category:
    - Project management: Status Reporter, Project Manager, Priorities Manager.
    - Personal productivity: Daily Briefer, Personal Assistant, @Mentions Digest, Meeting Prep.
    - Task management: Triage New Tasks, Approval Manager, Field Filler, Work Breakdown.
    - Executive: Executive Assistant, Follow Up on Everything, Morning Coffee.
    - Scheduling: Deadline Tracker, Schedule Manager, Meetings Manager, Team Scheduler.
    - Product and engineering: Sprint Planner, Release Notes, PRD Writer.
    - Meetings: End of Day Recap, Daily Meeting Prep, Meeting Scheduler, Action Extractor.
    - Intelligence: Wiki Upkeep, Project Intelligence, Expert Intelligence, Topic Intelligence.
    - Research: Task Insights, Web Researcher, Competitive Intel Research, Fact Checker.
    - Digests and updates.
  - "Certified" agents are built and maintained by ClickUp staff.
- **Task view**:
  - A Brain² bar under the title: "Ask Brain² to estimate this, suggest next steps or research this", plus "Ask AI about this task".
  - The editor toolbar offers "improve content with AI" and "create task with AI" from a selection, and an empty description offers an AI template.
  - The activity composer reads "Mention @Brain to create, find, ask anything".
  - An **AI Assignee** popover per list: a plain-sentence rule per person, a fallback, Suggest prompts, "Autofill when tasks are created" and "Auto update when tasks change". AlianHub's answer is task 041 slice 12.

## Where AlianHub stands (build 608)

| ClickUp | AlianHub | Gap → slice |
|---|---|---|
| Ask / Agents home, model picker, dictation | Ask page with Ask/Agents, model picker, dictation, threads, streaming, structured questions | On par |
| Memory and preferences, import from another AI | Project memory for agents (task 017); nothing per user for Ask | 043.1 |
| Starter cards, `/` skills, `@` context, "build it for you" | Skills popover, a scope picker, Make a task on one answer | 043.2 |
| Ask about this task, suggest next steps, research this, improve or create from a selection | AI estimate (preview), write description, suggest checklist, `/ai` in comments | 043.3 |
| Agent catalogue by category, conversational builder | A 3-step wizard; templates only on an empty hub | 043.4 |
| Daily Briefer, Deadline Tracker, digests (scheduled) | L3 agents may be scheduled, but nothing runs schedules | 043.5 |
| AI fields and Field Filler | Fixed AI columns in Table (summary, risk, category); no AI field type | 043.6 |
| AI Assignee | none | 041.12 |
| Gmail, Calendar, Slack, GitHub superpowers | Connections page, MCP, GitHub for code agents | Later, per connector |

## What not to copy
- Credits.
- "Certified" agents maintained by the vendor.
- Agents being public by default.
