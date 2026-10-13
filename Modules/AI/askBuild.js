const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { evaluatePermission, isWritable } = require('../../Config/permissionGuard');
const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const { nonMembersOf } = require('../../Config/companyMembers');
const { hiddenSprintFilter, TEAM_PREFIX } = require('../Sprints/helpers/sprintVisibility');
const { sprintPlacementOf } = require('../Tasks/helpers/sprintPlacement');
const { prepareTaskRequest, TASK_ACTION_FIELDS, TaskWriteRefusal } = require('../Tasks/helpers/taskWriteFields');
const { openProjects, tokenProjectIdsOf } = require('./ask');

// Building from an Ask answer: the preview reads what the asker may do in a project, and each ticked
// item is created exactly as POST /api/v2/tasks creates one — the same route guard, the same payload
// preparation (field allow-list, members only, company pinned to the header) and taskMongo.create, which
// writes the history, the notifications, the socket event, the list count and the task key.

const MAX_ITEMS = 20;
const TITLE_MIN = 3;
const TITLE_MAX = 250;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const fail = (res, statusCode, code, statusText) => res.status(statusCode).send({ status: false, code, statusText });

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const callerOf = (req, res) => {
    let companyId;
    try {
        companyId = sessionTenantOf(req);
    } catch (error) {
        if (error instanceof TenantError) {
            fail(res, error.statusCode || 403, 'company_mismatch', error.message);
            return null;
        }
        throw error;
    }
    const uid = req.uid ? String(req.uid) : '';
    if (!uid) {
        fail(res, 401, 'unauthenticated', 'A signed-in user is required.');
        return null;
    }
    return { companyId, uid };
};

const allows = async (companyId, uid, key, projectId) => isWritable(await evaluatePermission(companyId, uid, key, { projectId, strict: true }).catch(() => null));

/* The project, when the asker can open it; null answers 404 without saying whether it exists. */
const openProject = async (req, companyId, uid, projectId) => {
    if (!OBJECT_ID.test(String(projectId || ''))) return null;
    const open = await openProjects(companyId, uid, tokenProjectIdsOf(req));
    if (!open.some((p) => String(p._id) === String(projectId))) return null;
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: oid(projectId), deletedStatusKey: { $ne: 1 } }] }, 'findOne').catch(() => null);
};

const listsOf = async (companyId, uid, project) => {
    const projectId = String(project._id);
    const hidden = await hiddenSprintFilter(companyId, uid, [projectId]);
    const hiddenIds = new Set(((hidden.sprintId && hidden.sprintId.$nin) || []).map(String));
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SPRINTS,
        data: [{ projectId: { $in: [projectId, oid(projectId)] }, deletedStatusKey: { $in: [0, null] }, mainChat: { $ne: true } }, 'name folderId createdAt', { sort: { createdAt: 1 } }],
    }, 'find').catch(() => []);
    return (rows || []).filter((row) => !hiddenIds.has(String(row._id)));
};

const peopleOf = (project) => (Array.isArray(project.AssigneeUserId) ? project.AssigneeUserId : []).map(String).filter((id) => OBJECT_ID.test(id) && !id.startsWith(TEAM_PREFIX));

/* Whom the asker may assign: themselves, and the project's members when they hold the assign right. */
const assignable = async (companyId, uid, project, canAssign) => {
    const ids = [...new Set([uid, ...(canAssign && !project.isPersonal ? peopleOf(project) : [])])];
    const outside = new Set(await nonMembersOf(companyId, ids));
    return ids.filter((id) => !outside.has(id));
};

const namesOf = async (ids) => {
    if (!ids.length) return new Map();
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids.map(oid) } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }],
    }, 'find').catch(() => []);
    return new Map((users || []).map((u) => [String(u._id), String(u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ')).trim()]));
};

const openingStatus = (project) => {
    const statuses = (Array.isArray(project.taskStatusData) ? project.taskStatusData : []).map((s) => (s && s.convertStatus ? s.convertStatus : s)).filter(Boolean);
    return statuses.find((s) => s.type === 'default_active') || statuses[0] || null;
};

const isOpen = (project) => project.statusType !== 'close' && Number(project.deletedStatusKey || 0) === 0;

/* GET /api/v1/ai/ask/build/:projectId — what the preview may offer in that project. */
const buildTarget = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const { companyId, uid } = caller;
        const project = await openProject(req, companyId, uid, req.params && req.params.projectId);
        if (!project) return fail(res, 404, 'project_not_found', 'Project not found.');
        const projectId = String(project._id);
        const [canCreate, canAssign] = await Promise.all([
            allows(companyId, uid, 'task.task_create', projectId),
            allows(companyId, uid, 'task.task_assignee', projectId),
        ]);
        const [lists, memberIds] = await Promise.all([listsOf(companyId, uid, project), assignable(companyId, uid, project, canAssign)]);
        const names = await namesOf(memberIds);
        return res.send({
            status: true,
            data: {
                projectId,
                name: project.ProjectName || '',
                canCreate: canCreate && isOpen(project) && Boolean(openingStatus(project)) && lists.length > 0,
                canAssign,
                lists: lists.map((l) => ({ id: String(l._id), name: l.name || '' })),
                members: memberIds.map((id) => ({ id, name: names.get(id) || '' })).filter((m) => m.name),
            },
        });
    } catch (error) {
        logger.error(`ai ask build target: ${error.message}`);
        return fail(res, 500, 'build_failed', error.message);
    }
};

const dueOf = (value) => {
    if (value === undefined || value === null || value === '') return { ok: true, date: '' };
    const date = new Date(String(value));
    const year = date.getUTCFullYear();
    return Number.isNaN(date.getTime()) || year < 2000 || year > 2100 ? { ok: false } : { ok: true, date: date.toISOString() };
};

const taskBody = ({ companyId, uid, project, list, placement, status, title, due, assignees }) => {
    const types = Array.isArray(project.taskTypeCounts) ? project.taskTypeCounts : [];
    const type = types[0] || {};
    const sprintArray = { id: String(placement.sprintId), name: list.name || '' };
    if (placement.folderObjId) Object.assign(sprintArray, { folderId: String(placement.folderObjId), folderName: placement.sprintArray.folderName || '' });
    const data = {
        TaskName: title,
        TaskKey: '--',
        AssigneeUserId: assignees,
        watchers: [...new Set([...assignees, uid])],
        DueDate: due || '',
        dueDateDeadLine: due ? [{ date: due }] : [],
        TaskType: type.value || type.name || '',
        TaskTypeKey: type.key,
        ParentTaskId: '',
        ProjectID: String(project._id),
        CompanyId: companyId,
        status: { text: status.name, key: status.key, value: status.value, type: status.type },
        isParentTask: true,
        Task_Leader: uid,
        sprintArray,
        Task_Priority: 'MEDIUM',
        deletedStatusKey: 0,
        sprintId: String(placement.sprintId),
        statusType: status.type,
        statusKey: status.key,
    };
    if (placement.folderObjId) data.folderObjId = String(placement.folderObjId);
    return {
        data,
        user: { id: uid },
        projectData: { _id: String(project._id), CompanyId: companyId, lastTaskId: project.lastTaskId || 0, ProjectName: project.ProjectName || '', ProjectCode: project.ProjectCode || '' },
        indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: status.key },
    };
};

const createOne = async (req, body) => {
    const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
    const prepared = await prepareTaskRequest({ headers: req.headers, uid: req.uid, aud: req.aud, apiToken: req.apiToken, instanceAdmin: req.instanceAdmin, body }, TASK_ACTION_FIELDS.create, 'ask create');
    return taskMongo.create(prepared.payload);
};

/* POST /api/v1/ai/ask/create-tasks  body: { projectId, sprintId?, items: [{ title, dueDate?, assigneeId? }] } */
const createTasks = async (req, res) => {
    try {
        const caller = callerOf(req, res);
        if (!caller) return undefined;
        const { companyId, uid } = caller;
        const { projectId, sprintId, items } = req.body || {};
        if (!Array.isArray(items) || !items.length) return fail(res, 400, 'items_required', 'Tick at least one task to create.');
        if (items.length > MAX_ITEMS) return fail(res, 400, 'too_many_items', `At most ${MAX_ITEMS} tasks at a time.`);

        const project = await openProject(req, companyId, uid, projectId);
        if (!project) return fail(res, 404, 'project_not_found', 'Project not found.');
        if (!isOpen(project)) return fail(res, 409, 'project_closed', 'That project is closed.');
        if (!(await allows(companyId, uid, 'task.task_create', String(project._id)))) {
            return fail(res, 403, 'not_permitted', 'You do not have permission to create tasks in this project.');
        }
        const status = openingStatus(project);
        const lists = await listsOf(companyId, uid, project);
        const list = sprintId ? lists.find((l) => String(l._id) === String(sprintId)) : lists[0];
        if (!status || !list) return fail(res, sprintId ? 400 : 409, sprintId ? 'list_not_found' : 'no_list', 'That project has no list to add tasks to.');
        const placement = (await sprintPlacementOf(companyId, list)).set;
        const canAssign = await allows(companyId, uid, 'task.task_assignee', String(project._id));
        const mayAssign = new Set(await assignable(companyId, uid, project, canAssign));

        const created = [];
        const failed = [];
        for (const [index, item] of items.entries()) {
            const title = String((item && item.title) || '').replace(/\s+/g, ' ').trim();
            const due = dueOf(item && item.dueDate);
            const assigneeId = item && item.assigneeId ? String(item.assigneeId) : '';
            if (title.length < TITLE_MIN || title.length > TITLE_MAX) failed.push({ index, code: 'title_invalid' });
            else if (!due.ok) failed.push({ index, code: 'due_invalid' });
            else if (assigneeId && !mayAssign.has(assigneeId)) failed.push({ index, code: 'assignee_not_allowed' });
            else {
                try {
                    // Sequential so the tasks take their keys in the order the preview listed them.
                    // eslint-disable-next-line no-await-in-loop
                    const out = await createOne(req, taskBody({ companyId, uid, project, list, placement, status, title, due: due.date, assignees: assigneeId ? [assigneeId] : [] }));
                    if (out && out.status && out.id) created.push({ index, taskId: String(out.id), title, projectId: String(project._id), sprintId: String(list._id) });
                    else failed.push({ index, code: out && out.isUpgrade ? 'plan_limit' : 'create_failed' });
                } catch (error) {
                    if (!(error instanceof TaskWriteRefusal)) logger.error(`ai ask create task: ${error.message}`);
                    failed.push({ index, code: error instanceof TaskWriteRefusal ? 'refused' : 'create_failed', statusText: error.message });
                }
            }
        }
        return res.send({
            status: created.length > 0,
            statusText: `${created.length} created, ${failed.length} not created.`,
            data: { created, failed },
        });
    } catch (error) {
        logger.error(`ai ask create tasks: ${error.message}`);
        return fail(res, 500, 'create_failed', error.message);
    }
};

module.exports = { buildTarget, createTasks, MAX_ITEMS };
