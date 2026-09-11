# Progress: End-to-end QA programme

## Checklist
- [x] Demo team seed, unseed and session token script — #593 `bd086bea` (build 68); seeded locally: 8 people, QA Sandbox with a sprint and 12 tasks, 4 L1 agents
- [x] E2E harness, fixtures, CI `e2e` job, `docs/TESTING-E2E.md` — #592 `c3b367e0` (build 67); `e2e` job green on the PR
- [ ] Access and accounts — sweep · suite
- [ ] Projects and planning — sweep · suite
- [ ] Tasks and collaboration — sweep · suite
- [ ] Time and money — sweep · suite
- [ ] Messages and inbox — sweep · suite
- [ ] Pages, forms, import and export — sweep · suite
- [ ] Reports and integrations — sweep · suite
- [ ] Automations and AI features — sweep · suite
- [ ] AI agents — sweep · suite
- [ ] Instance and administration — sweep · suite
- [ ] Critical and high findings fixed or filed
- [ ] CI `e2e` job green on `beta`

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed. Wave 1 started in parallel with Sprint 3: the demo team seed and the E2E harness. Area waves start when both merge. |
| 2026-09-11 | Wave 1 merged. The harness smoke run found a member editing a private project they are not in, and a possible refresh-token collision; the seed found an unauthenticated cache flush (`POST /api/v1/removeCache`), a guest role id mismatch, and no member rules in Local360. Member rules: bad local data from a company created before member seeding landed; #595 `ed1f34a9` (build 70) adds migration 011 (applied locally, 44 rules) and makes API guards honour project rules. Fix agents are on the other three. The ten area agents started, each with its own throwaway Mongo (ports 27101–27110). |

## Last step
Ten area sweeps running in parallel; security fixes for project edit membership, refresh tokens, unauthenticated routes and the guest role id in progress.
