const { textIdFieldsMigration } = require('./lib/textIdFields');

module.exports = textIdFieldsMigration({ id: '058-history-project-ids', schemaType: 'HISTORY', fields: ['ProjectId'], noun: { one: 'history entry', many: 'history entries' } });
