#!/usr/bin/env bash
# down.sh <instanceDir>
#
# Stops one tenant stack and removes its containers and private network. Volumes (database, logs,
# backups) stay; up.sh starts it again.
#
# stdout, one line: {"ok":true,"ms":…}
# exit: 0 ok · 1 compose failed · 2 bad arguments · 5 host not ready
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)
open_instance "${1:-}"
require_host

compose down --remove-orphans --timeout 30 1>&2 || fail "$EXIT_FAILED" down_failed "docker compose down failed"
printf '{"ok":true,"ms":%s}\n' "$(elapsed_ms)"
