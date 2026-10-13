/* Task 028 sprint 5, the workflow builder. A workflow somebody composed and
 * saved is a row of its own — `workflow_definitions` — separate from the runs
 * that execute it, so editing a workflow cannot change a run already under way.
 *
 * The collection is new and therefore empty, so syncIndexes builds it from the
 * schema. Nothing existing is touched. */

module.exports = {
    id: '020-workflow-definitions',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const type = ctx.SCHEMA_TYPE.WORKFLOW_DEFINITIONS;
            const synced = (await ctx.company(companyId, { type, data: [] }, 'syncIndexes')) || [];
            ctx.logger.info(`[migrations] 020 ${companyId}: ${JSON.stringify(synced)}`);
            return { synced };
        });
    },
};
