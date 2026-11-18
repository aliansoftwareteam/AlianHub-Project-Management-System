const { timeProjectIdsMigration } = require('./lib/timeProjectIds');

module.exports = timeProjectIdsMigration({ id: '048-estimate-project-ids', schemaType: 'ESTIMATES_TIME', noun: { one: 'time plan', many: 'time plans' } });
