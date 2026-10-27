const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { renderStack } = require('../deploy/managed/render');

const SCRIPTS = path.join(__dirname, '..', 'deploy', 'managed');
const DIGEST = `sha256:${'b'.repeat(64)}`;
const GHCR = 'ghcr.io/aliansoftwareteam/alianhub';
const DOCR = 'registry.digitalocean.com/alianhub/alianhub';
const JWT_SECRET = 'j'.repeat(64);
const PLATFORM_KEY = crypto.randomBytes(48).toString('base64url');

/* The scripts need bash 4 (associative arrays) and GNU-style date; on Windows only Git Bash fits,
 * and a bare `bash` there may be WSL's. */
function bashFits() {
    const probe = spawnSync('bash', ['-c', 'declare -A probe=(); uname -s'], { encoding: 'utf8' });
    if (probe.status !== 0) return false;
    return process.platform !== 'win32' || /^(MINGW|MSYS)/.test(probe.stdout);
}

/* Answers like the Docker CLI for exactly the calls the scripts make; FAKE_* steer it. */
const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
case $1 in
  info) [[ -z \${FAKE_NO_DAEMON:-} ]]; exit ;;
  network) [[ -z \${FAKE_NO_EDGE:-} ]]; exit ;;
  inspect) echo "running \${FAKE_HEALTH:-healthy} \${FAKE_RESTARTS:-0}"; exit 0 ;;
  volume) exit 0 ;;
  compose) ;;
  *) exit 0 ;;
esac
shift
file=
while [[ $1 == --* ]]; do
  [[ $1 == --file ]] && file=$2
  shift 2
done
sub=$1; shift
case $sub in
  version) exit 0 ;;
  pull)
    service=\${*: -1}
    if [[ $service == app && -n \${FAKE_PULL_FAIL:-} ]] && grep -q "image: \${FAKE_PULL_FAIL}@" "$file"; then exit 1; fi
    exit 0 ;;
  up|down|restart|logs) echo "fake $sub"; exit 0 ;;
  ps) echo cafe1234; exit 0 ;;
  exec)
    script=$(printf '%s' "$*")
    if [[ $script == *READY* ]]; then echo "\${FAKE_STATUS:-READY 14.40.0}"; exit 0; fi
    cat; printf '{"echo":true}'; echo "HTTP 200" >&2; exit 0 ;;
esac
exit 0
`;

const run = (script, args, env) => {
    const result = spawnSync('bash', [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', env, timeout: 30000 });
    const lines = result.stdout.trim().split('\n');
    let json = null;
    try { json = JSON.parse(lines[lines.length - 1]); } catch { json = null; }
    return { ...result, json };
};

(bashFits() ? describe : describe.skip)('managed stack scripts', () => {
    let root;
    let bin;
    let env;
    let instanceId;
    let dir;

    const writeEnv = (overrides = {}) => {
        const { publicKey } = crypto.generateKeyPairSync('ed25519');
        const values = {
            ALIANHUB_VERSION: '14.40.0',
            HOSTING_MODE: 'managed',
            INSTANCE_ID: instanceId,
            PLATFORM_URL: 'https://account.alianhub.com',
            PLATFORM_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
            PLATFORM_API_KEY: PLATFORM_KEY,
            JWT_SECRET,
            MONGODB_URL: 'mongodb://mongo:27017',
            WEBURL: 'https://acme.alianhub.com',
            APIURL: 'https://acme.alianhub.com/',
            TRUST_PROXY: '2',
            MIGRATIONS_AUTO: 'true',
            ...overrides
        };
        const body = Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join('\n');
        fs.writeFileSync(path.join(dir, '.env'), `# written by the host agent\n${body}\n`, { mode: 0o600 });
    };

    const writeCompose = (image = GHCR) => {
        const { compose } = renderStack({ instanceId, hostname: 'acme.alianhub.com', tier: 'starter', version: '14.40.0', image, imageDigest: DIGEST });
        fs.rmSync(path.join(dir, 'compose.yml'), { force: true });
        fs.writeFileSync(path.join(dir, 'compose.yml'), compose);
    };

    const calls = () => fs.readFileSync(env.FAKE_DOCKER_LOG, 'utf8');

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-stack-'));
        bin = path.join(root, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
        instanceId = `ins_${crypto.randomBytes(16).toString('hex').slice(0, 26)}`;
        dir = path.join(root, instanceId);
        fs.mkdirSync(dir);
        env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_DOCKER_LOG: path.join(root, 'calls.log'), UP_TIMEOUT: '4' };
        fs.writeFileSync(env.FAKE_DOCKER_LOG, '');
        writeCompose();
        writeEnv();
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('up.sh starts a valid stack and prints one ok line with the version', () => {
        const result = run('up.sh', [dir], env);
        expect(result.status).toBe(0);
        expect(result.json).toEqual({ ok: true, version: '14.40.0', ms: expect.any(Number) });
        expect(calls()).toContain(`--project-name t_${instanceId}`);
        expect(calls()).toContain('--env-file /dev/null');
        expect(calls()).toMatch(/pull --policy missing --quiet app/);
        expect(calls()).toMatch(/up --detach --remove-orphans --pull never/);
    });

    test('up.sh refuses a bad .env with exit 2, naming every problem but no value', () => {
        writeEnv({ HOSTING_MODE: 'self', JWT_SECRET: 'short', WEBURL: 'https://other.alianhub.com', APIURL: 'https://acme.alianhub.com', PLATFORM_URL: 'http://account.alianhub.com', TRUST_PROXY: undefined });
        const result = run('up.sh', [dir], env);
        expect(result.status).toBe(2);
        expect(result.json.error).toBe('bad_env');
        expect(result.json.problems).toEqual(expect.arrayContaining([
            'TRUST_PROXY is not set',
            'HOSTING_MODE must be managed',
            'PLATFORM_URL must be an https:// URL',
            'JWT_SECRET must be at least 32 characters',
            'APIURL must be WEBURL followed by /',
            'WEBURL host does not match the Host rule in compose.yml'
        ]));
        expect(result.stdout).not.toContain(PLATFORM_KEY);
        expect(calls()).toBe('');
    });

    test('up.sh refuses a public key that is not Ed25519 and an .env from another instance', () => {
        const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        writeEnv({ PLATFORM_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), INSTANCE_ID: 'ins_aaaaaaaaaaaaaaaaaaaaaaaa' });
        const result = run('up.sh', [dir], env);
        expect(result.status).toBe(2);
        expect(result.json.problems).toEqual(expect.arrayContaining([
            'PLATFORM_PUBLIC_KEY must be base64 of an Ed25519 public key (raw 32 bytes or SPKI DER)',
            'INSTANCE_ID does not match the instance directory'
        ]));
    });

    test('up.sh accepts the raw 32-byte key in base64url and quoted values', () => {
        const { publicKey } = crypto.generateKeyPairSync('ed25519');
        const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
        writeEnv({ PLATFORM_PUBLIC_KEY: raw, JWT_SECRET: `"${JWT_SECRET}"`, MIGRATIONS_AUTO: "'false'" });
        expect(run('up.sh', [dir], env).status).toBe(0);
    });

    test('up.sh falls back to GHCR with the same digest when the mirror cannot be pulled', () => {
        writeCompose(DOCR);
        const result = run('up.sh', [dir], { ...env, FAKE_PULL_FAIL: DOCR });
        expect(result.status).toBe(0);
        const compose = fs.readFileSync(path.join(dir, 'compose.yml'), 'utf8');
        expect(compose).toContain(`    image: ${GHCR}@${DIGEST}\n`);
        expect(compose).not.toContain(DOCR);
    });

    test('up.sh exits 3 when no registry has the image', () => {
        const result = run('up.sh', [dir], { ...env, FAKE_PULL_FAIL: GHCR });
        expect(result.status).toBe(3);
        expect(result.json).toMatchObject({ ok: false, code: 3, error: 'pull_failed' });
    });

    test('up.sh exits 4 with the app log when the app never becomes ready', () => {
        const result = run('up.sh', [dir], { ...env, FAKE_STATUS: 'WAIT the database is not reachable yet' });
        expect(result.status).toBe(4);
        expect(result.json.problems).toEqual(['the database is not reachable yet']);
        expect(result.stderr).toContain('last 50 lines of the app log');
    });

    test('up.sh stops waiting on a crash loop', () => {
        const result = run('up.sh', [dir], { ...env, FAKE_RESTARTS: '3', UP_TIMEOUT: '60' });
        expect(result.status).toBe(4);
        expect(result.json.problems[0]).toMatch(/crash loop/);
    });

    test('up.sh exits 5 when the host has no edge network', () => {
        const result = run('up.sh', [dir], { ...env, FAKE_NO_EDGE: '1' });
        expect(result.status).toBe(5);
        expect(result.json.error).toBe('host_not_ready');
    });

    test('scripts refuse a directory that is not named after an instance', () => {
        const other = path.join(root, 'not-an-instance');
        fs.mkdirSync(other);
        fs.writeFileSync(path.join(other, 'compose.yml'), '');
        expect(run('down.sh', [other], env).status).toBe(2);
    });

    test('down.sh keeps volumes; destroy.sh needs --yes-delete-data and removes them and the files', () => {
        expect(run('down.sh', [dir], env).json).toEqual({ ok: true, ms: expect.any(Number) });
        expect(calls()).toMatch(/down --remove-orphans --timeout 30/);
        expect(calls()).not.toMatch(/--volumes/);

        const refused = run('destroy.sh', [dir], env);
        expect(refused.status).toBe(2);
        expect(fs.existsSync(dir)).toBe(true);

        expect(run('destroy.sh', [dir, '--yes-delete-data'], env).status).toBe(0);
        expect(calls()).toMatch(/down --volumes --remove-orphans/);
        expect(fs.existsSync(dir)).toBe(false);
    });

    test('restart.sh restarts the app and waits like up.sh', () => {
        const result = run('restart.sh', [dir], env);
        expect(result.status).toBe(0);
        expect(calls()).toMatch(/restart --timeout 20 app/);
        expect(run('restart.sh', [dir, 'traefik'], env).status).toBe(2);
    });

    test('platform-call.sh only reaches the platform and instance APIs, from inside the container', () => {
        expect(run('platform-call.sh', [dir, 'GET', '/api/v1/users'], env).status).toBe(2);
        expect(run('platform-call.sh', [dir, 'TRACE', '/api/v2/platform/status'], env).status).toBe(2);
        const body = path.join(root, 'body.json');
        fs.writeFileSync(body, '{"values":{}}');
        const result = spawnSync('bash', [path.join(SCRIPTS, 'platform-call.sh'), dir, 'PUT', '/api/v2/platform/config', body], { encoding: 'utf8', env: { ...env, MSYS_NO_PATHCONV: '1' } });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('{"values":{}}{"echo":true}');
        expect(calls()).toMatch(/exec -T -e PLATFORM_REQUEST_ID= app node -e/);
    });
});
