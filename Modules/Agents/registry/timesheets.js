const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// The person's own timesheet week (Agents/timesheetWeek.js). Sending it for approval cannot be taken back by the
// person once sent, so it always waits for them, and they alone approve it. Reviewing anyone's week has no action.
const ACTIONS = [
    { key: 'timesheet.week', label: 'Read where the person\'s timesheet week stands', risk: RISK.LOW, undoable: false, write: false, cost: 'read',
      permission: { key: 'sheet_settings.user_timesheet', write: false } },
    { key: 'timesheet.week.submit', label: 'Send the person\'s timesheet week for approval', risk: RISK.MEDIUM, undoable: false, write: true, cost: 'write', proposeOnly: true,
      constraint: 'only the person\'s own week, approved by that person alone; approving, sending back or reopening a week is never an agent\'s',
      permission: 'sheet_settings.user_timesheet' },
];

const RATINGS = {
    // A week covers every project the person logged time in.
    'timesheet.week': read(SCOPE.WORKSPACE),
    'timesheet.week.submit': write(SCOPE.WORKSPACE, false),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
