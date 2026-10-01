const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const permissions = require('../Agents/permissions');
const manageFlag = require('./manageFlag');

const SOURCE = 'mcp';
const PENDING_MESSAGE = 'This action needs a person\'s approval, so nothing has changed yet. It is waiting in the Inbox as the proposal named here.';

const agentFor = (ctx) => {
    const name = (ctx.actor && ctx.actor.agentName) || 'MCP';
    const filer = ctx.oauth ? `oauth:${ctx.oauth.clientId}` : `${SOURCE}:${String((ctx.token && ctx.token._id) || '')}`;
    return { _id: (ctx.actor && ctx.actor.agentId) || filer, name: `${name} (MCP)` };
};

/* Who filed it, so approval can ask again whether they still may: a personal token by its id, an outside
 * client by its grant. */
const filedBy = (ctx) => (ctx.oauth
    ? { tokenId: '', oauthClientId: String(ctx.oauth.clientId), oauthGrantId: String(ctx.oauth.grantId), tokenProjectIds: [] }
    : { tokenId: String((ctx.token && ctx.token._id) || ''), tokenProjectIds: Array.isArray(ctx.projectIds) ? ctx.projectIds : [] });

/* An outside client files a proposal only where approval can ask its grant again: a tool that needs a manage
 * grant the caller holds, for an action that grant alone reaches. */
const outsideMayFile = (ctx, tool) => {
    const { grantOfAction } = require('./manageTools');
    return Boolean(tool.grant) && grantOfAction(tool.action) === tool.grant && manageFlag.mayUse(ctx, tool.grant);
};

/* A destructive call is filed, not run. The same registry and holder checks a
 * direct call faces run first, so a proposal never asks a person to approve
 * something the token could not have done. `held` is why an outside client's call waits for a person. */
const propose = async (ctx, tool, params, reason, held = '') => {
    const refuse = async (why) => { throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: why, ip: ctx.ip, taint: ctx.taint }); };
    if (ctx.token && ctx.token.oauth && !outsideMayFile(ctx, tool)) {
        await refuse(`${tool.name} needs a person's approval, which is filed only for a personal access token, or for an outside client that holds the manage grant the tool needs.`);
    }
    const check = registry.evaluate(tool.action, { ...params, __proposal: true }, { allowedActions: ctx.allowedActions });
    if (!check.allowed) await refuse(check.reason);
    const holder = await permissions.holderMay(ctx.companyId, ctx.actor, tool.action, params);
    if (!holder.allowed) await refuse(holder.reason);

    // Loaded on first use: it pulls in the agent engine, which listing tools never needs.
    const proposals = require('../Agents/proposals');
    const saved = await proposals.create(ctx.companyId, {
        agent: agentFor(ctx),
        taskId: params.taskId || null,
        projectId: params.projectId || null,
        what: `${tool.name}: ${tool.description}`.slice(0, 300),
        why: held ? `${reason} (${held})` : reason,
        changes: [{ action: tool.action, params, label: `${tool.name} via MCP`, rating: actions.rating(tool.action) }],
        source: SOURCE,
        requestedBy: String(ctx.userId),
        ...filedBy(ctx),
        allowedActions: Array.isArray(ctx.allowedActions) ? ctx.allowedActions : [],
    });
    const id = String(saved._id);
    return { ok: false, pending: true, approval: 'pending', proposalRef: `proposal:${id}`, proposalId: id, message: PENDING_MESSAGE };
};

module.exports = { SOURCE, propose, outsideMayFile };
