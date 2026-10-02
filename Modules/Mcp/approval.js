const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { isExpired, hasScope } = require('../ApiTokens/helpers/apiTokenRules');
const registry = require('../Agents/registry');
const permissions = require('../Agents/permissions');
const visibility = require('./visibility');
const manageFlag = require('./manageFlag');
const manageTools = require('./manageTools');
const workTools = require('./workTools');
const goalTokens = require('../Goals/goalTokens');
const { ACTION: NEW_PROJECT } = require('../Agents/projectCreate');
const { ACTION: PROJECT_COPY } = require('../Agents/projectDuplicate');

// An approved MCP proposal runs as the token's person, not as the approver, so
// approval re-asks everything the original call was asked and adds the
// approver's own standing: the approver can neither widen the change nor lend
// it rights the token has since lost.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const GATE_OWNER_ADMIN = 'owner_admin';

const refused = (error, status = 403) => ({ error, status });

/* A new project sits in no project yet: like a goal it is the workspace's, which a token kept to some projects is
 * refused. So is a copy of a project, which also needs the project it is copied from to be one that can be opened. */
const targetOf = (params = {}, action = '') => {
    const target = [NEW_PROJECT, PROJECT_COPY].includes(action) ? { ...goalTokens.WRITE_TARGET } : {};
    if (action === PROJECT_COPY) target.projectId = String(params.sourceProjectId || '');
    if (params.taskId) target.taskId = String(params.taskId);
    if (params.relatedTaskId) target.relatedTaskId = String(params.relatedTaskId);
    if (params.projectId) target.projectId = String(params.projectId);
    if (params.projectId && params.sprintId) target.sprintId = String(params.sprintId);
    if (params.listProjectId && params.sprintId) Object.assign(target, { projectId: String(params.listProjectId), sprintId: String(params.sprintId) });
    if (params.pageId) target.pageId = String(params.pageId);
    if (params.goalId) Object.assign(target, goalTokens.WRITE_TARGET);
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

const tokenFiler = async (companyId, p, changes) => {
    const token = await liveToken(companyId, p.tokenId);
    if (!token) return refused('The token that filed this proposal has been revoked, deleted or has expired.');
    if (String(token.userId || '') !== String(p.requestedBy || '')) return refused('The token that filed this proposal belongs to someone else now.');
    if (!hasScope(token, 'write')) return refused('The token that filed this proposal no longer has the write scope.');
    const lacking = changes.map((c) => manageTools.grantOfAction(c.action)).filter(Boolean).some((grant) => !manageFlag.holdsGrant(token, grant));
    if (lacking) return refused('The token that filed this proposal does not hold the grant this change needs.');
    return { tokenLists: [p.tokenProjectIds, token.projectIds].filter((l) => Array.isArray(l) && l.length).map((l) => l.map(String)) };
};

/* An outside client filed it under a person's grant. The grant is asked what a call under it would be asked
 * now, and every change must be one its manage grant still covers: an outside client files nothing else. */
const grantFiler = async (companyId, p, changes) => {
    const held = await require('./oauthAuth').standingOfGrant({ companyId, grantId: p.oauthGrantId, clientId: p.oauthClientId, userId: p.requestedBy });
    if (!held) return refused('The connection that filed this proposal has been revoked, has expired, or its app is no longer approved in this workspace.');
    const covered = changes.every((c) => { const grant = manageTools.grantOfAction(c.action) || workTools.filedUnder(c.action); return Boolean(grant) && held.includes(grant); });
    if (!covered) return refused('The connection that filed this proposal no longer holds the grant this change needs.');
    return { tokenLists: [] };
};

/* null when a person may approve this MCP proposal as filed; otherwise { error, status }. */
const refusalFor = async (companyId, p, { decider, isPrivileged, edited }) => {
    if (Array.isArray(edited) && edited.length) return refused('A proposal from an MCP call is approved or declined as filed; it cannot be edited.', 409);
    const changes = Array.isArray(p.changes) ? p.changes : [];
    const gated = changes.some((c) => { const a = registry.get(c.action); return a && a.gate === GATE_OWNER_ADMIN; });
    if ((gated || p.gate === GATE_OWNER_ADMIN) && !isPrivileged) return refused('This proposal needs an Owner or Admin.');

    const filer = p.oauthGrantId ? await grantFiler(companyId, p, changes) : await tokenFiler(companyId, p, changes);
    if (filer.error) return filer;
    const { tokenLists } = filer;

    for (const c of changes) {
        const target = targetOf(c.params, c.action);
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

module.exports = { refusalFor, targetOf, reachable, liveToken };
