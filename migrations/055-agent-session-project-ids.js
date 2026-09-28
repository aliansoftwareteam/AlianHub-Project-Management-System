const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '055-agent-session-project-ids', schemaType: 'AGENT_SESSIONS', field: 'projectId', noun: { one: 'agent session', many: 'agent sessions' } });
