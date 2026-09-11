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
| 2026-09-11 | Wave 2 PRs: #642 (automation dispatch rejections, follow-up 19) merged as `3a6c7f1d` after two clean reviews; #641 (follow-ups 31, 33) and #643 (follow-up 29) are green but reviewers found defects, now being fixed on their branches: the dial-code Enter key can still emit an undefined country (#641), owner-invite acceptance reads a missing `_id` and removed members or pending invitees can still update a company through the header/body mismatch and a membership-blind role lookup (#643). The reviews also found two pre-existing leaks on beta: `POST /api/v1/userAndCompanyCheck` returns any user's full document (new PR in progress), and the unverified-login 400 returns the verification token (handled in a separate session). |
| 2026-09-11 | #641 merged as `81e0f922` (follow-ups 31 and 33): verification resend sends only the account id, the Settings General dial-code crash is fixed at its data default, and the review finding reproduced and was fixed (Enter on a filtered list selected an undefined country; one selection path, no stray emits, the keydown listener removed on unmount). |
| 2026-09-11 | #644 merged as `45c1bb75`: `POST /api/v1/userAndCompanyCheck` answers only for the signed-in user and returns `toSelfView`. Reproduced first: a guest read an unrelated sign-up's `verificationToken` and verified that address. Follow-ups 41 and 42 filed for the remaining raw `users` responses outside the unverified-login path. |

## Last step
Seven fix branches in progress.
