const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');

// Sprint burndown. Completion is derived from the data that already exists:
// a task counts as done when its current status type is 'close', and its
// completion date is the createdAt of its latest Task_Status history entry
// (fallback: the task's updatedAt). No new write paths — read-only endpoint.

const MAX_DAYS = 120;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const endOfDay = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

// Calendar arithmetic, not milliseconds: stepping a day with +86400000 across a
// DST boundary drifts, and at the autumn fall-back repeats a date outright.
const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
};

const calendarDaysBetween = (from, to) => Math.round(
    (new Date(to.getFullYear(), to.getMonth(), to.getDate())
        - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000,
);

const dayKey = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* POST /api/v2/sprints/burndown  body: { sprintId }  (companyId from header) */
exports.getSprintBurndown = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        // Accept sprintId from POST body (existing /api/v2/sprints/burndown) or
        // query string (GET /api/v1/agile/burndown?sprintId=).
        const sprintId = (req.body && req.body.sprintId) || (req.query && req.query.sprintId) || '';
        if (!companyId || !OBJECT_ID_PATTERN.test(String(sprintId || ''))) {
            return res.send({ status: false, statusText: 'companyId and a valid sprintId are required.' });
        }

        const sprintObjId = new mongoose.Types.ObjectId(sprintId);
        const sprint = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS,
            data: [{ _id: sprintObjId }],
        }, 'findOne');
        if (!sprint) {
            return res.send({ status: false, statusText: 'Sprint not found.' });
        }

        // Active + archived tasks count toward sprint scope; deleted don't.
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { sprintId: sprintObjId, deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true },
                '_id TaskKey statusType points totalEstimatedTime createdAt updatedAt',
            ],
        }, 'find');

        if (!tasks || !tasks.length) {
            return res.send({ status: true, statusText: 'No tasks in this sprint yet.', data: { sprintName: sprint.name || '', days: [] } });
        }

        // Latest status-change date per task. History stores TaskId in
        // whichever form the writer passed, so match both string + ObjectId.
        const idStrings = tasks.map((task) => String(task._id));
        const idObjects = tasks.map((task) => task._id);
        const historyRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.HISTORY,
            data: [
                { Key: 'Task_Status', TaskId: { $in: [...idStrings, ...idObjects] } },
                'TaskId createdAt',
            ],
        }, 'find');

        const lastStatusChange = new Map();
        (historyRows || []).forEach((row) => {
            const key = String(row.TaskId);
            const current = lastStatusChange.get(key);
            if (!current || new Date(row.createdAt) > current) {
                lastStatusChange.set(key, new Date(row.createdAt));
            }
        });

        const enriched = tasks.map((task) => ({
            createdAt: new Date(task.createdAt),
            estimate: Number(task.totalEstimatedTime) || 0,
            points: Number(task.points) || 0,
            completedAt: task.statusType === 'close'
                ? (lastStatusChange.get(String(task._id)) || new Date(task.updatedAt))
                : null,
        }));

        // A Scrum sprint has a real time box, so the chart is that box: the ideal
        // line spans start → end and the series stops on the end date instead of
        // trailing to today forever. Widening to the earliest task would defeat
        // the point — work created before the sprint opened is in scope on day
        // one, not a reason to redraw the sprint as three months long.
        //
        // Every other sprint keeps exactly today's behaviour. This is the field
        // line 90 always reached for; it simply never existed until now, so the
        // chart has silently been dated from createdAt.
        const isTimeBoxed = sprint.isScrum === true && !!sprint.startDate && !!sprint.endDate;
        const now = new Date();

        const earliestTask = enriched.reduce((min, task) => (task.createdAt < min ? task.createdAt : min), new Date());
        let rangeStart;
        let rangeEnd;
        if (isTimeBoxed) {
            rangeStart = startOfDay(new Date(sprint.startDate));
            rangeEnd = endOfDay(new Date(sprint.endDate));
        } else {
            rangeStart = sprint.startDate ? new Date(sprint.startDate) : (sprint.createdAt ? new Date(sprint.createdAt) : earliestTask);
            if (earliestTask < rangeStart) rangeStart = earliestTask;
            rangeEnd = now;
        }
        const totalDays = Math.min(MAX_DAYS, Math.max(1, calendarDaysBetween(rangeStart, rangeEnd) + 1));

        const totalCount = enriched.length;
        const totalEstimate = enriched.reduce((sum, task) => sum + task.estimate, 0);
        const totalPoints = enriched.reduce((sum, task) => sum + task.points, 0);
        const days = [];
        for (let i = 0; i < totalDays; i++) {
            const cursor = endOfDay(addDays(rangeStart, i));
            // Days the sprint has not reached yet carry the ideal line only.
            // Reporting "0 remaining" for next Thursday would read as a finished
            // sprint; a gap reads as what it is.
            const unreached = isTimeBoxed && cursor > endOfDay(now);
            const scoped = enriched.filter((task) => task.createdAt <= cursor);
            const completed = scoped.filter((task) => task.completedAt && task.completedAt <= cursor);
            const completedEstimate = completed.reduce((sum, task) => sum + task.estimate, 0);
            const scopedEstimate = scoped.reduce((sum, task) => sum + task.estimate, 0);
            const completedPoints = completed.reduce((sum, task) => sum + task.points, 0);
            const scopedPoints = scoped.reduce((sum, task) => sum + task.points, 0);
            // Straight line from full scope on day one to zero on the last day.
            const idealFactor = (totalDays - 1 - i) / Math.max(1, totalDays - 1);
            days.push({
                date: dayKey(cursor),
                remainingCount: unreached ? null : scoped.length - completed.length,
                remainingEstimate: unreached ? null : Math.max(0, scopedEstimate - completedEstimate),
                remainingPoints: unreached ? null : Math.max(0, scopedPoints - completedPoints),
                ideal: Math.max(0, Math.round(totalCount * idealFactor)),
                idealPoints: Math.max(0, Math.round(totalPoints * idealFactor)),
            });
        }

        return res.send({
            status: true,
            statusText: 'Burndown computed.',
            data: {
                sprintName: sprint.name || '',
                // So the chart can say which box it is drawing, and grey out a
                // sprint that has not started.
                isScrum: sprint.isScrum === true,
                state: sprint.state || '',
                goal: sprint.goal || '',
                startDate: sprint.startDate || null,
                endDate: sprint.endDate || null,
                totalCount,
                totalEstimate,
                totalPoints,
                days,
            },
        });
    } catch (error) {
        logger.error(`ERROR in sprint burndown: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
