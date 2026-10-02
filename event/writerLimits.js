const tokenNarrowing = require('../Config/tokenNarrowing');
const agentRequest = require('../Config/agentRequest');
const actingAgent = require('../Modules/Agents/actingAgent');

/* A change made with a token held to some projects says so in its event, beside who made it and how deep in a chain
 * it is: { userId, projectIds, chat }, where chat is whether that token was given chat (null when it is no agent's).
 * Work that follows the change reads the limits from the event, never from whatever request it happens to run in. */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const ofThisRequest = () => {
    const held = tokenNarrowing.current();
    if (!held) return null;
    const agent = agentRequest.agentOf(held.uid);
    return { userId: held.uid, projectIds: [...held.projectIds], chat: agent ? agent.chat : null };
};

const read = (limits) => (limits && OBJECT_ID.test(String(limits.userId || '')) && tokenNarrowing.isNarrowed(limits) ? limits : null);

const underNoRequest = (step) => tokenNarrowing.outside(() => agentRequest.outside(() => actingAgent.outside(step)));

const underTheWritersLimits = (limits, step) => underNoRequest(() => tokenNarrowing.runNarrowed({ userId: limits.userId, projectIds: limits.projectIds },
    () => (typeof limits.chat === 'boolean' ? agentRequest.runForAgentOf(limits.userId, { chat: limits.chat }, step) : step())));

/* A choice left to the owner. A rule's step that is judged for the rule's maker is judged with the maker's rights;
 * where the change that woke the rule came from the maker's own token held to some projects, it is also held to
 * that token's projects and chat rule, as it was while the step ran inside the request. To judge it with the
 * maker's own rights whoever made the change, answer underNoRequest(step) for every envelope. */
const judgedAfter = (envelope, step) => {
    const limits = read(envelope && envelope.narrowing);
    return limits ? underTheWritersLimits(limits, step) : underNoRequest(step);
};

module.exports = { ofThisRequest, judgedAfter };
