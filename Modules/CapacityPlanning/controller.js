const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const pto = require('../Pto/helpers/ptoRules');   // SEC-08 — capacity = work hours − approved PTO
const R = require('./helpers/capacityRules');
const { companyWeekendDays } = require('../Company/helpers/companyWeek');
const { resolveSheetScope, scopedEstimateMatch, SHEET_PERMISSION } = require('../TimeSheet/helpers/timeScope');
const { withoutHiddenSprintPlans, namesTimeOff } = require('../TimeSheet/helpers/planVisibility');
const { visibilityStage } = require('../Tasks/helpers/taskQueryGuard');

const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const failed = (res, where, e) => {
    if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
    logger.error(`${where}: ${e.message}`);
    return res.status(500).json({ status: false, statusText: e.message });
};
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/* Capacity is the workload sheet in totals, so the workload grant decides whose plans it reads:
 * everyone's, from the projects and sprints the caller can open, or the caller's own. */
const capacityScope = (companyId, uid) => resolveSheetScope(companyId, uid, SHEET_PERMISSION.workload);

const memberIdsOf = (members) => [...new Set((members || []).map((m) => String(m.userId)).filter(Boolean))];
const peopleIn = (scope, memberIds) => (scope.everyone ? memberIds : memberIds.filter((id) => id === scope.uid));

const plansIn = async (companyId, scope, userIds, window) => withoutHiddenSprintPlans(companyId, scope.uid, await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.ESTIMATES_TIME,
    data: [{ ...scopedEstimateMatch(scope), UserId: { $in: userIds }, Date: window }, { UserId: 1, TaskId: 1, ProjectId: 1, Date: 1, EstimatedTime: 1 }],
}, 'find').catch(() => []));

// GET /api/v1/reports/capacity?from=&to=&hoursPerDay=
// Per-member capacity (working hours − approved PTO) vs allocation (planned hours
// from estimated_time), with over-allocation flagged.
exports.getCapacityPlan = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const q = req.query || {};
        if (!q.from || !q.to) return res.status(400).json({ status: false, statusText: 'from and to are required.' });
        const hoursPerDay = Number(q.hoursPerDay) > 0 ? Number(q.hoursPerDay) : 8;

        const scope = await capacityScope(companyId, req.uid);
        const members = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1, userEmail: 1 }],
        }, 'find');
        const userIds = peopleIn(scope, memberIdsOf(members));
        if (!userIds.length) return res.json({ status: true, data: { from: q.from, to: q.to, totals: R.summarize([]), users: [] } });

        // Display names from the global users collection.
        const gusers = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: userIds.map(oid).filter(Boolean) } }, { Employee_Name: 1, Employee_Email: 1 }],
        }, 'find').catch(() => []);
        const nameById = {};
        (gusers || []).forEach((u) => { nameById[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; });

        // Approved PTO overlapping the window, grouped by user.
        const ptoRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PTO_ENTRIES,
            data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: new Date(q.to) }, endDate: { $gte: new Date(q.from) } }],
        }, 'find').catch(() => []);
        const ptoByUser = {};
        (ptoRows || []).forEach((p) => { (ptoByUser[String(p.userId)] = ptoByUser[String(p.userId)] || []).push(p); });

        const estRows = await plansIn(companyId, scope, userIds, { $gte: new Date(q.from), $lte: new Date(q.to) });
        const allocMinByUser = {};
        (estRows || []).forEach((e) => { allocMinByUser[String(e.UserId)] = (allocMinByUser[String(e.UserId)] || 0) + (Number(e.EstimatedTime) || 0); });

        const weekendDays = await companyWeekendDays(companyId);
        const rows = userIds.map((uid) => {
            const cap = pto.computeAvailableCapacity({ rangeStart: q.from, rangeEnd: q.to, ptoEntries: ptoByUser[uid] || [], workingHoursPerDay: hoursPerDay, weekendDays });
            const allocatedHours = (allocMinByUser[uid] || 0) / 60;
            const util = R.userUtilization({ capacityHours: cap.availableHours, allocatedHours });
            return {
                userId: uid,
                name: nameById[uid] || '(unknown)',
                workCapacityHours: cap.totalCapacityHours,
                unavailableHours: cap.ptoHours,
                ptoHours: namesTimeOff(scope, uid) ? cap.ptoHours : 0,
                ...util,
            };
        }).sort((a, b) => b.utilizationPct - a.utilizationPct);

        return res.json({ status: true, data: { from: q.from, to: q.to, totals: R.summarize(rows), users: rows } });
    } catch (e) { return failed(res, 'getCapacityPlan', e); }
};

const M = require('./helpers/monthlyRules');

// GET /api/v1/reports/capacity/months?from=YYYY-MM&to=YYYY-MM&hoursPerDay=
// Months ahead per team: available (working hours − approved PTO) vs committed
// (planned estimated_time) vs pipeline (open tasks due in the month with an
// estimate but no plan yet). Gaps = months where committed exceeds available.
exports.getMonthlyCapacity = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const q = req.query || {};
        const now = new Date();
        const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const later = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 1));
        const defaultTo = `${later.getUTCFullYear()}-${String(later.getUTCMonth() + 1).padStart(2, '0')}`;
        const months = M.monthKeys(q.from || defaultFrom, q.to || defaultTo);
        if (!months.length) return res.status(400).json({ status: false, statusText: 'from and to must be valid months (YYYY-MM).' });
        const hoursPerDay = Number(q.hoursPerDay) > 0 ? Number(q.hoursPerDay) : 8;
        const rangeStart = M.monthBounds(months[0]).start;
        const rangeEnd = M.monthBounds(months[months.length - 1]).end;

        const scope = await capacityScope(companyId, req.uid);
        const members = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS, data: [{ isDelete: { $ne: true } }, { userId: 1 }],
        }, 'find');
        const memberIds = memberIdsOf(members);
        const userIds = peopleIn(scope, memberIds);
        const openToCaller = (await visibilityStage(companyId, req.uid)).$match;
        const [gusers, teamsRaw, ptoRows, estRows, taskRows] = await Promise.all([
            userIds.length ? MongoDbCrudOpration(dbCollections.GLOBAL, {
                type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: userIds.map(oid).filter(Boolean) } }, { Employee_Name: 1, Employee_Email: 1 }],
            }, 'find').catch(() => []) : [],
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TEAMS_MANAGEMENT, data: [{}, { name: 1, assigneeUsersArray: 1 }] }, 'find').catch(() => []),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PTO_ENTRIES,
                data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: { $ne: 1 }, startDate: { $lte: rangeEnd }, endDate: { $gte: rangeStart } }],
            }, 'find').catch(() => []),
            plansIn(companyId, scope, userIds, { $gte: rangeStart, $lte: rangeEnd }),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{
                    deletedStatusKey: { $in: [0, 2, null] }, isParentTask: true,
                    statusType: { $nin: ['done', 'close', 'completed'] },
                    totalEstimatedTime: { $gt: 0 }, DueDate: { $gte: rangeStart, $lte: rangeEnd },
                    $and: [openToCaller],
                }, { AssigneeUserId: 1, DueDate: 1, totalEstimatedTime: 1 }],
            }, 'find').catch(() => []),
        ]);

        const nameById = {};
        (gusers || []).forEach((u) => { nameById[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; });
        const ptoByUser = {};
        (ptoRows || []).forEach((p) => { (ptoByUser[String(p.userId)] = ptoByUser[String(p.userId)] || []).push(p); });
        const plannedTaskMonths = new Set();
        const committed = {};
        (estRows || []).forEach((e) => {
            const key = `${e.UserId}|${M.monthOf(e.Date)}`;
            committed[key] = (committed[key] || 0) + (Number(e.EstimatedTime) || 0) / 60;
            plannedTaskMonths.add(`${e.TaskId}|${M.monthOf(e.Date)}`);
        });
        const pipeline = {};
        (taskRows || []).forEach((t) => {
            const m = M.monthOf(t.DueDate);
            if (!m || plannedTaskMonths.has(`${t._id}|${m}`)) return;
            const assignees = (Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId : []).map(String).filter((a) => memberIds.includes(a));
            if (!assignees.length) return;
            const share = (Number(t.totalEstimatedTime) || 0) / 60 / assignees.length;
            assignees.filter((a) => userIds.includes(a)).forEach((a) => { pipeline[`${a}|${m}`] = (pipeline[`${a}|${m}`] || 0) + share; });
        });

        const weekendDays = await companyWeekendDays(companyId);
        const users = {};
        userIds.forEach((uid) => {
            const byMonth = {};
            months.forEach((m) => {
                const b = M.monthBounds(m);
                const cap = pto.computeAvailableCapacity({ rangeStart: b.start, rangeEnd: b.end, ptoEntries: ptoByUser[uid] || [], workingHoursPerDay: hoursPerDay, weekendDays });
                const daysOff = hoursPerDay > 0 ? Math.round(cap.ptoHours / hoursPerDay) : 0;
                const named = namesTimeOff(scope, uid);
                byMonth[m] = {
                    availableHours: cap.availableHours,
                    unavailableHours: cap.ptoHours,
                    unavailableDays: daysOff,
                    ptoHours: named ? cap.ptoHours : 0,
                    ptoDays: named ? daysOff : 0,
                    committedHours: committed[`${uid}|${m}`] || 0,
                    pipelineHours: pipeline[`${uid}|${m}`] || 0,
                };
            });
            users[uid] = { name: nameById[uid] || '(unknown)', months: byMonth };
        });
        const teams = (teamsRaw || [])
            .map((t) => ({ teamId: String(t._id), name: t.name || '', memberIds: (t.assigneeUsersArray || []).map(String).filter((a) => userIds.includes(a)) }))
            .filter((team) => scope.everyone || team.memberIds.length);
        const summary = M.summarizeTeams({ teams, users, months });
        return res.json({ status: true, statusText: 'OK', data: { from: months[0], to: months[months.length - 1], months, hoursPerDay, ...summary } });
    } catch (e) { return failed(res, 'getMonthlyCapacity', e); }
};
