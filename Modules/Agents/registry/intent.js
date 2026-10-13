const { RISK, SCOPE, read, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');

// Message to task is not an action of its own: it runs task.add, so every rule a create meets is the one it meets.
const ACTIONS = [
    { key: 'person.place', label: 'Show what the person last had open', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
];

const RATINGS = {
    'person.place': read(SCOPE.WORKSPACE),
};

module.exports = group(dataFlag.enabled, ACTIONS, RATINGS);
