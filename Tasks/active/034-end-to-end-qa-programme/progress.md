# Progress: End-to-end QA programme

## Checklist
- [x] Demo team seed, unseed and session token script — #593 `bd086bea` (build 68); seeded locally: 8 people, QA Sandbox with a sprint and 12 tasks, 4 L1 agents
- [x] E2E harness, fixtures, CI `e2e` job, `docs/TESTING-E2E.md` — #592 `c3b367e0` (build 67); `e2e` job green on the PR
- [x] Access and accounts — sweep · suite — #596 `1539e28e` (build 72); fixes #600 (77), #609 (81), #615 (84), #616 (85)
- [x] Projects and planning — sweep · suite — #603 `350550ff` (build 82); fixes #612 (88), #627 (95), #626 (102)
- [x] Tasks and collaboration — sweep · suite — #598 `6f06235b` (build 74); fixes #606 (89), #610 (97)
- [x] Time and money — sweep · suite — #608 `293ceed3` (build 99); fixes #594 (101), #621 (105)
- [x] Messages and inbox — sweep · suite — #602 `5d5e4c2a` (build 78); fixes #600 (77), #628 (100)
- [x] Pages, forms, import and export — sweep · suite — #614 `f8ba298c` (build 86); fixes #618 (91), #623 (94)
- [x] Reports and integrations — sweep · suite — #604 `4fd4de13` (build 93); fixes #625 (104)
- [x] Automations and AI features — sweep · suite — #601 `2dd11596` (build 76); fixes #622 (96)
- [x] AI agents — sweep · suite — #599 `84a81798` (build 75); fixes #620 (92)
- [x] Instance and administration — sweep · suite — #605 `f707aecb` (build 80); fixes #611 (83), #624 (98)
- [x] Critical and high findings fixed or filed — every critical and high finding has a merged fix; the rest are filed in `followups.md`
- [ ] CI `e2e` job green on `beta`

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed. Wave 1 started in parallel with Sprint 3: the demo team seed and the E2E harness. Area waves start when both merge. |
| 2026-09-11 | Wave 1 merged. The harness smoke run found a member editing a private project they are not in, and a possible refresh-token collision; the seed found an unauthenticated cache flush (`POST /api/v1/removeCache`), a guest role id mismatch, and no member rules in Local360. Member rules: bad local data from a company created before member seeding landed; #595 `ed1f34a9` (build 70) adds migration 011 (applied locally, 44 rules) and makes API guards honour project rules. Fix agents are on the other three. The ten area agents started, each with its own throwaway Mongo (ports 27101–27110). |
| 2026-09-11 | All ten area sweeps merged with their regression suites, and every fix PR merged: builds 77–105. Harness follow-ups: #607 (79) flipped the tests #600 fixed, #619 (90) waits for the default sprint and finished rule runs and sets the integration jest timeout. Known-failing tests were flipped in each fix PR. Owner decisions: only owners and admins delete agents; `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10. Items left out of the fix PRs are in `followups.md`. |

## Last step
Sweeps, suites and fixes merged through build 105. Remaining: confirm the CI `e2e` job stays green on `beta`, decide the webhook private-host allowlist, and schedule the items in `followups.md`.
