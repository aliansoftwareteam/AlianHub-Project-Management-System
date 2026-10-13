const { documentOf, SEEDS } = require('../Modules/Agents/skills/seeds');

/* digest.ceo and project.guide become data skills in every company (ADR 003
 * phase 3, task 029 step 2). Both already resolve from the built-in seed, so
 * this only gives a workspace its own editable copy; a company that already
 * holds either key, live, disabled or retired, keeps the document it has. */

module.exports = {
    id: '022-seed-reporter-and-guide-skills',
    scope: 'company',
    async up(ctx) {
        const docs = [documentOf(SEEDS.digest), documentOf(SEEDS.projectGuide)];
        const type = ctx.SCHEMA_TYPE.AGENT_SKILLS;
        await ctx.forEachCompany(async (companyId) => {
            const counts = { inserted: 0, present: 0 };
            for (const doc of docs) {
                // eslint-disable-next-line no-await-in-loop
                const existing = await ctx.company(companyId, { type, data: [{ key: doc.key }, { _id: 1 }] }, 'findOne');
                if (existing) counts.present += 1;
                // eslint-disable-next-line no-await-in-loop
                else { await ctx.company(companyId, { type, data: { ...doc } }, 'save'); counts.inserted += 1; }
            }
            ctx.logger.info(`[migrations] 022 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
