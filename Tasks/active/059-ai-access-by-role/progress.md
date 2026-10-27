# Progress: AI access by role

## Checklist
- [ ] PR 1 — rights catalogue: rows, defaults, sentinel keys, migration for existing workspaces, rights helper, matrix rows, parity fixture
- [ ] PR 2 — agent approval: approval record, `canStart` and list filters, approve/decline routes, notices, edits as candidate revisions, web states and actions
- [ ] PR 3 — agents and skills by right: create/edit/pause/delete for own agents, skill-risk cap, skill approval, reads by right, `useAgentAccess`, AGT-01 to AGT-03 tests updated
- [ ] PR 4 — everyday AI by right: Ask AI and writing help, work with agents, app connectors, connect your own AI; web entries hidden per right
- [ ] Docs PR — beta log, `npm run api:doc`, AGENTS-AND-MCP and SECURITY-PATTERNS sections
- [ ] Browser sweep as owner, admin, member with and without each right, guest

## Last step
PRD written. Waiting for the user to confirm before building.

## Blockers
None.

## Log

### 2026-10-27
- Task created from the user's request. Code surveyed: agent and AI routes, the permission evaluator and catalogue, the run gates, revisions, skill risk and the notification pattern.
- Decided with the user: defaults keep today's everyday AI and leave building, skills and seeing every agent off; an edit to an approved agent waits as a candidate revision while the approved version keeps running; skills are capped per role by risk level.
- Assumptions 7–12 in `task.md` were made without asking, and are open to correction.
- Added agent visibility with the user: Private, Shared with chosen people or teams, or Everyone. New agents start Private, existing ones read as Everyone. A private agent is seen by its creator, owners, admins and roles with Agents Read, and only its creator uses it. Every agent waits for approval, private ones included. Decisions renumbered: user decisions 1–10, assumptions 11–18.
- Added with the user: everyone who can see an agent sees who created it (`ownerId`, never editable), and who approved it.
