# Progress: Cloud plans choose their server — shared or dedicated, units and droplet size

## Checklist

- [x] Size list in `packages/shared`; `server: { units, size }` on the plan model with defaults
- [x] Draft validation, diff and publish (no entitlement re-push for tier/server)
- [x] Catalog page fields and the "new customers only" note, with locale keys
- [x] Placement reads units and size from the plan
- [x] `delete` releases a dedicated droplet (`host_released`)
- [x] Seed defaults; tests; lint
- [x] PRs: `alianhub-cloud` into `main` (aliansoftwareteam/alianhub-cloud#4), this task into `chore/pre-staging`
- [ ] Owner reviews and merges both PRs

## Last step

Both PRs open; waiting for the owner's review. Nothing merged.

## Blockers

None.

## Log

### 2026-10-30
- Task created after the owner's back-office delete of `ahc-test1` left droplet `h-blr1-s-o453tq`
  running; the droplet was deleted through the DigitalOcean API and its host marked retired.
- Owner's decisions: new customers only; units per plan; droplet size per plan; deleting a
  dedicated customer deletes its droplet.
- Found that `alianhub-cloud` PR 3 (merged the same day) already added the Shared/Dedicated
  select to the plan editor's Basics tab; the owner had been looking at a build from before it.
  This task adds the units and droplet size fields, the note, validation, placement and release.
- Built on `alianhub-cloud` branch `feat/plan-server-type` (commit `308d3ee`):
  - `packages/shared`: `DROPLET_SIZES`, `SHARED_UNITS_MAX`, `isSharedUnits`, `isDropletSize`,
    `planServer()` (fallback for plans saved before: Starter 1, Pro 2, others 1;
    `DO_SIZE_DEDICATED`).
  - `Plan.server` with tier-conditional required and validators; `server` in drafts and diffs;
    `tier` dropped from `ENTITLEMENT_FIELDS`.
  - `placement.js` reads units and size from the plan (the old table counted Business as 0).
  - `delete` gets `host_released` before `state_deleted`.
  - Decisions log entry 103.
- Checks: lint clean; server 329/329 (8 new), ops 28/28, portal 41/41, shared 56/56, agent 25/25.
  In the real back office on `:4320`, Pro shows Server, the note and units 2; Dedicated shows the
  four sizes defaulting to 4 vCPU / 8 GB. Checked with a temporary staff account
  `qa-claude@alianhub.test`, disabled afterwards; no draft left.
