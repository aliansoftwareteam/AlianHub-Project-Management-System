#!/usr/bin/env bash
# restore.sh <instanceDir> <presigned GET URL | -> [sha256]
#
# Puts the tenant's databases back to one backup made by backup.sh. The archive is downloaded to a
# temporary file and checked (gzip integrity, and the sha256 when given) before anything is
# touched; then the app is stopped, every tenant database is dropped so nothing newer than the
# backup survives, mongorestore --drop --archive --gzip runs inside the stack's mongo container,
# and the app is started and waited for exactly as up.sh does.
# On exit 1 the app stays stopped: the database is partly restored and must not take writes until
# a restore succeeds (this archive again, or the pre-restore backup).
#
# stdout, one line: {"ok":true,"bytes":52133,"version":"14.40.0","ms":…}
# exit: 0 ok · 1 restore failed · 2 bad arguments · 4 unhealthy after the restore (last 50 app log
#       lines on stderr) · 5 host not ready · 6 download failed or the archive is damaged
#
# BACKUP_TMPDIR, TRANSFER_TIMEOUT   as in backup.sh
# UP_TIMEOUT                        seconds to wait for ready after the restore (default 180)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

readonly DROP_TENANT_DATABASES_JS='
const system = ["admin", "config", "local"];
for (const { name } of db.adminCommand({ listDatabases: 1, nameOnly: true }).databases) {
    if (system.includes(name)) continue;
    db.getSiblingDB(name).dropDatabase();
    print(`dropped ${name}`);
}
'

STARTED_MS=$(now_ms)
open_instance "${1:-}"
read_url "${2:-}"
expected=${3:-}
[[ -z $expected || $expected =~ ^[a-f0-9]{64}$ ]] || fail "$EXIT_BAD_ENV" usage "sha256 must be 64 lowercase hex characters"
require_host

stage_file restore
transfer --output "$STAGED" || fail "$EXIT_TRANSFER" download_failed "$TRANSFER_ERROR"
bytes=$(file_bytes "$STAGED")
(( bytes > 0 )) || fail "$EXIT_TRANSFER" bad_archive "the downloaded archive is empty"
if [[ -n $expected && $(sha256_of "$STAGED") != "$expected" ]]; then
    fail "$EXIT_TRANSFER" bad_archive "the downloaded archive does not match its sha256"
fi
if command -v gzip >/dev/null 2>&1 && ! gzip -t "$STAGED" 2>/dev/null; then
    fail "$EXIT_TRANSFER" bad_archive "the downloaded archive is not a complete gzip stream"
fi
log "downloaded ${bytes} bytes; stopping the app"

compose up --detach --wait --no-deps --pull never mongo 1>&2 || fail "$EXIT_FAILED" restore_failed "the mongo container did not start"
compose stop --timeout 20 app 1>&2 || fail "$EXIT_FAILED" restore_failed "could not stop the app"

compose exec -T mongo mongosh --quiet --eval "$DROP_TENANT_DATABASES_JS" 1>&2 </dev/null ||
    fail "$EXIT_FAILED" restore_failed "could not drop the current databases (the app is stopped)"
compose exec -T mongo mongorestore --archive --gzip --drop --stopOnError --quiet <"$STAGED" 1>&2 ||
    fail "$EXIT_FAILED" restore_failed "mongorestore failed (the app is stopped)"
log "restored; starting the app"

compose up --detach --no-deps --pull never app 1>&2 || fail "$EXIT_FAILED" restore_failed "could not start the app"
if version=$(wait_ready "${UP_TIMEOUT:-180}"); then
    printf '{"ok":true,"bytes":%s,"version":%s,"ms":%s}\n' "$bytes" "$(json_string "$version")" "$(elapsed_ms)"
else
    app_logs_to_stderr
    fail "$EXIT_UNHEALTHY" unhealthy "$version"
fi
