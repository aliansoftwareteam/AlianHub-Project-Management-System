# Progress: Redesign stage 4

## Checklist
- [x] Data model: provenance of Done, agent action registry, agent runs, proposals, spend, accounts
- [x] AI Hub, AI Inbox, agent settings, wizard, skill library (audit log page still the existing one)
- [x] Agents as teammates, AI fields, NL automations, connections, Ask, Team page, Planner v2 — routes `AgentTeammates`, `AgentRouting`, `AiAsk`, `Connections`, `ExternalData`, `PeopleDirectory`, `Planner` all registered and reachable from the AI sidebar / rail
- [x] MCP server + PAT scopes + CLI setup snippet + personal accounts (27a–d: `AiAccounts`, `AccountAttribution`, `AgentIdentity`)
- [x] Pipeline surfaces, release & deploy (28a, 28c: `AiPipeline`, `AiRelease`); agent picker via `AgentMentionBox`
- [ ] Provenance badge and filter in List, Table and Board, with the 29c rollup wired to `GET /api/v1/agile/provenance`

## Last step
Verified remaining on 2026-09-10: acceptance 5 (provenance badge and filter in List/Table/Board) is unmet — the filter and rollup components were added by d3229ad5 but never mounted, then deleted by the dead-code purge. Everything else verified. See the log.

## Blockers
None.

## Log

### 2026-09-03
- Task created.

### 2026-09-03
- Backend landed: `Modules/Agents/{registry,actions,guard,runs,proposals,undo,accounts,agentAudit,controller,routes}`, `Modules/Tasks/helpers/completion*`, `Modules/Mcp/{tools,brief,server,routes,init}`.
- MCP: JSON-RPC 2025-06-18 over POST /mcp, bearer PAT, 10 tools. `GET /mcp/manifest` is public and secret-free. Unauthenticated calls get 401.
- `task.get` returns a brief (goal, acceptance criteria parsed from the description, relations, links, linked docs, thread digest, and the "you may not" boundary) — not a row.
- Verified against the registry: Done / Complete refused; In progress and In review allowed; task.delete, project.delete, deploy.production, git.merge, billing.*, member.remove, permissions.edit all refused because they are absent, not switched off.
- Frontend: `views/Ai/{AiHub,AiInbox,AgentSettings,AgentWizard,SkillLibrary,AiSidebar,useAgents}` + routes `AiHub`, `AiInbox`, `AiSkills`, `AiAgent`. The rail's AI item appears now that the route exists.

### 2026-09-10 — verified remaining
Checked against origin/beta (64f4f507). Everything else verified. Acceptance 5 — provenance badge
AND filter in List, Table and Board — is unmet:
- d3229ad5 (PR #525) added `molecules/Provenance/{ProvenanceFilter.vue,ProvenanceRollup.vue,useProvenanceFilter.js}`
  but never mounted them, so 013's dead-code purge (fea895db) deleted all three.
- TableView has no provenance at all; the `Provenance.filter_label/opt_*/legend_*/rollup_*`
  locale keys are orphaned; the 29c rollup backend `GET /api/v1/agile/provenance` has no
  frontend caller.

Remaining: rebuild and mount the provenance filter and rollup.
