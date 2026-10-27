# Progress: Shared S3 storage — one driver for Spaces/Wasabi/S3, a prefix per instance, hot key reload, usage counter

## Checklist

- [ ] T1 — Provider-neutral `S3_*` configuration with Wasabi fallbacks
- [ ] T2 — Layout module: bucket-per-company and prefix modes; convention test
- [ ] T3 — One S3 client factory with hot reload
- [ ] T4 — `storage_usage` counter and nightly reconciliation
- [ ] T5 — `storage:migrate --to-prefix`
- [ ] T6 — Workspace deletion clears its prefix
- [ ] T7 — Unit, MinIO integration and convention tests

## Last step

Not yet started.

## Blockers

None for the app work. Q26 (Wasabi with a prefix per instance, the default, or Spaces with a bucket
per host) only changes what the orchestrator pushes; the app supports both.

## Log

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
