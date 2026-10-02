const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A copy of a project. It is proposeOnly, so it always waits for a person, and it is made by the route the web app
// duplicates a project with, as the person who approved (Agents/projectDuplicate.js). Taking it back is that person
// moving it to the trash: an agent has no action that deletes a project.
const ACTIONS = [
    { key: 'project.duplicate', label: 'Copy a project, with its tasks only when asked', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'made only on approval, as the approver; the person behind the agent and the approver must both be able to open the project and to create one by hand; private to the approver, whoever is on the project it is copied from; never a personal list, and never the tasks of a project the route would copy after its answer',
      permission: 'project.project_create' },
];

const RATINGS = {
    'project.duplicate': write(SCOPE.WORKSPACE),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
