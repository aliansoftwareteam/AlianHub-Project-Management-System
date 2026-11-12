---
id: 093
title: Connectors — shared sign-in for hosted instances: the instance side
status: backlog
priority: high
depends_on: [065, 066]
created: 2026-11-12
---

# 093 — Connectors — shared sign-in for hosted instances: the instance side

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A hosted instance on any domain signs members in to apps that need a registered app through Alian's one shared sign-in address. No instance or custom domain is ever registered at a provider.

## Scope
- On a hosted instance (`Config/hostingMode`) with no company app, the connect step uses the service's callback and a state signed with the instance's platform key, naming instance, connection and a nonce (FR-48)
- The instance's callback accepts the code the service forwards in the URL fragment; the existing complete step follows (FR-49)
- Exchange, refresh and revoke go through the service's server-to-server endpoints, authenticated with the platform key (FR-50); no app secret is ever on the instance
- Service unreachable: the member sees why, and the connection is not marked broken (FR-51)
- `resources/service-contract.md`: the service's routes, the state format, the authentication and the errors, agreed with the alianhub-cloud work
- A fake service for tests

## Out of scope
- The service itself. It is built in the alianhub-cloud repo (`docs/tasks/connector-sign-in/`, created with its PR): instance lookup in the platform's own list, app secrets, forwarding, refusing suspended or deleted instances.
- Self-hosted installs, which use their own apps

## Acceptance criteria
- [ ] Against the fake service, a hosted instance connects a registered-app entry with no app configured on the instance
- [ ] No app secret is on the instance; tokens are stored on the instance only
- [ ] A forged or reused state is refused; a code forwarded for another instance is refused
- [ ] With the service down, the member sees why and the connection stays as it was
- [ ] Off hosted, the service is never used

## Constraints & notes
- Track: A — connections (getting and keeping a person's access)
- Depends on: 065, 066
- Reuse the platform key and signed-token code in `Modules/Platform` (`guard.js`, `entitlementsToken.js`). Key rotation (`rotate-key`) must not break sign-ins in flight.
