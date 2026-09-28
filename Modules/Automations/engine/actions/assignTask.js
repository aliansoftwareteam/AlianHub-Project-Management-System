const { getTask, setAssignees, ruleOwner, DeterministicError } = require('../tools');
const assignees = require('../assignees');

const plainTask = (task) => (task && task.toObject ? task.toObject() : task);

module.exports = {
    key: 'assign',
    label: 'Assign to',
    appliesTo: ['task'],
    scopes: ['task.assign'],
    schema: {
        mode: { type: 'select', label: 'Mode', required: true, options: assignees.MODES },
        userIds: { type: 'user_multi', label: 'People', roles: assignees.ROLES },
        roundRobin: { type: 'boolean', label: 'Take turns' },
    },
    validate: (config, options) => assignees.configErrors(config, options),

    /* What run() would do, from the turn the rule has reached, without taking the turn or writing. */
    async preview({ companyId, task, config, context = {}, cursor = 0 }) {
        const plan = await assignees.planAssignment({ companyId, task: plainTask(task), config, context, cursor });
        return { mode: plan.mode, roundRobin: plan.roundRobin, wouldAssign: plan.targets, wouldRemove: plan.removed, skipped: plan.skipped, changed: plan.changed };
    },

    async run({ companyId, entity, config, context = {} }) {
        if (!assignees.MODES.includes(config.mode)) throw new DeterministicError(`mode must be one of ${assignees.MODES.join(', ')} — got "${config.mode}"`);
        const task = plainTask(await getTask(companyId, entity.id));
        const cursor = assignees.rotates(config) ? await assignees.claimTurn(companyId, context.ruleId, context.stepId) : 0;
        const plan = await assignees.planAssignment({ companyId, task, config, context, cursor });
        if (plan.passedOver) await assignees.claimTurn(companyId, context.ruleId, context.stepId, plan.passedOver);

        const actingUserId = context.actingUserId || await ruleOwner(companyId, context.ruleId);
        const result = await setAssignees(companyId, task, plan, { ...context, actingUserId, action: 'automation.task.assign' });
        return {
            changed: result.changed,
            mode: plan.mode,
            assigned: plan.added,
            removed: plan.removed,
            skipped: plan.skipped,
            assignees: plan.changed ? plan.next : plan.current,
        };
    },
};
