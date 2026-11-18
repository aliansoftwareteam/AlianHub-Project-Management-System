const { textIdFieldsMigration } = require('./lib/textIdFields');

module.exports = textIdFieldsMigration({ id: '060-mention-ids', schemaType: 'MENTIONS', fields: ['projectId', 'sprintId', 'folderId'], noun: { one: 'mention', many: 'mentions' } });
