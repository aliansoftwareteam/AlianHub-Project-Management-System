// Read on every call like the other feature flags: off, the registry, the ratings
// and the MCP tool list are exactly what they were before these tools existed.
const ACTIONS = Object.freeze([
    'projects.list', 'project.get', 'sprints.list', 'statuses.list', 'comments.list',
    'pages.search', 'page.get', 'timesheet.read', 'comment.create', 'timelog.create',
]);

const enabled = () => ['on', 'true', '1'].includes(String(process.env.MCP_TOOLS_DATA || 'off').trim().toLowerCase());

module.exports = { ACTIONS, enabled };
