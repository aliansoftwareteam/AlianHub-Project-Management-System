const { CODES } = require('./checks');

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];

function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes) || 0);
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${UNITS[unit]}`;
}

const STATUS = Object.freeze({
    [CODES.SEAT_LIMIT]: 403,
    [CODES.WORKSPACE_LIMIT]: 403,
    [CODES.TRACKER_DISABLED]: 403,
    [CODES.TRACKER_SEAT_LIMIT]: 403,
    [CODES.FILE_TOO_LARGE]: 413,
    [CODES.STORAGE_FULL]: 507,
    [CODES.MAIL_CAP]: 429,
});

function messageFor({ code, limit, used, guests }) {
    switch (code) {
        case CODES.SEAT_LIMIT:
            return guests
                ? `Your plan includes ${limit} guests and all of them are in use. Add guests in your AlianHub account, or remove a guest first.`
                : `Your plan includes ${limit} seats and all of them are in use. Add seats in your AlianHub account, or remove a member first.`;
        case CODES.STORAGE_FULL:
            return `Storage is full (${formatBytes(used)} of ${formatBytes(limit)}). Delete files or add storage.`;
        case CODES.FILE_TOO_LARGE:
            return `This file is larger than the ${formatBytes(limit)} your plan allows.`;
        case CODES.WORKSPACE_LIMIT:
            return `Your plan includes ${limit} workspace${Number(limit) === 1 ? '' : 's'}. Add workspaces in your AlianHub account.`;
        case CODES.TRACKER_DISABLED:
            return 'The desktop time tracker is an add-on that is not part of your plan.';
        case CODES.TRACKER_SEAT_LIMIT:
            return `Your plan includes ${limit} time tracker users and all of them are in use.`;
        case CODES.MAIL_CAP:
            return `Today's ${limit} emails have been sent. The rest go out tomorrow.`;
        default:
            return 'Your plan does not allow this.';
    }
}

/* The app's convention is HTTP 200 with status: false (AR-24); statusCode lets API-token callers
 * get the real status from strictStatus. */
function refusalBody(refusal) {
    const message = messageFor(refusal);
    return {
        status: false,
        statusText: message,
        message,
        code: refusal.code,
        statusCode: STATUS[refusal.code] || 403,
        limit: refusal.limit,
        used: refusal.used,
        ...(refusal.guests ? { guests: true } : {}),
    };
}

const answerRefusal = (res, refusal) => res.send(refusalBody(refusal));

/* Thrown where a helper, not a route, finds the refusal; the route turns it into an answer. */
function refusalError(refusal) {
    const body = refusalBody(refusal);
    return Object.assign(new Error(body.message), { code: refusal.code, statusCode: body.statusCode, refusal, planLimit: true });
}

const isRefusalError = (error) => Boolean(error && error.planLimit === true);

module.exports = { formatBytes, messageFor, refusalBody, answerRefusal, refusalError, isRefusalError, STATUS };
