#!/usr/bin/env bash
# restart.sh <instanceDir> [service…]
#
# Restarts the app (or the services named) of a running stack, e.g. after PUT /config answered
# restartRequired, and waits until it is ready again, exactly as up.sh does.
#
# stdout, one line: {"ok":true,"version":"…","ms":…}
# exit: 0 ok · 1 compose failed · 2 bad arguments · 4 unhealthy · 5 host not ready
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)
open_instance "${1:-}"
shift || true
services=("$@")
(( ${#services[@]} )) || services=(app)
for service in "${services[@]}"; do
    [[ $service == app || $service == mongo ]] || fail "$EXIT_BAD_ENV" usage "service must be app or mongo"
done
require_host

compose restart --timeout 20 "${services[@]}" 1>&2 || fail "$EXIT_FAILED" restart_failed "docker compose restart failed"

if version=$(wait_ready "${UP_TIMEOUT:-120}"); then
    printf '{"ok":true,"version":%s,"ms":%s}\n' "$(json_string "$version")" "$(elapsed_ms)"
else
    app_logs_to_stderr
    fail "$EXIT_UNHEALTHY" unhealthy "$version"
fi
