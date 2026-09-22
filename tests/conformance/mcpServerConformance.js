const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { resetDatabase } = require('../../e2e/support/database');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { PASSWORD, login } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { authorizeWithSdk, memoryProvider } = require('../support/mcpOAuthClient');

/* Runs the official MCP conformance suite in server mode against /mcp with MCP_OAUTH=both on a throwaway
 * database. The suite's server scenarios send no credentials, so a pass-through proxy adds the bearer
 * token a real OAuth client would hold; everything else reaches the app untouched. The suite needs Node
 * 22 (fs.globSync), so it is installed on its own and run with CONFORMANCE_NODE, the path to a Node 22. */

const SUITE = '@modelcontextprotocol/conformance';
const SUITE_VERSION = '0.1.16';
const SUITE_DIR = path.join(STATE_DIR, 'conformance-suite');
const EXPECTED_FAILURES = path.join(__dirname, 'mcp-server-expected-failures.yml');
const OUTPUT_DIR = path.join(STATE_DIR, 'conformance');
const REDIRECT = 'http://127.0.0.1:47304/callback';
const ALL_SCOPES = 'tasks:read tasks:write projects:read docs:read time:read time:write';

async function setupOwner(baseURL) {
    const email = 'owner@conformance.alianhub.test';
    const res = await fetch(`${baseURL}/api/v2/setup/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: 'Olivia', lastName: 'Owner', email, password: PASSWORD, companyName: 'Conformance', sampleData: false }),
    });
    const body = await res.json();
    if (!res.ok || !body.status) throw new Error(`setup wizard failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    return { ...(await login(baseURL, email)), companyId: String(body.data.companyId) };
}

async function accessToken(baseURL, session) {
    const res = await fetch(`${baseURL}/api/v2/oauth-clients`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`, companyid: session.companyId },
        body: JSON.stringify({ name: 'MCP conformance suite', redirectUris: [REDIRECT], tokenEndpointAuthMethod: 'client_secret_basic' }),
    });
    const body = await res.json();
    if (res.status !== 201) throw new Error(`pre-registration failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    const provider = memoryProvider({
        redirectUrl: REDIRECT,
        clientMetadata: { client_name: 'MCP conformance suite', redirect_uris: [REDIRECT] },
        clientInformation: { client_id: body.data.clientId, client_secret: body.data.clientSecret, token_endpoint_auth_method: 'client_secret_basic' },
    });
    const tokens = await authorizeWithSdk(provider, { serverUrl: `${baseURL}/mcp`, scope: ALL_SCOPES, session });
    return tokens.access_token;
}

/* The suite sends the proxy's own origin on the request it expects to be accepted, so the app has to know
 * that origin before it starts; the port is therefore reserved here and handed to both. */
const freePort = () => new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});

function startProxy(target, token, port) {
    const upstream = new URL(target);
    const proxy = http.createServer((req, res) => {
        const headers = { ...req.headers };
        if (!headers.authorization) headers.authorization = `Bearer ${token}`;
        const forwarded = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers }, (answer) => {
            res.writeHead(answer.statusCode, answer.headers);
            answer.pipe(res);
        });
        forwarded.on('error', (error) => { res.writeHead(502); res.end(error.message); });
        req.pipe(forwarded);
    });
    return new Promise((resolve) => proxy.listen(port, '127.0.0.1', () => resolve(proxy)));
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code === null ? 1 : code));
});

async function installSuite() {
    const entry = path.join(SUITE_DIR, 'node_modules', SUITE, 'dist', 'index.js');
    const manifest = path.join(SUITE_DIR, 'node_modules', SUITE, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).version === SUITE_VERSION) return entry;
    fs.mkdirSync(SUITE_DIR, { recursive: true });
    const code = await run('npm', ['install', '--prefix', SUITE_DIR, '--no-save', '--no-audit', '--no-fund', `${SUITE}@${SUITE_VERSION}`]);
    if (code !== 0) throw new Error(`installing ${SUITE}@${SUITE_VERSION} failed (${code})`);
    return entry;
}

const runSuite = (entry, url) => run(process.env.CONFORMANCE_NODE || 'node', [entry, 'server', '--url', url, '--expected-failures', EXPECTED_FAILURES, '-o', OUTPUT_DIR]);

async function main() {
    const mongoUrl = resolveMongoUrl();
    await resetDatabase(mongoUrl);
    const proxyPort = await freePort();
    const server = await startServer({
        mongoUrl,
        logFile: path.join(STATE_DIR, 'conformance-server.log'),
        env: {
            MCP_OAUTH: 'both',
            NODE_ENV: 'development',
            MCP_OAUTH_RATE_LIMIT_PER_MIN: '1000',
            CORS_ORIGINS: `http://127.0.0.1:${proxyPort}`,
        },
    });
    let proxy;
    try {
        const entry = await installSuite();
        const token = await accessToken(server.baseURL, await setupOwner(server.baseURL));
        proxy = await startProxy(server.baseURL, token, proxyPort);
        const code = await runSuite(entry, `http://127.0.0.1:${proxyPort}/mcp`);
        process.exitCode = code;
    } finally {
        if (proxy) await new Promise((done) => proxy.close(done));
        await server.stop();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
