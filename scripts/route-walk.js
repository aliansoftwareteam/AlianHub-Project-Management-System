'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Flag-gated modules register their routes only when switched on, so the walk runs with every flag on.
const WALK_ENV = Object.freeze({
    STORAGE_TYPE: 'server',
    MCP_OAUTH: 'on',
    MCP_OAUTH_DCR: 'on',
    MCP_OAUTH_ISSUER: 'https://hub.example.test',
    EXTERNAL_AGENT_SESSIONS: 'on',
    CSP_MODE: 'report',
    CONNECTORS: 'slack,google_calendar',
});

/* Guards a module installs with its own app.use, which the stack walk cannot see through. */
const MODULE_GUARDS = [
    { prefix: '/api/v2/instance', probe: 'GET /api/v2/instance/settings' },
];

const SIDE_EFFECT_STUBS = {
    'Config/loggerConfig': () => ({ error() {}, info() {}, warn() {}, debug() {} }),
    'utils/mongo-handler/mongoQueries': () => ({ MongoDbCrudOpration: async () => null }),
    'event/socketEventEmitter': () => ({ emit() {}, on() {} }),
};

/* Outside jest the same three modules the convention test mocks are replaced in the require cache,
 * so loading every module opens no connection and writes no log. Under jest, use jest.mock instead:
 * jest keeps its own module registry and never reads this cache. */
function stubSideEffects() {
    for (const [relative, make] of Object.entries(SIDE_EFFECT_STUBS)) {
        const file = require.resolve(path.join(ROOT, relative));
        require.cache[file] = { id: file, filename: file, loaded: true, exports: make(), children: [], paths: [] };
    }
}

const MODULE_INIT = /require\(\s*[`'"]\.\/(Modules\/[^`'"]+)[`'"]\s*\)\.init\(\s*app/g;
const INDEX_ROUTE = /app\.(get|post|put|patch|delete)\(\s*["'](\/[^"']*)["']/g;

function buildApp({ intervals = [] } = {}) {
    const express = require('express');
    const index = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    const realSetInterval = global.setInterval;
    global.setInterval = (...args) => {
        const handle = realSetInterval(...args);
        intervals.push(handle);
        return handle;
    };
    try {
        const app = express();
        const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../Config/setMiddleware');
        setMiddlewareWithCV2(app);
        setMiddlewareV2(app);
        app.locals.firstModuleLayer = app._router.stack.length;
        app.locals.registeredBy = [];
        const register = (source, run) => {
            const from = app._router.stack.length;
            run();
            app.locals.registeredBy.push({ source, from, to: app._router.stack.length });
        };
        const modules = [...index.matchAll(MODULE_INIT)].map((m) => m[1]);
        for (const mod of modules) {
            const variants = mod.includes('${currentDirectory}') ? ['server', 'wasabi'].map((dir) => mod.replace('${currentDirectory}', dir)) : [mod];
            for (const file of variants) register(file, () => require(path.join(ROOT, file)).init(app));
        }
        register('index.js', () => {
            for (const m of index.matchAll(INDEX_ROUTE)) app[m[1]](m[2], (req, res) => res.end());
        });
        return app;
    } finally {
        global.setInterval = realSetInterval;
    }
}

const ROOT_MOUNT = '^\\/?(?=\\/|$)';
const samplePath = (routePath) => routePath.replace(/:\w+(\([^)]*\))?\??/g, 'x1').replace(/\*/g, 'x');
const mountPathOf = (layer) => {
    const mounted = layer.regexp.source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\\\//g, '/');
    if (/[\\()[\]|?*+^$]/.test(mounted)) throw new Error(`cannot read the mount path of ${layer.regexp}`);
    return mounted;
};

const GUARD = Object.freeze({ COMPANY: 'company', USER: 'user', INSTANCE_ADMIN: 'instance-admin' });

function guardNames() {
    const jwt = require('../Config/jwt');
    const { requireInstanceAdmin } = require('../Modules/Instance/guard');
    return new Map([
        [jwt.verifyJWTTokenWithCV2, GUARD.COMPANY],
        [jwt.verifyJWTTokenV2, GUARD.USER],
        [requireInstanceAdmin, GUARD.INSTANCE_ADMIN],
    ]);
}

const sourceOf = (app, at) => {
    const range = (app.locals.registeredBy || []).find((r) => at >= r.from && at < r.to);
    return range ? range.source : '';
};

/* What the route's own handlers declare: Config/permissionGuard.js tags requirePermission with its key
 * and the task write guards with their table. */
const declaredOn = (handles) => ({
    permissions: handles.map((h) => h.permission).filter(Boolean),
    taskWrites: handles.map((h) => h.taskWrites).find(Boolean) || null,
});

function listRoutes(app) {
    const guards = guardNames();
    const top = app._router.stack;
    const routes = [];
    const moduleGuardAt = new Map();
    const walk = (stack, prefix, topIndex) => stack.forEach((layer, i) => {
        const at = topIndex === undefined ? i : topIndex;
        if (layer.route) {
            for (const routePath of [].concat(layer.route.path)) {
                if (typeof routePath !== 'string') throw new Error(`route path ${routePath} is not a string; teach scripts/route-walk.js to read it`);
                const handles = layer.route.stack.map((l) => l.handle);
                const inlineGuard = handles.map((h) => guards.get(h)).find(Boolean) || null;
                for (const method of Object.keys(layer.route.methods)) {
                    routes.push({
                        key: `${method.toUpperCase()} ${prefix}${routePath}`,
                        method: method.toUpperCase(),
                        path: prefix + routePath,
                        at,
                        inline: Boolean(inlineGuard),
                        inlineGuard,
                        source: sourceOf(app, at),
                        handles,
                        ...declaredOn(handles),
                    });
                }
            }
        } else if (layer.name === 'router') {
            walk(layer.handle.stack, prefix + mountPathOf(layer), at);
        } else if (topIndex === undefined && i >= app.locals.firstModuleLayer && layer.regexp.source !== ROOT_MOUNT) {
            const mounted = mountPathOf(layer);
            if (MODULE_GUARDS.some((g) => g.prefix === mounted)) moduleGuardAt.set(mounted, i);
            else routes.push({ key: `USE ${mounted}`, method: 'USE', path: mounted, at, inline: false, inlineGuard: null, source: sourceOf(app, at), handles: [], permissions: [], taskWrites: null });
        }
    });
    walk(top, '');
    const guardLayers = top.filter((l) => guards.has(l.handle));
    const underModuleGuard = (route, sample) => [...moduleGuardAt].some(([prefix, at]) => at < route.at && sample.toLowerCase().startsWith(`${prefix.toLowerCase()}/`));
    for (const route of routes) {
        const sample = samplePath(route.path);
        const listGuard = guardLayers.find((l) => top.indexOf(l) < route.at && l.match(sample));
        const moduleGuarded = underModuleGuard(route, sample);
        route.guard = route.inlineGuard || (listGuard ? guards.get(listGuard.handle) : null) || (moduleGuarded ? GUARD.INSTANCE_ADMIN : null);
        route.guarded = Boolean(route.guard);
    }
    return { routes: [...new Map(routes.map((r) => [r.key, r])).values()], guardLayers, moduleGuardAt };
}

module.exports = { WALK_ENV, MODULE_GUARDS, GUARD, stubSideEffects, buildApp, listRoutes, samplePath };
