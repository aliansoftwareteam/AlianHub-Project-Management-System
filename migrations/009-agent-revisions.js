const revisions = require('../Modules/Agents/revisions');

/* Every agent gets revision 1 (live) written from its current record, so a run
 * started after this can pin a number and a settings save has a revision to
 * supersede. Agents that already carry a revision are left alone. */

module.exports = {
    id: '009-agent-revisions',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const agents = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }] }, 'find') || [];
            const counts = { agents: agents.length, created: 0, skipped: 0 };
            for (const agent of agents) {
                const existing = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENT_REVISIONS, data: [{ agentId: String(agent._id) }] }, 'countDocuments');
                if (Number(existing) > 0) { counts.skipped += 1; continue; }
                const snapshot = revisions.snapshotOf(agent);
                await ctx.company(companyId, {
                    type: ctx.SCHEMA_TYPE.AGENT_REVISIONS,
                    data: {
                        agentId: String(agent._id), n: 1, state: revisions.STATE.LIVE, snapshot,
                        serves: revisions.skillKeysOf(snapshot), skillRefs: revisions.skillRefsOf(snapshot),
                        source: revisions.SOURCE.MIGRATION, createdBy: agent.ownerId ? String(agent.ownerId) : null, promotedAt: new Date(), promotedBy: null,
                    },
                }, 'save');
                counts.created += 1;
            }
            ctx.logger.info(`[migrations] 009 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
