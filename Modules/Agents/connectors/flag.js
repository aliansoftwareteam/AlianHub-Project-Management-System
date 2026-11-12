const LOG = '[connectors]';
const ENV_KEY = 'CONNECTORS';
const KNOWN = Object.freeze(['slack', 'google_calendar', 'outlook']);
const GOOGLE = Object.freeze(['google_calendar']);
const OFF = ['', 'off', 'false', '0', 'no', 'none'];

const PROBLEM = Object.freeze({
    secrets_store_off: 'SECRETS_STORE is off',
    secrets_key_invalid: 'SECRETS_KEY is missing or shorter than 32 characters',
    taint_routing_off: 'AGENT_TAINT_ROUTING is off',
    google_client_missing: 'CONNECTOR_GOOGLE_CLIENT_ID or CONNECTOR_GOOGLE_CLIENT_SECRET is not set',
});

const STARTED = Object.freeze({
    slack: 'each person connects their own Slack account, its tokens are kept in the secrets store and every message it sends needs that person\'s approval',
    google_calendar: 'each person connects their own Google account, and its tokens are kept in the secrets store',
    outlook: 'each person connects their own Microsoft account for Outlook mail and calendar, its tokens are kept in the secrets store and every draft or event it makes needs that person\'s approval',
});

const named = () => {
    const raw = String(process.env.CONNECTORS || '').trim().toLowerCase();
    if (OFF.includes(raw)) return [];
    return [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
};

const requested = () => named().filter((name) => KNOWN.includes(name));

/* A connector holds a token and sends outside the workspace, so it runs only where tokens are kept by handle
 * and a run that read outside content is routed to approval. Required lazily: the registry loads this file. */
/* The connectors' own OAuth client. The sign-in client (GOOGLE_CLIENT_ID) answers to the browser by design, so
 * it is never read here. */
const googleClient = () => ({
    id: String(process.env.CONNECTOR_GOOGLE_CLIENT_ID || '').trim(),
    secret: String(process.env.CONNECTOR_GOOGLE_CLIENT_SECRET || '').trim(),
});

const slackClient = () => ({
    id: String(process.env.CONNECTOR_SLACK_CLIENT_ID || '').trim(),
    secret: String(process.env.CONNECTOR_SLACK_CLIENT_SECRET || '').trim(),
});

const outlookClient = () => ({
    id: String(process.env.CONNECTOR_OUTLOOK_CLIENT_ID || '').trim(),
    secret: String(process.env.CONNECTOR_OUTLOOK_CLIENT_SECRET || '').trim(),
});

const INSTANCE_APPS = Object.freeze([
    { name: 'slack', client: slackClient, settings: 'CONNECTOR_SLACK_CLIENT_ID and CONNECTOR_SLACK_CLIENT_SECRET', app: 'Slack app' },
    { name: 'outlook', client: outlookClient, settings: 'CONNECTOR_OUTLOOK_CLIENT_ID and CONNECTOR_OUTLOOK_CLIENT_SECRET', app: 'Microsoft app' },
]);

const problems = (name) => {
    const store = require('../../../Config/secrets').storeConfig();
    const codes = [];
    if (!store.requested) codes.push('secrets_store_off');
    else if (!store.keyValid) codes.push('secrets_key_invalid');
    if (!require('../taint').enabled()) codes.push('taint_routing_off');
    const client = googleClient();
    if (GOOGLE.includes(name) && !(client.id && client.secret)) codes.push('google_client_missing');
    return codes.map((code) => ({ code, text: PROBLEM[code] }));
};

const status = (name) => {
    const asked = requested().includes(String(name));
    const found = asked ? problems(String(name)) : [];
    return { requested: asked, on: asked && !found.length, problems: found };
};

const slackOn = () => status('slack').on;
const requestedGoogle = () => requested().filter((name) => GOOGLE.includes(name));

const logBootState = () => {
    const logger = require('../../../Config/loggerConfig');
    const unknown = named().filter((name) => !KNOWN.includes(name));
    if (unknown.length) logger.error(`${LOG} ${ENV_KEY} names ${unknown.join(', ')}, which this server does not have; known connectors: ${KNOWN.join(', ')}`);
    requested().forEach((name) => {
        const state = status(name);
        if (state.on) logger.info(`${LOG} ${name} connector on: ${STARTED[name]}`);
        else logger.error(`${LOG} ${ENV_KEY} names ${name} but it stays off: ${state.problems.map((p) => p.text).join('; ')}`);
    });
    INSTANCE_APPS.forEach(({ name, client, settings, app }) => {
        const { id, secret } = client();
        if (status(name).on && !(id && secret)) logger.info(`${LOG} ${name} has no instance app (${settings}), so only a workspace that set its own ${app} can connect it`);
    });
};

module.exports = { ENV_KEY, KNOWN, GOOGLE, PROBLEM, named, requested, requestedGoogle, status, slackOn, googleClient, logBootState };
