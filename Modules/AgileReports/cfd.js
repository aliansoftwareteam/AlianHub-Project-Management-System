// Cumulative flow diagram (S4-03). Task count per status-category per day at
// project level, over a date range (default last 30 days). Computed on-the-fly:
// a task's completion day comes from its latest Task_Status history entry (same
// signal the burndown uses); before completion a task is attributed to its
// current status-category band. Bands are statusType categories (open /
// inprogress / onhold / close) — reliably reconstructable, unlike per-custom-
// status history which the history log does not store structurally.
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_DAYS = 120;
const BANDS = ['open', 'inprogress', 'onhold', 'close'];

const LOCAL_DAYS = Object.freeze({
    endOfDay: (date) => { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; },
    startOfDay: (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; },
    dayKey: (date) => {
        const d = new Date(date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
});

const UTC_DAYS = Object.freeze({
    endOfDay: (date) => { const d = new Date(date); d.setUTCHours(23, 59, 59, 999); return d; },
    startOfDay: (date) => { const d = new Date(date); d.setUTCHours(0, 0, 0, 0); return d; },
    dayKey: (date) => new Date(date).toISOString().slice(0, 10),
});

/* Per-day band counts for `uid`, who must already be allowed to open the project.
 * The chart counts the server's local days; a caller whose other numbers use UTC
 * days passes `utc` so every figure covers the same days whatever the server's zone. */
const flowFor = async (companyId, uid, projectId, { from, to, utc = false } = {}) => {
    const { startOfDay, endOfDay, dayKey } = utc ? UTC_DAYS : LOCAL_DAYS;
    const projectObjId = new mongoose.Types.ObjectId(projectId);

    const rangeEnd = endOfDay(to ? new Date(to) : new Date());
    let rangeStart = startOfDay(from ? new Date(from) : new Date(rangeEnd.getTime() - 29 * 86400000));
    // Counted between day starts: end-of-day minus start-of-day rounded up drew one day past `to`.
    let totalDays = Math.round((startOfDay(rangeEnd) - rangeStart) / 86400000) + 1;
    if (totalDays > MAX_DAYS) {
        totalDays = MAX_DAYS;
        rangeStart = startOfDay(new Date(rangeEnd.getTime() - (MAX_DAYS - 1) * 86400000));
    }
    if (totalDays < 1) totalDays = 1;

    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [
            // Tasks declare ProjectID, not projectId (schema.js). Matching the
            // wrong name returned nothing, so CFD has answered "No tasks yet."
            // for every project since it shipped.
            {
                ProjectID: projectObjId,
                deletedStatusKey: { $in: [0, 2, undefined] },
                isParentTask: true,
                ...(await hiddenSprintFilter(companyId, uid, [projectId])),
            },
            '_id statusType createdAt updatedAt',
        ],
    }, 'find');

    if (!tasks || !tasks.length) return { days: [], taskCount: 0 };

    const doneTasks = tasks.filter((t) => t.statusType === 'close');
    const lastStatusChange = new Map();
    if (doneTasks.length) {
        const idStrings = doneTasks.map((t) => String(t._id));
        const idObjects = doneTasks.map((t) => t._id);
        const historyRows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.HISTORY,
            data: [{ Key: 'Task_Status', TaskId: { $in: [...idStrings, ...idObjects] } }, 'TaskId createdAt'],
        }, 'find');
        (historyRows || []).forEach((row) => {
            const k = String(row.TaskId);
            const cur = lastStatusChange.get(k);
            if (!cur || new Date(row.createdAt) > cur) lastStatusChange.set(k, new Date(row.createdAt));
        });
    }

    const enriched = tasks.map((t) => ({
        createdAt: new Date(t.createdAt),
        band: BANDS.includes(t.statusType) ? t.statusType : 'open',
        completedAt: t.statusType === 'close' ? (lastStatusChange.get(String(t._id)) || new Date(t.updatedAt)) : null,
    }));

    const days = [];
    for (let i = 0; i < totalDays; i++) {
        const cursor = endOfDay(new Date(rangeStart.getTime() + i * 86400000));
        const counts = { open: 0, inprogress: 0, onhold: 0, close: 0 };
        enriched.forEach((t) => {
            if (t.createdAt > cursor) return;
            if (t.completedAt && t.completedAt <= cursor) { counts.close += 1; return; }
            // A task closed later was still in progress on this day.
            const band = t.band === 'close' ? 'inprogress' : t.band;
            counts[band] += 1;
        });
        days.push({ date: dayKey(cursor), ...counts });
    }

    return { days, taskCount: tasks.length };
};

/* GET /api/v1/agile/cfd?projectId=&from=&to=  (companyId from header) */
exports.getCFD = async (req, res) => {
    try {
        const companyId = req.headers['companyid'] || '';
        const projectId = String((req.query && req.query.projectId) || '');
        if (!companyId || !OBJECT_ID_PATTERN.test(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        const { days, taskCount } = await flowFor(companyId, req.uid, projectId, { from: req.query && req.query.from, to: req.query && req.query.to });
        return res.send({ status: true, statusText: taskCount ? 'CFD computed.' : 'No tasks yet.', data: { days } });
    } catch (error) {
        logger.error(`ERROR in agile cfd: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

exports.flowFor = flowFor;
exports.MAX_DAYS = MAX_DAYS;
