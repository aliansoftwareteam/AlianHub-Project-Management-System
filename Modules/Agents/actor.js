const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { myCache } = require('../../Config/config');

// Who is calling. Two kinds only:
//   human — a web session (JWT) or a plain personal token used by a script
//   agent — a token minted for a coding agent, a workspace agent run, or any MCP call
// The distinction decides whether the registry applies. It is derived from what
// authenticated the request, never from a header the caller can set.

const ACTOR_HUMAN = 'human';
const ACTOR_AGENT = 'agent';
const VIA = Object.freeze(['workspace', 'personal', 'local']);
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const isAgentToken = (tokenDoc) => Boolean(tokenDoc && (
    tokenDoc.kind === ACTOR_AGENT ||
    tokenDoc.agentId ||
    (tokenDoc.agentAccount && tokenDoc.agentAccount.mode)
));

const viaFromMode = (mode) => (VIA.includes(mode) ? mode : null);

const userAgentAccount = async (userId) => {
    if (!OBJECT_ID.test(String(userId || ''))) return null;
    const key = `agentAccount:${userId}`;
    const cached = myCache.get(key);
    if (cached !== undefined) return cached;
    let account = null;
    try {
        const user = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.USERS,
            data: [{ _id: new mongoose.Types.ObjectId(String(userId)) }, 'agentAccount Employee_Name'],
        }, 'findOne');
        account = user ? { ...(user.agentAccount || {}), name: user.Employee_Name || '' } : null;
    } catch (e) { account = null; }
    myCache.set(key, account, 60);
    return account;
};

const invalidateAgentAccountCache = (userId) => myCache.del(`agentAccount:${userId}`);

/* Build the actor for a request. `req.agentRun` (set by the run engine) and
 * `req.mcp` (set by the MCP server) both mark the caller as an agent. */
const resolveActor = async (req) => {
    const token = req.apiToken || null;
    const userId = String(req.uid || (req.body && req.body.userData && (req.body.userData.id || req.body.userData._id)) || '');
    const base = { userId, tokenId: token ? String(token._id) : null, tokenName: token ? token.name : null, runId: null, agentId: null, agentName: null };

    if (req.agentRun) {
        return {
            ...base, kind: ACTOR_AGENT, runId: String(req.agentRun._id || req.agentRun.runId || ''),
            agentId: String(req.agentRun.agentId || ''), agentName: req.agentRun.agentName || 'Agent',
            viaAccount: viaFromMode(req.agentRun.viaAccount) || 'workspace',
        };
    }
    if (token && (isAgentToken(token) || req.mcp)) {
        const account = await userAgentAccount(userId);
        const plainTokenViaMcp = !isAgentToken(token);
        return {
            ...base, kind: ACTOR_AGENT,
            agentId: token.agentId ? String(token.agentId) : null,
            agentName: token.name || (account && account.label) || (plainTokenViaMcp ? 'MCP' : 'CLI agent'),
            viaAccount: viaFromMode(token.agentAccount && token.agentAccount.mode) || viaFromMode(account && account.mode) || 'personal',
            provider: (token.agentAccount && token.agentAccount.provider) || (account && account.provider) || null,
            personName: (account && account.name) || '',
            projectIds: Array.isArray(token.projectIds) ? token.projectIds.map(String) : [],
            runId: req.headers && req.headers['x-agent-run'] && OBJECT_ID.test(String(req.headers['x-agent-run'])) ? String(req.headers['x-agent-run']) : null,
        };
    }
    return { ...base, kind: ACTOR_HUMAN, viaAccount: 'workspace' };
};

const isAgent = (actor) => Boolean(actor && actor.kind === ACTOR_AGENT);

/* How attribution reads everywhere (27c): person, tool, account type. */
const attribution = (actor) => {
    if (!isAgent(actor)) return { actorId: actor.userId, actorType: ACTOR_HUMAN, label: actor.personName || '' };
    if (actor.viaAccount === 'personal') {
        return { actorId: actor.userId, actorType: ACTOR_AGENT, agentId: actor.agentId, viaAccount: 'personal',
                 label: `${actor.personName || 'Member'} via ${actor.provider || actor.agentName || 'personal agent'}` };
    }
    return { actorId: actor.agentId || actor.userId, actorType: ACTOR_AGENT, agentId: actor.agentId, viaAccount: actor.viaAccount,
             label: actor.agentName || 'Agent' };
};

module.exports = { ACTOR_HUMAN, ACTOR_AGENT, VIA, isAgentToken, resolveActor, isAgent, attribution, userAgentAccount, invalidateAgentAccountCache };
