---
id: 063
title: Shared S3 storage — one driver for Spaces/Wasabi/S3, a prefix per instance, hot key reload, usage counter
status: active
priority: high
depends_on: [060, 061]
created: 2026-10-27
---

# Shared S3 storage — one driver for Spaces/Wasabi/S3, a prefix per instance, hot key reload, usage counter

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one

## Goal

Let a hosted instance keep all its files in storage **we** provide — DigitalOcean Spaces or Wasabi
— inside one bucket and one key prefix given to it by the platform, using credentials the platform
pushes and can rotate without a restart, and know at every moment how many bytes each workspace
uses so 064 can enforce storage plans without listing millions of objects. Self-hosted installs keep
their current behaviour.

## Where we start

- `STORAGE_TYPE` is `server` (local disk) or `wasabi`. The Wasabi driver
  (`Modules/storage/wasabi/controller.js`) **creates one bucket per company, named after the
  company id** (`CreateBucketCommand({ Bucket: companyId })`), plus a shared
  `USERPROFILEBUCKET` for avatars and public assets.
- Credentials are read once at module load (`Config/aws.js`), and `new S3Client(...)` is built in at
  least six places: `Modules/storage/wasabi/controller.js` (three), `common-storage/readStoredFile.js`,
  `Modules/ScreenshotRetention/helper.js`, `Modules/GeneralReminders/attachmentResolver.js`,
  `Modules/Instance/probes.js`. That is why every storage setting is `restart: true`.
- Variable names are Wasabi-specific (`WASABI_ACCESS_KEY`, `WASABIENDPOINT`, …) although the code
  is plain S3 API.
- Storage used is computed by listing every object (`getBucketSize`,
  `getBucketSizeCompanyWiseStorage`).

Why bucket-per-company cannot be the hosted layout: S3 providers cap buckets per account (DigitalOcean
Spaces and Wasabi both in the low hundreds to a thousand by default — exact figures in
[digitalocean.md](../../active/060-alianhub-cloud-programme/resources/digitalocean.md)), bucket names
are global so a company id could collide with someone else's bucket, and an instance would need
account-wide credentials to create buckets — one leaked key would expose every customer.

## Scope — the work, task by task

### T1 — Provider-neutral configuration

New canonical variables, with the old Wasabi names read as fallbacks (no break for self-hosters):

| New | Fallback | Meaning |
|---|---|---|
| `STORAGE_TYPE=s3` | `wasabi` (alias) | S3-compatible driver |
| `S3_ENDPOINT` | `WASABIENDPOINT` | e.g. `https://blr1.digitaloceanspaces.com` |
| `S3_REGION` | `WASABI_REGION` | e.g. `blr1`, `us-east-1` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `WASABI_ACCESS_KEY` / `WASABI_SECRET_ACCESS_KEY` | credentials |
| `S3_BUCKET` | — | **new**: one bucket for everything (prefix mode) |
| `S3_PREFIX` | — | **new**: key prefix, e.g. `ins_01jd3k…/` |
| `S3_FORCE_PATH_STYLE` | — | `true` for MinIO-style endpoints |
| `S3_PUBLIC_BASE_URL` | — | optional CDN base for public assets |

`settingsCatalog.js` gains the new keys in the `storage` group (platform-owned in managed mode, 061),
the Wasabi-named fields are shown only when set, and the Test button (`/api/v2/instance/settings/test`)
checks put/get/delete of a probe object under the prefix.

### T2 — Two layouts behind one interface

`common-storage/s3Layout.js` maps the app's logical location to a bucket and key:

| Logical location | Bucket-per-company (today, self-hosted) | Prefix mode (hosted) |
|---|---|---|
| company file `path` | bucket `companyId`, key `path` | bucket `S3_BUCKET`, key `S3_PREFIX + companyId + '/' + path` |
| public asset / avatar | bucket `USERPROFILEBUCKET`, key `path` | bucket `S3_BUCKET`, key `S3_PREFIX + 'public/' + path` |

- Prefix mode is on when `S3_BUCKET` is set. No bucket is ever created or deleted in prefix mode
  (`createNewBucketInWasabi` and the delete-bucket path become no-ops that only verify access).
- Every storage call site goes through `s3Layout` — no more `Bucket: companyId` literals. A
  convention test (`tests/conventions/s3-layout.test.js`) fails on `Bucket:` outside the layout
  module.
- Public assets in prefix mode are served through presigned URLs or `S3_PUBLIC_BASE_URL`, never a
  public-read bucket policy over the whole bucket (other tenants' prefixes live there).
- The orchestrator decides whether a customer gets a shared bucket with a prefix or a bucket of its
  own with an empty prefix; the app supports both without knowing which.

### T3 — One client factory with hot reload

- `common-storage/s3Client.js`: `getS3Client()` returns a cached `S3Client` built from the current
  resolved settings; `resetS3Client()` drops it. Every place listed in "Where we start" uses it.
- `applyInstanceSettings` / `savePlatformSettings` (061) call `resetS3Client()` when any storage key
  changes, so a credential rotation pushed through `PUT /api/v2/platform/config` (062) takes effect
  on the next request. Storage fields lose `restart: true` (except `STORAGE_TYPE` itself).
- In-flight uploads finish on the client they started with.

### T4 — Storage usage counter

- New global collection `storage_usage`: `{ _id: companyId, bytes, objects, updatedAt,
  reconciledAt, drift }`.
- Increment after every successful put (by the object's byte size; replacing an object adds the
  difference), decrement after every successful delete, in the same helpers T2 introduced — one
  place per operation, not per feature.
- Thumbnails and derived files count too (they are bytes we pay for).
- Trash: moving to Trash does not free bytes; purging from Trash does.
- Nightly reconciliation (`cron.js`, 03:30 instance time, spread by a random minute): list the
  company's prefix with `ListObjectsV2` pagination, compare, correct `bytes`, store `drift`; log a
  warning when drift exceeds 1% — that means an upload path is missing the counter.
- Exposed as `storageUsage(companyId)` and `instanceStorageUsage()` for 062 (usage report) and 064
  (enforcement). The server-disk driver gets the same counter so self-hosted Plan & usage numbers
  are right too.

### T5 — Moving an existing install to prefix mode (self-hosted bonus, needed for the beta)

`npm run storage:migrate -- --to-prefix --bucket <name> --prefix <p>/` copies every company bucket
and the profile bucket into the prefix layout (server-side `CopyObject`, resumable, checksums
compared), rewrites nothing in the database (keys are relative), then switches `S3_BUCKET` /
`S3_PREFIX`. Old buckets are left for the operator to delete. Used for M2 beta customers who start
on a temporary layout and for any self-hoster who wants it.

### T6 — Deleting a workspace or an instance

- Deleting a company in prefix mode deletes its prefix (`ListObjectsV2` + `DeleteObjects` in batches
  of 1,000) in a background job, then removes its `storage_usage` row.
- Deleting a whole hosted instance is done by the orchestrator against the bucket (069), not by the
  app.

### T7 — Tests

- Unit: layout mapping for both modes; settings fallback from Wasabi names; client reset on change.
- Integration against MinIO in CI (docker service in the test workflow): upload, presigned get,
  replace, delete, counter values, reconciliation fixes injected drift, prefix isolation (a key
  outside the prefix is never listed or deleted), credential rotation mid-run.
- Convention test from T2.

## How it looks

What the platform pushes (062 `PUT /api/v2/platform/config`):

Default layout (Q26): Wasabi, shared bucket, prefix and IAM key per instance:

```json
{ "values": {
    "STORAGE_TYPE": "s3",
    "S3_ENDPOINT": "https://s3.ap-southeast-1.wasabisys.com",
    "S3_REGION": "ap-southeast-1",
    "S3_BUCKET": "alianhub-cloud-tenants-ap-southeast-1",
    "S3_PREFIX": "ins_01jd3k8w…/",
    "S3_ACCESS_KEY": "…",
    "S3_SECRET_KEY": "…" } }
```

Fallback (DigitalOcean Spaces, which can scope a key to a bucket but not a prefix): a bucket per
host, `S3_ENDPOINT=https://blr1.digitaloceanspaces.com`, `S3_BUCKET=ah-host-blr1-03`, same prefix.

The bucket, seen by an operator:

```
alianhub-cloud-tenants-ap-southeast-1/
├── ins_01jd3k8w…/
│   ├── public/          avatars, logos
│   ├── 6731a0…/         workspace "Acme"
│   │   ├── tasks/…
│   │   └── chat/…
│   └── 6731b7…/         workspace "Acme Labs"
└── ins_01jd4m2q…/
    └── …
```

Instance console (self-hosted mode, where the customer owns storage):

```
Storage
  Driver            [ S3-compatible ▾ ]
  Endpoint          [ https://blr1.digitaloceanspaces.com ]
  Region            [ blr1 ]
  Bucket            [ my-alianhub ]   one bucket for everything
  Key prefix        [ prod/ ]         optional
  Access key        [ DO00… ]
  Secret key        [ •••••• set ]
                       [ Test ]  ✓ write, read, delete ok
```

## Platform view

- **Isolation.** With a per-instance key limited to its own bucket or prefix (whichever the provider
  can enforce — see digitalocean.md), one instance's credentials cannot read another's files. The
  app's own refusal to touch keys outside `S3_PREFIX` is a second lock, covered by tests.
- **Rotation.** Keys rotate with zero downtime: create new key → push config → verify `/status` →
  revoke old key (069 runs this).
- **Counter accuracy.** Nightly reconciliation bounds drift to one day; drift > 1% raises an alert in
  fleet monitoring (071) because it means a code path is uncounted.
- **Cost of listing.** Reconciliation lists each instance once a night; at ~10k objects per small
  customer that is ~10 list calls — negligible.
- **Backups.** Files are already in object storage; nightly backups (071) cover the database only,
  with bucket versioning or replication for files if the provider supports it.

## Management view

- **Why it matters.** It removes the bucket-count ceiling that would stop growth at a few hundred
  customers, and it is what makes "storage provided by us" sellable and measurable.
- **Cost.** 7–9 developer days (T2 touches every storage call site; T4 and its tests are the
  careful part). Running cost is the storage itself (see digitalocean.md for prices).
- **Risk:** a missed call site writes to the old layout. Mitigations: the convention test, MinIO
  integration tests, and reconciliation drift alerts.
- **Benefit to open source.** Self-hosters get generic S3 naming, a single-bucket option and
  accurate usage numbers.

## Out of scope

- Direct browser-to-S3 uploads with presigned PUTs (would lift the 100 MB Cloudflare request limit;
  later).
- Server-side encryption with customer-managed keys.
- Migrating existing hosted customers between regions.

## Acceptance criteria

- [ ] With `S3_BUCKET` and `S3_PREFIX` set, every file the app writes (task attachments, comments,
      chat, docs, whiteboards, clips, imports, avatars, logos, tracker screenshots, thumbnails) lands
      under the prefix; no bucket is created.
- [ ] Without `S3_BUCKET`, the current bucket-per-company behaviour is unchanged.
- [ ] The old `WASABI_*` variables keep working.
- [ ] Rotating `S3_ACCESS_KEY`/`S3_SECRET_KEY` through the platform API takes effect on the next
      request with no restart and no failed upload.
- [ ] `storage_usage` matches a full listing within 1% after a day of mixed uploads, replacements
      and deletes; reconciliation corrects injected drift and logs it.
- [ ] Deleting a workspace removes its prefix and its usage row.
- [ ] `storage:migrate --to-prefix` moves a test install with two companies and keeps every file
      reachable.
- [ ] The MinIO integration suite and the convention test run in CI.

## Dependencies

- 061 (platform-owned storage settings).
- 064 and 062 consume the counter.

## Open questions

- Q24/Q5 storage provider and region — decided in digitalocean.md (Spaces or Wasabi); the app does not
  care.
- Q12 — storage add-on (affects only the limit, not this task).

## Estimate

7–9 developer days.
