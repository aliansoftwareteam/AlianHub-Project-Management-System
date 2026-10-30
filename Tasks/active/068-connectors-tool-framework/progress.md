# Progress: Connectors — tool framework: one definition registered for agents and MCP

## Checklist
- [x] Tool definition + validation
- [x] Agent registry registration
- [x] MCP registration + scopes
- [ ] Connection resolution (against the contract's stub; the real resolver comes with 063)
- [x] Read caps, taint, egress
- [x] Tests

## Last step
Read path built and committed locally; `tests/connector-tools.test.js` passes 13/13. Not pushed.

## Blockers
None. 063's code (provider registry, `resolveConnection`) is not on this branch yet; built against the contract through one seam file.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-29
- Moved to active. Plan, all files track B's under the 063 contract:
  - `Modules/Connectors/tools/load.js`: loads `providers/<id>/tools.js`, checks each tool against its definition, skips a bad one with one log line.
  - `Modules/Connectors/tools/connection.js`: the one seam to track A. Calls `resolveConnection.js` once it exists, else the contract's stub (`provider_off` / `not_connected`).
  - `Modules/Connectors/tools/run.js`: resolves the caller's own connection, checks the reserved `connectionId`, the scope (naming the product to tick), the input, per-read and per-run caps; provider calls only to the definition's `egressHosts` through `agentFetch`; text only, taint kind `connector`, no web fetch after.
  - Agents: registry group `Modules/Agents/registry/connectorTools.js`, one reader per read tool in the skill catalogue.
  - MCP: `Modules/Mcp/connectorTools.js`; scopes `connectors:read` and `connectors:write` on the consent screen.
  - Write tools are loaded and checked here but registered in 069 (approvals).

### 2026-10-30
- Built as `Modules/Connectors/tools.js` (load and check), `Modules/Connectors/toolRunner.js` (one read for agents and MCP) and `Modules/Connectors/tools/connection.js` (the seam), with a fake provider under `tests/fixtures/connectors/`.
- Fixed: an agent's reader dropped `connectionId` because the catalogue did not declare it, so someone else's connection id was never refused. The reader now declares it and the runner refuses it.
- Full unit + conventions run on Windows: 55 suites also fail on a clean checkout of this branch (missing bcrypt binary, backslash paths, `git init` to `nul`), so none come from this task. `instruction-guard-patterns` failed once under load and passes on its own.
