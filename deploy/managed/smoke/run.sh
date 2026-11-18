#!/usr/bin/env bash
# run.sh — the managed-stack smoke test (task 065 T6), run by .github/workflows/managed-smoke.yml.
#
# Builds the image into a local registry (or takes SMOKE_IMAGE=<repo@sha256:…>), starts Traefik,
# an S3 server and a fake platform, brings up two tenants with render.js and up.sh, provisions and
# configures them through the platform API, signs each owner in over HTTPS through Traefik, uploads
# and exports, then proves the tenants cannot reach each other's app, database or files and that
# /api/v2/platform is refused at the edge. Needs a Linux host with Docker, sudo (iptables), node 20,
# jq, curl, openssl and the aws CLI. SMOKE_KEEP=1 leaves everything running.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MANAGED=$(dirname "$HERE")
ROOT=$(cd "$MANAGED/../.." && pwd)
WORK=${SMOKE_WORK:-$(mktemp -d)}
LOGS=$WORK/logs
TENANTS=$WORK/tenants
DOMAIN=alianhub.test
EDGE_SUBNET=172.30.0.0/24
EDGE_BRIDGE=br-edge
TRAEFIK_IP=172.30.0.2
S3_IP=172.30.0.3
REGISTRY=127.0.0.1:5000
PLATFORM_PORT=7070
MAX_WARM_UP_MS=${SMOKE_MAX_UP_MS:-60000}
S3_ADMIN_KEY=smokeadmin
S3_ADMIN_SECRET=$(openssl rand -hex 20)

declare -A ID KEY COMPANY TOKEN S3_KEY S3_SECRET UP_MS
PLATFORM_PID=

mkdir -p "$LOGS" "$TENANTS"
step() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS %s\n' "$*"; printf -- '- PASS %s\n' "$*" >>"$WORK/summary.md"; }
die() { printf 'FAIL %s\n' "$*" >&2; printf -- '- **FAIL** %s\n' "$*" >>"$WORK/summary.md"; exit 1; }

collect_logs() {
    local name
    for name in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do
        docker logs "$name" >"$LOGS/$name.log" 2>&1 || true
    done
    cp "$WORK"/*.json "$LOGS/" 2>/dev/null || true
}

cleanup() {
    local status=$?
    collect_logs
    if [[ -n ${GITHUB_STEP_SUMMARY:-} && -f $WORK/summary.md ]]; then cat "$WORK/summary.md" >>"$GITHUB_STEP_SUMMARY"; fi
    if [[ ${SMOKE_KEEP:-} == 1 ]]; then
        echo "SMOKE_KEEP=1: leaving the stacks running in $WORK"
        return
    fi
    local dir
    for dir in "$TENANTS"/ins_*; do
        [[ -d $dir ]] && "$MANAGED/destroy.sh" "$dir" --yes-delete-data >/dev/null 2>&1 || true
    done
    [[ -n $PLATFORM_PID ]] && kill "$PLATFORM_PID" 2>/dev/null || true
    docker rm -f smoke-traefik smoke-s3 smoke-registry >/dev/null 2>&1 || true
    sudo "$HERE/edge-isolation.sh" --remove "$EDGE_BRIDGE" || true
    docker network rm edge >/dev/null 2>&1 || true
    exit "$status"
}
trap cleanup EXIT

in_edge() { curl -sk --max-time 20 --resolve "$1.$DOMAIN:443:127.0.0.1" "${@:2}"; }
call() { "$MANAGED/platform-call.sh" "$@" 2>>"$LOGS/platform-calls.log"; }
data() { jq -c '(.data // .)'; }

# probe <container> <host> <port>: prints open or closed; node is in the app image, bash in mongo's.
probe() {
    local container=$1 host=$2 port=$3
    if docker exec "$container" sh -c 'command -v node' >/dev/null 2>&1; then
        docker exec "$container" node -e "
            const s = require('net').connect({ host: '$host', port: $port, timeout: 3000 });
            s.on('connect', () => { console.log('open'); process.exit(0); });
            s.on('timeout', () => { console.log('closed'); process.exit(0); });
            s.on('error', () => { console.log('closed'); process.exit(0); });"
    else
        docker exec "$container" bash -c "timeout 3 bash -c '</dev/tcp/$host/$port' 2>/dev/null && echo open || echo closed"
    fi
}

container() { docker compose --project-name "t_${ID[$1]}" --project-directory "$TENANTS/${ID[$1]}" --file "$TENANTS/${ID[$1]}/compose.yml" --env-file /dev/null ps -q "$2"; }

wait_for() {
    local what=$1 tries=$2
    shift 2
    for _ in $(seq "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done
    die "$what"
}

echo "# Managed stack smoke" >"$WORK/summary.md"
echo '{}' >"$WORK/empty.body"

step "image"
docker run -d --name smoke-registry -p "$REGISTRY:5000" registry:2.8.3 >/dev/null
if [[ -z ${SMOKE_IMAGE:-} ]]; then
    docker build --quiet -t "$REGISTRY/alianhub:smoke" "$ROOT" >/dev/null
    docker push --quiet "$REGISTRY/alianhub:smoke" >/dev/null
    SMOKE_IMAGE=$(docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$REGISTRY/alianhub:smoke" | grep "^$REGISTRY/" | head -n 1)
fi
[[ $SMOKE_IMAGE =~ ^([^@]+)@(sha256:[a-f0-9]{64})$ ]] || die "no image digest (SMOKE_IMAGE=$SMOKE_IMAGE)"
IMAGE=${BASH_REMATCH[1]}
DIGEST=${BASH_REMATCH[2]}
VERSION=$(node -p "require('$ROOT/package.json').version")
docker image inspect "$SMOKE_IMAGE" --format '{{.Size}}' | awk '{ printf "- image size, uncompressed: %d MB\n", $1 / 1000000 }' >>"$WORK/summary.md"
pass "image $SMOKE_IMAGE"

step "edge: network, Traefik, S3, isolation rules, fake platform"
docker network create --subnet "$EDGE_SUBNET" -o "com.docker.network.bridge.name=$EDGE_BRIDGE" edge >/dev/null
docker run -d --name smoke-traefik --network edge --ip "$TRAEFIK_IP" -p 127.0.0.1:443:443 \
    -v /var/run/docker.sock:/var/run/docker.sock:ro -v "$HERE/traefik-dynamic.yml:/etc/traefik/dynamic.yml:ro" \
    traefik:v3.6 --providers.docker=true --providers.docker.exposedbydefault=false --providers.docker.network=edge \
    --providers.file.filename=/etc/traefik/dynamic.yml --entrypoints.websecure.address=:443 \
    --entrypoints.websecure.http.tls=true --log.level=INFO >/dev/null

for t in a b; do
    ID[$t]=ins_$(openssl rand -hex 16 | cut -c1-26)
    KEY[$t]=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
    S3_KEY[$t]=tenant$t$(openssl rand -hex 6)
    S3_SECRET[$t]=$(openssl rand -hex 20)
done
jq -n --arg ak "$S3_ADMIN_KEY" --arg as "$S3_ADMIN_SECRET" \
    --arg a "${S3_KEY[a]}" --arg as_a "${S3_SECRET[a]}" --arg b "${S3_KEY[b]}" --arg as_b "${S3_SECRET[b]}" '
    { identities: [
        { name: "admin", credentials: [{ accessKey: $ak, secretKey: $as }], actions: ["Admin", "Read", "List", "Tagging", "Write"] },
        { name: "tenant-a", credentials: [{ accessKey: $a, secretKey: $as_a }], actions: ["Read:tenant-a", "List:tenant-a", "Tagging:tenant-a", "Write:tenant-a"] },
        { name: "tenant-b", credentials: [{ accessKey: $b, secretKey: $as_b }], actions: ["Read:tenant-b", "List:tenant-b", "Tagging:tenant-b", "Write:tenant-b"] } ] }' >"$WORK/s3.json"
docker run -d --name smoke-s3 --network edge --ip "$S3_IP" -p 127.0.0.1:8333:8333 \
    -v "$WORK/s3.json:/etc/seaweedfs/s3.json:ro" chrislusf/seaweedfs:4.00 server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json >/dev/null
s3() { AWS_ACCESS_KEY_ID=$1 AWS_SECRET_ACCESS_KEY=$2 AWS_DEFAULT_REGION=us-east-1 aws --endpoint-url http://127.0.0.1:8333 s3 "${@:3}"; }
wait_for "the S3 server did not start" 60 s3 "$S3_ADMIN_KEY" "$S3_ADMIN_SECRET" ls
s3 "$S3_ADMIN_KEY" "$S3_ADMIN_SECRET" mb s3://tenant-a >/dev/null
s3 "$S3_ADMIN_KEY" "$S3_ADMIN_SECRET" mb s3://tenant-b >/dev/null

sudo "$HERE/edge-isolation.sh" "$EDGE_BRIDGE" "$TRAEFIK_IP" "$S3_IP"

node "$HERE/fake-platform.js" --port "$PLATFORM_PORT" --public-key-out "$WORK/platform-public.b64" >"$LOGS/fake-platform.log" 2>&1 &
PLATFORM_PID=$!
wait_for "the fake platform did not start" 15 test -s "$WORK/platform-public.b64"
pass "edge ready (Traefik $TRAEFIK_IP, S3 $S3_IP, isolation rules on $EDGE_BRIDGE)"

step "bring up two tenants"
for t in a b; do
    dir=$TENANTS/${ID[$t]}
    mkdir -p "$dir"
    jq -n --arg id "${ID[$t]}" --arg host "$t.$DOMAIN" --arg version "$VERSION" --arg image "$IMAGE" --arg digest "$DIGEST" \
        '{ instanceId: $id, hostname: $host, tier: "starter", version: $version, image: $image, imageDigest: $digest }' >"$dir/meta.json"
    cat >"$dir/.env" <<EOF
ALIANHUB_VERSION=$VERSION
HOSTING_MODE=managed
INSTANCE_ID=${ID[$t]}
PLATFORM_URL=https://account.$DOMAIN
PLATFORM_PUBLIC_KEY=$(tr -d '\n' <"$WORK/platform-public.b64")
PLATFORM_API_KEY=${KEY[$t]}
JWT_SECRET=$(openssl rand -hex 32)
MONGODB_URL=mongodb://mongo:27017
WEBURL=https://$t.$DOMAIN
APIURL=https://$t.$DOMAIN/
TRUST_PROXY=1
MIGRATIONS_AUTO=true
EOF
    chmod 600 "$dir/.env"
    node "$MANAGED/render.js" "$dir" >/dev/null || die "render.js refused tenant $t"
    "$MANAGED/up.sh" "$dir" >"$WORK/up-$t.json" 2>>"$LOGS/up-$t.log" || die "up.sh tenant $t: $(cat "$WORK/up-$t.json")"
    UP_MS[$t]=$(jq -r .ms "$WORK/up-$t.json")
    pass "tenant $t up in ${UP_MS[$t]} ms ($(jq -r .version "$WORK/up-$t.json"))"
done
[[ ${UP_MS[b]} -lt $MAX_WARM_UP_MS ]] || die "tenant b (warm host) took ${UP_MS[b]} ms, over ${MAX_WARM_UP_MS} ms"

step "up.sh exit codes"
bad=$TENANTS/ins_$(openssl rand -hex 16 | cut -c1-26)
mkdir -p "$bad"
jq --arg id "$(basename "$bad")" '.instanceId = $id' "$TENANTS/${ID[a]}/meta.json" >"$bad/meta.json"
node "$MANAGED/render.js" "$bad" >/dev/null
sed "s/^INSTANCE_ID=.*/INSTANCE_ID=$(basename "$bad")/; s/^JWT_SECRET=.*/JWT_SECRET=short/; s/^WEBURL=.*/WEBURL=https:\/\/a.$DOMAIN/" "$TENANTS/${ID[a]}/.env" >"$bad/.env"
set +e; "$MANAGED/up.sh" "$bad" >"$WORK/up-bad-env.json" 2>/dev/null; code=$?; set -e
[[ $code == 2 ]] || die "a bad .env gave exit $code, not 2"
jq --arg d "sha256:$(printf '0%.0s' $(seq 64))" '.imageDigest = $d' "$bad/meta.json" >"$bad/meta.tmp" && mv "$bad/meta.tmp" "$bad/meta.json"
node "$MANAGED/render.js" "$bad" >/dev/null
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" "$bad/.env"
set +e; "$MANAGED/up.sh" "$bad" >"$WORK/up-pull.json" 2>/dev/null; code=$?; set -e
[[ $code == 3 ]] || die "a digest no registry has gave exit $code, not 3"
jq --arg d "$DIGEST" '.imageDigest = $d | .hostname = "c.'"$DOMAIN"'"' "$bad/meta.json" >"$bad/meta.tmp" && mv "$bad/meta.tmp" "$bad/meta.json"
node "$MANAGED/render.js" "$bad" >/dev/null
sed -i "s/^WEBURL=.*/WEBURL=https:\/\/c.$DOMAIN/; s/^APIURL=.*/APIURL=https:\/\/c.$DOMAIN\//" "$bad/.env"
set +e; UP_TIMEOUT=3 "$MANAGED/up.sh" "$bad" >"$WORK/up-unhealthy.json" 2>/dev/null; code=$?; set -e
[[ $code == 4 ]] || die "a stack that is not ready in time gave exit $code, not 4"
"$MANAGED/destroy.sh" "$bad" --yes-delete-data >/dev/null
pass "up.sh exits 2 on a bad .env, 3 on a failed pull, 4 when not ready in time"

step "provision and configure through the platform API"
for t in a b; do
    dir=$TENANTS/${ID[$t]}
    jq -n --arg id "prv_smoke_$t" --arg email "owner-$t@example.com" \
        '{ provisionId: $id, owner: { email: $email, firstName: "Owner", lastName: "Smoke" }, workspace: { name: "Smoke" }, sampleData: false, locale: "en", timezone: "UTC" }' >"$WORK/provision-$t.body"
    out=$(call "$dir" POST /api/v2/platform/provision "$WORK/provision-$t.body") || die "provision tenant $t: $out"
    COMPANY[$t]=$(data <<<"$out" | jq -r .companyId)
    [[ ${COMPANY[$t]} =~ ^[a-f0-9]{24}$ ]] || die "provision tenant $t returned no companyId: $out"
    again=$(call "$dir" POST /api/v2/platform/provision "$WORK/provision-$t.body") || die "provision again, tenant $t: $again"
    [[ $(data <<<"$again" | jq -r .companyId) == "${COMPANY[$t]}" ]] || die "provision is not idempotent on tenant $t"

    jq -n --arg bucket "tenant-$t" --arg prefix "${ID[$t]}/" --arg key "${S3_KEY[$t]}" --arg secret "${S3_SECRET[$t]}" --arg endpoint "http://$S3_IP:8333" \
        '{ values: { STORAGE_TYPE: "s3", S3_ENDPOINT: $endpoint, S3_REGION: "us-east-1", S3_BUCKET: $bucket, S3_PREFIX: $prefix,
                     S3_ACCESS_KEY: $key, S3_SECRET_KEY: $secret, S3_FORCE_PATH_STYLE: "true" } }' >"$WORK/config-$t.body"
    out=$(call "$dir" PUT /api/v2/platform/config "$WORK/config-$t.body") || die "config tenant $t: $out"
    if [[ $(data <<<"$out" | jq '(.restartRequired // []) | length') -gt 0 ]]; then
        "$MANAGED/restart.sh" "$dir" >"$WORK/restart-$t.json" 2>>"$LOGS/up-$t.log" || die "restart after config, tenant $t"
    fi

    curl -s -X POST "http://127.0.0.1:$PLATFORM_PORT/sign/${ID[$t]}" -d '{}' | jq '{ token }' >"$WORK/entitlements-$t.body"
    out=$(call "$dir" PUT /api/v2/platform/entitlements "$WORK/entitlements-$t.body") || die "entitlements tenant $t: $out"
    [[ $(data <<<"$out" | jq -r .applied) == true ]] || die "entitlements not applied on tenant $t: $out"

    out=$(call "$dir" POST /api/v2/platform/owner/login-link "$WORK/empty.body") || die "login link tenant $t: $out"
    login_token=$(data <<<"$out" | jq -r '[.. | strings | select(test("token="))][0] // empty' | sed 's/.*[?&]token=//; s/&.*//')
    [[ -n $login_token ]] || die "no sign-in link for tenant $t: $out"
    out=$(in_edge "$t" -X POST "https://$t.$DOMAIN/api/v2/auth/platform-login" -H 'content-type: application/json' -d "{\"token\":\"$login_token\"}")
    TOKEN[$t]=$(jq -r '(.data // .).accessToken // empty' <<<"$out")
    [[ -n ${TOKEN[$t]} ]] || die "owner of tenant $t could not sign in through Traefik: $out"
    pass "tenant $t provisioned (company ${COMPANY[$t]}), configured, entitled, owner signed in over HTTPS"
done

step "files, exports and backups under a read-only root"
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d >"$WORK/pixel.png"
for t in a b; do
    out=$(in_edge "$t" -H "authorization: Bearer ${TOKEN[$t]}" -H "companyid: ${COMPANY[$t]}" \
        -F "file=@$WORK/pixel.png;type=image/png" -F "path=smoke/pixel-$t.png" -F "companyId=${COMPANY[$t]}" -F "key=thumbnail" \
        "https://$t.$DOMAIN/api/v1/wasabi/uploadFile")
    [[ $(jq -r .status <<<"$out") == true ]] || die "upload on tenant $t: $out"
    s3 "$S3_ADMIN_KEY" "$S3_ADMIN_SECRET" ls "s3://tenant-$t/${ID[$t]}/" --recursive | grep -q "pixel-$t" || die "tenant $t's upload is not under its prefix in bucket tenant-$t"

    out=$(in_edge "$t" -X POST -H "authorization: Bearer ${TOKEN[$t]}" -H "companyid: ${COMPANY[$t]}" -H 'content-type: application/json' \
        -d '{"format":"csv"}' "https://$t.$DOMAIN/api/v2/exports/workspace")
    job=$(jq -r '.data._id // empty' <<<"$out")
    [[ -n $job ]] || die "export on tenant $t: $out"
    export_done() { in_edge "$t" -H "authorization: Bearer ${TOKEN[$t]}" -H "companyid: ${COMPANY[$t]}" "https://$t.$DOMAIN/api/v2/exports" | jq -e --arg id "$job" '[.. | objects | select(._id == $id and .status == "done")] | length > 0'; }
    wait_for "export on tenant $t did not finish" 30 export_done
    code=$(in_edge "$t" -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${TOKEN[$t]}" -H "companyid: ${COMPANY[$t]}" "https://$t.$DOMAIN/api/v2/exports/$job/download")
    [[ $code == 200 ]] || die "export download on tenant $t answered $code"

    out=$(call "$TENANTS/${ID[$t]}" POST /api/v2/instance/backups "$WORK/empty.body") || die "backup on tenant $t: $out"
    app=$(container "$t" app)
    wait_for "no backup archive on tenant $t" 30 docker exec "$app" sh -c 'ls /app/backups/* >/dev/null 2>&1'
    if docker exec "$app" sh -c 'touch /app/server.js.smoke' 2>/dev/null; then die "tenant $t's root filesystem is writable"; fi
    pass "tenant $t: upload (with thumbnail) in its own prefix, CSV export, backup; root filesystem is read-only"
done

step "isolation"
for p in /api/v2/platform/status /API/V2/Platform/status //api/v2/platform/status /api/v2//platform/status /api/v2/%70latform/status; do
    code=$(in_edge a --path-as-is -o /dev/null -w '%{http_code}' -H "x-platform-key: ${KEY[a]}" "https://a.$DOMAIN$p")
    [[ $code == 403 ]] || die "the edge answered $code, not 403, for $p"
done
pass "/api/v2/platform is refused at the edge (403), in any case and with repeated slashes"

code=$(in_edge a -o /dev/null -w '%{http_code}' -H "x-platform-key: ${KEY[a]}" "https://a.$DOMAIN/api/v2/instance/stats")
[[ $code != 200 ]] || die "the platform key opened /api/v2/instance/stats through the edge"
pass "a platform key sent through the edge does not open the instance API ($code)"

out=$(in_edge b -H "authorization: Bearer ${TOKEN[a]}" -H "companyid: ${COMPANY[a]}" "https://b.$DOMAIN/api/v2/exports")
[[ $(jq -r '.status // false' <<<"$out" 2>/dev/null) != true ]] || die "tenant a's session was accepted by tenant b: $out"
pass "tenant a's session is refused by tenant b"

app_a=$(container a app)
mongo_a=$(container a mongo)
app_b=$(container b app)
mongo_b=$(container b mongo)
mongo_b_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$mongo_b" | awk '{print $1}')
app_b_ip=$(docker inspect --format "{{(index .NetworkSettings.Networks \"edge\").IPAddress}}" "$app_b")
[[ $(probe "$app_a" mongo 27017) == open ]] || die "tenant a's app cannot reach its own database (the probe is broken)"
[[ $(probe "$app_a" "t_${ID[b]}-mongo-1" 27017) == closed ]] || die "tenant a's app resolves and reaches tenant b's database by name"
[[ $(probe "$app_a" "$mongo_b_ip" 27017) == closed ]] || die "tenant a's app reaches tenant b's database at $mongo_b_ip"
[[ $(probe "$app_a" "$app_b_ip" 4000) == closed ]] || die "tenant a's app reaches tenant b's app at $app_b_ip:4000 over the edge network"
[[ $(probe "$mongo_a" 1.1.1.1 443) == closed ]] || die "tenant a's database has a route out"
pass "tenant a cannot reach tenant b's database (by name or address) or app; databases have no route out"

if s3 "${S3_KEY[a]}" "${S3_SECRET[a]}" ls s3://tenant-b/ >/dev/null 2>&1; then die "tenant a's S3 key lists tenant b's bucket"; fi
if s3 "${S3_KEY[a]}" "${S3_SECRET[a]}" cp "s3://tenant-b/${ID[b]}/" - >/dev/null 2>&1; then die "tenant a's S3 key reads tenant b's files"; fi
s3 "${S3_KEY[a]}" "${S3_SECRET[a]}" ls "s3://tenant-a/${ID[a]}/" >/dev/null || die "tenant a's S3 key cannot read its own files (the check is broken)"
pass "tenant a's storage key cannot list or read tenant b's files"

for t in a b; do
    app=$(container "$t" app)
    if docker logs "$app" 2>&1 | grep -q EROFS || docker exec "$app" sh -c 'grep -rqs EROFS /app/log'; then
        die "tenant $t wrote outside its writable paths (EROFS in the log)"
    fi
done
pass "no write outside the mounted paths (no EROFS in either app's log)"

step "footprint"
{
    echo
    echo "| Container | Memory | CPU |"
    echo "|---|---|---|"
    docker stats --no-stream --format '| {{.Name}} | {{.MemUsage}} | {{.CPUPerc}} |' $(docker ps -q --filter label=com.alianhub.instance)
} | tee -a "$WORK/summary.md"
echo "- up.sh: tenant a ${UP_MS[a]} ms (cold), tenant b ${UP_MS[b]} ms (warm)" >>"$WORK/summary.md"
echo "managed smoke passed"
