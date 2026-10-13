/* Task 046: until convert, merge and duplicate maintained `ancestors`, a row they moved kept the
 * chain it had. Runs 064's plan again for subtasks, and clears the chain a task still holds from
 * when it was a subtask, which that plan never writes. Every row is read before the first write,
 * so a dry run plans from the data as it is; each update names the ParentTaskId it read, so a row
 * a writer changed meanwhile is skipped. updatedAt is kept.
 * verify() is the invariant every writer keeps from this version on: a subtask's chain is the one
 * its parents give, none sits below level three, and a task holds no chain. Rows the plan leaves
 * alone (a missing parent, a loop, another sprint) are not judged, and nothing is read but tasks,
 * so a workspace made afterwards, or one with no tasks at all, passes. */

const base = require('./064-task-ancestors');

const ID = '066-task-ancestors-repair';

const topLevelWithChain = { $or: [{ ParentTaskId: '' }, { ParentTaskId: null }], 'ancestors.0': { $exists: true } };
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

async function planCompany(ctx, companyId) {
    const { ops, counts } = await base.planCompany(ctx, companyId);
    const tops = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [topLevelWithChain, { ParentTaskId: 1 }, { lean: true }] }, 'find') || [];
    tops.forEach((row) => ops.push({ updateOne: { filter: { _id: row._id, ParentTaskId: row.ParentTaskId ?? null }, update: { $set: { ancestors: [] } }, timestamps: false } }));
    return { ops, counts: { ...counts, cleared: tops.length } };
}

async function repairCompany(ctx, companyId) {
    const { ops, counts } = await planCompany(ctx, companyId);
    for (let start = 0; start < ops.length; start += base.BATCH_SIZE) {
        await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [ops.slice(start, start + base.BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > base.BATCH_SIZE) ctx.logger.info(`[migrations] 066 ${companyId}: ${Math.min(start + base.BATCH_SIZE, ops.length)} of ${ops.length} writes`);
    }
    return counts;
}

module.exports = {
    id: ID,
    scope: 'company',
    planCompany,
    repairCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await repairCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 066 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const { written, rehung, cleared } = (await planCompany(ctx, companyId)).counts;
            if (written) problems.push(`${companyId} ${plural(written, 'subtask')} whose ancestors are not the chain of their parents`);
            if (rehung) problems.push(`${companyId} ${plural(rehung, 'subtask')} below level three`);
            if (cleared) problems.push(`${companyId} ${plural(cleared, 'task')} that still ${cleared === 1 ? 'holds' : 'hold'} a chain`);
        });
        return problems;
    },
};
