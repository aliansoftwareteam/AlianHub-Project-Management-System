/* Status conditions used to be stored as `statusType = <name>`, which compares a
 * status name with the task's type and so never matched a named status. This
 * rewrites each such condition to the keys of the statuses it names within the
 * rule's projects (names only, never a generic type). A condition naming a status
 * no project in scope has is left exactly as written and the rule is flagged with
 * `needsReview`, so nothing is dropped or widened. After one run no convertible
 * name is left and every flag is already set, which is what makes a second run a
 * no-op.
 *
 * v1 rules resolve their name at read time (helpers/automationRules) and are not
 * rewritten.
 */

const { catalogueOf, normaliseStatusConditions, hasStatusNames } = require('../Modules/Automations/helpers/statusConditions');

const reviewOf = (unresolved) => unresolved.map((status) => ({ reason: 'unknown_status', status }));

module.exports = {
    id: '061-automation-status-conditions',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const type = ctx.SCHEMA_TYPE.AUTOMATION_RULES;
            const rules = ((await ctx.company(companyId, { type, data: [{ version: 2, deletedStatusKey: { $ne: 1 } }] }, 'find')) || [])
                .map((rule) => (rule.toObject ? rule.toObject() : rule))
                .filter((rule) => hasStatusNames(rule.conditions));
            if (!rules.length) return { rules: 0, converted: 0, flagged: 0 };

            const projects = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.PROJECTS, data: [{}, { taskStatusData: 1 }] }, 'find');
            const statuses = catalogueOf(projects || []);
            let converted = 0;
            let flagged = 0;
            for (const rule of rules) {
                const out = normaliseStatusConditions(rule.conditions, statuses, rule.scope, { extend: false, generic: false });
                const $set = {};
                if (out.changed) $set.conditions = out.conditions;
                const review = reviewOf(out.unresolved);
                if (review.length && JSON.stringify(review) !== JSON.stringify(rule.needsReview || [])) $set.needsReview = review;
                if (!Object.keys($set).length) continue;
                // eslint-disable-next-line no-await-in-loop
                await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set }] }, 'updateOne');
                if ($set.conditions) converted += 1;
                if ($set.needsReview) flagged += 1;
            }
            ctx.logger.info(`[migrations] 061 ${companyId}: ${converted} rule(s) keyed by status, ${flagged} flagged for review, of ${rules.length} naming a status`);
            return { rules: rules.length, converted, flagged };
        });
    },
};
