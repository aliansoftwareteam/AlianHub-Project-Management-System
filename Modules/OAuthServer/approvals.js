const store = require('./store');
const config = require('./config');
const grants = require('./grants');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_OWNER, ROLE_ADMIN } = require('../../Config/roleTypes');

const STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', DENIED: 'denied', REVOKED: 'revoked' });
const DAY_MS = 24 * 60 * 60 * 1000;
// A refused client cannot be put back in front of owners and admins until a day has passed.
const REQUEST_COOLDOWN_MS = DAY_MS;
const MAX_REQUESTS_PER_PERSON_PER_DAY = 10;

class ApprovalError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'ApprovalError';
        this.statusCode = statusCode;
    }
}

const hostOf = (uri) => {
    try { return new URL(uri).hostname; } catch (error) { return ''; }
};

const describeClient = (client) => ({
    clientName: client.name || client.clientName || '',
    clientKind: client.kind || client.clientKind || '',
    redirectHosts: [...new Set((client.redirectUris || []).map(hostOf).filter(Boolean))],
});

const inScopeOrder = (list) => config.SCOPES.filter((scope) => list.includes(scope));

const covers = (approval, scopes) => Boolean(approval) && approval.status === STATUS.APPROVED
    && scopes.every((scope) => (approval.scopes || []).includes(scope));

const audit = (companyId, actor, action, approval, meta = {}) => {
    try {
        require('../Audit/recorder').recordAudit(companyId, {
            actorId: String(actor.id || ''),
            actorName: '',
            ...(actor.ip ? { ip: actor.ip } : {}),
            action,
            entityType: 'oauth_client',
            entityId: approval.clientId,
            entityName: approval.clientName || '',
            meta: { status: approval.status, scopes: approval.scopes || [], privateSprints: Boolean(approval.privateSprints), ...meta },
        });
    } catch (error) {
        logger.error(`oauth: audit ${action} failed: ${error.message}`);
    }
};

const ownersAndAdmins = async (companyId) => {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const rows = await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.COMPANY_USERS, data: [{ roleType: { $in: [ROLE_OWNER, ROLE_ADMIN] }, ...ACTIVE_SEAT }, { userId: 1 }],
    }, 'find').catch(() => []);
    return [...new Set((rows || []).map((row) => String(row.userId)).filter(Boolean))];
};

const NOTIFICATION_KEY = 'oauth_client_approval';
// Not a project notification: the row names this scope where a project id would go, as the AI alerts do.
const NOTIFICATION_SCOPE = 'oauth-clients';

/* Written the way the AI alerts write theirs (company row, global copy with its socket event, bell counter),
 * since the shared notification helper only takes project and task notifications. The client names itself, so
 * its name travels in changeData and the Inbox renders it as text; the message carries no client-supplied text. */
const notifyManagers = async (companyId, approval, requestedBy) => {
    let recipients;
    try {
        recipients = await ownersAndAdmins(companyId);
    } catch (error) {
        logger.error(`oauth: approval request recipients for ${companyId} not read: ${error.message}`);
        return;
    }
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    const { dbCollections } = require('../../Config/collections');
    const now = new Date();
    for (const receiverID of recipients) {
        const row = {
            key: NOTIFICATION_KEY, type: 'oauth', changeType: NOTIFICATION_KEY,
            message: 'An outside agent asks to act for people in this workspace. An owner or admin can approve or deny it in Settings, Agent clients.',
            changeData: { clientId: approval.clientId, clientName: approval.clientName || '', requestedScopes: approval.requestedScopes || [] },
            projectId: NOTIFICATION_SCOPE, taskId: '', userId: String(requestedBy), companyId: String(companyId),
            assigneeUsers: [receiverID], notSeen: [receiverID], receiverID,
            notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', createdAt: now, updatedAt: now,
        };
        try {
            // eslint-disable-next-line no-await-in-loop
            const saved = await MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
            // eslint-disable-next-line no-await-in-loop
            const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && (saved.id || saved._id) } }, 'save');
            require('../../event/socketEventEmitter').emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
            const { updateUnReadCommentsCountFun } = require('../notification-count/controller');
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve(updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [receiverID], readAll: false } }))
                .catch((error) => logger.warn(`oauth: notification count for ${receiverID} not bumped: ${error.message || error}`));
        } catch (error) {
            logger.error(`oauth: approval request notification for ${companyId} to ${receiverID} failed: ${error.message || error}`);
        }
    }
};

const isDuplicate = (error) => error && (error.code === 11000 || /E11000/.test(String(error.message)));

const decidedAgo = (row, now) => now.getTime() - new Date((row.status === STATUS.REVOKED ? row.revokedAt : row.decidedAt) || 0).getTime();

/* A person asks the workspace to let the client in. An approved or already pending client is left as it is, so
 * owners and admins hear about one request once; a denied or revoked one goes back to pending after a day. A
 * person raises at most a set number of new requests a day. `limited` says why nothing was raised. */
async function request({ companyId, client, userId, scopes, actor, now = new Date() }) {
    const existing = await store.approvals.find(companyId, client.clientId);
    if (existing && [STATUS.PENDING, STATUS.APPROVED].includes(existing.status)) return { approval: existing, created: false };
    if (existing && decidedAgo(existing, now) < REQUEST_COOLDOWN_MS) return { approval: existing, created: false, limited: 'cooldown' };
    if (await store.approvals.countRequestedBy(userId, new Date(now.getTime() - DAY_MS)) >= MAX_REQUESTS_PER_PERSON_PER_DAY) {
        return { approval: existing, created: false, limited: 'cap' };
    }
    const fields = { ...describeClient(client), status: STATUS.PENDING, requestedScopes: inScopeOrder(scopes), requestedBy: String(userId), requestedAt: now, updatedAt: now };
    let approval;
    try {
        approval = existing
            ? await store.approvals.transition(companyId, client.clientId, existing.status, fields)
            : await store.approvals.save({ companyId: String(companyId), clientId: client.clientId, scopes: [], privateSprints: false, ...fields });
    } catch (error) {
        if (!isDuplicate(error)) throw error;
        approval = null;
    }
    if (!approval) return { approval: await store.approvals.find(companyId, client.clientId), created: false };
    audit(companyId, actor || { id: userId }, 'oauth.client_approval_requested', approval, { requestedScopes: approval.requestedScopes });
    await notifyManagers(companyId, approval, userId);
    return { approval, created: true };
}

const scopesOf = (value) => {
    if (!Array.isArray(value) || !value.length || !value.every((scope) => config.SCOPES.includes(scope))) {
        throw new ApprovalError(400, `scopes must be a list drawn from: ${config.SCOPES.join(' ')}`);
    }
    return inScopeOrder(value);
};

/* Without scopes named, the ceiling is what was asked for plus reading, or for a pre-registered client, what it
 * was registered with. */
const defaultScopes = (client, existing) => {
    if (client.kind === 'preregistered') return client.scopes && client.scopes.length ? inScopeOrder(client.scopes) : [...config.SCOPES];
    return inScopeOrder([...config.READ_SCOPES, ...((existing && existing.requestedScopes) || [])]);
};

async function approve({ companyId, client, scopes, privateSprints, actor, now = new Date() }) {
    if (client.companyId && String(client.companyId) !== String(companyId)) throw new ApprovalError(400, 'This client is registered to another workspace.');
    if (privateSprints !== undefined && typeof privateSprints !== 'boolean') throw new ApprovalError(400, 'privateSprints must be true or false.');
    const existing = await store.approvals.find(companyId, client.clientId);
    const ceiling = scopes === undefined || scopes === null ? defaultScopes(client, existing) : scopesOf(scopes);
    if (client.scopes && client.scopes.length && !ceiling.every((scope) => client.scopes.includes(scope))) {
        throw new ApprovalError(400, 'A client can only be approved for scopes it registered.');
    }
    const keepOptIn = existing && existing.status === STATUS.APPROVED ? Boolean(existing.privateSprints) : false;
    const fields = {
        ...describeClient(client), status: STATUS.APPROVED, scopes: ceiling,
        privateSprints: privateSprints === undefined ? keepOptIn : privateSprints,
        decidedBy: String(actor.id), decidedAt: now, revokedAt: null, revokedBy: '', updatedAt: now,
    };
    const approval = existing
        ? await store.approvals.transition(companyId, client.clientId, existing.status, fields)
        : await store.approvals.save({ companyId: String(companyId), clientId: client.clientId, requestedScopes: [], ...fields });
    if (!approval) throw new ApprovalError(409, 'The approval changed while you were deciding; reload and try again.');
    await grants.narrowClientGrants(client.clientId, companyId, approval.scopes, now);
    audit(companyId, actor, 'oauth.client_approved', approval);
    return approval;
}

async function deny({ companyId, clientId, actor, now = new Date() }) {
    const existing = await store.approvals.find(companyId, clientId);
    if (!existing) throw new ApprovalError(404, 'No request from this client in this workspace.');
    if (existing.status === STATUS.APPROVED) throw new ApprovalError(409, 'This client is approved; revoke it instead.');
    const approval = await store.approvals.transition(companyId, clientId, existing.status, { status: STATUS.DENIED, decidedBy: String(actor.id), decidedAt: now, updatedAt: now });
    if (!approval) throw new ApprovalError(409, 'The approval changed while you were deciding; reload and try again.');
    audit(companyId, actor, 'oauth.client_approval_denied', approval);
    return approval;
}

/* Every grant the client holds in this workspace goes with the approval, and with it every token issued under
 * them: tokens are checked against their grant on each use, so they stop on the next request. */
async function revoke({ companyId, clientId, actor, now = new Date() }) {
    const approval = await store.approvals.transition(companyId, clientId, STATUS.APPROVED, { status: STATUS.REVOKED, revokedBy: String(actor.id), revokedAt: now, updatedAt: now });
    if (!approval) throw new ApprovalError(404, 'This client is not approved in this workspace.');
    await grants.revokeClientGrants(clientId, now, { companyId, reason: grants.REVOKED.APPROVAL_REVOKED });
    audit(companyId, actor, 'oauth.client_approval_revoked', approval);
    return approval;
}

/* What /mcp and the token endpoint ask on every use: the client counts as approved only while the row says so. */
async function isClientApproved(companyId, clientId) {
    const row = await store.approvals.find(companyId, clientId);
    return Boolean(row) && row.status === STATUS.APPROVED;
}

async function approvedScopes(companyId, clientId) {
    const row = await store.approvals.find(companyId, clientId);
    return row && row.status === STATUS.APPROVED ? [...(row.scopes || [])] : null;
}

const publicView = (row, names = new Map()) => ({
    clientId: row.clientId,
    clientName: row.clientName || '',
    clientKind: row.clientKind || '',
    clientHost: row.clientKind === 'metadata_document' ? hostOf(row.clientId) : '',
    redirectHosts: row.redirectHosts || [],
    status: row.status,
    scopes: row.scopes || [],
    requestedScopes: row.requestedScopes || [],
    privateSprints: Boolean(row.privateSprints),
    requestedBy: row.requestedBy || '',
    requestedByName: names.get(String(row.requestedBy || '')) || '',
    requestedAt: row.requestedAt || null,
    decidedBy: row.decidedBy || '',
    decidedByName: names.get(String(row.decidedBy || '')) || '',
    decidedAt: row.decidedAt || null,
    revokedAt: row.revokedAt || null,
});

module.exports = {
    STATUS, REQUEST_COOLDOWN_MS, MAX_REQUESTS_PER_PERSON_PER_DAY, ApprovalError,
    covers, request, approve, deny, revoke, isClientApproved, approvedScopes, publicView, hostOf, describeClient,
};
