---
id: 080
title: Cloud plans choose their server — shared or dedicated, units and droplet size
status: active
priority: high
depends_on: [069, 070, 072]
created: 2026-10-30
---

# Cloud plans choose their server — shared or dedicated, units and droplet size

> Part of [060 AlianHub Cloud](../060-alianhub-cloud-programme/task.md) · Repo: `alianhub-cloud`

## Goal

Staff decide in the back office, per plan, where a new customer on that plan runs: on a shared
droplet (taking a set share of it) or on a droplet of its own (of a set size). Today the choice is
fixed by the seed: the Catalog page has no such setting, shared units are hard-coded per plan key
(Business counts 0 units), dedicated droplets all take one global size, and deleting a dedicated
customer leaves its droplet running and billing.

## Where we start

- `Plan.tier` (`shared` | `dedicated`) exists, is validated and is accepted in catalog drafts
  (`server/modules/ops/catalog/helpers.js`, `PLAN_FIELDS`), but `ops/src/views/CatalogView.vue`
  has no field for it. A published change to `tier` counts as an entitlement change and re-pushes
  entitlements; it never changes an existing instance's `tier` or host.
- `server/modules/orchestrator/placement.js`: `UNITS_BY_PLAN = { starter: 1, pro: 2, business: 0 }`
  by plan key; a dedicated instance gets `bootstrapHost({ role: 'dedicated', size: sizes.dedicated })`,
  `sizes.dedicated` being `DO_SIZE_DEDICATED` for every plan.
- The `delete` workflow (`workflows/changes.js`) removes the stack, storage and DNS, never the host;
  `compute.destroyHost` has no caller (bug 10 in `F:\Projects\alianhub-test-data\HANDOFF.md`).

## Scope

1. **Plan setting.** Each plan gets `server: { units, size }` next to `tier`:
   - `tier: 'shared'` → `server.units`, a whole number of units (1–16) one customer takes on a
     shared droplet;
   - `tier: 'dedicated'` → `server.size`, the DigitalOcean size slug of each customer's own droplet,
     from a fixed list in `packages/shared` (slug, vCPU, RAM, monthly price).
   - Model, draft validation (field errors for a missing or invalid value of the chosen type),
     draft diff and publish history carry it. Changing `tier` or `server` is not an entitlement
     change: it does not re-push entitlements.
2. **Catalog page.** In each plan's fieldset: "Server type" (Shared / Dedicated); "Share of a shared
   server (units)" when Shared; "Droplet size" (vCPU, RAM, $/month) when Dedicated. A note says the
   setting applies to new customers only; customers already on the plan stay on their server.
   All text through `ops/src/locales/en.js`.
3. **Placement.** A new shared instance counts `plan.server.units` (falling back to today's table,
   never 0); a new dedicated instance gets a droplet of `plan.server.size` (falling back to
   `DO_SIZE_DEDICATED`). Units already counted for live instances follow their plan the same way.
4. **Delete releases a dedicated droplet.** For an instance on a host with `role: 'dedicated'` and no
   other live instance, `delete` ends with `host_released`: `compute.destroyHost(providerId)`, then
   the host is marked `retired`. Shared hosts are untouched.
5. **Existing data.** The seed gives Starter `units: 1`, Pro `units: 2`, Business `size:
   s-4vcpu-8gb`; plans saved before this change read as those defaults until edited.

## Out of scope

- Moving existing customers when a plan's type changes (`move_host` is still simulated in cloud
  mode; bug 4).
- Container CPU/memory per plan (`deploy/managed/tiers.json` in the AlianHub repo, keyed by plan key).
- The portal's plan highlights (bug 1), back-office Retire/Drain/Add host for shared hosts (bug 10),
  removing an empty shared droplet, and the other bugs in the handoff.

## Acceptance criteria

- [ ] The Catalog page shows Server type per plan, with the units field for Shared and the droplet
      size field for Dedicated; a draft saves, shows in the diff, publishes and appears in history.
- [ ] The server refuses a plan without valid units (Shared) or size (Dedicated) with a field error.
- [ ] Publishing a change to Server type, units or size re-pushes no entitlements and changes no
      existing instance's tier or host; the page states that it applies to new customers.
- [ ] A new shared instance counts its plan's units in placement; Business set to Shared never
      counts 0.
- [ ] A new dedicated instance gets a new droplet of its plan's size.
- [ ] Deleting a dedicated instance destroys its droplet and retires its host; deleting a shared
      instance leaves its host running.
- [ ] Seeded and pre-existing plans keep today's behaviour (Starter 1, Pro 2, Business
      `s-4vcpu-8gb`).
- [ ] Server and ops tests cover the above, and `npm run lint` and the test suites pass.

## Constraints & notes

- Decisions by the owner, 2026-10-30: new customers only; units per plan; size per plan; deleting a
  dedicated customer deletes its droplet.
- Code lands in `alianhub-cloud` on `feat/plan-server-type`, PR into its `main`; this task file and
  its progress go in a PR into `chore/pre-staging` here. Nothing is merged without the owner.
- The size list stays within what the DigitalOcean token's scopes and the blr1 region allow
  (`cloud:check` already lists the sizes it needs).

## Resources

- `F:\Projects\alianhub-test-data\HANDOFF.md` — the first real run, the feature tests and bugs 1–12.
