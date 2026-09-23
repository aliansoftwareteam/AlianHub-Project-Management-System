# Progress: Sprint 11 — data skills reach outside (ADR 003 phase 4)

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: Declared external reads join the skill vocabulary: URL and API readers with a declared host, capped size and t — #793 `6ec33df4` (264), #809 `61144df7` (281)
- [x] Step 2: The PR-review skill — #819 (288)
- [x] Step 3: The Skill Library editor exposes declared reads with the allowlist check, and the replay record captures what  — #815 (284), #816 (287)
- [x] Interface: Skill Library → declared reads (extend) — #816 (287)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 11) |
| 2026-09-21 | Started after Sprints 6 and 8. Planned into six pull requests (see task.md Decisions); the owner settled every open question. S0 merged: #792 `1730b429` (build 262), outbound fetches drop credentials at the first hop to another origin, refuse https-to-http with credentials, and mark every hop's host as outside content. S1 (declared reads, #793) is in its review fix round. |
| 2026-09-21 | S1 merged: #793 `6ec33df4` (build 264), declared `url` and `api` readers behind `SKILL_EXTERNAL_READS`: exact hosts on the workspace allowlist only, wildcard-DNS and reserved names refused, path values refused when they decode to dot segments and the built URL compared segment by segment, credentials only by `skill_read` handle, a secret scan on the skill body. S2 (run-time reads through the egress gateway, credentials bound to their hosts) started. |
| 2026-09-22 | S2 merged: #809 `61144df7` (build 281), declared reads run through the egress gateway: every hop https, declared and on the live allowlist; a `skill_read` secret names the exact hosts it may be sent to and travels only as a request header dropped at the first cross-origin hop; every hop marked as outside content; dry runs fetch without a replay. |
| 2026-09-22 | S3 merged: #815 (build 284), each declared-read fetch is a replay row (capped at 32 KB, sha256 of the scrubbed body); #818 (build 285) closed test server connections so the replay suite stops reusing a closing socket. S4 merged: #816 (build 287), declared reads in the Skill editor with the live allowlist check. S5 merged: #819 (build 288), `pr.summary` as a data skill seed that must cite what it read; the code skill stays until the flag defaults on. |
| 2026-09-23 | Exit-gate run on the owner's local server (build 303): `SKILL_EXTERNAL_READS=on`, `PR_SUMMARY_AS_DATA=on` and `AGENT_EGRESS_ALLOWLIST=true`, with `github.com` and `patch-diff.githubusercontent.com` on the Local360 allowlist. Code Reviewer ran `pr.summary` on AR-1 (PR #540): gpt-4o, 5,040 tokens, $0.0147, no refusals. The replay holds the fetch row: `github.com` 302 then `patch-diff.githubusercontent.com` 200, both listed; 19,495 bytes stored whole with its sha256; both hosts recorded as taint sources. `SKILL_EXTERNAL_READS` alone still runs the code version of `pr.summary` (a run on AR-49 recorded no fetch row); the data seed also needs `PR_SUMMARY_AS_DATA`. |

## Last step
Every slice merged (S0–S5, builds 262–288) and the real `pr.summary` run passed on 2026-09-23. The exit gate waits only on the owner's sweep of the Skill editor's declared-read fields.
