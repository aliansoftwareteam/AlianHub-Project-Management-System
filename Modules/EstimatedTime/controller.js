const { default: mongoose } = require("mongoose");
const loggerConfig = require("../../Config/loggerConfig");
const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries");
const { replaceObjectKey } = require("../Auth/helper");
const socketEmitter = require("../../event/socketEventEmitter");
const { estimateAndPersist: estimateTaskTimeWithAI } = require("./aiTaskEstimator");
// BUG fix (found via MCP integration 2026-06-12): updateEstimatedTime called
// `exports.updateRemainingTime`, which was never defined in this module —
// every Task Planning save threw "not a function" AFTER persisting the row,
// returning a 500 for a write that had actually succeeded. The real helper
// lives in the LogTime module.
const { updateRemainingTime } = require("../LogTime/controllerV2/helpers");

exports.getEstimatedTime = async(req,res) => {
    try {
        const projectId = req.params.pid;
        const TaskId = req.params.tid;

        const estimatedObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [
                {
                    "ProjectId": projectId,
                    "TaskId": TaskId
                }
            ]
        };

        const estimatedTime =  await MongoDbCrudOpration(req.headers['companyid'], estimatedObj, 'find');

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
        let key = req.body.key;
        let newObj = req.body.newObj || {}

        let data =  [
            req.body.compareObj, 
            {
                [key]: req.body.updateObject
            },
            newObj,
        ]

        let mongoObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: data
        }
        const estimatedTime = await MongoDbCrudOpration(req.headers['companyid'], mongoObj, 'findOneAndUpdate');

        if (!estimatedTime) {
            return res.status(400).json({ message: "Estimated time not updated" });
        }
        if (estimatedTime.TaskId) {
            // Fire-and-forget: a remaining-time recalc failure must not fail
            // the (already persisted) planning row.
            Promise.resolve(updateRemainingTime(req.headers['companyid'], estimatedTime.TaskId))
                .catch((error) => loggerConfig.error(`updateRemainingTime after planning save failed: ${error.message || error}`));
        }
        return res.status(200).json(estimatedTime);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while updating the estimated time.", error: error.message });
    }
}

// Manual AI estimate trigger — invoked from the task detail sidebar's
// "Generate estimate using AI" icon button. Unlike the post-create
// auto-estimate (which silently no-ops if a value already exists), this
// endpoint always recalculates because the user explicitly asked for it.
// The estimator helper does the LLM call, clamping, persistence, and
// Socket.io emit, so this controller just orchestrates and returns.
exports.generateAiEstimate = async (req, res) => {
    try {
        const companyId = req.headers['companyid'];
        const taskId = req.params.tid;

        if (!companyId) {
            return res.status(400).json({ status: false, statusText: 'companyId header required' });
        }
        if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ status: false, statusText: 'valid taskId required' });
        }

        // Fetch the task with just the fields the estimator needs so the
        // payload to the LLM is built from the canonical DB state — not
        // from whatever stale shape the client happened to send. ProjectID +
        // tagsArray feed the historical-actuals grounding/calibration; the
        // rest feed the prompt.
        const taskObj = {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: new mongoose.Types.ObjectId(taskId) },
                {
                    TaskName: 1,
                    Task_Priority: 1,
                    TaskType: 1,
                    isParentTask: 1,
                    rawDescription: 1,
                    descriptionBlock: 1,
                    totalEstimatedTime: 1,
                    ProjectID: 1,
                    tagsArray: 1,
                },
            ],
        };
        const taskDocRaw = await MongoDbCrudOpration(companyId, taskObj, 'findOne');
        if (!taskDocRaw || !taskDocRaw._id) {
            return res.status(404).json({ status: false, statusText: 'task not found' });
        }
        // Work with a plain object so we can attach derived fields (e.g.
        // subtaskTitles) that aren't part of the task schema — a Mongoose doc
        // would silently drop unknown-path assignments.
        const taskDoc = (typeof taskDocRaw.toObject === 'function')
            ? taskDocRaw.toObject()
            : taskDocRaw;

        // Subtask rollup (richer input): if this is a parent task, attach its
        // subtasks' titles so the model accounts for the work they represent.
        // Best-effort and capped — a failure here must not block the estimate.
        if (taskDoc.isParentTask !== false) {
            try {
                const subs = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.TASKS,
                    data: [
                        {
                            ParentTaskId: String(taskId),
                            deletedStatusKey: { $in: [0, undefined] },
                        },
                        { TaskName: 1 },
                        { limit: 50 },
                    ],
                }, 'find').catch(() => []);
                if (Array.isArray(subs) && subs.length) {
                    taskDoc.subtaskTitles = subs
                        .map((s) => (s && s.TaskName ? String(s.TaskName) : ''))
                        .filter(Boolean);
                }
            } catch (_e) { /* subtask rollup is best-effort */ }
        }

        // Actor for the activity-log entry the estimator writes. The client
        // sends the logged-in user so the "updated estimated time" history row
        // is attributed to whoever clicked the AI trigger (and so HISTORY.UserId
        // — a required String — is never blank). Falls back to undefined when
        // absent, in which case the estimator skips the log rather than failing.
        const { userName, userId } = req.body || {};
        const userData = userId
            ? { id: String(userId), Employee_Name: userName || 'AlianHub AI' }
            : undefined;

        const result = await estimateTaskTimeWithAI({
            companyId,
            taskId,
            task: taskDoc,
            force: true,
            userData,
        });

        if (!result.status) {
            return res.status(400).json({
                status: false,
                statusText: result.reason || 'estimate not generated',
            });
        }
        // Return the full ranged estimate so the UI can surface the
        // optimistic/likely/pessimistic range + confidence. `totalEstimatedTime`
        // (the persisted point estimate) is kept exactly as before for any
        // existing consumer of this response.
        return res.status(200).json({
            status: true,
            statusText: 'Estimate generated successfully',
            data: {
                totalEstimatedTime: result.minutes,
                minutes: result.minutes,
                optimistic: result.optimistic,
                likely: result.likely,
                pessimistic: result.pessimistic,
                confidence: result.confidence,
                work_items: result.work_items,
                reasoning: result.reasoning,
                basedOnSamples: result.basedOnSamples,
            },
        });
    } catch (error) {
        loggerConfig.error(`generateAiEstimate error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            statusText: 'An error occurred while generating the AI estimate.',
            error: error && error.message ? error.message : String(error),
        });
    }
};

exports.getEstimateByAggregate = async (req,res) => {
    try {
        const query = replaceObjectKey(req.body.queryeta, ["dbDate"])

        const estObj = {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [query]
        };
        const estimateData = await MongoDbCrudOpration(req.headers['companyid'], estObj, 'aggregate');

        if (!estimateData) {
            return res.status(404).json({ message: "Estimated time not found" });
        }

        res.status(200).json(estimateData);
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the estimated time.", error: error.message });
    }
}