const { createSubtask } = require('../tools');

module.exports = {
    key: 'create_subtask',
    label: 'Create a subtask',
    appliesTo: ['task'],
    scopes: ['task.subtask.create'],
    schema: {
        title: { type: 'text', label: 'Subtask title', required: true, supportsTemplates: true },
        description: { type: 'textarea', label: 'Description', required: false, supportsTemplates: true },
    },
    async run({ companyId, entity, config, context }) {
        const result = await createSubtask(companyId, entity.id, { title: config.title, description: config.description }, context);
        return { changed: true, subtaskId: result.subtaskId, title: result.title };
    },
};
