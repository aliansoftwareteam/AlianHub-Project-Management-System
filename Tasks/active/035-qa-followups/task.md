---
id: 035
title: QA follow-ups — fix what the QA fix PRs left out
status: active
priority: high
depends_on: [034]
created: 2026-09-11
---

# 035 — QA follow-ups — fix what the QA fix PRs left out

Status: active · seven parallel branches from `beta` · owner go-ahead 2026-09-11 ("ok lets process")

## Goal
Close the items that task 034's fix PRs deliberately left out, the product bugs its suites exposed, and the harness problems that slowed the programme, so `Tasks/active/034-end-to-end-qa-programme/followups.md` is empty except for items that belong to later sprints.

## Scope
Item numbers refer to `followups.md`.

1. **Company and verification:** `PUT` company limited to owners and admins (1); verification email only to the account, crypto-strength tokens (12).
2. **Project filters and task reads:** project filters bound to their owner (2); `GET /api/v1/task/:id` checks project visibility (3).
3. **Time and money:** subscription `invoice/find` scoped (16a); timesheet reads ignore other users' ids for non-privileged callers (16c); `draft-from-milestone` needs a contract (16d).
4. **Storage:** access checked before an upload is written (5); profile images bound to their owner (6); bucket-size cron syntax (7).
5. **Auth tokens:** the access token no longer carries the refresh token (8); the tracker login no longer puts a credential in a URL (9); upgrade note for old tracker builds (10).
6. **Webhooks and projects:** instance-owner allowlist for private webhook hosts, empty by default, metadata addresses always blocked (15); `createproject` creates the default sprint before it responds (18).
7. **Harness and CI:** the `e2e` job also runs on pushes to `beta`; lint-staged runs with `--no-stash` (16e, 25); a plain build serves the messaging service worker (21); priority icon 404s (20); testing docs for run order and setup (23, 24).

## Out of scope
- Items 4 (private sprint visibility, existing behaviour), 11 (invitation link format), 13 (preset key in URL), 14 (tenant-scoping baseline), 19 (unawaited rule-run event), 26 (agent scratch files).
- Items 16 and 17: Sprint 8, task 031.

## Acceptance
- Each scope group lands as its own PR with a test that failed before the fix, and CI green including `e2e`.
- Upgrade impact is stated in the PR for tokens, tracker login, profile image paths and the webhook allowlist.
- `followups.md` marks each fixed item with its PR and build number in the follow-up docs PR, and `docs/BETA-LOG.md` is regenerated.

## Decisions
- Webhook allowlist: owner go-ahead on the planned design; empty by default so behaviour does not change until an owner adds a host.
- `e2e` on `beta` pushes: owner go-ahead; costs about 8 minutes of CI per merge.
