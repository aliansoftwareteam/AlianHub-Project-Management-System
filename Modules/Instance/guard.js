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

function requireInstanceAdmin(req, res, next) {
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

module.exports = { requireInstanceAdmin, isInstanceOwner };
