const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const settings = require('../../Config/instanceSettings');
const socketEmitter = require('../../event/socketEventEmitter');
const enforcement = require('../../Config/permissionEnforcement');
const { REASONS, KNOWN_DIFFERENCE_REASONS } = require('../../Config/permissionDecisions');
const { recordAudit } = require('../Audit/recorder');
const { requestAddress } = require('../../utils/requestAddress');

const { MODES, INHERIT, INSTANCE_ENV_KEY, COMPANY_FIELD, REPORT } = enforcement;
const READY_AFTER_DAYS = 14;
const WINDOW_DAYS = 30;
const INSTANCE_BUCKET_ID = 'instance';
const MODE_CHANGED_ACTION = 'permission.enforcement_mode';
const ROW_LIMIT = 2000;
const COMPANY_LIMIT = 500;
const COMPANY_BATCH = 10;
const KEY_MAX_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const REASON_VALUES = Object.values(REASONS);

const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, code, statusText, data) => res.status(code).send({ status: false, statusText, ...(data ? { data } : {}) });

const utcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const windowStart = (now, days) => utcDay(new Date(now.getTime() - days * DAY_MS));
const daysBetween = (from, to) => Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS);
const asDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/* Quiet days run from the later of the last row and the moment the console set the mode: silence
 * before a mode change proves nothing, and a row today resets the count. */
const readiness = ({ effectiveMode, lastRowAt, since, now = new Date() }) => {
    const starts = [lastRowAt, since].map(asDate).filter(Boolean).map((date) => date.getTime());
    if (!starts.length) return { streakDays: null, readyToEnforce: false };
    const streakDays = Math.max(0, daysBetween(Math.max(...starts), now));
    return { streakDays, readyToEnforce: effectiveMode === REPORT && streakDays >= READY_AFTER_DAYS };
};

const companySetting = (company) => {
    const stored = company ? company[COMPANY_FIELD] : undefined;
    const object = stored !== null && typeof stored === 'object' ? stored : {};
    return { mode: enforcement.normaliseCompanyMode(stored), since: asDate(object.since) };
};

const instanceDefault = () => {
    const row = settings.describe().find((field) => field.key === INSTANCE_ENV_KEY) || {};
    return { mode: enforcement.instanceMode(), source: row.source || 'default', locked: Boolean(row.locked), killSwitch: enforcement.killSwitchOn() };
};

const findCompany = (id) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.COMPANIES,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, `Cst_CompanyName ${COMPANY_FIELD}`],
}, 'findOne');

const userNames = async (ids) => {
    const wanted = [...new Set(ids.map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!wanted.length) return new Map();
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: wanted } }, { Employee_Name: 1 }] }, 'find');
    return new Map((users || []).map((user) => [String(user._id), user.Employee_Name || '']));
};

const rowStats = async (dbId, now) => {
    const groups = await MongoDbCrudOpration(dbId, {
        type: SCHEMA_TYPE.PERMISSION_DECISIONS,
        data: [[
            { $match: { day: { $gte: windowStart(now, WINDOW_DAYS) } } },
            { $group: { _id: '$mode', rows: { $sum: '$count' }, lastSeen: { $max: '$lastSeen' }, firstSeen: { $min: '$firstSeen' } } },
        ]],
    }, 'aggregate');
    const stats = { rows30d: 0, lastRowAt: null, firstReportRowAt: null };
    (groups || []).forEach((group) => {
        stats.rows30d += Number(group.rows) || 0;
        const lastSeen = asDate(group.lastSeen);
        if (lastSeen && (!stats.lastRowAt || lastSeen > stats.lastRowAt)) stats.lastRowAt = lastSeen;
        if (group._id === REPORT) stats.firstReportRowAt = asDate(group.firstSeen);
    });
    return stats;
};

const inBatches = async (items, size, fn) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        // eslint-disable-next-line no-await-in-loop
        out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    }
    return out;
};

const describeWorkspace = async (company, now) => {
    const companyId = String(company._id);
    const setting = companySetting(company);
    const effectiveMode = enforcement.effectiveMode(setting.mode);
    const stats = await rowStats(companyId, now);
    return {
        companyId,
        name: company.Cst_CompanyName || '',
        mode: setting.mode || INHERIT,
        effectiveMode,
        since: setting.since,
        ...stats,
        daysSinceFirstReportRow: stats.firstReportRowAt ? daysBetween(stats.firstReportRowAt, now) : null,
        ...readiness({ effectiveMode, lastRowAt: stats.lastRowAt, since: setting.since, now }),
    };
};

exports.summary = async (req, res) => {
    try {
        const now = new Date();
        const companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, `Cst_CompanyName ${COMPANY_FIELD} createdAt`, { sort: { createdAt: -1 }, limit: COMPANY_LIMIT }],
        }, 'find');
        const workspaces = await inBatches(companies || [], COMPANY_BATCH, (company) => describeWorkspace(company, now));
        const bucket = await rowStats(SCHEMA_TYPE.GOLBAL, now);
        return ok(res, 'Enforcement summary.', {
            instance: instanceDefault(),
            cacheTtlSeconds: enforcement.cacheTtlSeconds(),
            readyAfterDays: READY_AFTER_DAYS,
            workspaces,
            instanceBucket: { companyId: INSTANCE_BUCKET_ID, rows30d: bucket.rows30d, lastRowAt: bucket.lastRowAt },
        });
    } catch (error) {
        logger.error(`enforcement summary: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

const windowDays = (raw) => {
    const days = Number(raw);
    return Number.isInteger(days) && days >= 1 && days <= WINDOW_DAYS ? days : WINDOW_DAYS;
};

const shapeRow = (row, names) => ({
    id: String(row._id),
    day: row.day,
    mode: row.mode,
    method: row.method,
    route: row.route,
    permission: row.permission,
    role: typeof row.role === 'number' ? row.role : null,
    scope: row.scope,
    reason: row.reason,
    knownDifference: KNOWN_DIFFERENCE_REASONS.includes(row.reason),
    count: Number(row.count) || 0,
    firstSeen: row.firstSeen || null,
    lastSeen: row.lastSeen || null,
    users: (row.userIds || []).map((id) => ({ id: String(id), name: names.get(String(id)) || '' })),
});

exports.decisions = async (req, res) => {
    const id = String(req.params.companyId || '');
    const reason = String(req.query.reason || '').trim();
    const key = String(req.query.key || '').trim().slice(0, KEY_MAX_LENGTH);
    if (id !== INSTANCE_BUCKET_ID && !OBJECT_ID.test(id)) return fail(res, 400, `companyId must be a workspace id or "${INSTANCE_BUCKET_ID}".`);
    if (reason && !REASON_VALUES.includes(reason)) return fail(res, 400, `reason must be one of ${REASON_VALUES.join(', ')}.`);
    try {
        if (id !== INSTANCE_BUCKET_ID && !(await findCompany(id))) return fail(res, 404, 'No such workspace.');
        const days = windowDays(req.query.days);
        const filter = { day: { $gte: windowStart(new Date(), days) } };
        if (reason) filter.reason = reason;
        if (key) filter.permission = key;
        const rows = await MongoDbCrudOpration(id === INSTANCE_BUCKET_ID ? SCHEMA_TYPE.GOLBAL : id, {
            type: SCHEMA_TYPE.PERMISSION_DECISIONS,
            data: [filter, null, { sort: { lastSeen: -1 }, limit: ROW_LIMIT }],
        }, 'find');
        const names = await userNames((rows || []).flatMap((row) => row.userIds || []));
        return ok(res, 'Decision rows.', {
            companyId: id,
            days,
            reasons: REASON_VALUES,
            knownDifferenceReasons: [...KNOWN_DIFFERENCE_REASONS],
            rows: (rows || []).map((row) => shapeRow(row, names)),
        });
    } catch (error) {
        logger.error(`enforcement decisions ${id}: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

const requestedMode = (body, { allowInherit }) => {
    const raw = body ? body.mode : undefined;
    if (typeof raw !== 'string') return null;
    const value = raw.trim().toLowerCase();
    if (allowInherit && value === INHERIT) return INHERIT;
    return MODES.includes(value) ? value : null;
};

const auditModeChange = (req, companyId, company, meta) => {
    const actorId = String(req.uid || '');
    userNames([actorId])
        .catch((error) => {
            logger.error(`enforcement audit actor ${actorId}: ${error.message || error}`);
            return new Map();
        })
        .then((names) => recordAudit(companyId, {
            actorId,
            actorName: names.get(actorId) || '',
            ip: requestAddress(req),
            action: MODE_CHANGED_ACTION,
            entityType: 'company',
            entityId: companyId,
            entityName: company.Cst_CompanyName || '',
            meta,
        }));
};

exports.setMode = async (req, res) => {
    const id = String(req.params.companyId || '');
    if (!OBJECT_ID.test(id)) return fail(res, 400, 'companyId must be a workspace id.');
    const wanted = requestedMode(req.body, { allowInherit: true });
    if (!wanted) return fail(res, 400, `mode must be one of ${[INHERIT, ...MODES].join(', ')}.`);
    try {
        const company = await findCompany(id);
        if (!company) return fail(res, 404, 'No such workspace.');
        const current = companySetting(company);
        const from = current.mode || INHERIT;
        const changed = from !== wanted;
        let since = current.since;
        if (changed) {
            since = wanted === INHERIT ? null : new Date();
            const update = wanted === INHERIT
                ? { $unset: { [COMPANY_FIELD]: '' } }
                : { $set: { [COMPANY_FIELD]: { mode: wanted, since, updatedBy: String(req.uid || req.instanceAdmin || '') } } };
            await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{ _id: new mongoose.Types.ObjectId(id) }, update] }, 'updateOne');
            enforcement.invalidateEnforcementMode(id);
        }
        const effectiveMode = enforcement.effectiveMode(wanted === INHERIT ? null : wanted);
        if (changed) auditModeChange(req, id, company, { from, to: wanted, effectiveMode });
        return ok(res, changed ? 'Enforcement mode set.' : 'Enforcement mode unchanged.', {
            companyId: id, mode: wanted, effectiveMode, since, cacheTtlSeconds: enforcement.cacheTtlSeconds(),
        });
    } catch (error) {
        logger.error(`enforcement mode ${id}: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

exports.setDefault = async (req, res) => {
    const wanted = requestedMode(req.body, { allowInherit: false });
    if (!wanted) return fail(res, 400, `mode must be one of ${MODES.join(', ')}.`);
    const before = instanceDefault();
    if (before.locked) {
        return fail(res, 409, `${INSTANCE_ENV_KEY} is set in the environment, so the console cannot change it. Change it there and restart.`, { source: 'env', mode: before.mode });
    }
    try {
        const result = await settings.saveInstanceSettings({ [INSTANCE_ENV_KEY]: wanted }, req.uid || req.instanceAdmin);
        socketEmitter.emit('update', { module: 'instanceSettings', event: 'INSTANCE_SETTINGS_UPDATED', keys: result.applied });
        return ok(res, 'Instance default set.', instanceDefault());
    } catch (error) {
        logger.error(`enforcement default: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

module.exports.readiness = readiness;
module.exports.READY_AFTER_DAYS = READY_AFTER_DAYS;
module.exports.INSTANCE_BUCKET_ID = INSTANCE_BUCKET_ID;
module.exports.MODE_CHANGED_ACTION = MODE_CHANGED_ACTION;
