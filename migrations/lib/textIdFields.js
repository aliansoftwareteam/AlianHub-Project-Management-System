/* Task 040: the listed id fields of a row are stored as ObjectIds. Writers convert through the schema
 * from this release on; this rewrites the ids older rows hold as text. These are the collections every
 * task event writes to, so a company can hold millions of rows: it is read a page at a time in _id
 * order and only each page's first and last _id is kept, never its rows. The write for a page then
 * converts on the server whatever in that _id range still holds a hex id as text, so it can neither
 * miss a row nor convert one twice. Every read comes before the first write: a dry run cannot trust a
 * read that follows a write it refused, so the plan comes from the data as it is. An empty string is
 * how these collections say "none", so it is left alone and not counted; any other text that is not a
 * 24-hex id is left as it is and counted. updatedAt is kept: the row did not change. No unique index
 * covers these fields, so two forms of one id cannot collide. */

const { HEX_ID } = require('../../utils/mongo-handler/objectIdKeys');

const BATCH_SIZE = 500;
const LOG_EVERY = 20;

const textIdFieldsMigration = ({ id, schemaType, fields, noun }) => {
    const tag = id.slice(0, 3);
    const hexText = { $type: 'string', $regex: HEX_ID.source };
    const anyText = { $or: fields.map((field) => ({ [field]: { $type: 'string', $ne: '' } })) };
    const projection = Object.fromEntries(fields.map((field) => [field, 1]));

    const tally = (row, counts) => fields.filter((field) => {
        const value = row[field];
        if (typeof value !== 'string' || value === '') return false;
        if (HEX_ID.test(value)) {
            counts[field] += 1;
            return true;
        }
        counts.invalid += 1;
        return false;
    });

    async function planBatches(ctx, companyId, type, counts) {
        const batches = [];
        let after = null;
        let read = 0;
        for (;;) {
            const filter = after === null ? anyText : { ...anyText, _id: { $gt: after } };
            const page = await ctx.company(companyId, { type, data: [filter, projection, { sort: { _id: 1 }, limit: BATCH_SIZE, lean: true }] }, 'find') || [];
            const converting = new Set(page.flatMap((row) => tally(row, counts)));
            if (converting.size) batches.push({ from: page[0]._id, to: page[page.length - 1]._id, fields: fields.filter((field) => converting.has(field)) });
            read += page.length;
            if (page.length < BATCH_SIZE) return batches;
            after = page[page.length - 1]._id;
            if ((read / BATCH_SIZE) % LOG_EVERY === 0) ctx.logger.info(`[migrations] ${tag} ${companyId}: read ${read} ${noun.many}`);
        }
    }

    const updatesOf = ({ from, to, fields: converting }) => converting.map((field) => [
        { _id: { $gte: from, $lte: to }, [field]: hexText },
        [{ $set: { [field]: { $toObjectId: `$${field}` } } }],
        { timestamps: false },
    ]);

    async function convertCompany(ctx, companyId) {
        const type = ctx.SCHEMA_TYPE[schemaType];
        const counts = { ...Object.fromEntries(fields.map((field) => [field, 0])), invalid: 0 };
        const batches = await planBatches(ctx, companyId, type, counts);
        for (let done = 1; done <= batches.length; done += 1) {
            for (const update of updatesOf(batches[done - 1])) {
                await ctx.company(companyId, { type, data: update }, 'updateMany');
            }
            if (done % LOG_EVERY === 0 || done === batches.length) {
                ctx.logger.info(`[migrations] ${tag} ${companyId}: ${done} of ${batches.length} batches of ${noun.many} converted`);
            }
        }
        return counts;
    }

    return {
        id,
        scope: 'company',
        BATCH_SIZE,
        LOG_EVERY,
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
                for (const field of fields) {
                    const left = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE[schemaType], data: [{ [field]: hexText }] }, 'countDocuments');
                    if (left) problems.push(`${companyId} ${left} ${left === 1 ? `${noun.one} still stores` : `${noun.many} still store`} ${field} as text`);
                }
            });
            return problems;
        },
    };
};

module.exports = { textIdFieldsMigration, BATCH_SIZE, LOG_EVERY };
