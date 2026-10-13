const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '050-call-project-ids', schemaType: 'CALLS', field: 'projectId', noun: { one: 'call note', many: 'call notes' } });
