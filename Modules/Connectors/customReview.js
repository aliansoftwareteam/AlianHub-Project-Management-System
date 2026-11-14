const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const egressContext = require('../Agents/engine/egressContext');
const mcpClient = require('./mcpClient');
const toolReviews = require('./toolReviews');
const custom = require('./customServers');

/* Every tool of a custom server is hidden until someone who may manage the server reviews it: turns it on, says
 * whether it only reads or changes things, and accepts the words a model is shown for it. What the server says about
 * its own tools reaches only that reviewer, as outside content, never a model (FR-45, FR-54). */

const TOOL_NAME = /^[A-Za-z0-9_.\-/]{1,128}$/;
const ACCESS = Object.freeze({ READ: 'read', WRITE: 'write' });
const LABEL_MAX = 80;
const DESCRIPTION_MAX = 500;
const OUTSIDE_MAX = 4000;
const SCHEMA_MAX_CHARS = 8000;
const SCHEMA_DEPTH = 6;
const SCHEMA_TEXT_MAX = 300;
const SCHEMA_PROPERTIES_MAX = 100;
const ENUM_MAX = 100;
const TYPES = Object.freeze(['string', 'integer', 'number', 'boolean', 'array', 'object', 'null']);
const NUMBER_KEYS = Object.freeze(['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']);

class ReviewError extends Error {
    constructor(status, code, message) { super(message); this.name = 'ReviewError'; this.status = status; this.code = code; }
}

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const tools = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_TOOLS, data }, method);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const words = (value, max) => String(value === undefined || value === null ? '' : value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
const line = (value, max) => words(value, max * 4).replace(/\s+/g, ' ').slice(0, max);
const primitive = (value) => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/* The input schema kept for a reviewed tool is the part the argument check reads, with every text bounded. Patterns
 * are left out on purpose: a server's regular expression run on every call could hold the event loop. */
const schemaOf = (schema, depth = 0) => {
    if (!isObject(schema) || depth > SCHEMA_DEPTH) return {};
    const out = {};
    const types = [].concat(schema.type || []).filter((type) => TYPES.includes(type));
    if (types.length) out.type = types.length === 1 ? types[0] : types;
    if (typeof schema.title === 'string') out.title = words(schema.title, SCHEMA_TEXT_MAX);
    if (typeof schema.description === 'string') out.description = words(schema.description, SCHEMA_TEXT_MAX);
    NUMBER_KEYS.filter((key) => Number.isFinite(schema[key])).forEach((key) => { out[key] = schema[key]; });
    if (Array.isArray(schema.enum)) out.enum = schema.enum.filter(primitive).slice(0, ENUM_MAX).map((v) => (typeof v === 'string' ? v.slice(0, SCHEMA_TEXT_MAX) : v));
    if (primitive(schema.default)) out.default = typeof schema.default === 'string' ? schema.default.slice(0, SCHEMA_TEXT_MAX) : schema.default;
    if (isObject(schema.properties)) {
        out.properties = Object.fromEntries(Object.entries(schema.properties).slice(0, SCHEMA_PROPERTIES_MAX)
            .filter(([name]) => name.length <= 64)
            .map(([name, value]) => [name, schemaOf(value, depth + 1)]));
        if (Array.isArray(schema.required)) out.required = schema.required.filter((name) => typeof name === 'string' && Object.hasOwn(out.properties, name));
    }
    if (isObject(schema.items)) out.items = schemaOf(schema.items, depth + 1);
    return out;
};

const inputSchemaOf = (tool) => {
    const schema = { ...schemaOf(tool.inputSchema), type: 'object' };
    if (!schema.properties) schema.properties = {};
    return JSON.stringify(schema).length <= SCHEMA_MAX_CHARS ? schema : null;
};

const rowsOf = async (companyId, provider) => ((await tools(companyId, [{ companyId: String(companyId), provider }], 'find')) || []).map(plain);

const stateOf = (row, shape) => {
    if (!row) return toolReviews.STATE.NEW;
    return row.state === toolReviews.STATE.REVIEWED && row.reviewedShape === shape ? toolReviews.STATE.REVIEWED : toolReviews.STATE.CHANGED;
};

const refusedBy = (error) => {
    if (error && error.name === 'ConnectorError') {
        return new ReviewError(409, 'connect_first', 'Connect your own account to this app first: its tools are read through your connection.');
    }
    if (error && error.status === 401) return new ReviewError(409, 'connect_again', 'The app no longer accepts your connection. Reconnect it, then look at its tools again.');
    return new ReviewError(502, 'server_unreachable', 'The app did not answer with its tools just now. Try again in a moment.');
};

/* The reviewer's own connection lists the tools, so nobody reviews a server they cannot reach themselves. */
const listed = async ({ companyId, row, reviewer }) => {
    const definition = custom.definitionOf(row);
    try {
        const conn = await require('./resolveConnection').resolveConnection({ companyId: String(companyId), userId: String(reviewer), provider: definition.id });
        const token = await conn.getAccessToken();
        const found = await egressContext.run(
            { companyId: String(companyId), actor: String(reviewer) },
            () => mcpClient.listTools({ provider: definition.id, url: definition.mcp.url, hosts: definition.egressHosts, token }),
        );
        return { definition, found };
    } catch (error) {
        throw refusedBy(error);
    }
};

/* A reviewed tool the server now describes differently is turned off and its reviewers told, as a call that met it
 * would; one the server stopped offering is turned off quietly. */
const hideDrift = async (companyId, definition, found, rows) => {
    const shapes = new Map(found.map((tool) => [tool.name, tool.shape]));
    for (const row of rows.filter((r) => r.enabled)) {
        const shape = shapes.get(row.tool);
        // eslint-disable-next-line no-await-in-loop
        if (shape && shape !== row.reviewedShape) await toolReviews.noteChanged({ companyId, definition, tool: row.tool, shape });
        // eslint-disable-next-line no-await-in-loop
        else if (!shape) await tools(companyId, [{ _id: row._id }, { $set: { enabled: false, state: toolReviews.STATE.CHANGED } }], 'updateOne');
    }
};

const viewOf = (tool, row) => {
    const state = stateOf(row, tool.shape);
    const schema = inputSchemaOf(tool);
    return {
        tool: tool.name,
        shape: tool.shape,
        usable: TOOL_NAME.test(tool.name) && Boolean(schema),
        outside: { name: words(tool.name, 200), description: words(tool.description, OUTSIDE_MAX), inputSchema: schema },
        review: {
            state,
            enabled: state === toolReviews.STATE.REVIEWED && Boolean(row.enabled),
            access: row && row.access === ACCESS.READ ? ACCESS.READ : ACCESS.WRITE,
            label: row && row.label ? row.label : line(tool.name, LABEL_MAX),
            description: row && row.description !== undefined ? row.description : line(tool.description, DESCRIPTION_MAX),
        },
    };
};

const forReview = async ({ companyId, row, reviewer }) => {
    const { definition, found } = await listed({ companyId, row, reviewer });
    const rows = await rowsOf(companyId, definition.id);
    await hideDrift(companyId, definition, found, rows);
    const byTool = new Map((await rowsOf(companyId, definition.id)).map((r) => [r.tool, r]));
    return found.map((tool) => viewOf(tool, byTool.get(tool.name)));
};

/* Saved against the tool as the server describes it now, read again here, and only when that is the version the
 * reviewer saw: a server that changes a tool between the listing and the save gets nothing turned on. */
const review = async ({ companyId, row, reviewer, tool: name, body = {} }) => {
    const { definition, found } = await listed({ companyId, row, reviewer: reviewer.id });
    const tool = found.find((t) => t.name === String(name));
    if (!tool) throw new ReviewError(404, 'no_such_tool', 'This app does not offer that tool.');
    const enabled = body.enabled === true;
    if (enabled && body.shape !== tool.shape) throw new ReviewError(409, 'tool_changed', 'The app changed this tool since you looked at it. Look at it again before turning it on.');
    const schema = inputSchemaOf(tool);
    if (enabled && !(TOOL_NAME.test(tool.name) && schema)) throw new ReviewError(422, 'not_usable', 'This tool\'s name or the details it takes are not in a form AlianHub can check, so it cannot be turned on.');
    const access = body.access === ACCESS.READ ? ACCESS.READ : ACCESS.WRITE;
    const label = line(body.label, LABEL_MAX) || line(tool.name, LABEL_MAX);
    const description = body.description === undefined ? line(tool.description, DESCRIPTION_MAX) : line(body.description, DESCRIPTION_MAX);
    const now = new Date();
    await tools(companyId, [
        { companyId: String(companyId), provider: definition.id, tool: tool.name },
        { $set: {
            shape: tool.shape, reviewedShape: tool.shape, state: toolReviews.STATE.REVIEWED, enabled, access, label, description,
            inputSchema: schema || { type: 'object', properties: {} }, reviewedBy: String(reviewer.id), reviewedAt: now, seenAt: now,
        } },
        { upsert: true },
    ], 'updateOne');
    recordAudit(String(companyId), {
        actorId: String(reviewer.id), ...(reviewer.ip ? { ip: String(reviewer.ip) } : {}),
        action: 'connector.tool_reviewed', entityType: 'connector', entityId: definition.id, entityName: definition.name,
        meta: { serverId: String(row._id), tool: tool.name, enabled, access },
    });
    const saved = plain(await tools(companyId, [{ companyId: String(companyId), provider: definition.id, tool: tool.name }], 'findOne'));
    return viewOf(tool, saved);
};

const offeredTools = async (companyId) => {
    const servers = await custom.offered(companyId);
    if (!servers.length) return [];
    const rows = ((await tools(companyId, [{ companyId: String(companyId), provider: { $in: servers.map((s) => s.id) }, state: toolReviews.STATE.REVIEWED, enabled: true }], 'find')) || []).map(plain);
    return servers.map((definition) => ({ definition, tools: rows.filter((r) => r.provider === definition.id && r.reviewedShape === r.shape) }))
        .filter((entry) => entry.tools.length);
};

const reviewedTool = async (companyId, provider, name) => {
    const row = plain(await tools(companyId, [{ companyId: String(companyId), provider, tool: String(name) }], 'findOne'));
    return row && row.state === toolReviews.STATE.REVIEWED && row.enabled && row.reviewedShape === row.shape ? row : null;
};

module.exports = { ACCESS, TOOL_NAME, ReviewError, schemaOf, forReview, review, offeredTools, reviewedTool };
