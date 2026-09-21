# Progress: Sprint 11 — data skills reach outside (ADR 003 phase 4)

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Declared external reads join the skill vocabulary: URL and API readers with a declared host, capped size and t
- [ ] Step 2: The PR-review skill
- [ ] Step 3: The Skill Library editor exposes declared reads with the allowlist check, and the replay record captures what 
- [ ] Interface: Skill Library → declared reads (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 11) |
| 2026-09-21 | Started after Sprints 6 and 8. Planned into six pull requests (see task.md Decisions); the owner settled every open question. S0 merged: #792 `1730b429` (build 262), outbound fetches drop credentials at the first hop to another origin, refuse https-to-http with credentials, and mark every hop's host as outside content. S1 (declared reads, #793) is in its review fix round. |
| 2026-09-21 | S1 merged: #793 `6ec33df4` (build 264), declared `url` and `api` readers behind `SKILL_EXTERNAL_READS`: exact hosts on the workspace allowlist only, wildcard-DNS and reserved names refused, path values refused when they decode to dot segments and the built URL compared segment by segment, credentials only by `skill_read` handle, a secret scan on the skill body. S2 (run-time reads through the egress gateway, credentials bound to their hosts) started. |

## Last step
S0 and S1 merged (builds 262, 264). S2 in progress; then S3, S4 and S5.
