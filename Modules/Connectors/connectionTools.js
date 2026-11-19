const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { Notification_key: { CONNECTOR_TOOL_CHANGED } } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const egressContext = require('../Agents/engine/egressContext');
const registry = require('./registry');
const connections = require('./resolveConnection');
const mcpClient = require('./mcpClient');

/* A built-in MCP app's tools come from its server, listed with each member's own connection (task 107). What the
 * server says about a tool is outside content: kept bounded, shown as the app's own words, never trusted. */

const ACCESS = Object.freeze({ READ: 'read', WRITE: 'write' });
const PERMISSION = Object.freeze({ ALLOW: 'allow', APPROVAL: 'approval', OFF: 'off' });
const STATUS = Object.freeze({ OK: 'ok', NOT_CONNECTED: 'not_connected', BROKEN: 'broken', UNREACHABLE: 'unreachable', OFF: 'provider_off', APP_OFF: 'app_off' });
const LIST_TIMEOUT_MS = 8000;
const DESCRIPTION_MAX = 4000;
const DEFAULT_CAPS = Object.freeze({ read: Object.freeze({ maxItems: 50, maxChars: 8000 }), write: Object.freeze({ maxItems: 1, maxChars: 4000 }) });
const NOTICE_SCOPE = 'connectors';
const STATUS_OF = Object.freeze({ broken: STATUS.BROKEN, provider_off: STATUS.OFF, app_off: STATUS.APP_OFF });

const refusal = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code, deterministic: true });
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const db = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTION_TOOLS, data }, method);
const review = () => require('./customReview');
// eslint-disable-next-line no-control-regex
const words = (value) => String(value || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, DESCRIPTION_MAX);

const liveDefinition = (provider) => {
    const definition = registry.get(provider);
    return definition && definition.transport === 'mcp' ? definition : null;
};

const keyOf = (provider, tool) => `${provider}.${tool}`;

const splitKey = (key) => {
    const text = String(key || '');
    const dot = text.indexOf('.');
    return dot > 0 ? { provider: text.slice(0, dot), tool: text.slice(dot + 1) } : { provider: '', tool: '' };
};

const defaultPermission = (access) => (access === ACCESS.READ ? PERMISSION.ALLOW : PERMISSION.APPROVAL);

const rowsOf = async (companyId, connectionId) => ((await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId) }], 'find')) || []).map(plain);

/* The owner is told once per shape, never once per listing or call. Never fails what found the change. */
const tellChanged = async ({ companyId, definition, row }) => {
    if (!row.changed || row.noticedShape === row.shape) return;
    try {
        await db(companyId, [{ _id: row._id }, { $set: { noticedShape: row.shape } }], 'updateOne');
        const { sendNotice } = require('../Inbox/helpers/workspaceNotice');
        await sendNotice(String(companyId), [String(row.userId)], {
            key: CONNECTOR_TOOL_CHANGED, type: NOTICE_SCOPE, scope: NOTICE_SCOPE, label: 'connector tool changed',
            message: `${definition.name} changed its tool ${row.tool}. AI chat still uses it; agents skip it until you look at it on the Connectors screen.`,
            changeData: { provider: definition.id, name: definition.name, tool: row.tool, connectionId: String(row.connectionId) },
        });
    } catch (e) {
        logger.warn(`a changed tool of ${definition.id} was not told to its owner: ${(e && e.name) || 'Error'}`);
    }
};

const fieldsOf = (found) => {
    const inputSchema = review().inputSchemaOf(found);
    return { description: words(found.description), inputSchema: inputSchema || { type: 'object', properties: {} }, usable: Boolean(inputSchema), shape: found.shape };
};

/* Only what differs is written, so listing on every request costs a read when nothing changed. */
const sync = async ({ companyId, userId, definition, connectionId, found, carried = [] }) => {
    const rows = await rowsOf(companyId, connectionId);
    const byTool = new Map(rows.map((row) => [row.tool, row]));
    const listed = new Set();
    const out = [];
    for (const tool of found.filter((t) => review().TOOL_NAME.test(t.name))) {
        listed.add(tool.name);
        const row = byTool.get(tool.name);
        const hinted = tool.readOnly ? ACCESS.READ : ACCESS.WRITE;
        const chosen = carried.find((entry) => entry && entry.key === keyOf(definition.id, tool.name) && Object.values(PERMISSION).includes(entry.permission));
        let next;
        if (!row) {
            next = {
                companyId: String(companyId), connectionId: String(connectionId), userId: String(userId), provider: definition.id, tool: tool.name,
                ...fieldsOf(tool), seenShape: tool.shape, changed: false, noticedShape: '', gone: false, access: hinted, accessByOwner: false, permission: chosen ? chosen.permission : defaultPermission(hinted),
            };
        } else {
            next = { ...row, ...(row.shape === tool.shape ? {} : fieldsOf(tool)), gone: false, changed: row.seenShape !== tool.shape, access: row.accessByOwner ? row.access : hinted };
        }
        const dirty = !row || ['shape', 'gone', 'changed', 'access'].some((field) => row[field] !== next[field]);
        if (dirty) {
            const { _id, ...fields } = next;
            // eslint-disable-next-line no-await-in-loop
            await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId), tool: tool.name }, { $set: fields }, { upsert: true }], 'updateOne');
            // eslint-disable-next-line no-await-in-loop
            if (next.changed) await tellChanged({ companyId, definition, row: plain(await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId), tool: tool.name }], 'findOne')) });
        }
        out.push(next);
    }
    const withdrawn = rows.filter((row) => !listed.has(row.tool) && !row.gone);
    if (withdrawn.length) await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId), tool: { $in: withdrawn.map((row) => row.tool) } }, { $set: { gone: true } }], 'updateMany');
    return out;
};

const viewOf = (row) => ({
    key: keyOf(row.provider, row.tool),
    tool: row.tool,
    live: true,
    outside: { description: row.description, inputSchema: row.inputSchema },
    usable: row.usable !== false,
    access: row.access,
    accessByOwner: Boolean(row.accessByOwner),
    permission: row.permission,
    changed: Boolean(row.changed),
    gone: Boolean(row.gone),
});

const failedListing = (provider, status) => ({ provider, status, tools: [] });

/* One app's tools, listed live with the member's own connection. A server that cannot be reached is said to be
 * unreachable, never unconnected. */
const listFor = async ({ companyId, userId, provider }) => {
    const definition = liveDefinition(provider);
    if (!definition) throw new TypeError(`${provider} does not list its tools from an MCP server`);
    let connection;
    try {
        connection = await connections.resolveConnection({ companyId: String(companyId), userId: String(userId), provider });
    } catch (error) {
        if (error && error.name === 'ConnectorError') return failedListing(provider, STATUS_OF[error.code] || STATUS.NOT_CONNECTED);
        throw error;
    }
    let found;
    try {
        const token = await connection.getAccessToken();
        found = await egressContext.run(
            { companyId: String(companyId), actor: String(userId) },
            () => mcpClient.listTools({ provider, url: definition.mcp.url, hosts: definition.egressHosts, token }),
        );
    } catch (error) {
        if (error && error.name === 'ConnectorError') return failedListing(provider, STATUS_OF[error.code] || STATUS.NOT_CONNECTED);
        if (error && error.status === 401) {
            await connections.markBroken({ companyId: String(companyId), connectionId: connection.connectionId, reason: 'mcp_unauthorized' });
            return failedListing(provider, STATUS.BROKEN);
        }
        return failedListing(provider, STATUS.UNREACHABLE);
    }
    const rows = await sync({ companyId, userId, definition, connectionId: connection.connectionId, found, carried: connection.toolPermissions || [] });
    const listed = new Set(rows.map((row) => row.tool));
    const gone = (await rowsOf(companyId, connection.connectionId)).filter((row) => !listed.has(row.tool));
    return { provider, status: STATUS.OK, connectionId: connection.connectionId, tools: [...rows, ...gone.map((row) => ({ ...row, gone: true }))].map(viewOf) };
};

const withinTime = (work, provider, timeoutMs) => {
    let timer;
    const late = new Promise((resolve) => {
        timer = setTimeout(() => resolve(failedListing(provider, STATUS.UNREACHABLE)), timeoutMs);
        if (timer.unref) timer.unref();
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
};

/* Every app at once, each held to its own time, so one slow server holds up none of the others. */
const listMine = ({ companyId, userId, providers, timeoutMs = LIST_TIMEOUT_MS }) => Promise.all(providers.map((provider) => withinTime(
    listFor({ companyId, userId, provider }).catch((error) => {
        logger.warn(`tools of ${provider} were not listed: ${(error && error.name) || 'Error'}`);
        return failedListing(provider, STATUS.UNREACHABLE);
    }),
    provider,
    timeoutMs,
)));

const capsOf = (definition, access) => ({ ...DEFAULT_CAPS[access], ...((definition.toolCaps || {})[access] || {}) });

/* A stored tool as the runner takes it: the connection's own read or write, the input the server describes (bounded),
 * and a caller of only that server tool. */
const runnable = (definition, row) => Object.freeze({
    key: keyOf(definition.id, row.tool),
    provider: definition.id,
    definition,
    live: true,
    label: row.tool,
    description: row.description || '',
    kind: row.access,
    product: 'server',
    changed: Boolean(row.changed),
    input: row.inputSchema,
    caps: Object.freeze(capsOf(definition, row.access)),
    mcp: Object.freeze({ tool: row.tool }),
    permission: row.permission || defaultPermission(row.access),
    run: async ({ input, connection }) => connection.mcp(row.tool, input),
    card: (input) => ({ target: definition.name, title: row.tool, text: JSON.stringify(input, null, 2), rows: [{ label: 'Connectors.card.customTool', value: row.tool }] }),
});

const runnableOfView = (definition, view) => runnable(definition, {
    tool: view.tool, access: view.access, inputSchema: view.outside.inputSchema, description: view.outside.description, permission: view.permission, changed: view.changed,
});

const findRow = async (companyId, connectionId, tool) => plain(await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId), tool: String(tool) }], 'findOne'));

/* The owner's choices on one tool. Looking at it again takes the shape the server describes now as seen, so the
 * changed warning clears and agents use it again. */
const change = async ({ companyId, connectionId, tool, fields }) => {
    const row = await findRow(companyId, connectionId, tool);
    if (!row) return null;
    const next = {
        ...(fields.permission === undefined ? {} : { permission: fields.permission }),
        ...(fields.access === undefined ? {} : { access: fields.access, accessByOwner: true }),
        ...(fields.lookedAt ? { seenShape: row.shape, changed: false, noticedShape: '' } : {}),
    };
    await db(companyId, [{ _id: row._id }, { $set: next }], 'updateOne');
    return viewOf({ ...row, ...next });
};

/* The tool a key names on the member's current connection. A connection never listed is listed first. An agent skips
 * a tool the server changed until its owner looks at it again (decision 3); AI chat still uses it. */
const toolFor = async ({ companyId, userId, connectionId, key, agent = false }) => {
    const { provider, tool } = splitKey(key);
    const definition = liveDefinition(provider);
    if (!definition) return null;
    let row = await findRow(companyId, connectionId, tool);
    if (!row) {
        await listFor({ companyId, userId, provider });
        row = await findRow(companyId, connectionId, tool);
    }
    if (!row || row.gone) throw refusal('tool_missing', `${definition.name} does not offer ${tool}.`);
    if (row.usable === false) throw refusal('tool_off', `${tool} takes details AlianHub cannot check, so it is not used.`);
    if (agent && row.changed) throw refusal('tool_changed', `${definition.name} changed ${tool}, so agents skip it until it is looked at again on the Connectors screen.`);
    return runnable(definition, row);
};

/* A call read the server's listing: the tool's shape now is kept, and a change is flagged and told once. */
const noteCalled = async ({ companyId, connectionId, definition, tool, shape }) => {
    try {
        const row = await findRow(companyId, connectionId, tool);
        if (!row || row.shape === shape) return;
        const changed = row.seenShape !== shape;
        await db(companyId, [{ _id: row._id }, { $set: { shape, changed, gone: false } }], 'updateOne');
        await tellChanged({ companyId, definition, row: { ...row, shape, changed } });
    } catch (e) {
        logger.warn(`a called tool of ${definition.id} was not recorded: ${(e && e.name) || 'Error'}`);
    }
};

const noteGone = async ({ companyId, connectionId, tool }) => {
    await db(companyId, [{ companyId: String(companyId), connectionId: String(connectionId), tool: String(tool) }, { $set: { gone: true } }], 'updateOne').catch(() => {});
};

module.exports = { ACCESS, PERMISSION, STATUS, LIST_TIMEOUT_MS, keyOf, splitKey, liveDefinition, defaultPermission, listFor, listMine, toolFor, runnableOfView, change, noteCalled, noteGone };
