/* Builds in every tenant the outside agent session indexes before the first delegation: the task index the strip
 * reads by, the state index the restart sweep reads by, and the unique client key that keeps one delivery URL per
 * client per workspace, which the endpoint upsert relies on. createIndexes, not syncIndexes, which would drop any
 * index the schema does not declare. */

const ID = '042-agent-sessions';

async function indexCompany(ctx, companyId) {
    const { AGENT_SESSIONS: sessions, AGENT_SESSION_ENDPOINTS: endpoints } = ctx.SCHEMA_TYPE;
    await ctx.company(companyId, { type: sessions, data: [] }, 'createIndexes');
    await ctx.company(companyId, { type: endpoints, data: [] }, 'createIndexes');
    const sessionIndexes = await ctx.company(companyId, { type: sessions, data: [] }, 'listIndexes') || [];
    const endpointIndexes = await ctx.company(companyId, { type: endpoints, data: [] }, 'listIndexes') || [];
    const byState = sessionIndexes.find((index) => index && index.key && index.key.state === 1);
    if (!byState) throw new Error('agent_sessions state index missing after createIndexes');
    const byClient = endpointIndexes.find((index) => index && index.unique && index.key && index.key.clientId === 1);
    if (!byClient) throw new Error('agent_session_endpoints unique client index missing after createIndexes');
    return { stateIndex: byState.name, clientIndex: byClient.name };
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const names = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 042 ${companyId}: ${JSON.stringify(names)}`);
            return names;
        });
    },
};
