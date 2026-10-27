# shellcheck shell=bash disable=SC2034
# Shared by up.sh, down.sh, restart.sh, destroy.sh and platform-call.sh. Every script prints
# exactly one JSON line on stdout (what the host agent parses); everything for people goes to stderr.

readonly EXIT_OK=0
readonly EXIT_FAILED=1
readonly EXIT_BAD_ENV=2
readonly EXIT_PULL=3
readonly EXIT_UNHEALTHY=4
readonly EXIT_HOST=5

readonly INSTANCE_ID_RX='^ins_[a-z0-9]{20,32}$'
readonly EDGE_NETWORK=edge
readonly FALLBACK_IMAGE=${ALIANHUB_FALLBACK_IMAGE:-ghcr.io/aliansoftwareteam/alianhub}

STARTED_MS=0
INSTANCE_DIR=
INSTANCE_ID=
PROJECT=
declare -A ENV_VALUES=()

log() { printf '%s\n' "$*" >&2; }

now_ms() {
    local t
    t=$(date +%s%3N 2>/dev/null || true)
    [[ $t =~ ^[0-9]+$ ]] || t=$(( $(date +%s) * 1000 ))
    printf '%s' "$t"
}

elapsed_ms() { printf '%s' $(( $(now_ms) - STARTED_MS )); }

json_string() {
    local s=$1
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\n'/\\n}
    s=${s//$'\r'/}
    s=${s//$'\t'/ }
    printf '"%s"' "$s"
}

json_array() {
    local first=1 item
    printf '['
    for item in "$@"; do
        (( first )) || printf ','
        first=0
        json_string "$item"
    done
    printf ']'
}

# fail <exit code> <error word> [problem...]
fail() {
    local code=$1 error=$2
    shift 2
    printf '{"ok":false,"code":%s,"error":%s,"problems":%s,"ms":%s}\n' \
        "$code" "$(json_string "$error")" "$(json_array "$@")" "$(elapsed_ms)"
    exit "$code"
}

# Takes the directory, never a project name: the instance id comes from the path the host agent
# owns (/srv/alianhub/tenants/<instanceId>), so a script cannot be pointed at another tenant's stack.
open_instance() {
    local dir=${1:-}
    [[ -n $dir ]] || fail "$EXIT_BAD_ENV" usage "usage: $(basename "$0") <instanceDir>"
    [[ -d $dir ]] || fail "$EXIT_BAD_ENV" bad_env "instance directory does not exist"
    INSTANCE_DIR=$(cd "$dir" && pwd -P)
    INSTANCE_ID=$(basename "$INSTANCE_DIR")
    [[ $INSTANCE_ID =~ $INSTANCE_ID_RX ]] || fail "$EXIT_BAD_ENV" bad_env "instance directory must be named after the instance id (ins_...)"
    [[ -f $INSTANCE_DIR/compose.yml ]] || fail "$EXIT_BAD_ENV" bad_env "compose.yml is missing (render it first)"
    PROJECT="t_${INSTANCE_ID}"
}

# The env file is parsed, never sourced: values are secrets written by the control plane and must
# not be able to run anything.
read_env_file() {
    local file=$1 line key value
    ENV_VALUES=()
    while IFS= read -r line || [[ -n $line ]]; do
        line=${line%$'\r'}
        [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
        line=${line#export }
        [[ $line =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
        key=${BASH_REMATCH[1]}
        value=${BASH_REMATCH[2]}
        if [[ $value =~ ^\"(.*)\"[[:space:]]*$ || $value =~ ^\'(.*)\'[[:space:]]*$ ]]; then
            value=${BASH_REMATCH[1]}
        else
            value=${value%%[[:space:]]#*}
            value=${value#"${value%%[![:space:]]*}"}
            value=${value%"${value##*[![:space:]]}"}
        fi
        ENV_VALUES[$key]=$value
    done <"$file"
}

env_value() { printf '%s' "${ENV_VALUES[$1]-}"; }

decoded_length() {
    local text=$1 pad
    text=${text//-/+}
    text=${text//_//}
    pad=$(( (4 - ${#text} % 4) % 4 ))
    (( pad == 3 )) && { printf '0'; return; }
    text+=$(printf '%*s' "$pad" '' | tr ' ' '=')
    printf '%s' "$text" | base64 -d 2>/dev/null | wc -c | tr -d ' '
}

decoded_hex_prefix() {
    local text=$1 pad
    text=${text//-/+}
    text=${text//_//}
    pad=$(( (4 - ${#text} % 4) % 4 ))
    text+=$(printf '%*s' "$pad" '' | tr ' ' '=')
    printf '%s' "$text" | base64 -d 2>/dev/null | head -c 12 | od -An -tx1 | tr -d ' \n'
}

https_host() {
    local url=$1
    [[ $url =~ ^https://([a-z0-9.-]+)(:[0-9]+)?/?$ ]] || return 1
    printf '%s' "${BASH_REMATCH[1]}"
}

# Mirrors the boot checks of Config/hostingMode.js (task 061) plus what only the host can see,
# so a bad .env fails here with exit 2 instead of as a crash-looping container.
validate_env() {
    local file=$INSTANCE_DIR/.env problems=() key value web_host api_url rule_host length mode
    [[ -f $file ]] || fail "$EXIT_BAD_ENV" bad_env ".env is missing"
    read_env_file "$file"

    for key in ALIANHUB_VERSION HOSTING_MODE INSTANCE_ID PLATFORM_URL PLATFORM_PUBLIC_KEY PLATFORM_API_KEY \
        JWT_SECRET MONGODB_URL WEBURL APIURL TRUST_PROXY MIGRATIONS_AUTO; do
        [[ -n ${ENV_VALUES[$key]-} ]] || problems+=("$key is not set")
    done

    value=$(env_value ALIANHUB_VERSION)
    [[ -z $value || $value =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || problems+=("ALIANHUB_VERSION must be a semantic version")
    value=$(env_value HOSTING_MODE)
    [[ -z $value || $value == managed ]] || problems+=("HOSTING_MODE must be managed")
    value=$(env_value INSTANCE_ID)
    [[ -z $value || $value == "$INSTANCE_ID" ]] || problems+=("INSTANCE_ID does not match the instance directory")
    value=$(env_value PLATFORM_URL)
    [[ -z $value || $value =~ ^https://[^[:space:]/]+ ]] || problems+=("PLATFORM_URL must be an https:// URL")

    value=$(env_value PLATFORM_PUBLIC_KEY)
    if [[ -n $value ]]; then
        if [[ ! $value =~ ^[A-Za-z0-9+/_-]+={0,2}$ ]]; then
            problems+=("PLATFORM_PUBLIC_KEY must be base64 of an Ed25519 public key (raw 32 bytes or SPKI DER)")
        else
            length=$(decoded_length "${value%%=*}")
            if [[ $length == 44 ]]; then
                [[ $(decoded_hex_prefix "${value%%=*}") == 302a300506032b6570032100 ]] ||
                    problems+=("PLATFORM_PUBLIC_KEY is SPKI DER but not an Ed25519 key")
            elif [[ $length != 32 ]]; then
                problems+=("PLATFORM_PUBLIC_KEY must be base64 of an Ed25519 public key (raw 32 bytes or SPKI DER)")
            fi
        fi
    fi

    value=$(env_value PLATFORM_API_KEY)
    [[ -z $value || ( ${#value} -ge 32 && $value =~ ^[A-Za-z0-9_-]+$ ) ]] ||
        problems+=("PLATFORM_API_KEY must be at least 32 base64url characters")
    value=$(env_value JWT_SECRET)
    [[ -z $value || ${#value} -ge 32 ]] || problems+=("JWT_SECRET must be at least 32 characters")
    value=$(env_value MONGODB_URL)
    [[ -z $value || $value =~ ^mongodb://mongo:27017/?$ ]] ||
        problems+=("MONGODB_URL must be mongodb://mongo:27017 (the stack's own server, no database name)")
    value=$(env_value TRUST_PROXY)
    [[ -z $value || $value =~ ^[0-9]+$ ]] || problems+=("TRUST_PROXY must be a number of proxies")
    value=$(env_value MIGRATIONS_AUTO)
    [[ -z $value || $value == true || $value == false ]] || problems+=("MIGRATIONS_AUTO must be true or false")

    value=$(env_value WEBURL)
    if [[ -n $value ]]; then
        if web_host=$(https_host "$value") && [[ $value != */ ]]; then
            api_url=$(env_value APIURL)
            [[ -z $api_url || $api_url == "$value/" ]] || problems+=("APIURL must be WEBURL followed by /")
            rule_host=$(sed -n 's/.*rule: Host(`\([^`]*\)`).*/\1/p' "$INSTANCE_DIR/compose.yml" | head -n 1)
            [[ $rule_host == "$web_host" ]] || problems+=("WEBURL host does not match the Host rule in compose.yml")
        else
            problems+=("WEBURL must be https://<host> with no path or trailing slash")
        fi
    fi

    grep -q "^name: ${PROJECT}\$" "$INSTANCE_DIR/compose.yml" || problems+=("compose.yml is not rendered for this instance")
    grep -Eq '^    image: [^ ]+@sha256:[a-f0-9]{64}$' "$INSTANCE_DIR/compose.yml" || problems+=("compose.yml must pin the app image by digest")

    if mode=$(stat -c '%a' "$file" 2>/dev/null) && [[ $mode != 600 && $mode != 400 ]]; then
        log "warning: $file is mode $mode; it holds secrets and should be 600"
    fi

    (( ${#problems[@]} == 0 )) || fail "$EXIT_BAD_ENV" bad_env "${problems[@]}"
}

require_host() {
    command -v docker >/dev/null 2>&1 || fail "$EXIT_HOST" host_not_ready "docker is not installed"
    docker info >/dev/null 2>&1 || fail "$EXIT_HOST" host_not_ready "the Docker daemon is not reachable"
    docker compose version >/dev/null 2>&1 || fail "$EXIT_HOST" host_not_ready "the docker compose plugin is missing"
}

require_edge() {
    docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1 ||
        fail "$EXIT_HOST" host_not_ready "the shared '$EDGE_NETWORK' network does not exist (the edge router creates it)"
}

# --env-file /dev/null: compose.yml is fully rendered, and the tenant's .env (secrets) must reach
# the container through env_file only, never steer compose itself (COMPOSE_*, interpolation).
compose() {
    docker compose --project-name "$PROJECT" --project-directory "$INSTANCE_DIR" \
        --file "$INSTANCE_DIR/compose.yml" --env-file /dev/null "$@"
}

container_of() { compose ps --all --quiet "$1" 2>/dev/null | head -n 1; }

app_logs_to_stderr() {
    log "--- last 50 lines of the app log ---"
    compose logs --no-color --tail 50 app >&2 2>&1 || true
}

# Runs inside the app container, so the request never crosses the edge (no X-Forwarded-For, which
# the platform guard refuses) and the platform key is read from the container's own environment
# instead of travelling on a command line.
readonly PLATFORM_CLIENT_JS='
const http = require("http");
const [method, path] = process.argv.slice(1);
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c)).on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { "x-platform-key": process.env.PLATFORM_API_KEY || "" };
    if (process.env.PLATFORM_REQUEST_ID) headers["x-request-id"] = process.env.PLATFORM_REQUEST_ID;
    if (body.length) Object.assign(headers, { "content-type": "application/json", "content-length": body.length });
    const req = http.request({ host: "127.0.0.1", port: process.env.PORT || 4000, method, path, headers, timeout: 15000 }, (res) => {
        const out = [];
        res.on("data", (c) => out.push(c)).on("end", () => {
            process.stdout.write(Buffer.concat(out));
            process.stderr.write(`HTTP ${res.statusCode}\n`);
            process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1);
        });
    });
    req.on("timeout", () => req.destroy(new Error("timed out"))).on("error", (e) => { process.stderr.write(`${e.message}\n`); process.exit(2); });
    req.end(body);
});
'

# platform_request <METHOD> <path> < body
platform_request() {
    compose exec -T -e "PLATFORM_REQUEST_ID=${PLATFORM_REQUEST_ID:-}" app node -e "$PLATFORM_CLIENT_JS" "$1" "$2"
}

readonly STATUS_PROBE_JS='
const http = require("http");
const say = (line) => { console.log(line); process.exit(0); };
const req = http.get({ host: "127.0.0.1", port: process.env.PORT || 4000, path: "/api/v2/platform/status",
    headers: { "x-platform-key": process.env.PLATFORM_API_KEY || "" }, timeout: 5000 }, (res) => {
    const out = [];
    res.on("data", (c) => out.push(c)).on("end", () => {
        if (res.statusCode === 404) say("WAIT GET /api/v2/platform/status answered 404: an image without the platform API, or HOSTING_MODE is not managed");
        if (res.statusCode !== 200) say(`WAIT GET /api/v2/platform/status answered ${res.statusCode}`);
        let body;
        try { body = JSON.parse(Buffer.concat(out).toString("utf8")); } catch { say("WAIT the platform status is not JSON"); }
        const data = body && typeof body.data === "object" && body.data ? body.data : body || {};
        if (data.dbOk === true) say(`READY ${data.version || ""}`);
        say("WAIT the database is not reachable yet");
    });
});
req.on("timeout", () => req.destroy(new Error("timed out"))).on("error", (e) => say(`WAIT ${e.message}`));
'

# wait_ready <timeout seconds>: app container healthy, then the platform status reports dbOk.
# Prints the running version on success.
wait_ready() {
    local timeout=$1 deadline state id health restarts status_line last=""
    deadline=$(( $(date +%s) + timeout ))
    while (( $(date +%s) < deadline )); do
        id=$(container_of app)
        if [[ -n $id ]]; then
            state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$id" 2>/dev/null || true)
            read -r _ health restarts <<<"$state"
            if [[ ${restarts:-0} -ge 3 ]]; then
                last="the app container restarted ${restarts} times (crash loop)"
                break
            fi
            if [[ $health == healthy ]]; then
                status_line=$(compose exec -T app node -e "$STATUS_PROBE_JS" </dev/null 2>/dev/null | tail -n 1 || true)
                if [[ $status_line == READY* ]]; then
                    printf '%s' "${status_line#READY }"
                    return 0
                fi
                last=${status_line#WAIT }
                last=${last:-could not run the status probe in the app container}
            else
                last="app container is ${state%% *}, health ${health:-unknown}"
            fi
        else
            last="app container does not exist"
        fi
        sleep 2
    done
    printf '%s' "${last:-timed out after ${timeout}s}"
    return 1
}
