const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { requireAdmin, rotateScimToken, getScimConfig } = require('./auth');
const prov = require('./provisioning');
const R = require('./helpers/scimRules');
const discovery = require('./discovery');

const baseUrlOf = (req) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
};
const scimBaseOf = (req) => `${baseUrlOf(req)}/scim/v2`;
const audit = (req, entry) => {
    try { require('../Audit/recorder').recordAuditFromReq(req, entry); } catch (e) { /* best-effort */ }
};

// ---------------------------------------------------------------------------
// Admin config (JWT + companyId; owner/admin gated)
// ---------------------------------------------------------------------------
exports.getConfig = async (req, res) => {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return res.status(gate.code).json({ status: false, statusText: gate.msg });
        const cfg = await getScimConfig(gate.companyId);
        return res.send({
            status: true,
            data: {
                isEnabled: !!(cfg && cfg.isEnabled),
                hasToken: !!(cfg && cfg.tokenHash),
                tokenLast4: (cfg && cfg.tokenLast4) || null,
                defaultRoleType: (cfg && cfg.defaultRoleType) || 3,
                baseUrl: scimBaseOf(req),
            },
        });
    } catch (e) { logger.error(`scim.getConfig: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.setConfig = async (req, res) => {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return res.status(gate.code).json({ status: false, statusText: gate.msg });
        const set = { updatedBy: req.uid || '' };
        if (req.body.isEnabled !== undefined) set.isEnabled = !!req.body.isEnabled;
        if (req.body.defaultRoleType !== undefined) set.defaultRoleType = Number(req.body.defaultRoleType) || 3;
        const saved = await MongoDbCrudOpration(gate.companyId, {
            type: SCHEMA_TYPE.SCIM_CONFIGS,
            data: [
                { deletedStatusKey: 0 },
                { $set: set, $setOnInsert: { createdBy: req.uid || '' } },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');
        audit(req, { action: 'scim.config_update', entityType: 'scim', meta: { isEnabled: set.isEnabled } });
        return res.send({ status: true, statusText: 'SCIM config saved.', data: { isEnabled: !!(saved && saved.isEnabled), defaultRoleType: (saved && saved.defaultRoleType) || 3 } });
    } catch (e) { logger.error(`scim.setConfig: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.rotateToken = async (req, res) => {
    try {
        const gate = await requireAdmin(req);
        if (!gate.ok) return res.status(gate.code).json({ status: false, statusText: gate.msg });
        const token = await rotateScimToken(gate.companyId, req.uid);
        audit(req, { action: 'scim.token_rotate', entityType: 'scim' });
        return res.send({
            status: true,
            statusText: 'SCIM token generated. Copy it now — it will not be shown again.',
            data: { token, baseUrl: scimBaseOf(req) },
        });
    } catch (e) { logger.error(`scim.rotateToken: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// ---------------------------------------------------------------------------
// SCIM 2.0 protocol (bearer auth; req.scimCompanyId set by scimAuth)
// ---------------------------------------------------------------------------
exports.serviceProviderConfig = (req, res) => res.json(discovery.spProviderConfig(scimBaseOf(req)));
exports.resourceTypes = (req, res) => res.json(discovery.resourceTypes(scimBaseOf(req)));
exports.schemas = (req, res) => res.json(discovery.schemas());

exports.listUsers = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const email = R.parseUserNameFilter(req.query.filter);
        const startIndex = Math.max(1, Number(req.query.startIndex) || 1);
        const countParam = req.query.count != null ? Number(req.query.count) : 100;
        const count = Math.min(200, Math.max(0, isNaN(countParam) ? 100 : countParam));
        const { members, total } = await prov.listMembers(companyId, email, startIndex - 1, count || 1);
        const wanted = count === 0 ? [] : members;
        const users = await prov.getGlobalUsersByIds(wanted.map((m) => m.userId));
        const byId = {};
        (users || []).forEach((u) => { byId[String(u._id)] = u; });
        const resources = wanted.map((m) => R.toScimUser(byId[String(m.userId)], m, scimBaseOf(req)));
        return res.json(R.listResponse(resources, startIndex, total));
    } catch (e) { logger.error(`scim.listUsers: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};

exports.getUser = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const cu = await prov.getCompanyUser(companyId, req.params.id);
        if (!cu) return res.status(404).json(R.scimError(404, 'User not found.'));
        const gu = await prov.getGlobalUser(req.params.id);
        return res.json(R.toScimUser(gu, cu, scimBaseOf(req)));
    } catch (e) { logger.error(`scim.getUser: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};

exports.createUser = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const email = R.extractEmail(req.body);
        if (!email) return res.status(400).json(R.scimError(400, 'userName (email) is required.'));
        const existing = await prov.getCompanyUserByEmail(companyId, email);
        if (existing && R.isActive(existing)) {
            return res.status(409).json(R.scimError(409, 'User already exists.'));
        }
        const defaultRoleType = (req.scimConfig && req.scimConfig.defaultRoleType) || 3;
        const active = req.body.active !== false;
        const { uid } = await prov.provision(companyId, {
            email,
            firstName: req.body.name && req.body.name.givenName,
            lastName: req.body.name && req.body.name.familyName,
            externalId: req.body.externalId,
            active, defaultRoleType,
        });
        const cu = await prov.getCompanyUser(companyId, uid);
        const gu = await prov.getGlobalUser(uid);
        audit(req, { action: 'scim.user_provision', entityType: 'member', entityId: String(uid), entityName: email });
        return res.status(201).json(R.toScimUser(gu, cu, scimBaseOf(req)));
    } catch (e) { logger.error(`scim.createUser: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};

exports.replaceUser = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const uid = req.params.id;
        const cu = await prov.getCompanyUser(companyId, uid);
        if (!cu) return res.status(404).json(R.scimError(404, 'User not found.'));
        await prov.updateName(uid, {
            givenName: req.body.name && req.body.name.givenName,
            familyName: req.body.name && req.body.name.familyName,
        });
        if (req.body.active !== undefined) await prov.setActive(companyId, uid, req.body.active !== false);
        const ncu = await prov.getCompanyUser(companyId, uid);
        const gu = await prov.getGlobalUser(uid);
        return res.json(R.toScimUser(gu, ncu, scimBaseOf(req)));
    } catch (e) { logger.error(`scim.replaceUser: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};

exports.patchUser = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const uid = req.params.id;
        const cu = await prov.getCompanyUser(companyId, uid);
        if (!cu) return res.status(404).json(R.scimError(404, 'User not found.'));
        const ops = R.parsePatchOps(req.body);
        if (ops.givenName !== undefined || ops.familyName !== undefined) await prov.updateName(uid, ops);
        if (ops.active !== undefined) {
            await prov.setActive(companyId, uid, ops.active);
            audit(req, { action: ops.active ? 'scim.user_activate' : 'scim.user_deactivate', entityType: 'member', entityId: String(uid) });
        }
        const ncu = await prov.getCompanyUser(companyId, uid);
        const gu = await prov.getGlobalUser(uid);
        return res.json(R.toScimUser(gu, ncu, scimBaseOf(req)));
    } catch (e) { logger.error(`scim.patchUser: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};

exports.deleteUser = async (req, res) => {
    try {
        const companyId = req.scimCompanyId;
        const uid = req.params.id;
        const cu = await prov.setActive(companyId, uid, false);
        if (!cu) return res.status(404).json(R.scimError(404, 'User not found.'));
        audit(req, { action: 'scim.user_deactivate', entityType: 'member', entityId: String(uid) });
        return res.status(204).send();
    } catch (e) { logger.error(`scim.deleteUser: ${e.message}`); return res.status(500).json(R.scimError(500, e.message)); }
};
