const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { ACTIVE_SEAT } = require('../../Config/seatStatus');
const { ROLE_OWNER } = require('../../Config/roleTypes');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { HandleHistory } = require('../Tasks/helpers/mongo_helper');
const { sessionActor, escapeText } = require('../Tasks/helpers/taskWriteFields');
const { updateRemainingTime } = require('../LogTime/controllerV2/helpers');
const { visibleProjectIds } = require('../Agents/scope');
const access = require('./access');
const rules = require('./templateRules');
const { canNest } = require('../Tasks/helpers/taskTree');

const { OBJECT_ID } = access;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const refuse = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });
const NOT_FOUND = 'Template not found.';
const refuseDecision = (res, decision, notFound = 'Not found.') => (decision.statusCode === 404
    ? refuse(res, 404, notFound)
    : refuse(res, 403, 'You do not have permission to perform this action.'));

const fail = (res, where, error) => {
    if (error && error.statusCode && error.statusCode < 500) return refuse(res, error.statusCode, error.message);
    logger.error(`[taskTemplates] ${where}: ${error && error.message}`);
    return refuse(res, 500, 'Something went wrong with the task template.');
};

const crud = (companyId, type, data, method) => MongoDbCrudOpration(companyId, { type, data }, method);

const liveTemplate = (companyId, id) => (OBJECT_ID.test(String(id || ''))
    ? crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ _id: oid(id), deletedStatusKey: 0 }], 'findOne')
    : Promise.resolve(null));

const storedTask = (companyId, id) => (OBJECT_ID.test(String(id || ''))
    ? crud(companyId, SCHEMA_TYPE.TASKS, [{ _id: oid(id) }], 'findOne')
    : Promise.resolve(null));

const present = (row, { projectId = '', canManage = false, projectName = '' } = {}) => ({
    _id: String(row._id),
    name: row.name,
    scope: row.scope,
    projectId: row.ProjectID ? String(row.ProjectID) : '',
    projectName,
    isDefault: Boolean(projectId) && (row.defaultForProjects || []).map(String).includes(String(projectId)),
    canManage,
    titlePattern: row.titlePattern || '',
    TaskType: row.TaskType || '',
    TaskTypeKey: row.TaskTypeKey ?? null,
    Task_Priority: row.Task_Priority || '',
    startOffsetDays: row.startOffsetDays ?? null,
    dueOffsetDays: row.dueOffsetDays ?? null,
    summary: {
        description: Boolean(row.rawDescription),
        checklist: (row.checklist || []).length,
        subtasks: (row.subtasks || []).length,
        tags: (row.tagsArray || []).length,
        customFields: Object.keys(row.customField || {}).length,
    },
    updatedAt: row.updatedAt || row.createdAt || null,
});

const projectNamesOf = async (companyId, rows) => {
    const ids = [...new Set(rows.filter((row) => row.ProjectID).map((row) => String(row.ProjectID)))].filter((id) => OBJECT_ID.test(id));
    if (!ids.length) return new Map();
    const projects = await crud(companyId, SCHEMA_TYPE.PROJECTS, [{ _id: { $in: ids.map(oid) } }, { ProjectName: 1 }], 'find');
    return new Map((projects || []).map((p) => [String(p._id), p.ProjectName || '']));
};

const companyOwnerOf = async (companyId) => {
    const seat = await crud(companyId, SCHEMA_TYPE.COMPANY_USERS, [{ roleType: ROLE_OWNER, ...ACTIVE_SEAT }, { userId: 1 }], 'findOne');
    return seat ? String(seat.userId) : '';
};

exports.listTemplates = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const projectId = typeof (req.query || {}).projectId === 'string' ? req.query.projectId : '';
        let rows;
        if (projectId) {
            if (!OBJECT_ID.test(projectId)) return refuse(res, 400, 'A valid project id is required.');
            const decision = await access.canReadProject(companyId, req.uid, projectId);
            if (!decision.allowed) return refuseDecision(res, decision, 'Project not found.');
            rows = await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ deletedStatusKey: 0, $or: [{ scope: 'workspace' }, { scope: 'project', ProjectID: oid(projectId) }] }], 'find');
        } else {
            const visible = new Set(await visibleProjectIds(companyId, req.uid));
            rows = ((await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ deletedStatusKey: 0 }], 'find')) || [])
                .filter((row) => row.scope === 'workspace' || visible.has(String(row.ProjectID)));
        }
        rows = rows || [];
        const admin = await access.isAdmin(companyId, req.uid);
        const manageable = new Map();
        const canManageRow = async (row) => {
            if (row.scope === 'workspace') return admin;
            const pid = String(row.ProjectID);
            if (!manageable.has(pid)) manageable.set(pid, (await access.canManage(companyId, req.uid, row)).allowed);
            return manageable.get(pid);
        };
        const names = await projectNamesOf(companyId, rows);
        const data = [];
        for (const row of rows) {
            data.push(present(row, { projectId, canManage: await canManageRow(row), projectName: names.get(String(row.ProjectID)) || '' }));
        }
        data.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return res.status(200).json({ status: true, data });
    } catch (error) {
        return fail(res, 'list', error);
    }
};

exports.saveTemplate = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const body = req.body || {};
        if (!rules.cleanName(body.name)) return refuse(res, 400, 'A template name is required.');
        if (body.scope !== undefined && !['project', 'workspace'].includes(body.scope)) return refuse(res, 400, 'The scope must be project or workspace.');
        const task = await storedTask(companyId, body.taskId);
        if (!task || task.deletedStatusKey === 1) return refuse(res, 404, 'Task not found.');
        const projectId = String(task.ProjectID);
        const visible = await access.canReadProject(companyId, req.uid, projectId);
        if (!visible.allowed) return refuse(res, 404, 'Task not found.');
        const scope = body.scope === 'workspace' ? 'workspace' : 'project';
        const allowed = await access.canSaveIn(companyId, req.uid, { scope, projectId });
        if (!allowed.allowed) return refuseDecision(res, allowed, 'Task not found.');
        const include = rules.includesOf(body.include);
        const subtasks = include.subtasks
            ? (await crud(companyId, SCHEMA_TYPE.TASKS, [{ ParentTaskId: String(task._id), deletedStatusKey: 0 }, null, { sort: { createdAt: 1 } }], 'find')) || []
            : [];
        const doc = rules.buildTemplate({ task, subtasks, body: { ...body, scope }, uid: String(req.uid) });
        const saved = await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, doc, 'save');
        return res.status(200).json({ status: true, statusText: 'Template saved.', data: present(saved, { canManage: true }) });
    } catch (error) {
        return fail(res, 'save', error);
    }
};

exports.renameTemplate = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const name = rules.cleanName((req.body || {}).name);
        if (!name) return refuse(res, 400, 'A template name is required.');
        const template = await liveTemplate(companyId, req.params.id);
        if (!template) return refuse(res, 404, NOT_FOUND);
        const decision = await access.canManage(companyId, req.uid, template);
        if (!decision.allowed) return refuseDecision(res, decision, NOT_FOUND);
        await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ _id: oid(template._id) }, { $set: { name, updatedBy: String(req.uid) } }], 'updateOne');
        return res.status(200).json({ status: true, statusText: 'Template renamed.' });
    } catch (error) {
        return fail(res, 'rename', error);
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const template = await liveTemplate(companyId, req.params.id);
        if (!template) return refuse(res, 404, NOT_FOUND);
        const decision = await access.canManage(companyId, req.uid, template);
        if (!decision.allowed) return refuseDecision(res, decision, NOT_FOUND);
        await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ _id: oid(template._id) }, { $set: { deletedStatusKey: 1, defaultForProjects: [], updatedBy: String(req.uid) } }], 'updateOne');
        return res.status(200).json({ status: true, statusText: 'Template deleted.' });
    } catch (error) {
        return fail(res, 'delete', error);
    }
};

exports.setDefaultTemplate = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const { projectId, templateId } = req.body || {};
        if (!OBJECT_ID.test(String(projectId || ''))) return refuse(res, 400, 'A valid project id is required.');
        const decision = await access.canEditProject(companyId, req.uid, String(projectId), [access.PROJECT_SETTINGS]);
        if (!decision.allowed) return refuseDecision(res, decision, 'Project not found.');
        let template = null;
        if (templateId) {
            template = await liveTemplate(companyId, templateId);
            if (!template || !access.usableIn(template, projectId)) return refuse(res, 404, NOT_FOUND);
        }
        const pid = String(projectId);
        await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ defaultForProjects: pid }, { $pull: { defaultForProjects: pid } }], 'updateMany');
        if (template) {
            await crud(companyId, SCHEMA_TYPE.TASK_TEMPLATES, [{ _id: oid(template._id) }, { $addToSet: { defaultForProjects: pid } }], 'updateOne');
        }
        return res.status(200).json({ status: true, statusText: template ? 'Default template set.' : 'Default template cleared.' });
    } catch (error) {
        return fail(res, 'default', error);
    }
};

const appliedFieldsOf = (plan) => [
    ...plan.changes.map((change) => change.field),
    ...(plan.checklist.length ? ['checklist'] : []),
    ...(plan.subtasks.length ? ['subtasks'] : []),
];

const writeFields = async ({ companyId, task, projectId, changes, actor, template }) => {
    const set = Object.assign({}, ...changes.map((change) => change.patch));
    const taskId = String(task._id);
    const updated = await crud(companyId, SCHEMA_TYPE.TASKS, [{ _id: oid(taskId) }, { $set: set }, { returnDocument: 'after' }], 'findOneAndUpdate');
    socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: set, module: 'task' });
    if (Object.prototype.hasOwnProperty.call(set, 'totalEstimatedTime')) {
        Promise.resolve(updateRemainingTime(companyId, taskId)).catch((error) => logger.error(`[taskTemplates] remaining time: ${error && error.message}`));
    }
    HandleHistory('task', companyId, projectId, taskId, {
        key: 'Task_Template_Applied',
        message: `<b>${actor.Employee_Name}</b> applied the template <b>${escapeText(template.name)}</b>.`,
        sprintId: task.sprintId,
    }, actor).catch((error) => logger.error(`[taskTemplates] history: ${error && error.message}`));
};

const createSubtasks = async ({ companyId, task, project, projectId, subtasks, actor }) => {
    const assignable = await access.assignableIn(companyId, projectId, subtasks.flatMap((sub) => sub.assigneeIds));
    const user = { ...actor, companyOwnerId: await companyOwnerOf(companyId) };
    const projectData = {
        _id: projectId,
        CompanyId: companyId,
        ProjectName: project.ProjectName || '',
        ProjectCode: project.ProjectCode || '',
        lastTaskId: project.lastTaskId || 0,
    };
    const status = rules.defaultStatusOf(project);
    let created = 0;
    for (const sub of subtasks) {
        const assignees = [...new Set(sub.assigneeIds)].filter((id) => assignable.has(id));
        const data = rules.subtaskData({ sub, parent: task, project, companyId, actorId: actor.id, assignees });
        const result = await taskMongo.create({
            data,
            user,
            projectData,
            indexObj: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: String(status.key) },
        });
        if (result && result.status) created += 1;
    }
    return created;
};

exports.applyTemplate = async (req, res) => {
    try {
        const companyId = access.companyOf(req);
        if (!companyId) return refuse(res, 403, 'You do not have access to this company.');
        const body = req.body || {};
        const task = await storedTask(companyId, body.taskId);
        if (!task || task.deletedStatusKey === 1) return refuse(res, 404, 'Task not found.');
        const projectId = String(task.ProjectID);
        const decision = await access.canEditProject(companyId, req.uid, projectId, [access.CREATE_TASKS]);
        if (!decision.allowed) return refuseDecision(res, decision, 'Task not found.');
        const template = await liveTemplate(companyId, req.params.id);
        if (!template || !access.usableIn(template, projectId)) return refuse(res, 404, NOT_FOUND);

        const project = (await crud(companyId, SCHEMA_TYPE.PROJECTS, [{ _id: oid(projectId) }], 'findOne')) || {};
        const plan = rules.planApply({ template, task, project, day: rules.applyDayOf(body), overwrite: body.overwrite });
        if (body.preview === true) {
            return res.status(200).json({ status: true, data: { applied: appliedFieldsOf(plan), conflicts: plan.conflicts, skipped: [] } });
        }

        const may = access.keyChecker(companyId, req.uid, projectId);
        const skipped = [];
        const changes = [];
        for (const change of plan.changes) {
            if (await may(rules.FIELD_KEYS[change.field])) changes.push(change);
            else skipped.push(change.field);
        }
        const keep = async (field, list) => {
            if (!list.length) return [];
            if (await may(rules.FIELD_KEYS[field])) return list;
            skipped.push(field);
            return [];
        };
        const checklist = await keep('checklist', plan.checklist);
        const takesSubtasks = canNest(task).ok;
        if (!takesSubtasks && plan.subtasks.length) skipped.push('subtasks');
        const subtasks = takesSubtasks ? await keep('subtasks', plan.subtasks) : [];

        const actor = await sessionActor(req);
        if (changes.length) await writeFields({ companyId, task, projectId, changes, actor, template });
        if (checklist.length) {
            await taskMongo.updateChecklists({
                companyId,
                projectId,
                sprintId: String(task.sprintId || ''),
                taskId: String(task._id),
                operation: 'checklistadd',
                data: checklist,
                historyObj: { name: checklist.map((item) => item.name).join(', ') },
                userData: actor,
            });
        }
        const subtasksCreated = subtasks.length ? await createSubtasks({ companyId, task, project, projectId, subtasks, actor }) : 0;

        return res.status(200).json({
            status: true,
            statusText: 'Template applied.',
            data: {
                applied: [...changes.map((change) => change.field), ...(checklist.length ? ['checklist'] : []), ...(subtasksCreated ? ['subtasks'] : [])],
                conflicts: plan.conflicts,
                skipped,
                checklistAdded: checklist.length,
                subtasksCreated,
            },
        });
    } catch (error) {
        return fail(res, 'apply', error);
    }
};
