/* Task 028 sprint 5 step 2 adds the step types, and with them one collection —
 * workflow_approvals — and two shapes on an existing one.
 *
 * workflow_approvals is empty everywhere, so syncIndexes builds it from the
 * schema; its unique index on { runId, stepId } is what makes a re-ticked
 * approval step open the same request instead of a second one.
 *
 * workflow_step_runs gains the waiting fields, the fan-out parent link and the
 * loop counters. None of them needs a backfill — absent reads as "not waiting,
 * not a child, not in a loop", which is what every row written so far is — but
 * the new { runId, parentStepId } index does need building, and the collection
 * is not necessarily empty, so it gets createIndexes rather than syncIndexes:
 * adding the one index without dropping anything a running deployment is using.
 */

module.exports = {
    id: '017-workflow-step-types',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const approvals = (await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.WORKFLOW_APPROVALS, data: [] }, 'syncIndexes')) || [];
            await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.WORKFLOW_STEP_RUNS, data: [] }, 'createIndexes');
            ctx.logger.info(`[migrations] 017 ${companyId}: workflow_approvals ${JSON.stringify(approvals)}, workflow_step_runs parent index ensured`);
            return { approvals, stepIndex: true };
        });
    },
};
