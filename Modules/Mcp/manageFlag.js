// Read on every call like the other feature flags: off, the registry, the ratings
// and the MCP tool list are exactly what they were before these tools existed.
const ACTIONS = Object.freeze([
    'fields.list', 'subtasks.list', 'members.list', 'task.history', 'task.links.list',
    'task.edit', 'task.assignees.set', 'task.field.set', 'task.move', 'task.archive', 'task.restore',
    'task.status.change', 'task.add', 'subtask.add', 'comment.update', 'tasks.batch',
    'page.create', 'page.update',
]);

/* What a personal access token must have been created with to list or run these tools. A token
 * keeps the grants it was made with, so one made before the tools existed holds none. */
const GRANT = 'tasks:manage';
const DOCS_GRANT = 'docs:manage';
const GRANTS = Object.freeze([GRANT, DOCS_GRANT]);

const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_TOOLS_MANAGE || 'off').trim().toLowerCase());

const holdsGrant = (token, grant = GRANT) => Boolean(token) && !token.oauth && Array.isArray(token.grants) && token.grants.includes(grant);

/* Whether this caller's token was created to manage tasks, while the tools are on. */
const managesTasks = (ctx) => enabled() && Boolean(ctx) && Boolean(ctx.canWrite) && holdsGrant(ctx.token);

const CLOSING = 'status.set("Done")';

/* The never-list as this caller meets it: closing a task stays on it for everyone whose token was not created to manage tasks. */
const neverFor = (ctx, never) => (managesTasks(ctx) ? never.filter((entry) => entry !== CLOSING) : never);

module.exports = { ACTIONS, GRANT, DOCS_GRANT, GRANTS, enabled, holdsGrant, managesTasks, neverFor };
