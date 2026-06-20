// REP-07 — built-in, reusable custom-report templates. A template is just a
// pre-filled REP-02 config; every template is validated through reportRules so
// it can never carry an unsupported dimension / metric / chart type. Pure (no
// DB, no I/O). Unit-tested in tests/report-templates.test.js.

const { validateConfig } = require('./reportRules');

const RAW = [
    { key: 'tasks_by_status', name: 'Tasks by status', description: 'Task count grouped by status.', config: { source: 'tasks', dimension: 'status', metric: 'count', chartType: 'bar', filters: {} } },
    { key: 'tasks_by_project', name: 'Tasks by project', description: 'Task count grouped by project.', config: { source: 'tasks', dimension: 'project', metric: 'count', chartType: 'table', filters: {} } },
    { key: 'tasks_by_sprint', name: 'Tasks by sprint', description: 'Task count grouped by sprint.', config: { source: 'tasks', dimension: 'sprint', metric: 'count', chartType: 'bar', filters: {} } },
    { key: 'points_by_sprint', name: 'Story points by sprint', description: 'Story points grouped by sprint.', config: { source: 'tasks', dimension: 'sprint', metric: 'points', chartType: 'bar', filters: {} } },
    { key: 'points_by_project', name: 'Story points by project', description: 'Story points grouped by project.', config: { source: 'tasks', dimension: 'project', metric: 'points', chartType: 'bar', filters: {} } },
];

// Only surface templates whose config validates — guards against a typo ever
// shipping a broken template to the UI.
const listTemplates = () => RAW
    .map((t) => {
        const c = validateConfig(t.config);
        return c.valid ? { key: t.key, name: t.name, description: t.description, config: c.value } : null;
    })
    .filter(Boolean);

const getTemplate = (key) => listTemplates().find((t) => t.key === String(key)) || null;

module.exports = { listTemplates, getTemplate };
