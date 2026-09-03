const { addComment } = require('../tools');

module.exports = {
    key: 'add_comment',
    label: 'Add a comment',
    appliesTo: ['task'],
    scopes: ['task.comment'],
    schema: {
        body: { type: 'textarea', label: 'Comment', required: true, supportsTemplates: true },
    },
    async run({ companyId, entity, config, context }) {
        const result = await addComment(companyId, entity.id, config.body, context);
        return { changed: result.changed, commentId: result.commentId };
    },
};
