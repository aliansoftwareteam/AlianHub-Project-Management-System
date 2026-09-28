const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { sessionTenantOf, TenantError } = require('../../../Config/tenant');
const logger = require('../../../Config/loggerConfig');
const { resolveSheetScope, SHEET_PERMISSION } = require('../helpers/timeScope');
const { coversDate } = require('../../TimesheetApproval/helpers/approvalRules');
const { RUNNING_WINDOW_SEC } = require('../../LogTime/controllerV2/timerRules');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TRACKER = 1;

const approvedPeriodsOf = async (companyId, userIds) => {
    if (!userIds.length) return [];
    return (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
        data: [{ userId: { $in: userIds }, status: 'approved', deletedStatusKey: 0 }, { userId: 1, periodStart: 1, periodEnd: 1 }],
    }, 'find')) || [];
};

const sumMinutes = (rows) => rows.reduce((total, row) => total + (Number(row.LogTimeDuration) || 0), 0);

// GET /api/v1/timesheet/task/:taskId — the task panel's time section.
exports.getTaskEntries = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const taskId = String((req.params && req.params.taskId) || '');
        if (!OBJECT_ID.test(taskId)) return res.status(400).json({ status: false, statusText: 'A valid task id is required.' });
        const task = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(taskId) }, { ProjectID: 1, totalEstimatedTime: 1 }],
        }, 'findOne');
        if (!task) return res.status(404).json({ status: false, statusText: 'Task not found.' });

        const uid = String(req.uid);
        const rows = (await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [{ TicketID: taskId }, { Loggeduser: 1, LogStartTime: 1, LogEndTime: 1, LogTimeDuration: 1, LogDescription: 1, billable: 1, logAddType: 1, startTimeTracker: 1 }],
        }, 'find')) || [];

        // Another person's time is shown where the timesheet screens would show it, the same test writing it takes.
        const sheet = await resolveSheetScope(companyId, uid, SHEET_PERMISSION.user);
        const seesEveryone = sheet.everyone && (sheet.visible === null || sheet.visible.includes(String(task.ProjectID)));
        const mine = rows.filter((row) => String(row.Loggeduser) === uid);
        const shown = seesEveryone ? rows : mine;

        const periods = await approvedPeriodsOf(companyId, [...new Set(shown.map((row) => String(row.Loggeduser)))]);
        const nowSec = Math.floor(Date.now() / 1000);
        const entries = shown
            .map((row) => {
                const startedAt = Number(row.LogStartTime) || 0;
                const userId = String(row.Loggeduser);
                const locked = periods.some((p) => String(p.userId) === userId && coversDate({ periodStart: p.periodStart, periodEnd: p.periodEnd, date: new Date(startedAt * 1000) }));
                const running = Number(row.startTimeTracker) >= nowSec - RUNNING_WINDOW_SEC;
                const source = row.logAddType === TRACKER ? 'tracker' : 'manual';
                return {
                    _id: String(row._id),
                    userId,
                    startedAt,
                    endedAt: Number(row.LogEndTime) || startedAt,
                    minutes: Number(row.LogTimeDuration) || 0,
                    note: row.LogDescription || '',
                    billable: row.billable !== false,
                    source,
                    running,
                    locked,
                    canEdit: source === 'manual' && !locked && !running,
                };
            })
            .sort((a, b) => b.startedAt - a.startedAt);

        return res.json({
            status: true,
            statusText: 'OK',
            data: {
                taskId,
                estimateMinutes: Number(task.totalEstimatedTime) || 0,
                totalMinutes: sumMinutes(rows),
                mineMinutes: sumMinutes(mine),
                seesEveryone,
                entries,
            },
        });
    } catch (e) {
        if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
        logger.error(`getTaskEntries: ${e.message}`);
        return res.status(500).json({ status: false, statusText: e.message });
    }
};
