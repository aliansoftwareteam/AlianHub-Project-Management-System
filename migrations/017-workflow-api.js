/* Task 028 sprint 5 step 3 gives a workflow run the agent, task and project it
 * works on, and gives a step run the operator fields (skippedBy, control,
 * compensation). The two list indexes the API reads by — by source and by agent —
 * are new, so the collections need their indexes rebuilt before the first list.
 *
 * syncIndexes, as 016 did: both collections are the engine's own, so the schema
 * is the whole truth about their indexes. The new fields are optional and no
 * existing row has to be rewritten to carry them. */

const COLLECTIONS = (ctx) => [ctx.SCHEMA_TYPE.WORKFLOW_RUNS, ctx.SCHEMA_TYPE.WORKFLOW_STEP_RUNS];

module.exports = {
    id: '017-workflow-api',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const synced = {};
            for (const type of COLLECTIONS(ctx)) {
                // eslint-disable-next-line no-await-in-loop
                synced[type] = (await ctx.company(companyId, { type, data: [] }, 'syncIndexes')) || [];
            }
            ctx.logger.info(`[migrations] 017 ${companyId}: ${JSON.stringify(synced)}`);
            return { synced };
        });
    },
};
