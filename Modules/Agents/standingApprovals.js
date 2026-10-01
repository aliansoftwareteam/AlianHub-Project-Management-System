const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const socketEmitter = require('../../event/socketEventEmitter');
const registry = require('./registry');
const permissions = require('./permissions');
const audit = require('./agentAudit');
const taintMarks = require('./taint');
const projectPolicy = require('./projectPolicy');

// "Always do this" is a grant that outlives the click that made it, so it is narrow by construction: one kind
// of change, by one connection, for the person behind it, in one project, for 90 days. It is read in one place
// (projectPolicy.ask), where it can only let through a change that would otherwise wait for a person; whatever
// the registry, the holder's rights or the project refuse stays refused. Its maker's rights are asked again each
// time it is used, so it never does what its maker could not do by hand that day.

const LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const STATUS = Object.freeze({ ACTIVE: 'active', ENDED: 'ended' });
const ENDED = Object.freeze({
    PERSON: 'removed_by_a_person', EXPIRED: 'expired', POLICY: 'project_policy_tightened',
    CONNECTION: 'connection_removed', MAKER: 'maker_lost_seat', REPLACED: 'made_again',
});
const SOURCE_MCP = 'mcp';
const PENDING = 'pending';
const TASK_SCOPE = 'task';
const ACCEPTED_RISK = Object.freeze([registry.RISK.LOW, registry.RISK.MEDIUM]);
const SYSTEM = Object.freeze({ kind: 'human', userId: 'system', personName: 'System' });
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const oid = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);
const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const refused = (error, status) => ({ error, status });
const rowsWhere = async (companyId, filter) => ((await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_STANDING_APPROVALS, data: [filter] }, 'find')) || []).map(plain);

/* Why no standing approval covers this kind of change, or '' when one may. */
const kindRefusal = (action) => {
    const key = String(action || '');
    if (registry.isNever(key)) return `${key} is on the never-list`;
    const entry = registry.get(key);
    if (!entry || !entry.write || projectPolicy.ASKS_NOTHING.has(key)) return `${key || 'this'} is not a change an agent makes`;
    if (projectPolicy.STATUS_ACTIONS.has(key)) return 'a status change can close a task, and a person decides each close';
    if (entry.proposeOnly || entry.gate) return `${key} is proposed every time`;
    if (!ACCEPTED_RISK.includes(entry.risk) || !entry.undoable) return `${key} is high risk or cannot be undone`;
    const rating = require('./actions').rating(key);
    if (!rating || !rating.reversible) return `${key} cannot be undone`;
    if (rating.scope !== TASK_SCOPE) return `${key} reaches further than one task`;
    if (rating.money) return `${key} touches money`;
    return '';
};

const connectionOfProposal = (p) => {
    if (p.oauthGrantId) return { oauthGrantId: String(p.oauthGrantId), oauthClientId: String(p.oauthClientId || '') };
    return p.tokenId ? { tokenId: String(p.tokenId) } : null;
};

const connectionOfActor = (actor) => {
    if (actor.grantId && actor.clientId) return { oauthGrantId: String(actor.grantId), oauthClientId: String(actor.clientId) };
    return actor.tokenId ? { tokenId: String(actor.tokenId) } : null;
};

/* Why this proposal cannot be approved "always", from what it carries, or '' when it can. */
const proposalRefusal = (p) => {
    if (!p || p.source !== SOURCE_MCP || !connectionOfProposal(p) || !p.requestedBy) return 'only a connected agent\'s change can be approved always';
    if (!OBJECT_ID.test(String(p.projectId || ''))) return 'the change names no project';
    if (p.gate) return 'this change needs an owner or admin each time';
    if (p.taint && p.taint.reason) return 'the change came from a run that read outside content';
    const changes = Array.isArray(p.changes) ? p.changes : [];
    if (changes.length !== 1) return 'a standing approval covers one kind of change';
    return kindRefusal(changes[0].action);
};

const offerable = (p) => proposalRefusal(p) === '';
const labelOf = (action) => (registry.get(action) || {}).label || String(action);

const reachRefusal = async (companyId, projectId, change) => {
    const params = change.params || {};
    if (await projectPolicy.closes(companyId, change.action, params)) return 'this change closes a task, and a person decides each close';
    const reached = await projectPolicy.projectsOf(companyId, params);
    if (reached.length !== 1 || reached[0] !== String(projectId).toLowerCase()) return 'the change reaches another project';
    return '';
};

const shape = (row) => ({
    id: String(row._id), projectId: String(row.projectId), action: row.action, label: row.label || row.action,
    agentName: row.agentName || '', requestedBy: String(row.requestedBy), madeBy: String(row.madeBy), madeAt: row.madeAt,
    expiresAt: row.expiresAt, uses: Number(row.uses) || 0, lastUsedAt: row.lastUsedAt || null, status: row.status,
});

const emit = (companyId, row) => {
    const data = { kind: 'standing_approval', id: String(row._id), projectId: String(row.projectId), status: row.status };
    socketEmitter.emit('update', { type: 'update', module: 'agent', companyId: String(companyId), data, updatedFields: { kind: data.kind }, actor: { kind: 'human' }, depth: 1 });
};

const endRow = async (companyId, row, because, by = null, ip = '') => {
    const ended = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_STANDING_APPROVALS,
        data: [{ _id: row._id, status: STATUS.ACTIVE }, { $set: { status: STATUS.ENDED, endedAt: new Date(), endedBecause: because, ...(by ? { endedBy: String(by) } : {}) } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate'));
    if (!ended) return null;
    await audit.recordStandingApproval(companyId, by ? { kind: 'human', userId: String(by) } : SYSTEM, { ended: true, row: ended, because, ip });
    emit(companyId, ended);
    return ended;
};

const endAll = async (companyId, rows, because, by, ip) => {
    for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        await endRow(companyId, row, because, by, ip);
    }
    return rows.length;
};

const endForProject = async (companyId, projectId, because, by = null, ip = '') => endAll(
    companyId, await rowsWhere(companyId, { projectId: String(projectId).toLowerCase(), status: STATUS.ACTIVE }), because, by, ip,
);

const seated = async (companyId, userId) => {
    const role = await getRoleType(companyId, userId);
    return role !== null && role !== undefined && role !== ROLE_GUEST;
};

const connectionLives = async (companyId, row) => {
    if (row.oauthGrantId) {
        return Boolean(await require('../Mcp/oauthAuth').standingOfGrant({ companyId, grantId: row.oauthGrantId, clientId: row.oauthClientId, userId: row.requestedBy }));
    }
    const token = await require('../Mcp/approval').liveToken(companyId, row.tokenId);
    return Boolean(token) && String(token.userId || '') === String(row.requestedBy);
};

const expired = (row, now = Date.now()) => new Date(row.expiresAt).getTime() <= now;

/* Why a stored row stands no longer, or '' while it does. */
const endedBecause = async (companyId, row) => {
    if (expired(row)) return ENDED.EXPIRED;
    if (!(await seated(companyId, row.madeBy))) return ENDED.MAKER;
    return await connectionLives(companyId, row) ? '' : ENDED.CONNECTION;
};

const make = async (companyId, p, madeBy, ip) => {
    const change = p.changes[0];
    const key = { projectId: String(p.projectId).toLowerCase(), action: change.action, requestedBy: String(p.requestedBy), ...connectionOfProposal(p) };
    await endAll(companyId, await rowsWhere(companyId, { ...key, status: STATUS.ACTIVE }), ENDED.REPLACED, madeBy, ip);
    const now = new Date();
    const saved = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_STANDING_APPROVALS,
        data: {
            ...key, label: labelOf(change.action), agentId: String(p.agentId || ''), agentName: p.agentName || '',
            madeBy: String(madeBy), madeAt: now, proposalId: String(p._id), expiresAt: new Date(now.getTime() + LIFETIME_MS), status: STATUS.ACTIVE, uses: 0,
        },
    }, 'save'));
    await audit.recordStandingApproval(companyId, { kind: 'human', userId: String(madeBy) }, { row: saved, ip });
    emit(companyId, saved);
    return saved;
};

/* Approves the proposal as filed and, once its change is applied, keeps the approval for the same kind of change
 * by the same connection in the same project. Everything `proposals.approve` asks of the approver is asked first,
 * by it; a proposal outside the limits is left pending. */
const approveAlways = async (companyId, id, { decider, isPrivileged, ip = '', changes: edited, viaToken = false }) => {
    if (viaToken || !decider || decider.kind !== 'human' || decider.tokenId) return refused('Only a person signed in to AlianHub makes a standing approval.', 403);
    if (Array.isArray(edited) && edited.length) return refused('An edited approval cannot be made a standing one.', 400);
    const proposals = require('./proposals');
    const p = plain(await proposals.get(companyId, id));
    if (!p) return refused('Proposal not found.', 404);
    if (p.status === PENDING) {
        const why = proposalRefusal(p) || await reachRefusal(companyId, p.projectId, p.changes[0]);
        if (why) return refused(`This change cannot be approved always: ${why}.`, 409);
    }
    const out = await proposals.approve(companyId, id, { decider, isPrivileged, ip });
    if (out.error) return out;
    const applied = Array.isArray(out.applied) ? out.applied : [];
    if (!applied.length || !applied.every((change) => change.ok)) return { ...out, standing: null };
    return { ...out, standing: shape(await make(companyId, p, decider.userId, ip)) };
};

/* An outside client's own mark is how its calls are told apart, not content it read. */
const readOutsideContent = (marker, connection) => {
    if (!taintMarks.isTainted(marker)) return false;
    const sources = taintMarks.sourcesOf(marker);
    const ownMark = (source) => source && source.kind === taintMarks.KINDS.CLIENT && Boolean(connection.oauthClientId) && String(source.ref) === connection.oauthClientId.slice(0, 200);
    return !sources.length || !sources.every(ownMark);
};

const makerCould = async (companyId, madeBy, action, params) => {
    const approval = require('../Mcp/approval');
    const own = await permissions.holderMay(companyId, { kind: 'human', userId: String(madeBy) }, action, params);
    return own.allowed && approval.reachable(companyId, { userId: String(madeBy), projectIds: [] }, approval.targetOf(params));
};

/* The standing approval that lets this change through, or null. Asked by projectPolicy.ask alone. */
const covering = async ({ companyId, actor, action, params, projectIds, taint }) => {
    const connection = connectionOfActor(actor || {});
    if (!connection || !Array.isArray(projectIds) || projectIds.length !== 1) return null;
    if (kindRefusal(action) || readOutsideContent(taint, connection)) return null;
    const [row] = await rowsWhere(companyId, { projectId: String(projectIds[0]).toLowerCase(), action, status: STATUS.ACTIVE, requestedBy: String(actor.userId), ...connection });
    if (!row) return null;
    if (expired(row)) { await endRow(companyId, row, ENDED.EXPIRED); return null; }
    if (!(await seated(companyId, row.madeBy))) { await endRow(companyId, row, ENDED.MAKER); return null; }
    if (!(await makerCould(companyId, row.madeBy, action, params))) return null;
    return { id: String(row._id), madeBy: String(row.madeBy) };
};

/* Counts the use and files the change as one its maker already approved, so it is listed as done and can be undone. */
const recordUse = async (companyId, standing, { action, params, auditId, reason }) => {
    const row = plain(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_STANDING_APPROVALS,
        data: [{ _id: oid(standing.id) }, { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate'));
    if (!row) return null;
    return require('./proposals').fileApplied(companyId, { rule: row, action, params, auditId, why: reason });
};

/* What stands in a project, as its viewer may see it: every row for an owner or admin, a person's own otherwise.
 * A row whose time, maker or connection is gone is ended here, so the list never shows one that no longer works. */
const list = async (companyId, projectId, { userId, privileged }) => {
    const standingNow = [];
    for (const row of await rowsWhere(companyId, { projectId: String(projectId).toLowerCase(), status: STATUS.ACTIVE })) {
        // eslint-disable-next-line no-await-in-loop
        const because = await endedBecause(companyId, row);
        // eslint-disable-next-line no-await-in-loop
        if (because) await endRow(companyId, row, because);
        else standingNow.push(row);
    }
    const mine = (row) => String(row.madeBy) === String(userId);
    return { rows: standingNow.filter((row) => privileged || mine(row)).map((row) => ({ ...shape(row), canEnd: true })), lifetimeDays: LIFETIME_MS / (24 * 60 * 60 * 1000) };
};

/* One answer for a row that is not there and one the caller may not see. */
const end = async (companyId, id, { projectId, by, ip = '' }) => {
    const [row] = oid(id) ? await rowsWhere(companyId, { _id: oid(id), projectId: String(projectId).toLowerCase() }) : [];
    if (!row || (!by.privileged && String(row.madeBy) !== String(by.userId))) return refused('Standing approval not found.', 404);
    if (row.status !== STATUS.ACTIVE) return { row: shape(row) };
    const ended = await endRow(companyId, row, ENDED.PERSON, by.userId, ip);
    return { row: shape(ended || row) };
};

module.exports = { LIFETIME_MS, STATUS, ENDED, kindRefusal, proposalRefusal, offerable, labelOf, approveAlways, covering, recordUse, list, end, endForProject };
