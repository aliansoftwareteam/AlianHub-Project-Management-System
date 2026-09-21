const config = require('../AgentSessions/config');
const scopes = require('./scopes');
const { ACTIVITY_TYPES } = require('../AgentSessions/rules');

const SCOPE = 'tasks:write';

const sessionArgs = (extra = {}) => ({
    type: 'object',
    properties: { sessionId: { type: 'string' }, handle: { type: 'string', description: 'The handle from the announcement; needed on the first call only.' }, ...extra },
    required: ['sessionId'],
});

/* Not registry actions: they write only the session record, never workspace data, and each checks its own caller
 * against the session (Modules/AgentSessions/activity.js). Offered only with EXTERNAL_AGENT_SESSIONS on. */
const TOOLS = [
    {
        name: 'session.activity',
        description: `Report what you are doing on a task delegated to you: one of ${ACTIVITY_TYPES.join(', ')}. The first call must come within ten seconds of the announcement and carry its handle.`,
        input: { ...sessionArgs({ type: { type: 'string', enum: [...ACTIVITY_TYPES] }, text: { type: 'string' } }), required: ['sessionId', 'type', 'text'] },
        visibility: 'filtered',
        run: (ctx, args, vis) => require('../AgentSessions/activity').record(ctx, args, vis),
    },
    {
        name: 'session.complete',
        description: 'Close a delegated session as done, with a one-line summary for the people on the task.',
        input: sessionArgs({ summary: { type: 'string' } }),
        visibility: 'filtered',
        run: (ctx, args, vis) => require('../AgentSessions/activity').complete(ctx, args, vis),
    },
    {
        name: 'session.fail',
        description: 'Close a delegated session as failed, saying why.',
        input: sessionArgs({ reason: { type: 'string' } }),
        visibility: 'filtered',
        run: (ctx, args, vis) => require('../AgentSessions/activity').fail(ctx, args, vis),
    },
];

const SCOPES = Object.freeze(Object.fromEntries(TOOLS.map((tool) => [tool.name, SCOPE])));

const offered = () => (config.isOn() ? TOOLS : []);
const owns = (name) => offered().some((tool) => tool.name === String(name));

const call = async (ctx, name, args = {}) => {
    const tool = TOOLS.find((t) => t.name === String(name));
    const oauth = Boolean(ctx && ctx.token && ctx.token.oauth);
    if (oauth && !scopes.grantedScopes(ctx.token).includes(SCOPE)) throw Object.assign(new Error(`This token lacks the ${SCOPE} scope.`), { code: -32004 });
    return tool.run(ctx, args, await require('./visibility').forCaller(ctx));
};

module.exports = { TOOLS, SCOPES, SCOPE, offered, owns, call };
