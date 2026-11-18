---
id: 048
title: Team agent packs — Marketing, Design, Engineering, Sales and Support
status: active
priority: medium
depends_on: [047]
created: 2026-10-08
---

# 048 — Team agent packs

Status: **plan written on 2026-10-08, confirmed by the owner on 2026-10-08 ("go with your recommendations").** This file is the PRD (Rule 2 in `CLAUDE.md`).

## Goal

A team adds a ready set of **role agents**, each working like a person in that team with a detailed skill: its role, what it is responsible for, what it needs and asks for, how it works step by step, what it delivers in AlianHub, a quality checklist, when it hands over to a human, what it never does, and the tools it uses. Four teams: **Marketing**, **Design**, **Engineering**, **Sales and Support**. Each role works first through each person's own connected AI (no server key, decision 30), and also as a template in the AI catalogue for a workspace with a server key.

The level of detail is shown in `resources/example-skill-content-writer.md` (Content Writer, Marketing).

## What exists (read from the code on 2026-10-08)

- 14 agent templates in `frontend/src/views/Ai/agentTemplates.js` (`CATALOGUE_TEMPLATES`): slug, `categories`, `skills`, `actions`, `autonomy`, `cadence`/`schedule`, `needs`, `blockedBy`. Grouped by topic (`CATALOGUE_CATEGORIES`), not by team. No instruction text of their own.
- 10 built-in skills (`Modules/Agents/skills/seeds/` and two in code), checked against `skills/catalogues.js`; admins add their own as data (`skillsController.js`).
- 5 MCP prompts in `Modules/Mcp/prompts.js` (`PROMPTS`: name, title, description, arguments, `needs`, `changes`, `text(has, args)`), offered only to a connection that may run every tool they need.
- In-product agents run on the server's model: a run needs a model key (or a personal or local account) and is paid per use.
- No notion of a team or department for agents, templates, skills or prompts.

## Scope

1. **One source per role.** Each role's skill is one written playbook in the repository (sections as in the example: who it is, responsibilities, when to use it, what it needs, how it works step by step, what it delivers in AlianHub, quality checklist, hand-over rules, never does, tools, an example). That one text is used in every place below, so the roles never drift apart.
2. **Role agents per team (to confirm with the owner):**
   - **Marketing:** Campaign Manager (plans a campaign into tasks, dates and owners), Content Writer (briefs to drafts, through review), SEO Specialist (keyword brief, on-page checklist per piece), Social Media Manager (a post set and calendar per campaign), Marketing Analyst (weekly results report from the work done).
   - **Design:** Design Lead (design briefs and review rounds), UI/UX Designer (flows, states and specs written for handoff), Design QA Reviewer (checks built work against the spec, files issues), Brand Guardian (checks pieces against the brand guide), Design Ops (handoff checklist, asset lists, open questions).
   - **Engineering:** Tech Lead (sprint plan from the backlog), Bug Triager (new bugs get priority, owner, list), Release Manager (release checklist and notes from closed work), Code Reviewer (PR summary and review notes onto the task), QA Engineer (test plan and test cases as subtasks).
   - **Sales and Support:** Sales Development Rep (lead follow-up list and next steps), Account Manager (account plan and renewal checklist), Support Agent (request triage and first replies drafted for a person to send), Support Lead (escalations and the weekly support summary), Customer Success Manager (onboarding plan per customer).
3. **For the connected AI (first).** Each role is offered as a ready-made prompt ("Work as the Content Writer on …") that carries its playbook, and as a downloadable Claude skill (a `SKILL.md` folder the person adds to their own Claude). A role is offered only when its team pack is on and the connection holds the tools the role uses. The MCP prompt rules apply (`tests/conventions/mcp-prompts.test.js`).
4. **In the catalogue (second).** A "Team" filter in `AgentCatalogue.vue` with each role as a template whose skill is the role's playbook, built as a data skill through the existing skill vocabulary (`Modules/Agents/skills/`), reusing an existing skill where one fits. Running them needs a server key, as today; the catalogue says so plainly.
5. **One-click pack.** In AI, "Team packs": pick a pack, choose the project(s); its roles are offered to connected AIs and prefilled as templates; each can be removed or edited. Nothing runs by itself on adding; scheduled roles stay off until a person switches them on.
6. **A workspace may tune a role.** An owner or admin can edit a role's playbook text for their workspace (for example the brand voice doc to read, lengths, review rules); the built-in text stays as the default and can be restored.
7. **Team workflows: the roles work together** (full design in `resources/team-workflows.md`). A handoff is a visible change on the task (status, role label, a note for the next role) that puts it in the next role's queue; set points are approval gates where a person decides. Built on the existing workflow engine (`agentRun`, `externalAgent`, `approval`, `fanOut`), the agent work queue (AI-6) and the Inbox. Ready-made workflows: Marketing campaign launch; Design request to handoff; Engineering feature from design to release; Support to Engineering customer bug; Sales new customer onboarding. Without a server key the same chain runs when a person asks their connected AI to work a role's queue; with a key the engine runs each step itself, stopping at every gate.
8. **The company view.** In AI, an org chart of teams and roles with the person who supervises each role, and a flow board of work moving between roles, what waits at a gate and what is stuck.
9. **The dispatcher: one central gate** (full design in `resources/dispatcher.md`). Every task that could go to a role agent passes it: routing rules first (task type, tags, fields, list, status, priority, project), a model guess second only with a server key and above a confidence the lead sets, otherwise a "Needs routing" list for the team lead. It checks the role is on, its tools fit, the project is not paused, places are free and cross-team rights hold; picks the least loaded agent for the role; puts the task in the role's queue with the reason shown on the task; logs every routing; offers a rule after repeated overrides but never changes rules by itself. Modes: suggest (default), apply, off. Built by extending the assignment rules engine (a rule may name a role) and the work queue.
10. **Company blueprints by industry and size** (full design in `resources/company-blueprints.md`): IT company, Manufacturing, Marketing or creative agency, E-commerce or retail, Construction, Professional services, Education, Clinic administration. Each lists departments, human roles, the agent roles beside them, starting dispatcher rules and workflows, and suggested agent roles and seats by size (small, medium, large). A blueprint picker in AI (and at sign-up) switches on the first three roles in suggest mode. Manufacturing needs about 20 more roles beyond the first 20; the other industries 5 to 10 each, many shared.
11. **Words and docs.** Every string through i18n; a guide page "Team packs and role agents" in `docs/guide/agents/`.

## Out of scope

- New MCP tools. A prompt that needs a tool that does not exist is left out and listed.
- Any change to what an agent may do (the never-list, approvals, limits stay as they are).
- Paid model use by default, and any change to how in-product agents are billed.
- Per-team permissions or roles. A pack is a set of prompts and templates, not an access rule.

## Acceptance criteria

- [ ] Every role has a full playbook with all the sections of the example, reviewed by the owner per team before it ships.
- [ ] An owner or admin turns a pack on; people whose AI is connected see that pack's roles in their AI app, only those whose tools their connection holds, and can download each role as a Claude skill.
- [ ] Each role, given one realistic request on the local build through a connected Claude, follows its playbook (asks for what is missing, delivers in the right place and form, passes its own checklist) with at most one approval: a short run sheet per pack, one request per role.
- [ ] The catalogue shows a "Team" filter with the four packs; adding a pack prefills its templates; nothing runs until switched on.
- [ ] Turning a pack off removes its prompts from the list at the next connection; templates already saved stay.
- [ ] The five ready-made workflows run end to end on the local build, once with connected AIs working the queues and once with the engine, every gate stopping for a person, and the task history showing the whole chain.
- [ ] The dispatcher routes by each rule kind, asks below the confidence, refuses a role that is off, paused, full or unfit, shows the reason on the task, and logs every routing; a person's override always wins.
- [ ] Every new string is translated through the backfill; plain-words and MCP-prompt convention tests pass.

## Size and order

XL, in six parts that each ship on their own: role skills, team packs, the dispatcher, workflows, the company view, company blueprints. Order: the 20 playbooks, Marketing and Design first, each team reviewed by the owner (M) → roles offered to the connected AI as prompts and downloadable skills (M) → the catalogue Team filter and one-click pack (M) → in-product templates as data skills (M) → per-workspace tuning (S) → the dispatcher with rules, suggest mode and the Needs routing list (L) → handoffs, queues per role and the five workflows (L) → the org chart and flow board (M) → a measured run per pack (S each).

## Open questions for the owner

1. Is the Content Writer example the right depth and shape?
2. Are the five roles per team the right ones?
3. Should a pack be on for the whole workspace (suggested), or per project?
4. Are the five ready-made workflows and their approval gates the right ones?
6. Which industries first? Suggested: IT company and Manufacturing, then Agency and E-commerce.
5. Dispatcher: start in suggest mode (every routing confirmed by the lead), and use a model guess only when a server key is set?
