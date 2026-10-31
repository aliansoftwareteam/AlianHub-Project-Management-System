---
id: 080
title: AlianHub Cloud back office — simpler Catalog editor with a customer-view preview
status: done
priority: high
depends_on: []
created: 2026-10-30
---

# 080 — Simpler Catalog editor with preview (PRD)

Repository: `aliansoftwareteam/alianhub-cloud` (local `F:/Projects/alianhub-cloud`), back office app `ops/`.

## 1. Problem

The Catalog screen (`ops/src/views/CatalogView.vue`) is hard to use when drafting plans:

- Every plan and add-on is expanded at once in one long form; the six limit fields of every plan sit in one grid.
- Prices live in a separate table where staff pick "plan / key / currency / interval" by raw key, far from the plan they price.
- There is no way to **add** a plan or add-on, although the draft API (`PUT /catalog/draft`) already accepts new ones.
- Tier, features (time tracker, custom domain, own SMTP, backups, compute, SLA, support) and the highlight bullets customers read cannot be edited at all.
- Limits use "leave blank for unlimited" and raw GB/MB numbers.
- There is no preview: staff see a text diff ("pro limits.seats 10 → 20") but never the plan cards a customer sees in the portal, and cannot compare the draft with what is live or with an older version.

## 2. Goal

A staff member can add or change a plan in a minute, see exactly how the pricing page will look to customers, compare it with the live catalog, and look back at any published version — before publishing.

## 3. Scope

### 3.1 Layout — list + side panel
- Catalog page becomes: header with draft status and actions (Start draft / Save draft / Publish / Discard), a **Plans** list and an **Add-ons** list of compact cards (name, key, status badge, monthly price, "changed" / "new" marker), and the existing Subdomain rules and History sections below.
- Clicking a card, or **Add plan** / **Add add-on**, opens one item in a side panel (full-screen sheet at phone width) with tabs:
  - Plan: **Basics** (name, key, status, order, tier) · **Limits** · **Features** · **Prices** · **Highlights**
  - Add-on: **Basics** (name, key, unit, status, order) · **Grants & quantity** (grants, min/max, which plans may buy it) · **Prices**
- Key is generated from the name for new items (`Pro Plus` → `pro_plus`), editable until the item is first published, read-only after.
- Panel edits update the in-memory draft; **Save draft** still sends the whole draft in one `PUT /catalog/draft`. Leaving with unsaved changes asks for confirmation.
- Finance-only staff (`prices` but not `catalog` permission) see every tab read-only except Prices, as today.

### 3.2 Friendlier inputs
- Each limit has an **Unlimited** checkbox instead of a blank field; storage in GB and max file size in MB, with the unit shown.
- Prices tab is a grid: one row per currency (USD, INR, EUR), columns Monthly and Yearly, amount in major units; the yearly column shows the "2 months free" saving it implies.
- Highlights tab: ordered list of bullets picked from the known highlight keys (`seats`, `storage`, `workspaces`, `backups_daily`, `backup_download`, `dedicated_server`, `uptime_sla`, …) with their parameters, plus a button to fill them from the plan's limits and features.
- Server field errors (`plans.2.limits.seats`) are mapped to the right item and tab; tabs and cards with errors show a marker.

### 3.3 Preview
- A **Preview** pane (toggle beside the lists; full width on phones) renders the plan cards the way the portal's `PlanPicker` does: name, price, highlights, monthly/yearly switch, currency switch.
- Modes: **Draft**, **Live**, **Compare** (draft and live side by side; new plans, retired plans and changed prices/highlights are marked).
- The preview reflects the current unsaved edits, not only the saved draft.
- The card markup and styles are shared with the portal (moved to `packages/shared` or an equivalent shared UI module) so the preview cannot drift from what customers see; the portal keeps rendering the same cards.
- The existing text change list and impact / over-limit warnings stay, next to the preview and in the publish dialog.

### 3.4 Past versions
- Each History row has **View**, opening the preview in read-only mode for that published version (with Compare against live).
- New endpoint `GET /ops/catalog/versions/:version` (permission `view`) returns that version's stored `plans`, `addons`, `prices` and `changes`.
- Optional **Start draft from this version** is out of scope (see 4).

## 4. Out of scope
- Changing how publishing, re-pushing entitlements or over-limit checks work.
- Restoring/rolling back to a past version.
- Changes to the customer portal other than consuming the shared plan-card component.
- New currencies, intervals or limit types.
- Live-instance usage charts inside the editor.

## 5. Acceptance criteria
1. Staff with `catalog` permission can add a new plan (name, tier, limits, features, prices in all three currencies, highlights), save the draft and publish it; it then appears in `GET /catalog` and in the portal plan picker.
2. Same for a new add-on, including which plans may buy it.
3. Only one plan or add-on is open for editing at a time; the page with the panel closed fits the plans and add-ons lists on one screen for the seeded catalog.
4. Unlimited limits are set with a checkbox; storage is entered in GB and saved in bytes; round-tripping a plan through the editor without changes produces no draft changes.
5. Preview Draft mode updates as fields change, before saving; Live mode matches the portal for the same currency and interval; Compare marks every item listed in the change list.
6. A published version from History opens in the preview and matches what was live after that publish.
7. A finance-only user can edit prices only; every other input is read-only.
8. Server validation errors open on the right item and tab.
9. Every new string is in `ops/src/locales/en.js` (and the portal's when the shared card needs it); colours come from the existing tokens; layout works at 375 px.
10. Tests: ops view tests for add plan, edit, unlimited toggle, preview modes, version view, finance read-only; server test for `GET /ops/catalog/versions/:version` (found, not found, permission); `npm run lint`, `npm test` and `npm run build` pass.

## 6. Notes from the code
- Draft API already diffs added items (`diffItems` in `server/modules/ops/catalog/helpers.js`) and validates through the Mongoose schemas in `server/models/catalog.js`; no change needed to accept new plans.
- Published `CatalogVersion` documents keep full `plans` / `addons` / `prices` snapshots, so 3.4 needs only a read endpoint.
- Highlight wording lives in `portal/src/locales/en.js` under `Catalog.highlights`; the shared card needs those strings available to the ops app too.

## 7. Revision 2 — owner changes, 2026-10-30

Goes on the same branch and PR (`aliansoftwareteam/alianhub-cloud#3`). Decisions taken with the owner are marked **(owner)**.

### 7.1 Four add-ons only **(owner)**
| Add-on | Key | What one purchase gives | Quantity |
|---|---|---|---|
| Time tracker | `time_tracker` | Every user of the organisation can use the time tracker (no per-user seats) | 1 |
| Custom domain | `custom_domain` | Custom domain on the instance | 1 |
| Daily backup | `daily_backup` (new) | Customer backups on: daily backups kept N days, backup list, download, on-demand backups | 1 |
| Extra storage | `storage_50gb` | Extra **S3 file storage** (the bucket, not the server disk), per unit | 1–20 |

- Add-on grants become: `timeTrackerAllUsers` (bool), `customDomain` (bool), `backups` (bool) + `backupsKept` (days), `storageBytes` (S3 per unit). The old `seats` / `trackerSeats` grants stay in the schema for existing subscriptions but are no longer offered in the editor.
- The seed catalog (`server/scripts/catalogData.js`) moves to these four; `seats_10` is dropped from the seed. The live catalog changes through the editor (retire `seats_10`, add `daily_backup`, set time tracker to quantity 1).
- Entitlements: time tracker bought or included → `timeTracker: { enabled: true, seats: null }` (AlianHub already reads `null` as everyone). Backups bought or included → the control plane's backup list, download and on-demand backups open, kept for the add-on's or plan's days. Backups are run by the control plane, so the signed document sent to AlianHub does not carry them; it gains `recommendedSeats`.
- Existing data: `npm run migrate:addons-080` lists subscriptions, invite codes and pending requests holding `seats_10` or a tracker quantity above 1; `-- --apply` rewrites them. Run it before publishing the new add-on limits.
- A plan saved before this change keeps its old backup behaviour until its Daily backups setting is chosen; the editor warns when that choice takes backups away from its customers.
- The nightly backup keeps running for every instance as the platform's disaster-recovery copy (short retention); the add-on decides what the customer sees and keeps. *(Decided in this revision; the owner may override.)*

### 7.2 Server per plan — built by alianhub-cloud PR 4 (decision 103)
- Owner's answer here was "every plan gets its own server". PR 4 (merged 2026-10-30) built the more general form: each plan is **Shared** (`server.units`, 1–16) or **Dedicated** (`server.size` from `DROPLET_SIZES`); choosing Dedicated for every plan gives the owner's setup. Revision 2 keeps PR 4's model unchanged and only adds info icons to it.
- The seed keeps PR 4's values (Starter and Pro shared, Business dedicated `s-4vcpu-8gb`); switch them in the editor if every plan should be dedicated.
- A plan change between two dedicated plans with different sizes is still an entitlements push, not a resize: the resize workflow does not resize a droplet yet.
- The free-text "Compute size" field is removed from the editor (the stored field stays).

### 7.3 Users: recommended number plus optional cap **(owner)**
- Plan gains `recommendedSeats` (required), shown on the pricing card as "Built for up to {n} users" and sent in entitlements as `recommendedSeats`.
- `limits.seats` stays as an optional hard cap, off ("No cap") by default.

### 7.4 Limits wording
- Workspaces is always a number (no Unlimited option) **(owner)**.
- "Storage" becomes **File storage (S3)** with an info icon: the bucket for uploaded files, which Extra storage adds to; the server disk comes from the plan's server.

### 7.5 Order and info icons **(owner)**
- No Order field: plans and add-ons get move up / move down buttons in the list, saved as 1, 2, 3… in list order.
- Every field label gets an info icon (hover or focus) explaining what the field does and where it shows.

### 7.6 Acceptance additions
11. The four add-ons can be set up in the editor with exactly the grants above; time tracker shows as a flat price, not per user.
12. A plan cannot be saved without a server size and a recommended user count; the preview card shows the server and the recommended users.
13. A new instance on a plan is placed on a host created with that plan's server size (server test).
14. Entitlements tests: time tracker add-on → `seats: null`; no backup add-on → no download or on-demand; backup add-on → both, with its days kept.
15. Reordering with the buttons saves `order` as 1..n.
