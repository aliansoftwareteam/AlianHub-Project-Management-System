/* Task 046: stores on every subtask its chain of parents (`ancestors`, root first), which the
 * cascades and the depth rule read instead of walking ParentTaskId. A top-level task is not
 * written: a missing chain reads as empty. Counted and left as they are, with the rows under them:
 * a chain that ends at a missing task (orphans) or loops (cycles), and a subtask outside its root's
 * sprint (otherSprint). A row below level three, which the automation createSubtask could make, is
 * re-hung on its level-two ancestor and both parents' subTasks follow.
 * Every row is read before the first write, so a dry run plans from the data as it is; each update
 * names the ParentTaskId or the count it read, so a row changed meanwhile is skipped. updatedAt is
 * kept: nothing a person sees on the task changed. verify() reads the index back, not up(): a read
 * after the write would stop the dry run from planning. */

const mongoose = require('mongoose');
const { HEX_ID } = require('../utils/mongo-handler/objectIdKeys');
const { MAX_DEPTH } = require('../Modules/Tasks/helpers/taskTree');

const ID = '064-task-ancestors';
const BATCH_SIZE = 500;

const hasParent = { ParentTaskId: { $type: 'string', $ne: '' } };
const sameChain = (stored, chain) => Array.isArray(stored) && stored.length === chain.length && stored.every((id, index) => String(id) === chain[index]);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

async function readTasks(ctx, companyId, filter, projection) {
    return await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [filter, projection, { lean: true }] }, 'find') || [];
}

async function readTops(ctx, companyId, subtasks) {
    const ids = [...new Set([...subtasks.values()].map((row) => String(row.ParentTaskId)))].filter((id) => !subtasks.has(id) && HEX_ID.test(id));
    const tops = new Map();
    for (let start = 0; start < ids.length; start += BATCH_SIZE) {
        const batch = ids.slice(start, start + BATCH_SIZE).map((id) => new mongoose.Types.ObjectId(id));
        (await readTasks(ctx, companyId, { _id: { $in: batch } }, { sprintId: 1 })).forEach((row) => tops.set(String(row._id), row));
    }
    return tops;
}

/* Resolves every subtask to its chain as stored today, or to the reason it has none. Iterative
 * and memoised: a chain is walked once however many rows hang under it. */
function resolveChains(subtasks, tops) {
    const resolved = new Map();
    const parentOf = (id) => String(subtasks.get(id).ParentTaskId);
    for (const start of subtasks.keys()) {
        const path = [];
        const onPath = new Set();
        let id = start;
        let above = null;
        while (!above) {
            if (resolved.has(id)) above = resolved.get(id);
            else if (onPath.has(id)) above = { left: 'cycles' };
            else if (subtasks.has(id)) { path.push(id); onPath.add(id); id = parentOf(id); }
            else above = tops.has(id) ? { chain: [], sprintId: tops.get(id).sprintId } : { left: 'orphans' };
        }
        for (let at = path.length - 1; at >= 0; at -= 1) {
            const row = path[at];
            if (!above.left) {
                above = String(subtasks.get(row).sprintId) === String(above.sprintId)
                    ? { chain: [...above.chain, parentOf(row)], sprintId: above.sprintId }
                    : { left: 'otherSprint' };
            }
            resolved.set(row, above);
        }
    }
    return resolved;
}

async function planCompany(ctx, companyId) {
    const subtasks = new Map((await readTasks(ctx, companyId, hasParent, { ParentTaskId: 1, sprintId: 1, subTasks: 1, ancestors: 1 })).map((row) => [String(row._id), row]));
    const resolved = resolveChains(subtasks, await readTops(ctx, companyId, subtasks));

    const counts = { subtasks: subtasks.size, written: 0, rehung: 0, recounted: 0, orphans: 0, cycles: 0, otherSprint: 0 };
    const childrenGained = new Map();
    const gain = (id, by) => childrenGained.set(id, (childrenGained.get(id) || 0) + by);
    const ops = [];
    for (const [id, row] of subtasks) {
        const { chain, left } = resolved.get(id);
        if (left) { counts[left] += 1; continue; }
        const parent = String(row.ParentTaskId);
        const ancestors = chain.slice(0, MAX_DEPTH);
        const $set = { ancestors };
        if (chain.length > MAX_DEPTH) {
            $set.ParentTaskId = ancestors[MAX_DEPTH - 1];
            gain(parent, -1);
            gain($set.ParentTaskId, 1);
            counts.rehung += 1;
        } else if (sameChain(row.ancestors, ancestors)) continue;
        ops.push({ updateOne: { filter: { _id: row._id, ParentTaskId: row.ParentTaskId }, update: { $set }, timestamps: false } });
    }
    counts.written = ops.length;
    for (const [id, by] of childrenGained) {
        const row = subtasks.get(id);
        const subTasks = Math.max(0, (row.subTasks || 0) + by);
        if (subTasks === (row.subTasks || 0)) continue;
        ops.push({ updateOne: { filter: { _id: row._id, subTasks: row.subTasks ?? null }, update: { $set: { subTasks } }, timestamps: false } });
        counts.recounted += 1;
    }
    return { ops, counts };
}

async function convertCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.TASKS;
    const { ops, counts } = await planCompany(ctx, companyId);
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        await ctx.company(companyId, { type, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > BATCH_SIZE) ctx.logger.info(`[migrations] 064 ${companyId}: ${Math.min(start + BATCH_SIZE, ops.length)} of ${ops.length} writes`);
    }
    /* createIndexes, not syncIndexes, which would drop any index the schema does not declare. */
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    return counts;
}

async function hasAncestorsIndex(ctx, companyId) {
    const indexes = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [] }, 'listIndexes').catch(() => []) || [];
    return indexes.some((index) => index && index.key && index.key.ancestors === 1);
}

module.exports = {
    id: ID,
    scope: 'company',
    BATCH_SIZE,
    planCompany,
    convertCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await convertCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 064 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    /* Orphans, cycles and subtasks in another sprint cannot be repaired here, so only the rows
     * this migration would still write are a problem. */
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const { written, rehung } = (await planCompany(ctx, companyId)).counts;
            if (written) problems.push(`${companyId} ${plural(written, 'subtask')} without the right ancestors`);
            if (rehung) problems.push(`${companyId} ${plural(rehung, 'subtask')} below level three`);
            if (!await hasAncestorsIndex(ctx, companyId)) problems.push(`${companyId} tasks have no ancestors index`);
        });
        return problems;
    },
};
