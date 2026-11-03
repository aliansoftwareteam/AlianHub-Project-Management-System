---
id: 060
title: AI access by role — per-role AI rights in Security & Permissions, owner/admin approval for agents and skills
status: active
priority: high
depends_on: []
created: 2026-10-27
---

# AI access by role — per-role AI rights in Security & Permissions, owner/admin approval for agents and skills

## Goal
Owners and admins keep full control of AI. Every other role gets AI rights that an owner or admin sets per role in Settings › Security & Permissions, the way project rights work: Read lets a person see something, Read & Write lets them do it. An agent or skill built by anyone other than an owner or admin waits for an owner or admin to approve it, and cannot run until then. Each agent is private, shared with chosen people or teams, or open to everyone. AI settings stay with owners and admins.

## What is there today
- Everything about agents is hard-wired to owner/admin (`canManageAgents` in `Modules/Agents/access.js`, `isOwnerOrAdmin` in `frontend/src/views/Ai/agentAccess.js`): create, edit, pause, delete, skill authoring, builder, schedules for others, policies and settings. No role can be given any of it. This was locked down on purpose by AGT-01 to AGT-03 (task 034), after members and guests could create and edit agents.
- Everyday AI has no role control at all. Any member, guests included, can use Ask AI and the writing help (`Modules/AI/routes.js`) and create an MCP token for their own Claude (`ApiTokens/controller.js:113`). Any non-guest can chat with agents and connect a Google account. `GET /api/v2/agents` and the skill library list every agent and skill to anyone.
- The matrix already has an **Artificial Intelligence** section (`utils/data.js` `importCompanyRules`). It holds only "Per User Token Limit", which is enforced in the web app only.
- Agents have no approval state, only `paused` (`utils/mongo-handler/schema.js:1194`). Every run path goes through `runs.canStart` (`Modules/Agents/runs.js:67`), and four lists filter on `paused: {$ne: true}`.
- Revisions already have `draft → candidate → live`, and only owners/admins promote (`Modules/Agents/revisions.js`).
- Every skill carries a risk of `low`, `medium` or `high` (`Modules/Agents/skills/validateSkill.js` `riskOf`).
- No agent is private. Every live agent is offered to anyone who can open the task (`triggers.js` `runnableAgents`, `chatAgents.js` `usableAgents`), and the agent's `projectIds` are the only limit.

## Decisions
From the request:
1. Owners and admins can do everything, always. They never wait for approval.
2. Every agent submitted by anyone else goes to owners and admins for approval. Any one owner or admin may approve it; it runs only after that.
3. AI settings stay owner/admin only and are not in the matrix: the AI on/off switch, provider keys, routing policy, budgets, the workspace and project agent policies, project limits, the project manager agent, pause-all, team packs, role playbooks, the Slack workspace connector, GitHub repos, OAuth clients and external agent session endpoints.

With the user, 2026-10-27:

4. **Defaults keep today's AI.** Roles keep the everyday AI they have now (Ask AI, writing help, working with live agents, connecting their own apps and their own AI). Building agents, writing skills and seeing every agent start off. In a new workspace, guests start with nothing.
5. **An edit to an approved agent waits for approval.** It is saved as a candidate revision. The agent keeps running on its approved version until an owner or admin approves the edit.
6. **Skills are set by risk level per role.** One setting per role decides the highest skill risk an agent built by that role may use: none, low, up to medium, or any.
7. **An agent is Private, Shared with chosen people or teams, or Everyone.** New agents start Private. Existing agents become Everyone, so nothing changes for anyone.
8. **A private agent is seen by its creator, owners and admins, and roles with Read on Agents.** Only its creator uses it.
9. **Every agent waits for approval, private ones included.**
10. **Everyone who can see an agent sees who created it.** The creator is the agent's `ownerId`, which is set once when the agent is made and cannot be edited. Agents made by the product (built-in agents, team packs) show "Built in" instead. An approved agent also shows who approved it and when.

Assumed (say if any is wrong):

11. AI rights are company-wide, like `settings.*` keys. A project's own rules never change them.
12. A declined agent or skill goes back to its creator with the reason. The creator can edit it and send it again. Nothing is deleted.
13. An approved agent still never does more than the person behind it may do (`Modules/Agents/permissions.js` `holderMay`). Approval does not widen that. When someone uses a shared or public agent, it acts with that person's rights, and an app connector uses that person's own connection, never the creator's.
14. Agents that exist today were all made by owners or admins, so they count as approved. A missing approval state means approved, and a missing visibility means Everyone, so no agent data is migrated.
15. A person always sees and manages their own agents. Without Read on Agents they see only those, the agents shared with them or open to everyone, and agent work on tasks they can open (proposals and runs, as today).
16. The skill-risk setting is checked when someone who is not an owner or admin saves an agent. Lowering it later does not change agents already approved.
17. Widening who can use an agent waits for approval like any other edit. Narrowing it takes effect at once.
18. Owners and admins see and manage every agent, but a private agent is not offered to them to use. A shared agent is offered to the people named and to whoever is in a named team when they use it, so joining or leaving a team takes effect at once.

## The rights
New rows under Artificial Intelligence. Rows marked *switch* only have off and on, which the matrix stores as `null` and `true`; Read on them means nothing, so the matrix shows a switch in both modes.

| Row (key) | Read | Read & Write | New workspace: Member | New workspace: Guest |
|---|---|---|---|---|
| Ask AI and writing help (`ai_assistant`) | *switch* | Use Ask AI, the AI sidebar, writing help, summaries, transcription, meeting notes and notes-to-tasks | on | off |
| Work with agents (`ai_agent_use`) | *switch* | Mention, assign, chat with and start the live agents shared with them or open to everyone, on tasks the person can open | on | off |
| Agents (`ai_agents`) | See every agent, private ones included, what it is running and its run history | Also build agents and edit, pause, resume and delete their own. A new agent and every edit wait for approval | off | off |
| Skills (`ai_skills`) | See the skill library | Also write skills. Each new skill and each edit waits for approval | off | off |
| Skills an agent may use (`ai_skill_risk`) | selection: None, Low, Up to medium, Any | — | None | None |
| App connectors (`ai_connectors`) | *switch* | Connect their own accounts (Google today, the connectors of task 056 later) for AI to use | on | off |
| Connect your own AI (`ai_external_clients`) | *switch* | Connect their own Claude, ChatGPT or other AI client over MCP | on | off |
| Per User Token Limit (`per_user_generate_limit`) | unchanged | | | |

Existing workspaces: a migration repairs the catalogue, then grants each existing role what it can do today. Ask AI and writing help, and Connect your own AI, go to every role, guests included. Work with agents and App connectors go to every role except guests. Agents, Skills and Skills an agent may use stay off for every role but owners and admins. A role an admin has already set is left alone, so the migration can run twice.

## Scope

### Rights catalogue (PR 1)
- The rows above in `utils/data.js`, with `artificial_intelligence.` added to the company-wide prefixes in `Config/permissionGuard.js` `isCompanyWideKey`.
- Defaults in `memberDefaults.js`, the new keys in `reconcileRules.js` `SENTINEL_KEYS`, and a migration for existing workspaces as described above.
- One server helper reads a caller's AI rights. It returns `none`, `read` or `write` per row and the skill-risk cap. Owners and admins get everything. Agents and API tokens are judged as the person behind them, as `evaluatePermission` already does.
- Matrix: names and descriptions through i18n, switch rows, the risk selection, and the same plan gating as today's AI section. Rows added to `tests/fixtures/permissionParity.json`.

### Agent approval (PR 2)
- Agents get an `approval` record: state (`pending`, `approved` or `declined`), who asked and when, who decided and when, and the reason. It is added to the strict schema.
- A pending or declined agent cannot run. `runs.canStart` refuses it with code `awaiting_approval`. The lists that filter paused agents leave it out (`triggers.js:54`, `chatAgents.js:71`, `AssignmentRules/dispatcher/queue.js:36`, `AIProjectGenerator/planSplit.js:30`). Schedules, workflows and automations are covered through `canStart`.
- `POST /api/v2/agents/:id/approve` and `/decline`: owner or admin, in a signed-in session only. Decline needs a reason. The first decision wins and a second answers 409.
- Owners and admins get a bell and Inbox notice when an agent or edit is waiting. The creator gets one when it is decided. The notice code is shared with OAuth approvals (`OAuthServer/approvals.js` `notifyManagers`) instead of being copied a third time.
- Edits by someone who is not an owner or admin to an approved agent become a candidate revision. Approving promotes it through the existing promote. Declining keeps the live version and marks the revision declined. Edits to a pending agent stay pending.
- Every submit, approval and decline is written to the agent audit.
- Web: "Created by" with the creator's name and avatar on agent cards, the agent page, pickers that offer an agent, and every approval notice and queue row. "Approved by" with the name and date on the agent page. Today only the Teammates page shows the creator (`AgentMemberRow.vue`).
- Web: "Waiting for approval" and "Declined: reason" on agent cards and the agent page. Approve and decline on the agent page. The waiting agents in the Inbox approval queue for owners and admins. New Inbox notice types in `renderNotice.js`.

### Agents and skills by right (PR 3)
- Create, edit, pause, resume and delete check the Agents row instead of owner/admin. Someone who is not an owner or admin may only edit, pause, resume and delete agents they own, and their agents start pending.
- The skill-risk cap is checked when such a person saves an agent. A skill above it is refused with 400 naming the skill.
- Skills: writing a skill checks the Skills row. A skill from someone who is not an owner or admin is saved pending and cannot be attached or run until approved, by the same flow as agents. Approve and decline routes are added for skills.
- Reads: `GET /api/v2/agents`, the team board, run lists and the skill library check Read. Without it a person gets only their own agents and what they see today on tasks they can open.
- The owner/admin-only gates in decision 3 stay as they are.
- Visibility: agents get `visibility` (`private`, `shared` or `everyone`) and `sharedWith` (`userIds`, `teamIds`), added to the strict schema. Teams are read from `assigneeUsersArray` when the agent is used. Every list that offers agents to use filters by it: `runnableAgents`, `usableAgents`, the mention list, the dispatcher queue and plan split. `startRun`, mention, assignment and chat refuse an agent the person may not use. `GET /api/v2/agents` and the agent page show an agent only to whoever decisions 8 and 15 allow. Shared names only active members and existing teams.
- Web: `useAgentAccess` reads the rights. The agent builder and settings get a "Who can use this agent" choice of Private, Specific people or teams, and Everyone, with a people and team picker. Agent cards show which one applies. New agent, the builder, the skill editor and pause show per right. "Submit for approval" replaces "Create" for people whose work waits.
- The AGT-01 to AGT-03 regression tests are updated: a role without the right is still refused, and a role with it gets a pending agent.

### Everyday AI by right (PR 4)
- Ask AI and writing help check `ai_assistant` on every `Modules/AI` route and the v1 `generatePrompt*` routes.
- Mention, assignment, chat and `POST /api/v2/agents/runs` check `ai_agent_use`.
- Google connect checks `ai_connectors`. MCP token creation and the OAuth consent answer check `ai_external_clients`.
- Web: the buttons and entries for each hide when the role lacks the row. The AI nav item hides when the person has no AI right at all.

## Out of scope
- Putting AI settings in the matrix (decision 3).
- Per-project AI rights.
- Enforcing Per User Token Limit on the server. Today only the web app checks it. Proposed as a follow-up.
- Re-reviewing approved agents when a role's skill-risk setting is lowered.
- The personal connectors module of task 056. This task adds only the right its screens will check.
- Handing an agent to a new owner, for example when its creator leaves the workspace.
- Approval of workflows and automations themselves. They cannot start a pending agent, because `canStart` refuses it.

## Acceptance criteria
- [ ] The matrix shows the new rows. Owner and admin columns stay fixed. A change persists and takes effect on the next request.
- [ ] A new workspace seeds the defaults in the table above.
- [ ] After the migration, every role in an existing workspace keeps today's everyday AI, and only owners and admins can build agents, write skills or see every agent. Running the migration twice changes nothing.
- [ ] A member with Agents write creates an agent and gets 200 with state `pending`. Owners and admins get a notice. The agent cannot run by any path: manual start, mention, assignment, chat, schedule, workflow, automation or dispatcher.
- [ ] An owner or admin approves it and it runs, and the creator is told. Decline with a reason tells the creator, who can edit and send it again. Two approvers at once: the second gets 409.
- [ ] A member edits their approved agent. The live agent is unchanged until an owner or admin approves the edit. A declined edit leaves the live version running.
- [ ] A member without Agents write gets 403 on create. A member with it gets 403 editing someone else's agent and 403 approving. A token or agent gets 403 approving.
- [ ] A member without Agents Read sees only their own agents and those shared with them or open to everyone, in the hub and in `GET /api/v2/agents`.
- [ ] A private agent is seen by its creator, owners, admins and roles with Agents Read, and nobody else. Only its creator can mention, assign, chat with or start it; anyone else gets 403 and does not find it in any picker.
- [ ] An agent shared with a team is offered to that team's members and nobody else. Someone added to the team gets it at once, and someone removed loses it at once.
- [ ] An agent open to everyone is offered to every role with Work with agents. When a member uses it, the run acts with that member's rights and connections, not the creator's.
- [ ] Changing an approved agent from Private to Everyone waits for approval. Changing it from Everyone to Private takes effect at once.
- [ ] Existing agents read as Everyone, and the people who use them today still can.
- [ ] Every agent card, agent page, agent picker and approval notice shows who created the agent. A built-in agent shows "Built in". An approved agent's page shows who approved it and when.
- [ ] A member whose cap is Low gets 400 saving an agent with a medium-risk skill. With Any, the agent saves as pending.
- [ ] A member with Skills write writes a skill. It saves pending, and no agent can attach or run it until it is approved.
- [ ] A role without Ask AI gets 403 on the AI routes, and the web app hides the AI entries. With it, everything works as today.
- [ ] A role without App connectors gets 403 on Google connect. A role without Connect your own AI gets 403 creating an MCP token.
- [ ] Everything an owner or admin did before still works, with no approval step. AI settings are still owner/admin only.
- [ ] `npm run i18n:check`, `npm run style:check`, unit and integration tests pass. `npm run api:doc` runs in the docs PR. A browser sweep is done as owner, admin, a member with and without each right, and a guest.

## Constraints & notes
- Four PRs into `staging`, in order 1 → 2 → 3. PR 4 needs only PR 1 and can run alongside 2 and 3. Conventional Commit titles: `feat(ai): ...`.
- Rule 3: every new string goes through `en.js` and `npm run i18n:backfill`. Rule 5: colours from tokens only.
- A new permission key goes in three places: `utils/data.js`, `memberDefaults.js` and `SENTINEL_KEYS`. Otherwise existing workspaces never get it.
- The catalogue repair rewrites the rules collection, so it runs only from a migration, before the server listens (`migrations/003-permission-catalogue.js`).
- `setByPerson` and `agentsRefused` are not role checks. The role check belongs inside the handler, next to the existing `callerOf`.
- `.claude/AGENTS-AND-MCP.md` and `.claude/SECURITY-PATTERNS.md` get a short section on AI rights.

## Resources
- None yet.
