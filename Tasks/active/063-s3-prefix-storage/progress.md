# Progress: Shared S3 storage — one driver for Spaces/Wasabi/S3, a prefix per instance, hot key reload, usage counter

## Checklist

- [x] T1 — Provider-neutral `S3_*` configuration with Wasabi fallbacks
- [x] T2 — Layout module: bucket-per-company and prefix modes; convention test
- [x] T3 — One S3 client factory with hot reload
- [x] T4 — `storage_usage` counter and nightly reconciliation (server driver: upload and delete routes counted, its other writes corrected each night — see log)
- [x] T5 — `storage:migrate --to-prefix` (unit-tested against an in-memory S3; not yet run on real buckets)
- [x] T6 — Workspace deletion clears its prefix
- [ ] T7 — Unit, MinIO integration and convention tests: unit and convention tests pass; the MinIO suite is written and wired into the CI integration job but has not run yet (no Docker or MinIO on this machine) — tick after its first green CI run

## Last step

T1–T6 built and committed on `feat/s3-prefix-storage`; unit and convention tests pass. Next: the first CI run
of `tests/integration/s3-storage.int.test.js` against MinIO, then a real `storage:migrate` on a test install
with two workspaces (M2 beta).

## Blockers

None for the app work. Q26 (Wasabi with a prefix per instance, the default, or Spaces with a bucket
per host) only changes what the orchestrator pushes; the app supports both.

## For other tasks

- **062 / 064** read the counter from `common-storage/storageUsage.js`:
  `storageUsage(companyId)` → `{ companyId, bytes, objects, updatedAt, reconciledAt, drift }`;
  `instanceStorageUsage()` → `{ bytes, objects, byWorkspace: [{ companyId, bytes, objects, reconciledAt }], public: { bytes, objects } }`
  (no workspace names: 062 joins them). `add(owner, bytes, objects)` is what every write calls.
  Collection: global `storage_usage` (`SCHEMA_TYPE.STORAGE_USAGE`), `_id` = companyId or `public`.
- **061** marks the storage group platform-owned. When merging, give `scripts/env-doc.meta.json`
  `managed: "platform"` for `S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_PREFIX, S3_ACCESS_KEY, S3_SECRET_KEY,
  S3_FORCE_PATH_STYLE, S3_PUBLIC_BASE_URL` (and the `WASABI*` / `USERPROFILEBUCKET` / `STORAGE_TYPE` rows,
  as the rest of the group). A platform value applied through `applyEnvMap` reloads the S3 client by itself
  (`Config/applyEnv.js` → `reloadStorageClient()`); a source that writes `process.env` some other way can
  call `require('common-storage/s3Client').reloadStorageClient()`, and `getS3Client()` also rebuilds when
  the credentials it resolves differ from the cached client's.
- **065** renders `STORAGE_TYPE=s3`: accepted values are `s3` and `wasabi` (the same S3 driver,
  `common-storage/common-s3.js` re-exports `common-wasabi.js`) and `server` (local disk), unchanged.
- **069** owns deleting a whole instance's prefix; the app deletes only a workspace's prefix.

## Log

### 2026-10-28
- Built autonomously (owner away). Decisions:
  - **Prefix mode is on when `S3_BUCKET` is set**, as the PRD says; not driven by `HOSTING_MODE` (061) or
    `INSTANCE_ID`. An empty `S3_PREFIX` is valid (a customer with a bucket of its own).
  - **`STORAGE_TYPE=s3`** is an alias: `common-storage/common-s3.js` re-exports the Wasabi driver, so routes
    stay `/api/v1/wasabi/*` and the frontend (which only tells `server` apart) needs no change.
  - **New modules** in `common-storage/`: `s3Config.js` (S3_* with WASABI_* fallbacks, empty = unset),
    `s3Layout.js` (the only file allowed to write `Bucket:`; refuses `..`/absolute keys and unsafe owner ids
    in prefix mode), `s3Client.js` (`getS3Client`, `resetS3Client`, `reloadStorageClient`), `s3Store.js`
    (put/remove/copy/get/signedGetUrl/list/measure/removeAll/createArea/removeArea/reach/roundTrip, each
    counting), `storageUsage.js`, `storageReconcile.js`, `diskUsage.js`, `companyFiles.js`.
  - **Every S3 call site** now goes through the store: `Modules/storage/wasabi/controller.js`,
    `common-storage/readStoredFile.js`, `Modules/GeneralReminders/attachmentResolver.js`,
    `Modules/ScreenshotRetention/helper.js`, `Modules/Instance/probes.js`. Email templates build public image
    addresses with `layout.publicUrl()` (byte-identical in bucket mode).
  - **Counting needs sizes**: a delete and a copy send a HEAD first, and so does a put flagged `replace`
    (avatars, public assets, which overwrite fixed names). This is the one change in the requests a
    bucket-per-workspace install sends; buckets and keys are unchanged. Two existing tests that counted
    every S3 call now count the DeleteObject calls.
  - **Prefix mode never sends `ACL: public-read`** (other tenants share the bucket). Public email images use
    `S3_PUBLIC_BASE_URL`, or the path under `<prefix>public/` when the operator allows public reads there.
  - The signed-url cache key is the physical bucket and key, so two workspaces in one bucket never share one;
    `reloadStorageClient()` drops cached signed urls, which stop working once an old key is revoked.
  - **Settings**: new `S3_*` fields; every storage field but `STORAGE_TYPE` loses `restart`; Wasabi-named fields
    are `legacy` and come back from `describeSettings` with `hidden: true` unless set (env or saved); the page
    filters them. Labels, help, options and the `prefix` error go through `Instance.*` i18n keys (backfilled).
    `S3_PREFIX` is validated. CSP rebuilds when `S3_ENDPOINT`, `WASABIENDPOINT` or `S3_PUBLIC_BASE_URL` change,
    and allows the `S3_PUBLIC_BASE_URL` host.
  - **Test button vs health**: the console Test does put/get/delete of `<prefix>.alianhub-probe/<random>`
    (outside every area, never counted); the health page only reaches the bucket (HeadBucket) or lists the
    prefix (`MaxKeys 1`), writing nothing.
  - **Reconciliation**: cron `storageUsage` at 03:30 plus a random 0–29 minutes; lists each workspace and
    `public` (walks `storage/` on the server driver), sets bytes/objects/drift/reconciledAt; the first count
    logs info, later drift above 1% logs a warning. It also finishes workspace removals left pending and
    drops counter rows of workspaces that no longer exist once they measure empty.
  - **Server driver counter**: the upload route (file and thumbnails), the base64 upload and the delete route
    count; `putLocalFile`, imports, copies and seed images on disk are corrected by the nightly walk only.
  - **T6**: `deleteCompany` calls `scheduleCompanyFilesRemoval`: in prefix mode it marks the row
    `removalPending`, then deletes the prefix in batches of 1,000 in the background and removes the row; a
    failed run is retried nightly. Bucket-per-workspace and server installs keep their files as before.
    `createNewBucketInWasabi` / `deleteBucketInWasabi` only list the area in prefix mode.
  - **T5** `npm run storage:migrate -- --to-prefix --bucket <b> --prefix <p>/ [--apply] [--switch] [--only ids]`:
    dry run by default; server-side CopyObject with an encoded CopySource; every copy read back (HEAD) and
    compared by size and ETag (size only for multipart ETags); a second run skips what is already there;
    objects over 5 GB are reported and left out; `--switch` saves S3_BUCKET/S3_PREFIX in instance settings
    (or prints them when the environment owns them). Refuses an install already in prefix mode.
  - **MinIO in CI**: a `docker run minio/minio:latest server /data` step in the integration job (a service
    container cannot be given that command) and `S3_TEST_*` env; the suite skips when `S3_TEST_ENDPOINT` is
    unset. The same scenarios run against an in-memory S3 in the unit suite.
- Tests: new `storage-s3-layout`, `storage-usage-counter`, `storage-migrate`, `storage-disk-usage`,
  `storage-type-s3`, `conventions/s3-layout`; updated `instance-settings-catalog`, `content-security-policy`,
  `storage-verified-bucket`, `screenshot-retention-own-keys`. The 44 related storage, upload, instance,
  email and company suites pass; `upload-routes-order` fails as on clean staging (Windows path separators).
