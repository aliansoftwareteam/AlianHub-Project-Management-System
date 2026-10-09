const mongoose = require('mongoose');
const helper = require('./helper');
const rules = require('./recurrenceRules');
const { buildTemplateFromBody } = require('./controller');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { actingUser } = require('../Sprints/helpers/actingUser');
const { keptOnProject } = require('../../Config/projectPeople');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TASK_FIELDS = {
    TaskName: 1, ProjectID: 1, AssigneeUserId: 1, Task_Priority: 1, TaskType: 1, TaskTypeKey: 1,
    points: 1, rawDescription: 1, descriptionBlock: 1, sprintId: 1, sprintArray: 1, deletedStatusKey: 1,
};

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

const findTask = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: new mongoose.Types.ObjectId(taskId), deletedStatusKey: { $ne: 1 } }, TASK_FIELDS],
}, 'findOne');

const findRule = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.RECURRING_TASKS,
    data: [{ sourceTaskId: String(taskId), deletedStatusKey: 0 }],
}, 'findOne');

const findProject = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: new mongoose.Types.ObjectId(String(projectId)) }, { ProjectName: 1, ProjectCode: 1, CompanyId: 1 }],
}, 'findOne');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

async function newRule(companyId, task, fields, user) {
    const project = plain(await findProject(companyId, task.ProjectID)) || {};
    const projectData = { _id: String(task.ProjectID), CompanyId: companyId, ProjectCode: project.ProjectCode, ProjectName: project.ProjectName };
    const userData = { id: user.id, Employee_Name: user.Employee_Name, companyOwnerId: '' };
    const def = {
        _id: new mongoose.Types.ObjectId(),
        name: task.TaskName,
        ProjectID: new mongoose.Types.ObjectId(String(task.ProjectID)),
        sourceTaskId: String(task._id),
        sprintId: task.sprintId ? String(task.sprintId) : '',
        sprintArray: task.sprintArray || {},
        enabled: true,
        ...fields,
        runCount: 0,
        lastInstanceTaskId: String(task._id),
        templateSnapshot: buildTemplateFromBody({
            taskName: task.TaskName,
            assignees: await keptOnProject(companyId, String(task.ProjectID))(task.AssigneeUserId || []),
            taskType: task.TaskType,
            taskTypeKey: task.TaskTypeKey,
            priority: task.Task_Priority,
            points: task.points,
            rawDescription: task.rawDescription,
            descriptionBlock: task.descriptionBlock,
            projectData,
            userData,
        }),
        projectSnapshot: projectData,
        userSnapshot: userData,
        createdBy: user.id,
        deletedStatusKey: 0,
    };
    def.nextRunAt = rules.computeNextRun(def, new Date());
    await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.RECURRING_TASKS, data: def }, 'save');
    return def;
}

exports.getForTask = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const { taskId } = req.params;
        if (!OBJECT_ID.test(String(taskId || ''))) return refuse(res, 400, 'A valid task id is required.');
        if (!(await findTask(companyId, taskId))) return refuse(res, 404, 'Task not found.');
        const rule = await findRule(companyId, taskId);
        return res.json({ status: true, data: rule || null });
    } catch (error) {
        logger.error(`[recurringTasks] read for task failed: ${error.message}`);
        return refuse(res, 500, error.message);
    }
};

exports.saveForTask = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const { taskId } = req.params;
        if (!OBJECT_ID.test(String(taskId || ''))) return refuse(res, 400, 'A valid task id is required.');
        const schedule = rules.scheduleFrom(req.body);
        if (!schedule.valid) return refuse(res, 400, schedule.reason);
        const task = plain(await findTask(companyId, taskId));
        if (!task) return refuse(res, 404, 'Task not found.');
        const user = await actingUser(req);
        if (!user) return refuse(res, 401, 'A signed-in user is required.');

        const existing = plain(await findRule(companyId, taskId));
        if (!existing) {
            const created = await newRule(companyId, task, schedule.fields, user);
            helper.announce(companyId, created, 'insert');
            return res.json({ status: true, statusText: 'Repeat set', data: created });
        }
        const patch = { ...schedule.fields, enabled: true };
        patch.nextRunAt = rules.computeNextRun({ ...existing, ...patch }, new Date());
        await helper.updateDef(companyId, existing._id, patch);
        const saved = { ...existing, ...patch };
        helper.announce(companyId, saved);
        return res.json({ status: true, statusText: 'Repeat updated', data: saved });
    } catch (error) {
        logger.error(`[recurringTasks] save for task failed: ${error.message}`);
        return refuse(res, 500, error.message);
    }
};

exports.removeForTask = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        const { taskId } = req.params;
        if (!OBJECT_ID.test(String(taskId || ''))) return refuse(res, 400, 'A valid task id is required.');
        if (!(await findTask(companyId, taskId))) return refuse(res, 404, 'Task not found.');
        const rule = plain(await findRule(companyId, taskId));
        if (rule) {
            await helper.updateDef(companyId, rule._id, { deletedStatusKey: 1, enabled: false });
            helper.announce(companyId, rule, 'delete');
        }
        return res.json({ status: true, statusText: 'Repeat removed' });
    } catch (error) {
        logger.error(`[recurringTasks] remove for task failed: ${error.message}`);
        return refuse(res, 500, error.message);
    }
};
