# Progress: Connectors — one tool lookup for Ask and agents, with missing ticks shown

## Checklist
- [x] One lookup, `Modules/Connectors/available.js`: `available({ companyId, userId, kind, provider, product, purpose, timeoutMs })`
  - REST and custom apps: their catalog tools on the person's connection, minus tools set to Off
  - Built-in MCP apps: the live listing of the person's connection (109), minus tools that are gone, not checkable or Off; purpose `agent` also leaves out changed tools
  - `provider` is one app or a list; filters by kind and product
  - Each app has a `status` (`ok`, `not_connected`, `not_member`, `broken`, `app_off`, `provider_off`, `unreachable`) and `leftOut` (`{ key, kind, reason }`); `unavailable` lists the apps that cannot be used now
- [x] Ask (`Modules/AI/askConnectors.js`) gets its tools only from the lookup
  - An unreachable app becomes an `unreachable` note the answer says; a connected app with every tool Off says so (`no_tools`)
  - A live tool's read is held to the `artificial_intelligence.ai_connectors` right, since it has no agent-registry entry
  - The GitHub pull request rule also matches the GitHub MCP server's `get_pull_request`
  - A second pick round: the model may answer `"more": true` when a needed call takes an id only another call returns; it is then shown READ SO FAR and picks again, within the same 3-call cap. Repeated calls are dropped.
- [x] Agents (`Modules/Agents/agentConnectors.js`)
  - `offered(companyId, userId)` uses the lookup with purpose `agent`, from the viewer's own connection, with each app's status and `leftOut`
  - `toStore` accepts a live app's tool keys (`<provider>.<server tool name>`), so a tick the server later drops is kept and shown, not lost
  - `refusalFor` now knows live keys: an unticked live tool was let through before
- [x] Runs refuse a ticked tool the app no longer offers with `tool_missing` and "Remove the tick in the agent's settings" (`toolRunner.readAdmitted`); an agent's tick check now runs before any app is asked
- [x] Agent settings (`AgentConnectors.vue`, `agentConnectorTicks.missingTicks`)
  - A ticked tool the listing no longer holds shows as Missing with its reason (gone, changed, off, not checkable) and a Remove button
  - An app that cannot be listed says why (not connected, broken, off for the workspace, unreachable)
  - A live tool shows its server's own name
- [x] i18n: 15 keys under `AgentConnectors`, backfilled; `i18n:check` and `style:check` pass
- [x] Tests
  - `tests/connector-available.test.js` (13): the lookup, filters, changed/off/gone, unreachable, agent ticks and refusal, Ask through the lookup
  - `tests/agent-connector-ticks-api.test.js` updated for the new shape
  - `frontend/tests/unit/agentConnectors.spec.js` (+3)

## Left for later
- Ask files every change as a proposal, an Always-allow write of a live MCP app included; task 110 lets that one run at once from AI chat, which is not done yet.
- Agent skills read and propose only catalog tools (`skills/readers.js`, `registry/connectorTools.js`); a live tool ticked on an agent is honoured by the runner but no skill step calls it yet.
- Agent settings list a live app's tools from the viewer's connection; a run uses the connection of the person it works for, which may list other tools.
- Not checked in a running app: the instance here has no `CONNECTORS` set.
- Rule 4: no route was added or changed (only the answer of `GET /agents/connectors` grew), so `api:doc` should not move; `version:log` goes in the docs PR after merge.

## Last step

Implementation and tests done 2026-11-19; awaiting review.

## Blockers

None.

## Log

### 2026-11-17
- Task created as a subtask of 107.

### 2026-11-19
- Checked dependencies: 109 (live listing, `CONNECTOR_TOOLS` with changed and gone) and 110 (permissions, workspace switch) are both on branch `feat/task-110-connector-tool-permissions`; work continues there at the user's choice.
- Found that after 109 the MCP apps had no catalog tools, so Ask said they were off and agent settings did not list them; the lookup fixes both.
- Tested in the running app with Supabase: Ask got Supabase's 36 live tools, but "list_extensions from supabase" needs a `project_id`, so the single pick read `list_projects` and stopped. Added the second pick round. The connected Supabase organization lists no projects, so that question still has nothing to read.
- Decision: a REST app's tools stay tickable on an agent without a connection, since they do not depend on one; a live app's need the viewer's connection to be listed.

### 2026-11-26
- Live MCP writes from Ask: a live app's write gets an approval-only registry entry when named, so Ask files it as a proposal for the connection's owner and the approval sends it once. Tested in the running app: a Notion page, a Supabase table and a GitHub repository were made after approval.
- A refused MCP write now shows the app's own reason on its approval card; a refused read still does not, since it reaches the model.
- Plan mode: the @ chips go with the sentence, and Stop ends the request (the dev proxy now passes the disconnect on, so no plan is filed after Stop).
- Plan due dates were lost because this instance's saved settings had `MCP_TOOLS_MANAGE` off, which leaves the planner the short `task.create`; the user turned it on.
