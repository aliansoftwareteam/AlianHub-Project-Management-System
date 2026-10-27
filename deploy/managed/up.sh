#!/usr/bin/env bash
# up.sh <instanceDir>
#
# Pulls and starts one tenant stack (compose.yml rendered by render.js, .env written by the host
# agent) and waits until the app is healthy and GET /api/v2/platform/status reports dbOk.
# Safe to run again on a running stack: it changes only what compose.yml changed.
#
# stdout, one line:  {"ok":true,"version":"14.40.0","ms":41230}
#                    {"ok":false,"code":4,"error":"unhealthy","problems":["…"],"ms":…}
# exit: 0 ok · 2 bad .env / compose.yml · 3 pull failed · 4 unhealthy (last 50 app log lines on
#       stderr) · 5 host not ready (no Docker, no edge network)
#
# UP_TIMEOUT                seconds to wait for ready (default 120)
# DOCKER_CONFIG             directory with the short-lived registry credentials the host agent minted
# ALIANHUB_FALLBACK_IMAGE   repository tried with the same digest when the pinned one cannot be pulled
#                           (default ghcr.io/aliansoftwareteam/alianhub)
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)

pinned_image() {
    sed -n 's/^    image: \([^ ]*@sha256:[a-f0-9]\{64\}\)$/\1/p' "$INSTANCE_DIR/compose.yml" | head -n 1
}

# Rewrites compose.yml so it names the image that actually runs; the digest never changes, so the
# stored file still recreates exactly this stack.
use_image() {
    local tmp="$INSTANCE_DIR/compose.yml.tmp-$$"
    sed "s|^    image: [^ ]*@sha256:[a-f0-9]\{64\}\$|    image: $1|" "$INSTANCE_DIR/compose.yml" >"$tmp"
    chmod 444 "$tmp"
    mv -f "$tmp" "$INSTANCE_DIR/compose.yml"
}

pull_app() {
    local image repo digest
    compose pull --policy missing --quiet app 1>&2 && return 0
    image=$(pinned_image)
    repo=${image%@*}
    digest=${image#*@}
    if [[ -n $image && $repo != "$FALLBACK_IMAGE" ]]; then
        log "pulling ${repo} failed; trying ${FALLBACK_IMAGE} with the same digest"
        use_image "${FALLBACK_IMAGE}@${digest}"
        compose pull --policy missing --quiet app 1>&2 && return 0
        fail "$EXIT_PULL" pull_failed "could not pull the app image from ${repo} or ${FALLBACK_IMAGE}"
    fi
    fail "$EXIT_PULL" pull_failed "could not pull the app image ${image}"
}

open_instance "${1:-}"
validate_env
require_host
require_edge

pull_app
compose pull --policy missing --quiet mongo 1>&2 || fail "$EXIT_PULL" pull_failed "could not pull the mongo image"

if ! compose up --detach --remove-orphans --pull never 1>&2; then
    app_logs_to_stderr
    fail "$EXIT_UNHEALTHY" start_failed "docker compose up failed"
fi

if version=$(wait_ready "${UP_TIMEOUT:-120}"); then
    printf '{"ok":true,"version":%s,"ms":%s}\n' "$(json_string "$version")" "$(elapsed_ms)"
else
    app_logs_to_stderr
    fail "$EXIT_UNHEALTHY" unhealthy "$version"
fi
