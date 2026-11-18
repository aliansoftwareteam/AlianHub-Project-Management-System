const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { stepProjectCount } = require('../Project/helpers/projectQuota');
const { recordProjectCreated } = require('../Project/helpers/projectHistory');
const { announceProject } = require('../Project/helpers/projectEvents');
const rules = require('./rules');
const { writeStructure, discard } = require('./structure');
const { copyTasks } = require('./tasks');

const TASKS_FAILED = 'The tasks could not all be copied.';

const asId = (id) => new mongoose.Types.ObjectId(String(id));
const logged = (what) => (error) => logger.error(`project copy: ${what}: ${(error && error.message) || error}`);

const liveProject = (companyId, id) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS, data: [{ _id: asId(id), deletedStatusKey: { $ne: rules.TRASHED } }, null, { lean: true }],
}, 'findOne');

const updateJob = (companyId, jobId, set) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.IMPORT_JOBS, data: [{ _id: jobId }, { $set: set }],
}, 'updateOne');

const jobView = (job) => ({ id: String(job._id), status: job.status, total: job.total || 0, processed: job.processed || 0, created: job.created || 0 });

const startJob = async ({ companyId, caller, copy, plan, include, readRows }) => {
    const job = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.IMPORT_JOBS,
        data: { userId: caller, source: rules.JOB_SOURCE, projectId: copy.project._id, status: 'processing', total: plan.total, processed: 0, created: 0, errorList: [] },
    }, 'save');
    let created = 0;
    setImmediate(() => {
        copyTasks({
            companyId, caller, copy, plan, include, readRows,
            onProgress: (count) => { created = count; return updateJob(companyId, job._id, { processed: count, created: count }); },
        })
            .then((count) => updateJob(companyId, job._id, { status: 'done', processed: plan.total, created: count }))
            .catch((error) => {
                logged('copying tasks')(error);
                return updateJob(companyId, job._id, { status: 'failed', processed: created, created, errorList: [{ message: TASKS_FAILED }] }).catch(logged('marking the job failed'));
            });
    });
    return jobView(job);
};

const latestJob = async (companyId, projectId, caller) => {
    const job = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.IMPORT_JOBS,
        data: [{ projectId: asId(projectId), source: rules.JOB_SOURCE, userId: caller }, null, { sort: { createdAt: -1 }, lean: true }],
    }, 'findOne');
    return job ? jobView(job) : null;
};

/* Makes the project `bundle` describes, with its tasks inline or as a job past the inline limit. `planFor(copy)` answers
   which tasks, `readRows` a batch of them in full. What an inline failure wrote is taken back before the error is thrown on. */
const buildProject = async ({ companyId, caller, bundle, name, code, include, planFor, readRows }) => {
    const isPrivateSpace = bundle.source.isPrivateSpace === true;
    const made = { projectId: rules.newId(), rules: [] };
    // Counted as a create counts it, and like a create held to no plan limit: one that returns belongs in a place both paths share.
    await stepProjectCount(companyId, isPrivateSpace, 1);
    try {
        const copy = await writeStructure({ companyId, caller, bundle, name, code, include, made });
        const plan = include.tasks ? await planFor(copy) : { total: 0, left: 0 };
        if (plan.left) copy.notes.push({ code: 'tasks_left_out', count: plan.left });

        let job = null;
        if (plan.total > rules.INLINE_TASK_LIMIT) {
            job = await startJob({ companyId, caller, copy, plan, include, readRows });
        } else if (plan.total) {
            copy.counts.tasks = await copyTasks({ companyId, caller, copy, plan, include, readRows });
        }

        removeCache('UserProjectData:', true);
        const project = (await liveProject(companyId, made.projectId)) || copy.project;
        announceProject(companyId, 'insert', project);
        recordProjectCreated({ companyId, project, actorId: caller }).catch(logged('recording the creation'));
        return { project, counts: copy.counts, notes: copy.notes, sharedFields: copy.sharedFields, job };
    } catch (error) {
        await discard(companyId, made).catch(logged('taking the copy back'));
        await stepProjectCount(companyId, isPrivateSpace, -1).catch(logged('giving the project count back'));
        throw error;
    }
};

module.exports = { liveProject, latestJob, buildProject };
