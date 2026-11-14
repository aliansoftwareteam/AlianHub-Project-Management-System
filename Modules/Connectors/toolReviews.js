const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { Notification_key: { CONNECTOR_TOOL_CHANGED } } = require('../../Config/notificationKey');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { recordAudit } = require('../Audit/recorder');

const STATE = Object.freeze({ NEW: 'new', CHANGED: 'changed', REVIEWED: 'reviewed' });
const SHAPE = /^[a-f0-9]{64}$/;
const NOTICE_SCOPE = 'connectors';

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const db = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_TOOLS, data }, method);
const find = async (companyId, provider, tool) => plain(await db(companyId, [{ companyId: String(companyId), provider: String(provider), tool: String(tool) }], 'findOne'));

/* The shape a call may go out with: the one a workspace owner or admin approved after the app changed the tool, or
 * the catalog's. A tool the catalog never reviewed stays off, whatever is stored here. */
const approvedShape = async (companyId, provider, tool, catalogShape) => {
    if (!SHAPE.test(String(catalogShape || ''))) return catalogShape;
    const row = await find(companyId, provider, tool).catch(() => null);
    return row && row.state === STATE.REVIEWED && row.enabled && SHAPE.test(String(row.reviewedShape || '')) ? row.reviewedShape : catalogShape;
};

/* A call found the app's tool different from what was reviewed. The tool is off for the workspace until an owner or
 * admin looks again, and they are told once per change, not once per call. Never fails the call that found it. */
const noteChanged = async ({ companyId, definition, tool, shape }) => {
    try {
        const existing = await find(companyId, definition.id, tool);
        const alreadyKnown = existing && existing.shape === shape && (existing.state === STATE.CHANGED || existing.reviewedShape === shape);
        if (alreadyKnown) return false;
        await db(companyId, [
            { companyId: String(companyId), provider: definition.id, tool: String(tool) },
            { $set: { shape, state: STATE.CHANGED, enabled: false, seenAt: new Date() }, $setOnInsert: { reviewedShape: '', access: 'write' } },
            { upsert: true },
        ], 'updateOne');
        const { ownersAndAdmins, sendNotice } = require('../Inbox/helpers/workspaceNotice');
        await sendNotice(String(companyId), await ownersAndAdmins(companyId), {
            key: CONNECTOR_TOOL_CHANGED, type: NOTICE_SCOPE, scope: NOTICE_SCOPE, label: 'connector tool changed',
            message: `${definition.name} changed one of its tools, so AlianHub stopped using it. An owner or admin can look at it again on the Connectors screen.`,
            changeData: { provider: definition.id, name: definition.name, tool: String(tool) },
        });
        return true;
    } catch (e) {
        logger.warn(`a changed tool of ${definition.id} was not recorded: ${(e && e.name) || 'Error'}`);
        return false;
    }
};

/* What an owner or admin sees per catalog tool of one provider: whether the app changed it and whether it is on. */
const listFor = async (companyId, definition, tools) => {
    const rows = ((await db(companyId, [{ companyId: String(companyId), provider: definition.id }], 'find')) || []).map(plain);
    const byTool = Object.fromEntries(rows.map((row) => [row.tool, row]));
    return tools.filter((tool) => tool.mcp).map((tool) => {
        const row = byTool[tool.mcp.tool];
        const reviewedHere = row && row.state === STATE.REVIEWED;
        return {
            key: tool.key, tool: tool.mcp.tool, kind: tool.kind, label: tool.label,
            state: !tool.mcp.shape ? 'unreviewed' : (row ? row.state : STATE.REVIEWED),
            on: Boolean(tool.mcp.shape) && (!row || (reviewedHere && row.enabled)),
            seenAt: row ? row.seenAt || null : null,
        };
    });
};

/* An owner or admin approves the tool as the app describes it now, or keeps it off. Only a tool the catalog knows and
 * a call has seen changed can be approved; read or write stays what the catalog says. */
const review = async ({ companyId, definition, tool, enabled, actor }) => {
    const row = await find(companyId, definition.id, tool);
    if (!row || row.state === STATE.NEW) return { ok: false, code: 'nothing_to_review' };
    const saved = plain(await db(companyId, [
        { _id: row._id },
        { $set: { reviewedShape: row.shape, state: STATE.REVIEWED, enabled: Boolean(enabled), reviewedBy: String(actor.id), reviewedAt: new Date() } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate'));
    recordAudit(String(companyId), {
        actorId: String(actor.id), ...(actor.ip ? { ip: String(actor.ip) } : {}),
        action: 'connector.tool_reviewed', entityType: 'connector', entityId: definition.id, entityName: definition.name, meta: { tool: String(tool), enabled: Boolean(enabled) },
    });
    return { ok: true, row: saved };
};

module.exports = { STATE, approvedShape, noteChanged, listFor, review };
