const argsSchema = require('../Mcp/argsSchema');
const taint = require('../Agents/taint');
const egressContext = require('../Agents/engine/egressContext');
const agentFetch = require('../Agents/engine/agentFetch');
const limits = require('../Agents/connectors/readLimits');
const tools = require('./tools');

const VIA = Object.freeze({ AGENT: 'agent', MCP: 'mcp' });
const STATE = Object.freeze({ APPLIED: 'applied', REFUSED: 'refused' });
const TIMEOUT_MS = 10000;
const MAX_BYTES = 512 * 1024;

const refusal = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true });

// resolveConnection.js is track A's (063 contract §5). Until it lands no connection can be found, so every call is refused.
const resolveConnection = (args) => {
    let resolver;
    try {
        resolver = require('./resolveConnection');
    } catch (e) {
        if (e.code !== 'MODULE_NOT_FOUND') throw e;
        return Promise.reject(Object.assign(new Error('provider_off'), { name: 'ConnectorError', code: 'provider_off', provider: args.provider }));
    }
    return resolver.resolveConnection(args);
};

const MESSAGES = Object.freeze({
    not_connected: (name) => `Connect ${name} on My connections first, then ask again.`,
    not_member: () => 'This read is not available to you.',
    broken: (name) => `${name} is no longer accepting your connection. Reconnect ${name} on My connections, then ask again.`,
    provider_off: (name) => `${name} is not switched on here.`,
});

const connectionOf = async (tool, companyId, userId) => {
    try {
        return await resolveConnection({ companyId: String(companyId), userId: String(userId), provider: tool.provider });
    } catch (e) {
        if (!e || e.name !== 'ConnectorError' || !MESSAGES[e.code]) throw e;
        throw refusal(e.code, MESSAGES[e.code](tool.definition.name));
    }
};

/* What the provider sent is data for the model, never markup or control characters. */
// eslint-disable-next-line no-control-regex
const plain = (value) => String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();

/* A refused read took nothing in, so it does not count against the run. Every connector shares the run's caps. */
const usedBy = async (companyId, runId) => {
    const run = await require('../Agents/runs').get(companyId, runId);
    if (!run) return null;
    const reads = (Array.isArray(run.connectorReads) ? run.connectorReads : []).filter((r) => r && r.state !== STATE.REFUSED);
    return { calls: reads.length, chars: reads.reduce((sum, r) => sum + (Number(r.chars) || 0), 0) };
};

const charsLeftInRun = async (companyId, runId) => {
    const used = await usedBy(companyId, runId);
    if (!used) throw refusal('run_required', 'This read does not belong to a run that can be found, so nothing was read.');
    if (used.calls >= limits.RUN.CALLS) throw refusal('run_call_cap', `One run can read from connected apps at most ${limits.RUN.CALLS} times. Stop here and tell the person what you have.`);
    const left = limits.RUN.CHARS - used.chars;
    if (left <= 0) throw refusal('run_char_cap', `One run can take in at most ${limits.RUN.CHARS} characters from connected apps. Stop here and tell the person what you have.`);
    return left;
};

const noteInRun = (companyId, runId, entry) => require('../Agents/runs').patch(companyId, runId, {}, { $push: { connectorReads: { ...entry, at: new Date() } } });

/* The tool is handed a request function, never the token: the token is fetched here, sent only to the
 * provider's own hosts, and lives in one header of one call. */
const requesterFor = (tool, connection) => async (url, options = {}) => {
    const token = await connection.getAccessToken();
    return agentFetch.callApi(url, { ...options, token, hosts: tool.definition.egressHosts, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
};

/* One read through a connector tool, for the person a run works for or the person behind an MCP token. Only that
 * person's own connection is used; a connectionId that names any other is refused. */
const read = async ({ companyId, userId, via, runId = null, key, input = {} }) => {
    const tool = tools.get(key);
    if (!tool || tool.kind !== tools.KIND.READ || !tools.isOn(tool)) throw refusal('tool_off', `${key} is not available here.`);
    if (!userId) throw refusal('no_person', 'This read names no person, so no connection can be used.');
    const { connectionId: asked, ...args } = input || {};
    const problem = argsSchema.problemIn(tool.input, args);
    if (problem) throw refusal('bad_input', `${key}: ${problem}`);
    if (via === VIA.AGENT && !runId) throw refusal('run_required', 'A connected app can be read only while an agent is running.');
    const charsLeft = via === VIA.AGENT ? await charsLeftInRun(companyId, runId) : tool.caps.maxChars;

    const connection = await connectionOf(tool, companyId, userId);
    if (asked !== undefined && String(asked) !== String(connection.connectionId)) {
        throw refusal('not_connected', `That connection is not yours. Leave connectionId out to use your own ${tool.definition.name} connection.`);
    }
    if (!(connection.scopes || []).includes(tool.scope)) {
        throw refusal('scope_missing', `Tick ${tool.product} on your ${tool.definition.name} connection in My connections, then ask again.`);
    }

    const maxChars = Math.min(tool.caps.maxChars, charsLeft);
    const raw = await egressContext.run(
        { companyId: String(companyId), actor: String(userId) },
        () => tool.run({ input: args, connection: { connectionId: connection.connectionId, request: requesterFor(tool, connection) }, caps: { maxItems: tool.caps.maxItems, maxChars } }),
    );
    const whole = plain(raw);
    const text = whole.slice(0, maxChars);
    const source = taint.connector(tool.provider, taint.hashed(`${key}:${JSON.stringify(args)}`));

    if (via === VIA.AGENT) {
        await noteInRun(companyId, runId, { action: key, connector: tool.provider, connectionId: String(connection.connectionId), state: STATE.APPLIED, chars: text.length });
        egressContext.noteConnectorRead(tool.provider);
    } else {
        taint.note(source);
    }
    return { text, chars: text.length, truncated: whole.length > text.length, taint: [source] };
};

module.exports = { VIA, STATE, read, plain };
