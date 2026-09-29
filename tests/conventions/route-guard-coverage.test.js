// Flag-gated modules register their routes only when switched on, so every flag is on here.
Object.assign(process.env, {
    STORAGE_TYPE: 'server',
    MCP_OAUTH: 'on',
    MCP_OAUTH_DCR: 'on',
    MCP_OAUTH_ISSUER: 'https://hub.example.test',
    EXTERNAL_AGENT_SESSIONS: 'on',
    CSP_MODE: 'report',
});

jest.mock('../../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT = path.join(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

/* app.use only guards the prefixes it is given, so a module that forgets to list its prefix in
 * Config/setMiddleware.js is either open to anyone or, when its handler reads req.uid, refuses every
 * signed-in user. Every route has to be behind a login guard or be named below with its reason. */
const PUBLIC_ROUTES = [
    // Sign-in, sign-up, password reset and invitation links: the caller has no session yet.
    'POST /api/v2/auth/login',
    'POST /api/v1/auth/loginAuthTracker',
    'POST /api/v2/auth/2fa/validate',
    'POST /api/v2/auth/magic-link',
    'GET /api/v2/auth/magic-link/verify',
    'POST /api/v2/auth/forgot-password',
    'POST /api/v2/auth/token-verify-forgotpassword',
    'POST /api/v2/auth/reset-password',
    'POST /api/v2/createUser',
    'POST /api/v2/sendVerificationEmail',
    'POST /api/v2/verifyEmail',
    'POST /api/v2/sendForgotPasswordEmail',
    'POST /api/v2/checkPermission',
    'POST /api/v2/auth/invitation-preview',
    // Exchanges a refresh token for a new access token, so it runs once the access token has expired.
    'POST /api/v2/generateToken',
    // Social sign-in: the provider's authorization code is the credential.
    'POST /api/v2/google-signup',
    'POST /api/v2/github-signup',
    'POST /api/v2/gitlab-signup',
    'POST /api/v1/github/access-token',
    'POST /api/v1/google/access-token',
    'POST /api/v1/gitlab/access-token',
    // SSO sign-in: authenticated by the identity provider's signed response.
    'GET /api/v2/sso/public',
    'GET /api/v2/sso/discover',
    'GET /api/v2/sso/oidc/initiate',
    'GET /api/v2/sso/oidc/callback',
    'GET /api/v2/sso/saml/initiate',
    'POST /api/v2/sso/saml/acs',
    'GET /api/v2/sso/saml/metadata',
    // OAuth authorization server (MCP_OAUTH): clients reach it before holding a token; /oauth/token authenticates the client.
    'GET /.well-known/oauth-authorization-server',
    'GET /oauth/authorize',
    'GET /oauth/consent',
    'POST /oauth/token',
    'POST /oauth/revoke',
    'POST /oauth/register',
    // MCP: discovery metadata is public (RFC 9728); /mcp authenticates its own bearer token.
    'GET /.well-known/oauth-protected-resource',
    'GET /.well-known/oauth-protected-resource/mcp',
    'POST /mcp',
    'GET /mcp',
    'GET /mcp/manifest',
    // SCIM 2.0: the router's scimAuth checks the workspace SCIM bearer token.
    'GET /scim/v2/ServiceProviderConfig',
    'GET /scim/v2/ResourceTypes',
    'GET /scim/v2/Schemas',
    'GET /scim/v2/Users',
    'POST /scim/v2/Users',
    'GET /scim/v2/Users/:id',
    'PUT /scim/v2/Users/:id',
    'PATCH /scim/v2/Users/:id',
    'DELETE /scim/v2/Users/:id',
    // Public API: tokenAuth checks a scoped personal access token.
    'GET /api/public-v1/projects',
    'GET /api/public-v1/tasks/:key',
    'GET /api/public-v1/tasks',
    // The secret token in the URL is the credential: inbound email, calendar feed, public forms and shares.
    'POST /api/v1/email-in/:token',
    'GET /api/v1/calendar/ics/:token',
    'GET /form/:token',
    'POST /form/:token',
    'GET /share/:token',
    'GET /share/:token/page/:pageId',
    'POST /share/:token',
    'POST /share/:token/intake',
    // Serves a file only for a signed download token or from a bucket marked public.
    'GET /api/v1/download/:bucketId/*',
    // A provider redirect carries no session; the signed state authenticates it.
    'GET /api/v1/cloud-oauth/callback',
    // Slack slash command: checked against the workspace's Slack verification token.
    'POST /api/v1/slack/command/:companyId',
    // Progress streams: EventSource cannot send a token, and they carry only step numbers.
    'GET /importUser/events/:id',
    'GET /task-import/events/:id',
    'GET /company-create/events/:id',
    'GET /api/v2/setup/events/:id',
    'GET /api/v1/generatePrompt/events/:id',
    'GET /api/v1/ai-progress/:jobId',
    // First-run setup wizard: refuses once the instance is installed.
    'GET /api/v2/setup/status',
    'POST /api/v2/setup/complete',
    // Branding, login-page config and product information shown before sign-in.
    'GET /api/v2/instance/public-config',
    'GET /api/v1/getlogo',
    'GET /api/v1/getBrandSettingsData',
    'GET /api/v2/changelog',
    'GET /api/v1/tracker',
    'GET /api/v1/getTime',
    'GET /api/v1/getEmailTemplates',
    'GET /pickers/google-drive',
    'GET /pickers/google-drive.js',
    'USE /apidocs',
    // Browsers post CSP violation reports without credentials.
    'POST /api/v2/csp-report',
    // Operator tools: refused unless the request carries the preset key header.
    'GET /connections',
    'POST /api/v1/setPresetCompany',
    'GET /connections/:id',
    'GET /api/v1/setPresetCompany/:id',
    // SPA shell, liveness and version probes.
    'GET /',
    'GET /health',
    'GET /version',
];

/* Open today and not clearly meant to be: called only from signed-in screens, but the handler reads no
 * session, so moving it behind the guard needs a decision. Listed so the set cannot grow unnoticed. */
const OPEN_PENDING_DECISION = [
    'POST /api/v1/getGlobalTemplate',
];

/* Guards a module installs with its own app.use, which the stack walk cannot see through; each is probed live below. */
const MODULE_GUARDS = [
    { prefix: '/api/v2/instance', probe: 'GET /api/v2/instance/settings' },
];

const intervals = [];

function buildApp() {
    const realSetInterval = global.setInterval;
    global.setInterval = (...args) => {
        const handle = realSetInterval(...args);
        intervals.push(handle);
        return handle;
    };
    try {
        const app = express();
        const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../../Config/setMiddleware');
        setMiddlewareWithCV2(app);
        setMiddlewareV2(app);
        app.locals.firstModuleLayer = app._router.stack.length;
        const modules = [...INDEX.matchAll(/require\(\s*[`'"]\.\/(Modules\/[^`'"]+)[`'"]\s*\)\.init\(\s*app/g)].map((m) => m[1]);
        for (const mod of modules) {
            const variants = mod.includes('${currentDirectory}') ? ['server', 'wasabi'].map((dir) => mod.replace('${currentDirectory}', dir)) : [mod];
            for (const file of variants) require(path.join(ROOT, file)).init(app);
        }
        for (const m of INDEX.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g)) app[m[1]](m[2], (req, res) => res.end());
        return app;
    } finally {
        global.setInterval = realSetInterval;
    }
}

const jwt = require('../../Config/jwt');
const { requireInstanceAdmin } = require('../../Modules/Instance/guard');

const GUARD_HANDLERS = new Set([jwt.verifyJWTTokenWithCV2, jwt.verifyJWTTokenV2, requireInstanceAdmin]);
const ROOT_MOUNT = '^\\/?(?=\\/|$)';
const samplePath = (routePath) => routePath.replace(/:\w+(\([^)]*\))?\??/g, 'x1').replace(/\*/g, 'x');
const mountPathOf = (layer) => {
    const mounted = layer.regexp.source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
    if (/[\\()[\]|?*+^$]/.test(mounted)) throw new Error(`cannot read the mount path of ${layer.regexp}`);
    return mounted;
};

function listRoutes(app) {
    const top = app._router.stack;
    const routes = [];
    const moduleGuardAt = new Map();
    const walk = (stack, prefix, topIndex) => stack.forEach((layer, i) => {
        const at = topIndex === undefined ? i : topIndex;
        if (layer.route) {
            for (const routePath of [].concat(layer.route.path)) {
                if (typeof routePath !== 'string') throw new Error(`route path ${routePath} is not a string; teach this test to read it`);
                const inline = layer.route.stack.some((l) => GUARD_HANDLERS.has(l.handle));
                for (const method of Object.keys(layer.route.methods)) routes.push({ key: `${method.toUpperCase()} ${prefix}${routePath}`, path: prefix + routePath, at, inline });
            }
        } else if (layer.name === 'router') {
            walk(layer.handle.stack, prefix + mountPathOf(layer), at);
        } else if (topIndex === undefined && i >= app.locals.firstModuleLayer && layer.regexp.source !== ROOT_MOUNT) {
            const mounted = mountPathOf(layer);
            if (MODULE_GUARDS.some((g) => g.prefix === mounted)) moduleGuardAt.set(mounted, i);
            else routes.push({ key: `USE ${mounted}`, path: mounted, at, inline: false });
        }
    });
    walk(top, '');
    const guardLayers = top.filter((l) => GUARD_HANDLERS.has(l.handle));
    const underModuleGuard = (route, sample) => [...moduleGuardAt].some(([prefix, at]) => at < route.at && sample.toLowerCase().startsWith(`${prefix.toLowerCase()}/`));
    for (const route of routes) {
        const sample = samplePath(route.path);
        route.guarded = route.inline
            || guardLayers.some((l) => top.indexOf(l) < route.at && l.match(sample))
            || underModuleGuard(route, sample);
    }
    return { routes: [...new Map(routes.map((r) => [r.key, r])).values()], guardLayers, moduleGuardAt };
}

const app = buildApp();
const { routes, guardLayers, moduleGuardAt } = listRoutes(app);
const keys = new Set(routes.map((r) => r.key));
const open = routes.filter((r) => !r.guarded).map((r) => r.key);
const listed = [...PUBLIC_ROUTES, ...OPEN_PENDING_DECISION];

afterAll(async () => {
    intervals.forEach(clearInterval);
    await require('node-schedule').gracefulShutdown();
});

describe('every registered route is behind a login guard or explicitly public', () => {
    it('finds the guard layers and the routes (the walk works)', () => {
        expect(guardLayers.length).toBeGreaterThanOrEqual(2);
        expect([...moduleGuardAt.keys()]).toEqual(MODULE_GUARDS.map((g) => g.prefix));
        expect(routes.length).toBeGreaterThan(700);
        expect(routes.length - open.length).toBeGreaterThan(600);
    });

    it('leaves no route open unless it is listed with its reason', () => {
        expect(open.filter((key) => !listed.includes(key))).toEqual([]);
    });

    it('lists only routes that still exist', () => {
        expect(listed.filter((key) => !keys.has(key))).toEqual([]);
    });

    it('lists only routes that are still open', () => {
        expect(listed.filter((key) => keys.has(key) && !open.includes(key))).toEqual([]);
    });

    it('lists each route once', () => {
        expect(listed.filter((key, i) => listed.indexOf(key) !== i)).toEqual([]);
    });
});

describe('guards a module installs itself', () => {
    let server;
    let baseURL;

    beforeAll(async () => {
        await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
        baseURL = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

    it.each(MODULE_GUARDS.map((g) => [g.prefix, g.probe]))('%s answers 401 to %s without a token', async (prefix, probe) => {
        const [method, probePath] = probe.split(' ');
        expect(keys.has(probe)).toBe(true);
        const res = await fetch(`${baseURL}${probePath}`, { method });
        expect(res.status).toBe(401);
        expect((await res.json()).isJwtError).toBe(true);
    });
});
