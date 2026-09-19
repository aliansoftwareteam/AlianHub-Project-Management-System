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
const WINDOW_DAYS = 7;
const COMPANY_LIMIT = 500;
const COMPANY_BATCH = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, code, statusText, data) => res.status(code).send({ status: false, statusText, ...(data ? { data } : {}) });

const flagState = () => ({ on: egressContext.isOn(), envKey: egressContext.ENV_KEY });

const flagOff = (res) => fail(res, 404, `${egressContext.ENV_KEY} is off, so agents fetch as before and there is no allowlist to show. Set it to true and restart.`, { flag: flagState() });

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
        updatedBy: (doc && doc.updatedBy) || '',
        refused7d: Number(refused7d) || 0,
    };
};

exports.summary = async (req, res) => {
    if (!egressContext.isOn()) return flagOff(res);
    try {
        const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
        const companies = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, {
            type: SCHEMA_TYPE.COMPANIES,
            data: [{}, 'Cst_CompanyName createdAt', { sort: { createdAt: -1 }, limit: COMPANY_LIMIT }],
        }, 'find');
        const workspaces = await inBatches(companies || [], COMPANY_BATCH, (company) => describeWorkspace(company, since));
        const names = await userNames(workspaces.map((w) => w.updatedBy));
        return ok(res, 'Egress summary.', {
            flag: flagState(),
            cacheTtlSeconds: store.CACHE_TTL_SECONDS,
            windowDays: WINDOW_DAYS,
            maxHosts: rules.MAX_HOSTS,
            workspaces: workspaces.map((w) => ({ ...w, updatedByName: names.get(w.updatedBy) || '' })),
        });
    } catch (error) {
        logger.error(`egress summary: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

const clientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'] || req.ip;
    return forwarded ? String(forwarded).split(',')[0] : '';
};

const auditListChange = (req, companyId, company, meta) => {
    const actorId = String(req.uid || '');
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
            meta,
        }));
};

exports.setHosts = async (req, res) => {
    if (!egressContext.isOn()) return flagOff(res);
    const id = String(req.params.companyId || '');
    if (!OBJECT_ID.test(id)) return fail(res, 400, 'companyId must be a workspace id.');
    const raw = req.body ? req.body.hosts : undefined;
    if (!Array.isArray(raw)) return fail(res, 400, 'hosts must be a list of hostnames.');
    const { hosts, errors } = rules.validateHosts(raw, { isBlockedHostname });
    if (errors.length) return fail(res, 400, 'Some entries were refused: list exact hostnames or *.suffix patterns, with an optional port.', { errors });
    try {
        const company = await findCompany(id);
        if (!company) return fail(res, 404, 'No such workspace.');
        const current = await store.readList(id);
        const before = current && Array.isArray(current.hosts) ? current.hosts.map(String) : [];
        const added = hosts.filter((host) => !before.includes(host));
        const removed = before.filter((host) => !hosts.includes(host));
        const changed = added.length > 0 || removed.length > 0;
        const saved = changed
            ? await store.replaceHosts(id, hosts, req.uid || req.instanceAdmin || '')
            : { hosts: before, updatedAt: (current && current.updatedAt) || null, updatedBy: (current && current.updatedBy) || '' };
        // An emptied list reopens the workspace to every public host, so the row says so rather than leaving it to count: 0.
        const emptied = before.length > 0 && hosts.length === 0;
        if (changed) auditListChange(req, id, company, { added, removed, count: hosts.length, ...(emptied ? { emptied: true } : {}) });
        return ok(res, changed ? 'Egress allowlist set.' : 'Egress allowlist unchanged.', {
            companyId: id, ...saved, cacheTtlSeconds: store.CACHE_TTL_SECONDS,
        });
    } catch (error) {
        logger.error(`egress allowlist ${id}: ${error.message || error}`);
        return fail(res, 500, error.message);
    }
};

module.exports.LIST_CHANGED_ACTION = LIST_CHANGED_ACTION;
module.exports.WINDOW_DAYS = WINDOW_DAYS;
