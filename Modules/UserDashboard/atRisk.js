const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const logger = require('../../Config/loggerConfig');
const { visibilityStage } = require('../Tasks/helpers/taskQueryGuard');
const { CLOSED_STATUS_TYPES, isClosedTask, isBlockedTask, blockedClauses, taskRef } = require('../Tasks/helpers/taskSignals');
const { DAY_MS, localDayStart } = require('../../utils/localDay');

const DUE_SOON_DAYS = 2;
const CANDIDATE_LIMIT = 400;
const LISTED = 25;
const NOT_STARTED = 'default_active';
const REASON_ORDER = ['overdue', 'blocked', 'stalled'];

const riskWindow = ({ now = Date.now(), tzOffset } = {}) => {
    const todayStart = localDayStart(now, tzOffset);
    return { todayStart, soonEnd: new Date(todayStart.getTime() + (DUE_SOON_DAYS + 1) * DAY_MS) };
};

/* Rules, not a model: late, blocked, or due within two days and still not started. */
const riskReasons = (task, { todayStart, soonEnd }) => {
    if (!task || isClosedTask(task)) return { reasons: [], daysLate: 0 };
    const due = task.DueDate ? new Date(task.DueDate).getTime() : NaN;
    const start = todayStart.getTime();
    const reasons = [];
    if (due < start) reasons.push('overdue');
    if (isBlockedTask(task)) reasons.push('blocked');
    if (due >= start && due < soonEnd.getTime() && String(task.statusType || '') === NOT_STARTED) reasons.push('stalled');
    return { reasons, daysLate: due < start ? Math.ceil((start - due) / DAY_MS) : 0 };
};

const rank = (row) => REASON_ORDER.indexOf(row.reasons[0]);

const readAtRisk = async (companyId, uid, window) => {
    const stage = await visibilityStage(companyId, uid);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{
            ...(stage ? stage.$match : {}),
            deletedStatusKey: { $ne: 1 },
            mainChat: { $ne: true },
            statusType: { $nin: CLOSED_STATUS_TYPES },
            $or: [{ DueDate: { $lt: window.soonEnd } }, ...blockedClauses()],
        }, { TaskName: 1, TaskKey: 1, ProjectID: 1, sprintId: 1, sprintArray: 1, folderObjId: 1, statusType: 1, status: 1, DueDate: 1, relations: 1, AssigneeUserId: 1 },
        { sort: { DueDate: 1 }, limit: CANDIDATE_LIMIT }],
    }, 'find');

    const flagged = (rows || []).map((task) => ({ task, ...riskReasons(task, window) })).filter((row) => row.reasons.length);
    flagged.sort((a, b) => rank(a) - rank(b) || b.daysLate - a.daysLate);
    const listed = flagged.slice(0, LISTED);

    const projectIds = [...new Set(listed.map((row) => String(row.task.ProjectID || '')).filter(Boolean))];
    const projects = projectIds.length
        ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: idForms(projectIds) } }, { ProjectName: 1 }] }, 'find').catch(() => [])
        : [];
    const nameOf = {};
    (projects || []).forEach((p) => { nameOf[String(p._id)] = p.ProjectName || ''; });

    const count = (reason) => flagged.filter((row) => row.reasons.includes(reason)).length;
    return {
        counts: { overdue: count('overdue'), blocked: count('blocked'), stalled: count('stalled'), total: flagged.length },
        tasks: listed.map(({ task, reasons, daysLate }) => ({
            ...taskRef(task),
            projectName: nameOf[String(task.ProjectID)] || '',
            dueDate: task.DueDate || null,
            assigneeIds: (Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [task.AssigneeUserId]).filter(Boolean).map(String),
            reasons,
            daysLate,
        })),
    };
};

/* POST /api/v1/dashboard/at-risk { tz } */
const getAtRisk = async (req, res) => {
    const companyId = req.headers && req.headers.companyid;
    if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId header required', message: 'companyId header required' });
    if (!req.uid) return res.status(401).json({ status: false, statusText: 'Unauthorized', message: 'Unauthorized' });
    try {
        const window = riskWindow({ now: Date.now(), tzOffset: req.body && req.body.tz });
        const data = await readAtRisk(String(companyId), String(req.uid), window);
        return res.status(200).json({ status: true, statusText: 'At-risk tasks fetched.', data });
    } catch (error) {
        logger.error(`getAtRisk: ${error && error.message ? error.message : error}`);
        return res.status(500).json({ status: false, statusText: 'At-risk tasks could not be read.', message: 'At-risk tasks could not be read.' });
    }
};

module.exports = { riskWindow, riskReasons, readAtRisk, getAtRisk };
