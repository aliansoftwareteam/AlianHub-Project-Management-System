const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter.js');
const { removeCache } = require('../../../utils/commonFunctions');
const { isPeriodLocked } = require('../../TimesheetApproval/helpers/lockGuard');
const { updateProjectForTimelog, updateRemainingTime } = require('./helpers');
const T = require('./timerRules');

const companyOf = (req) => req.headers['companyid'] || (req.query && req.query.companyId) || (req.body && req.body.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const safeZone = (z) => (z && DateTime.local().setZone(z).isValid ? z : 'UTC');

// GET /api/v2/timetracker/running?timeZone= — the caller's open tracker sessions
// (live or abandoned), flagged when they ran overnight so the client can offer a trim.
exports.listRunningTimers = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        const zone = safeZone(req.query && req.query.timeZone);
        const nowSec = Math.floor(Date.now() / 1000);
        const dayStartSec = Math.floor(DateTime.now().setZone(zone).startOf('day').toSeconds());
        const sessions = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [
                { Loggeduser: String(req.uid), startTimeTracker: { $exists: true, $ne: null } },
                { TicketID: 1, ProjectId: 1, LogStartTime: 1, LogEndTime: 1, LogTimeDuration: 1, LogDescription: 1, startTimeTracker: 1 },
                { sort: { LogStartTime: -1 }, limit: 20 },
            ],
        }, 'find') || [];
        const taskIds = [...new Set(sessions.map((s) => String(s.TicketID || '')).filter(Boolean))].map(oid).filter(Boolean);
        const projectIds = [...new Set(sessions.map((s) => String(s.ProjectId || '')).filter(Boolean))].map(oid).filter(Boolean);
        const [tasks, projects] = await Promise.all([
            taskIds.length ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: { $in: taskIds } }, { TaskName: 1, sprintId: 1, ProjectID: 1 }] }, 'find').catch(() => []) : [],
            projectIds.length ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: projectIds } }, { ProjectName: 1, projectIcon: 1 }] }, 'find').catch(() => []) : [],
        ]);
        const taskById = {};
        (tasks || []).forEach((t) => { taskById[String(t._id)] = t; });
        const projectById = {};
        (projects || []).forEach((p) => { projectById[String(p._id)] = p; });
        const data = sessions.map((s) => {
            const t = taskById[String(s.TicketID)];
            const p = projectById[String(s.ProjectId)];
            const c = T.classifyTimer({ startSec: s.LogStartTime, lastSeenSec: s.startTimeTracker, nowSec, dayStartSec });
            return {
                timeSheetId: String(s._id),
                taskId: String(s.TicketID || ''),
                taskName: t ? t.TaskName || '' : '',
                sprintId: t ? String(t.sprintId || '') : '',
                projectId: String(s.ProjectId || ''),
                projectName: p ? p.ProjectName || '' : '',
                projectColor: p && p.projectIcon && p.projectIcon.type === 'color' ? p.projectIcon.data : '',
                note: s.LogDescription || '',
                startedAt: (Number(s.LogStartTime) || 0) * 1000,
                recordedMinutes: Number(s.LogTimeDuration) || 0,
                ...c,
            };
        });
        return res.send({ status: true, statusText: 'OK', data });
    } catch (error) {
        logger.error(`listRunningTimers: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

// POST /api/v2/timetracker/trim  body: { timeSheetId, minutes } — close an open session at
// start + minutes (the "Trim to 3h" fix for a timer left running).
exports.trimTimer = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        const { timeSheetId } = req.body || {};
        const id = oid(timeSheetId);
        if (!id) return res.send({ status: false, statusText: 'A valid timeSheetId is required.' });
        const check = T.validateTrimMinutes(req.body && req.body.minutes);
        if (!check.valid) return res.send({ status: false, statusText: check.reason });

        const entry = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TIMESHEET, data: [{ _id: id }] }, 'findOne');
        if (!entry) return res.send({ status: false, statusText: 'Timer session not found.' });
        if (String(entry.Loggeduser) !== String(req.uid)) {
            const roleType = await getRoleType(companyId, req.uid);
            if (!isPrivileged(roleType)) return res.send({ status: false, statusText: 'You can only trim your own timers.' });
        }
        const startSec = Number(entry.LogStartTime) || 0;
        const locked = await isPeriodLocked({ companyId, userId: entry.Loggeduser, date: new Date(startSec * 1000) });
        if (locked) return res.send({ status: false, statusText: 'This timesheet period is approved and locked.' });

        const bounds = T.trimBounds({ startSec, minutes: check.minutes });
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [{ _id: id }, { $set: { ...bounds, updatedAt: Date.now() }, $unset: { startTimeTracker: 1 } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (entry.ProjectId) updateProjectForTimelog(companyId, entry.ProjectId, true, Math.floor(Date.now() / 1000));
        if (entry.TicketID) Promise.resolve(updateRemainingTime(companyId, entry.TicketID)).catch((e) => logger.error(`trimTimer remaining: ${e.message}`));
        removeCache(`timesheet:${companyId}`, true);
        socketEmitter.emit('update', { type: 'update', data: updated, updatedFields: bounds, module: 'timesheet' });
        return res.send({ status: true, statusText: 'Timer trimmed.', data: updated });
    } catch (error) {
        logger.error(`trimTimer: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
