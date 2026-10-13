const { RISK, SCOPE, read, write, group } = require('../registryKit');
const connectorsFlag = require('../connectors/flag');

const ACTIONS = [
    { key: 'slack.message.post', label: 'Ask to send a Slack message', risk: RISK.HIGH, undoable: false, write: true, cost: 'write',
      gate: 'owner_admin', proposeOnly: true, constraint: 'only to a channel on the workspace\'s Slack allow-list; plain text, no files; never sent without a person\'s approval',
      permission: 'settings.settings_edit_company' },
    { key: 'slack.channel.read', label: 'Read recent messages of a Slack channel', risk: RISK.LOW, undoable: false, write: false, cost: 'read',
      constraint: 'only a public channel on the workspace\'s Slack allow-list for reading; text only, capped per read and per run; the run is marked and makes no web fetch after it',
      permission: { key: 'project.project_details', write: false } },
];

const RATINGS = {
    'slack.message.post': write(SCOPE.WORKSPACE, false),
    'slack.channel.read': read(SCOPE.WORKSPACE),
};

module.exports = group(connectorsFlag.slackOn, ACTIONS, RATINGS);
