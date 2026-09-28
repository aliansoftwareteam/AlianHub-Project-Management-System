const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '054-agent-proposal-project-ids', schemaType: 'AGENT_PROPOSALS', field: 'projectId', noun: { one: 'agent proposal', many: 'agent proposals' } });
