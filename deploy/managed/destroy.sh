#!/usr/bin/env bash
# destroy.sh <instanceDir> --yes-delete-data [--keep-files]
#
# Deletes one tenant stack for good: containers, network, every volume (the database included)
# and, unless --keep-files, the instance directory with its .env. Files in object storage are not
# touched; the orchestrator removes them (069). Take the final backup first.
#
# stdout, one line: {"ok":true,"ms":…}
# exit: 0 ok · 1 compose failed · 2 bad arguments · 5 host not ready
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)
confirmed=0
keep_files=0
dir=
for arg in "$@"; do
    case $arg in
        --yes-delete-data) confirmed=1 ;;
        --keep-files) keep_files=1 ;;
        --*) fail "$EXIT_BAD_ENV" usage "unknown option $arg" ;;
        *) [[ -z $dir ]] || fail "$EXIT_BAD_ENV" usage "one instance directory only"; dir=$arg ;;
    esac
done
open_instance "$dir"
(( confirmed )) || fail "$EXIT_BAD_ENV" usage "destroy deletes the tenant's database and files; pass --yes-delete-data"
require_host

compose down --volumes --remove-orphans --timeout 30 1>&2 || fail "$EXIT_FAILED" destroy_failed "docker compose down --volumes failed"

mapfile -t leftover < <(docker volume ls --quiet --filter "label=com.docker.compose.project=${PROJECT}")
if (( ${#leftover[@]} )); then
    docker volume rm "${leftover[@]}" 1>&2 || fail "$EXIT_FAILED" destroy_failed "could not remove volumes: ${leftover[*]}"
fi

(( keep_files )) || rm -rf -- "$INSTANCE_DIR"
printf '{"ok":true,"ms":%s}\n' "$(elapsed_ms)"
