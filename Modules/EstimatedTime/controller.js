const { default: mongoose } = require("mongoose");
const loggerConfig = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
const { estimateAndPersist: estimateTaskTimeWithAI, proposeEstimate, _internal: aiEstimatorInternal } = require("./aiTaskEstimator");
const { updateRemainingTime } = require("../LogTime/controllerV2/helpers");
const { resolveSheetScope, SHEET_PERMISSION, scopedEstimateMatch, opensProject } = require("../TimeSheet/helpers/timeScope");
const { scopeEstimatePipeline, withJoinScope, TimesheetQueryRefused } = require("../TimeSheet/helpers/timesheetQueryScope");
const { buildEstimateWrite, authorizeTaskProject, EstimateWriteRefused } = require("./helpers/estimateWriteScope");
const { previousPlanOf, recordPlanChange } = require("./helpers/planHistory");
const { idForms } = require("../../utils/mongo-handler/objectIdKeys");
const { evaluatePermission, isWritable } = require("../../Config/permissionGuard");
const { visibleTask, TASK_NOT_FOUND } = require("../AI/taskAccess");

/* The same grant that decides who may plan another person's time decides who may read it. */
const ESTIMATE_SCOPE_PERMISSIONS = [SHEET_PERMISSION.workload, SHEET_PERMISSION.project];

exports.getEstimatedTime = async(req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const projectId = req.params.pid;
        const TaskId = req.params.tid;

        const scope = await resolveSheetScope(companyId, req.uid, ESTIMATE_SCOPE_PERMISSIONS);
        if (!opensProject(scope, projectId)) {
            return res.status(200).json([]);
        }

        const estimatedObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [
                {
                    ...scopedEstimateMatch(scope),
                    "ProjectId": { $in: idForms(projectId) },
                    "TaskId": TaskId
                }
            ]
        };

        const estimatedTime =  await MongoDbCrudOpration(companyId, estimatedObj, 'find');

        if (!estimatedTime) {
            return res.status(404).json({ message: "Estimated time not found" });
        }

        res.status(200).json(estimatedTime);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the estimated time.", error: error.message });
    }
}

exports.updateEstimatedTime = async(req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const scope = await resolveSheetScope(companyId, req.uid, ESTIMATE_SCOPE_PERMISSIONS);
        let write;
        try {
            write = buildEstimateWrite(req.body, scope);
            if (scope.hidden && scope.hidden.length) {
                authorizeTaskProject(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: new mongoose.Types.ObjectId(write.plan.taskId) }, { ProjectID: 1 }] }, 'findOne'), scope);
            }
        } catch (error) {
            if (!(error instanceof EstimateWriteRefused)) throw error;
            return res.status(error.statusCode).json({ status: false, statusText: error.statusCode === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }

        const previous = await previousPlanOf(companyId, write.data[0]).catch(() => null);
        const mongoObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: write.data
        }
        const estimatedTime = await MongoDbCrudOpration(companyId, mongoObj, 'findOneAndUpdate');

        if (!estimatedTime) {
            return res.status(404).json({ message: "Estimated time not updated" });
        }
        if (estimatedTime.TaskId) {
            // Fire-and-forget: a remaining-time recalc failure must not fail
            // the (already persisted) planning row.
            Promise.resolve(updateRemainingTime(companyId, estimatedTime.TaskId))
                .catch((error) => loggerConfig.error(`updateRemainingTime after planning save failed: ${error.message || error}`));
            recordPlanChange({ companyId, actorId: req.uid, previous, saved: estimatedTime, timeZone: req.body.timeZone })
                .catch((error) => loggerConfig.error(`planning history after save failed: ${error.message || error}`));
        }
        return res.status(200).json(estimatedTime);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the estimated time.", error: error.message });
    }
}

const ESTIMATE_PERMISSION = 'task.task_estimated_hours';
const ESTIMATE_TASK_FIELDS = {
    TaskName: 1,
    Task_Priority: 1,
    TaskType: 1,
    isParentTask: 1,
    rawDescription: 1,
    descriptionBlock: 1,
    totalEstimatedTime: 1,
    ProjectID: 1,
    tagsArray: 1,
};

const refusal = (code, statusText) => ({ refused: { code, body: { status: false, statusText } } });

/* The task as the estimator should see it, once the caller may open it and edit its estimate. The
 * description is read from the stored task, not the client's copy, which can lag behind a save. */
async function estimateInput(req) {
    const companyId = req.headers['companyid'];
    const taskId = req.params.tid;
    if (!companyId) return refusal(400, 'companyId header required');
    if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) return refusal(400, 'valid taskId required');

    const found = await visibleTask({ companyId, uid: req.uid, taskId, projection: ESTIMATE_TASK_FIELDS });
    if (!found || !found._id) return refusal(404, TASK_NOT_FOUND);
    const permission = await evaluatePermission(companyId, req.uid, ESTIMATE_PERMISSION, { projectId: String(found.ProjectID) });
    if (!isWritable(permission)) return refusal(403, 'You do not have permission to change this estimate.');

    // A plain object: a Mongoose document drops the subtaskTitles attached below.
    const task = typeof found.toObject === 'function' ? found.toObject() : { ...found };

    const description = (aiEstimatorInternal && typeof aiEstimatorInternal.extractDescription === 'function')
        ? aiEstimatorInternal.extractDescription(task)
        : null;
    if (description !== null && !String(description).trim()) {
        return { refused: { code: 200, body: { status: false, statusText: 'Please add a task description before generating an AI estimate' } } };
    }

    if (task.isParentTask !== false) {
        const subs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ ParentTaskId: String(taskId), deletedStatusKey: { $in: [0, undefined] } }, { TaskName: 1 }, { limit: 50 }],
        }, 'find').catch(() => []);
        if (Array.isArray(subs) && subs.length) {
            task.subtaskTitles = subs.map((s) => (s && s.TaskName ? String(s.TaskName) : '')).filter(Boolean);
        }
    }
    return { companyId, taskId, task };
}

const estimateData = (result) => ({
    minutes: result.minutes,
    optimistic: result.optimistic,
    likely: result.likely,
    pessimistic: result.pessimistic,
    confidence: result.confidence,
    work_items: result.work_items,
    reasoning: result.reasoning,
    basedOnSamples: result.basedOnSamples,
});

const estimateFailed = (res, name, error) => {
    loggerConfig.error(`${name} error: ${error && error.message ? error.message : error}`);
    return res.status(500).json({
        status: false,
        statusText: 'An error occurred while generating the AI estimate.',
        error: error && error.message ? error.message : String(error),
    });
};

/* Writes the estimate straight away. The task sidebar now proposes first and applies through the normal
 * estimate update; this stays for any caller that still asks for the direct write. */
exports.generateAiEstimate = async (req, res) => {
    try {
        const input = await estimateInput(req);
        if (input.refused) return res.status(input.refused.code).json(input.refused.body);

        const { userName, userId } = req.body || {};
        const userData = userId ? { id: String(userId), Employee_Name: userName || 'AlianHub AI' } : undefined;
        const result = await estimateTaskTimeWithAI({ companyId: input.companyId, taskId: input.taskId, task: input.task, force: true, userData });
        if (!result.status) {
            return res.status(400).json({ status: false, statusText: result.reason || 'estimate not generated' });
        }
        return res.status(200).json({
            status: true,
            statusText: 'Estimate generated successfully',
            data: { totalEstimatedTime: result.minutes, ...estimateData(result) },
        });
    } catch (error) {
        return estimateFailed(res, 'generateAiEstimate', error);
    }
};

exports.proposeAiEstimate = async (req, res) => {
    try {
        const input = await estimateInput(req);
        if (input.refused) return res.status(input.refused.code).json(input.refused.body);

        const result = await proposeEstimate({ companyId: input.companyId, task: input.task });
        if (!result.status) {
            return res.status(400).json({ status: false, statusText: result.reason || 'estimate not generated' });
        }
        const previous = Number(input.task.totalEstimatedTime);
        return res.status(200).json({
            status: true,
            statusText: 'Estimate proposed',
            data: { ...estimateData(result), previousMinutes: Number.isFinite(previous) ? previous : 0 },
        });
    } catch (error) {
        return estimateFailed(res, 'proposeAiEstimate', error);
    }
};

exports.getEstimateByAggregate = async (req,res) => {
    try {
        const companyId = req.headers['companyid'];
        const queryeta = req.body && req.body.queryeta;
        const scope = await resolveSheetScope(companyId, req.uid, ESTIMATE_SCOPE_PERMISSIONS);
        let pipeline;
        try {
            /* replaceObjectKey rebuilds every object, so it runs before the guard adds ObjectIds. */
            pipeline = await withJoinScope(companyId, scope, queryeta, (joinScope) => scopeEstimatePipeline(replaceObjectKey(queryeta, ["dbDate"]), joinScope));
        } catch (error) {
            if (!(error instanceof TimesheetQueryRefused)) throw error;
            return res.status(400).json({ status: false, statusText: "Bad Request", message: error.message });
        }

        const estimateData = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ESTIMATES_TIME, data: [pipeline] }, 'aggregate');

        if (!estimateData) {
            return res.status(404).json({ message: "Estimated time not found" });
        }

        res.status(200).json(estimateData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the estimated time.", error: error.message });
    }
}