const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');

const LOCKED_STATES = Object.freeze(['read_only', 'suspended']);
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/* Paths that reach the app's code; everything else is the built SPA and its files. */
const GUARDED = /^\/(api|scim|mcp|oauth|form|share)(\/|$)/i;

const ALWAYS_OPEN = [
    /^\/health$/,
    /^\/version$/,
    /^\/api\/health$/,
    /^\/api\/v2\/platform(\/|$)/,
];

/* While read-only: signing in and out, keeping a session, two-factor, password recovery, exports,
 * and the POST routes that only read. */
const OPEN_WHILE_READ_ONLY = [
    /^\/api\/v2\/auth\/(login|tracker-code|magic-link|forgot-password|token-verify-forgotpassword|reset-password|platform-login|activate|activation\/verify|invitation-preview)$/,
    /^\/api\/v2\/auth\/2fa\//,
    /^\/api\/v1\/auth\/loginAuthTracker$/,
    /^\/api\/v2\/(generateToken|logout|sendForgotPasswordEmail)$/,
    /^\/api\/v2\/session\/(delete|update)(\/|$)/,
    /^\/api\/v2\/users\/sessions\//,
    /^\/api\/v2\/(google|github|gitlab)-signup$/,
    /^\/api\/v1\/(google|github|gitlab)\/access-token$/,
    /^\/api\/v2\/sso\/(oidc|saml|public)(\/|$)/,
    /^\/oauth\/(token|revoke)$/,
    /^\/mcp$/,
    /^\/api\/v1\/export(\/|$)/,
    /^\/api\/v2\/exports(\/|$)/,
    /^\/api\/v1\/timesheet\/export-csv$/,
    /^\/api\/v1\/mongoOpration$/,
    /^\/api\/v1\/(verifyToken|userAndCompanyCheck|getUserProfile|getTaskTypeImage|removeCache|get-tasks|get-remaining-projects|getAiCategory|getAiModels|getPrompts|findOnePrompts|findOneAiModel|getGlobalTemplate|milestoneReport)$/,
    /^\/api\/v1\/(admin\/)?wasabi\/retriveObject$/,
    /^\/api\/v1\/[\w/-]*\/find$/,
    /^\/api\/v2\/search$/,
    /^\/api\/v1\/advance\/filter\/search\//,
    /^\/api\/v1\/project\/search$/,
    /^\/api\/v1\/dashboard\/[\w-]+$/,
    /^\/api\/v1\/reports\/custom\/run$/,
    /^\/api\/v1\/timesheet\/(billable-summary|workload|workload-grid)$/,
    /^\/api\/v1\/(members\/count|portfolio\/summary)$/,
    /^\/api\/v2\/goals\/[\w-]+\/summary$/,
    /^\/api\/v2\/custom-fields\/links\/resolve$/,
    /^\/api\/v2\/csp-report$/,
];

const OPEN_WHILE_SUSPENDED = [
    (method, path) => READS.has(method) && path === '/api/v2/instance/public-config',
];

const MESSAGES = Object.freeze({
    read_only: 'This workspace is read-only because the subscription is unpaid. You can view and export everything; changes are paused until the owner updates payment.',
    suspended: 'This workspace is suspended. The owner can restore access in their AlianHub account.',
});

const currentState = () => (hostingMode.isManaged() ? require('../Platform/lifecycle').lifecycle() : 'active');

const writable = (state = currentState()) => !LOCKED_STATES.includes(state);

const matches = (patterns, path) => patterns.some((pattern) => pattern.test(path));

/* Pure: null when the request may run, or the state that refuses it. */
function lifecycleRefusal(method, path, state, { platformKey = false } = {}) {
    if (!LOCKED_STATES.includes(state)) return null;
    const verb = String(method || 'GET').toUpperCase();
    const at = String(path || '/');
    if (!GUARDED.test(at) || matches(ALWAYS_OPEN, at)) return null;
    if (state === 'suspended') return OPEN_WHILE_SUSPENDED.some((open) => open(verb, at)) ? null : 'suspended';
    if (READS.has(verb) || matches(OPEN_WHILE_READ_ONLY, at)) return null;
    if (platformKey && /^\/api\/v2\/instance(\/|$)/.test(at)) return null;
    return 'read_only';
}

function refusalOf(state) {
    const detail = hostingMode.isManaged() ? require('../Platform/lifecycle').lifecycleState() : {};
    return {
        status: false,
        code: state,
        statusText: detail.message || MESSAGES[state],
        message: detail.message || MESSAGES[state],
        graceUntil: detail.graceUntil || null,
        portalUrl: hostingMode.portalUrl(),
    };
}

/* Instance routes take the platform key too (062); that call is the platform's, never the customer's. */
function lifecycleGuard(req, res, next) {
    const state = currentState();
    if (!LOCKED_STATES.includes(state)) return next();
    const refused = lifecycleRefusal(req.method, req.path, state, { platformKey: Boolean(req.headers && req.headers['x-platform-key']) });
    return refused ? res.status(423).send(refusalOf(refused)) : next();
}

const SOCKET_EVENTS_WHILE_SUSPENDED = new Set(['disconnect', 'disconnectNameSpace']);

/* No client event writes data by itself (the call history line checks writable() where it is
 * written), so read-only lets every event through; suspended lets none through. */
function socketEventRefusal(event, state = currentState()) {
    return state === 'suspended' && !SOCKET_EVENTS_WHILE_SUSPENDED.has(String(event)) ? 'suspended' : null;
}

/* For timers that write on behalf of people: skipped while locked, so they pick up again by
 * themselves on the first tick after the instance is active. */
function whenWritable(name, run) {
    let paused = false;
    return async (...args) => {
        if (!writable()) {
            if (!paused) logger.info(`[entitlements] ${name} paused while the instance is ${currentState()}`);
            paused = true;
            return undefined;
        }
        if (paused) logger.info(`[entitlements] ${name} resumed`);
        paused = false;
        return run(...args);
    };
}

module.exports = { LOCKED_STATES, MESSAGES, writable, lifecycleRefusal, lifecycleGuard, refusalOf, whenWritable, socketEventRefusal, currentState };
