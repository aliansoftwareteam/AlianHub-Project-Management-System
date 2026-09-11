const { SCHEMA_TYPE } = require("../../Config/schemaType");
const { MongoDbCrudOpration } = require("../../utils/mongo-handler/mongoQueries.js");
const { evaluatePermission } = require("../../Config/permissionGuard");
const logger = require("../../Config/loggerConfig");
const { visibleProjectIds } = require("../Agents/scope");

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/* The bar the UI already draws: a project's log needs the project list to be anything
 * but None, a task's log needs Task Activity Log switched on (TaskDetailPanel canSeeHistory). */
const canReadLog = (permission, forTask) => (forTask ? permission === true : permission !== null && permission !== undefined);

exports.getActivityLog = async (req, res) => {
    const { fromProject, projectId, taskId, skip, limit } = req.query;
    const forTask = fromProject === 'false';

    try {
        const companyId = req.headers['companyid'] || '';
        const uid = String(req.uid || '');
        if (!OBJECT_ID.test(String(projectId || '')) || (forTask && !taskId)) {
            return res.status(400).json({ status: false, statusText: 'A valid projectId is required.' });
        }

        const visible = await visibleProjectIds(companyId, uid);
        if (!visible.map(String).includes(String(projectId))) {
            return res.status(404).json({ status: false, statusText: 'Project not found.' });
        }
        const permission = await evaluatePermission(companyId, uid, forTask ? 'task.task_activity_log' : 'project.project_list', { projectId });
        if (!canReadLog(permission, forTask)) {
            return res.status(403).json({ status: false, statusText: 'You do not have permission to view this activity log.' });
        }

        const match = forTask
            ? { $and: [{ Type: { $ne: "project" } }, { ProjectId: String(projectId) }, { TaskId: String(taskId) }] }
            : { $and: [{ Type: "project" }, { ProjectId: String(projectId) }] };
        const pipeline = [
            { $match: match },
            { $sort: { createdAt: -1, _id: 1 } },
            { $skip: Math.max(0, parseInt(skip, 10) || 0) },
            { $limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT)) },
        ];

        const response = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.HISTORY, data: [[pipeline]] }, "aggregate");
        return res.status(200).json(response);
    } catch (error) {
        logger.error(`ERROR in getting activity log of ${forTask ? 'task' : 'project'}: ${error.message}`);
        return res.status(500).json({ status: false, statusText: "An error occurred while fetching the activity log", message: error.message });
    }
};
