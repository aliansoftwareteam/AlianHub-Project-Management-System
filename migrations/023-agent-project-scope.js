const { REVIEW_LEVEL } = require('../Modules/Agents/policy');

/* An agent whose projectIds was empty used to write to every project: the scope
 * check only ran when the list had entries. policy.decide now refuses a write
 * from an agent with no scope, so a stored empty list no longer means what it
 * did, and an agent that acts on its own would stop acting.
 *
 * From L2 up an agent applies changes without asking, so those are given the
 * scope they were already exercising — every live project — as an explicit list
 * an owner can see and narrow. Below L2 nothing is written: those agents propose
 * every change to a person, who approves it per project, and an empty list still
 * reads. */

const ID = '023-agent-project-scope';

async function scopeCompany(ctx, companyId) {
    const agents = await ctx.company(companyId, {
        type: ctx.SCHEMA_TYPE.AGENTS,
        data: [{ deletedStatusKey: { $ne: 1 }, autonomy: { $gte: REVIEW_LEVEL } }, { _id: 1, projectIds: 1 }],
    }, 'find') || [];
    const unscoped = agents.filter((a) => !Array.isArray(a.projectIds) || !a.projectIds.length);
    if (!unscoped.length) return { acting: agents.length, scoped: 0, projects: 0 };

    const projects = await ctx.company(companyId, {
        type: ctx.SCHEMA_TYPE.PROJECTS,
        data: [{ deletedStatusKey: { $ne: 1 } }, { _id: 1 }],
    }, 'find') || [];
    const projectIds = projects.map((p) => String(p._id));

    let scoped = 0;
    for (const agent of unscoped) {
        await ctx.company(companyId, {
            type: ctx.SCHEMA_TYPE.AGENTS,
            data: [{ _id: agent._id }, { $set: { projectIds } }],
        }, 'updateOne');
        scoped += 1;
    }
    return { acting: agents.length, scoped, projects: projectIds.length };
}

module.exports = {
    id: ID,
    scope: 'company',
    scopeCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await scopeCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 023 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
