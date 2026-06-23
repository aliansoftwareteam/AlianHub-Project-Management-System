const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/varianceRules');

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId);

// GET /api/v1/reports/variance?projectId=&sprintId=
// Estimate (tasks.totalEstimatedTime) vs actual (sum of timesheets.LogTimeDuration
// by TicketID), per task + rolled up. Everything in minutes. companyId-scoped.
exports.getVarianceReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const q = req.query || {};
        if (!q.projectId && !q.sprintId) {
            return res.status(400).json({ status: false, statusText: 'projectId or sprintId is required.' });
        }
        const match = { deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true };
        if (q.projectId) match.ProjectID = String(q.projectId);
        if (q.sprintId) match.sprintId = String(q.sprintId);

        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [match, '_id TaskName ProjectID sprintId statusType points totalEstimatedTime'],
        }, 'find');

        const taskIds = (tasks || []).map((t) => String(t._id));
        const loggedByTask = {};
        if (taskIds.length) {
            const logs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ TicketID: { $in: taskIds } }, { TicketID: 1, LogTimeDuration: 1 }],
            }, 'find').catch(() => []);
            (logs || []).forEach((l) => {
                if (!l.TicketID) return;
                const k = String(l.TicketID);
                loggedByTask[k] = (loggedByTask[k] || 0) + (Number(l.LogTimeDuration) || 0);
            });
        }

        const rows = (tasks || []).map((t) => {
            const v = R.taskVariance(t.totalEstimatedTime, loggedByTask[String(t._id)] || 0);
            return {
                taskId: String(t._id),
                name: t.TaskName || '(untitled)',
                sprintId: String(t.sprintId || ''),
                statusType: t.statusType || '',
                points: t.points || 0,
                ...v,
            };
        });
        const totals = R.rollup(rows);
        return res.json({ status: true, data: { totals, tasks: rows } });
    } catch (e) { logger.error(`getVarianceReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
