const { RISK, SCOPE, read, group } = require('../registryKit');
const performanceFlag = require('../performanceFlag');

const ACTIONS = [
    { key: performanceFlag.ACTION, label: 'Read project performance numbers', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_details' },
];

const RATINGS = {
    [performanceFlag.ACTION]: read(SCOPE.PROJECT),
};

module.exports = group(performanceFlag.enabled, ACTIONS, RATINGS);
