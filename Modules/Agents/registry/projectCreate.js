const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A new project, with or without a plan for it. It is proposeOnly, so it always waits for a person, and it is made
// by the web app's own create route as the person who approved (Agents/projectCreate.js). Taking it back is that
// person moving it to the trash: an agent has no action that deletes a project.
const ACTIONS = [
    { key: 'project.create', label: 'Create a project', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'made only on approval, as the approver, who must be allowed to create a project by hand; private to the approver at first; each part of the plan is held to the keys project.setup holds it to',
      permission: 'project.project_create' },
];

const RATINGS = {
    'project.create': write(SCOPE.WORKSPACE),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
