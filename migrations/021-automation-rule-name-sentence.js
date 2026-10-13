/* A v2 rule's `name` used to be composed by the builder from whatever the sentence
 * box held at save time, which could be a compile behind the rule being saved. The
 * result is a stored name that describes a different rule than the one that runs —
 * seen in the wild as `post a comment saying ""` on a rule whose step carries a
 * body. The name is quoted in the rule list, in every run row and as the actor on
 * every audit entry the rule writes, so leaving it wrong keeps showing people a
 * rule nobody saved.
 *
 * Only machine-composed names are repaired. A name that does not read as a
 * generated sentence was typed by somebody and is left exactly as it is; one that
 * does and already matches the rule is left alone too, which is what makes this
 * idempotent — after it runs every rewritten name equals describeRule(rule), so a
 * second run matches nothing.
 *
 * Run rows and audit entries keep the name they were written with: they record what
 * was shown at the time, and rewriting history to match the present would make the
 * log a worse record than it is.
 */

const { composedName } = require('../Modules/Automations/helpers/ruleSchemaV2');

const GENERATED = /^When .*\.$/s;

module.exports = {
    id: '021-automation-rule-name-sentence',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            const type = ctx.SCHEMA_TYPE.AUTOMATION_RULES;
            const rules = (await ctx.company(companyId, { type, data: [{ version: 2 }] }, 'find')) || [];
            const stale = rules
                .map((rule) => (rule.toObject ? rule.toObject() : rule))
                .map((rule) => ({ _id: rule._id, name: composedName(rule), was: String(rule.name || '').trim() }))
                .filter((r) => GENERATED.test(r.was) && r.was !== r.name);
            for (const rule of stale) {
                // eslint-disable-next-line no-await-in-loop
                await ctx.company(companyId, { type, data: [{ _id: rule._id }, { $set: { name: rule.name } }] }, 'updateOne');
            }
            ctx.logger.info(`[migrations] 021 ${companyId}: ${stale.length} of ${rules.length} v2 rule name(s) rewritten from the rule`);
            return { rules: rules.length, renamed: stale.length };
        });
    },
};
