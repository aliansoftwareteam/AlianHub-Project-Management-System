const taint = require('../Agents/taint');

/* The owner's rule (2026-09-21): an outside agent counts as tainted, so under AGENT_TAINT_ROUTING its
 * risky writes wait for a person, as a tainted run's do in policy.decide. Answers the reason to hold
 * the call, or '' to let it through to actions.perform. */
const heldForApproval = (ctx, action) => {
    if (!ctx || !ctx.oauth || !taint.routes(ctx.taint)) return '';
    const { rating } = require('../Agents/actions');
    const { escalations } = require('../Agents/policy');
    const rated = rating(action);
    const risky = rated ? escalations(rated) : ['has no risk rating'];
    if (!risky.length) return '';
    return `${action} ${risky.join(', ')}; it came from an outside client (${ctx.oauth.clientId}), so it needs a person's approval`;
};

const WAITS = 'From this app it waits for a person\'s approval in AlianHub, and changes nothing until then.';

/* A tool as an outside client is told of it: a write that waits for it does not say it is made at once. */
const describedFor = (ctx, tool) => {
    if (tool.run || !heldForApproval(ctx, tool.action)) return tool;
    return { ...tool, description: `${String(tool.description).replace(/,? at once(?=[.,;])/g, '')} ${WAITS}` };
};

module.exports = { heldForApproval, describedFor, WAITS };
