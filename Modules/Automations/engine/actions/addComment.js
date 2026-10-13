const { addComment, ruleOwner } = require('../tools');

module.exports = {
    key: 'add_comment',
    label: 'Add a comment',
    appliesTo: ['task'],
    scopes: ['task.comment'],
    schema: {
        body: { type: 'textarea', label: 'Comment', required: true, supportsTemplates: true },
    },
    /* A rule comments as its author, the identity a rule-started agent run already acts for. */
    async run({ companyId, entity, config, context }) {
        const actingUserId = context.actingUserId || await ruleOwner(companyId, context.ruleId);
        const result = await addComment(companyId, entity.id, config.body, { ...context, actingUserId });
        return { changed: result.changed, commentId: result.commentId };
    },
};
