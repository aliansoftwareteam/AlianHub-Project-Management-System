const { canReadProject } = require('./projectAccess');
const { namedIds, nonMembersOf, NOT_A_MEMBER } = require('./companyMembers');

const CANNOT_OPEN_PROJECT = 'A person named here cannot open this project.';

/* The people who may be named on a project's work, as the assignee picker offers them: everyone on a public
 * project, its people and teams, owners and admins on a private one, and the owner alone on a personal list. */
const peopleWhoOpen = async (companyId, projectId, userIds) => {
    const kept = [];
    for (const id of userIds) {
        if ((await canReadProject(companyId, id, projectId)).allowed) kept.push(id);
    }
    return kept;
};

const cannotOpen = async (companyId, projectId, userIds) => (await peopleWhoOpen(companyId, projectId, userIds)).length !== userIds.length;

/* Why the people a write names cannot be put on something of this project, or '' when each holds a live seat
 * and can open it: the rule a task's assignees follow, for everything else that stores a person. */
const namedPeopleRefusal = async (companyId, projectId, userIds) => {
    const named = namedIds(userIds);
    if (!named.length) return '';
    if ((await nonMembersOf(companyId, named)).length) return NOT_A_MEMBER;
    return projectId && await cannotOpen(companyId, String(projectId), named) ? CANNOT_OPEN_PROJECT : '';
};

module.exports = { CANNOT_OPEN_PROJECT, peopleWhoOpen, cannotOpen, namedPeopleRefusal };
