const taskClass = require('../Modules/AICore/taskClass');
const routingPolicy = require('../Modules/AICore/routingPolicy');
const modelPin = require('../Modules/AICore/modelPin');

/* Every company gets the routing policy written out, so the shape exists before
 * anything reads it and an admin sees the platform defaults rather than an empty
 * form. No class gets a model: an empty policy is today's behaviour, which is
 * what AI_MODEL_ROUTER's default reproduces.
 *
 * Agent pins predate validation, so any that would now be refused at save time
 * are named in the log — they are left alone, because the migration cannot know
 * which priced model the admin meant. */

const defaultPolicy = () => ({
    classes: Object.fromEntries(taskClass.TASK_CLASS_LIST.map((key) => {
        const definition = taskClass.definitionOf(key);
        return [key, { qualityFloor: definition.qualityFloor, latencyTargetMs: definition.latencyTargetMs }];
    })),
    updatedAt: null,
    updatedBy: null,
});

module.exports = {
    id: '014-ai-routing-policy',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId, company) => {
            const counts = { policy: 'present', unpricedAgentPins: 0, unpricedSkillPins: 0 };
            const seeded = await ctx.global({
                type: ctx.SCHEMA_TYPE.COMPANIES,
                data: [{ _id: company._id, [routingPolicy.COMPANY_FIELD]: { $exists: false } }, { $set: { [routingPolicy.COMPANY_FIELD]: defaultPolicy() } }],
            }, 'updateOne');
            if (seeded && seeded.modifiedCount) counts.policy = 'seeded';

            const agents = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENTS, data: [{ model: { $nin: [null, ''] }, deletedStatusKey: { $ne: 1 } }, 'name model'] }, 'find') || [];
            agents.filter((agent) => !modelPin.validatePin(agent.model).ok).forEach((agent) => {
                counts.unpricedAgentPins += 1;
                ctx.logger.warn(`[migrations] 014 ${companyId}: agent "${agent.name}" pins "${agent.model}", which the priced allowlist would refuse`);
            });

            const skills = await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.AGENT_SKILLS, data: [{ model: { $nin: [null, ''] } }, 'key model'] }, 'find') || [];
            skills.filter((skill) => !modelPin.validatePin(skill.model).ok).forEach((skill) => {
                counts.unpricedSkillPins += 1;
                ctx.logger.warn(`[migrations] 014 ${companyId}: skill "${skill.key}" pins "${skill.model}", which the priced allowlist would refuse`);
            });

            ctx.logger.info(`[migrations] 014 ${companyId}: ${JSON.stringify(counts)}`);
            return counts;
        });
    },
};
