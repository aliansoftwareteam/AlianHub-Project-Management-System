const agentConnectors = require('../Modules/Agents/agentConnectors');

/* An agent now uses only the connected apps and tools ticked on it (task 098), and one saved before that has none
 * ticked. This ticks, for every agent without the field, the connector tools its skills already read or propose,
 * so no working agent stops. A skill is resolved as a run resolves it: the workspace's live copy first, the built-in
 * one second. Only a row still without the field is written, so a second run, or an agent saved meanwhile, is left
 * as it is. No verify(): an agent made by a path that sets no field is read as nothing ticked, which is the rule. */

const ID = '083-agent-connector-ticks';

const keyOf = (skill) => (skill && typeof skill === 'object' ? skill.key || skill.slug || skill.name : skill);
const skillKeysOf = (agent) => [...new Set((Array.isArray(agent.skills) ? agent.skills : []).map(keyOf).filter(Boolean).map(String))];

const builtInOf = (key) => {
    const { SEEDS } = require('../Modules/Agents/skills/seeds');
    return Object.values(SEEDS).find((seed) => seed.key === key) || require('../Modules/Agents/skills').BY_SLUG.get(key) || null;
};

const skillsByKey = async (ctx, companyId, keys) => {
    const stored = keys.length
        ? await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENT_SKILLS, data: [{ key: { $in: keys.map((key) => key.toLowerCase()) } }] }, 'find')
        : [];
    const live = new Map((stored || []).filter((doc) => doc.enabled !== false && !doc.retiredAt).map((doc) => [String(doc.key), doc]));
    return new Map(keys.map((key) => [key, live.get(key.toLowerCase()) || builtInOf(key)]));
};

async function tickCompany(ctx, companyId) {
    const agents = (await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENTS, data: [{ connectors: { $exists: false } }, { skills: 1 }] }, 'find')) || [];
    if (!agents.length) return { agents: 0, ticked: 0 };
    const skills = await skillsByKey(ctx, companyId, [...new Set(agents.flatMap(skillKeysOf))]);
    let ticked = 0;
    for (const agent of agents) {
        const connectors = agentConnectors.ticksForSkills(skillKeysOf(agent).map((key) => skills.get(key)).filter(Boolean));
        // eslint-disable-next-line no-await-in-loop
        await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id, connectors: { $exists: false } }, { $set: { connectors } }] }, 'updateOne');
        if (connectors.length) ticked += 1;
    }
    return { agents: agents.length, ticked };
}

module.exports = {
    id: ID,
    scope: 'company',
    tickCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const done = await tickCompany(ctx, companyId);
            if (done.agents) ctx.logger.info(`[migrations] 083 ${companyId}: ${done.agents} agents given connector ticks, ${done.ticked} with at least one`);
            return done;
        });
    },
};
