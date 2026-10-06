// Sprint velocity. Committed versus completed story points across a project's
// most recent closed sprints, plus a rolling-3 average, so the numbers can be
// used to size the next sprint. Read-only; no new collections or cron.
//
// Only real, completed sprints count. Two reasons this used to be wrong:
//
//   1. It took EVERY non-deleted doc in the sprints collection, and that
//      collection also holds chat channels and Forms response lists — they
//      appeared as bars on the velocity chart.
//   2. Committed was read as the sprint's CURRENT total points, which makes it
//      equal to scope by construction: a sprint that doubled in size mid-flight
//      showed committed == completed + whatever is left, and scope creep was
//      mathematically invisible. Committed now comes from the snapshot taken
//      when the sprint started.
//
// A closed sprint with no snapshot (started before this existed) is skipped
// rather than reported as having committed to zero.
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

        const sprints = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [
                {
                    projectId: projectObjId,
                    deletedStatusKey: { $ne: 1 },
                    isScrum: true,
                    state: 'closed',
                    mainChat: { $ne: true },
                    isBacklog: { $ne: true },
                },
                '_id name createdAt startDate endDate commitment closeReport',
            ],
        }, 'find');

        const measurable = (sprints || []).filter((s) => s.commitment && s.commitment.at);

        if (!measurable.length) {
            return res.send({
                status: true,
                statusText: 'No completed sprints yet.',
                data: { sprints: [], skipped: (sprints || []).length },
            });
        }

        // By when the sprint ran, not when its container happened to be made.
        const ordered = measurable
            .slice()
            .sort((a, b) => new Date(a.startDate || a.createdAt) - new Date(b.startDate || b.createdAt))
            .slice(-limit);

        const sprintIds = ordered.map((s) => s._id);
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { sprintId: { $in: sprintIds }, deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true },
                '_id sprintId points statusType',
            ],
        }, 'find');

        const completedBySprint = new Map();
        ordered.forEach((s) => completedBySprint.set(String(s._id), 0));
        (tasks || []).forEach((t) => {
            if (t.statusType !== DONE_TYPE) return;
            const key = String(t.sprintId);
            if (!completedBySprint.has(key)) return;
            completedBySprint.set(key, completedBySprint.get(key) + (Number(t.points) || 0));
        });

        const rows = ordered.map((s) => ({
            sprintId: String(s._id),
            name: s.name || 'Sprint',
            startDate: s.startDate || null,
            endDate: s.endDate || null,
            committed: Number(s.commitment.points) || 0,
            completed: completedBySprint.get(String(s._id)) || 0,
        }));

        // Rolling-3 average of completed points.
        const withAvg = rows.map((row, i) => {
            const window = rows.slice(Math.max(0, i - 2), i + 1);
            const avg = window.reduce((sum, r) => sum + r.completed, 0) / window.length;
            return { ...row, rollingAvg: Math.round(avg * 10) / 10 };
        });

        return res.send({
            status: true,
            statusText: 'Velocity computed.',
            data: { sprints: withAvg, skipped: (sprints || []).length - measurable.length },
        });
    } catch (error) {
        logger.error(`ERROR in agile velocity: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
