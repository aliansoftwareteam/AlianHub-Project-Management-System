const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');

/**
 * Sprint hours — Planned, Logged and Overdue for a whole sprint.
 *
 * The same three figures the Tasks Summary by Status card shows, and deliberately the
 * same definitions, so the sprint header and the dashboard cannot drift apart:
 *
 *   Planned = estimated_time.EstimatedTime  (the per-day plan people set for themselves)
 *   Logged  = timesheets.LogTimeDuration    (what was actually tracked)
 *   Overdue = projected - planned, when positive, where
 *             projected = SUM logged               over FINISHED tasks
 *                       + SUM max(planned, logged) over OPEN tasks
 *
 * A finished task is settled: what it cost is what it logged, and one brought in under
 * its plan gives that time back. An open task will cost at least what was planned for it
 * and at least what has already gone into it, so flooring at the larger of the two is
 * what lets a task already 8h into a 3h plan show now rather than on the day it closes.
 *
 * NO DATE WINDOW. The dashboard card answers "this period"; this answers "this sprint,
 * all of it". Every plan row and every worklog against the sprint's tasks counts,
 * whenever it was made.
 *
 * Finished is statusType === 'close' — the definition epic recount, velocity and CFD
 * already use. Statuses are per-company and renameable, so the type is the only safe
 * signal; matching the name "Complete" would break the first time somebody renamed it.
 */

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const EMPTY = { plannedMinutes: 0, loggedMinutes: 0, overdueMinutes: 0 };

/* POST /api/v2/sprints/hours  body: { sprintId }  (companyId from header) */
exports.getSprintHours = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const sprintId = (req.body && req.body.sprintId) || '';
        if (!companyId || !OBJECT_ID_PATTERN.test(String(sprintId))) {
            return res.status(400).json({ status: false, statusText: 'companyId and a valid sprintId are required.' });
        }

        // Subtasks are counted on purpose — they carry their own estimates and their own
        // worklogs, and a sprint total that ignored them would read low.
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                {
                    sprintId: new mongoose.Types.ObjectId(String(sprintId)),
                    deletedStatusKey: 0,
                    mainChat: { $ne: true }, // chat threads are stored as tasks; not work
                },
                { _id: 1, statusType: 1 },
            ],
        }, 'find').catch((e) => {
            logger.error(`getSprintHours task read failed: ${e && e.message ? e.message : e}`);
            return [];
        });

        if (!tasks || !tasks.length) {
            return res.status(200).json({ status: true, data: { ...EMPTY } });
        }

        // Both hour collections hold the task id as a STRING, while tasks._id is an
        // ObjectId. Casting the wrong way round here matches nothing, silently.
        const taskIds = [];
        const isFinished = new Set();
        tasks.forEach((t) => {
            const id = String(t._id);
            taskIds.push(id);
            if (String(t.statusType || '') === 'close') isFinished.add(id);
        });

        const [plans, logs] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.ESTIMATES_TIME,
                data: [[
                    { $match: { TaskId: { $in: taskIds } } },
                    { $group: { _id: '$TaskId', m: { $sum: '$EstimatedTime' } } },
                ]],
            }, 'aggregate').catch((e) => {
                logger.error(`getSprintHours planned read failed: ${e && e.message ? e.message : e}`);
                return [];
            }),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [[
                    { $match: { TicketID: { $in: taskIds } } },
                    { $group: { _id: '$TicketID', m: { $sum: '$LogTimeDuration' } } },
                ]],
            }, 'aggregate').catch((e) => {
                logger.error(`getSprintHours logged read failed: ${e && e.message ? e.message : e}`);
                return [];
            }),
        ]);

        // Per task, so the projection can ask a different question of a finished task
        // than of an open one.
        const perTask = new Map();
        const collect = (groups, field) => (groups || []).forEach((g) => {
            const id = String((g && g._id) || '');
            if (!id) return;
            if (!perTask.has(id)) perTask.set(id, { planned: 0, logged: 0 });
            perTask.get(id)[field] += Number(g.m) || 0;
        });
        collect(plans, 'planned');
        collect(logs, 'logged');

        let plannedMinutes = 0;
        let loggedMinutes = 0;
        let projectedMinutes = 0;
        perTask.forEach(({ planned, logged }, id) => {
            plannedMinutes += planned;
            loggedMinutes += logged;
            projectedMinutes += isFinished.has(id) ? logged : Math.max(planned, logged);
        });

        return res.status(200).json({
            status: true,
            data: {
                plannedMinutes,
                loggedMinutes,
                // Only the overrun is reported. A sprint running under its plan is not
                // "negative overdue", it is simply not overdue.
                overdueMinutes: Math.max(0, projectedMinutes - plannedMinutes),
            },
        });
    } catch (error) {
        logger.error(`getSprintHours error: ${error && error.message ? error.message : error}`);
        return res.status(500).json({
            status: false,
            statusText: 'An error occurred while building the sprint hours.',
            error: error && error.message ? error.message : String(error),
        });
    }
};
