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
- [ ] 7. Harness and CI: e2e on beta pushes, lint-staged `--no-stash`, messaging worker, priority icons, testing docs (items 16e, 20, 21, 23, 24, 25)
- [ ] `followups.md` updated and `docs/BETA-LOG.md` regenerated

## Log
| Date | Entry |
|---|---|
| 2026-09-11 | Filed from `followups.md` after the owner said to proceed. Seven agents started in parallel, one branch per group. Follow-up 27 (flaky access e2e test) is already fixed by #631 (build 107). |

## Last step
Seven fix branches in progress.
