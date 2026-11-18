const { RISK, SCOPE, read, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A rule runs later, on its own, with nobody watching. So an agent never makes one: the action is proposeOnly and
// only an owner or an admin may approve it, as only they may save a rule on the Automations page. Approved, it is
// saved by that page's own create route as the person who approved it (Agents/automationRequests.js).
const ACTIONS = [
    { key: 'automation.catalogue', label: 'Read what an automation can be made of', risk: RISK.LOW, undoable: false, write: false, cost: 'read', permission: 'project.project_list' },
    { key: 'automation.create', label: 'Add an automation to a project', risk: RISK.HIGH, undoable: true, write: true, cost: 'write', proposeOnly: true, gate: 'owner_admin',
      constraint: 'one project; only triggers that start from a task and steps that stay inside the workspace; never a step that runs an agent; never reacting to automation or agent changes',
      permission: 'settings.settings_edit_company' },
];

const RATINGS = {
    'automation.catalogue': read(SCOPE.WORKSPACE),
    'automation.create': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
