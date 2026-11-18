const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { namedIds, namedInUpdate } = require('../../../Config/companyMembers');
const { namesOnlyMembers, storedById } = require('../../../Config/namedPeopleGuard');

const SPRINT_PEOPLE = ['AssigneeUserId', 'watchers'];

const storedSprint = storedById(SCHEMA_TYPE.SPRINTS, SPRINT_PEOPLE)((req) => req.params.id);

// A sprint create keeps `AssigneeUserId` only for a chat channel; any other sprint drops it.
const newSprintNamesOnlyMembers = namesOnlyMembers({
    fields: SPRINT_PEOPLE,
    named: (req) => (req.body && req.body.mainChat ? namedIds(req.body.AssigneeUserId) : []),
});

const sprintPatchNamesOnlyMembers = namesOnlyMembers({
    fields: SPRINT_PEOPLE,
    named: (req) => (req.body && req.body.type === 'updateSprint' ? namedInUpdate(req.body.updateObject, SPRINT_PEOPLE) : []),
    current: storedSprint,
});

const sprintUpdateNamesOnlyMembers = namesOnlyMembers({
    fields: SPRINT_PEOPLE,
    named: (req) => namedInUpdate({ [(req.body && req.body.key) || '$set']: req.body && req.body.updateObject }, SPRINT_PEOPLE),
    current: storedSprint,
});

module.exports = { SPRINT_PEOPLE, newSprintNamesOnlyMembers, sprintPatchNamesOnlyMembers, sprintUpdateNamesOnlyMembers };
