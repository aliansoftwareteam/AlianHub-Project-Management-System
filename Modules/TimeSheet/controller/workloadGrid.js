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
const U = require('../helpers/workloadUnits');
const { workingDaysOf, weekendOf } = require('../../Company/helpers/companyWeek');

const { sessionTenantOf, TenantError } = require('../../../Config/tenant');
const { acceptedMemberIds } = require('../../../utils/companyMembers');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { resolveSheetScope, scopedEstimateMatch, scopedTimeMatch, openProjects, SHEET_PERMISSION } = require('../helpers/timeScope');
const { withoutHiddenSprintPlans } = require('../helpers/planVisibility');
const { visibilityStage } = require('../../Tasks/helpers/taskQueryGuard');
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

const plannedMinutesByTask = async (companyId, taskIds) => {
    if (!taskIds.length) return {};
    const groups = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.ESTIMATES_TIME,
        data: [[
            { $match: { TaskId: { $in: idForms(taskIds) } } },
            { $group: { _id: { taskId: '$TaskId', userId: '$UserId' }, minutes: { $sum: '$EstimatedTime' } } },
        ]],
    }, 'aggregate').catch(() => []);
    const out = {};
    (groups || []).forEach((g) => {
        const taskId = String((g._id && g._id.taskId) || '');
        const uid = String((g._id && g._id.userId) || '');
        if (!taskId || !uid) return;
        const perTask = out[taskId] || (out[taskId] = {});
        perTask[uid] = (perTask[uid] || 0) + (Number(g.minutes) || 0);
    });
    return out;
};

const capacityByUser = async (companyId, userIds) => {
    const members = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMPANY_USERS,
        data: [{ userId: { $in: userIds }, isDelete: { $ne: true } }, { userId: 1, workloadCapacity: 1 }],
    }, 'find').catch(() => []);
    const out = {};
    (members || []).forEach((m) => { out[String(m.userId)] = U.capacityOf(m.workloadCapacity); });
    return out;
};

/* Points and count read open tasks rather than the hour plan, so a task with points and no
 * hours planned still lands on its due day. */
const unitGrid = async ({ companyId, unit, userIds, inProjects, openToCaller, days, rangeStart, rangeEnd, estimates, ptoByUser, names, workingDays }) => {
    const plannedDays = {};
    (estimates || []).forEach((e) => {
        const taskId = String(e.TaskId || '');
        const uid = String(e.UserId || '');
        if (!taskId || !uid) return;
        const perTask = plannedDays[taskId] || (plannedDays[taskId] = {});
        (perTask[uid] || (perTask[uid] = [])).push(R.isoDay(new Date(e.Date)));
    });
    const taskMatch = {
        deletedStatusKey: { $ne: 1 },
        statusType: { $ne: 'close' },
        $or: [
            { AssigneeUserId: { $in: userIds }, DueDate: { $gte: rangeStart, $lte: rangeEnd } },
            { _id: { $in: Object.keys(plannedDays).map(oid).filter(Boolean) } },
        ],
        $and: [openToCaller],
    };
    if (inProjects) taskMatch.ProjectID = inProjects;
    const [tasks, capacities] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [taskMatch, { TaskName: 1, ProjectID: 1, sprintId: 1, DueDate: 1, AssigneeUserId: 1, points: 1 }],
        }, 'find').catch(() => []),
        capacityByUser(companyId, userIds),
    ]);
    const pids = [...new Set((tasks || []).map((t) => String(t.ProjectID || '')).filter(Boolean))].map(oid).filter(Boolean);
    const [plannedMinutes, projects] = await Promise.all([
        plannedMinutesByTask(companyId, (tasks || []).map((t) => String(t._id))),
        pids.length
            ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: pids } }, { ProjectName: 1, projectIcon: 1 }] }, 'find').catch(() => [])
            : [],
    ]);
    const projectsById = {};
    (projects || []).forEach((p) => { projectsById[String(p._id)] = p; });

    const { chipsByUser, unpointedByUser, unpointed } = U.unitChips({ unit, tasks: tasks || [], userIds, days, plannedDays, plannedMinutes, projectsById });
    const users = userIds.map((uid) => {
        const capacityRule = (capacities[uid] || U.capacityOf())[unit];
        const grid = U.unitDays({
            days,
            perDay: U.perDayAmount(capacityRule, workingDays.length),
            ptoDays: R.ptoDaysIn(ptoByUser[uid] || [], days),
            weekendDays: weekendOf(workingDays),
            chipsByDay: chipsByUser[uid] || {},
        });
        return {
            userId: uid,
            name: (names[uid] && names[uid].name) || '',
            avatar: (names[uid] && names[uid].avatar) || '',
            capacityRule,
            unpointed: unpointedByUser[uid] || 0,
            ...grid,
        };
    }).sort((a, b) => b.utilizationPct - a.utilizationPct);
    return { users, unpointed };
};

// POST /api/v1/timesheet/workload-grid  body: { start, end, userIds?, projectIds?, hoursPerDay?, timeZone?, unit? }
// People × days against capacity (working time − approved PTO). unit 'hours' (the default) reads estimate chips and
// logged minutes; 'points' and 'count' read open tasks against the person's capacity in that unit.
exports.getWorkloadGrid = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const b = req.body || {};
        if (!isDay(b.start) || !isDay(b.end)) return res.status(400).json({ status: false, statusText: 'start and end (YYYY-MM-DD) are required.' });
        const days = R.dayKeys(b.start, b.end);
        if (!days.length) return res.status(400).json({ status: false, statusText: 'end must be on or after start.' });
        const zone = safeZone(b.timeZone);
        const unit = U.unitOf(b.unit);
        const hoursPerDay = Number(b.hoursPerDay) > 0 ? Number(b.hoursPerDay) : 8;
        const scope = await resolveSheetScope(companyId, req.uid, SHEET_PERMISSION.workload);

        /* Other people's rows are for a caller the workload grant lets see everyone; anyone else gets their own. */
        let userIds = scope.everyone && Array.isArray(b.userIds) ? b.userIds.map(String).filter(Boolean) : [];
        if (!userIds.length) {
            if (scope.companyWide) {
                const members = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1 }],
                }, 'find').catch(() => []);
                userIds = [...new Set((members || []).map((m) => String(m.userId)).filter(Boolean))];
            } else {
                userIds = [String(req.uid)];
            }
        }
        userIds = await acceptedMemberIds(companyId, userIds);
        const askedProjects = Array.isArray(b.projectIds) ? b.projectIds.map(String).filter(Boolean) : [];
        /* Projects asked for and not open to the caller match nothing, rather than lifting the filter. */
        const projectIds = openProjects(scope, askedProjects);
        const inProjects = askedProjects.length ? { $in: idForms(projectIds) } : null;
        const rangeStart = new Date(`${b.start}T00:00:00.000Z`);
        const rangeEnd = new Date(`${b.end}T23:59:59.999Z`);
        const startSec = Math.floor(DateTime.fromISO(b.start, { zone }).startOf('day').toSeconds());
        const endSec = Math.floor(DateTime.fromISO(b.end, { zone }).endOf('day').toSeconds());

        const estMatch = { ...scopedEstimateMatch(scope), UserId: { $in: userIds }, Date: { $gte: rangeStart, $lte: rangeEnd } };
        const logMatch = { ...scopedTimeMatch(scope, { userIds, projectIds: askedProjects.length ? askedProjects : null }), LogStartTime: { $gte: startSec, $lte: endSec } };
        if (inProjects) estMatch.ProjectId = inProjects;

        const [estimates, logs, ptoRows, names] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.ESTIMATES_TIME, data: [estMatch, { UserId: 1, TaskId: 1, ProjectId: 1, Date: 1, EstimatedTime: 1 }] }, 'find')
                .catch(() => [])
                .then((rows) => withoutHiddenSprintPlans(companyId, req.uid, rows)),
            unit === 'hours'
                ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [logMatch, { Loggeduser: 1, LogStartTime: 1, LogTimeDuration: 1 }] }, 'find').catch(() => [])
                : [],
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PTO_ENTRIES, data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: rangeEnd }, endDate: { $gte: rangeStart } }] }, 'find').catch(() => []),
            nameMap(userIds),
        ]);
        const ptoByUser = {};
        (ptoRows || []).forEach((p) => { (ptoByUser[String(p.userId)] = ptoByUser[String(p.userId)] || []).push(p); });
        const workingDays = await workingDaysOf(companyId, projectIds.length === 1 ? projectIds[0] : null);

        if (unit !== 'hours') {
            const openToCaller = (await visibilityStage(companyId, req.uid)).$match;
            const { users, unpointed } = await unitGrid({ companyId, unit, userIds, inProjects, openToCaller, days, rangeStart, rangeEnd, estimates, ptoByUser, names, workingDays });
            return res.json({ status: true, statusText: 'OK', data: { start: b.start, end: b.end, days, unit, workingDays, unpointed, users } });
        }

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
        const users = userIds.map((uid) => {
            const grid = R.workloadDays({
                days, hoursPerDay,
                ptoDays: R.ptoDaysIn(ptoByUser[uid] || [], days),
                weekendDays: weekendOf(workingDays),
                chipsByDay: chipsByUser[uid] || {},
                loggedByDay: loggedByUser[uid] || {},
            });
            return { userId: uid, name: (names[uid] && names[uid].name) || '', avatar: (names[uid] && names[uid].avatar) || '', hoursPerDay, ...grid };
        }).sort((a, b) => b.utilizationPct - a.utilizationPct);

        return res.json({ status: true, statusText: 'OK', data: { start: b.start, end: b.end, days, unit, workingDays, hoursPerDay, users } });
    } catch (e) {
        if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
        logger.error(`getWorkloadGrid: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};

// PUT /api/v1/timesheet/workload-capacity  body: { points?: { value, per }, count?: { value, per } }
// The caller's own points and task-count capacity, kept on their membership of the session company.
exports.saveWorkloadCapacity = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const problem = U.capacityProblem(req.body);
        if (problem) return res.status(400).json({ status: false, statusText: problem });
        const uid = String(req.uid || '');
        const member = { userId: uid, isDelete: { $ne: true } };
        const row = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.COMPANY_USERS, data: [member, { workloadCapacity: 1 }] }, 'findOne');
        if (!row) return res.status(404).json({ status: false, statusText: 'You are not a member of this workspace.' });
        const workloadCapacity = U.capacityOf({ ...U.capacityOf(row.workloadCapacity), ...req.body });
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [member, { $set: { workloadCapacity } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        removeCache(`company_users:${companyId}`);
        removeCache(`UserAllData:${companyId}`);
        socketEmitter.emit('update', {
            type: 'update',
            data: { data: { _id: String((updated && updated._id) || row._id || ''), userId: uid } },
            updatedFields: { workloadCapacity },
            module: 'companyUsers',
        });
        return res.json({ status: true, statusText: 'Capacity saved.', data: workloadCapacity });
    } catch (e) {
        if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
        logger.error(`saveWorkloadCapacity: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};

// POST /api/v1/timesheet/workload-move  body: { taskId, estimateId?, fromUserId, toUserId, fromDate, toDate, userData? }
// Drag-and-drop rebalance: moves the planned (estimated_time) allocation and mirrors the change
// onto the task's due date / assignee so the plan and the task agree.
exports.moveWorkloadChip = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
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
        if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
        logger.error(`moveWorkloadChip: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
