const { RISK, SCOPE, read, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');

const ACTIONS = [
    { key: 'screen.link', label: 'Give the web address of a place the person can open', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
];

const RATINGS = {
    'screen.link': read(SCOPE.WORKSPACE),
};

module.exports = group(dataFlag.enabled, ACTIONS, RATINGS);
