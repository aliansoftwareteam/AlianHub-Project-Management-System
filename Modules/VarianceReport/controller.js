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

const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const LARGE_ESTIMATE_MINUTES = 16 * 60;

// GET /api/v1/reports/variance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Estimate vs actual for the tasks worked in the window, rolled up by project and by
// person (person = who logged), plus the tasks whose estimates drifted the most.
exports.getVarianceSummary = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const q = req.query || {};
        const from = new Date(q.from ? `${String(q.from).slice(0, 10)}T00:00:00.000Z` : NaN);
        const to = new Date(q.to ? `${String(q.to).slice(0, 10)}T23:59:59.999Z` : NaN);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
            return res.status(400).json({ status: false, statusText: 'from and to must be valid dates.' });
        }
        const logs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [{ LogStartTime: { $gte: Math.floor(from.getTime() / 1000), $lte: Math.floor(to.getTime() / 1000) } }, { TicketID: 1, Loggeduser: 1, ProjectId: 1, LogTimeDuration: 1 }],
        }, 'find').catch(() => []);
        const actualByTask = {};
        const actualByUser = {};
        const actualByUserTask = {};
        (logs || []).forEach((l) => {
            const t = String(l.TicketID || '');
            const u = String(l.Loggeduser || '');
            const m = Number(l.LogTimeDuration) || 0;
            if (t) actualByTask[t] = (actualByTask[t] || 0) + m;
            if (u) actualByUser[u] = (actualByUser[u] || 0) + m;
            if (t && u) actualByUserTask[`${u}|${t}`] = (actualByUserTask[`${u}|${t}`] || 0) + m;
        });
        const taskIds = Object.keys(actualByTask).map(oid).filter(Boolean);
        const tasks = taskIds.length ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: taskIds } }, { TaskName: 1, ProjectID: 1, totalEstimatedTime: 1, rawDescription: 1, estimateChangedFlag: 1, AssigneeUserId: 1 }],
        }, 'find').catch(() => []) : [];

        const rows = (tasks || []).map((t) => ({
            taskId: String(t._id),
            name: t.TaskName || '(untitled)',
            projectId: String(t.ProjectID || ''),
            hasDescription: !!(t.rawDescription && String(t.rawDescription).trim()),
            estimateChanged: !!t.estimateChangedFlag,
            assignees: Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId.length : 0,
            ...R.taskVariance(t.totalEstimatedTime, actualByTask[String(t._id)] || 0),
        }));
        const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))].map(oid).filter(Boolean);
        const userIds = Object.keys(actualByUser).map(oid).filter(Boolean);
        const [projects, users] = await Promise.all([
            projectIds.length ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: projectIds } }, { ProjectName: 1, projectIcon: 1 }] }, 'find').catch(() => []) : [],
            userIds.length ? MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: userIds } }, { Employee_Name: 1, Employee_Email: 1 }] }, 'find').catch(() => []) : [],
        ]);
        const projectName = {};
        (projects || []).forEach((p) => { projectName[String(p._id)] = p.ProjectName || ''; });
        const userName = {};
        (users || []).forEach((u) => { userName[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; });

        // Per person: the estimate share is the task estimate split across everyone who logged on it.
        const loggersByTask = {};
        Object.keys(actualByUserTask).forEach((k) => {
            const [u, t] = k.split('|');
            (loggersByTask[t] = loggersByTask[t] || []).push(u);
        });
        const estById = {};
        rows.forEach((r) => { estById[r.taskId] = r.estimatedMinutes; });
        const personRows = Object.keys(actualByUserTask).map((k) => {
            const [u, t] = k.split('|');
            const share = loggersByTask[t] ? loggersByTask[t].length : 1;
            return { userId: u, ...R.taskVariance((estById[t] || 0) / share, actualByUserTask[k]) };
        });

        const byProject = R.groupVariance(rows, (r) => r.projectId, (r, key) => projectName[key] || '');
        const byPerson = R.groupVariance(personRows, (r) => r.userId, (r, key) => userName[key] || '');
        const drivers = R.driftDrivers(rows, [
            { key: 'no_description', test: (r) => !r.hasDescription },
            { key: 'estimate_changed', test: (r) => r.estimateChanged },
            { key: 'multi_assignee', test: (r) => r.assignees > 1 },
            { key: 'large_estimate', test: (r) => r.estimatedMinutes >= LARGE_ESTIMATE_MINUTES },
        ]);
        const worst = R.biggestOverrun(rows);
        const largest = [...rows].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 8);
        return res.json({
            status: true,
            statusText: 'OK',
            data: {
                from: q.from, to: q.to,
                totals: R.rollup(rows),
                byProject, byPerson, drivers, largest,
                takeaway: worst ? { ...worst, projectName: projectName[worst.projectId] || '' } : null,
            },
        });
    } catch (e) { logger.error(`getVarianceSummary: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
