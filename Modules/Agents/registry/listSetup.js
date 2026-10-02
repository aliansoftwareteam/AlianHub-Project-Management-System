const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A folder with its lists, and a list made a sprint, show to everyone on the project. Both are proposeOnly, so they
// always wait for a person, and each is made by the web app's own route as the person who approved (Agents/listSetup.js).
const ACTIONS = [
    { key: 'folder.create', label: 'Create a folder, with lists made in it or moved into it', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'made only on approval, as the approver; a list is made or moved only where the person behind the agent and the approver may both do that by hand; folders nest one level',
      permission: 'project.project_folder_create' },
    { key: 'list.sprint.set', label: 'Make a list a sprint, or change a sprint\'s dates', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'made only on approval, as the approver, through the route the list menu calls; never a chat channel, a backlog or a completed sprint',
      permission: 'project.project_sprint_create' },
];

const RATINGS = {
    'folder.create': write(SCOPE.PROJECT),
    'list.sprint.set': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
