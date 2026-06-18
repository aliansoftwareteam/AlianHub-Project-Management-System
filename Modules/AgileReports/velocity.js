// Sprint velocity (S4-02). Completed story points per sprint for the most
// recent N sprints of a project, plus a rolling-3 average. Computed on-the-fly
// from current task state — committed = total points in the sprint, completed =
// points of tasks currently in a done-category status (statusType 'close').
// Read-only; no new collections or cron.
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const DONE_TYPE = 'close';

/* GET /api/v1/agile/velocity?projectId=&limit=10  (companyId from header) */
exports.getVelocity = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String((req.query && req.query.projectId) || '');
        const limit = Math.min(50, Math.max(1, Number(req.query && req.query.limit) || 10));
        if (!companyId || !OBJECT_ID_PATTERN.test(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        const projectObjId = new mongoose.Types.ObjectId(projectId);

        // All non-deleted sprints for this project.
        const sprints = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                { projectId: projectObjId, deletedStatusKey: { $ne: 1 } },
                '_id name createdAt deletedStatusKey',
            ],
        }, 'find');

        if (!sprints || !sprints.length) {
            return res.send({ status: true, statusText: 'No sprints yet.', data: { sprints: [] } });
        }

        // Oldest-first, then keep the most recent `limit`.
        const ordered = sprints
            .slice()
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .slice(-limit);

        const sprintIds = ordered.map((s) => s._id);
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { sprintId: { $in: sprintIds }, deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true },
                '_id sprintId points statusType',
            ],
        }, 'find');

        const bySprint = new Map();
        ordered.forEach((s) => bySprint.set(String(s._id), { committed: 0, completed: 0 }));
        (tasks || []).forEach((t) => {
            const bucket = bySprint.get(String(t.sprintId));
            if (!bucket) return;
            const pts = Number(t.points) || 0;
            bucket.committed += pts;
            if (t.statusType === DONE_TYPE) bucket.completed += pts;
        });

        const rows = ordered.map((s) => {
            const b = bySprint.get(String(s._id)) || { committed: 0, completed: 0 };
            return { sprintId: String(s._id), name: s.name || 'Sprint', committed: b.committed, completed: b.completed };
        });

        // Rolling-3 average of completed points.
        const withAvg = rows.map((row, i) => {
            const window = rows.slice(Math.max(0, i - 2), i + 1);
            const avg = window.reduce((sum, r) => sum + r.completed, 0) / window.length;
            return { ...row, rollingAvg: Math.round(avg * 10) / 10 };
        });

        return res.send({ status: true, statusText: 'Velocity computed.', data: { sprints: withAvg } });
    } catch (error) {
        logger.error(`ERROR in agile velocity: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
