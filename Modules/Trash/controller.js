const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { updateProjectInternal } = require('../Project/controller/updateProject');
const { updateSprintFun } = require('../Sprints/controller');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const pages = require('../Pages/controller');
const rules = require('./rules');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { visibleTrash } = require('./listAccess');

const ObjectId = mongoose.Types.ObjectId;

const fail = (res, statusText, code = 400) => res.status(code).send({ status: false, statusText });

const companyOrRefuse = (req, res) => {
    try {
        return tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        fail(res, error.message, error.statusCode);
        return '';
    }
};

exports.list = async (req, res) => {
    const companyId = companyOrRefuse(req, res);
    if (!companyId) return undefined;
    const kind = String(req.query.kind || 'projects');
    if (!rules.isKind(kind)) return fail(res, `kind must be one of ${rules.KINDS.join(', ')}.`);
    try {
        const q = rules.listQuery(kind);
        const docs = await MongoDbCrudOpration(companyId, { type: q.type, data: [q.filter, q.fields, q.options] }, 'find');
        const visible = await visibleTrash(companyId, req.uid, kind, docs || []);
        return res.send({ status: true, statusText: 'Trash fetched.', data: visible.map((doc) => rules.toRow(kind, doc)) });
    } catch (error) {
        logger.error(`ERROR in list trash (${kind}): ${error.message}`);
        return fail(res, error.message, 500);
    }
};

const restoreChildren = (companyId, kind, id) => {
    const filter = rules.childRestoreFilter(kind, id, ObjectId);
    if (!filter) return Promise.resolve();
    return MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [filter, { $set: { deletedStatusKey: 0 } }] }, 'updateMany');
};

const restoreProject = async (companyId, id) => {
    await updateProjectInternal(companyId, id, { deletedStatusKey: 0 });
    await restoreChildren(companyId, 'projects', id);
};

const restoreList = async (companyId, id, userData) => {
    const sprint = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: new ObjectId(id) }] }, 'findOne');
    if (!sprint) throw new Error('List not found');
    const projectId = String(sprint.projectId || '');
    const project = projectId
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new ObjectId(projectId) }, 'ProjectName'] }, 'findOne')
        : null;
    const result = await updateSprintFun({
        params: { id },
        body: {
            companyId,
            projectId,
            updateObject: { $set: { deletedStatusKey: 0 } },
            userData,
            sprintName: sprint.name,
            projectData: { id: projectId, ProjectName: project ? project.ProjectName : '' },
            updatedValueDeleteStatusKey: 0
        }
    });
    if (result && result.status === false) throw new Error(result.statusText || 'List not restored');
    await restoreChildren(companyId, 'lists', id);
};

exports.restore = async (req, res) => {
    const companyId = companyOrRefuse(req, res);
    if (!companyId) return undefined;
    const { kind, id } = req.params;
    if (!rules.isKind(kind)) return fail(res, `kind must be one of ${rules.KINDS.join(', ')}.`);
    if (!mongoose.isValidObjectId(id)) return fail(res, 'id must be a valid id.');
    const userData = (req.body && req.body.userData) || { id: String(req.uid || ''), Employee_Name: '' };
    try {
        if (kind === 'docs') return pages.restorePage(req, res);
        if (kind === 'projects') await restoreProject(companyId, id);
        else if (kind === 'lists') await restoreList(companyId, id, userData);
        else await taskMongo.bulkRestore({ companyId, userData, taskIds: [id] });
        return res.send({ status: true, statusText: 'Restored.', data: { kind, id } });
    } catch (error) {
        logger.error(`ERROR in restore ${kind}/${id}: ${error.message}`);
        return fail(res, error.message, 500);
    }
};

exports.removeSampleData = async (req, res) => {
    const companyId = companyOrRefuse(req, res);
    if (!companyId) return undefined;
    try {
        const projects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ ProjectCode: rules.SAMPLE_PROJECT_CODE, deletedStatusKey: { $ne: rules.TRASHED } }, '_id']
        }, 'find');
        let tasks = 0;
        for (const project of projects || []) {
            const id = String(project._id);
            await updateProjectInternal(companyId, id, { deletedStatusKey: rules.TRASHED });
            const outcome = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ ProjectID: new ObjectId(id), deletedStatusKey: 0 }, { $set: { deletedStatusKey: rules.TRASHED } }]
            }, 'updateMany');
            tasks += Number(outcome && outcome.modifiedCount) || 0;
                }
        return res.send({ status: true, statusText: 'Sample data removed.', data: { projects: (projects || []).length, tasks } });
    } catch (error) {
        logger.error(`ERROR in remove sample data: ${error.message}`);
        return fail(res, error.message, 500);
    }
};
