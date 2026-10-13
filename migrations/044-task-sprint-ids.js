/* Task 040: a task's sprintArray.id and sprintArray.folderId are stored as ObjectIds. Writers convert
 * through the task schema from this release on; this rewrites the ids older tasks hold as text. A
 * value that is not a 24-hex id (a Firebase key, or '' for a sprint at the project root) is left as
 * it is and counted. Every candidate is read before the first write, so a dry run plans from the
 * data as it is; each update names the text it read, so a task rewritten meanwhile is skipped.
 * updatedAt is kept: the task did not change. No unique index covers sprintArray. */

const mongoose = require('mongoose');
const { HEX_ID } = require('../utils/mongo-handler/objectIdKeys');

const ID = '044-task-sprint-ids';
const KEYS = ['id', 'folderId'];
const BATCH_SIZE = 500;

const inTextForm = { $or: KEYS.map((key) => ({ [`sprintArray.${key}`]: { $type: 'string' } })) };
const stillText = { $or: KEYS.map((key) => ({ [`sprintArray.${key}`]: { $type: 'string', $regex: HEX_ID.source } })) };

function planTask(task, counts) {
    const filter = { _id: task._id };
    const $set = {};
    KEYS.forEach((key) => {
        const value = task.sprintArray && task.sprintArray[key];
        if (typeof value !== 'string') return;
        if (value === '') counts.empty += 1;
        else if (!HEX_ID.test(value)) counts.invalid += 1;
        else {
            filter[`sprintArray.${key}`] = value;
            $set[`sprintArray.${key}`] = new mongoose.Types.ObjectId(value);
            counts.converted += 1;
        }
    });
    return Object.keys($set).length ? { updateOne: { filter, update: { $set }, timestamps: false } } : null;
}

async function convertCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.TASKS;
    const tasks = await ctx.company(companyId, { type, data: [inTextForm, { sprintArray: 1 }, { lean: true }] }, 'find') || [];
    const counts = { tasks: 0, converted: 0, invalid: 0, empty: 0 };
    const ops = tasks.map((task) => planTask(task, counts)).filter(Boolean);
    counts.tasks = ops.length;
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        await ctx.company(companyId, { type, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > BATCH_SIZE) ctx.logger.info(`[migrations] 044 ${companyId}: ${Math.min(start + BATCH_SIZE, ops.length)} of ${ops.length} tasks`);
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
            ctx.logger.info(`[migrations] 044 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const left = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [stillText] }, 'countDocuments');
            if (left) problems.push(`${companyId} ${left} ${left === 1 ? 'task still stores' : 'tasks still store'} a sprint or folder id as text`);
        });
        return problems;
    },
};
