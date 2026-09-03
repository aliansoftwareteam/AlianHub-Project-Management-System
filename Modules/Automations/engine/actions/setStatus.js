const { resolveStatus, updateTask } = require('../tools');

module.exports = {
    key: 'set_status',
    label: 'Change status',
    appliesTo: ['task'],
    scopes: ['task.update'],
    schema: {
        status: { type: 'status_picker', label: 'Status', required: true },
    },
    async run({ companyId, entity, config, context }) {
        const task = context.task || {};
        const patch = await resolveStatus(companyId, task.ProjectID, config.status);
        const result = await updateTask(companyId, entity.id, patch, { ...context, action: 'automation.task.set_status' });
        return { changed: result.changed, status: patch.statusType, statusKey: patch.statusKey };
    },
};
