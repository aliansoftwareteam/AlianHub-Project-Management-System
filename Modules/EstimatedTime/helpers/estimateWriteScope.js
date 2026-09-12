const mongoose = require('mongoose');

const MAX_ESTIMATE_MINUTES = 24 * 60;

class EstimateWriteRefused extends Error {
    constructor(reason, statusCode = 400) {
        super(reason);
        this.name = 'EstimateWriteRefused';
        this.statusCode = statusCode;
    }
}

const refuse = (reason, statusCode) => { throw new EstimateWriteRefused(reason, statusCode); };

/* A planning row is addressed by four scalars. Anything else — an object, an
 * array, a $-operator — is a query the caller is trying to smuggle in. */
const asId = (value, what) => {
    if (typeof value !== 'string' || !mongoose.Types.ObjectId.isValid(value)) refuse(`${what} must be an id.`);
    return value;
};

const asDate = (value) => {
    const date = typeof value === 'string' || value instanceof Date ? new Date(value) : new Date(NaN);
    if (Number.isNaN(date.getTime())) refuse('date must be a date.');
    return date;
};

const asMinutes = (value) => {
    const minutes = typeof value === 'number' ? value : NaN;
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_ESTIMATE_MINUTES) {
        refuse(`minutes must be a number between 0 and ${MAX_ESTIMATE_MINUTES}.`);
    }
    return Math.round(minutes);
};

/* The web app reads a plan's person from UserId and the desktop tracker from
 * userId; a row without UserId belongs to its userId. Mirrors the read guard. */
const ownRowsMatch = (scope) => ({ $or: [{ UserId: scope.uid }, { UserId: { $exists: false }, userId: scope.uid }] });

const readEstimateWrite = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('A planning save needs a body.');
    if ('compareObj' in body || 'updateObject' in body || 'key' in body || 'newObj' in body) {
        refuse('A planning save names the row it writes; it does not carry a Mongo query.');
    }
    return {
        id: body.id === undefined || body.id === null || body.id === '' ? null : asId(body.id, 'id'),
        userId: asId(body.userId, 'userId'),
        taskId: asId(body.taskId, 'taskId'),
        projectId: asId(body.projectId, 'projectId'),
        date: asDate(body.date),
        minutes: asMinutes(body.minutes),
    };
};

/* Owners and admins, and the roles the matrix grants Everyone on the workload or
 * project timesheet, plan for anyone; everyone else plans their own time only, and
 * both stop at the projects they can open. */
const authorize = (plan, scope) => {
    if (!scope.everyone && plan.userId !== scope.uid) refuse('You can only plan your own time.', 403);
    if (scope.visible && !scope.visible.includes(plan.projectId)) refuse('You cannot plan time on this project.', 403);
};

const buildEstimateWrite = (body, scope) => {
    const plan = readEstimateWrite(body);
    authorize(plan, scope);

    const row = {
        UserId: plan.userId,
        userId: plan.userId,
        TaskId: plan.taskId,
        ProjectId: plan.projectId,
        Date: plan.date,
        EstimatedTime: plan.minutes,
    };

    /* Without an id this is the planner's first save for that person and day, so it
     * upserts on the natural key the row is identified by. With one it rewrites a row
     * the caller may already reach — the scope stays in the filter so a stolen id
     * matches nothing. */
    const filter = plan.id
        ? { _id: new mongoose.Types.ObjectId(plan.id), ...(scope.everyone ? {} : ownRowsMatch(scope)), ...(scope.visible ? { ProjectId: { $in: scope.visible } } : {}) }
        : { userId: plan.userId, Date: plan.date, TaskId: plan.taskId };

    return {
        plan,
        data: [filter, { $set: row }, { new: true, upsert: !plan.id, setDefaultsOnInsert: true }],
    };
};

module.exports = {
    EstimateWriteRefused,
    MAX_ESTIMATE_MINUTES,
    buildEstimateWrite,
};
