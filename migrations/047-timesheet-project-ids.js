const { timeProjectIdsMigration } = require('./lib/timeProjectIds');

module.exports = timeProjectIdsMigration({ id: '047-timesheet-project-ids', schemaType: 'TIMESHEET', noun: { one: 'time log', many: 'time logs' } });
