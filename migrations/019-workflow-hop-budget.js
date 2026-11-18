/* Task 028 sprint 5 step 4 gives a workflow run the deadline, the budget and the
 * re-entry depth the whole chain spends down, and gives a step run what its own
 * hop was granted out of that.
 *
 * Only `spentUsd` needs a value rather than an absence: every other new field
 * reads correctly when missing — no deadline, no budget, depth zero, nothing
 * blocked — but a run whose `spentUsd` is absent would have `budgetUsd - spentUsd`
 * come out as the whole budget on one worker and NaN on another, and the $inc
 * that records a step's cost needs a number to add to. So existing rows are set
 * to 0, which is the truth for them: none of them was ever billed against a
 * budget, because until now there was none.
 *
 * No index changes, so neither collection is touched by createIndexes here.
 */

module.exports = {
    id: '019-workflow-hop-budget',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const result = await ctx.company(companyId, {
                type: ctx.SCHEMA_TYPE.WORKFLOW_RUNS,
                data: [{ spentUsd: { $exists: false } }, { $set: { spentUsd: 0, depth: 0 } }],
            }, 'updateMany');
            const runs = Number((result && result.modifiedCount) || 0);
            ctx.logger.info(`[migrations] 019 ${companyId}: ${runs} workflow run(s) given a zero spend`);
            return { runs };
        });
    },
};
