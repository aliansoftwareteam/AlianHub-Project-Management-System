const { SCHEMA_TYPE } = require('./schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { recordAuditFromReq } = require('../Modules/Audit/recorder');
const logger = require('./loggerConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_USER_IDS = 5;
const GLOBAL_SCOPE = 'global';
const UNKNOWN_ROUTE = 'unknown';
const REFUSED_ACTION = 'permission.refused';

/*
 * Every reason but denied names a likely cause, so the log can be read before a workspace enforces.
 * null_global_flag is a known difference (tests/fixtures/permissionParity.json): the project's flag is null,
 * which the web app reads as the project's own rules, and those would allow.
 */
const REASONS = Object.freeze({
    DENIED: 'denied',
    NO_SEAT: 'no_seat',
    ROLE_NOT_ALLOWED: 'role_not_allowed',
    TASKS_NOT_FOUND: 'tasks_not_found',
    NULL_GLOBAL_FLAG: 'null_global_flag',
    CHECK_FAILED: 'check_failed',
});

const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/* The pattern Express matched, never the URL, which carries ids and the query string. */
const routePattern = (req) => {
    const path = req && req.route && req.route.path;
    return path === undefined || path === null ? UNKNOWN_ROUTE : `${req.baseUrl || ''}${String(path)}`;
};

const decisionKey = (req, { mode, permission, role, scope, reason }, at) => ({
    day: utcDay(at),
    mode,
    method: String((req && req.method) || '').toUpperCase(),
    route: routePattern(req),
    permission: String(permission),
    role: typeof role === 'number' ? role : null,
    scope: scope ? String(scope) : GLOBAL_SCOPE,
    reason,
});

const writeDecision = async (companyId, key, uid, at) => {
    const type = SCHEMA_TYPE.PERMISSION_DECISIONS;
    await MongoDbCrudOpration(companyId, {
        type,
        data: [key, { $inc: { count: 1 }, $set: { lastSeen: at }, $setOnInsert: { firstSeen: at } }, { upsert: true }],
    }, 'updateOne');
    if (!OBJECT_ID.test(uid)) return;
    // The filter and the push apply to one document atomically, so concurrent writers cannot pass five.
    await MongoDbCrudOpration(companyId, {
        type,
        data: [{ ...key, userIds: { $ne: uid }, [`userIds.${MAX_USER_IDS - 1}`]: { $exists: false } }, { $push: { userIds: uid } }],
    }, 'updateOne');
};

const auditRefusal = (req, key) => recordAuditFromReq(req, {
    action: REFUSED_ACTION,
    entityType: 'permission',
    entityId: key.permission,
    entityName: key.permission,
    meta: { mode: key.mode, method: key.method, route: key.route, role: key.role, scope: key.scope, reason: key.reason },
});

const fail = (error) => logger.error(`permission decision not recorded: ${(error && error.message) || error}`);

/*
 * Records a would-be denial (report) or a refusal (enforce) once the response has finished, so the write
 * can neither delay nor change it. Never throws.
 */
const recordDecision = (req, res, decision) => {
    try {
        const companyId = String(decision.companyId || '');
        if (!OBJECT_ID.test(companyId) || !res || typeof res.on !== 'function') return;
        const at = new Date();
        const key = decisionKey(req, decision, at);
        const uid = String(decision.uid || '');
        res.on('finish', () => {
            try {
                writeDecision(companyId, key, uid, at).catch(fail);
                if (key.mode === 'enforce') auditRefusal(req, key);
            } catch (error) {
                fail(error);
            }
        });
    } catch (error) {
        fail(error);
    }
};

module.exports = { REASONS, GLOBAL_SCOPE, recordDecision };
