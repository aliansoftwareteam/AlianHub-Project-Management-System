# Progress: AI access by role

## Checklist
- [x] PR 1 — rights catalogue: rows, defaults, sentinel keys, migration 078 for existing workspaces, rights helper, matrix rows, parity fixture
- [x] PR 2 — agent approval: approval record, `canStart` and list filters, approve/decline routes, notices, edits as candidate revisions, web states and actions
- [x] PR 3 — agents and skills by right: create/edit/pause/delete for own agents, skill-risk cap, skill approval, reads by right, visibility (private/shared/everyone), `useAgentAccess`, AGT-01 to AGT-03 tests updated
- [x] PR 4 — everyday AI by right: Ask AI and writing help, work with agents, app connectors, connect your own AI; web entries hidden per right
- [x] Unit, convention and web test suites run and compared with a clean `staging`
- [ ] Integration tests (`tests/integration`) — need a throwaway MongoDB (`E2E_MONGODB_URL`, not port 27017); none on this machine
- [x] Local review against the demo database (owner screens and the owner's side of every approval)
- [ ] PR into `staging` — branch merged with `staging` and ready, not pushed
- [ ] Docs PR after merge — beta log, `npm run api:doc` (new routes below)
- [ ] Browser sweep as admin, member with and without each right, guest (the owner's side is done)

## Last step
Reviewed locally, two bugs fixed, `staging` merged in (agent settings tabs), task renumbered 060. Ready for the PR into `staging`; not pushed.

## Blockers
- Integration tests need a MongoDB the tests may wipe. Docker Desktop is not running here.

## Built
New routes (for `npm run api:doc` in the docs PR):
- `POST /api/v2/agents/:id/approve`, `POST /api/v2/agents/:id/decline` (owner/admin)
- `POST /api/v2/agents/:id/revisions/:n/decline` (owner/admin)
- `POST /api/v2/agents/skills/:key/approve`, `POST /api/v2/agents/skills/:key/decline` (owner/admin)

Changed rules on existing routes:
- `POST/PUT/DELETE /api/v2/agents`, pause, resume: Agents row (Read & Write); others' agents owner/admin only. A non-admin's new agent is pending; an edit of an approved one is a candidate revision.
- `GET /api/v2/agents`, team board: agents filtered by visibility and the Agents Read row.
- `POST /api/v2/agents/runs`, mention, assignment, chat: Work with agents row and the agent's visibility.
- Skills writes: Skills row; `GET /api/v2/agents/skills`: Skills Read or Agents Read & Write.
- `/api/v1/ai/*` model routes and v1 `generatePrompt*`: Ask AI row.
- Google connect/complete: App connectors row. `POST /api/v2/api-tokens/mcp` and OAuth consent: Connect your own AI row.

Database:
- Migration `078-ai-access-rules` (runs at boot unless `MIGRATIONS_AUTO=false`, or `npm run migrate`). Adds the seven AI rows to every workspace and gives each existing role the everyday AI it had; nothing is taken away. `npm run migrate -- down 078-ai-access-rules --confirm` removes only the grants it added that are unchanged.
- New optional fields, no backfill: `agents.approval`, `agents.visibility`, `agents.sharedWith`; `agentRevisions.requestedApproval`, `declinedBy`, `declinedAt`, `declineReason`, state `declined`; `agentSkills.approval`, `pendingChange`. A missing approval reads as approved, a missing visibility as everyone.

## Log

### 2026-10-27
- Task created from the user's request. Code surveyed: agent and AI routes, the permission evaluator and catalogue, the run gates, revisions, skill risk and the notification pattern.
- Decided with the user: defaults keep today's everyday AI and leave building, skills and seeing every agent off; an edit to an approved agent waits as a candidate revision while the approved version keeps running; skills are capped per role by risk level.
- Assumptions 7–12 in `task.md` were made without asking, and are open to correction.
- Added agent visibility with the user: Private, Shared with chosen people or teams, or Everyone. New agents start Private, existing ones read as Everyone. A private agent is seen by its creator, owners, admins and roles with Agents Read, and only its creator uses it. Every agent waits for approval, private ones included. Decisions renumbered: user decisions 1–10, assumptions 11–18.
- Added with the user: everyone who can see an agent sees who created it (`ownerId`, never editable), and who approved it.
- Branch moved from `main` to `staging` and renamed `feat/ai-access-by-role` (the pre-push hook needs `<type>/<kebab>`).
- Built in four commits: `289de4cb7` catalogue and migration, `49dff9ef9` backend approval/rights/sharing/everyday AI, `10e11cd51` web screens, then test and doc follow-ups.
- Deviation from `task.md`: waiting agents are listed at the top of the AI hub for owners and admins, and every request and answer is a bell and Inbox notice; they are not added to the Inbox approval queue, which only holds agent proposals. The AI token limit stays readable from a project's own rules (only the new `ai_` rows are company-wide), to keep the permission parity fixture's existing case.
- The notice code of OAuth client approvals moved to `Modules/Inbox/helpers/workspaceNotice.js` and is shared with agent approvals.
- Test results, compared with a clean checkout of `origin/staging` on this machine:
  - Backend unit: 1,179 files, 31,664 tests. 10 files fail in the full run. 8 fail on `staging` too (api-doc, upload-routes-order Windows paths, demo-team-seed file mode, visual-core, build-info, process-guards, role-prompts, knowledge-file-ingest worker crash). knowledge-task-changes and instruction-guard-patterns failed only under load and pass alone. upload-routes-order also had one failure from this work (the Ask AI check before the transcription upload), fixed by updating its table.
  - Conventions: 6 files / 26 tests fail, identical to `staging` (ai-core-boundary, ci-e2e-shards, plain-words line endings, retired-flags, role-playbooks, style-check line endings). audit-event-labels failed from this work and passes after the new keys got their words.
  - Web: 733 files, 11,604 tests. 15 files fail; 13 fail on `staging` too (token, phone and dark-mode specs, i18nProductionMessages, editorMarkup). appWithoutWorkspace and taskOverlayHeadings time out only under load and pass alone. accountTokenRenew and googleConnection failed from this work (their stores had no AI rows) and pass after the fixture update.
  - New tests: `tests/ai-access-rules.test.js` (23), `tests/agent-access-by-role.test.js` (37), `frontend/tests/unit/agentAccessByRole.spec.js` (15), plus cases added to the Google connection, MCP grant and token form tests.
  - i18n check, style check: pass.
- Local review against the demo database (its companies are all public now, so only TechNova, owner screens only, nothing saved): the seven AI rows were added to TechNova with the grants of migration 078 and a snapshot to undo them; the server ran with migrations, cron, the agent engine and email off.
  - Bug found and fixed: the rules schema in `utils/mongo-handler/schema.js` dropped `switchOnly` and `riskField`, so in every workspace the four everyday rows offered None/Read/Write and "Skills an agent may use" never showed its risk levels (Write stored `true`, read as any risk). Both flags are now in the schema; a test in `tests/ai-access-rules.test.js` checks every field an AI row is saved with survives the schema.
  - Checked as owner: Security & Permissions (simple and advanced), AI hub chips, agent settings with "Who can use this agent" and the people picker, the New agent wizard (Private by default, "Create agent" for an owner), the skill library. Every AI request answered 200.
  - Open question: migration 078 and the new member defaults switch on the Artificial Intelligence section for members, which `staging` left off on purpose; it also gates the AI entry of the project toolbar.
- Tested end to end with the demo owner account in TechNova, with requests set up as from the member Leo Martins (two new agents, an edit of an approved agent, a skill), then removed again:
  - A waiting agent: hub list "3 requests wait for your approval", "Created by" line, "Waiting for approval" banner; a run is refused with 409 even for the owner; Approve shows "Approved by … on <date>".
  - Decline: the button stays off without a reason and the API answers 400; with a reason the agent shows "Declined by" with it, and Run now is off in the hub.
  - A waiting edit: "A change from Leo Martins waits for approval", the approved version keeps running; Approve makes revision 2 live.
  - A waiting skill: chip and Approve/Decline in the skill library; Approve turns it on.
  - Owner's own agent: Private by default, works at once, sharing with one person saved as a live revision, deleted by typing its name.
  - Matrix: Agents Read and skill risk "Low risk" saved for Member as `false` and `1`.
  - Bug found and fixed: no approval notice was ever saved, because `workspaceNotice.sendNotice` left out the `uniqueId` the notifications schema requires (the OAuth client approval notices on `staging` have the same gap). The row now carries one; `tests/workspace-notice.test.js` checks a notice against the real schema. After the fix Leo got both notices and his bell went up.
  - Cleanup left TechNova as before: agents, revisions, skills, runs, notices, bell counts and the 99 rules match; 7 audit rows of the decisions stay, since the audit chain must not be edited.
  - Related tests after both fixes: 98 files (2,297 tests) and 87 schema, rules and migration files (1,435 tests) pass.
- Renumbered to 060: `staging` took 059 for the agent settings tabs. Merged `origin/staging` (3 commits): the settings page is now tabbed, so the approval panel sits above the tabs, "Who can use this agent" sits on the Projects tab (and marks it unsaved), and an agent's maker gets the Save bar ("Submit for approval") and the Delete tab; History stays owner/admin. Two cases added to `agentSettingsTabs.spec.js`.
- Test results after the merge, compared with a clean `staging` on this machine:
  - Backend unit and conventions: 1,210 files, 32,095 tests. 18 files fail: 15 fail on `staging` too (the 9 unit and 6 convention files listed above); company-create-half-made, knowledge-task-changes and instruction-guard-patterns time out only under load and pass alone.
  - Web: 734 files, 11,623 tests. 15 files fail, the same set as before the merge (13 fail on `staging` too; appWithoutWorkspace and taskOverlayHeadings only under load).
  - i18n check and style check pass.
