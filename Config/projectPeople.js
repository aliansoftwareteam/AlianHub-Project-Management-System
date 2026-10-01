const { canReadProject } = require('./projectAccess');

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

module.exports = { CANNOT_OPEN_PROJECT, peopleWhoOpen, cannotOpen };
