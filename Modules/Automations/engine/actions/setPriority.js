const { updateTask, DeterministicError } = require('../tools');
const { PRIORITIES } = require('../../helpers/automationRules');

module.exports = {
    key: 'set_priority',
    label: 'Change priority',
    appliesTo: ['task'],
    scopes: ['task.update'],
    schema: {
        priority: { type: 'select', label: 'Priority', required: true, options: PRIORITIES },
    },
    async run({ companyId, entity, config, context }) {
        const priority = String(config.priority || '').toUpperCase();
        // The v1 rule engine already constrained priority to this list; keeping the
        // same source of truth means the two cannot drift while both exist.
        if (!PRIORITIES.includes(priority)) {
            throw new DeterministicError(`priority must be one of ${PRIORITIES.join(', ')} — got "${config.priority}"`);
        }
        const result = await updateTask(companyId, entity.id, { Task_Priority: priority }, { ...context, action: 'automation.task.set_priority' });
        return { changed: result.changed, priority };
    },
};
