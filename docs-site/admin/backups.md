# Backup and restore

How to back up an AlianHub instance, restore it, and prove that the backups work. Everything lives in two places: MongoDB (every workspace's data) and, with `STORAGE_TYPE=server`, the `storage/` folder of uploaded files. A backup must cover both.

## Take a backup in the app

1. Open **Settings › Instance › Backups**.
2. Tick **Include uploaded files** to add `storage/` (only with `STORAGE_TYPE=server`; files in a bucket are not included).
3. Start the backup. The archive appears in the list when it is done.
4. **Download** it, or copy it off the `backups/` volume. Keep at least one copy off the host.

The archive is a `.tar.gz` named `alianhub-<version>-<YYYYMMDD>-<HHMMSS>.tar.gz`, written to `BACKUP_DIR` (`backups/` in the app folder; the `alianhub_backups` volume, `/app/backups`, in Docker). It holds `manifest.json` first (date, version, workspaces, whether files are included), then every collection of every database as JSON lines (`global/users.jsonl`, `<companyId>/tasks.jsonl`, ...) in MongoDB's extended JSON, so ids and dates survive the round trip.

::: warning Archives are not encrypted
A backup holds everything: password hashes, encrypted secrets, every task and file. Keep `backups/` on an encrypted volume and encrypt any copy that leaves the host, for example with `gpg --symmetric`. See [Security](./security#backups-are-not-encrypted).
:::

## Schedule backups

The app does not take backups on a timer. Use cron (or a systemd timer) with `INSTANCE_ADMIN_KEY`, which lets a script call the Instance API without a browser session:

1. Set a long random `INSTANCE_ADMIN_KEY` in `.env` and restart.
2. Add a cron job on the host:

   ```bash
   # /etc/cron.d/alianhub-backup — every night at 02:00
   0 2 * * * root curl -s -X POST -H "adminkey: <your INSTANCE_ADMIN_KEY>" -H 'content-type: application/json' -d '{}' http://localhost:4000/api/v2/instance/backups
   ```

3. Copy new archives off the host with your usual tool (`rclone`, `rsync`, `aws s3 cp`) and delete old ones, from the Backups page or with `DELETE /api/v2/instance/backups/<name>`. The app keeps every archive until you delete it.

To include uploaded files, send `-d '{"includeFiles":true}'` instead of `-d '{}'`.

## Restore

1. Open **Settings › Instance › Backups** and choose an archive. The list shows the archives in `BACKUP_DIR`; to restore one taken elsewhere, copy it there first (in Docker: `docker cp alianhub-….tar.gz <project>-app-1:/app/backups/`).
2. Read its manifest (date, version, workspaces) and type its name to confirm.

A restore then:

1. takes a safety backup of the current state (`pre-restore-*`);
2. switches the API to maintenance: every call except `/health` and the Instance console answers 503, and open tabs show a banner and recover on their own;
3. drops every collection of each database named in the archive, including collections created after the backup, refills the ones the archive holds, and restores the files if they were included;
4. reruns migrations, clears caches and reconnects to the database.

Rules:

- Restore an archive taken by the same or an **older** version, never a newer one.
- A restore replaces each database the archive names. Workspaces created after the backup, which the archive does not name, are left as they are.
- Encryption keys are not in the archive. Restore with the same `JWT_SECRET` (and `SECRETS_KEY`, `TWO_FACTOR_ENC_KEY`, `AUDIT_CHAIN_KEY` if you use them), or stored secrets will not decrypt.

## The restore drill

A backup you have never restored is a guess. Restore one on a throwaway instance regularly:

1. Install a second copy. On the same Docker host, give it its own folder, `.env` and project name:

   ```bash
   mkdir ~/alianhub-drill && cd ~/alianhub-drill
   cp ~/alianhub/docker-compose.yml .
   echo "JWT_SECRET=<the same JWT_SECRET as production>" > .env
   APP_PORT=4001 docker compose -p drill up -d
   ```

2. Copy the archive into the drill: `docker cp alianhub-….tar.gz drill-app-1:/app/backups/`. Open `http://<host>:4001`, complete setup with a throwaway owner, and restore the archive from **Settings › Instance › Backups**.
3. Log in with a real account and open a few projects, tasks and attachments.
4. Remove the drill: `docker compose -p drill down -v`.

Never run the drill with `docker-compose.legacy.yml` loaded: that file fixes the volume names, so the drill would attach to the live data and restoring there would overwrite it.

## Other ways to back up

**mongodump.** MongoDB's own tool backs up the same data:

```bash
mongodump --uri "mongodb://localhost:27017" --gzip --archive=alianhub-$(date +%F).archive.gz
mongorestore --uri "mongodb://localhost:27017" --gzip --archive=alianhub-2026-11-02.archive.gz --drop
```

In Docker, run it inside the database container: `docker compose exec -T mongo mongodump --gzip --archive > alianhub-$(date +%F).archive.gz`. With `STORAGE_TYPE=server`, copy `storage/` as well.

**Volume snapshots.** Docker users can snapshot the volumes (`<project>_alianhub_mongo_data`, `<project>_alianhub_storage`, `<project>_alianhub_backups`). Stop the stack first, or the database files may be caught mid-write.

**Files in a bucket.** With S3-compatible storage the files are not in any of these backups. Turn on versioning or replication on the bucket, or copy it on a schedule.

## Related

- [Upgrades](./upgrades)
- [File storage](./storage)
- [Security](./security)
