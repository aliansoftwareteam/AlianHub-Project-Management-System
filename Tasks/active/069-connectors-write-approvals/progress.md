# Progress: Connectors — every outside write is a proposal only the connection owner approves

## Checklist
- [x] proposeOnly for writes
- [x] MCP proposal filing
- [x] connection_owner gate
- [x] Send-what-was-approved + single attempt
- [x] Tests

## Last step
Built on `feat/069-write-approvals`, cut from `upstream/feat/per-user-connectors` with 068 merged. All acceptance criteria met against the fake provider. Committed locally, not pushed, no PR.

## Blockers
None. `resolveConnection.js` is still the 063 stub, so a write runs only against the fake provider until track A's 066 lands.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-30
- First build on `feat/069-connectors-write-approvals` (commit `6dc41f644`), cut before 068's review fixes. That branch stays as it was; this build replaces it.

### 2026-10-31
- Rebuilt on the merged 068, on the same design:
  - Write tools (`kind: 'write'`) need a `card(input)` or the provider's tools do not load.
  - Agents: each write is a registry action, `proposeOnly` with the gate `connection_owner`. A run files it with the run's person as `connectionOwner`; the generic propose route refuses one.
  - MCP: each write sits behind `connectors:write` and is always filed; the reply says nothing was sent. Approval asks the grant or token again for the scope.
  - Gate: only `connectionOwner` approves; an owner or admin is refused and the Inbox lists the row as locked. Anyone who may decline still can.
  - Send: params and card are stored at filing on the owner's own connection. An attempt is claimed on the proposal (`sendAttempts`) before the provider is called; the answer or error stays in `delivery`. An edit is checked and saved back as pending with a new card (`reshown: true`), never sent on the same click.
- Gaps of the first build, closed here:
  - A skill could not emit a connector write: the emit catalogue did not list them, so a real run never filed one. `catalogues.js` now offers each write while its provider is on, with the tool's required params.
  - The card cut long values while the send kept them whole. A write whose card would have to cut anything is now refused at filing and at edit (`card_too_long`).
  - A provider's non-2xx answer counted as delivered, because `safeFetch` does not throw on status. The write requester now throws, so the error is what the proposal keeps. Read tools stay GET-only (068).
  - An MCP write with no connection or scope failed the call; it now answers with what to do, as a read does.
- `tests/connector-write-agent-run.test.js` runs the real graph at autonomy 0 to 3, with only the model's answer and `perform()` standing in.
- Dropped `{ virtual: true }` from the `resolveConnection` mock in both connector test files: the file exists since #1735, and in a full run the real stub answered `provider_off`.
- Windows run of unit + conventions: all 10 connector suites pass. The 16 suites that fail fail the same way on a clean checkout of `upstream/feat/per-user-connectors`, so none come from this task. `instruction-guard-patterns` and `agent-run-instruction-guard` failed once under load, pass on their own and passed in the last full run.
- Integration on the throwaway Mongo: `agent-taint`, `agents`, `mcp-tools-v2`, `mcp-tool-visibility` and `connector-settings` pass. `mcp-authorization` cannot start on Windows: its `NODE_OPTIONS` path loses its backslashes before the server boots. It is for CI; the other integration suites were not run here.
- Checked against the 063 contract and fixed: a `broken` from `getAccessToken` now reads "reconnect" on both reads and writes (section 5); `card.providerName` and the provider's name in the change label are gone, since screens name a provider through `Connectors.provider.<id>` (section 2); `not_member` no longer says "read".
- Open with track A: a write tool's required `card` is not in section 3 of the contract. Proposed in 063's `progress.md`; waits on Hetvi's agreement.
- Ran on a real server against a throwaway Mongo on port 27018, with the fake provider, the resolver and the outbound call stubbed from outside the repo: token, `/mcp` list and call, proposal, approval and send. It found a bug no unit test could: `connectionOwner` and `sendAttempts` were not on the strict `agentProposals` schema, so the owner could not approve and the send claim would not have held. Both are declared now, and a test holds that. After the fix all 15 checks pass.
- An MCP proposal cannot be edited (the existing 409, "approved or declined as filed"), so the edit path of FR-23 applies to agent-run proposals only.
- `tests/connector-write-agent-run.test.js` now goes from the real graph through the real `perform()` to the fake provider.
- Card UI stays with 078: the backend payload is `changes[].card`. The Inbox has no chip of its own for `lockedWhy: connection_owner` and shows the generic locked text until then.
