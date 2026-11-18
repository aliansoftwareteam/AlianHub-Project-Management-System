const dashboards = require('../Agents/dashboardRequests');
const { GRANT } = require('./manageFlag');
const { WRITE_TARGET } = require('../Goals/goalTokens');

// One card on a dashboard. A call never adds it: it is filed for the person the agent works for, who owns the
// dashboard, to approve in AlianHub (the action is proposeOnly, Agents/registry/dashboards.js), and what is approved
// runs the dashboard editor's own routes as that person (Modules/Agents/dashboardRequests.js).

const REASON_MAX = 500;
const ID = Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{24}$' });
const input = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const withPeriod = Object.keys(dashboards.CARDS).filter((card) => dashboards.CARDS[card].period !== null);

/* Answered at once where the person could not add the card by hand, so nobody is asked to approve what cannot be
 * made. A token kept to some projects is left to the target check, which refuses it, and is told nothing of a dashboard. */
const cardToFile = async (ctx, args, vis) => {
    if (!vis.allowsPage({ visibility: 'project' })) return { args };
    const draft = dashboards.draftOf(args);
    const stopped = await dashboards.refusalFor(ctx.companyId, ctx.userId, draft);
    return stopped ? { answer: { ok: false, error: stopped } } : { args };
};

const TOOLS = [
    {
        name: dashboards.ACTION,
        action: dashboards.ACTION,
        visibility: 'filtered',
        strict: true,
        filedUnder: GRANT,
        target: () => WRITE_TARGET,
        description: `Asks for one card on a dashboard: ${Object.keys(dashboards.CARDS).join(', ')}. `
            + 'Give dashboardId (a dashboard the person owns) or newDashboard (the name of a new dashboard that will be private to them). '
            + `A card that covers a span of time (${withPeriod.join(', ')}) takes a period: ${Object.keys(dashboards.PERIODS).join(', ')}. If left out, it uses the span the dashboard editor gives it. `
            + 'A card shows each viewer only the work they may see. A card that needs a project, a list or a question first (burndown, velocity, ask a question) has to be added in AlianHub, and so does sharing a dashboard. '
            + 'Nothing is made by this call: it answers that the card is waiting, and the person approves it in AlianHub, where they see the dashboard and the card by name. Only they can approve it, and they can undo it afterwards. '
            + 'A connection limited to some projects cannot use this.',
        input: input({
            dashboardId: { ...ID, description: 'A dashboard the person owns. Use newDashboard instead for a new one.' },
            newDashboard: { type: 'string', minLength: 1, maxLength: dashboards.NAME_MAX, description: 'The name of a new, private dashboard to create with the card on it' },
            card: { type: 'string', enum: Object.keys(dashboards.CARDS) },
            period: { type: 'string', enum: Object.keys(dashboards.PERIODS) },
            reason: { type: 'string', maxLength: REASON_MAX, description: 'Why, in one line. It is kept in the record of changes.' },
        }, ['card']),
        check: (args) => dashboards.problemIn(args),
        prepare: cardToFile,
        params: (args) => dashboards.draftOf(args),
    },
];

module.exports = { TOOLS };
