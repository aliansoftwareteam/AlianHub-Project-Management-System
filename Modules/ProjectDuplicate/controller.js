const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { tenantOf } = require('../../Config/tenant');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { stepProjectCount } = require('../Project/helpers/projectQuota');
const { recordProjectCreated } = require('../Project/helpers/projectHistory');
const rules = require('./rules');
const { copyStructure, discard } = require('./structure');
const { planTasks, copyTasks } = require('./tasks');

const NOT_FOUND = 'Project not found.';
const PERSONAL = 'A personal list cannot be duplicated.';
const OVER_LIMIT = 'Your plan does not allow another project.';
const FAILED = 'The project could not be duplicated.';

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, message: statusText, ...extra });
const asId = (id) => new mongoose.Types.ObjectId(String(id));
const logged = (what) => (error) => logger.error(`duplicate project: ${what}: ${(error && error.message) || error}`);

const liveProject = (companyId, id) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS, data: [{ _id: asId(id), deletedStatusKey: { $ne: rules.TRASHED } }, null, { lean: true }],
}, 'findOne');

const updateJob = (companyId, jobId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.IMPORT_JOBS, data: [{ _id: jobId }, { $set: set }],
}, 'updateOne');

const jobView = (job) => ({ id: String(job._id), status: job.status, total: job.total || 0, processed: job.processed || 0, created: job.created || 0 });

const startJob = async ({ companyId, caller, sourceId, copy, plan, include }) => {
    const job = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.IMPORT_JOBS,
        data: { userId: caller, source: rules.JOB_SOURCE, projectId: copy.project._id, status: 'processing', total: plan.total, processed: 0, created: 0, errorList: [] },
    }, 'save');
    let created = 0;
    setImmediate(() => {
        copyTasks({
            companyId, caller, sourceId, copy, plan, include,
            onProgress: (count) => { created = count; return updateJob(companyId, job._id, { processed: count, created: count }); },
        })
            .then((count) => updateJob(companyId, job._id, { status: 'done', processed: plan.total, created: count }))
            .catch((error) => {
                logged('copying tasks')(error);
                return updateJob(companyId, job._id, { status: 'failed', processed: created, created, errorList: [{ message: FAILED }] }).catch(logged('marking the job failed'));
            });
    });
    return jobView(job);
};

/* POST /api/v2/projects/:id/duplicate { name, include: { tasks, assignees, dates } } */
exports.duplicate = async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        return refuse(res, error.statusCode || 403, error.message);
    }
    const caller = String(req.uid || '');
    const sourceId = String(req.params.id || '');
    if (!rules.OBJECT_ID.test(sourceId) || !rules.OBJECT_ID.test(caller)) return refuse(res, 404, NOT_FOUND);
    const request = rules.parseRequest(req.body);
    if (!request.ok) return refuse(res, 400, request.statusText);

    let counted = null;
    const made = { projectId: rules.newId(), rules: [] };
    const giveBack = async () => {
        if (counted !== null) await stepProjectCount(companyId, counted, -1).catch(logged('giving the project count back'));
        counted = null;
    };
    try {
        const source = await liveProject(companyId, sourceId);
        if (!source) return refuse(res, 404, NOT_FOUND);
        if (source.isPersonal === true) return refuse(res, 400, PERSONAL);

        const isPrivateSpace = source.isPrivateSpace === true;
        const stepped = await stepProjectCount(companyId, isPrivateSpace, 1);
        counted = isPrivateSpace;
        if (rules.overProjectLimit(stepped && stepped.data, isPrivateSpace)) {
            await giveBack();
            return refuse(res, 403, OVER_LIMIT, { isUpgrade: true });
        }

        const { include, name } = request;
        const copy = await copyStructure({ companyId, caller, source, name, include, made });
        const plan = include.tasks ? await planTasks(companyId, sourceId, copy.sourceListIds) : { total: 0, left: 0 };
        if (plan.left) copy.notes.push({ code: 'tasks_left_out', count: plan.left });

        let job = null;
        if (plan.total > rules.INLINE_TASK_LIMIT) {
            job = await startJob({ companyId, caller, sourceId, copy, plan, include });
        } else if (plan.total) {
            copy.counts.tasks = await copyTasks({ companyId, caller, sourceId, copy, plan, include });
        }

        removeCache('UserProjectData:', true);
        const project = (await liveProject(companyId, made.projectId)) || copy.project;
        recordProjectCreated({ companyId, project, actorId: caller }).catch(logged('recording the creation'));
        return res.send({ status: true, statusText: 'Project duplicated.', data: { project, counts: copy.counts, notes: copy.notes, job } });
    } catch (error) {
        logged('failed')(error);
        await discard(companyId, made).catch(logged('taking the copy back'));
        await giveBack();
        return refuse(res, 500, FAILED);
    }
};

/* GET /api/v2/projects/:id/duplicate, where :id is the copy: how far the tasks of a large copy have got. */
exports.progress = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const projectId = String(req.params.id || '');
        if (!rules.OBJECT_ID.test(projectId)) return refuse(res, 404, NOT_FOUND);
        const job = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.IMPORT_JOBS,
            data: [{ projectId: asId(projectId), source: rules.JOB_SOURCE, userId: String(req.uid || '') }, null, { sort: { createdAt: -1 }, lean: true }],
        }, 'findOne');
        return res.send({ status: true, statusText: 'Duplicate progress fetched.', data: job ? jobView(job) : null });
    } catch (error) {
        logged('progress')(error);
        return refuse(res, error.statusCode || 500, error.statusCode ? error.message : FAILED);
    }
};
