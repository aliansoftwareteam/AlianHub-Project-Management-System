const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { updateProjectInternal } = require('../Project/controller/updateProject');
const { updateSprintFun, updateFolderFun } = require('../Sprints/controller');
const { taskMongo } = require('../Tasks/helpers/task_class_Mongo');
const { leaveLists } = require('../Tasks/helpers/taskListsLeft');
const pages = require('../Pages/controller');
const { emitPageChange } = require('../Pages/helpers/pageEvents');
const rules = require('./rules');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { visibleTrash } = require('./listAccess');
const { sessionActor } = require('../Tasks/helpers/taskWriteFields');
const { announce } = require('../Goals/goalStore');
const { removeCache } = require('../../utils/commonFunctions');
const { announceProject } = require('../Project/helpers/projectEvents');

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
    announceProject(companyId, 'update', { _id: id }, { deletedStatusKey: 0 });
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

const restoreFolder = async (companyId, id, userData) => {
    const folder = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FOLDERS, data: [{ _id: new ObjectId(id) }] }, 'findOne');
    if (!folder) throw new Error('Folder not found');
    if (folder.deletedStatusKey !== rules.TRASHED) throw Object.assign(new Error('That folder is not in the trash.'), { statusCode: 400 });
    const projectId = String(folder.projectId || '');
    const project = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: new ObjectId(projectId) }, 'ProjectName'] }, 'findOne');
    const { answer, cascade } = await updateFolderFun({
        companyId,
        id,
        updateObject: { $set: { deletedStatusKey: 0 } },
        folderName: folder.name,
        projectData: { id: projectId, ProjectName: project ? project.ProjectName : '' },
        userData,
        fromTrash: true,
    });
    if (!answer || answer.status === false) throw new Error((answer && answer.statusText) || 'Folder not restored');
    await cascade;
};

exports.restore = async (req, res) => {
    const companyId = companyOrRefuse(req, res);
    if (!companyId) return undefined;
    const { kind, id } = req.params;
    if (!rules.isKind(kind)) return fail(res, `kind must be one of ${rules.KINDS.join(', ')}.`);
    if (!mongoose.isValidObjectId(id)) return fail(res, 'id must be a valid id.');
    try {
        if (kind === 'docs') return pages.restorePage(req, res);
        if (kind === 'projects') await restoreProject(companyId, id);
        else if (kind === 'folders') await restoreFolder(companyId, id, await sessionActor(req));
        else if (kind === 'lists') await restoreList(companyId, id, await sessionActor(req));
        else await taskMongo.bulkRestore({ companyId, userData: await sessionActor(req), taskIds: [id] });
        return res.send({ status: true, statusText: 'Restored.', data: { kind, id } });
    } catch (error) {
        logger.error(`ERROR in restore ${kind}/${id}: ${error.message}`);
        return fail(res, error.message, error.statusCode || 500);
    }
};

const trashWhere = (companyId, type, filter) => MongoDbCrudOpration(companyId, {
    type, data: [{ ...filter, deletedStatusKey: { $ne: rules.TRASHED } }, { $set: { deletedStatusKey: rules.TRASHED } }]
}, 'updateMany').then((outcome) => Number(outcome && outcome.modifiedCount) || 0);

const trashFound = async (companyId, type, filter) => {
    const live = await MongoDbCrudOpration(companyId, { type, data: [{ ...filter, deletedStatusKey: { $ne: rules.TRASHED } }, '_id'] }, 'find');
    const ids = (live || []).map((row) => row._id);
    if (ids.length) await trashWhere(companyId, type, { _id: { $in: ids } });
    return ids;
};

/* A field held by the sample project alone goes with it; one a person also linked to another project stays. */
const switchOffSampleFields = async (companyId, projectId) => {
    const linked = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ global: { $ne: true }, projectId: String(projectId), isDelete: { $ne: false } }, 'projectId']
    }, 'find');
    const ids = (linked || []).filter((field) => [].concat(field.projectId).length === 1).map((field) => field._id);
    if (!ids.length) return 0;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.CUSTOM_FIELDS,
        data: [{ _id: { $in: ids } }, { $set: { isDelete: false, updatedAt: new Date() } }]
    }, 'updateMany');
    removeCache(`customField:${companyId}`);
    return ids.length;
};

exports.removeSampleData = async (req, res) => {
    const companyId = companyOrRefuse(req, res);
    if (!companyId) return undefined;
    try {
        const projects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ ProjectCode: rules.SAMPLE_PROJECT_CODE, deletedStatusKey: { $ne: rules.TRASHED } }, '_id']
        }, 'find') || [];
        const removed = { projects: projects.length, tasks: 0, folders: 0, lists: 0, docs: 0, fields: 0, goals: 0 };
        for (const project of projects) {
            const id = String(project._id);
            await updateProjectInternal(companyId, id, { deletedStatusKey: rules.TRASHED });
            const outcome = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ ProjectID: new ObjectId(id), deletedStatusKey: 0 }, { $set: { deletedStatusKey: rules.TRASHED } }]
            }, 'updateMany');
            removed.tasks += Number(outcome && outcome.modifiedCount) || 0;
            const inProject = new ObjectId(id);
            removed.folders += (await trashFound(companyId, SCHEMA_TYPE.FOLDERS, { projectId: inProject })).length;
            const lists = await trashFound(companyId, SCHEMA_TYPE.SPRINTS, { projectId: inProject });
            removed.lists += lists.length;
            const docs = await trashFound(companyId, SCHEMA_TYPE.PAGES, { ProjectID: inProject });
            removed.docs += docs.length;
            if (docs.length) {
                emitPageChange(companyId, 'update', { _id: String(docs[0]), deletedStatusKey: rules.TRASHED, deleted: docs.length, ids: docs.map(String) });
            }
            await leaveLists({ companyId, sprintIds: lists, exceptProjectId: id });
            removed.fields += await switchOffSampleFields(companyId, id);
            announceProject(companyId, 'update', { _id: id }, { deletedStatusKey: rules.TRASHED });
        }
        // A sample project already in the trash still counts, so its goal does not outlive it.
        const seeded = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ ProjectCode: rules.SAMPLE_PROJECT_CODE }, '_id'] }, 'find') || [];
        removed.goals = await trashWhere(companyId, SCHEMA_TYPE.GOALS, { sample: true, sampleProjectId: { $in: seeded.map((project) => String(project._id)) } });
        if (removed.goals) announce('update', companyId);
        // updateProjectInternal cleared this before the lists and folders were written.
        if (removed.projects) removeCache('UserProjectData:', true);
        return res.send({ status: true, statusText: 'Sample data removed.', data: removed });
    } catch (error) {
        logger.error(`ERROR in remove sample data: ${error.message}`);
        return fail(res, error.message, 500);
    }
};
