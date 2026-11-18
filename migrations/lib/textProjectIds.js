/* Task 040: a row's project id is stored as an ObjectId. Writers convert through the schema from this
 * release on; this rewrites the ids older rows hold as text. An empty string is how these collections
 * say "no project", so it is left alone and not counted; any other value that is not a 24-hex id is
 * left as it is and counted. Every candidate in a company is read, a page at a time in _id order,
 * before the first write: a dry run cannot trust a read that follows a write it refused, so the plan
 * comes from the data as it is. Each update names the text it read, so a row rewritten meanwhile is
 * skipped. updatedAt is kept: the row did not change. No unique index covers the project id on any
 * collection this serves, so two forms of one id cannot collide. */

const mongoose = require('mongoose');
const { HEX_ID } = require('../../utils/mongo-handler/objectIdKeys');

const BATCH_SIZE = 500;
const HEX_LENGTH = 24;

const textProjectIdsMigration = ({ id, schemaType, field, noun }) => {
    const tag = id.slice(0, 3);
    const inTextForm = { [field]: { $type: 'string', $ne: '' } };
    const stillText = { [field]: { $type: 'string', $regex: HEX_ID.source } };

    /* A row waiting for its write is kept as one string, its _id and project id in hex, rather than
     * as a driver document. */
    async function readCandidates(ctx, companyId, type, counts) {
        const pending = [];
        let after = null;
        for (;;) {
            const filter = after === null ? inTextForm : { ...inTextForm, _id: { $gt: after } };
            const page = await ctx.company(companyId, { type, data: [filter, { [field]: 1 }, { sort: { _id: 1 }, limit: BATCH_SIZE, lean: true }] }, 'find') || [];
            page.forEach((row) => {
                if (HEX_ID.test(row[field]) && HEX_ID.test(String(row._id))) pending.push(`${row._id}${row[field]}`);
                else counts.invalid += 1;
            });
            if (page.length < BATCH_SIZE) return pending;
            after = page[page.length - 1]._id;
            ctx.logger.info(`[migrations] ${tag} ${companyId}: read ${pending.length + counts.invalid} ${noun.many}`);
        }
    }

    const updateOf = (row) => {
        const text = row.slice(HEX_LENGTH);
        return { updateOne: { filter: { _id: new mongoose.Types.ObjectId(row.slice(0, HEX_LENGTH)), [field]: text }, update: { $set: { [field]: new mongoose.Types.ObjectId(text) } }, timestamps: false } };
    };

    async function convertCompany(ctx, companyId) {
        const type = ctx.SCHEMA_TYPE[schemaType];
        const counts = { converted: 0, invalid: 0 };
        const pending = await readCandidates(ctx, companyId, type, counts);
        for (let start = 0; start < pending.length; start += BATCH_SIZE) {
            const batch = pending.slice(start, start + BATCH_SIZE).map(updateOf);
            await ctx.company(companyId, { type, data: [batch, { ordered: false }] }, 'bulkWrite');
            counts.converted += batch.length;
            ctx.logger.info(`[migrations] ${tag} ${companyId}: ${counts.converted} of ${pending.length} ${noun.many} converted`);
        }
        return counts;
    }

    return {
        id,
        scope: 'company',
        BATCH_SIZE,
        convertCompany,
        async up(ctx) {
            await ctx.forEachCompany(async (companyId) => {
                const counts = await convertCompany(ctx, companyId);
                ctx.logger.info(`[migrations] ${tag} ${companyId}: ${JSON.stringify(counts)}`);
                return counts;
            });
        },
        async verify(ctx) {
            const problems = [];
            await ctx.forEachCompany(async (companyId) => {
                const left = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE[schemaType], data: [stillText] }, 'countDocuments');
                if (left) problems.push(`${companyId} ${left} ${left === 1 ? `${noun.one} still stores` : `${noun.many} still store`} a project id as text`);
            });
            return problems;
        },
    };
};

module.exports = { textProjectIdsMigration, BATCH_SIZE };
