const jwtMiddleware = require('../../Config/jwt');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

/* Two ways in: the instance owner's own session (users.isProductOwner, set for
 * the account that ran setup), or INSTANCE_ADMIN_KEY in an `adminkey` header for
 * scripts. A company API token is never enough: it belongs to one tenant. */
async function isInstanceOwner(uid) {
    if (!uid) return false;
    const user = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: uid }, 'isProductOwner'] }, 'findOne');
    return Boolean(user && user.isProductOwner);
}

/* Hosted, the platform reuses these routes with its own key, behind the same locks as /api/v2/platform. */
function viaPlatformKey(req, res, next) {
    const platformGuard = require('../Platform/guard');
    const { logCall } = require('../Platform/platformAudit');
    const startedAt = Date.now();
    return platformGuard.checkPlatformCall(req).then((refused) => {
        if (refused) return refuse(res, refused.status, refused.statusText);
        req.instanceAdmin = 'platform';
        res.on('finish', () => logCall({
            action: 'platform.instance', requestId: req.platform.requestId, ok: res.statusCode < 400,
            summary: `${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode}`, durationMs: Date.now() - startedAt,
        }));
        return next();
    }).catch((error) => refuse(res, 500, error.message));
}

function requireInstanceAdmin(req, res, next) {
    if (require('../Platform/guard').carriesPlatformKey(req)) return viaPlatformKey(req, res, next);
    const configuredKey = process.env.INSTANCE_ADMIN_KEY || '';
    if (configuredKey && String(req.headers.adminkey || '') === configuredKey) {
        req.instanceAdmin = 'key';
        return next();
    }
    return jwtMiddleware.verifyJWTTokenV2(req, res, async () => {
        try {
            if (req.apiToken) return refuse(res, 403, 'An API token cannot administer the instance.');
            if (!(await isInstanceOwner(req.uid))) return refuse(res, 403, 'Only the instance owner can do this.');
            req.instanceAdmin = 'owner';
            return next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
    });
}

const MANAGED_DENIED = 'AlianHub Cloud manages this for you.';

const ownerOnHostedInstance = (req) => require('../../Config/hostingMode').isManaged() && req.instanceAdmin === 'owner';

/* On a hosted instance maintenance, upgrades, logs, backups and database drops are ours: the
 * owner is refused while the platform key still passes. */
function managedDeny(req, res, next) {
    if (ownerOnHostedInstance(req)) return refuse(res, 403, MANAGED_DENIED);
    return next();
}

module.exports = { requireInstanceAdmin, isInstanceOwner, managedDeny, ownerOnHostedInstance, MANAGED_DENIED };
