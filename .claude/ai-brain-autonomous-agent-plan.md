# AlianHub "AI Brain" — End-to-End Plan (an autonomous project agent)

**Status:** PLAN / vision — for discussion. No code yet.
**Tone:** plain language, honest, no hype.

---

## 1. What we're really building (in plain words)

An **AI project manager that lives inside AlianHub**. It watches a project, works
out what should happen next, and either does it or proposes it — across the whole
journey from "new project" to "shipped to production."

Think of it as a tireless **chief-of-staff**, not a magic black box.

**Honest reality check:** "fully autonomous, zero humans, overnight" is a myth — and
dangerous in a tool that touches real client work, money, and production. We build it
in **levels**, like self-driving cars: assist → hands-off in safe lanes → full drive.
Humans stay in the loop for the risky, can't-undo steps (production deploys, deletes,
payments) — on purpose, forever. The goal isn't "remove people," it's "remove the
busywork and let the AI run the routine so people do the judgment calls."

---

## 2. We're not starting from zero

You already have most of the foundation:

- **AlianHub's APIs** do everything an agent would need: create projects, sprints,
  tasks, comments, statuses, assignees, time logs, reports, webhooks/integrations.
- **The AIProjectGenerator engine** (plan → validate → execute, with live progress) and
  the new **"AI Assist"** (generates tasks into a project) — that is already a *mini
  agent*: it perceives (project context), thinks (the LLM plan), acts (creates the
  tasks), with a human review step.
- **Multi-provider LLM** (Claude / OpenAI / DeepSeek) is already wired in.
- **Real-time events** (Socket.io), caching, activity history, notifications.
- And the big one: **you already run your dev day through an AI agent (me).** This
  whole idea is really "productize that habit" and put it inside AlianHub for everyone.

So this is an *extension* of what's working, not a rewrite.

---

## 3. My approach: one simple loop, repeated

Every agent — me included — runs the same loop:

> **Perceive → Think → Act → Check → Remember**

- **Perceive:** read the project state (tasks, statuses, comments, deadlines, who's free).
- **Think:** ask the LLM "given this, what's the best next move?"
- **Act:** call a *safe, allowed* AlianHub action (create task, assign, comment, set status…).
- **Check:** did it work? did it break a rule? roll back if needed.
- **Remember:** log what it did and why, and learn the team's patterns.

Around that loop sit **"skills"** — focused playbooks like *Plan work*, *Assign owners*,
*Daily standup*, *Risk check*, *Release notes*. Each skill is just a prompt (a `.md`
file) plus the short list of actions it's allowed to take. One **manager brain** decides
which skill to run when.

That's the entire trick. Everything below is plumbing to make it safe and reliable.

---

## 4. What it does across your daily workflow

| Stage | What the AI does | Who approves |
|---|---|---|
| **Intake** (idea/brief) | Drafts the project + a first plan | Human approves |
| **Plan** | Breaks work into sprints + detailed tasks, estimates, sequences, flags dependencies | Human reviews (this is "AI Assist", leveled up) |
| **Assign** | Suggests/sets owners by skill + current workload | Auto within rules |
| **Execute** | Nudges stale tasks, answers "what's blocking this?", keeps statuses honest, drafts updates | Mostly auto |
| **Review** | Checks "definition of done", summarizes PRs, flags risk | Proposes; human confirms |
| **Ship** | Writes release notes, triggers the **staging** deploy, runs checks | **Production deploy stays human-approved** |
| **Report** | Daily standup summary, CEO dashboard, "what's at risk today" | Auto |

**Important fork:** the *actual coding/design* is done by people — or **handed off to
specialized coding agents** (like me / Claude Code). The brain inside AlianHub is the
**manager**: it plans, assigns, tracks, reviews, reports, and pushes the buttons. It
doesn't have to type the code itself. (More on this in Decisions, #1.)

---

## 5. The building blocks (architecture, plain)

1. **Brain** — the LLM + the reasoning prompts. The thinking part.
2. **Skill / Prompt library** — the playbooks (`.md` files). Editable.
3. **Action registry ("the hands")** — a typed, allow-listed set of AlianHub operations
   the agent may call. *Every action is company-scoped + permission-checked + autonomy-
   gated.* This is the safety boundary: the agent can only ever do things on this list.
4. **Memory** — short-term (this project's current context) + long-term (past decisions,
   "how this team works," similar past projects). MongoDB now; add semantic search later.
5. **Runtime** — what makes it run *on its own*: **triggers** (an event happened / a
   schedule fired) + a **background job runner** so it can work without someone watching
   and survive a server restart.
6. **Guardrails** — permissions, autonomy levels, an **"AI inbox"** (approval queue),
   spend limits, a **kill switch**, and a **full audit log** of every decision + action
   ("the AI did X because Y"). This is what earns trust — especially for you as CEO.
7. **Observability** — logs, cost tracking, and **undo** wherever possible.

---

## 6. Do we need external cloud services? (your direct question)

**Short answer: only one thing is truly external — the LLM API** (Claude / OpenAI /
DeepSeek), which you already use. **Everything else can stay on your own stack** (Mongo +
Node + Socket.io). That fits AlianHub's whole "self-hosted, no vendor lock-in" promise.

- **The `.md` prompts / skill files:** **No external service needed.** Two choices:
  1. Keep them in the repo (versioned, like today), or
  2. Move them into the **database with a small admin editor**, so you can tune the AI's
     behavior **without a redeploy**.
  **Recommendation:** DB-backed "Skill Library" with the repo files as defaults. (No S3,
  Notion, or third-party CMS required. Your existing Wasabi storage already handles
  uploaded briefs/files.)

- **Optional add-ons — only when you scale, not now:**
  - **Redis + a job queue** (e.g. BullMQ): for reliable background/scheduled autonomous
    runs at volume. (Start in-process with what you have; add this when it earns its keep.)
  - **A vector store** (Mongo Atlas Vector Search, or pgvector/Qdrant): so the agent can
    "recall" similar past work. Optional, later phase.
  - **An LLM-observability SaaS** (Langfuse/Helicone): nice cost/trace dashboards — but
    you can start with your own audit log + the token counting you already do.

- **Agent framework (build vs buy):** **Don't adopt a heavy framework** (LangGraph, etc.)
  yet. Your AIProjectGenerator pattern is already ~80% of an agent loop. Extend it. Keeps
  you lock-in-free and easy to reason about.

**Bottom line:** you can build the first 2–3 phases with *zero new infrastructure* beyond
the LLM key you already have.

---

## 7. Autonomy levels (how we get there safely)

- **L0 — Assist** *(today):* you click, it helps. (AI Assist.)
- **L1 — Suggest:** it proposes actions into the **AI inbox**; you approve/edit.
- **L2 — Act in bounds:** it auto-does *low-risk* things within rules (assign, nudge,
  status hygiene, reports) and proposes the rest.
- **L3 — Scheduled:** it runs on a cadence on its own (e.g. every morning: plan the day,
  flag risks, post the standup).
- **L4 — Lifecycle:** it drives a whole project end-to-end; humans only at the **gates**
  (approve the plan, approve the prod deploy).

The gates for **money / production / deletes are never removed.**

---

## 8. Roadmap (crawl → walk → run — each phase ships real value)

- **Phase 0 — done:** AIProjectGenerator + AI Assist (the demo you just saw).
- **Phase 1 — Foundations & trust:** the **Action registry** + **audit log** + **autonomy
  settings (per company)** + the **AI inbox** (approve/edit/decline). Re-route AI Assist
  through "propose → you approve." *Outcome: a safe spine everything else plugs into.*
- **Phase 2 — The daily PM agent (L2):** standup summaries, stale-task nudges, smart
  assignment, status hygiene, risk flags. Mostly automatic, all low-risk. *Outcome: the
  team feels the busywork disappear.*
- **Phase 3 — Memory + scheduling (L3):** background runs, project memory, "what changed
  / what's at risk today" each morning. *Outcome: it works while you sleep.*
- **Phase 4 — Lifecycle + integrations (L3→L4):** release notes, trigger **staging** deploy
  through your existing CI, hand coding work to external agents; **production stays gated.**
  *Outcome: idea → shipped, with humans only at the gates.*

No big-bang. If we stop after any phase, what's shipped is still genuinely useful.

---

## 9. The hard parts (and how we handle them)

- **It makes things up / wrong calls** → schema validation (we already do this), the
  preview/approval step, "explain the reason," and small *reversible* steps.
- **Runaway actions or cost** → spend caps, action rate limits, the autonomy policy, and a
  kill switch.
- **Multi-tenant safety** → every action company-scoped + permission-checked (your #1
  rule), with per-company autonomy settings.
- **Trust** → a complete audit trail ("AI did X because Y"), easy undo, and human gates on
  risky steps. It starts as an *advisor* and earns autonomy over time.
- **Can't-undo steps** (prod deploy, delete, payments) → **always** human-approved.
  Non-negotiable.

---

## 10. Decisions I need from you (then I turn this into a build plan)

1. **Scope of "doing":** Should the brain be a project **manager** (plans / assigns /
   tracks / reviews / reports / triggers deploys) that *dispatches* engineering to people
   and specialized coding agents — **or** also write the code itself?
   *My recommendation: manager first; dispatch coding to agents like me. Bundling a
   full coding agent is a separate, much bigger product — do it later, as an integration.*
2. **Self-hosted vs cloud:** Keep everything on your stack (only the LLM is external)?
   *Recommend: yes — it's on-brand and cheaper to run.*
3. **Prompts/skills home:** repo-only, or a **DB-backed editable Skill Library**?
   *Recommend: DB-backed, repo defaults.*
4. **First slice after the inbox:** daily standup/reporting, smart assignment, or
   task-planning (extend AI Assist)?
   *Recommend: AI inbox + reporting first — highest trust-per-effort, lowest risk.*
5. **Provider + budget:** which LLM (Claude recommended for quality) and a monthly spend
   ceiling for autonomy?

Once you pick, I'll write the Phase 1 build plan (Action registry + audit + AI inbox +
autonomy settings) and we start there — small, safe, shippable.
