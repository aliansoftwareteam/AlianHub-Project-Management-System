const { RISK, SCOPE, read, group } = require('../registryKit');
const dataFlag = require('../../Mcp/dataFlag');
const appConnectionsFlag = require('../../Integrations/appConnections/flag');

const ACTIONS = [
    { key: 'pull_request.get', label: 'Read a GitHub pull request linked to a task', risk: RISK.LOW, undoable: false, write: false, cost: 'read',
      constraint: 'only a pull request of the repository the workspace connected on App connections, linked to a project the person can open; the GitHub key is used on the server and never shown',
      permission: 'task.task_list' },
];

const RATINGS = {
    'pull_request.get': read(SCOPE.TASK),
};

module.exports = group(() => dataFlag.enabled() && appConnectionsFlag.enabled(), ACTIONS, RATINGS);
