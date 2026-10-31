# Progress: Connectors — generic connect, products, reconnect and disconnect handlers

## Checklist
- [x] connect/callback/complete
- [x] products + incremental consent
- [x] reconnect rules
- [x] disconnect + revoke
- [x] membership check + refresh
- [x] Tests against a fake provider

## Last step
Lifecycle built and green. Branch `feat/task-066-connectors-connect-lifecycle` off the merged 065 base; nothing committed or pushed yet.

## Blockers
None. 065 is merged into `feat/per-user-connectors`.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track A in the two-track split; depends only on its own track and the 063 contract.

### 2026-10-31
- PRD detailed before build: added the Contract (063 §5) summary, a file plan (~5–6 new, ~3 edited), and sharpened acceptance criteria. Not started.
- Recorded that 066 builds module-shaped rows and the real `resolveConnection` (incl. `getAccessToken`, `markBackoff`); the old Google/Slack paths stay until 073/077.
- Added the PR #1735 review item: drop `include_granted_scopes: 'true'` from `providers/google/index.js` (keep `access_type: 'offline'`), so stored scopes reflect only this flow's grant (FR-9/FR-10).
- Built the generic lifecycle. New: `providerApi.js` (OAuth HTTP from the definition), `connection.js` (engine, module-shaped rows via registry + `apps.resolveApp`), `connectorsController.js`, `tests/fixtures/fakeProvider.js`, `tests/connector-lifecycle.test.js`. Edited: `resolveConnection.js` (real lookup + `getAccessToken` + `markBackoff`), `routes.js` (generic routes, gated on a named registry provider), `providers/google/index.js`, the `fake` fixture (added a revoke endpoint), and trimmed the registry test's `resolveConnection` block (DB cases moved to the lifecycle test).
- All connector suites green: 15 suites / 495 tests, plus the agent-egress-callers convention. B's tool/approval tests still pass against the real `resolveConnection` (they mock the module, so the contract shape holds).
- Deferred by design: socket emit / cache clear on mutation (follows the connection screens, 072); the member-removal sweep (`endForMember` is here for 067 to call).
- Decision confirmed by the owner: keep member handlers in a separate `connectorsController.js` (Option B), mirroring the legacy `googleController.js` / `controller.js` split, rather than extending `controller.js`.
- Added two public-callback tests (the four-step flow end to end + the error/fallback paths); lifecycle test now 16 tests, all green.
- Closed three scope items that were missed in the first pass (caught on review):
  - `agentsRefused` on the four write routes (`connect`, `complete`, `products`, `disconnect`), so an agent or automation is refused; reads and the public callback are left open.
  - `connector.products_changed` audit in `setProducts` (plus words in `eventWords.js` + `en.js`, backfilled to all locales).
  - socket emit + cache clear on every mutation (connect, products, disconnect, broken) via an `announce` helper — module `connector`, key `connectors:<company>:<user>`, no token or account id in the payload; the client relay and the My-connections screen land with 072.
- Lifecycle test now 18, + the audit-event-labels and egress-callers conventions and i18n:check all green.
