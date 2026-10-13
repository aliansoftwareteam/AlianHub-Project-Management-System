const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const seed = require('../Modules/Agents/skills/seeds/briefParse');

/* brief.parse becomes a data skill in every company (ADR 003, task 025 step 4).
 * A company that already holds the key, live, disabled or retired, keeps its
 * own document: the seed never overwrites what an admin changed. */

const seededDocument = () => {
    const checked = validateSkill(seed);
    if (!checked.ok) throw new Error(`the brief.parse seed does not validate: ${checked.errors.map((e) => `${e.field} ${e.code}`).join('; ')}`);
    return checked.value;
};

module.exports = {
    id: '010-seed-brief-parse-skill',
    scope: 'company',
    async up(ctx) {
        const doc = seededDocument();
        const type = ctx.SCHEMA_TYPE.AGENT_SKILLS;
        await ctx.forEachCompany(async (companyId) => {
            const existing = await ctx.company(companyId, { type, data: [{ key: doc.key }, { _id: 1 }] }, 'findOne');
            const counts = { inserted: existing ? 0 : 1, present: existing ? 1 : 0 };
            if (!existing) await ctx.company(companyId, { type, data: { ...doc } }, 'save');
            ctx.logger.info(`[migrations] 010 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
