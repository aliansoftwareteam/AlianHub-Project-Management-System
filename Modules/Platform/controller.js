const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { state: instanceState } = require('../../Config/instanceState');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const settings = require('../../Config/instanceSettings');
const { byKey, platformOwnedKeys } = require('../Instance/settingsCatalog');
const { checkDb, withTimeout } = require('../Instance/health');
const socketEmitter = require('../../event/socketEventEmitter');
const { emitListener } = require('../Setup/events');
const { STATE_IDS, readState, writeState } = require('./platformState');
const { forgetRotatedKeys, sha256Hex } = require('./guard');
const entitlements = require('./entitlements');
const lifecycle = require('./lifecycle');
const ownerLinks = require('./ownerLinks');
const provisioning = require('./provision');
const support = require('./supportSession');
const { usageReport, runningVersion } = require('./usage');

const PUBLIC_CONFIG_KEY = 'instance:public-config';
const ROTATION_MS = 24 * 60 * 60 * 1000;
const MIN_KEY_LENGTH = 32;
const STATUS_READS_TIMEOUT_MS = 1000;

const ok = (res, statusText, data) => res.send({ status: true, statusText, data });
const fail = (res, code, statusText, extra) => res.status(code).send({ status: false, statusText, ...(extra || {}) });
const note = (req, summary) => { req.platform.summary = summary; };

/* Thrown errors carry the status they mean; anything else is ours. */
const answerError = (req, res, error) => {
    const code = error && error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (code === 500) logger.error(`[platform] ${req.method} ${req.path} failed: ${error && error.message ? error.message : error}`);
    note(req, error && error.code ? `${error.code}: ${error.message}` : String((error && error.message) || error));
    return fail(res, code, (error && error.message) || 'Failed.', error && error.errors ? { errors: error.errors } : (error && error.code ? { code: error.code } : undefined));
};

async function installedState() {
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{}, { _id: 1 }] }, 'findOne');
    return Boolean(user);
}

/* The orchestrator's readiness probe: a database ping and two small global reads, never a tenant database. */
exports.status = async (req, res) => {
    const db = await checkDb();
    let installed = false;
    let provisionId = null;
    if (db.ok) {
        try {
            const [found, provisionDoc] = await withTimeout(Promise.all([installedState(), readState(STATE_IDS.PROVISION)]), STATUS_READS_TIMEOUT_MS, 'status reads');
            installed = found;
            provisionId = (provisionDoc && provisionDoc.provisionId) || null;
        } catch (error) {
            logger.warn(`[platform] status reads: ${error.message}`);
        }
    }
    const { version, build } = runningVersion();
    return ok(res, 'Status.', {
        version, build, dbOk: db.ok,
        setup: { installed, provisionId },
        migrations: { pending: instanceState.migrationsPending, error: instanceState.migrationError },
        lifecycle: lifecycle.lifecycle(),
        entitlementsVersion: entitlements.storedVersion(),
        maintenance: instanceState.maintenance,
        bootedAt: instanceState.bootedAt,
    });
};

exports.provision = async (req, res) => {
    const { valid, errors, data } = provisioning.validateProvision(req.body || {});
    if (!valid) {
        note(req, `invalid: ${Object.keys(errors).join(', ')}`);
        return fail(res, 400, 'Some fields need attention.', { errors });
    }
    try {
        const result = await provisioning.provision(data, { emit: (step) => emitListener(data.provisionId, { step }) });
        require('../Setup/controller').resetInstalledFlag();
        note(req, `provisionId=${data.provisionId} userId=${result.userId} companyId=${result.companyId}`);
        return ok(res, 'Provisioned.', result);
    } catch (error) {
        emitListener(data.provisionId, { step: 'STOP', error: error.message });
        return answerError(req, res, error);
    }
};

/* A key the customer owns is refused by name, so a push can never take a setting away from them. */
exports.putConfig = async (req, res) => {
    const values = req.body && req.body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return fail(res, 400, 'values must be an object.');
    const ours = new Set(platformOwnedKeys(settings.ownershipOverrides()));
    const errors = {};
    for (const key of Object.keys(values)) {
        if (!byKey.has(key)) errors[key] = 'unknown';
        else if (!ours.has(key)) errors[key] = 'not_platform';
    }
    note(req, `keys: ${Object.keys(values).join(', ') || 'none'}`);
    if (Object.keys(errors).length) return fail(res, 400, 'Some keys are not the platform\'s to set.', { errors });
    try {
        const result = await settings.savePlatformSettings(values, `platform:${req.platform.requestId || 'api'}`);
        myCache.del(PUBLIC_CONFIG_KEY);
        socketEmitter.emit('update', { module: 'instanceSettings', event: 'INSTANCE_SETTINGS_UPDATED', keys: result.applied });
        note(req, `keys: ${Object.keys(values).join(', ') || 'none'}; applied: ${result.applied.join(', ') || 'none'}`);
        return ok(res, 'Applied.', result);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.putEntitlements = async (req, res) => {
    try {
        const result = await entitlements.acceptEntitlementsToken(req.body && req.body.token, { source: 'push' });
        note(req, result.applied ? `version ${result.version} applied` : `stale; stored version ${result.version}`);
        return ok(res, result.applied ? 'Applied.' : 'Already at this version or newer.', result);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.usage = async (req, res) => {
    try {
        return ok(res, 'Usage.', await usageReport());
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.setLifecycle = async (req, res) => {
    const { valid, errors, data } = lifecycle.validateLifecycle(req.body || {});
    if (!valid) return fail(res, 400, 'Some fields need attention.', { errors });
    try {
        const result = await lifecycle.setLifecycle(data);
        req.platform.action = 'platform.lifecycle';
        note(req, `${result.previous} -> ${result.state}${data.reason ? ` (${data.reason})` : ''}`);
        return ok(res, result.changed ? 'Lifecycle changed.' : 'Lifecycle unchanged.', { state: result.state, previous: result.previous });
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.activationLink = async (req, res) => {
    try {
        const link = await ownerLinks.activationLink({ email: req.body && req.body.email });
        note(req, `owner ${link.userId}`);
        return ok(res, 'Activation link issued.', link);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.loginLink = async (req, res) => {
    try {
        const link = await ownerLinks.ownerLoginLink();
        note(req, `owner ${link.userId}${link.twoFactor ? ' (two-factor on)' : ''}`);
        return ok(res, 'Sign-in link issued.', link);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.transferOwner = async (req, res) => {
    try {
        const result = await ownerLinks.transferOwnership({ toEmail: req.body && req.body.toEmail });
        note(req, `${result.previousUserId || 'none'} -> ${result.userId}`);
        return ok(res, result.changed ? 'Ownership moved.' : 'Already the owner.', result);
    } catch (error) {
        return answerError(req, res, error);
    }
};

/* The new key works beside the env key for 24 hours, until the orchestrator's next stack update makes it the env key. */
exports.rotateKey = async (req, res) => {
    const newKey = String((req.body && req.body.newKey) || '');
    if (newKey.length < MIN_KEY_LENGTH) return fail(res, 400, `newKey must be at least ${MIN_KEY_LENGTH} characters.`);
    try {
        const now = Date.now();
        const doc = await readState(STATE_IDS.KEYS);
        const hash = sha256Hex(newKey);
        const kept = ((doc && doc.extraKeys) || []).filter((row) => row && row.hash !== hash && new Date(row.expiresAt).getTime() > now);
        const expiresAt = new Date(now + ROTATION_MS);
        await writeState(STATE_IDS.KEYS, { extraKeys: [...kept, { hash, expiresAt, addedAt: new Date(now) }] });
        forgetRotatedKeys();
        note(req, `extra key until ${expiresAt.toISOString()}`);
        return ok(res, 'Key added.', { rotated: true, expiresAt });
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.startSupportSession = async (req, res) => {
    const { valid, errors, data } = support.validateSupportSession(req.body || {});
    if (!valid) return fail(res, 400, 'Some fields need attention.', { errors });
    try {
        const result = await support.startSupportSession(data);
        note(req, `${data.staffName} <${data.staffEmail}> until ${data.expiresAt.toISOString()}`);
        return ok(res, 'Support session started.', result);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.endSupportSession = async (req, res) => {
    try {
        const result = await support.endSupportSession({ reason: 'revoked' });
        note(req, result.ended ? 'ended' : 'none open');
        return ok(res, result.ended ? 'Support session ended.' : 'No support session was open.', result);
    } catch (error) {
        return answerError(req, res, error);
    }
};

exports.supportAccess = (req, res) => ok(res, 'Support access.', support.supportAccess());
