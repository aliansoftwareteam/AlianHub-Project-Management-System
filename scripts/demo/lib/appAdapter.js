const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('./ids');
const { AGENT_AUTONOMY, AGENT_SPEND_CAP_USD, SESSION_SECONDS } = require('./team');

const DAY_MS = 24 * 60 * 60 * 1000;
const SIDE_EFFECT_SETTLE_MS = 5000;

const plain = (doc) => JSON.parse(JSON.stringify(doc));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Several app helpers resolve before their last write lands: the project's List sprint, a task's key and index.
async function waitFor(probe, what, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await probe();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
        await sleep(250);
    }
}

const markDemo = (companyId, type, id) => MongoDbCrudOpration(companyId, {
    type,
    data: [{ _id: String(id) }, { $set: { demo: true } }],
}, 'updateOne');

const callbackResult = (fn, ...args) => new Promise((resolve, reject) => {
    fn(...args, (result) => (result && result.status ? resolve(result) : reject(new Error((result && result.message) || 'The app refused the request.'))));
});

const viaHandler = (handler, { companyId, uid, body }) => new Promise((resolve, reject) => {
    const res = {
        status() { return res; },
        send(payload) {
            if (payload && payload.status) resolve(payload.data);
            else reject(new Error((payload && payload.statusText) || 'The app refused the request.'));
        },
    };
    Promise.resolve(handler({ headers: { companyid: companyId }, uid, body }, res)).catch(reject);
});

async function createUser({ companyId, person, password }) {
    const { addUserMongodbV2 } = require('../../../Modules/Auth/controller/createUser');
    const { updateUserFun } = require('../../../Modules/Users/controller');
    const created = await addUserMongodbV2({
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        password,
        assignCompany: companyId,
        isInvitation: true,
    });
    const userId = String(created.statusText._id);
    await updateUserFun(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: userId }, { $set: { demo: true } }],
    }, 'updateOne', companyId, userId);
    return userId;
}

async function addMember({ companyId, userId, email, roleType, designation }) {
    const { updateMemberFunction } = require('../../../Modules/settings/Members/controller');
    const { addAndRemoveUserInMongodbNotificationCount } = require('../../../Modules/Auth/controller');
    const { importUserNotifications } = require('../../../utils/data');

    const member = await updateMemberFunction(companyId, {
        companyId,
        userId,
        isDelete: false,
        roleType,
        status: 2,
        userEmail: email,
        designation,
        linkId: '',
        sendInvitationTime: Date.now(),
        demo: true,
    }, 'save');
    const counter = await addAndRemoveUserInMongodbNotificationCount(companyId, userId, 'Add');
    await importUserNotifications(companyId, userId);
    const settings = await waitFor(() => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.NOTIFICATIONS_SETTINGS,
        data: [{ userId }, { _id: 1 }],
    }, 'findOne'), `notification settings for ${email}`);

    return {
        companyUserId: String(member.data._id),
        userIdCountId: counter && counter.statusText ? String(counter.statusText._id) : null,
        notificationSettingsId: String(settings._id),
    };
}

async function createProject({ companyId, creatorId, memberIds, project }) {
    const { projectRequestFromTemplates } = require('../../../Modules/Setup/demoProject');
    const { createProject: create } = require('../../../Modules/createProject/controller');

    const req = await projectRequestFromTemplates(companyId, creatorId, {
        ProjectName: project.name,
        ProjectCode: project.code,
        TemplateName: project.name,
        AssigneeUserId: memberIds,
        LeadUserId: [creatorId],
        includeSampleTasks: false,
        demo: true,
    });
    const created = await create(req);
    const projectId = String(created.data._id);
    const list = await waitFor(() => MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: new mongoose.Types.ObjectId(projectId) }, { _id: 1 }],
    }, 'findOne'), `the List sprint of ${project.name}`);
    await markDemo(companyId, SCHEMA_TYPE.SPRINTS, list._id);
    return { projectId, listSprintId: String(list._id) };
}

async function createSprint({ companyId, projectId, projectName, actor, sprint }) {
    const { addSprintFun } = require('../../../Modules/Sprints/controller');
    const scrum = require('../../../Modules/Sprints/scrum');
    const scrumRules = require('../../../Modules/Sprints/scrumRules');

    const added = await addSprintFun({
        body: { companyId, projectId, sprintName: sprint.name, projectName, userData: actor, folder: { folderId: '', folderName: '' } },
    });
    if (!added || !added.status) throw new Error(`Sprint "${sprint.name}" was not created: ${(added && added.statusText) || 'unknown error'}`);
    const sprintId = String(added.data._id);
    await markDemo(companyId, SCHEMA_TYPE.SPRINTS, sprintId);

    const window = scrumRules.computeWindow({ lengthDays: sprint.lengthDays }, new Date());
    await viaHandler(scrum.setScrum, {
        companyId,
        uid: actor.id,
        body: { sprintId, isScrum: true, goal: sprint.goal, startDate: window.startDate, endDate: window.endDate },
    });
    return sprintId;
}

async function startSprint({ companyId, sprintId, actorId }) {
    const scrum = require('../../../Modules/Sprints/scrum');
    await viaHandler(scrum.startSprint, { companyId, uid: actorId, body: { sprintId } });
}

async function createTask({ companyId, project, sprint, actor, ownerId, task, leaderId, assigneeIds }) {
    const { taskMongo } = require('../../../Modules/Tasks/helpers/task_class_Mongo');

    const statuses = (project.taskStatusData || []).map((s) => (s && s.convertStatus ? s.convertStatus : s)).filter(Boolean);
    const status = statuses.find((s) => String(s.name).toLowerCase() === task.status.toLowerCase())
        || statuses.find((s) => s.type === 'default_active')
        || statuses[0];
    const taskTypes = project.taskTypeCounts || [];
    const taskType = taskTypes.find((t) => String(t.name).toLowerCase() === 'task') || taskTypes[0] || { name: 'task', key: 1 };
    const dueDate = Number.isFinite(task.dueInDays) ? new Date(Date.now() + task.dueInDays * DAY_MS).toISOString() : '';
    const sprintId = String(sprint._id);

    const data = {
        _id: String(new mongoose.Types.ObjectId()),
        TaskName: task.name,
        TaskKey: '-',
        description: task.description,
        rawDescription: task.description,
        AssigneeUserId: assigneeIds,
        watchers: [...new Set([leaderId, ...assigneeIds])],
        DueDate: dueDate,
        dueDateDeadLine: dueDate ? [{ date: dueDate }] : [],
        TaskType: taskType.name,
        TaskTypeKey: taskType.key,
        ParentTaskId: '',
        ProjectID: String(project._id),
        CompanyId: companyId,
        status: { text: status.name, key: status.key, type: status.type },
        statusType: status.type,
        statusKey: status.key,
        isParentTask: true,
        Task_Leader: leaderId,
        Task_Priority: task.priority,
        sprintId,
        sprintArray: { ...plain(sprint), id: sprintId },
        deletedStatusKey: 0,
        demo: true,
    };

    const result = await taskMongo.create({
        data,
        user: { Employee_Name: actor.Employee_Name, id: actor.id, companyOwnerId: ownerId },
        projectData: plain(project),
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(status.key) },
    });
    if (!result || !result.status) {
        throw new Error(`Task "${task.name}" was not created: ${(result && (result.statusText || result.message)) || 'unknown error'}`);
    }
    await waitFor(async () => {
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: data._id }, { TaskKey: 1 }] }, 'findOne');
        return Boolean(saved && saved.TaskKey && saved.TaskKey !== '-');
    }, `the key of "${task.name}"`);
    return String(result.id || data._id);
}

async function createAgent({ companyId, projectId, ownerId, agent }) {
    const { createAgentRecord } = require('../../../Modules/Agents/agentRecord');
    const skillRecord = require('../../../Modules/Agents/skillRecord');
    const { effectiveActions } = require('../../../Modules/Agents/skills/effectiveActions');
    const { normaliseSkill } = require('../../../Modules/Agents/controller');

    const skill = normaliseSkill(agent.skill);
    const problems = await skillRecord.checkAgentSkills(companyId, [skill]);
    if (problems.length) throw new Error(`${agent.name}: ${problems.map((p) => p.message).join('; ')}`);
    const allowedActions = effectiveActions(null, await skillRecord.getSkill(companyId, skill.key));

    const saved = await createAgentRecord(companyId, {
        name: agent.name,
        description: agent.description,
        skills: [skill],
        allowedActions,
        projectIds: [projectId],
        autonomy: AGENT_AUTONOMY,
        spendCapUsd: AGENT_SPEND_CAP_USD,
        demo: true,
    }, { ownerId });
    const revisions = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENT_REVISIONS,
        data: [{ agentId: String(saved._id) }, { _id: 1 }],
    }, 'find');
    return { agentId: String(saved._id), revisionIds: (revisions || []).map((r) => String(r._id)), allowedActions };
}

/* History and notifications written by the create paths above, limited to this run so a
 * re-run never adopts what people did in the sandbox since. */
async function collectSideRecords({ companyId, projectId, since }) {
    await sleep(SIDE_EFFECT_SETTLE_MS);
    const inProject = { $in: idForms(projectId) };
    const idsOf = async (db, type, filter) => ((await MongoDbCrudOpration(db, {
        type,
        data: [{ ...filter, createdAt: { $gte: since } }, { _id: 1 }],
    }, 'find')) || []).map((row) => String(row._id));

    return {
        history: await idsOf(companyId, SCHEMA_TYPE.HISTORY, { ProjectId: inProject }),
        notifications: await idsOf(companyId, SCHEMA_TYPE.NOTIFICATIONS, { projectId: inProject }),
        globalNotifications: await idsOf(dbCollections.GLOBAL, dbCollections.NOTIFICATIONS, { projectId: inProject }),
    };
}

/* The same two calls a password login makes (Modules/Auth/controller/loginSession.js
 * finalizeSession), with both lifetimes cut to SESSION_SECONDS. */
async function issueSession(userId) {
    const { insertSessionFun } = require('../../../Modules/Auth/session');
    const { generateTokenV2Fun } = require('../../../Modules/Auth/controller/authHelpers');

    process.env.SESSIONEXPIREDTIME = String(SESSION_SECONDS);
    process.env.JWT_EXP = `${SESSION_SECONDS}s`;

    const session = await callbackResult(insertSessionFun, { userId }, 'alianhub-demo-token', '127.0.0.1');
    const login = await callbackResult(generateTokenV2Fun, userId, session.data.refreshToken);
    return { accessToken: login.token, sessionId: String(session.data._id) };
}

module.exports = {
    createUser,
    addMember,
    createProject,
    createSprint,
    startSprint,
    createTask,
    createAgent,
    collectSideRecords,
    issueSession,
};
