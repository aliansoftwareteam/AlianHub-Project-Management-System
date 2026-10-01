const LOG = '[connectors]';
const ENV_KEY = 'CONNECTORS';
const KNOWN = Object.freeze(['slack']);
const OFF = ['', 'off', 'false', '0', 'no', 'none'];

const PROBLEM = Object.freeze({
    secrets_store_off: 'SECRETS_STORE is off',
    secrets_key_invalid: 'SECRETS_KEY is missing or shorter than 32 characters',
    taint_routing_off: 'AGENT_TAINT_ROUTING is off',
});

const named = () => {
    const raw = String(process.env.CONNECTORS || '').trim().toLowerCase();
    if (OFF.includes(raw)) return [];
    return [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
};

const requested = () => named().filter((name) => KNOWN.includes(name));

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

const slackOn = () => status('slack').on;

const logBootState = () => {
    const logger = require('../../../Config/loggerConfig');
    const unknown = named().filter((name) => !KNOWN.includes(name));
    if (unknown.length) logger.error(`${LOG} ${ENV_KEY} names ${unknown.join(', ')}, which this server does not have; known connectors: ${KNOWN.join(', ')}`);
    requested().forEach((name) => {
        const state = status(name);
        if (state.on) logger.info(`${LOG} ${name} connector on: its token is kept in the secrets store and every message it sends needs a person's approval`);
        else logger.error(`${LOG} ${ENV_KEY} names ${name} but it stays off: ${state.problems.map((p) => p.text).join('; ')}`);
    });
};

module.exports = { ENV_KEY, KNOWN, PROBLEM, requested, status, slackOn, logBootState };
