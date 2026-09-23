const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const egressContext = require('../Agents/engine/egressContext');
const rules = require('../Agents/engine/egressRules');
const store = require('../Agents/engine/egressAllowlist');
const { isBlockedHostname } = require('../Agents/engine/safeFetch');

const LIST_CHANGED_ACTION = 'agent.egress_allowlist';
const ADMIN_KEY_ACTOR = 'instance-admin-key';
// Admin-key saves stored this before the key had an actor of its own.
const LEGACY_ADMIN_KEY_ACTOR = 'key';
const WINDOW_DAYS = 7;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const COMPANY_BATCH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// The screen translates these; statusText is the English fallback for scripts and for a code it does not know.
const CODE = Object.freeze({
    FLAG_OFF: 'flag_off',
    INVALID_COMPANY_ID: 'invalid_company_id',
    HOSTS_NOT_LIST: 'hosts_not_list',
    ENTRIES_REFUSED: 'entries_refused',
    VERSION_REQUIRED: 'version_required',
    STALE_VERSION: 'stale_version',
    UNKNOWN_WORKSPACE: 'unknown_workspace',
    SERVER_ERROR: 'server_error',
});

const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, status, code, statusText, data) => res.status(status).send({ status: false, statusText, code, ...(data ? { data } : {}) });

const storedActor = (doc) => {
    const by = (doc && doc.updatedBy) || '';
    return by === LEGACY_ADMIN_KEY_ACTOR ? ADMIN_KEY_ACTOR : by;
};

const flagState = () => ({ on: egressContext.isOn(), envKey: egressContext.ENV_KEY });

const flagOff = (res) => fail(res, 404, CODE.FLAG_OFF, `${egressContext.ENV_KEY} is off, so agents fetch as before and there is no allowlist to show. Set it to true and restart.`, { flag: flagState() });

const serverError = (res) => fail(res, 500, CODE.SERVER_ERROR, 'The egress allowlist could not be read or saved; the server log has the cause.');

const findCompany = (id) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
    type: SCHEMA_TYPE.COMPANIES,
    data: [{ _id: new mongoose.Types.ObjectId(id) }, 'Cst_CompanyName'],
}, 'findOne');

const userNames = async (ids) => {
    const wanted = [...new Set(ids.map(String).filter((id) => OBJECT_ID.test(id)))];
    if (!wanted.length) return new Map();
    const users = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: wanted } }, { Employee_Name: 1 }] }, 'find');
    return new Map((users || []).map((user) => [String(user._id), user.Employee_Name || '']));
};

const inBatches = async (items, size, fn) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
        // eslint-disable-next-line no-await-in-loop
        out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    }
    return out;
};

const describeWorkspace = async (company, since) => {
    const companyId = String(company._id);
    const [doc, refused7d] = await Promise.all([store.readList(companyId), store.refusedSince(companyId, since)]);
    return {
        companyId,
        name: company.Cst_CompanyName || '',
        hosts: doc && Array.isArray(doc.hosts) ? doc.hosts.map(String) : [],
        updatedAt: (doc && doc.updatedAt) || null,
        updatedBy: storedActor(doc),
        refused7d: Number(refused7d) || 0,
        version: store.versionOf(doc),
    };
};

/* A whole number within [min, max], from a query value that may be anything; 1e308 and Infinity land on max. */
const within = (value, fallback, min, max) => {
    const n = Number(value);
    if (Number.isNaN(n) || n === 0) return Math.min(max, Math.max(min, fallback));
    return Math.min(max, Math.max(min, Math.floor(n)));
};

exports.summary = async (req, res) => {
    if (!egressContext.isOn()) return flagOff(res);
    try {
        const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
        const pageSize = within(req.query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
        const total = Number(await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.COMPANIES, data: [{}] }, 'countDocuments')) || 0;
        const page = within(req.query.page, 1, 1, Math.max(1, Math.ceil(total / pageSize)));
        const companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1, _id: -1 }, skip: (page - 1) * pageSize, limit: pageSize }],
        }, 'find');
        const workspaces = await inBatches(companies || [], COMPANY_BATCH, (company) => describeWorkspace(company, since));
        const names = await userNames(workspaces.map((w) => w.updatedBy));
        return ok(res, 'Egress summary.', {
            flag: flagState(),
            cacheTtlSeconds: store.CACHE_TTL_SECONDS,
            windowDays: WINDOW_DAYS,
            maxHosts: rules.MAX_HOSTS,
            page,
            pageSize,
            total,
            workspaces: workspaces.map((w) => ({ ...w, updatedByName: names.get(w.updatedBy) || '' })),
        });
    } catch (error) {
        logger.error(`egress summary: ${error.message || error}`);
        return serverError(res);
    }
};

const clientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'] || req.ip;
    return forwarded ? String(forwarded).split(',')[0] : '';
};

const byAdminKey = (req) => req.instanceAdmin === 'key';
const actorOf = (req) => (byAdminKey(req) ? ADMIN_KEY_ACTOR : String(req.uid || ''));

const auditListChange = (req, companyId, company, meta) => {
    const actorId = actorOf(req);
    userNames([actorId])
        .catch((error) => {
            logger.error(`egress audit actor ${actorId}: ${error.message || error}`);
            return new Map();
        })
        .then((names) => recordAudit(companyId, {
            actorId,
            actorName: names.get(actorId) || '',
            ip: clientIp(req),
            action: LIST_CHANGED_ACTION,
            entityType: 'company',
            entityId: companyId,
            entityName: company.Cst_CompanyName || '',
            meta: byAdminKey(req) ? { ...meta, via: 'admin_key' } : meta,
        }));
};

exports.setHosts = async (req, res) => {
    if (!egressContext.isOn()) return flagOff(res);
    const id = String(req.params.companyId || '');
    if (!OBJECT_ID.test(id)) return fail(res, 400, CODE.INVALID_COMPANY_ID, 'companyId must be a workspace id.');
    const raw = req.body ? req.body.hosts : undefined;
    if (!Array.isArray(raw)) return fail(res, 400, CODE.HOSTS_NOT_LIST, 'hosts must be a list of hostnames.');
    const expected = req.body.version;
    if (!Number.isInteger(expected) || expected < 0) return fail(res, 400, CODE.VERSION_REQUIRED, 'version must be the list version the save was made from, as the summary gave it.');
    const { hosts, errors } = rules.validateHosts(raw, { isBlockedHostname });
    if (errors.length) return fail(res, 400, CODE.ENTRIES_REFUSED, 'Some entries were refused: list exact hostnames or *.suffix patterns, with an optional port.', { errors });
    const stale = (version) => fail(res, 409, CODE.STALE_VERSION, 'The list changed since it was read; reload it and make the change again.', { version });
    try {
        const company = await findCompany(id);
        if (!company) return fail(res, 404, CODE.UNKNOWN_WORKSPACE, 'No such workspace.');
        const current = await store.readList(id);
        if (store.versionOf(current) !== expected) return stale(store.versionOf(current));
        const before = current && Array.isArray(current.hosts) ? current.hosts.map(String) : [];
        const added = hosts.filter((host) => !before.includes(host));
        const removed = before.filter((host) => !hosts.includes(host));
        const changed = added.length > 0 || removed.length > 0;
        const saved = changed
            ? await store.replaceHosts(id, hosts, actorOf(req), expected)
            : { hosts: before, updatedAt: (current && current.updatedAt) || null, updatedBy: storedActor(current), version: expected };
        if (!saved) return stale(store.versionOf(await store.readList(id)));
        // An emptied list reopens the workspace to every public host, so the row says so rather than leaving it to count: 0.
        const emptied = before.length > 0 && hosts.length === 0;
        if (changed) auditListChange(req, id, company, { added, removed, count: hosts.length, ...(emptied ? { emptied: true } : {}) });
        return ok(res, changed ? 'Egress allowlist set.' : 'Egress allowlist unchanged.', {
            companyId: id, ...saved, cacheTtlSeconds: store.CACHE_TTL_SECONDS,
        });
    } catch (error) {
        logger.error(`egress allowlist ${id}: ${error.message || error}`);
        return serverError(res);
    }
};

module.exports.LIST_CHANGED_ACTION = LIST_CHANGED_ACTION;
module.exports.ADMIN_KEY_ACTOR = ADMIN_KEY_ACTOR;
module.exports.CODE = CODE;
module.exports.WINDOW_DAYS = WINDOW_DAYS;
