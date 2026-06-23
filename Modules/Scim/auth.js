const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const { parseScimToken, buildScimToken, scimError } = require('./helpers/scimRules');

const getScimConfig = (companyId) =>
    MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SCIM_CONFIGS, data: [{ deletedStatusKey: 0 }] }, 'findOne');

// Bearer-token middleware for /scim/v2/*. Resolves the company FROM the token,
// then verifies the secret against the stored bcrypt hash. Sets req.scimCompanyId.
const scimAuth = async (req, res, next) => {
    try {
        const hdr = req.headers['authorization'] || '';
        const m = /^Bearer\s+(.+)$/i.exec(hdr);
        if (!m) return res.status(401).set('WWW-Authenticate', 'Bearer').json(scimError(401, 'Missing bearer token.'));
        const parsed = parseScimToken(m[1]);
        if (!parsed) return res.status(401).json(scimError(401, 'Malformed token.'));
        const cfg = await getScimConfig(parsed.companyId);
        if (!cfg || !cfg.isEnabled || !cfg.tokenHash) return res.status(401).json(scimError(401, 'SCIM is not enabled for this workspace.'));
        const ok = await bcrypt.compare(parsed.secret, cfg.tokenHash);
        if (!ok) return res.status(401).json(scimError(401, 'Invalid token.'));
        req.scimCompanyId = parsed.companyId;
        req.scimConfig = cfg;
        return next();
    } catch (e) {
        logger.error(`scimAuth: ${e.message}`);
        return res.status(401).json(scimError(401, 'Authentication failed.'));
    }
};

// Owner/admin gate for the admin config endpoints. These pass through the JWT
// middleware first, so req.uid + the companyId header are populated.
const requireAdmin = async (req) => {
    const companyId = req.headers['companyid'];
    if (!companyId) return { ok: false, code: 400, msg: 'companyId is required.' };
    const roleType = await getRoleType(companyId, req.uid);
    if (!isPrivileged(roleType)) return { ok: false, code: 403, msg: 'Owner/admin only.' };
    return { ok: true, companyId };
};

// Generate (or rotate) the SCIM token. Stores only the bcrypt hash + last4 and
// returns the full token to show the admin ONCE.
const rotateScimToken = async (companyId, actor) => {
    const secret = crypto.randomBytes(24).toString('hex');
    const tokenHash = await bcrypt.hash(secret, 10);
    const set = { isEnabled: true, tokenHash, tokenLast4: secret.slice(-4), updatedBy: actor || '' };
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SCIM_CONFIGS,
        data: [
            { deletedStatusKey: 0 },
            { $set: set, $setOnInsert: { createdBy: actor || '', defaultRoleType: 3 } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        ],
    }, 'findOneAndUpdate');
    return buildScimToken(companyId, secret);
};

module.exports = { scimAuth, requireAdmin, rotateScimToken, getScimConfig };
