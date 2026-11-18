const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '051-dashboard-project-ids', schemaType: 'USERDASHBOARD', field: 'projectId', noun: { one: 'dashboard', many: 'dashboards' } });
