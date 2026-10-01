// Read on every call like the other feature flags: off, the registry, the ratings
// and the MCP tool list are exactly what they were before these tools existed.
const ACTIONS = Object.freeze([
    'fields.list', 'subtasks.list', 'members.list',
    'task.edit', 'task.assignees.set', 'task.field.set', 'task.move', 'task.archive', 'task.restore',
]);

/* What a personal access token must have been created with to list or run the write tools. A token
 * keeps the grants it was made with, so one made before these tools existed holds none. */
const GRANT = 'tasks:manage';

const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_TOOLS_MANAGE || 'off').trim().toLowerCase());

const holdsGrant = (token) => Boolean(token) && !token.oauth && Array.isArray(token.grants) && token.grants.includes(GRANT);

module.exports = { ACTIONS, GRANT, enabled, holdsGrant };
