/* 061 keyed the status names in a rule's own conditions; the condition steps
 * inside a rule and a saved workflow's condition and loop steps still name
 * statuses. This keys those the same way (names only, never a generic type,
 * within the rule's projects), and leaves a name no project in scope has as
 * written, flagging it on `needsReview` next to whatever 061 flagged. Runs in
 * flight are resolved when their step executes and are not rewritten. After one
 * run no convertible name is left and every flag is already present, so a
 * second run writes nothing.
 */

const { catalogueOf, normaliseStepConditions, stepsNeedStatusCatalogue } = require('../Modules/Automations/helpers/statusConditions');

const reviewOf = (unresolved) => unresolved.map(({ step, status }) => ({ reason: 'unknown_status', status, step }));

const mergeReview = (existing, added) => {
    const kept = Array.isArray(existing) ? existing : [];
    const seen = new Set(kept.map((entry) => JSON.stringify(entry)));
    return [...kept, ...added.filter((entry) => !seen.has(JSON.stringify(entry)))];
};

const plainOf = (doc) => (doc && doc.toObject ? doc.toObject() : doc);

module.exports = {
    id: '062-workflow-status-conditions',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const live = { deletedStatusKey: { $ne: 1 } };
            const find = async (type, filter) => ((await ctx.company(companyId, { type, data: [filter] }, 'find')) || [])
                .map(plainOf)
                .filter((doc) => stepsNeedStatusCatalogue(doc.steps))
                .map((doc) => ({ type, doc }));
            const owners = [
                ...(await find(ctx.SCHEMA_TYPE.AUTOMATION_RULES, { version: 2, ...live })),
                ...(await find(ctx.SCHEMA_TYPE.WORKFLOW_DEFINITIONS, live)),
            ];
            if (!owners.length) return { owners: 0, converted: 0, flagged: 0 };

            const projects = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.PROJECTS, data: [{}, { taskStatusData: 1 }] }, 'find');
            const statuses = catalogueOf(projects || []);
            let converted = 0;
            let flagged = 0;
            for (const { type, doc } of owners) {
                const out = normaliseStepConditions(doc.steps, statuses, doc.scope || {}, { extend: false, generic: false });
                const $set = {};
                if (out.changed) $set.steps = out.steps;
                const review = mergeReview(doc.needsReview, reviewOf(out.unresolved));
                if (review.length !== (doc.needsReview || []).length) $set.needsReview = review;
                if (!Object.keys($set).length) continue;
                // eslint-disable-next-line no-await-in-loop
                await ctx.company(companyId, { type, data: [{ _id: doc._id }, { $set }] }, 'updateOne');
                if ($set.steps) converted += 1;
                if ($set.needsReview) flagged += 1;
            }
            ctx.logger.info(`[migrations] 062 ${companyId}: ${converted} rule(s) or workflow(s) keyed by status, ${flagged} flagged for review, of ${owners.length} with a status condition in a step`);
            return { owners: owners.length, converted, flagged };
        });
    },
};
