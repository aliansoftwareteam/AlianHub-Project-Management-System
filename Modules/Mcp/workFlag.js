// Read on every call like the other feature flags: off, the registry, the ratings
// and the MCP tool list are exactly what they were before these tools existed.
const ACTIONS = Object.freeze([
    'tags.list', 'task.tags.add', 'task.tags.remove',
    'task.relations.list', 'task.relation.add', 'task.relation.remove',
    'lists.list', 'list.create', 'list.rename', 'list.move',
    'page.comments.list', 'page.comment.create', 'page.comment.reply', 'page.comment.assign',
]);

const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_TOOLS_WORK || 'off').trim().toLowerCase());

module.exports = { ACTIONS, enabled };
