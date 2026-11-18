const { RISK, SCOPE, read, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');

const ACTIONS = [
    { key: 'screen.link', label: 'Give a link to a place in AlianHub', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
];

const RATINGS = {
    'screen.link': read(SCOPE.WORKSPACE),
};

module.exports = group(dataFlag.enabled, ACTIONS, RATINGS);
