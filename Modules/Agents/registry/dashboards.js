const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A dashboard has no catalogue entry of its own: who changes one is the dashboard routes' rule, its owner alone
// (Agents/dashboardRequests.js). What its cards show is counted from tasks, so an agent reaches dashboards only for
// a person whose role may list tasks. The action is proposeOnly, so a card is added only once that person approves it.
const ACTIONS = [
    { key: 'dashboard.card.add', label: 'Add a card to a dashboard', risk: RISK.LOW, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'only a dashboard the person behind the agent owns, or a new private one for them; only the cards the dashboard editor adds with nothing more to fill in; approved by that person alone',
      permission: { key: 'task.task_list', write: false } },
];

const RATINGS = {
    // A dashboard belongs to no project.
    'dashboard.card.add': write(SCOPE.WORKSPACE),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
