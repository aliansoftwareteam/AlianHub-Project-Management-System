const { textProjectIdsMigration } = require('./lib/textProjectIds');

module.exports = textProjectIdsMigration({ id: '049-project-rule-project-ids', schemaType: 'PROJECT_RULES', field: 'projectId', noun: { one: 'project rule', many: 'project rules' } });
