const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '052-agent-finding-project-ids', schemaType: 'AGENT_FINDINGS', field: 'projectId', noun: { one: 'agent finding', many: 'agent findings' } });
