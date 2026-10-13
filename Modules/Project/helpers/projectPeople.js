const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { namedInUpdate } = require('../../../Config/companyMembers');
const { namesOnlyMembers, storedById } = require('../../../Config/namedPeopleGuard');

const PROJECT_PEOPLE = ['AssigneeUserId', 'LeadUserId', 'watchers'];

const newProjectNamesOnlyMembers = namesOnlyMembers({
    fields: PROJECT_PEOPLE,
    named: (req) => namedInUpdate(req.body, PROJECT_PEOPLE),
});

const projectUpdateNamesOnlyMembers = namesOnlyMembers({
    fields: PROJECT_PEOPLE,
    named: (req) => namedInUpdate({ [(req.body && req.body.key) || '$set']: req.body && req.body.updateObject }, PROJECT_PEOPLE),
    current: storedById(SCHEMA_TYPE.PROJECTS, PROJECT_PEOPLE)((req) => req.params.id),
});

module.exports = { PROJECT_PEOPLE, newProjectNamesOnlyMembers, projectUpdateNamesOnlyMembers };
