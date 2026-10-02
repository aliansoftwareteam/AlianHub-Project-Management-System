const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('./schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('./projectAccess');
const { TEAM_PREFIX, namedIds, nonMembersOf, foreignTeamsOf, NOT_A_MEMBER } = require('./companyMembers');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CANNOT_OPEN_PROJECT = 'A person named here cannot open this project.';
const TEAM_NOT_ON_PROJECT = 'A team named here is not on this project.';

const isTeam = (id) => id.startsWith(TEAM_PREFIX);

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

/* The `tId_` references that cannot be named on something of this project: a team of no company, a team a
 * private project is not shared with, and any team on a personal list. An open project takes every team. */
const teamsOffProject = async (companyId, projectId, refs) => {
    const named = namedIds(refs);
    if (!named.length) return [];
    const project = OBJECT_ID.test(String(projectId || '')) ? await MongoDbCrudOpration(String(companyId), {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, { isPrivateSpace: 1, AssigneeUserId: 1, isPersonal: 1 }],
    }, 'findOne') : null;
    if (!project || project.isPersonal === true) return named;
    const foreign = new Set(await foreignTeamsOf(companyId, named));
    const onProject = new Set((project.AssigneeUserId || []).map(String));
    return named.filter((ref) => foreign.has(ref) || (project.isPrivateSpace === true && !onProject.has(ref)));
};

/* namedPeopleRefusal for a field that holds people and teams together, as a list's sharing does. */
const namedOnProjectRefusal = async (companyId, projectId, ids) => {
    const named = namedIds(ids);
    const reason = await namedPeopleRefusal(companyId, projectId, named.filter((id) => !isTeam(id)));
    if (reason) return reason;
    return (await teamsOffProject(companyId, projectId, named.filter(isTeam))).length ? TEAM_NOT_ON_PROJECT : '';
};

/* For a copy that carries stored names onto a project: answers the ones who may still be named there, and
 * reads each name once however many rows carry it. */
const keptOnProject = (companyId, projectId) => {
    const verdicts = new Map();
    return async (ids) => {
        const named = namedIds(ids);
        const unknown = named.filter((id) => !verdicts.has(id));
        if (unknown.length) {
            const people = unknown.filter((id) => !isTeam(id));
            const outside = new Set(await nonMembersOf(companyId, people));
            const allowed = new Set(await peopleWhoOpen(companyId, String(projectId), people.filter((id) => !outside.has(id))));
            const refusedTeams = new Set(await teamsOffProject(companyId, projectId, unknown.filter(isTeam)));
            unknown.forEach((id) => verdicts.set(id, isTeam(id) ? !refusedTeams.has(id) : allowed.has(id)));
        }
        return named.filter((id) => verdicts.get(id));
    };
};

module.exports = { CANNOT_OPEN_PROJECT, TEAM_NOT_ON_PROJECT, peopleWhoOpen, cannotOpen, namedPeopleRefusal, teamsOffProject, namedOnProjectRefusal, keptOnProject };
