const { isOn } = require('./defaultOn');

// Read on every call like the other feature flags: an explicit off leaves the registry, the ratings
// and the MCP tool list exactly what they were before these tools existed.
const ACTIONS = Object.freeze([
    'projects.list', 'project.get', 'sprints.list', 'statuses.list', 'views.list', 'comments.list',
    'pages.search', 'page.get', 'page.versions.list', 'page.version.get', 'timesheet.read', 'comment.create', 'timelog.create',
]);

const enabled = () => isOn(process.env.MCP_TOOLS_DATA);

module.exports = { ACTIONS, enabled };
