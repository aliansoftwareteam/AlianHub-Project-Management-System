const { RISK, SCOPE, write, group } = require('../registryKit');
const workFlag = require('../../Mcp/workFlag');

// A project's tags show on every task of the project, so a new one is proposeOnly: it waits for a person, and once
// approved it is added by the project's own tag route as the person behind the agent (Agents/tagRequests.js).
const ACTIONS = [
    { key: 'tag.create', label: 'Add a tag to a project', risk: RISK.LOW, undoable: true, write: true, cost: 'write', proposeOnly: true,
      constraint: 'made only on approval; one tag by a name the project does not have yet; undo removes it only while no task carries it',
      permission: 'task.task_tag' },
];

const RATINGS = {
    'tag.create': write(SCOPE.PROJECT),
};

module.exports = group(workFlag.enabled, ACTIONS, RATINGS);
