/* Task 028 sprint 5 step 1 adds two collections — workflow_runs and
 * workflow_step_runs — and one index on an existing one.
 *
 * The new collections need their indexes before the first write, because the
 * unique index on { runId, stepId } is what stops a step existing twice and the
 * unique dedupe key is what stops a redelivered trigger starting a second run.
 * audit_logs gains the unique partial index on meta.idempotencyKey that makes an
 * action-level key mean something.
 *
 * The two new collections are empty, so syncIndexes builds them from the schema.
 * audit_logs is not: it gets createIndexes, which adds the new one and drops
 * nothing, because syncIndexes there would remove any index some other tenant's
 * history has that the schema does not name. The new audit index is unique over
 * a field no existing row carries, so it cannot collide with data already
 * written. */

const NEW_COLLECTIONS = (ctx) => [ctx.SCHEMA_TYPE.WORKFLOW_RUNS, ctx.SCHEMA_TYPE.WORKFLOW_STEP_RUNS];

module.exports = {
    id: '015-workflow-runs',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const synced = {};
            for (const type of NEW_COLLECTIONS(ctx)) {
                // eslint-disable-next-line no-await-in-loop
                synced[type] = (await ctx.company(companyId, { type, data: [] }, 'syncIndexes')) || [];
            }
            await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AUDIT_LOGS, data: [] }, 'createIndexes');
            ctx.logger.info(`[migrations] 015 ${companyId}: ${JSON.stringify(synced)}, audit idempotency index ensured`);
            return { synced, auditIndex: true };
        });
    },
};
