const { AsyncLocalStorage } = require('async_hooks');
const tokenNarrowing = require('../Config/tokenNarrowing');
const agentRequest = require('../Config/agentRequest');
const actingAgent = require('../Modules/Agents/actingAgent');

/* A change made with a token held to some projects says so in its event, beside who made it and how deep in a chain
 * it is: { userId, projectIds, chat }, where chat is whether that token was given chat (null when it is no agent's).
 * Work that follows the change reads the limits from the event, never from whatever request it happens to run in. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* An MCP connection does not run inside the narrowed-request stores: its own tools hold it to its projects. What it
 * is held to is entered here for the length of one tool call, from the connection's verified grant, so the events
 * of that call can say so. Nothing reads it to decide what the call itself may open. */
const heldCall = new AsyncLocalStorage();

const readable = (limits) => Boolean(limits) && OBJECT_ID.test(String(limits.userId || '')) && tokenNarrowing.isNarrowed(limits)
    && limits.projectIds.every((id) => OBJECT_ID.test(String(id)));

const duringCall = (limits, call) => (readable(limits)
    ? heldCall.run({ userId: String(limits.userId), projectIds: limits.projectIds.map(String), chat: limits.chat === true }, call)
    : call());

const ofNarrowedRequest = () => {
    const held = tokenNarrowing.current();
    if (!held) return null;
    const agent = agentRequest.agentOf(held.uid);
    return { userId: held.uid, projectIds: [...held.projectIds], chat: agent ? agent.chat : null };
};

const ofThisRequest = () => ofNarrowedRequest() || heldCall.getStore() || null;

/* An event of a change made here and now reads the limits here; one that follows an earlier change (a listener
 * publishing on, a field filled again, an assignment a rule makes) is handed the limits of that change. */
const handedOrHere = (narrowing) => (narrowing === undefined ? ofThisRequest() : narrowing);

const underNoRequest = (step) => tokenNarrowing.outside(() => agentRequest.outside(() => actingAgent.outside(() => heldCall.exit(step))));

const underTheWritersLimits = (limits, step) => underNoRequest(() => tokenNarrowing.runNarrowed({ userId: limits.userId, projectIds: limits.projectIds },
    () => (typeof limits.chat === 'boolean' ? agentRequest.runForAgentOf(limits.userId, { chat: limits.chat }, step) : step())));

const UNREADABLE = 'The change this follows names limits that cannot be read, so nothing was done.';

/* A choice left to the owner. A rule's step that is judged for the rule's maker is judged with the maker's rights;
 * where the change that woke the rule came from the maker's own token held to some projects, it is also held to
 * that token's projects and chat rule. To judge it with the maker's own rights whoever made the change, answer
 * underNoRequest(step) for every envelope. Limits that are named but cannot be read stop the step. */
const judgedAfter = (envelope, step) => {
    const limits = envelope ? envelope.narrowing : null;
    if (limits === undefined || limits === null) return underNoRequest(step);
    if (!readable(limits)) return Promise.reject(Object.assign(new Error(UNREADABLE), { deterministic: true }));
    return underTheWritersLimits(limits, step);
};

module.exports = { ofThisRequest, handedOrHere, duringCall, judgedAfter, underNoRequest };
