# File storage

Where AlianHub keeps uploaded files: task attachments, comment and chat files, form uploads, avatars, time-tracker screenshots and export files. Choose before your team uploads much, because switching later means copying files.

## The two drivers

| `STORAGE_TYPE` | Files live | Good for |
|---|---|---|
| `server` | on the app's own disk, under `storage/` in the app folder (the `alianhub_storage` volume in Docker, mounted at `/app/storage`) | one host, simple backups, no outside account |
| `s3` (or `wasabi`, the older name) | in an S3-compatible bucket: Amazon S3, DigitalOcean Spaces, Wasabi, MinIO and others | several app hosts, large volumes, keeping files off the server |

`s3` and `wasabi` are the same driver. The Docker image and `npm run setup` default to `server`; the code's own default, when nothing sets it, is `wasabi`, so always set it.

Set it under **Settings › Instance › Settings › Storage** (**Storage driver**) or in `.env`. Changing the driver needs a restart and does not move existing files.

## On the server's disk

```bash
STORAGE_TYPE=server
```

- Files are written under `storage/`, served by the app from its own origin through signed links.
- Every upload response carries `X-Content-Type-Options: nosniff` and a sandboxing content security policy. Images (including SVG), PDF, plain text, audio and video preview inline; any other type (scripts, HTML, XML, unknown) downloads as `application/octet-stream`, so an uploaded HTML file cannot run in your domain.
- The directory must be writable by the user the app runs as (`node`, uid 1000, in Docker). **Test** under Storage checks that, and the Health tab shows the free space.
- Back it up with the database: tick **Include uploaded files** in **Settings › Instance › Backups**, or copy `storage/` yourself. See [Backup and restore](./backups).

## In an S3-compatible bucket

The recommended layout is **one bucket for everything, under a key prefix** (prefix mode). Create a private bucket and an access key that may read, write, list and delete in it, then set:

| Field | Key | Example |
|---|---|---|
| Storage address | `S3_ENDPOINT` | empty for Amazon S3; `https://blr1.digitaloceanspaces.com`; `https://s3.ap-southeast-1.wasabisys.com`; `http://minio:9000` |
| Region | `S3_REGION` | `us-east-1`, `blr1` |
| Bucket | `S3_BUCKET` | `alianhub-files` |
| Key prefix | `S3_PREFIX` | `prod/` (optional) |
| Access key | `S3_ACCESS_KEY` | |
| Secret key | `S3_SECRET_KEY` | |
| Bucket in the path | `S3_FORCE_PATH_STYLE` | `true` for MinIO and servers that cannot take the bucket in the host name |
| Public files address | `S3_PUBLIC_BASE_URL` | optional CDN address for public files such as email images |

```bash
STORAGE_TYPE=s3
S3_ENDPOINT=https://blr1.digitaloceanspaces.com
S3_REGION=blr1
S3_BUCKET=alianhub-files
S3_PREFIX=prod/
S3_ACCESS_KEY=<access key>
S3_SECRET_KEY=<secret key>
```

In prefix mode, workspace files go to `<S3_PREFIX><companyId>/…` and avatars and public files to `<S3_PREFIX>public/…`. AlianHub never creates or deletes a bucket, and the bucket itself is never made public: files are served through signed links, and public files through `S3_PUBLIC_BASE_URL` when you set one (it should serve `<S3_BUCKET>/<S3_PREFIX>public/`).

### One prefix per instance

Several instances (staging and production, or several customers) can share one bucket safely when each has its own `S3_PREFIX`, such as `prod/`, `staging/` or `ins_01jd3k8w/`. A prefix is names joined by single slashes; a trailing slash is added when missing, and empty, `.` and `..` parts are refused.

### Provider notes

| Provider | Storage address | Region |
|---|---|---|
| Amazon S3 | leave empty | the bucket's region, such as `eu-west-1` |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` | `blr1`, `nyc3`, `fra1`, ... |
| Wasabi | `https://s3.<region>.wasabisys.com` | `ap-southeast-1`, `us-east-1`, ... |
| MinIO | your server, such as `http://minio:9000` | `us-east-1` unless you changed it; turn on **Bucket in the path** |

A new access key or address applies to the next request without a restart. **Test** checks that the bucket answers with the values you typed.

### A bucket per workspace (older layout)

With `S3_BUCKET` empty, each workspace keeps its own bucket, named after its id, which the app creates, and avatars and public files go to `USERPROFILEBUCKET`. Installs that started on Wasabi use this layout with the older variable names (`WASABI_ACCESS_KEY`, `WASABI_SECRET_ACCESS_KEY`, `WASABIENDPOINT`, `WASABI_REGION`, `IAM_ENDPOINT`, `WASABI_USERID`), which are still read when the `S3_*` ones are empty. Prefer prefix mode for new installs.

## Move from a bucket per workspace to one bucket

`npm run storage:migrate` copies every workspace bucket to `<prefix><companyId>/` and `USERPROFILEBUCKET` to `<prefix>public/`, server side, and reads every copy back to compare size and checksum. The database is not touched: it stores keys relative to each area, which stay the same.

```bash
# 1. Dry run: list what would be copied
npm run storage:migrate -- --to-prefix --bucket alianhub-files --prefix prod/

# 2. Copy (safe to stop and run again; copied objects are skipped)
npm run storage:migrate -- --to-prefix --bucket alianhub-files --prefix prod/ --apply

# 3. Turn on maintenance (Settings › Instance › Health › Enter maintenance), copy what is new, then switch
npm run storage:migrate -- --to-prefix --bucket alianhub-files --prefix prod/ --apply --switch
```

`--switch` saves `S3_BUCKET` and `S3_PREFIX` in the instance settings, only after an `--apply` with nothing failed. Restart the server afterwards and leave maintenance. `--only <companyId,...>` limits a run to some workspaces. The old buckets are left for you to delete once you have checked the new layout. In Docker, run the commands with `docker compose exec app npm run storage:migrate -- ...`.

## Move between the server's disk and a bucket

There is no built-in command for this. On disk each workspace has a folder named after its id (`storage/<companyId>/…`), which matches its area in the bucket (`<S3_PREFIX><companyId>/…`); public files sit in `storage/USER_PROFILES/` on disk and under `<S3_PREFIX>public/` in a bucket. The usual way is:

1. Enter maintenance mode so nobody uploads.
2. Copy each workspace folder with a tool such as `rclone` or `aws s3 sync`, for example `storage/<companyId>/` to `s3://<bucket>/<prefix><companyId>/`, and the public files likewise (or the other way round).
3. Change the driver and the `S3_*` settings, restart, leave maintenance.
4. Open a few tasks with attachments to check, before deleting the old copy.

Test this on a copy of the instance first; see the restore drill in [Backup and restore](./backups).

## Limits and related settings

| Key | Default | Meaning |
|---|---|---|
| `UPLOAD_MAX_FILES` | `20` | files per upload request |
| `UPLOAD_MAX_FILE_BYTES` | | largest single upload |
| `MAX_IMAGE_FILE_BYTES` | `26214400` (25 MB) | largest image accepted for processing |
| `MAX_IMAGE_PIXELS` | `50000000` | decompression-bomb guard for images |
| `FORM_MAX_FILES`, `FORM_MAX_FILE_BYTES` | `3` | attachments on a public form submission |
| `TRACKSHOT_RETENTION_DAYS` | `180` | days to keep time-tracker screenshots |
| `STORAGE_DOWNLOAD_SCOPE` | `report` | `enforce` issues a download link only for a file attached to something the caller may open; `report` logs what enforce would refuse |
| `S3_CONNECTION_TIMEOUT_MS`, `S3_SOCKET_TIMEOUT_MS` | | timeouts for bucket calls |

Behind nginx, also raise `client_max_body_size`; see [HTTPS and reverse proxy](./https).

## Google Drive and Dropbox attachments

Separate from where uploads are stored, people can attach files from Google Drive or Dropbox. Each person connects their own Google account (with Drive ticked) or Dropbox account under **AI › Customize › Connectors**, so nothing is shared between members. The server needs the `google` or `dropbox` connector switched on and its app registered; see [Connectors setup](./connectors). `CLOUD_STORAGE_MAX_IMPORT_BYTES` caps what "Import a copy" copies into a project (100 MB by default).

## Related

- [Backup and restore](./backups)
- [Connectors setup](./connectors)
- [The Instance console](./instance-console)
- [Environment variables](./env-reference#storage)
