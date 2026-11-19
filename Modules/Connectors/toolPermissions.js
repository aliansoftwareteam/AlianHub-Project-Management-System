const { recordAudit } = require('../Audit/recorder');
const connection = require('./connection');
const connectionTools = require('./connectionTools');
const appSwitches = require('./appSwitches');
const tools = require('./tools');
const registry = require('./registry');

const { PERMISSION, ACCESS, STATUS, defaultPermission } = connectionTools;
const PERMISSIONS = Object.freeze(Object.values(PERMISSION));
const ACCESSES = Object.freeze(Object.values(ACCESS));

const refused = (status, message, code) => new connection.ConnectionError(status, message, code);

const catalogToolsOf = (provider) => tools.all().filter((tool) => tool.provider === provider && !tool.custom);

/* A REST app's tool keeps its owner's choice on the connection; a live MCP tool keeps it on its own row. */
const permissionOf = (tool, held) => {
    if (tool.live) return tool.permission || defaultPermission(tool.kind);
    const chosen = ((held && held.toolPermissions) || []).find((entry) => entry && entry.key === tool.key);
    return chosen && PERMISSIONS.includes(chosen.permission) ? chosen.permission : defaultPermission(tool.kind);
};

const catalogView = (tool, row) => ({
    key: tool.key,
    tool: tool.key,
    live: false,
    label: tool.label,
    usable: true,
    access: tool.kind,
    accessByOwner: false,
    permission: permissionOf(tool, row),
    changed: false,
    gone: false,
    on: tools.isOn(tool),
});

/* The owner's own connection, REST or MCP, with each tool's permission. */
const listFor = async ({ companyId, userId, row }) => {
    const catalog = catalogToolsOf(row.provider);
    if (!catalog.length && connectionTools.liveDefinition(row.provider)) return connectionTools.listFor({ companyId, userId, provider: row.provider });
    const base = { provider: row.provider, connectionId: String(row._id) };
    if (await appSwitches.isOff(companyId, row.provider)) return { ...base, status: STATUS.APP_OFF, tools: [] };
    return { ...base, status: STATUS.OK, tools: catalog.map((tool) => catalogView(tool, row)) };
};

const fieldsOf = (body) => {
    const given = body && typeof body === 'object' ? body : {};
    const fields = {};
    if (given.permission !== undefined) {
        if (!PERMISSIONS.includes(given.permission)) throw refused(400, 'A permission is allow, approval or off.', 'bad_permission');
        fields.permission = given.permission;
    }
    if (given.access !== undefined) {
        if (!ACCESSES.includes(given.access)) throw refused(400, 'A tool reads or writes.', 'bad_access');
        fields.access = given.access;
    }
    if (given.lookedAt !== undefined) {
        if (given.lookedAt !== true) throw refused(400, 'Looking at a tool again is said with lookedAt: true.', 'bad_looked_at');
        fields.lookedAt = true;
    }
    if (!Object.keys(fields).length) throw refused(400, 'Nothing to change was given.', 'nothing_to_change');
    return fields;
};

const changeLive = async ({ companyId, row, key, fields }) => {
    const { provider, tool } = connectionTools.splitKey(key);
    if (provider !== row.provider || !connectionTools.liveDefinition(provider)) return null;
    return connectionTools.change({ companyId, connectionId: String(row._id), tool, fields });
};

const changeCatalog = async ({ companyId, row, tool, fields, actor }) => {
    if (fields.access !== undefined) throw refused(400, 'This app decides itself whether this tool reads or writes.', 'access_fixed');
    if (fields.permission === undefined) return catalogView(tool, row);
    const saved = await connection.setToolPermission({
        companyId, row, key: tool.key, permission: fields.permission, isDefault: fields.permission === defaultPermission(tool.kind), actor,
    });
    return catalogView(tool, saved);
};

/* Only the owner of `row` reaches here; the route checked it. */
const change = async ({ companyId, row, key, body, actor }) => {
    const fields = fieldsOf(body);
    const catalogTool = catalogToolsOf(row.provider).find((t) => t.key === key);
    const live = !catalogTool;
    const view = catalogTool ? await changeCatalog({ companyId, row, tool: catalogTool, fields, actor }) : await changeLive({ companyId, row, key, fields });
    if (!view) throw refused(404, 'This connection has no such tool.', 'unknown_tool');
    if (live) {
        recordAudit(String(companyId), {
            actorId: String(actor.id), ...(actor.ip ? { ip: String(actor.ip) } : {}),
            action: 'connector.tool_permission_changed', entityType: 'connector', entityId: row.provider, entityName: (registry.get(row.provider) || {}).name || row.provider,
            meta: { userId: String(row.userId), connectionId: String(row._id), tool: String(key), ...fields },
        });
        connection.announce(companyId, row.userId, row.provider, 'tools_changed');
    }
    return view;
};

module.exports = { permissionOf, catalogToolsOf, listFor, change };
