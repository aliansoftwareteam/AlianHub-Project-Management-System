# Progress: Connectors — shared sign-in for hosted instances: the instance side

## Checklist
- [x] `resources/service-contract.md` (for the alianhub-cloud work)
- [x] Signed envelope state and the service callback on hosted instances
- [x] Forwarded code accepted; complete step
- [x] Exchange, refresh, revoke through the service
- [x] Service-down handling
- [x] Fake service and tests
- [ ] The service itself in alianhub-cloud (`docs/tasks/connector-sign-in/`, with its PR)

## Last step
Instance side built and tested on `feat/connectors-mcp-transport`. It works once the service exists and the platform sets the five variables on hosted instances.

## Blockers
The service (alianhub-cloud) is not built yet.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decision 21). Track A. The service itself is cloud work in the alianhub-cloud repo.
- Built:
  - `Modules/Connectors/hostedSignIn.js`: on when `HOSTING_MODE=managed` with `CONNECTOR_SIGNIN_URL` (https), `INSTANCE_ID` and a 32+ character `PLATFORM_API_KEY`. It offers the providers in `CONNECTOR_SIGNIN_PROVIDERS`.
    - Every request is signed: HMAC-SHA256 of `timestamp.path.body` with the platform key, plus `X-Instance-Id` and `X-Timestamp`. It goes straight through `safeFetch`, not the workspace egress list, since the service is the platform's own.
    - `GET /v1/apps` gives each provider's client id and service callback, cached ten minutes.
    - `wrapState` puts the instance's own signed state inside an envelope the service checks with the instance's key.
    - `exchange`, `refresh` and `revoke` go to `/v1/token` and `/v1/revoke`.
  - `apps.resolveApp`: company app → shared service (hosted) → instance app → registered client. A service that cannot be reached is `service_unreachable` (503).
  - `registry.signIns`: `oauth` also when the service offers the provider.
  - `callbacks.redirectUri(provider, app)` answers the service's callback for a hosted app.
  - `connection.js` wraps the state and uses the app's callback for a hosted app.
  - `providerApi` sends token calls for a hosted app to the service and reads the answer as the provider's own (`answerError` included); revoke goes through the service for a hosted connection.
- `resources/service-contract.md`: the variables, request signing, the three routes, the error codes, and the browser's way through the service. The service never takes the instance address from the request; it uses its own instance list.
- Tests: `tests/connector-hosted-sign-in.test.js`, 9 tests against a fake service that checks every signature, all passing. They cover: offered with no instance app; the consent address carries the service's app, callback and a verifiable envelope; connecting through the service with no request to the provider and no app secret on the instance; a foreign state refused; refresh and revoke through the service; service down at sign-in (503) and at refresh (call fails, connection stays connected); off hosted, the service is never used.
- All 94 connector, MCP and migration suites: 3,440 of 3,442 passed in the parallel run. The two that failed, `mcp-conversations` and `mcp-manage-work`, were 5-second timeouts under load; both pass run alone (735 tests).
