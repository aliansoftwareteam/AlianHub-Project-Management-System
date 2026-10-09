const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { canReadProject } = require('../../Config/projectAccess');
const { readableTaskIds } = require('../Tasks/helpers/taskWritePlacement');
const { canSeeSprintById } = require('../Sprints/helpers/sprintVisibility');
const { pageReachedBy } = require('../Pages/helpers/pageRules');
const access = require('./access');
const projectPolicy = require('./projectPolicy');
const planFiling = require('./planFiling');

// What the proposal route asks of a proposal beside who files it. Once approved its changes run on the approver's
// rights, so it names nothing the person behind the filing token could not open themselves, and a plan in it is
// asked what a connected agent's plan is asked (./planFiling.js).

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASKS = ['taskId', 'relatedTaskId', 'countedTaskId'];
const PROJECTS = ['projectId', 'listProjectId', 'sourceProjectId'];
const LISTS = ['sprintId', 'moveListIds', 'countedListId'];
const PAGES = ['pageId', 'parentPageId'];
const FOLDERS = ['folderId', 'parentFolderId'];
const COMMENTS = ['commentId'];
const FIELDS = ['fieldId'];
const GOALS = ['goalId'];
const COUNTED = Object.freeze({ list: 'countedListId', task: 'countedTaskId' });
const PROJECT_COPY = 'project.duplicate';

const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const listOf = (value) => (Array.isArray(value) ? value : []);
const changesOf = (body) => listOf(body.changes).map((change) => ({ action: change && change.action, params: plain(change && change.params) }));
const stored = (companyId, type, id, fields) => MongoDbCrudOpration(companyId, { type, data: [{ _id: new mongoose.Types.ObjectId(id) }, fields] }, 'findOne');

/* The ids a change names, with those inside its parts brought up beside its own: the lists the subfolders of a new
 * folder take in, and the list or task a goal's target counts. */
const namedBy = ({ params }) => ({
    ...params,
    moveListIds: [params, ...listOf(params.subfolders).map(plain)].flatMap((folder) => listOf(folder.moveListIds)),
    ...(params.goalId !== undefined && Object.hasOwn(COUNTED, String(params.kind)) ? { [COUNTED[params.kind]]: params.sourceId } : {}),
});

const namedUnder = (body, keys) => [...new Set([body, ...changesOf(body).map(namedBy)]
    .flatMap((params) => keys.flatMap((key) => params[key]))
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value).toLowerCase()))];

/* The people a saved view is kept to, each with the project it is a view of: a view on its own, or a view of a plan. */
const viewPeopleOf = (body) => changesOf(body).flatMap(({ params }) => [params.look, ...listOf(params.views).map((view) => plain(view).look || view)]
    .flatMap((look) => listOf(plain(look).assigneeIds))
    .map((userId) => ({ projectId: String(params.projectId || ''), userId: String(userId) })));

/* A list is open where its project is and, short of an owner or admin, where the person is on it when it is private. */
const opensList = async (companyId, caller, listId) => {
    const list = await stored(companyId, SCHEMA_TYPE.SPRINTS, listId, { projectId: 1 });
    if (!list || !(await canReadProject(companyId, caller.actor.userId, String(list.projectId))).allowed) return false;
    return caller.privileged || canSeeSprintById(companyId, caller.actor.userId, listId);
};

const opensPage = async (companyId, uid, pageId) => {
    const page = await stored(companyId, SCHEMA_TYPE.PAGES, pageId, { ProjectID: 1, visibility: 1, createdBy: 1, sharedWith: 1 });
    if (!page) return false;
    const inProject = page.ProjectID ? (await canReadProject(companyId, uid, String(page.ProjectID))).allowed : false;
    return pageReachedBy(page, { uid, inProject: () => inProject });
};

const opensFolder = async (companyId, uid, folderId) => {
    const folder = await stored(companyId, SCHEMA_TYPE.FOLDERS, folderId, { projectId: 1 });
    return Boolean(folder) && (await canReadProject(companyId, uid, String(folder.projectId))).allowed;
};

/* A comment is open where the task or the doc it is on is. */
const opensComment = async (companyId, uid, commentId) => {
    const onTask = await stored(companyId, SCHEMA_TYPE.COMMENTS, commentId, { taskId: 1 });
    const taskId = String((onTask && onTask.taskId) || '');
    if (onTask) return OBJECT_ID.test(taskId) && (await readableTaskIds(companyId, uid, [taskId])).length === 1;
    const onPage = await stored(companyId, SCHEMA_TYPE.PAGE_COMMENTS, commentId, { pageId: 1 });
    const pageId = String((onPage && onPage.pageId) || '');
    return OBJECT_ID.test(pageId) && opensPage(companyId, uid, pageId);
};

/* A custom field is open where it is the whole workspace's, or where a project it belongs to is. */
const opensField = async (companyId, uid, fieldId) => {
    const field = await stored(companyId, SCHEMA_TYPE.CUSTOM_FIELDS, fieldId, { global: 1, projectId: 1 });
    if (!field) return false;
    if (field.global === true) return true;
    for (const projectId of [].concat(field.projectId || []).map(String).filter((id) => OBJECT_ID.test(id))) {
        if ((await canReadProject(companyId, uid, projectId)).allowed) return true;
    }
    return false;
};

/* A goal is open where the goal screen shows it to the person. */
const opensGoal = (companyId, uid, goalId) => require('./goalRequests').goalFor({ companyId, uid, goalId }).then(Boolean, () => false);

const every = async (ids, opens) => {
    for (const id of ids) {
        if (!OBJECT_ID.test(id) || !(await opens(id))) return false;
    }
    return true;
};

/* A view is kept only to people who can be assigned in its project. */
const viewPeopleOpen = async (companyId, body) => {
    const { assignable } = require('./taskRequests');
    for (const { projectId, userId } of viewPeopleOf(body)) {
        if (!(await assignable(companyId, projectId, [userId]).then(() => true, () => false))) return false;
    }
    return true;
};

/* What approval asks of the person behind a connected agent for each change (Mcp/approval.js), asked of the filer's
 * person here: the project a copy is made from, and a list that is one of the project it is named with. */
const reachesTargets = async (companyId, uid, body) => {
    const approval = require('../Mcp/approval');
    const asked = new Set();
    for (const { action, params } of changesOf(body)) {
        if (action === PROJECT_COPY && !params.sourceProjectId) return false;
        const target = approval.targetOf(params, action);
        const key = JSON.stringify(target);
        if (asked.has(key)) continue;
        asked.add(key);
        if (!(await approval.reachable(companyId, { userId: String(uid), projectIds: [] }, target))) return false;
    }
    return true;
};

/* Whether the person can open everything the proposal names: each task, project, list, doc, folder, comment, custom
 * field and goal, and the people a view is kept to. A missing one and a hidden one answer alike. */
const namesOnlyOpenThings = async (companyId, uid, body) => {
    const tasks = namedUnder(body, TASKS);
    if (!tasks.every((id) => OBJECT_ID.test(id)) || (await readableTaskIds(companyId, uid, tasks)).length !== tasks.length) return false;
    const caller = await access.personOf(companyId, uid);
    return await every(namedUnder(body, PROJECTS), async (id) => (await canReadProject(companyId, uid, id)).allowed)
        && await every(namedUnder(body, LISTS), (id) => opensList(companyId, caller, id))
        && await every(namedUnder(body, PAGES), (id) => opensPage(companyId, uid, id))
        && await every(namedUnder(body, FOLDERS), (id) => opensFolder(companyId, uid, id))
        && await every(namedUnder(body, COMMENTS), (id) => opensComment(companyId, uid, id))
        && await every(namedUnder(body, FIELDS), (id) => opensField(companyId, uid, id))
        && await every(namedUnder(body, GOALS), (id) => opensGoal(companyId, uid, id))
        && await viewPeopleOpen(companyId, body)
        && reachesTargets(companyId, uid, body);
};

const projectsOf = async (companyId, type, ids, field) => (ids.length
    ? ((await MongoDbCrudOpration(companyId, { type, data: [{ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } }, { [field]: 1 }] }, 'find')) || []).map((row) => row[field])
    : []);

/* An agent that works in some projects files nothing that reaches another: not a project the proposal names, nor
 * the project of a task, list or doc it names. A doc that belongs to no project reaches none. */
const insideAgentScope = async (companyId, agent, body) => {
    const scope = (agent.projectIds || []).map((id) => String(id).toLowerCase());
    if (!scope.length) return true;
    const reached = (await Promise.all([
        namedUnder(body, PROJECTS),
        projectsOf(companyId, SCHEMA_TYPE.TASKS, namedUnder(body, TASKS), 'ProjectID'),
        projectsOf(companyId, SCHEMA_TYPE.SPRINTS, namedUnder(body, LISTS), 'projectId'),
        projectsOf(companyId, SCHEMA_TYPE.PAGES, namedUnder(body, PAGES), 'ProjectID'),
    ])).flat().filter(Boolean);
    return reached.every((id) => scope.includes(String(id).toLowerCase()));
};

/* The run a proposal is filed from is the filing agent's own, and one its person can open. */
const ownRun = async (companyId, uid, agentId, runId) => {
    if (!OBJECT_ID.test(String(runId || ''))) return false;
    const run = await stored(companyId, SCHEMA_TYPE.AGENT_RUNS, String(runId), {});
    if (!run || String(run.agentId) !== String(agentId)) return false;
    return access.canSeeRun(companyId, await access.personOf(companyId, uid), run);
};

/* The first change a project refuses outright, a paused project's for one, with the reason; null when every change may wait for a person. */
const refusedChange = async (companyId, actor, body) => {
    for (const { action, params } of changesOf(body)) {
        const rule = await projectPolicy.ask({ companyId, actor, action, params });
        if (rule.decision === projectPolicy.DECISION.REFUSE) return { action, params, reason: rule.reason };
    }
    return null;
};

/* The first plan among the changes that cannot be filed: { error } for one that could not be made as written,
 * { action, params, reason } for one its agent's person could not ask for; null when none is stopped. */
const stoppedPlan = async (companyId, actor, agent, body) => {
    for (const { action, params } of changesOf(body)) {
        const stopped = await planFiling.stoppedFor({ companyId, actor, uid: actor.userId, allowedActions: agent.allowedActions, action, params });
        if (stopped) return stopped.refused ? { action, params, reason: stopped.refused } : { error: stopped.error };
    }
    return null;
};

/* A gate is what the changes carry; the filer may ask for the stricter one, never for a lighter one. */
const gateAsked = (gate) => (gate === access.GATE_OWNER_ADMIN ? gate : undefined);

module.exports = { namesOnlyOpenThings, insideAgentScope, ownRun, refusedChange, stoppedPlan, gateAsked };
