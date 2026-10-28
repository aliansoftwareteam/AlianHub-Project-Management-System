#!/usr/bin/env bash
# platform-call.sh <instanceDir> <METHOD> <path> [body.json | -]
#
# Sends one platform API request to a tenant from inside its own app container: it never crosses
# the edge, and the key is the PLATFORM_API_KEY the container already holds. The manual path for
# the M2 beta and the smoke test; the host agent (069) does the same over the edge network.
#
#   platform-call.sh /srv/alianhub/tenants/ins_… GET /api/v2/platform/status
#   platform-call.sh /srv/alianhub/tenants/ins_… POST /api/v2/platform/provision provision.json
#
# stdout: the response body as the app sent it; stderr: "HTTP <status>".
# exit: 0 2xx · 1 other status · 2 bad arguments or no answer · 5 host not ready
# PLATFORM_REQUEST_ID, when set, is sent as x-request-id (the job id and step).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STARTED_MS=$(now_ms)
open_instance "${1:-}"
method=${2:-}
path=${3:-}
body=${4:-}
[[ $method =~ ^(GET|POST|PUT|PATCH|DELETE)$ ]] || fail "$EXIT_BAD_ENV" usage "METHOD must be GET, POST, PUT, PATCH or DELETE"
[[ $path =~ ^/api/v2/(platform|instance)(/[A-Za-z0-9._~%/?=\&-]*)?$ ]] || fail "$EXIT_BAD_ENV" usage "path must be under /api/v2/platform or /api/v2/instance"
[[ -z $body || $body == - || -f $body ]] || fail "$EXIT_BAD_ENV" usage "body file does not exist"
require_host

case $body in
    '') platform_request "$method" "$path" </dev/null ;;
    -) platform_request "$method" "$path" ;;
    *) platform_request "$method" "$path" <"$body" ;;
esac
