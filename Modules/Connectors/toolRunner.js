const crypto = require('crypto');
const argsSchema = require('../Mcp/argsSchema');
const taint = require('../Agents/taint');
const egressContext = require('../Agents/engine/egressContext');
const agentFetch = require('../Agents/engine/agentFetch');
const limits = require('../Agents/connectors/readLimits');
const connections = require('./resolveConnection');
const tools = require('./tools');
const quotas = require('./quotas');
const rateLimits = require('./rateLimits');
const health = require('./health');
const callAudit = require('./callAudit');

const VIA = Object.freeze({ AGENT: 'agent', MCP: 'mcp', APPROVED: 'approved' });
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

const spoken = (tool, companyId, userId) => async (e) => {
    if (!e || e.name !== 'ConnectorError' || !MESSAGES[e.code]) throw e;
    if (e.code === 'broken') await health.tellBroken(companyId, userId, tool.provider, tool.definition.name);
    throw refusal(e.code, MESSAGES[e.code](tool.definition.name));
};

const connectionOf = (tool, companyId, userId) => connections.resolveConnection({ companyId: String(companyId), userId: String(userId), provider: tool.provider }).catch(spoken(tool, companyId, userId));

/* One audit row for every call, and the connection's health once the provider was reached. `trace` is filled in as the
 * call goes, so a refusal says how far it got. */
const tracked = async (entry, work) => {
    const { companyId } = entry;
    const trace = { connectionId: '', called: false, chars: 0 };
    try {
        const out = await work(trace);
        callAudit.record(companyId, { ...entry, ...trace, state: STATE.APPLIED });
        if (trace.called) await health.noteUse(companyId, trace.connectionId);
        return out;
    } catch (error) {
        const reason = String((error && error.code) || 'error');
        callAudit.record(companyId, { ...entry, ...trace, state: trace.called ? STATE.FAILED : STATE.REFUSED, reason });
        if (trace.called) await health.noteFailure(companyId, trace.connectionId, reason);
        throw error;
    }
};

const busy = (tool, until) => Object.assign(refusal('provider_busy', `${tool.definition.name} asked to wait, so nothing goes to it until ${until.toISOString()}.`), { retryAt: until });

const refuseWhileHeld = async (tool, companyId, connection) => {
    const until = await rateLimits.heldUntil(companyId, connection.connectionId);
    if (until) throw busy(tool, until);
};

/* The token is fetched here for one header of one call, and a provider's "slow down" holds the connection for the next one. */
const callProvider = async ({ tool, companyId, userId, connection, trace }, url, options) => {
    const token = await connection.getAccessToken().catch(spoken(tool, companyId, userId));
    trace.called = true;
    const res = await agentFetch.callApi(url, { ...options, token, hosts: tool.definition.egressHosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (rateLimits.isRateLimited(tool.definition, res)) throw busy(tool, await rateLimits.hold(companyId, connection.connectionId, res));
    return res;
};

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

/* The tool is handed a request function, never the token, which goes only to the provider's own hosts. A read tool can only GET. */
const requesterFor = (call) => async (url, { query } = {}) => callProvider(call, url, { method: 'get', query });

/* safeFetch hands back any status, so a provider's refusal becomes an error here: it must not be kept as a delivery. */
const writeRequesterFor = (call) => async (url, { method = 'post', query, json } = {}) => {
    const res = await callProvider(call, url, { method, query, json });
    if (res.status < 200 || res.status >= 300) throw refusal('provider_refused', `${call.tool.definition.name} answered ${res.status}, so this did not go through.`);
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

/* `beforeSend` runs once the write is admitted and nothing holds the provider back, so a refusal costs its caller nothing. */
const write = ({ companyId, userId, key, params = {}, beforeSend = async () => {} }) => tracked(
    { companyId, userId, via: VIA.APPROVED, key, tool: tools.get(key), phase: callAudit.PHASE.SEND, input: params },
    async (trace) => {
        const { tool, args, connection } = await admitWrite({ companyId, userId, key, input: params });
        trace.connectionId = connection.connectionId;
        await refuseWhileHeld(tool, companyId, connection);
        await beforeSend();
        const raw = await egressContext.run(
            { companyId: String(companyId), actor: String(userId) },
            () => tool.run({ input: args, connection: { connectionId: connection.connectionId, request: writeRequesterFor({ tool, companyId, userId, connection, trace }) }, caps: { ...tool.caps } }),
        );
        const text = plain(raw).slice(0, tool.caps.maxChars);
        trace.chars = text.length;
        return { text, connectionId: String(connection.connectionId) };
    },
);

const readAdmitted = async ({ companyId, userId, via, runId, callerId, key, input }, trace) => {
    const tool = tools.get(key);
    if (!tool || tool.kind !== tools.KIND.READ || !tools.isOn(tool)) throw refusal('tool_off', `${key} is not available here.`);
    if (!userId) throw refusal('no_person', 'This read names no person, so no connection can be used.');
    const { connectionId: asked, ...args } = input || {};
    const problem = argsSchema.problemIn(tool.input, args);
    if (problem) throw refusal('bad_input', `${key}: ${problem}`);
    if (via === VIA.AGENT && !runId) throw refusal('run_required', 'A connected app can be read only while an agent is running.');

    const connection = await ownConnection(tool, companyId, userId, asked);
    trace.connectionId = connection.connectionId;
    await refuseWhileHeld(tool, companyId, connection);

    const quota = await quotas.claimRead(companyId, { connectionId: connection.connectionId, userId, actor: { type: via, id: callerId } });
    let claim = null;
    if (via === VIA.AGENT) {
        try {
            claim = await claimRunRead(companyId, runId, { action: key, connector: tool.provider, connectionId: String(connection.connectionId) }, tool.caps.maxChars);
        } catch (error) {
            await quota.release();
            throw error;
        }
    }
    const maxChars = claim ? claim.maxChars : tool.caps.maxChars;
    let raw;
    try {
        raw = await egressContext.run(
            { companyId: String(companyId), actor: String(userId) },
            () => tool.run({ input: args, connection: { connectionId: connection.connectionId, request: requesterFor({ tool, companyId, userId, connection, trace }) }, caps: { maxItems: tool.caps.maxItems, maxChars } }),
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
    trace.chars = text.length;
    return { text, chars: text.length, truncated: whole.length > text.length, taint: [source] };
};

/* `callerId` is the agent on a run and the AI client over MCP: what the usage row and the audit row name besides the person. */
const read = ({ companyId, userId, via, runId = null, callerId = '', key, input = {} }) => tracked(
    { companyId, userId, via, callerId, runId, key, tool: tools.get(key), phase: callAudit.PHASE.READ, input },
    (trace) => readAdmitted({ companyId, userId, via, runId, callerId, key, input }, trace),
);

module.exports = { VIA, STATE, read, admitWrite, write, plain };
