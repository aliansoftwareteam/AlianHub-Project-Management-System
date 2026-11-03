#!/usr/bin/env bash
# backup.sh <instanceDir> <presigned PUT URL | ->
#
# Dumps the tenant's databases with mongodump --archive --gzip inside the stack's own mongo
# container into a temporary file on the host, then uploads it with one PUT to the presigned URL
# the control plane minted for that one object. The upload is not streamed because S3 needs the
# length up front. The host holds no backups credentials: it can add this object and nothing else.
# "-" reads the URL from the first line of stdin, which keeps it out of the process list.
#
# stdout, one line: {"ok":true,"bytes":52133,"sha256":"…","ms":…}
# exit: 0 ok · 1 dump failed (mongo did not start, mongodump error) · 2 bad arguments · 5 host
#       not ready · 6 upload failed
#
# BACKUP_TMPDIR      where the archive is staged (default $TMPDIR or /tmp); needs room for one dump
# TRANSFER_TIMEOUT   seconds the upload may take (default 3600)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)
open_instance "${1:-}"
read_url "${2:-}"
require_host

# A stopped stack (cancelled, or about to be deleted) still gets its final backup: mongo is
# started alone for the dump and stopped again; the app stays down.
started_mongo=0
if ! service_running mongo; then
    log "mongo is not running; starting it alone for the dump"
    compose up --detach --wait --no-deps --pull never mongo 1>&2 ||
        fail "$EXIT_FAILED" dump_failed "the mongo container is not running and did not start"
    started_mongo=1
fi

stage_file backup
dumped=1
compose exec -T mongo mongodump --archive --gzip --quiet </dev/null >"$STAGED" || dumped=0
if (( started_mongo )); then
    compose stop --timeout 30 mongo 1>&2 || log "warning: could not stop mongo again"
fi
(( dumped )) || fail "$EXIT_FAILED" dump_failed "mongodump failed"
bytes=$(file_bytes "$STAGED")
(( bytes > 0 )) || fail "$EXIT_FAILED" dump_failed "mongodump wrote nothing"
sha256=$(sha256_of "$STAGED")
log "dumped ${bytes} bytes, uploading"

transfer --upload-file "$STAGED" --output /dev/null || fail "$EXIT_TRANSFER" upload_failed "$TRANSFER_ERROR"
printf '{"ok":true,"bytes":%s,"sha256":%s,"ms":%s}\n' "$bytes" "$(json_string "$sha256")" "$(elapsed_ms)"
