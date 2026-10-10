const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const R = require('./helpers/integrationsRules');
const S = require('./helpers/slackRules');
const H = require('./helpers/secretHandles');
const { SecretsStoreError } = require('../../Config/secrets');
const { pinSessionTenant } = require('../../Config/tenant');
const { requestAddress } = require('../../utils/requestAddress');
const { connectionsChanged } = require('./helpers/connectionsChanged');
const { grantOf, revokeGrant, revokeGrantOf } = require('./appConnections/githubConnect');
const repoMap = require('./appConnections/github/repoMap');
const { visibleProjectIds } = require('../Agents/scope');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');

// Secrets go to the store by handle or are sealed into config on every write (H.storeSecrets) and are stripped from every read (R.redact).

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const oid = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);

const refuse = (res, code, statusText, extra = {}) => res.status(code).send({ status: false, statusText, message: statusText, ...extra });

const actorOf = (req) => ({ id: String(req.uid || ''), ip: requestAddress(req) });

const failed = (res, e, what) => {
    logger.error(`${what}: ${e.message}`);
    if (e instanceof SecretsStoreError) return refuse(res, e.statusCode, e.message);
    return res.send({ status: false, statusText: e.message });
};

// Integrations hold company-wide credentials and data egress, so every write is
// an owner or admin act; the role is read from company_users, never the body.
const managerOrRefuse = async (req, res) => {
    const companyId = pinSessionTenant(req, res);
    if (!companyId) return null;
    if (isPrivileged(await getRoleType(companyId, req.uid))) return companyId;
    refuse(res, 403, 'Only an owner or admin can manage integrations.');
    return null;
};

const sameTarget = (existing, next) => {
    const keep = (type, config) => Object.fromEntries(Object.entries(config || {}).filter(([key]) => !R.secretKeys(type).includes(key)));
    return JSON.stringify(keep(existing.type, existing.config)) === JSON.stringify(keep(next.type, next.config));
};

const withoutSecretsOf = (type, config) => Object.fromEntries(Object.entries(config || {}).filter(([key]) => !R.secretKeys(type).includes(key)));

const PER_PROJECT = 'Token replaced. Add repositories per project.';

/* A GitHub row holds one shape. Once it maps repositories to projects, a pasted token replaces only the token: the typed
 * repository is left out (repositories are added per project), and the mapping, cursors and the person it reads as stay. */
const pastedOnMapped = (existing, config) => {
    const kept = withoutSecretsOf('github', existing.config);
    ['repo', 'auth', 'clientId'].forEach((key) => { delete kept[key]; });
    return { ...kept, token: config.token };
};

/* With a project named, the typed repository is folded into the mapping instead of the old single-repository fields. */
const foldedRepo = async (companyId, uid, existing, config, projectId) => {
    if (!OBJECT_ID.test(projectId)) return { refusal: 'A valid project id is required.' };
    const project = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: idForms([projectId]) }, deletedStatusKey: { $nin: [1, 2] }, isPersonal: { $ne: true } }, { _id: 1 }],
    }, 'findOne');
    if (!project) return { refusal: 'That project does not exist in this workspace.' };
    if (!(await visibleProjectIds(companyId, uid)).map(String).includes(projectId)) return { refusal: 'You cannot open that project.' };
    const { entries } = repoMap.withProject(existing || {}, config.repo, projectId, new Date().toISOString());
    const rest = { ...config };
    delete rest.repo;
    return { config: rest, entries };
};

exports.listCatalog = async (req, res) => {
    try {
        const connectors = require('../Agents/connectors/flag').requested();
        return res.send({ status: true, data: R.getCatalog(), ...(connectors.length ? { connectors } : {}) });
    }
    catch (e) { logger.error(`listCatalog: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.listConnections = async (req, res) => {
    try {
        const companyId = pinSessionTenant(req, res);
        if (!companyId) return undefined;
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.send({ status: true, data: (rows || []).map(R.redact) });
    } catch (e) { logger.error(`listConnections: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.connect = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const check = R.validateConnection(req.body || {});
        if (!check.valid) return refuse(res, 400, check.reason, { field: check.field });
        const item = R.byKey(check.value.type);
        const actor = actorOf(req);
        const isGithub = check.value.type === 'github';
        const projectId = String((req.body || {}).projectId || '');
        const uid = String(req.uid || '');
        const existing = item && !item.multiple ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: check.value.type, deletedStatusKey: { $ne: 1 } }],
        }, 'findOne') : null;
        const mapped = isGithub && repoMap.isMapped(existing);
        let config = check.value.config;
        let repos = null;
        if (mapped) config = pastedOnMapped(existing, config);
        else if (isGithub && projectId) {
            const folded = await foldedRepo(companyId, uid, existing, config, projectId);
            if (folded.refusal) return refuse(res, 400, folded.refusal);
            ({ config } = folded);
            repos = folded.entries;
        }
        const shape = repos ? { repos } : {};
        const unset = repos ? { projectIds: '' } : {};
        if (existing) {
            const earlierGrant = await grantOf(companyId, existing);
            const kept = await H.storeSecrets({ companyId, type: check.value.type, config, existing, actor });
            const restart = mapped || sameTarget(existing, { type: check.value.type, config }) ? {} : { sync: {}, connectedAt: new Date() };
            const $unset = { ...(kept.unset || {}), ...unset };
            const upd = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
                data: [{ _id: existing._id }, { $set: { ...kept.set, ...shape, name: check.value.name, status: 'connected', enabled: true, secretsVersion: R.SECRETS_VERSION, updatedBy: uid, ...(mapped ? {} : { connectedBy: uid }), ...restart }, ...(Object.keys($unset).length ? { $unset } : {}) }, { returnDocument: 'after' }],
            }, 'findOneAndUpdate');
            await H.retireSecrets({ companyId, handles: kept.stale, actor });
            revokeGrant(earlierGrant);
            removeCache(`integration_connections:${companyId}`);
            connectionsChanged(companyId, existing._id, { status: 'connected', enabled: true });
            return res.send({ status: true, statusText: mapped ? PER_PROJECT : 'Updated.', data: R.redact(upd) });
        }
        const kept = await H.storeSecrets({ companyId, type: check.value.type, config, actor });
        const data = {
            _id: new mongoose.Types.ObjectId(), type: check.value.type, name: check.value.name, ...kept.set, ...shape, secretsVersion: R.SECRETS_VERSION,
            status: 'connected', enabled: true, createdBy: String(req.uid || ''), connectedBy: String(req.uid || ''), connectedAt: new Date(), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data }, 'save');
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, data._id, { status: 'connected', enabled: true });
        return res.send({ status: true, statusText: 'Connected.', data: R.redact(saved) });
    } catch (e) { return failed(res, e, 'connect'); }
};

exports.updateConnection = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const _id = oid(req.params.id);
        if (!_id) return refuse(res, 400, 'A valid connection id is required.');
        const set = {};
        if (req.body.enabled !== undefined) set.enabled = !!req.body.enabled;
        if (!Object.keys(set).length) return refuse(res, 400, 'Nothing to update.');
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [{ _id, deletedStatusKey: { $ne: 1 } }, { $set: { ...set, updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return refuse(res, 404, 'Not found.');
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, _id, set);
        return res.send({ status: true, statusText: 'Updated.', data: R.redact(updated) });
    } catch (e) { logger.error(`updateConnection: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

exports.disconnect = async (req, res) => {
    try {
        const companyId = await managerOrRefuse(req, res);
        if (!companyId) return undefined;
        const _id = oid(req.params.id);
        if (!_id) return refuse(res, 400, 'A valid connection id is required.');
        const removed = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS,
            data: [{ _id, deletedStatusKey: { $ne: 1 } }, { $set: { deletedStatusKey: 1, enabled: false, status: 'disconnected', updatedBy: String(req.uid || '') } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!removed) return refuse(res, 404, 'Not found.');
        await revokeGrantOf(companyId, removed);
        await H.revokeSecrets({ companyId, row: removed, actor: actorOf(req) });
        removeCache(`integration_connections:${companyId}`);
        connectionsChanged(companyId, _id, { status: 'disconnected', enabled: false });
        return res.send({ status: true, statusText: 'Disconnected.' });
    } catch (e) { logger.error(`disconnect: ${e.message}`); return res.send({ status: false, statusText: e.message }); }
};

// Public route: authenticated by the per-workspace Slack verification token, not a JWT.
/* The command answers anyone in the Slack workspace, who is not matched to a person here: it names
 * only what every member can open. */
const EVERY_MEMBERS_PROJECTS = { isPrivateSpace: { $ne: true }, isPersonal: { $ne: true }, deletedStatusKey: { $nin: [1, 2] }, status: { $ne: 'close' } };

exports.slackCommand = async (req, res) => {
    try {
        const companyId = String(req.params.companyId || '');
        if (!companyId) return res.json(S.ephemeral('Missing workspace id.'));
        const conn = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ type: 'slack', deletedStatusKey: { $ne: 1 } }],
        }, 'findOne').catch(() => null);
        const verificationToken = conn ? (await H.openSecrets({ companyId, row: conn })).verification_token : null;
        if (!conn || conn.enabled === false || !verificationToken) {
            return res.json(S.ephemeral('Slack isn’t connected for this workspace yet — add it in AlianHub → Integrations → Marketplace.'));
        }
        if (!S.verifyToken(verificationToken, req.body && req.body.token)) {
            return res.status(401).json(S.ephemeral('Verification failed.'));
        }
        const { sub } = S.parseCommand(req.body && req.body.text);
        if (sub === 'projects') {
            const projects = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PROJECTS, data: [EVERY_MEMBERS_PROJECTS, 'ProjectName', { limit: 50 }] }, 'find').catch(() => []);
            return res.json(S.ephemeral(S.projectsText((projects || []).map((p) => p.ProjectName).filter(Boolean))));
        }
        return res.json(S.ephemeral(S.helpText()));
    } catch (e) { logger.error(`slackCommand: ${e.message}`); return res.json(S.ephemeral('Something went wrong.')); }
};
