# Progress: Connectors — agents use connectors: ticked on the agent, declared as reads in skills

## Checklist
- [x] Connectors on the agent record, saved and validated through the agent routes
- [x] Existing agents keep working (migration 085)
- [x] Enforced on the server: reads, write proposals, and the filing guard
- [x] Connectors section in agent settings
- [x] Connector read step in skills and the skill editor
- [x] Gather step runs it on the right person's connection
- [x] Tests; i18n backfill and checks

## Last step
Built on `feat/connectors-agents` from 02cd81e8f; all acceptance boxes ticked. Not pushed. The GitHub box is met by the rule, which is the same for every app, and was tested with the fixture apps: GitHub's own provider comes with its own task.

## Blockers
None.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decision 28). Track B.
- Branch `feat/connectors-agents` cut from 02cd81e8f (the connector module plus the MCP transport).
- Agent record: `connectors: [{ provider, tools }]`, declared in the strict schema. New agents get `[]` from the create route and `agentRecord`; `PUT/POST /api/v2/agents` validate the list (`Modules/Agents/agentConnectors.js` `toStore`): an app or tool this server does not load is refused with 400, ticks are stored sorted without repeats, an app with no tool left is dropped. `connectors` is one of the revision `RUN_FIELDS`, so a run pins it and a member's change to an approved agent waits for an owner or admin like any other edit.
- Enforcement (the same rule, `agentConnectors.refusalFor`, in each place):
  - Reads: `toolRunner.read` with `via: agent` refuses an unticked tool before the connection is looked up, with `agent_not_allowed` on the connector audit row. The skill reader passes the run's ticks (`graph` → `orchestrator.gather` → `compile.gather` → `readers`); nothing passed means nothing ticked.
  - Writes: `effectiveActions`/`narrowChanges` leave an unticked connector write out of what a run proposes, with the reason on the proposal; `proposals.create` hands `fileChanges` a `refusalOf` check for an agent's own filing, so a caller that skips the narrowing is refused and audited too.
  - Refusal words: "This agent is not allowed to use <App>. Tick it in the agent's settings.", or "This agent may use <App>, but not this tool. …" when the app is ticked without that tool.
- Skill step: a refused connector read (not ticked, not connected, broken, product not ticked, a cap) fails its step. A gather step may say `optional: true` (connector reads only; the validator refuses it elsewhere): the run goes on and the template sees `{{gather.<name>.failed}}` and `.reason`. Without it the run is skipped with the reason as its outcome. Any other error still fails the run.
- Scheduled runs, checked: an agent schedule (`schedules/reportRun.js`) starts as the schedule's owner and reads no connector; a skill run started by a rule, on a timer or not, acts as the rule's owner (`runAgent` → `ruleOwner`), a workflow step as the run's starter. The connector call takes `actor.userId`, which is always the run's `startedBy` and never `agent.ownerId`. `tests/agent-scheduled-connector-owner.test.js` fires a timed rule for an agent made by someone else: the read, the token and the write proposal are all the schedule owner's; with no connection of theirs the run stops with "Connect …", though the creator has one.
- Migration `085-agent-connector-ticks`: for every agent without the field, ticks the connector tools its named skills read in gather steps or propose in emits. A skill is resolved as a run resolves it (the workspace's live copy, else the built-in seed or code skill), so an agent on the Slack summary keeps `slack.channel.read` and `slack.message.post`. The write is conditioned on the field still being absent, so a second run, or an agent saved meanwhile, is left alone.
- Settings: a Connectors tab (`AgentConnectors.vue`, logic in `agentConnectorTicks.js`), shown when the workspace offers an app or the agent has ticks. Each offered app with its turned-on tools from the new `GET /api/v2/agents/connectors`; ticking an app ticks its reads, writes are ticked one by one and labelled "each one approved first"; tools the agent's skills use are marked; ticks on an app not offered now are kept and listed with Clear. Read-only for anyone who may not edit the agent; a member's save goes for approval. Revision history shows the ticks as words.
- Skill editor: the reader list is grouped (this workspace, the web, one group per connected app); a connector step gets `SkillConnectorRead.vue` for its own settings (never `connectionId`) and the "Carry on without it" switch.
- Shared connector files changed: `Modules/Connectors/toolRunner.js` (the `agentConnectors` check in `read`), `Modules/Connectors/writes.js` (`refusalOf` in `fileChanges`), `Modules/Connectors/tools.js` (`failed` and `reason` reserved as read field names). `connection.js`, `apps.js`, `registry.js` and `providerApi.js` are untouched.
- Existing tests whose agents read or propose through a connector now tick it (connector-tools, -tracking, -google-tools, -google-read-run, -google-agent-run, -slack-tools, -write-agent-run, -write-approvals).
- Tests: new `connector-agent-ticks` (12), `connector-agent-ticks-mcp` (3, the notesmcp MCP fixture), `agent-scheduled-connector-owner` (3), `agent-connector-ticks-api` (15), `migration-agent-connector-ticks` (5); vitest `agentConnectors.spec.js` (15). All `connector-*` suites (483 tests before the new ones) and all 135 `agent-*` suites pass, as do the registry, never-list and permission catalogue tests. The whole unit project in four shards: 32,022 tests, 17 failing in 9 files that fail on this machine without the change (api-doc, upload-routes-order, demo-team-seed, visual-core, build-info, process-guards, role-prompts, knowledge-file-ingest segfault, and ai-connection, whose fixed token date has passed). Conventions: 477 pass, `plain-words` "baseline is stored sorted" fails on CRLF as before. Frontend: the 17 spec files that touch the changed views pass (301 tests, agent settings, tabs, save patch, skill editor, declared reads, revision diff and history among them); the full run's failures are the known phone-token, path and child-process specs. `i18n:check` and `style:check` pass; `npm run i18n:backfill` filled the 20 new keys.

## Decisions
- Empty means none, unlike `allowedActions` (empty = every action): the PRD says nothing is ticked by default, and failing closed is the safe reading of a missing field.
- The ticks live in the revision snapshot, so ticking a connector is an edit like any other: live at once for an owner or admin, waiting for approval for a member.
- Reads are refused inside `toolRunner`, where every agent read enters, so the connector audit row records it; writes are dropped where the run narrows its changes (the proposal says why) and refused again at filing.
- An approved write already filed is not checked against the ticks again: the connection's owner approves exactly what goes out.
- MCP clients and detached filings (the daily look, Ask plans) act for a person, not for a workspace agent, and are not held to agent ticks.
- A required connector step that is refused skips the run with the reason (it used to fail it with the runner's code), the same way a missing input does; `optional` lets the skill carry on.
- The migration ticks every skill named on the agent, on or off, since its owner already chose them; only tools this server loads are ticked.

## Open
- Skills an automation rule or workflow step names for an agent without the agent listing the skill are not seen by migration 085; such a run is skipped with "Tick it in the agent's settings" until someone ticks it.
- `docs/API.md` and `docs/api/openapi.json` gain `GET /api/v2/agents/connectors` in the docs PR after merge (Rule 4).
- Migration number 083 is the next free one on this base; renumber if another branch takes it first.
