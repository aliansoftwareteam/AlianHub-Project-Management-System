const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A field or a view shows to everyone on the project, so neither is made before a person has approved it: both are
// proposeOnly, which the registry refuses to run directly and the project's rule for agents (projectPolicy.ask) holds
// for a person. Approved, each runs the web app's own route for that create (Agents/setupRequests.js).
const ACTIONS = [
    { key: 'fields.create', label: 'Add custom fields to a project', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'only the field types the field form offers; never company-wide; a field the project already has by that name is kept',
      permission: { anyOf: ['project.project_custom_field', 'task.task_custom_field'] } },
    { key: 'view.create', label: 'Add a saved view to a project', risk: RISK.LOW, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'a copy of a view the project already has, with its own grouping, sorting, filters and columns',
      permission: { anyOf: ['project.view_list', 'project.project_details'] } },
];

const RATINGS = {
    'fields.create': write(SCOPE.PROJECT),
    'view.create': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
