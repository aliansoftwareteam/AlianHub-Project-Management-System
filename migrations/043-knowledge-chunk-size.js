/* Stores in every tenant the UTF-8 size of each chunk written before chunks carried one, then builds
 * the index the console's figures are summed from. The sizes go first so the index is built once
 * with them rather than updated row by row. The update runs on the server and keeps updatedAt,
 * which the figures show as when a source was last indexed. createIndexes, not syncIndexes, which
 * would drop any index the schema does not declare. */

const ID = '043-knowledge-chunk-size';
const { FIGURES_INDEX_KEY: KEY } = require('../Modules/Knowledge/figuresPipeline');

const INDEX_NAME = Object.entries(KEY).map(([field, direction]) => `${field}_${direction}`).join('_');
const INDEX_NOT_FOUND = 27;

const keyed = (fields) => (index) => Boolean(index && index.key)
    && Object.keys(index.key).length === Object.keys(fields).length
    && Object.entries(fields).every(([field, direction]) => index.key[field] === direction);

async function indexCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.KNOWLEDGE_CHUNKS;
    const sized = await ctx.company(companyId, {
        type,
        data: [
            { textBytes: { $exists: false } },
            [{ $set: { textBytes: { $strLenBytes: { $ifNull: ['$text', ''] } } } }],
            { timestamps: false },
        ],
    }, 'updateMany');
    await ctx.company(companyId, { type, data: [] }, 'createIndexes');
    const indexes = await ctx.company(companyId, { type, data: [] }, 'listIndexes') || [];
    const index = indexes.find(keyed(KEY));
    if (!index) throw new Error('knowledge_chunks figures index missing after createIndexes');
    return { sized: (sized && sized.modifiedCount) || 0, figuresIndex: index.name };
}

async function dropCompany(ctx, companyId) {
    try {
        await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.KNOWLEDGE_CHUNKS, data: [INDEX_NAME] }, 'dropIndex');
        return { dropped: INDEX_NAME };
    } catch (error) {
        if (error && error.code === INDEX_NOT_FOUND) return { dropped: null };
        throw error;
    }
}

module.exports = {
    id: ID,
    scope: 'company',
    indexCompany,
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const result = await indexCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 043 ${companyId}: ${JSON.stringify(result)}`);
            return result;
        });
    },
    async down(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const result = await dropCompany(ctx, companyId);
            ctx.logger.info(`[migrations] 043 down ${companyId}: ${JSON.stringify(result)}`);
            return result;
        });
    },
};
