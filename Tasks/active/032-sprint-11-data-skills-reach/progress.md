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
| 2026-09-22 | S2 merged: #809 `61144df7` (build 281), declared reads run through the egress gateway: every hop https, declared and on the live allowlist; a `skill_read` secret names the exact hosts it may be sent to and travels only as a request header dropped at the first cross-origin hop; every hop marked as outside content; dry runs fetch without a replay. |

## Last step
S0–S2 merged (builds 262–281). Next: S3 (fetches in the replay record), S4 (the Skill editor), S5 (`pr.summary` as a data seed).
