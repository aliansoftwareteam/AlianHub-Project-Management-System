const { AsyncLocalStorage } = require('async_hooks');

/* A change an agent makes through the web app's own handlers runs inside its mark. Those handlers know only
 * the person, write their history after they answer and emit their events from several places, so the mark
 * travels with the call instead of through every handler. Kept free of dependencies so the history writers
 * and the event bus can require it. A mark is { userId, agentId, agentName, depth }. */

const ACTOR_AGENT = 'agent';
const VIA_EXTERNAL = 'external';
const VIA_PERSONAL = 'personal';
const AGENT_NAME_MAX = 60;
const storage = new AsyncLocalStorage();

const runAs = (mark, fn) => (mark ? storage.run(mark, fn) : fn());
const current = () => storage.getStore() || null;

/* What the mark starts must not inherit it: a rule the event wakes is not the agent. */
const outside = (fn) => storage.exit(fn);

/* The tool's own name. `attribution` (./actor) words the audit log with it; `shownAs` words what people read. */
const toolNameOf = (actor) => {
    if (actor.viaAccount === VIA_EXTERNAL) return actor.agentName || 'Outside client';
    if (actor.viaAccount === VIA_PERSONAL) return actor.provider || actor.agentName || 'personal agent';
    return actor.agentName || 'Agent';
};

const actsForAPerson = (actor) => actor.viaAccount === VIA_EXTERNAL || actor.viaAccount === VIA_PERSONAL;

/* The one wording for an agent's change wherever people read it: "Claude, for Priya". */
const byline = (agentName, personName) => (personName ? `${agentName}, for ${personName}` : String(agentName));

const shownAs = (actor) => byline(toolNameOf(actor), actor.personName || (actsForAPerson(actor) ? 'Member' : ''));

/* The mark of a change `actor` makes for the person `userId`, one hop below the event at `depth` it answers. */
const markOf = (actor, userId, depth = 0) => ({
    userId: String(userId || ''),
    agentId: String(actor.agentId || actor.clientId || '') || null,
    agentName: String(toolNameOf(actor)).slice(0, AGENT_NAME_MAX),
    depth: Math.max(0, Number(depth) || 0),
});

const historyFields = () => {
    const mark = current();
    return mark ? { actorType: ACTOR_AGENT, agentName: String(mark.agentName || ''), actedFor: String(mark.userId || '') } : {};
};

module.exports = { runAs, current, outside, markOf, toolNameOf, byline, shownAs, historyFields, VIA_EXTERNAL, VIA_PERSONAL };
