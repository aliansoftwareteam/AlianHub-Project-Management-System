const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// One plan for a project that exists: statuses, lists, fields and views, then automations and first tasks. It is
// proposeOnly, so it always waits for a person, and its keys are those of its parts: holding one is enough to send a
// plan, and each part is then held to its own keys for the person behind the agent and for the approver
// (Agents/projectSetup.js). An automation or a first task is made as its own action, with that action's own
// checks (Agents/planWork.js), so those are not keys of this one.
const ACTIONS = [
    { key: 'project.setup', label: 'Set up a project', risk: RISK.MEDIUM, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'only a project that exists; statuses, lists, fields and views, each made by the web app\'s own route; a part the person or the approver may not make by hand is not made; an automation or a first task is made as its own action, only where that action could be asked for alone',
      permission: { anyOf: ['project.project_details', 'project.project_sprint_create', 'project.project_custom_field', 'task.task_custom_field', 'project.view_list'] } },
];

const RATINGS = {
    'project.setup': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
