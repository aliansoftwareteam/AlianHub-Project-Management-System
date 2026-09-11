# Progress: QA follow-ups

## Checklist
One pull request per group; tick with the merge commit and build.

- [x] 1. Company updates and verification email (items 1, 12) — #633 `d5616681`
- [x] 2. Project filters and task read visibility (items 2, 3) — #632 `25344f46`
- [ ] 3. Subscription invoices and timesheet reads (items 16a, 16c, 16d)
- [ ] 4. Storage uploads, profile images, bucket cron (items 5, 6, 7)
- [ ] 5. Access token without the refresh token, tracker login (items 8, 9, 10)
- [ ] 6a. Webhook private-host allowlist (item 15)
- [ ] 6b. `createproject` default sprint (item 18)
- [x] 7. Harness and CI: e2e on beta pushes, lint-staged `--no-stash`, messaging worker, priority icons, testing docs (items 16e, 20, 21, 23, 24, 25) — #634 `2f208fe5`; item 20 reproduced on companies seeded before 4202a796 and fixed in `SettingTaskPriority.vue`; the messaging worker is skipped when Firebase is not configured
- [ ] `followups.md` updated and `docs/BETA-LOG.md` regenerated

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed from `followups.md` after the owner said to proceed. Seven agents started in parallel, one branch per group. Follow-up 27 (flaky access e2e test) is already fixed by #631 (build 107). |
| 2026-09-11 | All seven groups have green PRs: #632 and #633 and #634 merged; #635, #636, #637, #638, #639 held for a multi-agent adversarial review before merge. Beta's first push run with the `e2e` job (after #634) passed. #640 fixes follow-up 28 (stray characters in invite links). Wave 2 started on the follow-ups that don't touch the held PRs: 29 (server-controlled company fields), 31 and 33 (verification resend request shape, Settings General `isoCode` error), 19 (unawaited automation event dispatch), each with its own PR reviewed by two independent reviewers. Follow-ups 34–40 wait for the held PRs. |

## Last step
Seven fix branches in progress.
