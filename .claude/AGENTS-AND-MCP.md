# Agents and MCP

**[← Back to main guide](../CLAUDE.md)**

How an AI agent changes things in AlianHub, and how to add one more thing it can do.

An agent here is one of two kinds. A person's own AI app (Claude, ChatGPT) connects over MCP. Or an agent that AlianHub runs inside the product. Both go through the same code. Every agent acts as a person: it sees what that person can open and changes what that person may change.

Code lives in `Modules/Agents/` (the rules) and `Modules/Mcp/` (the MCP server and its tools). For the person using it, read `docs/MCP-AGENT-GUIDE.md`. For the plan behind it, read `Tasks/active/047-ai-run/task.md`.

---

## The one road a change takes

Every agent change takes the same road. There is no second road.

1. **Tool call.** The agent calls a tool at `POST /mcp` (`Modules/Mcp/server.js`). `tools/call` runs `call()` in `Modules/Mcp/tools.js`.
2. **Who is calling.** `authenticate()` in `server.js` finds the token, the company and the person. The company must be named in the request and must match the token. The person must still hold a seat. This is checked on every call.
3. **Scope.** `scopeRefusal()` in `tools.js` checks the token's scope or grant. `Modules/Mcp/scopes.js` maps each tool to one scope.
4. **Registry entry.** Every tool names one action in the registry (`Modules/Agents/registry.js` and the group files in `Modules/Agents/registry/`). An action that is not in the registry does not exist for an agent. `registry.evaluate()` is the one check.
5. **The target is visible.** `Modules/Mcp/visibility.js` builds what the person may open. A write names its target (`tool.target`), and `assertWritable()` refuses a target outside it.
6. **The one rule: `ask()`.** `ask()` in `Modules/Agents/projectPolicy.js` is the only place a project's rule for agents is applied. It answers one of three things:
   - `act`: the change runs now.
   - `propose`: the change waits for a person.
   - `refuse`: the change does not happen.

   `ask()` only holds an agent back. It never grants what the registry, the person's permissions or the never-list refuse. A project where agents are paused refuses every agent write (`Modules/Agents/projectLimits.js`).
7. **Act or propose.** In `tools.call`, a held change is filed with `propose()` (`Modules/Mcp/propose.js`). A change that may act goes to `perform()` (`Modules/Agents/actions.js`). `perform()` asks again before it runs anything, so a caller that skips step 6 still meets it.
8. **Refuse.** A refusal is thrown as `RefusedError`, written to the audit log, and sent back to the agent as `refused: true` with a reason.
9. **Execute.** `perform()` checks the registry, the permissions of the person behind the agent (`Modules/Agents/permissions.js`), the target, and `ask()`. Then it looks up `executors[action]`, opens an audit row, runs the executor, and marks the row applied with its undo.
10. **Audit row.** `Modules/Agents/agentAudit.js`. A row is `pending` while the executor runs, then `applied` with its undo, or `failed`. A refusal gets its own row (`recordRefusal`).
11. **Undo.** `Modules/Agents/undo.js` reads the undo the executor left on the audit row and runs its inverse as the person who pressed Undo.

### A proposal and its approval

A change that waits is a proposal (`Modules/Agents/proposals.js`). It says what, why, and the exact changes. Each change is a registry action with its params.

- It is filed with `proposals.create()`. Every change in it must pass `registry.evaluate()` first.
- It shows in the Inbox. The card that says what will change is built by `Modules/Agents/intentPreview.js`.
- A person approves, declines, or undoes it at `POST /api/v2/agents/proposals/:id/approve`, `/decline` and `/undo` (`Modules/Agents/routes.js`, `decide()` in `Modules/Agents/controller.js`).
- A decision needs a signed-in person. `personDecides()` in `Modules/Agents/personDecides.js` refuses any token and any agent. A proposal that came over MCP cannot be edited at approval.
- For a proposal that came over MCP, approval asks again (`Modules/Mcp/approval.js`): is the token still live, may the approver make this change, can the approver and the original person still open what it touches.
- Approving runs each change through `perform()` with `approved: true`. Each one gets an audit row and an undo.
- A proposal can be undone for 15 minutes (`UNDO_WINDOW_MS` in `proposals.js`). A single audit row can be undone inside the company's undo window, 24 hours by default (`undoHours` in `Modules/Agents/budget.js`).
- No MCP tool approves, declines, undoes or keeps a standing approval. `tests/agent-decision-routes.test.js` checks this.

### Other things that can hold or shape a change

- **Autonomy levels** for in-product agents: `AUTONOMY` in `registry.js` and `Modules/Agents/policy.js`.
- **Standing approval** (`Modules/Agents/standingApprovals.js`): "always do this" for one kind of change, one connection, one project, 90 days. It only turns a held change into `act`. It never covers a status change, a `proposeOnly` action, a high-risk action, an action that cannot be undone, or one that reaches further than one task.
- **Outside content** (`Modules/Agents/taint.js`, `Modules/Mcp/taintHold.js`): with `AGENT_TAINT_ROUTING` on, risky writes from an outside client wait for a person.
- **Daily look** (`Modules/Agents/manager/`): rules find slipping, blocked, stale and unowned work and file proposals. It changes nothing itself.
- **Per-project limits and pause**: `Modules/Agents/projectLimits.js`.

---

## How to add a new agent action or MCP tool

Do the steps in order. Each step names the file and the test that guards it. Read one finished example first: goals. See `Modules/Agents/registry/goals.js`, `Modules/Agents/goalRequests.js` and `Modules/Mcp/goalTools.js`.

### 1. Registry group file

Add a file in `Modules/Agents/registry/`. Do not edit `registry.js`. Every file in that folder is loaded by name (`Modules/Agents/registryGroups.js`).

The file holds:

- `ACTIONS`: one entry per action with `key`, `label`, `risk` (`RISK.LOW`, `MEDIUM` or `HIGH`), `undoable`, `write`, `cost`, and `permission`. A `constraint` text says what the action may never do.
- `RATINGS`: one rating per action, built with `read(SCOPE.x)` or `write(SCOPE.x, reversible)` from `Modules/Agents/registryKit.js`. `scope` is `task`, `project` or `workspace`.
- `module.exports = group(flag.enabled, ACTIONS, RATINGS)`.

`permission` names the Security & Permissions catalogue entry that governs the same thing for a person (`Config/permissionGuard`). It must match `/^[a-z_]+\.[a-z_]+$/`. An action without one cannot be registered. A string maps the whole action. `{ key, write }` pins the level. `{ byField }` maps each field of an edit. `{ anyOf }` takes any one of several keys.

For an action that must always wait for a person, set `proposeOnly: true`. Add `gate: 'owner_admin'` when only an owner or admin may approve it.

Tests that must pass: `tests/agent-registry-groups.test.js`, `tests/agent-actions-rated.test.js`, `tests/agent-never-list.test.js`, `tests/agent-permission-catalogue.test.js`.

### 2. The flag

Put the new group behind a flag, and keep it off by default. Reuse a flag that fits: `Modules/Mcp/dataFlag.js`, `manageFlag.js`, `workFlag.js`, or `Modules/Agents/performanceFlag.js`. A new flag is a file that reads one variable on every call and defaults to `off`, like `workFlag.js`.

For a new variable, describe it in `scripts/env-doc.meta.json` and run `node scripts/env-doc.js`. To check: whether a new flag needs a line in the `FLAGS` list of `tests/agent-registry-groups.test.js`.

### 3. The executor

An executor is a function in the `executors` map of `Modules/Agents/actions.js`. The map is built by spreading the executors of several files: `taskRequests.js`, `pageRequests.js`, `workRequests.js`, `goalRequests.js` and `manager/workQueue.js`. Put a new executor in a `*Requests.js` file and spread it in. `workRequests.js` already spreads its own sub-files.

An executor receives `{ companyId, actor, params, depth, approvedBy }` and returns `{ result, undo, entityType, entityId, entityName }`.

The executor runs the web app's own handler as the person. It does not write to the database on its own. The handler holds the rules, the history, the events and the notices.

- `whoOf(actor)` in `taskRequests.js` gives the person and the mark.
- `asRoute()` in `taskRequests.js` runs a task action the way `PATCH /api/v2/tasks` does.
- `answerOf()` in `goalRequests.js` calls a route handler with no HTTP around it.
- A handler that answers `status: false` becomes a refusal (`DeterministicError`).
- Run the handler inside `runAs(who.mark, ...)` (`Modules/Agents/actingAgent.js`), so history and events are marked as the agent.

Tests: write one that runs the executor as a person who may and a person who may not, and one that checks a target the person cannot open.

### 4. The tool

Add a tool definition in a `Modules/Mcp/*Tools.js` file. `goalTools.js` is the model. A tool has:

- `name` and `action` (the registry key).
- `description`: plain words.
- `input`: a JSON schema. Set `strict: true` and `additionalProperties: false` so unknown arguments are refused.
- `visibility`: `'filtered'` (the tool reads or names a target through the caller's filter) or `'none'` with a `visibilityReason` of at least 20 characters.
- A read tool has `run(ctx, args, vis)`. A write tool has `params(args)` and `target(args)`. `target` names the task, project, list or page so `assertWritable()` can check it. A write tool that needs a grant has `grant` or `filedUnder`.

Then register it in `Modules/Mcp/tools.js`. A new `*Tools.js` file must be added to `offered()` and `registered()` there. A tool added to an existing file, such as `workTools.js`, needs no change in `tools.js`. A tool is offered only while its action is in the registry, which means its flag is on. See `offered()` in `workTools.js`.

Add the tool's scope. A read maps to a `*:read` scope. A write maps to `tasks:write`, `time:write` or a manage grant. Put it in the file's `SCOPES` and make sure `scopeForTool()` in `Modules/Mcp/scopes.js` reaches it.

The `ACTIONS` list in each `Modules/Mcp/*Flag.js` names the actions that flag adds. Keep it in step with the group. Code reads `manageFlag.ACTIONS` (`grantOfAction()` in `manageTools.js`). To check: whether code reads the other three lists.

Tests that must pass: `tests/conventions/mcp-tool-visibility.test.js`, `mcp-tool-scopes.test.js`, `mcp-tool-annotations.test.js`, `mcp-prompts.test.js`, and `tests/mcp-instructions-prompts.test.js`.

### 5. The preview card

A change that can wait needs a card that says what will change. Add a builder to `BUILDERS` in `Modules/Agents/intentPreview.js`. A change with no builder has no card. The builder names a project, list, person or field only when the viewer may see it. Everything else on a line is the proposal's own text, sent as text.

The web side turns each line into words in `frontend/src/components/molecules/IntentPreview/intentLines.js`. A new kind of line is one more entry there. Its text goes through i18n (Rule 3 in `CLAUDE.md`).

Tests: `tests/inbox-intent-preview.test.js`, `tests/inbox-setup-preview.test.js`.

### 6. Undo

Every write that can be undone leaves `undo: { kind, ... }` on its audit row. `undo.js` runs the inverse that has the same `kind` in its `inverses` map. A kind without an inverse is not undoable.

- Add the inverse to `inverses` in `Modules/Agents/undo.js`, or export `inverses` from your `*Requests.js` file and spread it in, as `projectSetup.js` does.
- The inverse runs as the person who pressed Undo, through the web handler.
- Say in `targetVisible()` how the person who undoes it proves they can open what it touched. A new kind needs a line there.
- Set `undoable` in the registry entry to match. The rating's `reversible` follows it.

Tests: `tests/agent-undo-window.test.js`, `tests/agent-audit-mark-undone.test.js`, `tests/inbox-bulk-undo.test.js`.

### 7. The wording agents are told

Tool names in `Modules/Mcp/instructions.js` and `Modules/Mcp/prompts.js` are written in backticks and only for a connection that is offered the tool. A new tool needs a line there only if agents need to be told when to use it. Keep `instructions.js` under `MAX_LENGTH` (4000 characters) for every mix of flags and callers.

### 8. Run the tests

```bash
npx jest --selectProjects conventions
npx jest tests/agent-registry-groups.test.js tests/agent-actions-rated.test.js tests/agent-never-list.test.js
npx jest tests/mcp-instructions-prompts.test.js
```

Also run the tests you wrote. After you merge a change that adds a route, follow Rule 4 in `CLAUDE.md`.

---

## Rules a new slice must keep

These are the rules in `Tasks/active/047-ai-run/task.md`, as the code keeps them.

1. **Every write is previewed and can be undone.** A write sets `undoable` and leaves an undo on its audit row. A change that waits shows a card built in `intentPreview.js`; a kind of change with no builder there has no card. To check: whether every write that can wait has a builder. With `MCP_TOOLS_V2` on, a write rated not reversible, or workspace-wide, is filed for approval (`isDestructive()` in `Modules/Mcp/annotations.js`).
2. **Outside writes are propose-only.** A Slack message is `proposeOnly` with `gate: 'owner_admin'` (`Modules/Agents/registry/connectors.js`). An agent never sends it on its own. Mark any new action that sends something outside AlianHub `proposeOnly`.
3. **The never-list stays absent.** `NEVER` in `registry.js` is: `project.delete`, `task.delete`, `billing.*`, `deploy.production`, `git.merge`, `member.remove`, `permissions.edit`, `status.set("Done")`. Never add a registry key that matches it. `indexActions()` throws if you do. Closing a task exists only as `task.status.change`, for a connection with the manage grant, and a project can still make a person close it.
4. **An agent never does more than its person.** Every action names a `permission`. `perform()` asks `permissions.holderMay()` for the person behind the agent. Every write names its target so `visibility.js` can check it.
5. **Every query and every event names the workspace.** Queries go through `MongoDbCrudOpration(companyId, ...)` with the company as the first argument. Take the company from the request header with `tenantOf(req)`, never from the body or query. Every event payload carries `companyId`. `tests/conventions/tenant-scoping.test.js` and `tests/conventions/socket-events-name-company.test.js` check this.
6. **A decision needs a signed-in person.** Approve, decline, undo of a proposal, and standing approvals use `personDecides()` or `decidedByPerson()` (`Modules/Agents/personDecides.js`), or `isSignedInSession()`. Any new route that decides something an agent proposed must use it. Never add an MCP tool that decides.
7. **Tool text is plain words.** Tool descriptions, refusal messages, preview lines and instructions use the words a project manager uses. Say list, not sprint, in text a person reads. Do not put internal names, setting names or ids in it. The instruction text outside backticks must not use these words: flag, scope, token, grant, oauth, mcp, json, api, payload, endpoint (`tests/mcp-instructions-prompts.test.js`). Screen text in the locale files follows `scripts/plain-words.js`.
8. **`instructions.js` has a length limit.** `MAX_LENGTH` is 4000 characters. A line that names a tool is kept only for a connection that may run the tool.
9. **`taskMongo` mixin methods are callable by name.** `PATCH /api/v2/tasks` and `POST /api/v2/tasks/bulk` call `taskMongo[action]` with the action named in the body (`Modules/Tasks/routes.js`). Every method on the mixins in `Modules/Tasks/helpers/taskMongo/` is therefore a route. A helper does not go there. Put helpers in their own file. A method that does go there needs a permission mapping in `Config/taskWritePermissions.js`, which `tests/permission-task-write-keys.test.js` checks.
10. **Nothing is auto-approved by default.** Project policy defaults: `done: approval`, `connected: single_task` (`DEFAULTS` in `projectPolicy.js`). A standing approval exists only where a person made it, and can be ended.
11. **Budgets refuse before the model is called.** Where AlianHub pays for the model, `Modules/Agents/spendGuard.js` stops a run before any tokens are used.
12. **No web fetch after a connector read.** A run that read a connector fetches nothing from the web afterwards (`taint.js`, `Modules/Agents/connectors/`).

---

## Flags

All are off by default. Each is read on every call, so a flag that is off leaves the registry, the ratings and the tool list as they were.

| Variable | Where it is read | What it turns on |
|---|---|---|
| `MCP_TOOLS_DATA` | `Modules/Mcp/dataFlag.js` | Read tools for projects, lists, docs, time; `comment.create`, `timelog.create` |
| `MCP_TOOLS_MANAGE` | `Modules/Mcp/manageFlag.js` | Task and doc management tools, for tokens with `tasks:manage` or `docs:manage` |
| `MCP_TOOLS_WORK` | `Modules/Mcp/workFlag.js` | Tags, relations, lists, doc comments, goals, setup, project create, automation, queue |
| `MCP_TOOLS_V2` | `Modules/Mcp/v2Flag.js` | Names beside ids, paged lists, annotations, approval for calls that cannot be undone |
| `AGENT_PERFORMANCE_READ` | `Modules/Agents/performanceFlag.js` | `performance.read` |
| `CONNECTORS` | `Modules/Agents/connectors/flag.js` | Slack and Google Calendar connectors |
| `AGENT_TAINT_ROUTING` | `Modules/Agents/taint.js` | Risky writes after outside content wait for a person |
| `MCP_OAUTH` | `Modules/OAuthServer/config.js` | Sign-in for outside MCP clients |
| `EXTERNAL_AGENT_SESSIONS` | `Modules/AgentSessions/config.js` | Hand a task to an approved outside agent |

The full list with defaults is in `docs/ENV.md`. `MCP_TOOLS_WORK` also lists its actions in `Modules/Mcp/workFlag.js`.
