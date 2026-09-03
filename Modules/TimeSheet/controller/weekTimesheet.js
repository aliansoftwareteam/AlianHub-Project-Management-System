const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { removeCache } = require('../../../utils/commonFunctions');
const { parsePeriod } = require('../../TimesheetApproval/helpers/approvalRules');
const R = require('../helpers/weekRules');

const RUNNING_WINDOW_SEC = 10 * 60;
const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId) || (req.body && req.body.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const safeZone = (z) => (z && DateTime.local().setZone(z).isValid ? z : 'UTC');

const projectMeta = (p) => ({
    projectName: p ? p.ProjectName || '' : '',
    projectCode: p ? p.ProjectCode || '' : '',
    projectColor: p && p.projectIcon && p.projectIcon.type === 'color' ? p.projectIcon.data : '',
});

const loadProjects = async (companyId, ids) => {
    const objIds = [...new Set(ids.filter(Boolean))].map(oid).filter(Boolean);
    if (!objIds.length) return {};
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [{ _id: { $in: objIds } }, { ProjectName: 1, ProjectCode: 1, projectIcon: 1 }],
    }, 'find').catch(() => []);
    const byId = {};
    (projects || []).forEach((p) => { byId[String(p._id)] = p; });
    return byId;
};

const approvalFor = async (companyId, userId, start, end) => {
    const period = parsePeriod({ periodStart: start, periodEnd: end });
    if (!period.valid) return null;
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
        data: [{ userId, periodStart: period.periodStart, periodEnd: period.periodEnd, deletedStatusKey: 0 }],
    }, 'findOne').catch(() => null);
};

// GET /api/v1/timesheet/week?start=&end=&userId=&projectId=&hoursPerDay=&timeZone=
exports.getWeekTimesheet = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const q = req.query || {};
        if (!q.start || !q.end) return res.status(400).json({ status: false, statusText: 'start and end are required.' });
        const zone = safeZone(q.timeZone);
        const startDt = DateTime.fromISO(String(q.start), { zone }).startOf('day');
        const endDt = DateTime.fromISO(String(q.end), { zone }).endOf('day');
        if (!startDt.isValid || !endDt.isValid || endDt < startDt) {
            return res.status(400).json({ status: false, statusText: 'start and end must be valid dates.' });
        }
        const roleType = await getRoleType(companyId, req.uid);
        const userId = isPrivileged(roleType) && q.userId ? String(q.userId) : String(req.uid);
        const hoursPerDay = Number(q.hoursPerDay) > 0 ? Number(q.hoursPerDay) : 8;
        const days = R.dayKeys(q.start, q.end);

        const match = { Loggeduser: userId, LogStartTime: { $gte: Math.floor(startDt.toSeconds()), $lte: Math.floor(endDt.toSeconds()) } };
        if (q.projectId) match.ProjectId = String(q.projectId);
        const entries = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [match, { TicketID: 1, ProjectId: 1, LogTimeDuration: 1, LogStartTime: 1, billable: 1 }],
        }, 'find') || [];
        const dayOf = (e) => DateTime.fromSeconds(Number(e.LogStartTime) || 0, { zone }).toISODate();
        const rows = R.groupEntriesByTask(entries, dayOf);

        const taskIds = rows.map((r) => oid(r.taskId)).filter(Boolean);
        const tasks = taskIds.length ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: taskIds } }, { TaskName: 1, ProjectID: 1, sprintId: 1 }],
        }, 'find').catch(() => []) : [];
        const taskById = {};
        (tasks || []).forEach((t) => { taskById[String(t._id)] = t; });
        rows.forEach((r) => {
            const t = taskById[r.taskId];
            r.taskName = t ? t.TaskName || '' : '';
            r.sprintId = t ? String(t.sprintId || '') : '';
            if (!r.projectId && t) r.projectId = String(t.ProjectID || '');
        });
        const projectById = await loadProjects(companyId, rows.map((r) => r.projectId));
        rows.forEach((r) => Object.assign(r, projectMeta(projectById[r.projectId])));

        const ptoRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{ userId, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: new Date(q.end) }, endDate: { $gte: new Date(q.start) } }],
        }, 'find').catch(() => []);
        const dayCaps = R.dayCapacity({ days, hoursPerDay, ptoDays: R.ptoDaysIn(ptoRows, days) });
        const totals = R.totals(rows, days);
        const today = DateTime.now().setZone(zone).toISODate();

        const prevStart = startDt.minus({ days: days.length }).toISODate();
        const prevEnd = endDt.minus({ days: days.length }).toISODate();
        const [current, previous, running] = await Promise.all([
            approvalFor(companyId, userId, q.start, q.end),
            approvalFor(companyId, userId, prevStart, prevEnd),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ Loggeduser: userId, startTimeTracker: { $gte: Math.floor(Date.now() / 1000) - RUNNING_WINDOW_SEC } }, { TicketID: 1, ProjectId: 1, LogStartTime: 1, LogDescription: 1 }],
            }, 'findOne').catch(() => null),
        ]);

        return res.json({
            status: true,
            statusText: 'OK',
            data: {
                userId,
                zone,
                hoursPerDay,
                days: dayCaps,
                rows,
                totals: { ...totals, capacityMinutes: dayCaps.reduce((s, d) => s + d.capacityMinutes, 0) },
                underCapacity: R.underCapacityDays(dayCaps, totals.byDay, today),
                approval: { current: current || null, previous: previous || null, previousPeriod: { start: prevStart, end: prevEnd } },
                running: running ? {
                    timeSheetId: String(running._id),
                    taskId: String(running.TicketID || ''),
                    projectId: String(running.ProjectId || ''),
                    startedAt: (Number(running.LogStartTime) || 0) * 1000,
                    note: running.LogDescription || '',
                } : null,
            },
        });
    } catch (e) {
        logger.error(`getWeekTimesheet: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};

// PUT /api/v1/timesheet/entries/billable  body: { entryIds: [], billable }
exports.setEntriesBillable = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const { entryIds, billable } = req.body || {};
        const ids = Array.isArray(entryIds) ? entryIds.map(oid).filter(Boolean) : [];
        if (!ids.length) return res.status(400).json({ status: false, statusText: 'entryIds are required.' });
        const roleType = await getRoleType(companyId, req.uid);
        const filter = { _id: { $in: ids } };
        if (!isPrivileged(roleType)) filter.Loggeduser = String(req.uid);
        const result = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [filter, { $set: { billable: billable !== false } }],
        }, 'updateMany');
        removeCache(`timesheet:${companyId}`, true);
        socketEmitter.emit('update', { type: 'update', data: { entryIds: ids.map(String), billable: billable !== false }, module: 'timesheet' });
        return res.json({ status: true, statusText: 'Billable updated.', data: { updated: result && result.modifiedCount, billable: billable !== false } });
    } catch (e) {
        logger.error(`setEntriesBillable: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
