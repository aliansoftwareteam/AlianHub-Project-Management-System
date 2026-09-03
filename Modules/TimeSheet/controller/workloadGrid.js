const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { removeCache } = require('../../../utils/commonFunctions');
const R = require('../helpers/weekRules');

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const safeZone = (z) => (z && DateTime.local().setZone(z).isValid ? z : 'UTC');
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayBounds = (day) => ({ start: new Date(`${day}T00:00:00.000Z`), end: new Date(`${day}T23:59:59.999Z`) });

const nameMap = async (userIds) => {
    const ids = userIds.map(oid).filter(Boolean);
    if (!ids.length) return {};
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS,
        data: [{ _id: { $in: ids } }, { Employee_Name: 1, Employee_Email: 1, Employee_profileImageURL: 1 }],
    }, 'find').catch(() => []);
    const map = {};
    (users || []).forEach((u) => {
        map[String(u._id)] = { name: u.Employee_Name || u.Employee_Email || '', avatar: u.Employee_profileImageURL || '' };
    });
    return map;
};

// POST /api/v1/timesheet/workload-grid  body: { start, end, userIds?, projectIds?, hoursPerDay?, timeZone? }
// People × days: estimate chips (estimated_time) and logged minutes against capacity (working hours − approved PTO).
exports.getWorkloadGrid = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const b = req.body || {};
        if (!isDay(b.start) || !isDay(b.end)) return res.status(400).json({ status: false, statusText: 'start and end (YYYY-MM-DD) are required.' });
        const days = R.dayKeys(b.start, b.end);
        if (!days.length) return res.status(400).json({ status: false, statusText: 'end must be on or after start.' });
        const zone = safeZone(b.timeZone);
        const hoursPerDay = Number(b.hoursPerDay) > 0 ? Number(b.hoursPerDay) : 8;
        const roleType = await getRoleType(companyId, req.uid);
        const privileged = isPrivileged(roleType);

        let userIds = Array.isArray(b.userIds) ? b.userIds.map(String).filter(Boolean) : [];
        if (!userIds.length) {
            if (privileged) {
                const members = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1 }],
                }, 'find').catch(() => []);
                userIds = [...new Set((members || []).map((m) => String(m.userId)).filter(Boolean))];
            } else {
                userIds = [String(req.uid)];
            }
        }
        const projectIds = Array.isArray(b.projectIds) ? b.projectIds.map(String).filter(Boolean) : [];
        const rangeStart = new Date(`${b.start}T00:00:00.000Z`);
        const rangeEnd = new Date(`${b.end}T23:59:59.999Z`);
        const startSec = Math.floor(DateTime.fromISO(b.start, { zone }).startOf('day').toSeconds());
        const endSec = Math.floor(DateTime.fromISO(b.end, { zone }).endOf('day').toSeconds());

        const estMatch = { UserId: { $in: userIds }, Date: { $gte: rangeStart, $lte: rangeEnd } };
        const logMatch = { Loggeduser: { $in: userIds }, LogStartTime: { $gte: startSec, $lte: endSec } };
        if (projectIds.length) { estMatch.ProjectId = { $in: projectIds }; logMatch.ProjectId = { $in: projectIds }; }

        const [estimates, logs, ptoRows, names] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ESTIMATES_TIME, data: [estMatch, { UserId: 1, TaskId: 1, ProjectId: 1, Date: 1, EstimatedTime: 1 }] }, 'find').catch(() => []),
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [logMatch, { Loggeduser: 1, LogStartTime: 1, LogTimeDuration: 1 }] }, 'find').catch(() => []),
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PTO_ENTRIES, data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: rangeEnd }, endDate: { $gte: rangeStart } }] }, 'find').catch(() => []),
            nameMap(userIds),
        ]);

        const taskIds = [...new Set((estimates || []).map((e) => String(e.TaskId || '')).filter(Boolean))];
        const tasks = taskIds.length ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: { $in: taskIds.map(oid).filter(Boolean) } }, { TaskName: 1, ProjectID: 1, sprintId: 1, DueDate: 1, AssigneeUserId: 1 }],
        }, 'find').catch(() => []) : [];
        const taskById = {};
        (tasks || []).forEach((t) => { taskById[String(t._id)] = t; });
        const projById = {};
        const pids = [...new Set((estimates || []).map((e) => String(e.ProjectId || '')).filter(Boolean))].map(oid).filter(Boolean);
        if (pids.length) {
            const projects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: pids } }, { ProjectName: 1, projectIcon: 1 }] }, 'find').catch(() => []);
            (projects || []).forEach((p) => { projById[String(p._id)] = p; });
        }

        const chipsByUser = {};
        (estimates || []).forEach((e) => {
            const uid = String(e.UserId || '');
            const day = R.isoDay(new Date(e.Date));
            const t = taskById[String(e.TaskId)];
            const p = projById[String(e.ProjectId)];
            const perUser = chipsByUser[uid] || (chipsByUser[uid] = {});
            (perUser[day] || (perUser[day] = [])).push({
                estimateId: String(e._id),
                taskId: String(e.TaskId || ''),
                name: t ? t.TaskName || '' : '',
                projectId: String(e.ProjectId || ''),
                projectName: p ? p.ProjectName || '' : '',
                projectColor: p && p.projectIcon && p.projectIcon.type === 'color' ? p.projectIcon.data : '',
                sprintId: t ? String(t.sprintId || '') : '',
                minutes: Number(e.EstimatedTime) || 0,
            });
        });
        const loggedByUser = {};
        (logs || []).forEach((l) => {
            const uid = String(l.Loggeduser || '');
            const day = DateTime.fromSeconds(Number(l.LogStartTime) || 0, { zone }).toISODate();
            const perUser = loggedByUser[uid] || (loggedByUser[uid] = {});
            perUser[day] = (perUser[day] || 0) + (Number(l.LogTimeDuration) || 0);
        });
        const ptoByUser = {};
        (ptoRows || []).forEach((p) => { (ptoByUser[String(p.userId)] = ptoByUser[String(p.userId)] || []).push(p); });

        const users = userIds.map((uid) => {
            const grid = R.workloadDays({
                days, hoursPerDay,
                ptoDays: R.ptoDaysIn(ptoByUser[uid] || [], days),
                chipsByDay: chipsByUser[uid] || {},
                loggedByDay: loggedByUser[uid] || {},
            });
            return { userId: uid, name: (names[uid] && names[uid].name) || '', avatar: (names[uid] && names[uid].avatar) || '', hoursPerDay, ...grid };
        }).sort((a, b) => b.utilizationPct - a.utilizationPct);

        return res.json({ status: true, statusText: 'OK', data: { start: b.start, end: b.end, days, hoursPerDay, users } });
    } catch (e) {
        logger.error(`getWorkloadGrid: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};

// POST /api/v1/timesheet/workload-move  body: { taskId, estimateId?, fromUserId, toUserId, fromDate, toDate, userData? }
// Drag-and-drop rebalance: moves the planned (estimated_time) allocation and mirrors the change
// onto the task's due date / assignee so the plan and the task agree.
exports.moveWorkloadChip = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const b = req.body || {};
        const taskId = oid(b.taskId);
        if (!taskId) return res.status(400).json({ status: false, statusText: 'A valid taskId is required.' });
        if (!isDay(b.fromDate) || !isDay(b.toDate)) return res.status(400).json({ status: false, statusText: 'fromDate and toDate (YYYY-MM-DD) are required.' });
        const fromUserId = String(b.fromUserId || '');
        const toUserId = String(b.toUserId || fromUserId);
        if (!fromUserId || !toUserId) return res.status(400).json({ status: false, statusText: 'fromUserId and toUserId are required.' });
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType) && (fromUserId !== String(req.uid) || toUserId !== String(req.uid))) {
            return res.status(403).json({ status: false, statusText: 'Only an owner or admin can move work between people.' });
        }
        const sameUser = fromUserId === toUserId;
        const sameDate = b.fromDate === b.toDate;
        if (sameUser && sameDate) return res.json({ status: true, statusText: 'Nothing to move.', data: null });

        const from = dayBounds(b.fromDate);
        const estimateFilter = b.estimateId && oid(b.estimateId)
            ? { _id: oid(b.estimateId) }
            : { TaskId: String(b.taskId), UserId: fromUserId, Date: { $gte: from.start, $lte: from.end } };
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.ESTIMATES_TIME,
            data: [estimateFilter, { $set: { UserId: toUserId, Date: dayBounds(b.toDate).start } }],
        }, 'updateMany');

        const task = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }] }, 'findOne');
        if (!task) return res.status(404).json({ status: false, statusText: 'Task not found.' });
        const set = {};
        if (!sameDate) set.DueDate = dayBounds(b.toDate).end;
        if (!sameUser) {
            const assignees = Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId.map(String) : [];
            const next = assignees.filter((a) => a !== fromUserId);
            if (!next.includes(toUserId)) next.push(toUserId);
            set.AssigneeUserId = next;
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: taskId }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');

        removeCache(String(b.taskId), true);
        socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: set, module: 'task' });
        socketEmitter.emit('update', { type: 'update', data: { taskId: String(b.taskId), fromUserId, toUserId, fromDate: b.fromDate, toDate: b.toDate }, module: 'estimatedTime' });
        return res.json({ status: true, statusText: 'Work moved.', data: { taskId: String(b.taskId), updatedFields: set } });
    } catch (e) {
        logger.error(`moveWorkloadChip: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
