const { verifyCompanyMembership } = require('../../Config/jwt');
const { safeRelativePath } = require('../../utils/uploadConfig');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const USER_PROFILES_BUCKET = 'USER_PROFILES';

const refuse = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

const inAudience = (aud, companyId) => {
    if (!aud) return false;
    const list = Array.isArray(aud) ? aud : String(aud).split(',');
    return list.some((entry) => String(entry).trim() === companyId);
};

/* A company's bucket id is the company _id. The JWT audience is frozen at login,
 * so the live membership check is what locks out a user removed since then. */
async function belongsToCompany(req, companyId) {
    const id = String(companyId || '');
    if (!req.uid || !OBJECT_ID.test(id) || !inAudience(req.aud, id)) return false;
    return verifyCompanyMembership(String(req.uid), id);
}

function requireOwnBucket(pickBucketId, { allowUserProfiles = false } = {}) {
    return async (req, res, next) => {
        if (!req.uid) return refuse(res, 401, 'Unauthorized');
        const bucketId = String(pickBucketId(req) || '');
        if (allowUserProfiles && bucketId === USER_PROFILES_BUCKET) return next();
        try {
            if (await belongsToCompany(req, bucketId)) return next();
        } catch (error) {
            return refuse(res, 500, error.message);
        }
        return refuse(res, 403, 'You do not have access to this bucket');
    };
}

function requireSafeObjectPath(pickPath) {
    return (req, res, next) => (safeRelativePath(pickPath(req)) ? next() : refuse(res, 400, 'Invalid path'));
}

const bucketIdParam = (req) => req.params && req.params.bucketId;
const bodyField = (key) => (req) => req.body && req.body[key];
const queryField = (key) => (req) => req.query && req.query[key];

module.exports = {
    USER_PROFILES_BUCKET,
    belongsToCompany,
    requireOwnBucket,
    requireSafeObjectPath,
    bucketIdParam,
    bodyField,
    queryField,
};
