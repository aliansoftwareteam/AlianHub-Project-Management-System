/* Task 046: a task keeps four things of its list (sprintArray): id, name, folderId, folderName. Until this
 * release a move, a copy or a conversion stored whatever list it was sent, so older tasks can hold the whole
 * stored list: its people, counters and the flags a picker set. This removes every other key. The four are
 * not rewritten, so a task moved while this runs keeps its new list; a list stored as a document (an _id and
 * no id) gets its id from that _id, only while it still has none. A key that cannot be addressed in an update
 * (it holds a dot or starts with $) is left and counted. Every task is read before the first write, so a dry
 * run plans from the data as it is. updatedAt is kept: the task did not change. Running it again finds nothing. */

const { LIST_PLACEMENT_KEYS } = require('../utils/mongo-handler/listPlacement');
const { objectIdIfHex } = require('../utils/mongo-handler/objectIdKeys');

const ID = '068-task-list-placement';
const BATCH_SIZE = 500;
const PAGE_SIZE = 2000;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && !(value instanceof Date) && value._bsontype !== 'ObjectId';

const addressable = (key) => key !== '' && !key.includes('.') && !key.startsWith('$');

const idText = (value) => (value && typeof value.toHexString === 'function' ? value.toHexString() : value);

function planTask(task, counts) {
    const list = task.sprintArray;
    if (!isPlainObject(list)) return null;
    const extra = Object.keys(list).filter((key) => !LIST_PLACEMENT_KEYS.includes(key));
    if (!extra.length) return null;
    const removable = extra.filter(addressable);
    counts.unaddressable += extra.length - removable.length;
    if (!removable.length) return null;

    const filter = { _id: task._id };
    const update = { $unset: Object.fromEntries(removable.map((key) => [`sprintArray.${key}`, ''])) };
    const named = list.id === undefined && typeof idText(list._id) === 'string' && idText(list._id) !== '';
    if (named) {
        filter['sprintArray.id'] = { $exists: false };
        update.$set = { 'sprintArray.id': objectIdIfHex(idText(list._id)) };
        counts.named += 1;
    }
    return { updateOne: { filter, update, timestamps: false } };
}

async function planCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.TASKS;
    const counts = { tasks: 0, named: 0, unaddressable: 0 };
    const ops = [];
    let after = null;
    for (;;) {
        const page = await ctx.company(companyId, {
            type,
            data: [after === null ? {} : { _id: { $gt: after } }, { sprintArray: 1 }, { lean: true, sort: { _id: 1 }, limit: PAGE_SIZE }],
        }, 'find') || [];
        page.forEach((task) => {
            const op = planTask(task, counts);
            if (op) ops.push(op);
        });
        if (page.length < PAGE_SIZE) break;
        after = page[page.length - 1]._id;
    }
    counts.tasks = ops.length;
    return { ops, counts };
}

async function convertCompany(ctx, companyId) {
    const { ops, counts } = await planCompany(ctx, companyId);
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > BATCH_SIZE) ctx.logger.info(`[migrations] 068 ${companyId}: ${Math.min(start + BATCH_SIZE, ops.length)} of ${ops.length} tasks`);
    }
    return counts;
}

module.exports = {
    id: ID,
    scope: 'company',
    BATCH_SIZE,
    PAGE_SIZE,
    planCompany,
    convertCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await convertCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 068 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    /* The task schema cuts every list it is handed to the four fields, so nothing the app writes after this ran
     * can be counted here; a task left with other keys was written past the schema or restored from older data. */
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const left = (await planCompany(ctx, companyId)).counts.tasks;
            if (left) problems.push(`${companyId} ${left} ${left === 1 ? 'task still stores' : 'tasks still store'} more of a list than its id, name and folder`);
        });
        return problems;
    },
};
