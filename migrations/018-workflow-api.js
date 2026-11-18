/* Task 028 sprint 5 step 3 gives a workflow run the agent, task and project it
 * works on, and gives a step run the operator fields (skippedBy, control,
 * compensation). The fields are optional and absent reads as "nobody has touched
 * this step", which is what every row written so far is, so none of them needs a
 * backfill.
 *
 * The two indexes the API lists by — by source and by agent — do need building,
 * and neither collection is necessarily empty by now, so this is createIndexes
 * rather than syncIndexes, as 017 was: it adds the new indexes without dropping
 * one a running deployment is already using.
 */

module.exports = {
    id: '018-workflow-api',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            for (const type of [ctx.SCHEMA_TYPE.WORKFLOW_RUNS, ctx.SCHEMA_TYPE.WORKFLOW_STEP_RUNS]) {
                // eslint-disable-next-line no-await-in-loop
                await ctx.company(companyId, { type, data: [] }, 'createIndexes');
            }
            ctx.logger.info(`[migrations] 018 ${companyId}: workflow run list indexes ensured`);
            return { indexes: true };
        });
    },
};
