/* Task 040: a milestone's projectId is stored as an ObjectId. Writers convert through the milestone
 * schema from this release on; this rewrites the ids older milestones hold as text. A value that is
 * not a 24-hex id is left as it is and counted. Every candidate is read before the first write, so a
 * dry run plans from the data as it is; each update names the text it read, so a milestone rewritten
 * meanwhile is skipped. updatedAt is kept: the milestone did not change. No unique index covers
 * milestone.projectId, so two forms of one id cannot collide. */

const mongoose = require('mongoose');
const { HEX_ID } = require('../utils/mongo-handler/objectIdKeys');

const ID = '045-milestone-project-ids';
const BATCH_SIZE = 500;

const inTextForm = { projectId: { $type: 'string' } };
const stillText = { projectId: { $type: 'string', $regex: HEX_ID.source } };

async function convertCompany(ctx, companyId) {
    const type = ctx.SCHEMA_TYPE.MILESTONE;
    const milestones = await ctx.company(companyId, { type, data: [inTextForm, { projectId: 1 }, { lean: true }] }, 'find') || [];
    const counts = { converted: 0, invalid: 0 };
    const ops = [];
    milestones.forEach(({ _id, projectId }) => {
        if (!HEX_ID.test(projectId)) {
            counts.invalid += 1;
            return;
        }
        ops.push({ updateOne: { filter: { _id, projectId }, update: { $set: { projectId: new mongoose.Types.ObjectId(projectId) } }, timestamps: false } });
    });
    counts.converted = ops.length;
    for (let start = 0; start < ops.length; start += BATCH_SIZE) {
        await ctx.company(companyId, { type, data: [ops.slice(start, start + BATCH_SIZE), { ordered: false }] }, 'bulkWrite');
        if (ops.length > BATCH_SIZE) ctx.logger.info(`[migrations] 045 ${companyId}: ${Math.min(start + BATCH_SIZE, ops.length)} of ${ops.length} milestones`);
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
            ctx.logger.info(`[migrations] 045 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
    async verify(ctx) {
        const problems = [];
        await ctx.forEachCompany(async (companyId) => {
            const left = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.MILESTONE, data: [stillText] }, 'countDocuments');
            if (left) problems.push(`${companyId} ${left} ${left === 1 ? 'milestone still stores' : 'milestones still store'} a project id as text`);
        });
        return problems;
    },
};
