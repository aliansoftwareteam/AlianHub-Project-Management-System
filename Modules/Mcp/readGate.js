const registry = require('../Agents/registry');
const actions = require('../Agents/actions');

/* For a read addressed by the id of one thing. A connection kept away from the action is turned back first, with
 * nothing read. The person's rights are asked for the thing itself, once it is found open to them, so the rules of
 * its own project are the ones that decide. */
const turnBackIfKeptAway = async (ctx, action) => {
    const may = registry.evaluate(action, {}, { allowedActions: ctx.allowedActions });
    if (!may.allowed) throw await actions.refusal(ctx.companyId, ctx.actor, { action, params: {}, reason: may.reason, ip: ctx.ip, taint: ctx.taint });
};

const askThePerson = (ctx, action, params) => actions.authorizeRead({
    companyId: ctx.companyId, actor: ctx.actor, action, params, ip: ctx.ip, allowedActions: ctx.allowedActions,
});

module.exports = { turnBackIfKeptAway, askThePerson };
