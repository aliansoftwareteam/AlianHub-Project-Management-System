const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isExpired, hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const registry = require('../Agents/registry');
const permissions = require('../Agents/permissions');
const visibility = require('./visibility');

// An approved MCP proposal runs as the token's person, not as the approver, so
// approval re-asks everything the original call was asked and adds the
// approver's own standing: the approver can neither widen the change nor lend
// it rights the token has since lost.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const GATE_OWNER_ADMIN = 'owner_admin';

const refused = (error, status = 403) => ({ error, status });

const targetOf = (params = {}) => {
    const target = {};
    if (params.taskId) target.taskId = String(params.taskId);
    if (params.projectId) target.projectId = String(params.projectId);
    if (params.projectId && params.sprintId) target.sprintId = String(params.sprintId);
    return target;
};

const reachable = async (companyId, who, target) => {
    try {
        await visibility.assertWritable(companyId, await visibility.forCaller({ companyId, ...who }), target);
        return true;
    } catch (error) {
        if (!error.notVisible) throw error;
        return false;
    }
};

const liveToken = async (companyId, tokenId) => {
    if (!OBJECT_ID.test(String(tokenId || ''))) return null;
    const token = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.API_TOKENS, data: [{ _id: new mongoose.Types.ObjectId(String(tokenId)), active: true }],
    }, 'findOne');
    return token && !isExpired(token) ? token : null;
};

/* null when a person may approve this MCP proposal as filed; otherwise { error, status }. */
const refusalFor = async (companyId, p, { decider, isPrivileged, edited }) => {
    if (Array.isArray(edited) && edited.length) return refused('A proposal from an MCP call is approved or declined as filed; it cannot be edited.', 409);
    const changes = Array.isArray(p.changes) ? p.changes : [];
    const gated = changes.some((c) => { const a = registry.get(c.action); return a && a.gate === GATE_OWNER_ADMIN; });
    if ((gated || p.gate === GATE_OWNER_ADMIN) && !isPrivileged) return refused('This proposal needs an Owner or Admin.');

    const token = await liveToken(companyId, p.tokenId);
    if (!token) return refused('The token that filed this proposal has been revoked, deleted or has expired.');
    if (String(token.userId || '') !== String(p.requestedBy || '')) return refused('The token that filed this proposal belongs to someone else now.');
    if (!hasScope(token, 'write')) return refused('The token that filed this proposal no longer has the write scope.');
    const tokenLists = [p.tokenProjectIds, token.projectIds].filter((l) => Array.isArray(l) && l.length).map((l) => l.map(String));

    for (const c of changes) {
        const target = targetOf(c.params);
        // eslint-disable-next-line no-await-in-loop
        const own = await permissions.holderMay(companyId, { kind: 'human', userId: decider.userId }, c.action, c.params || {});
        if (!own.allowed) return refused(`The approver may not make this change: ${own.reason}`);
        // eslint-disable-next-line no-await-in-loop
        if (!(await reachable(companyId, { userId: decider.userId, projectIds: [] }, target))) return refused('The approver cannot open what this change touches.');
        // eslint-disable-next-line no-await-in-loop
        if (!(await reachable(companyId, { userId: p.requestedBy, projectIds: [] }, target))) return refused('The person behind the token (the requester) can no longer open what this change touches.');
        for (const list of tokenLists) {
            // eslint-disable-next-line no-await-in-loop
            if (!(await reachable(companyId, { userId: p.requestedBy, projectIds: list }, target))) return refused('What this change touches is outside the token\'s project list.');
        }
    }
    return null;
};

module.exports = { refusalFor, targetOf };
