const crypto = require('crypto');
const argsSchema = require('../Mcp/argsSchema');
const taint = require('../Agents/taint');
const egressContext = require('../Agents/engine/egressContext');
const agentFetch = require('../Agents/engine/agentFetch');
const limits = require('../Agents/connectors/readLimits');
const connections = require('./resolveConnection');
const tools = require('./tools');

const VIA = Object.freeze({ AGENT: 'agent', MCP: 'mcp' });
const STATE = Object.freeze({ PENDING: 'pending', APPLIED: 'applied', FAILED: 'failed', REFUSED: 'refused' });
const TIMEOUT_MS = 10000;
const MAX_BYTES = 512 * 1024;

const refusal = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true });

const MESSAGES = Object.freeze({
    not_connected: (name) => `Connect ${name} on My connections first, then ask again.`,
    not_member: () => 'This is not available to you.',
    broken: (name) => `${name} is no longer accepting your connection. Reconnect ${name} on My connections, then ask again.`,
    provider_off: (name) => `${name} is not switched on here.`,
});

const spoken = (tool) => (e) => {
    if (!e || e.name !== 'ConnectorError' || !MESSAGES[e.code]) throw e;
    throw refusal(e.code, MESSAGES[e.code](tool.definition.name));
};

const connectionOf = (tool, companyId, userId) => connections.resolveConnection({ companyId: String(companyId), userId: String(userId), provider: tool.provider }).catch(spoken(tool));

const tokenOf = (tool, connection) => connection.getAccessToken().catch(spoken(tool));

/* What the provider sent is data for the model, never markup or control characters. */
// eslint-disable-next-line no-control-regex
const plain = (value) => String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();

const runs = () => require('../Agents/runs');

/* The read is pushed onto the run before the provider is called and counts from then on, failed or not, so an agent
 * cannot retry past the cap. Only the reads ahead of it in the array decide, so two reads racing in one run cannot
 * both take the last call. A pending read holds the most it may take until it is settled. Every connector shares
 * the run's caps; a refused read took nothing in and does not count. */
const claimRunRead = async (companyId, runId, entry, maxChars) => {
    const slot = crypto.randomBytes(8).toString('hex');
    const run = await runs().patch(companyId, runId, {}, { $push: { connectorReads: { ...entry, slot, state: STATE.PENDING, chars: maxChars, at: new Date() } } });
    if (!run) throw refusal('run_required', 'This read does not belong to a run that can be found, so nothing was read.');
    const settle = (fields) => runs().settleConnectorRead(companyId, runId, slot, fields);
    const counted = (Array.isArray(run.connectorReads) ? run.connectorReads : []).filter((r) => r && r.state !== STATE.REFUSED);
    const ahead = counted.slice(0, counted.findIndex((r) => r.slot === slot));
    if (ahead.length >= limits.RUN.CALLS) {
        await settle({ state: STATE.REFUSED, reason: 'run_call_cap', chars: 0 });
        throw refusal('run_call_cap', `One run can read from connected apps at most ${limits.RUN.CALLS} times. Stop here and tell the person what you have.`);
    }
    const left = limits.RUN.CHARS - ahead.reduce((sum, r) => sum + (Number(r.chars) || 0), 0);
    if (left <= 0) {
        await settle({ state: STATE.REFUSED, reason: 'run_char_cap', chars: 0 });
        throw refusal('run_char_cap', `One run can take in at most ${limits.RUN.CHARS} characters from connected apps. Stop here and tell the person what you have.`);
    }
    return { settle, maxChars: Math.min(maxChars, left) };
};

/* The tool is handed a request function, never the token: the token is fetched here, sent only to the
 * provider's own hosts, and lives in one header of one call. A read tool can only GET. */
const requesterFor = (tool, connection) => async (url, { query } = {}) => {
    const token = await tokenOf(tool, connection);
    return agentFetch.callApi(url, { method: 'get', query, token, hosts: tool.definition.egressHosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
};

/* safeFetch hands back any status, so a provider's refusal becomes an error here: it must not be kept as a delivery. */
const writeRequesterFor = (tool, connection) => async (url, { method = 'post', query, json } = {}) => {
    const token = await tokenOf(tool, connection);
    const res = await agentFetch.callApi(url, { method, query, json, token, hosts: tool.definition.egressHosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (res.status < 200 || res.status >= 300) throw refusal('provider_refused', `${tool.definition.name} answered ${res.status}, so this did not go through.`);
    return res;
};

const ownConnection = async (tool, companyId, userId, asked) => {
    const connection = await connectionOf(tool, companyId, userId);
    if (asked !== undefined && String(asked) !== String(connection.connectionId)) {
        throw refusal('not_connected', `That connection is not yours. Leave connectionId out to use your own ${tool.definition.name} connection.`);
    }
    if (!(connection.scopes || []).includes(tool.scope)) {
        throw refusal('scope_missing', `Tick ${tool.product} on your ${tool.definition.name} connection in My connections, then ask again.`);
    }
    return connection;
};

/* The stored params keep the connection's id, so a later send through any other is refused. */
const admitWrite = async ({ companyId, userId, key, input = {} }) => {
    const tool = tools.get(key);
    if (!tool || tool.kind !== tools.KIND.WRITE || !tools.isOn(tool)) throw refusal('tool_off', `${key} is not available here.`);
    if (!userId) throw refusal('no_person', 'This write names no person, so no connection can be used.');
    const { connectionId: asked, ...args } = input || {};
    const problem = argsSchema.problemIn(tool.input, args);
    if (problem) throw refusal('bad_input', `${key}: ${problem}`);
    const connection = await ownConnection(tool, companyId, userId, asked);
    return { tool, args, connection, params: { ...args, connectionId: String(connection.connectionId) } };
};

const write = async ({ companyId, userId, key, params = {} }) => {
    const { tool, args, connection } = await admitWrite({ companyId, userId, key, input: params });
    const raw = await egressContext.run(
        { companyId: String(companyId), actor: String(userId) },
        () => tool.run({ input: args, connection: { connectionId: connection.connectionId, request: writeRequesterFor(tool, connection) }, caps: { ...tool.caps } }),
    );
    return { text: plain(raw).slice(0, tool.caps.maxChars), connectionId: String(connection.connectionId) };
};

const read = async ({ companyId, userId, via, runId = null, key, input = {} }) => {
    const tool = tools.get(key);
    if (!tool || tool.kind !== tools.KIND.READ || !tools.isOn(tool)) throw refusal('tool_off', `${key} is not available here.`);
    if (!userId) throw refusal('no_person', 'This read names no person, so no connection can be used.');
    const { connectionId: asked, ...args } = input || {};
    const problem = argsSchema.problemIn(tool.input, args);
    if (problem) throw refusal('bad_input', `${key}: ${problem}`);
    if (via === VIA.AGENT && !runId) throw refusal('run_required', 'A connected app can be read only while an agent is running.');

    const connection = await ownConnection(tool, companyId, userId, asked);

    const claim = via === VIA.AGENT
        ? await claimRunRead(companyId, runId, { action: key, connector: tool.provider, connectionId: String(connection.connectionId) }, tool.caps.maxChars)
        : null;
    const maxChars = claim ? claim.maxChars : tool.caps.maxChars;
    let raw;
    try {
        raw = await egressContext.run(
            { companyId: String(companyId), actor: String(userId) },
            () => tool.run({ input: args, connection: { connectionId: connection.connectionId, request: requesterFor(tool, connection) }, caps: { maxItems: tool.caps.maxItems, maxChars } }),
        );
    } catch (error) {
        if (claim) await claim.settle({ state: STATE.FAILED, chars: 0 });
        throw error;
    }
    const whole = plain(raw);
    const text = whole.slice(0, maxChars);
    const source = taint.connector(tool.provider, taint.hashed(`${key}:${JSON.stringify(args)}`));

    if (claim) {
        await claim.settle({ state: STATE.APPLIED, chars: text.length });
        egressContext.noteConnectorRead(tool.provider);
    } else {
        taint.note(source);
    }
    return { text, chars: text.length, truncated: whole.length > text.length, taint: [source] };
};

module.exports = { VIA, STATE, read, admitWrite, write, plain };
