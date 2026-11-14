const LOG = '[connectors]';
const ENV_KEY = 'CONNECTORS';
const KNOWN = Object.freeze(['slack', 'outlook']);
const OFF = ['', 'off', 'false', '0', 'no', 'none'];

const PROBLEM = Object.freeze({
    secrets_store_off: 'SECRETS_STORE is off',
    secrets_key_invalid: 'SECRETS_KEY is missing or shorter than 32 characters',
    taint_routing_off: 'AGENT_TAINT_ROUTING is off',
});

const STARTED = Object.freeze({
    slack: 'each person connects their own Slack account, its tokens are kept in the secrets store and every message it sends needs that person\'s approval',
    outlook: 'each person connects their own Microsoft account for Outlook mail and calendar, its tokens are kept in the secrets store and every draft or event it makes needs that person\'s approval',
});

const named = () => {
    const raw = String(process.env.CONNECTORS || '').trim().toLowerCase();
    if (OFF.includes(raw)) return [];
    return [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
};

const requested = () => named().filter((name) => KNOWN.includes(name));

// Read by name here so the env doc lists them; apps.instanceApp reads every provider's instance app by a built name.
const INSTANCE_APP = Object.freeze({
    slack: () => [process.env.CONNECTOR_SLACK_CLIENT_ID, process.env.CONNECTOR_SLACK_CLIENT_SECRET],
    google: () => [process.env.CONNECTOR_GOOGLE_CLIENT_ID, process.env.CONNECTOR_GOOGLE_CLIENT_SECRET],
    outlook: () => [process.env.CONNECTOR_OUTLOOK_CLIENT_ID, process.env.CONNECTOR_OUTLOOK_CLIENT_SECRET],
    dropbox: () => [process.env.CONNECTOR_DROPBOX_CLIENT_ID, process.env.CONNECTOR_DROPBOX_CLIENT_SECRET],
});
const APP_NAME = Object.freeze({ slack: 'Slack app', google: 'Google app', outlook: 'Microsoft app', dropbox: 'Dropbox app' });
const lacksInstanceApp = (name) => !INSTANCE_APP[name]().every((value) => String(value || '').trim())
    && !require('../../Connectors/hostedSignIn').offers(name);

/* A connector holds a token and sends outside the workspace, so it runs only where tokens are kept by handle
 * and a run that read outside content is routed to approval. Required lazily: the registry loads this file. */
const problems = () => {
    const store = require('../../../Config/secrets').storeConfig();
    const codes = [];
    if (!store.requested) codes.push('secrets_store_off');
    else if (!store.keyValid) codes.push('secrets_key_invalid');
    if (!require('../taint').enabled()) codes.push('taint_routing_off');
    return codes.map((code) => ({ code, text: PROBLEM[code] }));
};

const status = (name) => {
    const asked = requested().includes(String(name));
    const found = asked ? problems() : [];
    return { requested: asked, on: asked && !found.length, problems: found };
};

const logBootState = () => {
    const logger = require('../../../Config/loggerConfig');
    const providers = require('../../Connectors/registry').list().map((definition) => definition.id);
    const known = [...new Set([...KNOWN, ...providers])];
    const unknown = named().filter((name) => !known.includes(name));
    if (unknown.length) logger.error(`${LOG} ${ENV_KEY} names ${unknown.join(', ')}, which this server does not have; known connectors: ${known.join(', ')}`);
    requested().forEach((name) => {
        const state = status(name);
        if (state.on) logger.info(`${LOG} ${name} connector on: ${STARTED[name]}`);
        else logger.error(`${LOG} ${ENV_KEY} names ${name} but it stays off: ${state.problems.map((p) => p.text).join('; ')}`);
    });
    Object.keys(INSTANCE_APP).forEach((name) => {
        const on = KNOWN.includes(name) ? status(name).on : named().includes(name);
        if (!on || !lacksInstanceApp(name)) return;
        const prefix = `CONNECTOR_${name.toUpperCase()}_CLIENT_`;
        logger.info(`${LOG} ${name} has no instance app (${prefix}ID and ${prefix}SECRET), so only a workspace that set its own ${APP_NAME[name]} can connect it`);
    });
};

module.exports = { ENV_KEY, KNOWN, PROBLEM, named, requested, status, logBootState };
