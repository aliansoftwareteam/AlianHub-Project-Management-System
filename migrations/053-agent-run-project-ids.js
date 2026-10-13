const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '053-agent-run-project-ids', schemaType: 'AGENT_RUNS', field: 'projectId', noun: { one: 'agent run', many: 'agent runs' } });
