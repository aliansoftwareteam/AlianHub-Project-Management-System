# 080 — Progress

## Checklist

- [x] `GET /ops/catalog/versions/:version` + server tests (role matrix, found / 404)
- [x] Plan card shared by portal and ops (`packages/shared/src/components/PlanCard.vue`, `planCard.js`, `PlanCard.*` locale, card CSS in `styles/base.css`)
- [x] List + side panel editor: plans (Basics, Limits, Features, Prices, Highlights), add-ons (Basics, Grants & quantity, Prices); add / remove new items; key from name
- [x] Friendlier inputs: Unlimited checkbox, GB/MB, price grid per currency with yearly saving, highlight picker + "Fill from limits and features"
- [x] Preview: Draft / Live / Compare, currency and interval switches, live while typing
- [x] Past versions: History → View, version vs live compare
- [x] Field errors open the right item and tab; finance edits prices only
- [x] Tests: ops `test/catalog.test.js` (7), shared plan-card tests, server tests
- [x] Commit, push and open the PR in alianhub-cloud (PRs 3 and 5, merged 2026-10-30)

## Log

- 2026-10-30 — Built on branch `feat/catalog-editor-preview` in worktree `F:/Projects/alianhub-cloud-wt/catalog-editor` (from `origin/main` 8c5440c). Lint, ops (27), portal (41), shared (54) tests and both builds pass. Full server suite: 315–311 of 322 pass per run; the failing file differed between runs (`getStarted`, then `app`) and each passes alone, so treated as load flakiness. Checked in the browser against a mock API with the seed catalog: add plan, price grid, highlights, Compare, version view, narrow-screen sheet.
- Found and fixed on the way: vue-i18n writes `n` into the params object passed to `t`, so the portal's highlight params were being mutated; `planHighlightText` now passes a copy.

## Known limits

- `isPlanKey` / `PLAN_KEYS` in `packages/shared/src/catalog.js` are still the three seeded keys: a new plan is offered in the portal's plan picker, but a sign-up link `?plan=<new key>` is ignored and coupons cannot target it. Follow-up.

## Last step

Waiting for the go-ahead to commit and open the PR.

## Revision 2 — 2026-10-30

- PR 3 (editor + preview) merged to alianhub-cloud `main`. PR 4 (per-plan server, decision 103) merged on top by another branch; revision 2 was rebased onto it and keeps PR 4's server model.
- Revision 2 is alianhub-cloud PR 5, branch `feat/catalog-plan-servers-addons`: four add-ons, recommended users, S3 wording, add-on switches, up/down ordering, info icons, portal fixes, `npm run migrate:addons-080`.
- An independent review found 12 issues; 9 fixed, 3 left with reasons in the PR body.
- Lint, server 336, ops 32, portal 43, shared 56 tests pass; both apps build.

## Last step

PR 5 open, waiting for CI and review. Run `npm run migrate:addons-080` (dry run, then `-- --apply`) before publishing the new add-on limits on a live catalog.

## Handover — 2026-10-30

PR 5 merged (`main` 202b1f9). The owner is switching Claude accounts. Next: start :4300 on `main` against `alianhub_cloud`, and, with the owner's go-ahead, migrate the local catalog. See HANDOFF.md, "Catalog task 080".

## Closed — 2026-10-31

- Done. The editor, preview, version history, the four add-ons, recommended users and `npm run migrate:addons-080` are on alianhub-cloud `main` (PRs 3 and 5). PR 4's per-plan servers, also first numbered 080, is now task 081.
- :4300 runs `main` against the local test DB `alianhub_cloud`. The owner decided that DB doesn't need the migration, so it keeps the old catalog. On any catalog with customers, run the migration (dry run first) before publishing the new add-on limits.
- Follow-ups, not started:
  - `PLAN_KEYS` / `isPlanKey` still list only the three seeded plans, so a new plan can't use `?plan=` sign-up links or coupons.
  - Resize doesn't resize a droplet, so a change between dedicated plans of different sizes is only an entitlements push.
  - The AlianHub app doesn't show `recommendedSeats` yet.
  - Re-running `npm run seed:catalog` on a DB with customers changes live plans without the publish flow; it has no guard.
