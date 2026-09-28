/* Task 042 slice 8: stars move from each project, sprint and task (favouriteTasks) into one list on
 * the user record, where each entry names the company it came from. A company's stars are read
 * only through that company's scope. Each push is guarded by the entry it adds, so a second run,
 * or a star the user already made in the new store, adds nothing. favouriteTasks is left in place,
 * and the legacy routes may still write it, so there is no verify: a later legacy star is not a gap. */

const { HEX_ID } = require('../utils/mongo-handler/objectIdKeys');
const mongoose = require('mongoose');

const ID = '057-favourites-store';
const BATCH_SIZE = 500;
const SOURCES = [
    { type: 'project', schemaType: 'PROJECTS' },
    { type: 'sprint', schemaType: 'SPRINTS' },
    { type: 'task', schemaType: 'TASKS' },
];

const starred = { 'favouriteTasks.0': { $exists: true }, deletedStatusKey: { $ne: 1 } };
const userIdOf = (star) => String((star && typeof star === 'object' ? star.userId : star) || '');

async function starsOf(ctx, companyId) {
    const found = [];
    for (const source of SOURCES) {
        const rows = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE[source.schemaType], data: [starred, { favouriteTasks: 1 }, { lean: true }] }, 'find') || [];
        rows.forEach((row) => {
            new Set((row.favouriteTasks || []).map(userIdOf)).forEach((userId) => {
                if (HEX_ID.test(userId)) found.push({ userId, type: source.type, id: String(row._id) });
            });
        });
    }
    return found;
}

const pushOf = (companyId, { userId, type, id }, addedAt) => {
    const entry = { companyId: String(companyId), type, id };
    return {
        updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(userId), $nor: [{ favourites: { $elemMatch: entry } }] },
            update: { $push: { favourites: { ...entry, addedAt } } },
            timestamps: false,
        },
    };
};

async function moveCompany(ctx, companyId) {
    const stars = await starsOf(ctx, companyId);
    const addedAt = new Date();
    const ops = stars.map((star) => pushOf(companyId, star, addedAt));
    let added = 0;
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        const result = await ctx.global({ type: ctx.SCHEMA_TYPE.USERS, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        added += Number((result && (result.modifiedCount ?? result.nModified)) || 0);
    }
    return { stars: stars.length, added };
}

module.exports = {
    id: ID,
    scope: 'company',
    BATCH_SIZE,
    moveCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const counts = await moveCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 057 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
