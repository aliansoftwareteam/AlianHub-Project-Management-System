const { textIdFieldsMigration } = require('./lib/textIdFields');

module.exports = textIdFieldsMigration({ id: '059-notification-ids', schemaType: 'NOTIFICATIONS', fields: ['projectId', 'sprintId', 'folderId'], noun: { one: 'notification', many: 'notifications' } });
