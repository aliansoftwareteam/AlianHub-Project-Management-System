const registry = require('../Agents/registry');
const actions = require('../Agents/actions');
const permissions = require('../Agents/permissions');

const SOURCE = 'mcp';
const PENDING_MESSAGE = 'This action needs a person\'s approval, so nothing has changed yet. It is waiting in the Inbox as the proposal named here.';

const agentFor = (ctx) => {
    const tokenId = String((ctx.token && ctx.token._id) || '');
    const name = (ctx.actor && ctx.actor.agentName) || 'MCP';
    return { _id: (ctx.actor && ctx.actor.agentId) || `${SOURCE}:${tokenId}`, name: `${name} (MCP)` };
};

/* A destructive call is filed, not run. The same registry and holder checks a
 * direct call faces run first, so a proposal never asks a person to approve
 * something the token could not have done. */
const propose = async (ctx, tool, params, reason) => {
    const refuse = async (why) => { throw await actions.refusal(ctx.companyId, ctx.actor, { action: tool.action, params, reason: why, ip: ctx.ip }); };
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
        why: reason,
        changes: [{ action: tool.action, params, label: `${tool.name} via MCP`, rating: actions.rating(tool.action) }],
        source: SOURCE,
        requestedBy: String(ctx.userId),
        tokenId: String((ctx.token && ctx.token._id) || ''),
        tokenProjectIds: Array.isArray(ctx.projectIds) ? ctx.projectIds : [],
        allowedActions: Array.isArray(ctx.allowedActions) ? ctx.allowedActions : [],
    });
    const id = String(saved._id);
    return { ok: false, pending: true, approval: 'pending', proposalRef: `proposal:${id}`, proposalId: id, message: PENDING_MESSAGE };
};

module.exports = { SOURCE, propose };
