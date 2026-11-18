const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const guard = require('../AICore/instructionGuard');
const rules = require('../AICore/instructionPatternRules');
const store = require('../AICore/instructionPatterns');
const { requestAddress } = require('../../utils/requestAddress');

const ADDED_ACTION = 'ai.instruction_pattern_added';
const REMOVED_ACTION = 'ai.instruction_pattern_removed';
const ADMIN_KEY_ACTOR = 'instance-admin-key';
const BUILT_IN_PREFIX = 'builtin:';
const HISTORY_LIMIT = 20;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// The screen translates codes and refusal reasons; statusText is the English fallback for scripts.
const CODE = Object.freeze({
    PATTERN_REFUSED: 'pattern_refused',
    TOO_MANY: 'too_many',
    BUILTIN_LOCKED: 'builtin_locked',
    INVALID_ID: 'invalid_id',
    UNKNOWN_PATTERN: 'unknown_pattern',
    SERVER_ERROR: 'server_error',
});
const REASON = Object.freeze({ ...rules.REASONS, BUILTIN: 'builtin', DUPLICATE: 'duplicate' });
const REASON_TEXT = Object.freeze({
    ...rules.REASON_TEXT,
    [REASON.BUILTIN]: 'That pattern is already on the built-in list.',
    [REASON.DUPLICATE]: 'That pattern is already on the list.',
});

const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, status, code, statusText, data) => res.status(status).send({ status: false, statusText, code, ...(data ? { data } : {}) });
const refusePattern = (res, reason) => fail(res, 400, CODE.PATTERN_REFUSED, REASON_TEXT[reason], { reason });
const serverError = (res) => fail(res, 500, CODE.SERVER_ERROR, 'The instruction patterns could not be read or saved; the server log has the cause.');

const builtIn = () => guard.INSTRUCTION_PATTERNS.map((re, i) => ({ id: `${BUILT_IN_PREFIX}${i}`, source: re.source, locked: true }));

const userNames = async (ids) => {
    const wanted = [...new Set(ids.map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!wanted.length) return new Map();
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: wanted } }, { Employee_Name: 1 }] }, 'find');
    return new Map((users || []).map((user) => [String(user._id), user.Employee_Name || '']));
};

const byAdminKey = (req) => req.instanceAdmin === 'key';
const actorOf = (req) => (byAdminKey(req) ? ADMIN_KEY_ACTOR : String(req.uid || ''));

/* The list is instance-wide, so its rows go to the global database's audit log rather than any one workspace's. */
const audit = (req, action, row) => {
    const actorId = actorOf(req);
    const meta = { source: row.source, note: row.note || '' };
    userNames([actorId])
        .catch((error) => {
            logger.error(`instruction patterns audit actor ${actorId}: ${error.message || error}`);
            return new Map();
        })
        .then((names) => recordAudit(SCHEMA_TYPE.GOLBAL, {
            actorId,
            actorName: names.get(actorId) || '',
            ip: requestAddress(req),
            action,
            entityType: 'instruction_pattern',
            entityId: String(row._id),
            entityName: row.source,
            meta: byAdminKey(req) ? { ...meta, via: 'admin_key' } : meta,
        }));
};

const history = () => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.AUDIT_LOGS,
    data: [{ action: { $in: [ADDED_ACTION, REMOVED_ACTION] } }, null, { sort: { createdAt: -1, _id: -1 }, limit: HISTORY_LIMIT }],
}, 'find');

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

exports.summary = async (req, res) => {
    try {
        const [rows, changes] = await Promise.all([store.list(), history()]);
        const added = (rows || []).map(plain);
        const recent = (changes || []).map(plain);
        const names = await userNames([...added.map((row) => row.addedBy), ...recent.map((row) => row.actorId)]);
        return ok(res, 'Instruction patterns.', {
            builtIn: builtIn(),
            added: added.map((row) => ({
                id: String(row._id), source: row.source, note: row.note || '', addedBy: row.addedBy || '', addedByName: names.get(String(row.addedBy)) || '', addedAt: row.addedAt || null, locked: false,
            })),
            history: recent.map((row) => ({
                action: row.action, actorId: row.actorId || '', actorName: row.actorName || names.get(String(row.actorId)) || '', source: (row.meta && row.meta.source) || row.entityName || '', note: (row.meta && row.meta.note) || '', at: row.createdAt || null,
            })),
            cacheTtlSeconds: store.CACHE_TTL_SECONDS,
            limits: {
                maxLength: store.MAX_LENGTH, maxPatterns: store.MAX_PATTERNS, maxRepeats: store.MAX_REPEATS, maxRepeatBound: store.MAX_REPEAT_BOUND, maxNote: store.MAX_NOTE, matchTimeoutMs: guard.MATCH_TIMEOUT_MS,
            },
        });
    } catch (error) {
        logger.error(`instruction patterns summary: ${error.message || error}`);
        return serverError(res);
    }
};

exports.add = async (req, res) => {
    const body = req.body || {};
    const checked = rules.checkPattern(body.source);
    if (!checked.ok) return refusePattern(res, checked.reason);
    if (builtIn().some((p) => p.source === checked.source)) return refusePattern(res, REASON.BUILTIN);
    try {
        if (await store.count({ source: checked.source })) return refusePattern(res, REASON.DUPLICATE);
        if (await store.count() >= store.MAX_PATTERNS) {
            return fail(res, 409, CODE.TOO_MANY, `The list holds at most ${store.MAX_PATTERNS} added patterns; remove one first.`, { max: store.MAX_PATTERNS });
        }
        const saved = plain(await store.add({ source: checked.source, note: typeof body.note === 'string' ? body.note : '', addedBy: actorOf(req) }));
        audit(req, ADDED_ACTION, saved);
        return ok(res, 'Instruction pattern added.', {
            pattern: { id: String(saved._id), source: saved.source, note: saved.note || '', addedBy: saved.addedBy, addedAt: saved.addedAt, locked: false },
            cacheTtlSeconds: store.CACHE_TTL_SECONDS,
        });
    } catch (error) {
        logger.error(`instruction patterns add: ${error.message || error}`);
        return serverError(res);
    }
};

exports.remove = async (req, res) => {
    const id = String(req.params.id || '');
    if (id.startsWith(BUILT_IN_PREFIX)) return fail(res, 403, CODE.BUILTIN_LOCKED, 'Built-in patterns cannot be removed.');
    if (!OBJECT_ID.test(id)) return fail(res, 400, CODE.INVALID_ID, 'That is not a pattern id.');
    try {
        const removed = plain(await store.remove(id));
        if (!removed) return fail(res, 404, CODE.UNKNOWN_PATTERN, 'That pattern is not on the list.');
        audit(req, REMOVED_ACTION, removed);
        return ok(res, 'Instruction pattern removed.', { id, cacheTtlSeconds: store.CACHE_TTL_SECONDS });
    } catch (error) {
        logger.error(`instruction patterns remove ${id}: ${error.message || error}`);
        return serverError(res);
    }
};

module.exports.ADDED_ACTION = ADDED_ACTION;
module.exports.REMOVED_ACTION = REMOVED_ACTION;
module.exports.CODE = CODE;
module.exports.REASON = REASON;
