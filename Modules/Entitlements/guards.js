const hostingMode = require('../../Config/hostingMode');
const logger = require('../../Config/loggerConfig');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { canAssignTrackerSeat, canCreateWorkspace, CODES } = require('./checks');
const { answerRefusal, refusalBody } = require('./answers');
const { feature, limits } = require('./entitlements');
const { seatRefusal, seatSnapshot } = require('./seats');

const isGuestRole = (role) => role !== undefined && role !== null && role !== '' && Number(role) === ROLE_GUEST;

const failOpen = (name, next) => (error) => {
    logger.error(`[entitlements] ${name} check failed, letting the request through: ${error && error.message ? error.message : error}`);
    next();
};

/* Sending invitations: live seats, invitations still open and the new addresses together. */
const requireInvitationSeats = (req, res, next) => {
    if (!hostingMode.isManaged()) return next();
    const body = req.body || {};
    return seatRefusal([{ email: body.email, guest: isGuestRole(body.role) }], { includePending: true })
        .then((refusal) => (refusal ? answerRefusal(res, refusal) : next()))
        .catch(failOpen('invitation seat', next));
};

const requireImportSeats = (req, res, next) => {
    if (!hostingMode.isManaged()) return next();
    const users = Array.isArray(req.body && req.body.users) ? req.body.users : [];
    const people = users.map((user) => ({ email: user && user.email, guest: isGuestRole(user && user.role) }));
    return seatRefusal(people, { includePending: true })
        .then((refusal) => (refusal ? answerRefusal(res, refusal) : next()))
        .catch(failOpen('import seat', next));
};

/* Accepting an invitation, by link, signed in or through an identity provider: the person's seat
 * goes live, which needs one free seat unless they already hold one somewhere. */
const acceptanceRefusal = ({ userId, email, roleType }) => seatRefusal([{ userId: userId ? String(userId) : '', email, guest: isGuestRole(roleType) }]);

/* Desktop tracker sign-in and the routes only the tracker calls. */
const TRACKER_ONLY = [
    /^\/api\/v1\/auth\/loginAuthTracker$/i,
    /^\/api\/v2\/auth\/tracker-code$/i,
    /^\/api\/v[23]\/timeTracker\/start$/i,
    /^\/api\/v2\/timetracker\/end$/i,
    /^\/api\/v[234]\/timetracker\/capture$/i,
];

const trackerRefusal = () => {
    if (!hostingMode.isManaged()) return null;
    return feature('timeTracker').enabled ? null : { ok: false, code: CODES.TRACKER_DISABLED, limit: 0, used: 0 };
};

const trackerGate = (req, res, next) => {
    if (!hostingMode.isManaged() || !TRACKER_ONLY.some((pattern) => pattern.test(req.path))) return next();
    const refusal = trackerRefusal();
    return refusal ? res.status(403).send(refusalBody(refusal)) : next();
};

/* Turning tracker access on for someone: the add-on must be on, and a person not yet tracked
 * anywhere takes one of its seats. */
async function trackerSeatRefusal(userId) {
    if (!hostingMode.isManaged()) return null;
    const tracker = feature('timeTracker');
    if (!tracker.enabled) return canAssignTrackerSeat({ used: 0, limit: 0, enabled: false });
    const snapshot = await seatSnapshot({ fresh: true });
    if (userId && snapshot.trackerIds.has(String(userId))) return null;
    const verdict = canAssignTrackerSeat({ used: snapshot.trackerUsers, limit: tracker.seats, enabled: true });
    return verdict.ok ? null : verdict;
}

function mongoWorkspaceCount() {
    const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{ deletingAt: { $exists: false } }] }, 'countDocuments')
        .then((count) => Number(count) || 0);
}

let countWorkspaces = mongoWorkspaceCount;

async function workspaceState() {
    const limit = limits().workspaces;
    const count = await countWorkspaces();
    const verdict = canCreateWorkspace({ count, limit });
    return { count, limit, canCreate: verdict.ok, refusal: verdict.ok ? null : verdict };
}

async function workspaceRefusal() {
    if (!hostingMode.isManaged()) return null;
    return (await workspaceState()).refusal;
}

const requireWorkspaceRoom = (req, res, next) => {
    if (!hostingMode.isManaged()) return next();
    return workspaceRefusal()
        .then((refusal) => (refusal ? answerRefusal(res, refusal) : next()))
        .catch(failOpen('workspace', next));
};

module.exports = {
    isGuestRole, requireInvitationSeats, requireImportSeats, acceptanceRefusal, trackerRefusal, trackerGate, trackerSeatRefusal,
    workspaceState, workspaceRefusal, requireWorkspaceRoom, TRACKER_ONLY,
    _useWorkspaceCountForTests: (next) => { countWorkspaces = next || mongoWorkspaceCount; },
};
