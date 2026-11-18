/* Task 034: the sample-task generator stored the whole sprint document as a task's sprintArray (an
 * `_id`, no `id`), so the app, which finds a task by sprintArray.id, .folderId and folderObjId, never
 * showed it in its sprint or folder. This rewrites those tasks to the element the app's writers store,
 * from the sprint as it is now. A task whose sprint no longer exists is left as it is and counted.
 * Every candidate is read before the first write, so a dry run plans from the data as it is; each
 * update names the sprint document it read, so a task moved meanwhile is skipped. updatedAt is kept:
 * the task did not change. */

const mongoose = require('mongoose');
const { HEX_ID } = require('../utils/mongo-handler/objectIdKeys');
const { sprintPlacementOf } = require('../Modules/Tasks/helpers/sprintPlacement');

const ID = '046-task-sprint-placement';
const BATCH_SIZE = 500;

const inDocumentForm = { 'sprintArray._id': { $exists: true }, 'sprintArray.id': { $exists: false } };

const hexOf = (value) => {
    const text = value && typeof value.toHexString === 'function' ? value.toHexString() : String(value);
    return HEX_ID.test(text) ? text.toLowerCase() : null;
};

async function planCompany(ctx, companyId) {
    const tasks = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [inDocumentForm, { sprintArray: 1 }, { lean: true }] }, 'find') || [];
    const ids = [...new Set(tasks.map((task) => hexOf(task.sprintArray._id)).filter(Boolean))];
    const sprints = ids.length
        ? await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.SPRINTS, data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { name: 1, folderId: 1 }, { lean: true }] }, 'find') || []
        : [];
    const placements = new Map();
    for (const sprint of sprints) {
        placements.set(hexOf(sprint._id), await sprintPlacementOf(companyId, sprint));
    }

    const counts = { converted: 0, orphaned: 0 };
    const ops = [];
    tasks.forEach((task) => {
        const placement = placements.get(hexOf(task.sprintArray._id));
        if (!placement) {
            counts.orphaned += 1;
            return;
        }
        const update = placement.unset ? { $set: placement.set, $unset: placement.unset } : { $set: placement.set };
        ops.push({ updateOne: { filter: { _id: task._id, ...inDocumentForm, 'sprintArray._id': task.sprintArray._id }, update, timestamps: false } });
    });
    counts.converted = ops.length;
    return { ops, counts };
}

async function convertCompany(ctx, companyId) {
    const { ops, counts } = await planCompany(ctx, companyId);
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > BATCH_SIZE) ctx.logger.info(`[migrations] 046 ${companyId}: ${Math.min(start + BATCH_SIZE, ops.length)} of ${ops.length} tasks`);
    }
    return counts;
}

module.exports = {
    id: ID,
    scope: 'company',
    BATCH_SIZE,
    convertCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await convertCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 046 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    /* A task whose sprint is gone cannot be repaired, so only the ones that still could are a problem. */
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const left = (await planCompany(ctx, companyId)).counts.converted;
            if (left) problems.push(`${companyId} ${left} ${left === 1 ? 'task still stores' : 'tasks still store'} the sprint document as sprintArray`);
        });
        return problems;
    },
};
